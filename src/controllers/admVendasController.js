/**
 * PROSPEKT CRM — Administração de Vendas Controller
 *
 * Gerencia o pós-venda operacional:
 *   - Criação automática de card a partir de lead ganho
 *   - Etapas operacionais: acompanhamento → compras → producao → manuseio → transporte → concluido
 *   - Histórico/timeline completo
 *   - Controle de acesso: VENDEDOR vê só os seus; GESTOR/SUPER_ADMIN vê todos
 */

const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

// Etapas válidas em ordem
const ETAPAS_ORDEM = ['acompanhamento','compras','producao','manuseio','transporte','concluido'];

const ETAPAS_LABELS = {
  acompanhamento: 'Acompanhamento do Pedido',
  compras:        'Compras / Chegada de Materiais',
  producao:       'Produção',
  manuseio:       'Manuseio',
  transporte:     'Transporte',
  concluido:      'Venda Concluída',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function gerarId() {
  return crypto.randomBytes(16).toString('hex');
}

function agora() {
  return new Date().toISOString();
}

// ── GET /api/adm-vendas ───────────────────────────────────────────────────────
async function listar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { etapa, responsavel_id, busca, status = 'ativo', data_inicio, data_fim } = req.query;
  const usuario = req.usuario;

  try {
    if (isSupa) {
      let q = sb.from('adm_vendas').select(`
        *,
        responsavel:usuarios!responsavel_id(id,nome,avatar_url)
      `).eq('status', status || 'ativo').order('criado_em', { ascending: false });

      if (usuario.role === 'VENDEDOR')    q = q.eq('responsavel_id', usuario.id);
      else if (responsavel_id)            q = q.eq('responsavel_id', responsavel_id);
      if (etapa)  q = q.eq('etapa', etapa);
      if (busca)  q = q.or(`nome.ilike.%${busca}%,empresa.ilike.%${busca}%,produto_nome.ilike.%${busca}%`);
      // Filtro por data de entrada na etapa (usa etapa_atualizada_em; fallback para atualizado_em)
      if (data_inicio) q = q.or(`etapa_atualizada_em.gte.${data_inicio},and(etapa_atualizada_em.is.null,atualizado_em.gte.${data_inicio})`);
      if (data_fim)   q = q.or(`etapa_atualizada_em.lte.${data_fim}T23:59:59,and(etapa_atualizada_em.is.null,atualizado_em.lte.${data_fim}T23:59:59)`);

      const { data, error } = await q;
      if (error) throw error;

      const itens = (data || []).map(v => ({
        ...v,
        responsavel_nome: v.responsavel?.nome || null,
        etapa_label: ETAPAS_LABELS[v.etapa] || v.etapa,
      }));
      return res.json({ sucesso: true, dados: itens, total: itens.length });
    }

    // SQLite
    let sql = `
      SELECT av.*, u.nome as responsavel_nome
      FROM adm_vendas av
      LEFT JOIN usuarios u ON av.responsavel_id = u.id
      WHERE av.status = ?`;
    const params = [status || 'ativo'];

    if (usuario.role === 'VENDEDOR') { sql += ' AND av.responsavel_id = ?'; params.push(usuario.id); }
    else if (responsavel_id)         { sql += ' AND av.responsavel_id = ?'; params.push(responsavel_id); }
    if (etapa) { sql += ' AND av.etapa = ?'; params.push(etapa); }
    if (busca) {
      sql += ' AND (av.nome LIKE ? OR av.empresa LIKE ? OR av.produto_nome LIKE ?)';
      const q = `%${busca}%`; params.push(q, q, q);
    }
    // Filtro por data de entrada na etapa (etapa_atualizada_em; fallback atualizado_em para antigos)
    if (data_inicio) {
      sql += ' AND (COALESCE(av.etapa_atualizada_em, av.atualizado_em) >= ?)';
      params.push(data_inicio + 'T00:00:00');
    }
    if (data_fim) {
      sql += ' AND (COALESCE(av.etapa_atualizada_em, av.atualizado_em) <= ?)';
      params.push(data_fim + 'T23:59:59');
    }
    sql += ' ORDER BY av.criado_em DESC';

    const itens = sqlite.prepare(sql).all(...params).map(v => ({
      ...v,
      etapa_label: ETAPAS_LABELS[v.etapa] || v.etapa,
    }));
    return res.json({ sucesso: true, dados: itens, total: itens.length });
  } catch(e) {
    console.error('[admVendas.listar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


// ── GET /api/adm-vendas/:id ───────────────────────────────────────────────────
async function buscarPorId(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  const usuario = req.usuario;

  try {
    if (isSupa) {
      const { data, error } = await sb.from('adm_vendas').select(`
        *, responsavel:usuarios!responsavel_id(id,nome,avatar_url)
      `).eq('id', id).single();
      if (error || !data) return res.status(404).json({ sucesso: false, erro: 'Card não encontrado.' });
      if (usuario.role === 'VENDEDOR' && data.responsavel_id !== usuario.id)
        return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
      return res.json({ sucesso: true, dados: { ...data, responsavel_nome: data.responsavel?.nome || null, etapa_label: ETAPAS_LABELS[data.etapa] } });
    }

    const row = sqlite.prepare(`
      SELECT av.*, u.nome as responsavel_nome
      FROM adm_vendas av LEFT JOIN usuarios u ON av.responsavel_id = u.id
      WHERE av.id = ?
    `).get(id);
    if (!row) return res.status(404).json({ sucesso: false, erro: 'Card não encontrado.' });
    if (usuario.role === 'VENDEDOR' && row.responsavel_id !== usuario.id)
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
    return res.json({ sucesso: true, dados: { ...row, etapa_label: ETAPAS_LABELS[row.etapa] } });
  } catch(e) {
    console.error('[admVendas.buscarPorId]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/adm-vendas ──────────────────────────────────────────────────────
// Criação manual (raramente usada — clonagem é automática via leads.mover)
async function criar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const id = gerarId();
  const now = agora();

  const {
    lead_original_id, nome, empresa, email, telefone, responsavel_id,
    funil_id, valor_venda, forma_pagamento, quantidade_parcelas, parcelas_json,
    produto_id, produto_nome, produto_cor, origem, tags, observacoes,
    data_venda, data_entrega_prevista,
  } = req.body;

  if (!nome) return res.status(400).json({ sucesso: false, erro: 'nome é obrigatório.' });

  const row = {
    id, lead_original_id: lead_original_id || null, nome, empresa: empresa || null,
    email: email || null, telefone: telefone || null,
    responsavel_id: responsavel_id || req.usuario.id,
    funil_id: funil_id || null,
    valor_venda: valor_venda || 0, forma_pagamento: forma_pagamento || null,
    quantidade_parcelas: quantidade_parcelas || 1, parcelas_json: parcelas_json || null,
    produto_id: produto_id || null, produto_nome: produto_nome || null,
    produto_cor: produto_cor || null, origem: origem || null,
    tags: tags ? JSON.stringify(tags) : null,
    observacoes: observacoes || null,
    data_venda: data_venda || null, data_entrega_prevista: data_entrega_prevista || null,
    etapa: 'acompanhamento', status: 'ativo',
    criado_em: now, atualizado_em: now,
  };

  try {
    if (isSupa) {
      const { data, error } = await sb.from('adm_vendas').insert(row).select().single();
      if (error) throw error;
      // Histórico inicial
      await _registrarHistorico(sb, isSupa, sqlite, id, null, 'SISTEMA', 'Card criado manualmente na Administração de Vendas.');
      return res.status(201).json({ sucesso: true, dados: data });
    }

    sqlite.prepare(`
      INSERT INTO adm_vendas (id,lead_original_id,nome,empresa,email,telefone,responsavel_id,funil_id,
        valor_venda,forma_pagamento,quantidade_parcelas,parcelas_json,produto_id,produto_nome,produto_cor,
        origem,tags,observacoes,data_venda,data_entrega_prevista,etapa,status,criado_em,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'acompanhamento','ativo',?,?)
    `).run(
      id, row.lead_original_id, nome, row.empresa, row.email, row.telefone,
      row.responsavel_id, row.funil_id, row.valor_venda, row.forma_pagamento,
      row.quantidade_parcelas, row.parcelas_json, row.produto_id, row.produto_nome,
      row.produto_cor, row.origem, row.tags, row.observacoes,
      row.data_venda, row.data_entrega_prevista, now, now
    );
    await _registrarHistorico(sb, isSupa, sqlite, id, null, 'SISTEMA', 'Card criado manualmente na Administração de Vendas.');
    return res.status(201).json({ sucesso: true, dados: sqlite.prepare('SELECT * FROM adm_vendas WHERE id=?').get(id) });
  } catch(e) {
    console.error('[admVendas.criar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── PATCH /api/adm-vendas/:id ─────────────────────────────────────────────────
async function atualizar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  const usuario = req.usuario;
  const now = agora();

  try {
    // Verifica existência e permissão
    const atual = await _buscar(sb, isSupa, sqlite, id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Card não encontrado.' });
    if (usuario.role === 'VENDEDOR' && atual.responsavel_id !== usuario.id)
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

    const allow = [
      'nome','empresa','email','telefone','funil_id','valor_venda','forma_pagamento',
      'quantidade_parcelas','parcelas_json','produto_id','produto_nome','produto_cor',
      'origem','observacoes','data_venda','data_entrega_prevista',
    ];
    if (usuario.role !== 'VENDEDOR') allow.push('responsavel_id');

    const upd = { atualizado_em: now };
    allow.forEach(k => { if (req.body[k] !== undefined) upd[k] = req.body[k]; });
    if (req.body.tags !== undefined) upd.tags = JSON.stringify(req.body.tags);

    if (isSupa) {
      const { data, error } = await sb.from('adm_vendas').update(upd).eq('id', id).select().single();
      if (error) throw error;
      return res.json({ sucesso: true, dados: data });
    }

    const sets = Object.keys(upd).map(k => `${k}=?`).join(',');
    sqlite.prepare(`UPDATE adm_vendas SET ${sets} WHERE id=?`).run(...Object.values(upd), id);
    return res.json({ sucesso: true, dados: sqlite.prepare('SELECT * FROM adm_vendas WHERE id=?').get(id) });
  } catch(e) {
    console.error('[admVendas.atualizar]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── PATCH /api/adm-vendas/:id/etapa ──────────────────────────────────────────
async function moverEtapa(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  const { etapa } = req.body;
  const usuario = req.usuario;

  if (!ETAPAS_ORDEM.includes(etapa))
    return res.status(400).json({ sucesso: false, erro: `Etapa inválida. Válidas: ${ETAPAS_ORDEM.join(', ')}.` });

  try {
    const atual = await _buscar(sb, isSupa, sqlite, id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Card não encontrado.' });
    if (usuario.role === 'VENDEDOR' && atual.responsavel_id !== usuario.id)
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

    const etapaAnterior = atual.etapa;
    const now = agora();
    const novoStatus = etapa === 'concluido' ? 'concluido' : 'ativo';
    const upd = { etapa, status: novoStatus, atualizado_em: now, etapa_atualizada_em: now };

    if (isSupa) {
      const { data, error } = await sb.from('adm_vendas').update(upd).eq('id', id).select().single();
      if (error) throw error;
    } else {
      sqlite.prepare('UPDATE adm_vendas SET etapa=?, status=?, atualizado_em=?, etapa_atualizada_em=? WHERE id=?')
        .run(etapa, novoStatus, now, now, id);
    }

    // Histórico de mudança de etapa — detalhado
    const etapaAntLabel = ETAPAS_LABELS[etapaAnterior] || etapaAnterior;
    const etapaNovaLabel = ETAPAS_LABELS[etapa] || etapa;
    const msg = `Pedido movido de "${etapaAntLabel}" para "${etapaNovaLabel}". Responsável: ${usuario.nome||usuario.email||'Sistema'}. Data: ${new Date(now).toLocaleString('pt-BR')}.`;
    await _registrarHistorico(sb, isSupa, sqlite, id, usuario.id, 'ETAPA', msg);

    return res.json({ sucesso: true, etapa, etapa_label: ETAPAS_LABELS[etapa], status: novoStatus, etapa_atualizada_em: now });
  } catch(e) {
    console.error('[admVendas.moverEtapa]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}


// ── GET /api/adm-vendas/:id/historico ─────────────────────────────────────────
async function historico(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;

  try {
    if (isSupa) {
      const { data, error } = await sb.from('adm_vendas_historico').select(`
        *, autor:usuarios!usuario_id(nome)
      `).eq('adm_venda_id', id).order('criado_em', { ascending: true });
      if (error) throw error;
      return res.json({ sucesso: true, dados: (data || []).map(h => ({ ...h, autor_nome: h.autor?.nome || 'Sistema' })) });
    }

    const rows = sqlite.prepare(`
      SELECT h.*, u.nome as autor_nome
      FROM adm_vendas_historico h LEFT JOIN usuarios u ON h.usuario_id = u.id
      WHERE h.adm_venda_id = ? ORDER BY h.criado_em ASC
    `).all(id);
    return res.json({ sucesso: true, dados: rows });
  } catch(e) {
    console.error('[admVendas.historico]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── POST /api/adm-vendas/:id/historico (nota manual) ─────────────────────────
async function adicionarNota(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  const { conteudo } = req.body;
  if (!conteudo) return res.status(400).json({ sucesso: false, erro: 'conteudo é obrigatório.' });

  const usuario = req.usuario;
  try {
    const atual = await _buscar(sb, isSupa, sqlite, id);
    if (!atual) return res.status(404).json({ sucesso: false, erro: 'Card não encontrado.' });
    if (usuario.role === 'VENDEDOR' && atual.responsavel_id !== usuario.id)
      return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });

    const hId = await _registrarHistorico(sb, isSupa, sqlite, id, usuario.id, 'NOTA', conteudo);
    return res.status(201).json({ sucesso: true, dados: { id: hId, adm_venda_id: id, tipo: 'NOTA', conteudo, autor_nome: usuario.nome, criado_em: agora() } });
  } catch(e) {
    console.error('[admVendas.adicionarNota]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ── Clonagem automática (chamada internamente pelo leadsController) ─────────────────
/**
 * Cria um card de Administração de Vendas a partir de um lead ganho.
 * Retorna { sucesso, criado, id } — não lança exceção (erros são logados).
 *
 * Garante idempotência: se já existir um card ativo para o mesmo lead_original_id
 * com data_venda igual ao dia atual, não duplica.
 */
async function clonarDeLeadGanho(leadData, responsavelId, sb, isSupa, sqlite) {
  try {
    const agr = agora();
    const dataVenda = agr.slice(0, 10);

    // Idempotência: verifica se já existe card ativo para este lead
    let existente = null;
    if (isSupa) {
      const { data } = await sb.from('adm_vendas')
        .select('id')
        .eq('lead_original_id', leadData.id)
        .neq('status', 'cancelado')
        .limit(1);
      existente = data?.[0] || null;
    } else {
      try {
        existente = sqlite.prepare(
          `SELECT id FROM adm_vendas WHERE lead_original_id=? AND status != 'cancelado' LIMIT 1`
        ).get(leadData.id);
      } catch { existente = null; }
    }

    if (existente) {
      console.log(`[ADM_VENDAS] Lead ${leadData.id} já tem card ativo (${existente.id}) — não duplicar.`);
      return { sucesso: true, criado: false, id: existente.id };
    }

    // Cria o clone
    const id = gerarId();
    const row = {
      id,
      lead_original_id: leadData.id,
      nome:              leadData.nome,
      empresa:           leadData.empresa           || null,
      email:             leadData.email             || null,
      telefone:          leadData.telefone          || null,
      responsavel_id:    responsavelId              || null,
      funil_id:          leadData.funil_id          || null,
      valor_venda:       Number(leadData.valor_venda ?? leadData.valor ?? 0),
      forma_pagamento:   leadData.forma_pagamento   || null,
      quantidade_parcelas: leadData.quantidade_parcelas || 1,
      parcelas_json:     leadData.parcelas_json     || null,
      produto_id:        leadData.produto_id        || null,
      produto_nome:      leadData.produto_nome      || null,
      produto_cor:       leadData.produto_cor       || null,
      origem:            leadData.origem            || null,
      tags:              leadData.tags ? (typeof leadData.tags === 'string' ? leadData.tags : JSON.stringify(leadData.tags)) : null,
      observacoes:       leadData.observacoes       || null,
      data_venda:        dataVenda,
      data_entrega_prevista: null,
      etapa:   'acompanhamento',
      status:  'ativo',
      criado_em:    agr,
      atualizado_em: agr,
    };

    if (isSupa) {
      const { error } = await sb.from('adm_vendas').insert(row);
      if (error) throw error;
    } else {
      sqlite.prepare(`
        INSERT INTO adm_vendas (id,lead_original_id,nome,empresa,email,telefone,responsavel_id,funil_id,
          valor_venda,forma_pagamento,quantidade_parcelas,parcelas_json,produto_id,produto_nome,produto_cor,
          origem,tags,observacoes,data_venda,data_entrega_prevista,etapa,status,criado_em,atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'acompanhamento','ativo',?,?)
      `).run(
        id, leadData.id, row.nome, row.empresa, row.email, row.telefone,
        row.responsavel_id, row.funil_id, row.valor_venda, row.forma_pagamento,
        row.quantidade_parcelas, row.parcelas_json, row.produto_id, row.produto_nome,
        row.produto_cor, row.origem, row.tags, row.observacoes,
        row.data_venda, row.data_entrega_prevista, agr, agr
      );
    }

    // Histórico do clone
    await _registrarHistorico(sb, isSupa, sqlite, id, null, 'SISTEMA',
      `Card criado automaticamente a partir de venda ganha no funil comercial. Lead original: ${leadData.nome}`
    );

    console.log(`[ADM_VENDAS] ✅ Card ${id} criado para lead ${leadData.id} (${leadData.nome})`);
    return { sucesso: true, criado: true, id };
  } catch(e) {
    console.error('[ADM_VENDAS] ❌ Erro ao clonar lead:', e.message);
    return { sucesso: false, criado: false, erro: e.message };
  }
}

// ── Helpers internos ──────────────────────────────────────────────────────────

async function _buscar(sb, isSupa, sqlite, id) {
  if (isSupa) {
    const { data } = await sb.from('adm_vendas').select('*').eq('id', id).single();
    return data || null;
  }
  return sqlite.prepare('SELECT * FROM adm_vendas WHERE id=?').get(id) || null;
}

async function _registrarHistorico(sb, isSupa, sqlite, admVendaId, usuarioId, tipo, conteudo) {
  const hId = gerarId();
  const agr = agora();
  try {
    if (isSupa) {
      await sb.from('adm_vendas_historico').insert({
        id: hId, adm_venda_id: admVendaId,
        usuario_id: usuarioId || null, tipo, conteudo, criado_em: agr,
      });
    } else {
      sqlite.prepare(`
        INSERT INTO adm_vendas_historico (id,adm_venda_id,usuario_id,tipo,conteudo,criado_em)
        VALUES (?,?,?,?,?,?)
      `).run(hId, admVendaId, usuarioId || null, tipo, conteudo, agr);
    }
    return hId;
  } catch(e) {
    console.warn('[ADM_VENDAS] Histórico não registrado:', e.message);
    return null;
  }
}

module.exports = {
  listar,
  buscarPorId,
  criar,
  atualizar,
  moverEtapa,
  historico,
  adicionarNota,
  clonarDeLeadGanho,
  ETAPAS_ORDEM,
  ETAPAS_LABELS,
};
