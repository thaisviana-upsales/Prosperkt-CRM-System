/**
 * PROSPERKT CRM — Audit Controller
 * Consulta audit_logs (imutável) + lixeira (soft delete) + restore
 * Acesso restrito a GESTOR e SUPER_ADMIN
 */
const { getProvider } = require('../database/dbProvider');
const { registrarLog } = require('../services/auditService');
const crypto = require('crypto');

// ── GET /api/audit — lista audit_logs com filtros ───────────────────────────
async function listarAudit(req, res) {
  const { sb, isSupa } = getProvider();
  const {
    entidade, entidade_id, usuario_id, acao,
    data_inicio, data_fim,
    limite = 100, offset = 0,
  } = req.query;

  try {
    if (isSupa) {
      let q = sb.from('audit_logs').select('*');
      if (entidade)    q = q.eq('entidade', entidade);
      if (entidade_id) q = q.eq('entidade_id', entidade_id);
      if (usuario_id)  q = q.eq('usuario_id', usuario_id);
      if (acao)        q = q.eq('acao', acao);
      if (data_inicio) q = q.gte('criado_em', data_inicio + 'T00:00:00');
      if (data_fim)    q = q.lte('criado_em', data_fim + 'T23:59:59');
      q = q.order('criado_em', { ascending: false }).range(Number(offset), Number(offset) + Number(limite) - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return res.json({ sucesso: true, dados: data || [], total: count });
    }
    // SQLite: usa tabela logs existente
    const { getDb } = require('../database/db');
    const db = getDb();
    let sql = 'SELECT l.*, u.nome as usuario_nome FROM logs l LEFT JOIN usuarios u ON l.usuario_id=u.id WHERE 1=1';
    const params = [];
    if (entidade)    { sql += ' AND l.entidade=?';    params.push(entidade); }
    if (entidade_id) { sql += ' AND l.entidade_id=?'; params.push(entidade_id); }
    if (usuario_id)  { sql += ' AND l.usuario_id=?';  params.push(usuario_id); }
    if (acao)        { sql += ' AND l.acao=?';         params.push(acao); }
    sql += ' ORDER BY l.criado_em DESC LIMIT ? OFFSET ?';
    params.push(Number(limite), Number(offset));
    const logs = db.prepare(sql).all(...params);
    return res.json({ sucesso: true, dados: logs, total: logs.length });
  } catch(e) {
    console.error('[audit.listar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── GET /api/admin/lixeira?entidade=leads|produtos|funis|etapas ──────────────
async function listarLixeira(req, res) {
  const { sb, isSupa } = getProvider();
  const { entidade = 'leads', limite = 100, offset = 0 } = req.query;

  const tabelasPermitidas = ['leads', 'produtos', 'funis', 'etapas'];
  if (!tabelasPermitidas.includes(entidade)) {
    return res.status(400).json({ sucesso: false, erro: 'Entidade inválida.' });
  }

  try {
    if (isSupa) {
      let q = sb.from(entidade).select('*').not('deleted_at', 'is', null);
      q = q.order('deleted_at', { ascending: false }).range(Number(offset), Number(offset) + Number(limite) - 1);
      const { data, error } = await q;
      if (error) throw error;
      return res.json({ sucesso: true, entidade, dados: data || [] });
    }
    return res.json({ sucesso: true, entidade, dados: [], aviso: 'Lixeira disponível apenas com Supabase.' });
  } catch(e) {
    console.error('[audit.lixeira]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/admin/restore — restaura um registro da lixeira ────────────────
async function restore(req, res) {
  const { sb, isSupa } = getProvider();
  const { entidade, id } = req.body;

  const tabelasPermitidas = ['leads', 'produtos', 'funis', 'etapas'];
  if (!entidade || !id) return res.status(400).json({ sucesso: false, erro: 'entidade e id são obrigatórios.' });
  if (!tabelasPermitidas.includes(entidade)) return res.status(400).json({ sucesso: false, erro: 'Entidade inválida.' });

  try {
    if (isSupa) {
      // Verifica se o registro existe e está deletado
      const { data: registro } = await sb.from(entidade).select('*').eq('id', id).single();
      if (!registro) return res.status(404).json({ sucesso: false, erro: 'Registro não encontrado.' });
      if (!registro.deleted_at) return res.status(400).json({ sucesso: false, erro: 'Registro não está na lixeira.' });

      const { error } = await sb.from(entidade).update({
        deleted_at: null,
        deleted_by: null,
        atualizado_em: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;

      // Registra na auditoria
      await registrarLog({
        acao: 'RESTORE',
        entidade,
        entidade_id: id,
        antes: { deleted_at: registro.deleted_at },
        depois: { deleted_at: null },
        usuario: req.usuario,
        ip: req.ip,
        ua: req.get('user-agent'),
      });

      return res.json({ sucesso: true, mensagem: `${entidade} restaurado com sucesso.` });
    }
    return res.status(501).json({ sucesso: false, erro: 'Restore disponível apenas com Supabase.' });
  } catch(e) {
    console.error('[audit.restore]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── GET /api/admin/stats — estatísticas de auditoria ─────────────────────────
async function statsAudit(req, res) {
  const { sb, isSupa } = getProvider();
  try {
    if (isSupa) {
      const [
        { count: totalLogs },
        { count: deletadosLeads },
        { count: deletadosProdutos },
        { count: backupsTotal },
      ] = await Promise.all([
        sb.from('audit_logs').select('*', { count: 'exact', head: true }),
        sb.from('leads').select('*', { count: 'exact', head: true }).not('deleted_at', 'is', null),
        sb.from('produtos').select('*', { count: 'exact', head: true }).not('deleted_at', 'is', null),
        sb.from('backups').select('*', { count: 'exact', head: true }).eq('status', 'concluido'),
      ]);
      return res.json({
        sucesso: true,
        dados: {
          total_audit_logs: totalLogs || 0,
          leads_na_lixeira: deletadosLeads || 0,
          produtos_na_lixeira: deletadosProdutos || 0,
          backups_concluidos: backupsTotal || 0,
        },
      });
    }
    return res.json({ sucesso: true, dados: { aviso: 'Stats disponível apenas com Supabase.' } });
  } catch(e) {
    console.error('[audit.stats]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listarAudit, listarLixeira, restore, statsAudit };
