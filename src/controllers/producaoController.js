/**
 * PROSPEKT CRM — Produção Controller
 * Gerencia dados de produção de um lead (datas, quantidade, anotações)
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

// ── GET /api/leads/:id/producao ───────────────────────────────────────────────
async function buscar(req, res) {
  const { sb, isSupa } = getProvider();
  const leadId = req.params.id;
  try {
    if (isSupa) {
      const { data, error } = await sb.from('lead_producao').select('*').eq('lead_id', leadId).maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return res.json({ sucesso: true, dados: data || null });
    }
    return res.json({ sucesso: true, dados: null });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST ou PATCH /api/leads/:id/producao (upsert) ───────────────────────────
async function salvar(req, res) {
  const { sb, isSupa } = getProvider();
  const leadId = req.params.id;
  const agora  = new Date().toISOString();
  const campos = [
    'data_solicitacao_orcamento','data_envio_orcamento',
    'data_envio_amostra','data_aprovacao_amostra',
    'data_entrega','quantidade','anotacoes'
  ];
  try {
    if (isSupa) {
      const { data: existente } = await sb.from('lead_producao').select('id').eq('lead_id', leadId).maybeSingle();
      const row = { lead_id: leadId, atualizado_em: agora };
      campos.forEach(k => { if (req.body[k] !== undefined) row[k] = req.body[k]; });

      let data, error;
      if (existente?.id) {
        ({ data, error } = await sb.from('lead_producao').update(row).eq('lead_id', leadId).select().single());
      } else {
        row.id        = crypto.randomBytes(16).toString('hex');
        row.criado_em = agora;
        ({ data, error } = await sb.from('lead_producao').insert(row).select().single());
      }
      if (error) throw error;
      return res.json({ sucesso: true, dados: data });
    }
    return res.json({ sucesso: true, dados: {} });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { buscar, salvar };
