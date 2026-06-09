/**
 * PROSPEKT CRM — Audit Logger Service
 * Registra ações no banco: SQLite ou Supabase conforme DATABASE_PROVIDER
 */

const crypto = require('crypto');
const { MODE } = require('../database/dbProvider');

/**
 * Registra uma entrada de auditoria
 */
async function registrarLog({ acao, entidade, entidade_id, antes, depois, usuario, ip, ua, origem }) {
  try {
    const id = crypto.randomBytes(16).toString('hex');

    if (MODE === 'supabase') {
      // Supabase: usa tabela logs via JS client
      const { getProvider } = require('../database/dbProvider');
      const { sb } = getProvider();
      if (!sb) return; // sem client, ignora silenciosamente

      const payload = {
        id,
        usuario_id:  usuario?.id   || null,
        acao,
        entidade:    entidade      || null,
        entidade_id: entidade_id   || null,
        antes:       antes  ? antes  : null,
        depois:      depois ? depois : null,
        ip:          ip            || null,
        user_agent:  ua            || null,
      };

      // Grava na tabela logs (histórico do lead — existente)
      await sb.from('logs').insert(payload).catch(() => {});

      // Grava na tabela audit_logs (imutável — hardening)
      await sb.from('audit_logs').insert({
        ...payload,
        usuario_nome: usuario?.nome || null,
        usuario_role: usuario?.role || null,
        origem: origem || 'web',
      }).catch(() => {}); // silencioso se tabela ainda não existir

    } else {
      // SQLite
      const { getDb } = require('../database/db');
      const db = getDb();
      db.prepare(`
        INSERT INTO logs (
          id, usuario_id, usuario_nome, usuario_role,
          acao, entidade, entidade_id,
          dados_antes, dados_depois,
          ip_address, user_agent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        usuario?.id   || null,
        usuario?.nome || null,
        usuario?.role || null,
        acao,
        entidade      || null,
        entidade_id   || null,
        antes  ? JSON.stringify(antes)  : null,
        depois ? JSON.stringify(depois) : null,
        ip  || null,
        ua  || null
      );
    }
  } catch (err) {
    // Log não pode derrubar a aplicação
    console.error('[AuditLog] Falha ao registrar log:', err.message);
  }
}

/**
 * Middleware Express: injeta função log no req para usar em controllers
 */
function auditMiddleware(req, res, next) {
  req.log = ({ acao, entidade, entidade_id, antes, depois }) => {
    registrarLog({
      acao,
      entidade,
      entidade_id,
      antes,
      depois,
      usuario: req.usuario ? {
        id:   req.usuario.id,
        nome: req.usuario.nome,
        role: req.usuario.role,
      } : null,
      ip: req.ip,
      ua: req.get('user-agent'),
    }).catch(e => console.error('[AuditLog middleware]', e.message));
  };
  next();
}

/**
 * Busca logs do lead para o histórico do modal
 */
async function buscarLogsLead(leadId) {
  try {
    if (MODE === 'supabase') {
      const { getProvider } = require('../database/dbProvider');
      const { sb } = getProvider();
      if (!sb) return [];
      const { data } = await sb.from('logs')
        .select('*, usuario:usuarios!usuario_id(nome)')
        .eq('entidade_id', leadId)
        .order('criado_em', { ascending: true });
      return (data || []).map(l => ({
        ...l,
        usuario_nome: l.usuario?.nome || 'Sistema',
      }));
    } else {
      const { getDb } = require('../database/db');
      const db = getDb();
      return db.prepare(`SELECT l.*, u.nome as usuario_nome FROM logs l
        LEFT JOIN usuarios u ON l.usuario_id=u.id
        WHERE l.entidade_id=? ORDER BY l.criado_em`).all(leadId);
    }
  } catch(e) {
    console.error('[AuditLog buscarLogsLead]', e.message);
    return [];
  }
}

/**
 * Busca logs com filtros opcionais (para /api/logs)
 */
async function buscarLogs({ entidade, entidade_id, usuario_id, acao, limite = 100, offset = 0 } = {}) {
  try {
    if (MODE === 'supabase') {
      const { getProvider } = require('../database/dbProvider');
      const { sb } = getProvider();
      if (!sb) return [];
      let q = sb.from('logs').select('*');
      if (entidade)    q = q.eq('entidade', entidade);
      if (entidade_id) q = q.eq('entidade_id', entidade_id);
      if (usuario_id)  q = q.eq('usuario_id', usuario_id);
      if (acao)        q = q.eq('acao', acao);
      q = q.order('criado_em', { ascending: false }).range(offset, offset + limite - 1);
      const { data } = await q;
      return data || [];
    } else {
      const { getDb } = require('../database/db');
      const db = getDb();
      let sql = 'SELECT * FROM logs WHERE 1=1';
      const params = [];
      if (entidade)    { sql += ' AND entidade = ?';    params.push(entidade); }
      if (entidade_id) { sql += ' AND entidade_id = ?'; params.push(entidade_id); }
      if (usuario_id)  { sql += ' AND usuario_id = ?';  params.push(usuario_id); }
      if (acao)        { sql += ' AND acao = ?';         params.push(acao); }
      sql += ' ORDER BY criado_em DESC LIMIT ? OFFSET ?';
      params.push(limite, offset);
      return db.prepare(sql).all(...params);
    }
  } catch(e) {
    console.error('[AuditLog buscarLogs]', e.message);
    return [];
  }
}

module.exports = { registrarLog, auditMiddleware, buscarLogs, buscarLogsLead };
