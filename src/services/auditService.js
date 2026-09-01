/**
 * PROSPEKT CRM — Audit Logger Service
 * Registra ações no banco: SQLite ou Supabase conforme DATABASE_PROVIDER
 */

const crypto = require('crypto');
const { MODE } = require('../database/dbProvider');

/**
 * Registra uma entrada de auditoria na tabela 'logs'.
 * ATENÇÃO: tabela Supabase usa dados_antes/dados_depois (não antes/depois).
 */
async function registrarLog({ acao, entidade, entidade_id, antes, depois, descricao, usuario, ip, ua, origem }) {
  try {
    const id = crypto.randomBytes(16).toString('hex');

    if (MODE === 'supabase') {
      const { getProvider } = require('../database/dbProvider');
      const { sb } = getProvider();
      if (!sb) return;

      const payload = {
        id,
        usuario_id:    usuario?.id   || null,
        usuario_nome:  usuario?.nome || null,
        usuario_role:  usuario?.role || null,
        acao,
        entidade:      entidade      || null,
        entidade_id:   entidade_id   || null,
        dados_antes:   antes  || null,   // ← CORRIGIDO: era 'antes'
        dados_depois:  depois || null,   // ← CORRIGIDO: era 'depois'
        descricao:     descricao     || null,
        ip_address:    ip            || null,
        user_agent:    ua            || null,
      };

      // sb.from().insert() retorna PostgrestFilterBuilder (thenable mas sem .catch())
      // Usar await com destructuring é a forma correta para Supabase JS v2
      const { error: logErr } = await sb.from('logs').insert(payload);
      if (logErr) console.error('[AuditLog] logs insert error:', logErr.message);

      // audit_logs (imutável — silencioso se tabela não existir)
      const { error: auditErr } = await sb.from('audit_logs').insert({
        ...payload,
        origem: origem || 'web',
      });
      // ignora erro de audit_logs (tabela pode não existir)
      void auditErr;


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
    console.error('[AuditLog] Falha ao registrar log:', err.message);
  }
}

/**
 * Registra evento rico na tabela lead_timeline.
 * Usado para eventos de lead com dados_anteriores/dados_novos detalhados.
 */
async function registrarTimeline({
  leadId, usuarioId, usuarioNome, tipoAcao, descricao,
  dadosAnteriores = null, dadosNovos = null, origem = 'crm'
}) {
  try {
    const id = crypto.randomBytes(16).toString('hex');

    if (MODE === 'supabase') {
      const { getProvider } = require('../database/dbProvider');
      const { sb } = getProvider();
      if (!sb) return;

      console.log('TIMELINE_LEAD_CREATE_EVENT', { leadId, tipoAcao, origem });

      const { error } = await sb.from('lead_timeline').insert({
        id,
        lead_id:          leadId,
        usuario_id:       usuarioId    || null,
        usuario_nome:     usuarioNome  || 'Sistema',
        tipo_acao:        tipoAcao,
        descricao,
        dados_anteriores: dadosAnteriores || null,
        dados_novos:      dadosNovos      || null,
        origem,
        criado_em:        new Date().toISOString(),
      });

      if (error) {
        console.warn('[Timeline] lead_timeline insert error:', error.message, '— execute patch v16 no Supabase.');
      }
    } else {
      // SQLite — guarda na tabela logs com tipo_acao como ação
      const { getDb } = require('../database/db');
      const db = getDb();
      db.prepare(`
        INSERT INTO logs (id, usuario_id, usuario_nome, acao, entidade, entidade_id, dados_antes, dados_depois)
        VALUES (?, ?, ?, ?, 'leads', ?, ?, ?)
      `).run(
        id,
        usuarioId   || null,
        usuarioNome || 'Sistema',
        tipoAcao,
        leadId,
        dadosAnteriores ? JSON.stringify(dadosAnteriores) : null,
        dadosNovos      ? JSON.stringify(dadosNovos)      : null,
      );
    }
  } catch (e) {
    console.error('[Timeline] Falha ao registrar evento:', e.message);
  }
}

/**
 * Middleware Express: injeta função log no req para usar em controllers
 */
function auditMiddleware(req, res, next) {
  req.log = ({ acao, entidade, entidade_id, antes, depois, descricao }) => {
    registrarLog({
      acao,
      entidade,
      entidade_id,
      antes,
      depois,
      descricao,
      usuario: req.usuario ? {
        id:   req.usuario.id,
        nome: req.usuario.nome,
        role: req.usuario.role,
      } : null,
      ip: req.ip,
      ua: req.get('user-agent'),
    }).catch(e => console.error('[AuditLog middleware]', e.message));
  };

  // Shortcut para timeline do lead (req.timeline)
  req.timeline = (opts) => {
    registrarTimeline({
      ...opts,
      usuarioId:   opts.usuarioId   || req.usuario?.id,
      usuarioNome: opts.usuarioNome || req.usuario?.nome || 'Sistema',
    }).catch(e => console.error('[Timeline middleware]', e.message));
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
        .eq('entidade', 'leads')
        .eq('entidade_id', leadId)
        .order('criado_em', { ascending: true });
      return (data || []).map(l => ({
        ...l,
        usuario_nome: l.usuario_nome || l.usuario?.nome || 'Sistema',
      }));
    } else {
      const { getDb } = require('../database/db');
      const db = getDb();
      return db.prepare(`SELECT l.*, u.nome as usuario_nome FROM logs l
        LEFT JOIN usuarios u ON l.usuario_id=u.id
        WHERE l.entidade='leads' AND l.entidade_id=? ORDER BY l.criado_em`).all(leadId);
    }
  } catch(e) {
    console.error('[AuditLog buscarLogsLead]', e.message);
    return [];
  }
}

/**
 * Busca eventos da lead_timeline (tabela rica)
 */
async function buscarTimeline(leadId) {
  try {
    if (MODE === 'supabase') {
      const { getProvider } = require('../database/dbProvider');
      const { sb } = getProvider();
      if (!sb) return [];
      const { data, error } = await sb.from('lead_timeline')
        .select('*')
        .eq('lead_id', leadId)
        .order('criado_em', { ascending: true });
      if (error) {
        console.warn('[Timeline] buscarTimeline error:', error.message);
        return [];
      }
      return data || [];
    } else {
      const { getDb } = require('../database/db');
      const db = getDb();
      return db.prepare(`SELECT l.*, u.nome as usuario_nome FROM logs l
        LEFT JOIN usuarios u ON l.usuario_id=u.id
        WHERE l.entidade='leads' AND l.entidade_id=?
        ORDER BY l.criado_em`).all(leadId)
        .map(l => ({
          id: l.id,
          lead_id: l.entidade_id,
          usuario_id: l.usuario_id,
          usuario_nome: l.usuario_nome || 'Sistema',
          tipo_acao: l.acao,
          descricao: l.descricao || '',
          dados_anteriores: l.dados_antes ? (() => { try { return JSON.parse(l.dados_antes); } catch { return null; } })() : null,
          dados_novos: l.dados_depois ? (() => { try { return JSON.parse(l.dados_depois); } catch { return null; } })() : null,
          origem: 'crm',
          criado_em: l.criado_em,
        }));
    }
  } catch(e) {
    console.error('[Timeline] buscarTimeline error:', e.message);
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

module.exports = {
  registrarLog,
  registrarTimeline,
  auditMiddleware,
  buscarLogs,
  buscarLogsLead,
  buscarTimeline,
};
