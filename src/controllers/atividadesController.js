/**
 * PROSPEKT CRM — Atividades Controller
 * CRUD de atividades por lead + dashboard de atividades
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

// ── GET /api/leads/:id/atividades ─────────────────────────────────────────────
async function listar(req, res) {
  const { sb, isSupa } = getProvider();
  const leadId = req.params.id;
  try {
    if (isSupa) {
      let q = sb.from('atividades')
        .select('*, usuario:usuarios!usuario_id(id,nome)')
        .eq('lead_id', leadId)
        .order('criado_em', { ascending: false });
      if (req.usuario.role === 'VENDEDOR') q = q.eq('usuario_id', req.usuario.id);
      const { data, error } = await q;
      if (error) throw error;
      return res.json({ sucesso: true, dados: (data || []).map(a => ({
        ...a, usuario_nome: a.usuario?.nome || 'Sistema'
      }))});
    }
    return res.json({ sucesso: true, dados: [] });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/leads/:id/atividades ────────────────────────────────────────────
async function criar(req, res) {
  const { sb, isSupa } = getProvider();
  const leadId = req.params.id;
  const { tipo, observacao, data_limite, hora_limite, status = 'pendente' } = req.body;
  if (!tipo) return res.status(400).json({ sucesso: false, erro: 'tipo é obrigatório.' });
  const id    = crypto.randomBytes(16).toString('hex');
  const agora = new Date().toISOString();
  try {
    if (isSupa) {
      const { data, error } = await sb.from('atividades').insert({
        id, lead_id: leadId,
        usuario_id: req.usuario.id,
        tipo, observacao: observacao || null,
        data_limite: data_limite || null,
        hora_limite: hora_limite || null,
        status,
        criado_em: agora, atualizado_em: agora,
      }).select('*, usuario:usuarios!usuario_id(id,nome)').single();
      if (error) throw error;
      req.log?.({ acao: 'CREATE', entidade: 'atividades', entidade_id: id, depois: { tipo, lead_id: leadId } });
      return res.status(201).json({ sucesso: true, dados: { ...data, usuario_nome: data.usuario?.nome || 'Sistema' } });
    }
    return res.status(201).json({ sucesso: true, dados: { id, lead_id: leadId, tipo, status } });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── PATCH /api/atividades/:id ─────────────────────────────────────────────────
async function atualizar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  const agora  = new Date().toISOString();
  try {
    if (isSupa) {
      const { data: atual } = await sb.from('atividades').select('*').eq('id', id).single();
      if (!atual) return res.status(404).json({ sucesso: false, erro: 'Atividade não encontrada.' });
      if (req.usuario.role === 'VENDEDOR' && atual.usuario_id !== req.usuario.id)
        return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

      const upd = { atualizado_em: agora };
      ['tipo','observacao','data_limite','hora_limite','status'].forEach(k => {
        if (req.body[k] !== undefined) upd[k] = req.body[k];
      });
      if (req.body.status === 'concluida' && !atual.concluida_em) upd.concluida_em = agora;

      const { data, error } = await sb.from('atividades').update(upd).eq('id', id)
        .select('*, usuario:usuarios!usuario_id(id,nome)').single();
      if (error) throw error;
      return res.json({ sucesso: true, dados: { ...data, usuario_nome: data.usuario?.nome || 'Sistema' } });
    }
    return res.json({ sucesso: true, dados: { id } });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── DELETE /api/atividades/:id ────────────────────────────────────────────────
async function deletar(req, res) {
  const { sb, isSupa } = getProvider();
  const { id } = req.params;
  try {
    if (isSupa) {
      const { data: atual } = await sb.from('atividades').select('usuario_id').eq('id', id).single();
      if (!atual) return res.status(404).json({ sucesso: false, erro: 'Não encontrada.' });
      if (req.usuario.role === 'VENDEDOR' && atual.usuario_id !== req.usuario.id)
        return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
      const { error } = await sb.from('atividades').delete().eq('id', id);
      if (error) throw error;
      return res.json({ sucesso: true });
    }
    return res.json({ sucesso: true });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── GET /api/atividades/dashboard ─────────────────────────────────────────────
// Totais para o painel do Dashboard: total, concluídas, atrasadas, pendentes
async function dashboard(req, res) {
  const { sb, isSupa } = getProvider();
  const { usuario_id, data_inicio, data_fim, funil_id } = req.query;
  try {
    if (isSupa) {
      let q = sb.from('atividades').select('id,status,data_limite,hora_limite,usuario_id,lead_id');
      if (req.usuario.role === 'VENDEDOR') q = q.eq('usuario_id', req.usuario.id);
      else if (usuario_id) q = q.eq('usuario_id', usuario_id);
      if (data_inicio) q = q.gte('criado_em', data_inicio);
      if (data_fim)    q = q.lte('criado_em', data_fim + 'T23:59:59');
      const { data, error } = await q;
      if (error) throw error;
      const agora = new Date();
      const todas = data || [];
      const total     = todas.length;
      const concluidas = todas.filter(a => a.status === 'concluida').length;
      // Atrasada: data_limite passada e status pendente/adiada
      const atrasadas = todas.filter(a => {
        if (!['pendente','adiada'].includes(a.status)) return false;
        if (!a.data_limite) return false;
        const dt = new Date(a.data_limite + (a.hora_limite ? 'T' + a.hora_limite : 'T23:59:59'));
        return dt < agora;
      }).length;
      const pendentes = todas.filter(a => a.status === 'pendente').length;
      return res.json({ sucesso: true, dados: { total, concluidas, atrasadas, pendentes } });
    }
    return res.json({ sucesso: true, dados: { total: 0, concluidas: 0, atrasadas: 0, pendentes: 0 } });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── GET /api/atividades/pendentes ─────────────────────────────────────────────
// Retorna atividades pendentes do usuário logado (para lembretes no footer)
async function pendentes(req, res) {
  const { sb, isSupa } = getProvider();
  try {
    if (isSupa) {
      const { data, error } = await sb.from('atividades')
        .select('*, lead:leads!lead_id(id,nome), usuario:usuarios!usuario_id(id,nome)')
        .eq('usuario_id', req.usuario.id)
        .in('status', ['pendente', 'adiada'])
        .not('data_limite', 'is', null)
        .order('data_limite').order('hora_limite');
      if (error) throw error;
      return res.json({ sucesso: true, dados: (data || []).map(a => ({
        ...a,
        lead_nome: a.lead?.nome || '',
        usuario_nome: a.usuario?.nome || 'Sistema',
      }))});
    }
    return res.json({ sucesso: true, dados: [] });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listar, criar, atualizar, deletar, dashboard, pendentes };
