/**
 * PROSPEKT CRM — Atividades Controller v2
 * CRUD de atividades por lead + dashboard + lembretes
 * v2: + responsavel_id, + em_andamento, + timeline ao concluir/iniciar
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

// Status válidos (inclui em_andamento)
const STATUS_VALIDOS = ['pendente','em_andamento','concluida','adiada','atrasada'];

// SELECT padrão reutilizado em todas as queries
const SELECT_ATIVIDADE = '*, usuario:usuarios!usuario_id(id,nome), responsavel:usuarios!responsavel_id(id,nome)';

// Normaliza objeto retornado do Supabase
function normAt(a) {
  return {
    ...a,
    usuario_nome:     a.usuario?.nome     || 'Sistema',
    responsavel_nome: a.responsavel?.nome || a.usuario?.nome || 'Sistema',
  };
}

// ── GET /api/leads/:id/atividades ─────────────────────────────────────────────
async function listar(req, res) {
  const { sb, isSupa } = getProvider();
  const leadId = req.params.id;
  try {
    if (isSupa) {
      // VENDEDOR vê atividades onde é criador OU responsável
      let q = sb.from('atividades')
        .select(SELECT_ATIVIDADE)
        .eq('lead_id', leadId)
        .order('data_limite', { ascending: true, nullsFirst: false })
        .order('criado_em', { ascending: false });
      // SDR/VENDEDOR: vê suas próprias e as que é responsável
      if (req.usuario.role === 'VENDEDOR') {
        q = q.or(`usuario_id.eq.${req.usuario.id},responsavel_id.eq.${req.usuario.id}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return res.json({ sucesso: true, dados: (data || []).map(normAt) });
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
  const {
    tipo, observacao, data_limite, hora_limite,
    status = 'pendente',
    responsavel_id,
  } = req.body;
  if (!tipo) return res.status(400).json({ sucesso: false, erro: 'tipo é obrigatório.' });
  if (status && !STATUS_VALIDOS.includes(status))
    return res.status(400).json({ sucesso: false, erro: `Status inválido: ${status}` });

  const id    = crypto.randomBytes(16).toString('hex');
  const agora = new Date().toISOString();
  try {
    if (isSupa) {
      const { data, error } = await sb.from('atividades').insert({
        id, lead_id: leadId,
        usuario_id:    req.usuario.id,
        responsavel_id: responsavel_id || req.usuario.id, // default: criador = responsável
        tipo,
        observacao: observacao || null,
        data_limite: data_limite || null,
        hora_limite: hora_limite || null,
        status,
        criado_em: agora, atualizado_em: agora,
      }).select(SELECT_ATIVIDADE).single();
      if (error) throw error;

      // Registra na timeline do lead
      req.log?.({
        acao:       'CREATE',
        entidade:   'atividades',
        entidade_id: id,
        depois: {
          tipo, status, lead_id: leadId,
          responsavel_id: responsavel_id || req.usuario.id,
          data_limite: data_limite || null,
        },
        conteudo: `Atividade criada: ${tipo}${data_limite ? ` (prazo: ${data_limite})` : ''}.`,
      });

      return res.status(201).json({ sucesso: true, dados: normAt(data) });
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

      // VENDEDOR pode editar se for criador OU responsável
      const isVendedor = req.usuario.role === 'VENDEDOR';
      const eCriador   = atual.usuario_id     === req.usuario.id;
      const eResponsavel = atual.responsavel_id === req.usuario.id;
      if (isVendedor && !eCriador && !eResponsavel)
        return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

      // Valida status
      if (req.body.status && !STATUS_VALIDOS.includes(req.body.status))
        return res.status(400).json({ sucesso: false, erro: `Status inválido: ${req.body.status}` });

      const upd = { atualizado_em: agora };
      ['tipo','observacao','data_limite','hora_limite','status','responsavel_id'].forEach(k => {
        if (req.body[k] !== undefined) upd[k] = req.body[k];
      });

      // Marca concluída_em ao concluir
      if (req.body.status === 'concluida' && !atual.concluida_em) {
        upd.concluida_em = agora;
      }

      const { data, error } = await sb.from('atividades').update(upd).eq('id', id)
        .select(SELECT_ATIVIDADE).single();
      if (error) throw error;

      // Registra na timeline quando status muda para concluida ou em_andamento
      const statusMudou = req.body.status && req.body.status !== atual.status;
      if (statusMudou && atual.lead_id) {
        const labelStatus = {
          concluida:   'concluída ✓',
          em_andamento:'em andamento ▶',
          pendente:    'pendente',
          adiada:      'adiada',
          atrasada:    'atrasada',
        };
        req.log?.({
          acao:        'UPDATE',
          entidade:    'atividades',
          entidade_id: id,
          lead_id:     atual.lead_id,
          antes:  { status: atual.status },
          depois: { status: req.body.status },
          conteudo: `Atividade "${atual.tipo}" marcada como ${labelStatus[req.body.status] || req.body.status}.`,
        });
      }

      return res.json({ sucesso: true, dados: normAt(data) });
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
      const { data: atual } = await sb.from('atividades').select('usuario_id,responsavel_id').eq('id', id).single();
      if (!atual) return res.status(404).json({ sucesso: false, erro: 'Não encontrada.' });
      const isVendedor = req.usuario.role === 'VENDEDOR';
      if (isVendedor && atual.usuario_id !== req.usuario.id && atual.responsavel_id !== req.usuario.id)
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
async function dashboard(req, res) {
  const { sb, isSupa } = getProvider();
  const { usuario_id, data_inicio, data_fim } = req.query;
  try {
    if (isSupa) {
      let q = sb.from('atividades').select('id,status,data_limite,hora_limite,usuario_id,responsavel_id,lead_id');
      if (req.usuario.role === 'VENDEDOR') {
        // Vê atividades onde é criador OU responsável
        q = q.or(`usuario_id.eq.${req.usuario.id},responsavel_id.eq.${req.usuario.id}`);
      } else if (usuario_id) {
        q = q.or(`usuario_id.eq.${usuario_id},responsavel_id.eq.${usuario_id}`);
      }
      if (data_inicio) q = q.gte('criado_em', data_inicio);
      if (data_fim)    q = q.lte('criado_em', data_fim + 'T23:59:59');
      const { data, error } = await q;
      if (error) throw error;
      const agora = new Date();
      const todas = data || [];
      const total      = todas.length;
      const concluidas = todas.filter(a => a.status === 'concluida').length;
      const em_andamento = todas.filter(a => a.status === 'em_andamento').length;
      const atrasadas  = todas.filter(a => {
        if (['concluida'].includes(a.status)) return false;
        if (!a.data_limite) return false;
        const dt = new Date(a.data_limite + (a.hora_limite ? 'T' + a.hora_limite : 'T23:59:59'));
        return dt < agora;
      }).length;
      const pendentes = todas.filter(a => a.status === 'pendente').length;
      return res.json({ sucesso: true, dados: { total, concluidas, em_andamento, atrasadas, pendentes } });
    }
    return res.json({ sucesso: true, dados: { total: 0, concluidas: 0, em_andamento: 0, atrasadas: 0, pendentes: 0 } });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── GET /api/atividades/pendentes ─────────────────────────────────────────────
async function pendentes(req, res) {
  const { sb, isSupa } = getProvider();
  try {
    if (isSupa) {
      // Retorna pendentes/em_andamento onde o usuário é criador OU responsável
      const { data, error } = await sb.from('atividades')
        .select('*, lead:leads!lead_id(id,nome), usuario:usuarios!usuario_id(id,nome), responsavel:usuarios!responsavel_id(id,nome)')
        .or(`usuario_id.eq.${req.usuario.id},responsavel_id.eq.${req.usuario.id}`)
        .in('status', ['pendente', 'em_andamento', 'adiada'])
        .not('data_limite', 'is', null)
        .order('data_limite').order('hora_limite');
      if (error) throw error;
      return res.json({ sucesso: true, dados: (data || []).map(a => ({
        ...a,
        lead_nome:        a.lead?.nome        || '',
        usuario_nome:     a.usuario?.nome     || 'Sistema',
        responsavel_nome: a.responsavel?.nome || a.usuario?.nome || 'Sistema',
      }))});
    }
    return res.json({ sucesso: true, dados: [] });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

module.exports = { listar, criar, atualizar, deletar, dashboard, pendentes };
