/**
 * PROSPEKT CRM — Leads Controller
 * Supabase JS nativo quando DATABASE_PROVIDER=supabase, SQLite caso contrário.
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');

// SLA Contato 1 — importação lazy para evitar dependência circular
let _automacaoSvc = null;
function getAutomacaoSvc() {
  if (!_automacaoSvc) _automacaoSvc = require('../services/automacaoLeadsService');
  return _automacaoSvc;
}

// admVendas — importação lazy para evitar dependência circular
let _admVendasCtrl = null;
function getAdmVendasCtrl() {
  if (!_admVendasCtrl) _admVendasCtrl = require('./admVendasController');
  return _admVendasCtrl;
}

// Mapa de previsão → etapa de Carteira Recorrente
const PREVISAO_ETAPA_CARTEIRA = {
  '15-30 dias':  'Previsão Carteira 15-30 dias',
  '30-60 dias':  'Previsão Carteira 30-60 dias',
  '60-90 dias':  'Previsão Carteira 60-90 dias',
  '3 - 6 meses': 'Previsão Carteira 3 - 6 meses',
  '6 - 9 meses': 'Previsão Carteira 6 - 9 meses',
  '9 - 18 meses':'Previsão Carteira 9 - 18 meses',
  '+18 meses':   'Previsão Carteira +18 meses',
};

// Dias de deslocamento para calcular data_prevista_proxima_compra
const PREVISAO_DIAS = {
  '15-30 dias':  15,
  '30-60 dias':  30,
  '60-90 dias':  60,
  '3 - 6 meses': 90,
  '6 - 9 meses': 180,
  '9 - 18 meses':270,
  '+18 meses':   540,
};

// ── Helper: formata log de auditoria em texto legível ──────────────────────────
function _parseSafe(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

function formatarLog(l, etapaMap = {}) {
  const d = _parseSafe(l.depois);
  const a = _parseSafe(l.antes);
  let icone = '📋', titulo = l.acao || '', conteudo = '';
  switch ((l.acao || '').toUpperCase()) {
    case 'CREATE':
      icone = '🌱'; titulo = 'Lead criado';
      conteudo = 'Lead registrado no CRM.';
      break;
    case 'MOVER':
    case 'UPDATE_ETAPA': {
      icone = '➡️'; titulo = 'Etapa alterada';
      const eAntes  = etapaMap[a.etapa_id]  || '';
      const eDepois = etapaMap[d.etapa_id]  || '';
      const stStr   = d.status ? ` · Status: ${d.status}` : '';
      conteudo = eAntes && eDepois && eAntes !== eDepois
        ? `Movido de "${eAntes}" para "${eDepois}"${stStr}`
        : eDepois
          ? `Movido para "${eDepois}"${stStr}`
          : `Etapa atualizada${stStr}`;
      break;
    }
    case 'TAG_ADD':
      icone = '🏷️'; titulo = 'Tag adicionada';
      conteudo = d.tag ? `Tag "${d.tag}" adicionada.` : 'Tag adicionada.';
      break;
    case 'TAG_REMOVE':
      icone = '🗑️'; titulo = 'Tag removida';
      conteudo = d.tag ? `Tag "${d.tag}" removida.` : 'Tag removida.';
      break;
    case 'CLONE':
      icone = '📋'; titulo = 'Lead clonado';
      conteudo = 'Lead criado como cópia de outro.';
      break;
    case 'DELETE':
      icone = '🗑️'; titulo = 'Lead excluído';
      conteudo = 'Lead movido para a lixeira.';
      break;
    case 'AUTOMACAO_MSG_ENVIADA':
    case 'SLA_CONTATO_1':
      icone = '🤖'; titulo = 'Mensagem automática';
      conteudo = 'Automação disparada pelo sistema.';
      break;
    case 'ADD_NOTA':
      icone = '📝'; titulo = 'Nota adicionada';
      conteudo = d.conteudo ? `"${String(d.conteudo).slice(0, 80)}${d.conteudo.length > 80 ? '…' : ''}"` : '';
      break;
    default:
      titulo = l.acao || '?';
      conteudo = d.nome ? `"${d.nome}"` : JSON.stringify(d).slice(0, 80);
  }
  return {
    id: l.id,
    tipo: 'LOG',
    acao: l.acao || '',
    icone,
    titulo,
    conteudo,
    autor_nome: l.autor_nome || 'Sistema',
    criado_em: l.criado_em,
  };
}

// ── Rodízio de Leads entre Vendedores ─────────────────────────────────────────
/**
 * Retorna o ID do próximo vendedor ativo em rodízio justo.
 * Algoritmo: pega o vendedor que tem o menor número de leads criados,
 * desempatando pelo último lead criado (quem recebeu mais recentemente fica por último).
 * Isso garante distribuição igualitária sem depender de tabela de controle separada.
 */
async function _proximoVendedorRodizio(sb) {
  try {
    // 1. Lista vendedores ativos (role=VENDEDOR, ativo=true)
    const { data: vendedores, error: eV } = await sb.from('usuarios')
      .select('id, nome')
      .eq('role', 'VENDEDOR')
      .eq('ativo', true)
      .order('nome');
    if (eV || !vendedores?.length) {
      console.log('[Rodízio] Nenhum vendedor ativo disponível para distribuição.');
      return null;
    }

    // 2. Conta leads por vendedor (apenas leads não arquivados/deletados)
    const { data: contagens } = await sb.from('leads')
      .select('responsavel_id')
      .in('responsavel_id', vendedores.map(v => v.id))
      .neq('status', 'arquivado');

    const count = {};
    vendedores.forEach(v => { count[v.id] = 0; });
    (contagens || []).forEach(l => { if (count[l.responsavel_id] !== undefined) count[l.responsavel_id]++; });

    // 3. Pega o último lead de cada vendedor (para desempate temporal)
    const { data: ultimosLeads } = await sb.from('leads')
      .select('responsavel_id, criado_em')
      .in('responsavel_id', vendedores.map(v => v.id))
      .order('criado_em', { ascending: false })
      .limit(vendedores.length * 2);

    const ultimoEm = {};
    vendedores.forEach(v => { ultimoEm[v.id] = '1970-01-01'; });
    (ultimosLeads || []).forEach(l => {
      if (!ultimoEm[l.responsavel_id] || l.criado_em > ultimoEm[l.responsavel_id])
        ultimoEm[l.responsavel_id] = l.criado_em;
    });

    // 4. Ordena: menor contagem primeiro; empate = quem recebeu há mais tempo primeiro
    const ordenados = vendedores.slice().sort((a, b) => {
      if (count[a.id] !== count[b.id]) return count[a.id] - count[b.id];
      return ultimoEm[a.id] < ultimoEm[b.id] ? -1 : 1;
    });

    const escolhido = ordenados[0];
    console.log(`[Rodízio] Próximo vendedor: ${escolhido.nome} (${escolhido.id}) — leads: ${count[escolhido.id]}`);
    return escolhido.id;
  } catch (e) {
    console.warn('[Rodízio] Erro ao calcular rodízio:', e.message);
    return null;
  }
}

// ── Helpers Supabase ──────────────────────────────────────────────────────────

function mapStatus(s) {
  // Normaliza status do Supabase (minúsculo) para padrão interno (maiúsculo)
  if (!s) return 'ABERTO';
  const m = { ativo:'ABERTO', ganho:'GANHO', perdido:'PERDIDO', arquivado:'ARQUIVADO',
               ABERTO:'ABERTO', GANHO:'GANHO', PERDIDO:'PERDIDO' };
  return m[s] || 'ABERTO';
}

function toSupaStatus(s) {
  const m = { ABERTO:'ativo', GANHO:'ganho', PERDIDO:'perdido', ARQUIVADO:'arquivado' };
  return m[s] || 'ativo';
}

function normalizeLead(l) {
  if (!l) return l;
  return { ...l, status: mapStatus(l.status) };
}

// ── GET /api/leads ────────────────────────────────────────────────────────────
async function listar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { funil_id, etapa_id, responsavel_id, status, busca } = req.query;

  try {
    if (isSupa) {
      let q = sb.from('leads').select(`
        *,
        responsavel:usuarios!responsavel_id(id,nome),
        etapa:etapas!etapa_id(id,nome,cor),
        funil:funis!funil_id(id,nome,cor)
      `);

      if (etapa_id)       q = q.eq('etapa_id', etapa_id);
      if (responsavel_id) q = q.eq('responsavel_id', responsavel_id);
      if (funil_id)       q = q.eq('funil_id', funil_id);
      if (status)         q = q.eq('status', toSupaStatus(status));
      if (req.usuario.role === 'VENDEDOR') q = q.eq('responsavel_id', req.usuario.id);
      if (busca) q = q.or(`nome.ilike.%${busca}%,email.ilike.%${busca}%,telefone.ilike.%${busca}%,empresa.ilike.%${busca}%`);
      // Exclui soft-deleted (apenas se coluna existir — silencioso)
      q = q.is('deleted_at', null);

      q = q.order('criado_em', { ascending: false });

      const { data, error } = await q;
      if (error) throw error;

      const leads = (data || []).map(l => ({
        ...normalizeLead(l),
        responsavel_nome: l.responsavel?.nome || null,
        etapa_nome:  l.etapa?.nome  || null,
        etapa_cor:   l.etapa?.cor   || null,
        funil_nome:  l.funil?.nome  || null,
        funil_id_real: l.funil_id   || null,
      }));
      return res.json({ sucesso:true, dados:leads, total:leads.length });
    }

    // SQLite
    let sql = `SELECT l.*, u.nome as responsavel_nome, e.nome as etapa_nome, e.cor as etapa_cor,
      f.nome as funil_nome, f.id as funil_id_real
      FROM leads l
      LEFT JOIN usuarios u ON l.responsavel_id=u.id
      LEFT JOIN etapas e ON l.etapa_id=e.id
      LEFT JOIN pipelines p ON l.pipeline_id=p.id
      LEFT JOIN funis f ON p.funil_id=f.id
      WHERE 1=1`;
    const params = [];
    if (funil_id)       { sql += ' AND p.funil_id=?';       params.push(funil_id); }
    if (etapa_id)       { sql += ' AND l.etapa_id=?';       params.push(etapa_id); }
    if (status)         { sql += ' AND l.status=?';          params.push(status); }
    if (responsavel_id) { sql += ' AND l.responsavel_id=?'; params.push(responsavel_id); }
    if (req.usuario.role === 'VENDEDOR') { sql += ' AND l.responsavel_id=?'; params.push(req.usuario.id); }
    if (busca) { sql += ' AND (l.nome LIKE ? OR l.email LIKE ? OR l.telefone LIKE ? OR l.empresa LIKE ?)'; const q=`%${busca}%`; params.push(q,q,q,q); }
    sql += ' ORDER BY l.criado_em DESC';
    const leads = sqlite.prepare(sql).all(...params);
    return res.json({ sucesso:true, dados:leads, total:leads.length });
  } catch(e) {
    console.error('[leads.listar]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── GET /api/leads/:id ────────────────────────────────────────────────────────
async function buscarPorId(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    if (isSupa) {
      const { data, error } = await sb.from('leads').select(`
        *, responsavel:usuarios!responsavel_id(id,nome), etapa:etapas!etapa_id(id,nome,cor)
      `).eq('id', req.params.id).single();
      if (error || !data) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
      if (req.usuario.role==='VENDEDOR' && data.responsavel_id !== req.usuario.id)
        return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
      const { data: msgs } = await sb.from('mensagens').select('*, autor:usuarios!usuario_id(nome)').eq('lead_id', req.params.id).order('criado_em');
      const mensagens = (msgs||[]).map(m=>({...m, conteudo:m.texto||m.conteudo||'', autor_nome:m.autor?.nome||'Sistema'}));
      return res.json({ sucesso:true, dados:{ ...normalizeLead(data), responsavel_nome:data.responsavel?.nome, etapa_nome:data.etapa?.nome, etapa_cor:data.etapa?.cor, mensagens } });
    }
    const lead = sqlite.prepare(`SELECT l.*, u.nome as responsavel_nome, e.nome as etapa_nome, e.cor as etapa_cor, f.nome as funil_nome
      FROM leads l LEFT JOIN usuarios u ON l.responsavel_id=u.id LEFT JOIN etapas e ON l.etapa_id=e.id
      LEFT JOIN pipelines p ON l.pipeline_id=p.id LEFT JOIN funis f ON p.funil_id=f.id WHERE l.id=?`).get(req.params.id);
    if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    if (req.usuario.role==='VENDEDOR' && lead.responsavel_id !== req.usuario.id) return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
    const mensagens = sqlite.prepare(`SELECT m.*, u.nome as autor_nome FROM mensagens m LEFT JOIN usuarios u ON m.usuario_id=u.id WHERE m.lead_id=? ORDER BY m.enviado_em`).all(req.params.id);
    return res.json({ sucesso:true, dados:{ ...lead, mensagens } });
  } catch(e) {
    console.error('[leads.buscarPorId]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── POST /api/leads ───────────────────────────────────────────────────────────
async function criar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { nome, email, telefone, empresa, cargo, valor, pipeline_id, etapa_id,
          responsavel_id, origem, tags, dados_extras, observacoes, funil_id } = req.body;
  if (!nome) return res.status(400).json({ sucesso:false, erro:'Nome é obrigatório.' });

  // Rodízio automático:
  // - VENDEDOR: sempre recebe seus próprios leads
  // - GESTOR/ADMIN criando com responsavel_id explícito: respeita a escolha
  // - GESTOR/ADMIN sem responsavel_id: ativa rodízio entre vendedores ativos
  let respId;
  if (req.usuario.role === 'VENDEDOR') {
    respId = req.usuario.id;
  } else if (responsavel_id) {
    respId = responsavel_id;
  } else {
    // Rodízio automático via Supabase (não funciona em SQLite — fallback para admin)
    respId = (await _proximoVendedorRodizio(sb)) || req.usuario.id;
  }
  const id = crypto.randomBytes(16).toString('hex');

  try {
    if (isSupa) {
      // Determina funil_id: do body, ou via pipeline_id→funis
      let fId = funil_id || null;
      if (!fId && pipeline_id) {
        const { data: p } = await sb.from('pipelines').select('funil_id').eq('id', pipeline_id).single();
        if (p) fId = p.funil_id;
      }

      const row = {
        id,
        nome: nome.trim(),
        email:          email        || null,
        telefone:       telefone     || null,
        empresa:        empresa      || null,
        cargo:          cargo        || null,
        valor:          valor        || 0,
        funil_id:       fId          || null,
        etapa_id:       etapa_id     || null,
        responsavel_id: respId,
        origem:         origem       || 'manual',
        status:         'ativo',      // sempre ABERTO para novo lead
        observacoes:    observacoes  || null,
        criado_em:      new Date().toISOString(),
        atualizado_em:  new Date().toISOString(),
      };

      const { data, error } = await sb.from('leads').insert(row).select().single();
      if (error) throw error;
      // observacoes salva diretamente em leads.observacoes — nao duplicar em mensagens
      req.log({ acao:'CREATE', entidade:'leads', entidade_id:id, depois:{ nome, etapa_id, funil_id:fId } });
      // Dispara SLA Contato 1 de forma assíncrona (não bloqueia resposta)
      setImmediate(() => {
        getAutomacaoSvc().enviarSlaContato1({ id, nome: nome.trim(), telefone: telefone || null, responsavel_id: respId })
          .catch(e => console.error('[SLA_CONTATO_1]', e.message));
      });
      return res.status(201).json({ sucesso:true, dados: normalizeLead(data) });
    }

    // SQLite
    sqlite.prepare(`INSERT INTO leads (id,nome,email,telefone,empresa,cargo,valor,pipeline_id,etapa_id,responsavel_id,origem,tags,dados_extras,observacoes,status,criado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ABERTO',?)`).run(
      id, nome.trim(), email||null, telefone||null, empresa||null, cargo||null,
      valor||0, pipeline_id||null, etapa_id||null, respId, origem||null,
      tags ? JSON.stringify(tags) : null,
      dados_extras ? JSON.stringify(dados_extras) : null,
      observacoes||null,
      req.usuario.id
    );
    // observacoes salva em leads.observacoes — nao duplicar em mensagens
    req.log({ acao:'CREATE', entidade:'leads', entidade_id:id, depois:{ nome, pipeline_id, etapa_id } });
    // Dispara SLA Contato 1 de forma assíncrona
    setImmediate(() => {
      getAutomacaoSvc().enviarSlaContato1({ id, nome: nome.trim(), telefone: telefone || null, responsavel_id: respId })
        .catch(e => console.error('[SLA_CONTATO_1]', e.message));
    });
    return res.status(201).json({ sucesso:true, dados: sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id) });
  } catch(e) {
    console.error('[leads.criar]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── PATCH /api/leads/:id ──────────────────────────────────────────────────────
async function atualizar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  try {
    if (isSupa) {
      const { data: atual, error: errAtual } = await sb.from('leads').select('*').eq('id', id).single();
      if (errAtual || !atual) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
      if (req.usuario.role==='VENDEDOR' && atual.responsavel_id !== req.usuario.id) return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

      const allow = [
        'nome','email','telefone','empresa','cargo','valor','origem','data_fechamento',
        'observacoes','motivo_perda','dados_extras','valor_venda','forma_pagamento',
        'quantidade_parcelas','parcelas_json','produto_id','produto_nome','produto_cor',
        'previsao_proxima_compra',
        'motivo_perda','observacoes','funil_id','etapa_id','pipeline_id',
        // campos comerciais da venda
        'valor_venda','forma_pagamento','quantidade_parcelas','parcelas_json',
        'produto_id','produto_nome','produto_cor',
      ];
      const upd = { atualizado_em: new Date().toISOString() };
      allow.forEach(k => { if (req.body[k] !== undefined) upd[k] = req.body[k]; });
      if (req.body.responsavel_id && req.usuario.role !== 'VENDEDOR') upd.responsavel_id = req.body.responsavel_id;

      // Bloqueia se etapa destino é de ganho e campos obrigatórios faltam
      if (req.body.etapa_id && req.body.etapa_id !== atual.etapa_id) {
        const { data: etDest } = await sb.from('etapas').select('*').eq('id', req.body.etapa_id).maybeSingle();
        const etIsGanho = etDest?.is_ganho || etDest?.probabilidade >= 100 ||
          /venda|vendas|ganho|fechad|fechamento/i.test(etDest?.nome || '');
        if (etIsGanho) {
          const faltando = [];
          if (!(req.body.email || atual.email))                                    faltando.push('E-mail');
          if (!(req.body.funil_id || atual.funil_id))                              faltando.push('Funil');
          if (!((req.body.valor_venda ?? atual.valor_venda) > 0))                  faltando.push('Valor da Venda');
          if (!(req.body.forma_pagamento || atual.forma_pagamento))                faltando.push('Forma de Pagamento');
          if (!(req.body.produto_id || atual.produto_id || req.body.produto_nome || atual.produto_nome)) faltando.push('Produto Adquirido');
          if (faltando.length)
            return res.status(400).json({ sucesso: false, erro: `Para registrar a venda, preencha: ${faltando.join(', ')}.`, campos_faltando: faltando });
        }
      }

      const { data, error } = await sb.from('leads').update(upd).eq('id', id).select().single();
      if (error) throw error;
      return res.json({ sucesso:true, dados: normalizeLead(data) });
    }

    // SQLite
    const atual = sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id);
    if (!atual) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    if (req.usuario.role==='VENDEDOR' && atual.responsavel_id !== req.usuario.id) return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
    const campos = {};
    ['nome','email','telefone','empresa','cargo','valor','origem','data_fechamento','motivo_perda','dados_extras','previsao_proxima_compra'].forEach(k => { if (req.body[k] !== undefined) campos[k] = req.body[k]; });
    if (req.body.tags !== undefined) campos.tags = JSON.stringify(req.body.tags);
    if (req.body.responsavel_id && req.usuario.role !== 'VENDEDOR') campos.responsavel_id = req.body.responsavel_id;
    campos.atualizado_em = new Date().toISOString();
    const sets = Object.keys(campos).map(k=>`${k}=?`).join(',');
    sqlite.prepare(`UPDATE leads SET ${sets} WHERE id=?`).run(...Object.values(campos), id);
    return res.json({ sucesso:true, dados: sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id) });
  } catch(e) {
    console.error('[leads.atualizar]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── Clona lead ganho para o funil Carteira Recorrente ────────────────────────
// Idempotência: cria apenas se não existir clone ativo para o mesmo lead + previsão
async function _clonarParaCarteiraRecorrente(sb, isSupa, sqlite, leadData, previsao, usuarioId) {
  try {
    const nomeEtapa = PREVISAO_ETAPA_CARTEIRA[previsao];
    if (!nomeEtapa) {
      console.warn('[CARTEIRA_RECORRENTE] Previsão desconhecida:', previsao);
      return;
    }

    const crypto = require('crypto');
    const agr = new Date().toISOString();
    const leadOrigId = leadData.id;

    if (isSupa && sb) {
      // Verifica se já existe clone ativo com a mesma previsão
      const { data: dupCheck } = await sb.from('leads')
        .select('id')
        .eq('lead_original_id', leadOrigId)
        .eq('previsao_proxima_compra', previsao)
        .eq('tipo_clone', 'carteira_recorrente')
        .neq('status', 'PERDIDO')
        .limit(1);
      if (dupCheck?.length) {
        console.log('[CARTEIRA_RECORRENTE] Clone já existe, ignorando.', dupCheck[0].id);
        return;
      }

      // Busca funil Carteira Recorrente
      const { data: funisCarteiraList } = await sb.from('funis')
        .select('id')
        .ilike('nome', '%Carteira Recorrente%')
        .eq('ativo', 1)
        .limit(1);
      const funilCartId = funisCarteiraList?.[0]?.id;
      if (!funilCartId) {
        console.warn('[CARTEIRA_RECORRENTE] Funil "Carteira Recorrente" não encontrado.');
        return;
      }

      // Busca pipeline do funil
      const { data: pipes } = await sb.from('pipelines').select('id').eq('funil_id', funilCartId).limit(1);
      const pipeId = pipes?.[0]?.id;

      // Busca etapa pela nome
      let etapaId = null;
      if (pipeId) {
        const { data: etapas } = await sb.from('etapas').select('id,nome').eq('pipeline_id', pipeId);
        const etapaEnc = (etapas || []).find(e => e.nome === nomeEtapa);
        etapaId = etapaEnc?.id || null;
      }

      const novoId = crypto.randomBytes(16).toString('hex');
      await sb.from('leads').insert({
        id: novoId,
        nome: leadData.nome,
        empresa: leadData.empresa || null,
        email: leadData.email || null,
        telefone: leadData.telefone || null,
        responsavel_id: leadData.responsavel_id || null,
        funil_id: funilCartId,
        pipeline_id: pipeId || null,
        etapa_id: etapaId || null,
        status: 'ABERTO',
        valor: 0,
        previsao_proxima_compra: previsao,
        tipo_clone: 'carteira_recorrente',
        lead_original_id: leadOrigId,
        criado_em: agr,
        atualizado_em: agr,
      });
      console.log(`[CARTEIRA_RECORRENTE] ✅ Clone criado: ${novoId} | Etapa: ${nomeEtapa}`);
    } else if (sqlite) {
      const { getDb } = require('../database/db');
      const db = getDb();

      // Idempotência SQLite
      const dup = db.prepare(
        `SELECT id FROM leads WHERE lead_original_id=? AND previsao_proxima_compra=? AND tipo_clone='carteira_recorrente' AND status!='PERDIDO' LIMIT 1`
      ).get(leadOrigId, previsao);
      if (dup) {
        console.log('[CARTEIRA_RECORRENTE] Clone já existe (SQLite):', dup.id);
        return;
      }

      // Busca funil
      const funilCart = db.prepare(`SELECT id FROM funis WHERE nome LIKE '%Carteira Recorrente%' AND ativo=1 LIMIT 1`).get();
      if (!funilCart) {
        console.warn('[CARTEIRA_RECORRENTE] Funil não encontrado (SQLite).');
        return;
      }
      const pipeRec = db.prepare(`SELECT id FROM pipelines WHERE funil_id=? LIMIT 1`).get(funilCart.id);
      let etapaCR = null;
      if (pipeRec) {
        etapaCR = db.prepare(`SELECT id FROM etapas WHERE pipeline_id=? AND nome=? LIMIT 1`).get(pipeRec.id, nomeEtapa);
      }

      const novoId = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO leads (id,nome,empresa,email,telefone,responsavel_id,funil_id,pipeline_id,etapa_id,status,
          valor,previsao_proxima_compra,tipo_clone,lead_original_id,criado_em,atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        novoId, leadData.nome, leadData.empresa||null, leadData.email||null, leadData.telefone||null,
        leadData.responsavel_id||null, funilCart.id, pipeRec?.id||null, etapaCR?.id||null, 'ABERTO',
        0, previsao, 'carteira_recorrente', leadOrigId, agr, agr
      );
      console.log(`[CARTEIRA_RECORRENTE] ✅ Clone criado (SQLite): ${novoId} | Etapa: ${nomeEtapa}`);
    }
  } catch(e) {
    console.error('[CARTEIRA_RECORRENTE] Erro ao clonar:', e.message);
  }
}

// ── PATCH /api/leads/:id/mover ────────────────────────────────────────────────
async function mover(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  const { etapa_id, pipeline_id, motivo_perda } = req.body;
  if (!etapa_id) return res.status(400).json({ sucesso:false, erro:'etapa_id é obrigatório.' });

  try {
    if (isSupa) {
      const { data: lead, error: errL } = await sb.from('leads').select('*').eq('id', id).single();
      if (errL || !lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
      if (req.usuario.role==='VENDEDOR' && lead.responsavel_id !== req.usuario.id) return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

      const { data: etapa, error: errE } = await sb.from('etapas').select('*').eq('id', etapa_id).single();
      if (errE || !etapa) return res.status(404).json({ sucesso:false, erro:'Etapa não encontrada.' });

      const isGanho   = etapa.is_ganho   || etapa.nome?.toLowerCase().includes('venda') || etapa.probabilidade >= 100;
      const isPerdido = etapa.is_perdido  || etapa.nome?.toLowerCase().includes('perdid') || etapa.nome?.toLowerCase().includes('desqualif');

      if (isPerdido && !motivo_perda && !lead.perdido_motivo && !lead.motivo_perda)
        return res.status(400).json({ sucesso:false, erro:'motivo_perda é obrigatório ao mover para etapa perdida.' });

      // Validação obrigatória para etapa de ganho
      if (isGanho) {
        const faltando = [];
        if (!lead.nome)                              faltando.push('Nome');
        if (!lead.email)                             faltando.push('Email');
        if (!(lead.funil_id || req.body.funil_id))   faltando.push('Funil');
        const vv = req.body.valor_venda ?? lead.valor_venda;
        if (!vv || Number(vv) <= 0)                  faltando.push('Valor da Venda');
        const fp = req.body.forma_pagamento ?? lead.forma_pagamento;
        if (!fp)                                     faltando.push('Forma de Pagamento');
        const pid = req.body.produto_id ?? lead.produto_id;
        const pnm = req.body.produto_nome ?? lead.produto_nome;
        if (!pid && !pnm)                            faltando.push('Produto Adquirido');
        // Previsão de próxima compra — obrigatória ao ganhar venda
        const previsao = req.body.previsao_proxima_compra ?? lead.previsao_proxima_compra;
        if (!previsao)                               faltando.push('Previsão de Próxima Compra');
        if (faltando.length > 0)
          return res.status(400).json({
            sucesso: false,
            erro: `Para registrar a venda, preencha: ${faltando.join(', ')}.`,
            campos_faltando: faltando,
          });
      }

      const novoStatus = isGanho ? 'ganho' : isPerdido ? 'perdido' : 'ativo';
      const agora = new Date().toISOString();
      // Resolve funil_id e pipeline_id a partir da etapa se não vierem no body
      let funilIdUpd = req.body.funil_id || lead.funil_id || null;
      if (!funilIdUpd && etapa.funil_id) funilIdUpd = etapa.funil_id;
      const upd = { etapa_id, atualizado_em: agora, status: novoStatus, etapa_atualizada_em: agora };
      if (funilIdUpd) upd.funil_id = funilIdUpd;
      if (pipeline_id) upd.pipeline_id = pipeline_id;
      if (isGanho && !lead.ganho_em) upd.ganho_em = agora;
      if (isPerdido && motivo_perda) { upd.perdido_em = agora; upd.perdido_motivo = motivo_perda; upd.motivo_perda = motivo_perda; }
      // Salva campos comerciais ao mover para ganho
      const previsaoProxima = req.body.previsao_proxima_compra ?? lead.previsao_proxima_compra ?? null;
      if (isGanho) {
        if (req.body.valor_venda  !== undefined) upd.valor_venda       = req.body.valor_venda;
        if (req.body.forma_pagamento)            upd.forma_pagamento   = req.body.forma_pagamento;
        if (req.body.quantidade_parcelas)        upd.quantidade_parcelas = req.body.quantidade_parcelas;
        if (req.body.parcelas_json !== undefined) upd.parcelas_json    = req.body.parcelas_json;
        if (req.body.produto_id)                 upd.produto_id        = req.body.produto_id;
        if (req.body.produto_nome)               upd.produto_nome      = req.body.produto_nome;
        if (req.body.produto_cor)                upd.produto_cor       = req.body.produto_cor;
        if (previsaoProxima)                     upd.previsao_proxima_compra = previsaoProxima;
        // Calcula data_prevista_proxima_compra e alerta 7 dias antes
        if (previsaoProxima && PREVISAO_DIAS[previsaoProxima]) {
          const dppc = new Date();
          dppc.setDate(dppc.getDate() + PREVISAO_DIAS[previsaoProxima]);
          upd.data_prevista_proxima_compra = dppc.toISOString().slice(0,10);
          const alerta = new Date(dppc);
          alerta.setDate(alerta.getDate() - 7);
          upd.alerta_recompra_em = alerta.toISOString().slice(0,10);
          upd.alerta_recompra_enviado = 0;
        }
      }

      const { data, error } = await sb.from('leads').update(upd).eq('id', id).select().single();
      if (error) throw error;

      // Comissão automática ao ganhar — usa valor_venda (campo da venda) ou valor como fallback
      const valorVendaGanho = Number(req.body.valor_venda ?? lead.valor_venda ?? lead.valor ?? 0);
      if (isGanho && lead.responsavel_id && valorVendaGanho > 0) {
        // Passa lead enriquecido com valor_venda atualizado
        const leadParaComissao = { ...lead, valor_venda: valorVendaGanho, funil_id: funilIdUpd || lead.funil_id };
        calcularComissaoSupabase(sb, leadParaComissao, req).catch(e => console.error('[COMISSAO_AUTO]', e.message));
      }

      req.log({ acao:'MOVER', entidade:'leads', entidade_id:id, antes:{ etapa_id:lead.etapa_id, status:lead.status }, depois:{ etapa_id, status:novoStatus } });

      // ── Pós-ganho: clonagem Adm Vendas + Carteira Recorrente ──────────────────
      if (isGanho) {
        const leadGanho = { ...lead, ...upd };
        // 1. Clone para Administração de Vendas
        try {
          console.log('[ADM_VENDAS_CLONE_TRIGGER_START] lead:', id);
          const admRes = await getAdmVendasCtrl().clonarDeLeadGanho(leadGanho, lead.responsavel_id, sb, isSupa, null);
          if (admRes.criado) console.log('[ADM_VENDAS_CLONE_TRIGGER_SUCCESS] card:', admRes.id);
          else if (!admRes.sucesso) console.warn('[ADM_VENDAS_CLONE_TRIGGER_ERROR]', admRes.erro);
          else console.log('[ADM_VENDAS_CLONE_TRIGGER_SKIP_DUPLICATE] card:', admRes.id);
        } catch(eAdm) { console.error('[ADM_VENDAS_CLONE_TRIGGER_ERROR]', eAdm.message); }

        // 2. Clone para Carteira Recorrente (loop de recompra)
        if (previsaoProxima) {
          try {
            await _clonarParaCarteiraRecorrente(sb, isSupa, null, leadGanho, previsaoProxima, req.usuario?.id);
          } catch(eCr) { console.error('[CARTEIRA_RECORRENTE_CLONE_ERROR]', eCr.message); }
        }
      }

      return res.json({ sucesso:true, dados: normalizeLead(data) });
    }

    // SQLite
    const lead = sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id);
    if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    if (req.usuario.role==='VENDEDOR' && lead.responsavel_id !== req.usuario.id) return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

    const etapa = sqlite.prepare('SELECT * FROM etapas WHERE id=?').get(etapa_id);
    if (!etapa) return res.status(404).json({ sucesso:false, erro:'Etapa não encontrada.' });

    if (etapa.is_perdido && !motivo_perda && !lead.motivo_perda)
      return res.status(400).json({ sucesso:false, erro:'motivo_perda é obrigatório ao mover para etapa perdida.' });

    const novoStatus = etapa.is_ganho ? 'GANHO' : etapa.is_perdido ? 'PERDIDO' : 'ABERTO';
    const agora = new Date().toISOString();
    const extras = {};
    if (etapa.is_ganho && !lead.data_fechamento) extras.data_fechamento = agora.slice(0,10);
    if (etapa.is_perdido && motivo_perda) extras.motivo_perda = motivo_perda;
    extras.etapa_atualizada_em = agora; // rastreia entrada na etapa
    // Previsão de próxima compra (Carteira Recorrente)
    const previsaoProxSql = req.body.previsao_proxima_compra ?? lead.previsao_proxima_compra ?? null;
    if (etapa.is_ganho && previsaoProxSql) {
      extras.previsao_proxima_compra = previsaoProxSql;
      if (PREVISAO_DIAS[previsaoProxSql]) {
        const dppc = new Date();
        dppc.setDate(dppc.getDate() + PREVISAO_DIAS[previsaoProxSql]);
        extras.data_prevista_proxima_compra = dppc.toISOString().slice(0,10);
        const alerta = new Date(dppc);
        alerta.setDate(alerta.getDate() - 7);
        extras.alerta_recompra_em = alerta.toISOString().slice(0,10);
        extras.alerta_recompra_enviado = 0;
      }
    }
    const extraSets = Object.keys(extras).map(k=>`${k}=?`).join(',');
    sqlite.prepare(`UPDATE leads SET etapa_id=?, pipeline_id=COALESCE(?,pipeline_id), status=?, atualizado_em=?${extraSets?','+extraSets:''} WHERE id=?`).run(etapa_id, pipeline_id||null, novoStatus, agora, ...Object.values(extras), id);

    req.log({ acao:'MOVER', entidade:'leads', entidade_id:id, antes:{ etapa_id:lead.etapa_id }, depois:{ etapa_id, status:novoStatus } });

    const valorVendaGanhoSql = Number(lead.valor_venda ?? lead.valor ?? 0);
    if (etapa.is_ganho && lead.responsavel_id && valorVendaGanhoSql > 0) {
      try { calcularComissaoSQLite(sqlite, lead, id, pipeline_id, agora, req); } catch(e) { console.error('[COMISSAO_AUTO]', e.message); }
    }

    // ── Pós-ganho: clonagem Adm Vendas + Carteira Recorrente ──────────────────
    if (etapa.is_ganho) {
      const { getDb } = require('../database/db');
      const db = getDb();
      const leadAtual = db.prepare('SELECT * FROM leads WHERE id=?').get(id);
      // 1. Clone para Administração de Vendas
      try {
        console.log('[ADM_VENDAS_CLONE_TRIGGER_START] lead:', id);
        const admRes = await getAdmVendasCtrl().clonarDeLeadGanho(leadAtual || lead, lead.responsavel_id, null, false, sqlite);
        if (admRes.criado) console.log('[ADM_VENDAS_CLONE_TRIGGER_SUCCESS] card:', admRes.id);
        else if (!admRes.sucesso) console.warn('[ADM_VENDAS_CLONE_TRIGGER_ERROR]', admRes.erro);
        else console.log('[ADM_VENDAS_CLONE_TRIGGER_SKIP_DUPLICATE] card:', admRes.id);
      } catch(eAdm) { console.error('[ADM_VENDAS_CLONE_TRIGGER_ERROR]', eAdm.message); }

      // 2. Clone para Carteira Recorrente
      if (previsaoProxSql) {
        try {
          await _clonarParaCarteiraRecorrente(null, false, sqlite, leadAtual || lead, previsaoProxSql, req.usuario?.id);
        } catch(eCr) { console.error('[CARTEIRA_RECORRENTE_CLONE_ERROR]', eCr.message); }
      }
    }

    return res.json({ sucesso:true, dados: sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id) });
  } catch(e) {
    console.error('[leads.mover]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── PATCH /api/leads/:id/transferir ──────────────────────────────────────────
async function transferir(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  if (req.usuario.role==='VENDEDOR') return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });
  const { responsavel_id } = req.body;
  if (!responsavel_id) return res.status(400).json({ sucesso:false, erro:'responsavel_id é obrigatório.' });
  try {
    if (isSupa) {
      const { data, error } = await sb.from('leads').update({ responsavel_id, atualizado_em: new Date().toISOString() }).eq('id', req.params.id).select().single();
      if (error) throw error;
      return res.json({ sucesso:true, dados: normalizeLead(data) });
    }
    sqlite.prepare('UPDATE leads SET responsavel_id=?, atualizado_em=? WHERE id=?').run(responsavel_id, new Date().toISOString(), req.params.id);
    return res.json({ sucesso:true, dados: sqlite.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id) });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// ── DELETE /api/leads/:id ─────────────────────────────────────────────────────
async function deletar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  // Somente SUPER_ADMIN pode excluir leads
  if (req.usuario.role !== 'SUPER_ADMIN') return res.status(403).json({ sucesso:false, erro:'Apenas o Super Admin pode excluir leads.' });
  const agora = new Date().toISOString();
  try {
    if (isSupa) {
      const { data: lead, error: errBusca } = await sb.from('leads').select('*').eq('id', req.params.id).single();
      if (errBusca || !lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
      if (lead.deleted_at) return res.status(400).json({ sucesso:false, erro:'Lead já está na lixeira.' });
      const { error } = await sb.from('leads').update({
        deleted_at: agora,
        deleted_by: req.usuario.id,
        atualizado_em: agora,
      }).eq('id', req.params.id);
      if (error) throw error;
      req.log({ acao:'DELETE', entidade:'leads', entidade_id:req.params.id, antes:lead, depois:{ deleted_at:agora, deleted_by:req.usuario.id } });
      return res.json({ sucesso:true, mensagem:'Lead movido para a lixeira. Use /admin/restore para recuperar.' });
    }
    // SQLite: soft delete se a coluna existir, senão DELETE físico como fallback seguro
    const lead = sqlite.prepare('SELECT * FROM leads WHERE id=?').get(req.params.id);
    if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    try {
      sqlite.prepare('UPDATE leads SET deleted_at=?, deleted_by=?, atualizado_em=? WHERE id=?').run(agora, req.usuario.id, agora, req.params.id);
    } catch {
      // Coluna deleted_at não existe ainda no SQLite — usa DELETE físico (migration pendente)
      sqlite.prepare('DELETE FROM leads WHERE id=?').run(req.params.id);
    }
    return res.json({ sucesso:true, mensagem:'Lead excluído.' });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// ── POST /api/leads/:id/mensagens ─────────────────────────────────────────────
async function adicionarMensagem(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { conteudo, tipo='NOTA' } = req.body;
  if (!conteudo) return res.status(400).json({ sucesso:false, erro:'Conteúdo é obrigatório.' });
  const id = crypto.randomBytes(16).toString('hex');
  try {
    if (isSupa) {
      const { data, error } = await sb.from('mensagens').insert({ id, lead_id:req.params.id, usuario_id:req.usuario.id, texto:conteudo, tipo:tipo.toLowerCase() }).select('*, autor:usuarios!usuario_id(nome)').single();
      if (error) throw error;
      return res.status(201).json({ sucesso:true, dados:{ ...data, autor_nome: data.autor?.nome||'Sistema' } });
    }
    sqlite.prepare(`INSERT INTO mensagens (id,lead_id,usuario_id,tipo,conteudo) VALUES (?,?,?,?,?)`).run(id, req.params.id, req.usuario.id, tipo, conteudo);
    const msg = sqlite.prepare(`SELECT m.*, u.nome as autor_nome FROM mensagens m LEFT JOIN usuarios u ON m.usuario_id=u.id WHERE m.id=?`).get(id);
    return res.status(201).json({ sucesso:true, dados:msg });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// ── Distribuição ──────────────────────────────────────────────────────────────
async function getDistribuicao(req, res) {
  const { sqlite, isSupa } = getProvider();
  if (isSupa) return res.json({ sucesso:true, dados:{ modo:'MANUAL', pesos:[] } });
  let cfg = sqlite.prepare("SELECT * FROM automacoes WHERE trigger_tipo='DISTRIBUICAO' LIMIT 1").get();
  if (!cfg) return res.json({ sucesso:true, dados:{ modo:'MANUAL', pesos:[] } });
  return res.json({ sucesso:true, dados:{ ...JSON.parse(cfg.acao_config||'{}'), id:cfg.id } });
}

async function setDistribuicao(req, res) {
  const { sqlite, isSupa } = getProvider();
  if (isSupa) return res.json({ sucesso:true, mensagem:'Configuração salva.' });
  const { modo='MANUAL', pesos=[] } = req.body;
  const config = JSON.stringify({ modo, pesos });
  let existente = sqlite.prepare("SELECT id FROM automacoes WHERE trigger_tipo='DISTRIBUICAO' LIMIT 1").get();
  if (existente) { sqlite.prepare("UPDATE automacoes SET acao_config=? WHERE id=?").run(config, existente.id); }
  else { const id = crypto.randomBytes(16).toString('hex'); sqlite.prepare(`INSERT INTO automacoes (id,nome,trigger_tipo,acao_tipo,acao_config,criado_por) VALUES (?,?,?,?,?,?)`).run(id,'Distribuição de Leads','DISTRIBUICAO','DISTRIBUIR',config,req.usuario.id); }
  return res.json({ sucesso:true, mensagem:'Configuração salva.' });
}

// ── Comissão automática Supabase ──────────────────────────────────────────────
async function calcularComissaoSupabase(sb, lead, req) {
  const mesRef = new Date().toISOString().slice(0,7);
  const { data: regras } = await sb.from('comissao_regras').select('*').eq('ativo', 1).or(`usuario_id.is.null,usuario_id.eq.${lead.responsavel_id}`).order('valor_min', { ascending:true });
  if (!regras?.length) return;
  const valorVenda = Number(lead.valor_venda ?? lead.valor ?? 0);
  if (!valorVenda) return;
  // Filtra por funil se disponível, depois seleciona a faixa correta
  const regrasVend = regras.filter(r => (!r.funil_id || r.funil_id === lead.funil_id));
  const faixas = regrasVend.length ? regrasVend : regras;
  let regra = faixas[0];
  for (const r of faixas) { if (valorVenda >= (r.valor_min||0)) regra = r; }
  const comissaoBase = regra.tipo_calculo === 'PERCENTUAL' ? valorVenda * (regra.percentual||0)/100 : (regra.valor_fixo||0);
  const comId = crypto.randomBytes(16).toString('hex');
  await sb.from('comissoes').insert({ id:comId, usuario_id:lead.responsavel_id, lead_id:lead.id, valor_venda:valorVenda, percentual:valorVenda>0?(comissaoBase/valorVenda)*100:0, valor_comissao:comissaoBase, status:'PENDENTE', periodo_ref:mesRef });
}

// ── Comissão automática SQLite ────────────────────────────────────────────────
function calcularComissaoSQLite(db, lead, leadId, pipeline_id, agora, req) {
  const valorVenda = Number(lead.valor_venda ?? lead.valor ?? 0);
  if (!valorVenda) return;
  const mesRef = agora.slice(0,7);
  const pipelineInfo = db.prepare(`SELECT p.funil_id FROM pipelines p WHERE p.id=?`).get(pipeline_id||lead.pipeline_id);
  const regras = db.prepare(`SELECT * FROM comissao_regras WHERE ativo=1 AND (usuario_id IS NULL OR usuario_id=?) AND (funil_id IS NULL OR funil_id=?) ORDER BY valor_min ASC`).all(lead.responsavel_id, pipelineInfo?.funil_id||'');
  let regra = regras[0] || null;
  for (const r of regras) { if (valorVenda >= (r.valor_min||0)) regra = r; }
  if (!regra) return;
  const comissaoBase = regra.tipo_calculo === 'PERCENTUAL' ? valorVenda * (regra.percentual||0)/100 : (regra.valor_fixo||0);
  const comId = require('crypto').randomBytes(16).toString('hex');
  db.prepare(`INSERT OR IGNORE INTO comissoes (id,usuario_id,lead_id,valor_venda,percentual,valor_comissao,status,periodo_ref,observacoes) VALUES (?,?,?,?,?,?,'PENDENTE',?,?)`).run(comId, lead.responsavel_id, leadId, valorVenda, valorVenda>0?(comissaoBase/valorVenda)*100:0, comissaoBase, mesRef, `Regra: ${regra.nome}`);
}

// GET /api/leads/:id/historico
async function historico(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const leadId = req.params.id;
  try {
    let notas = [];
    let logs  = [];

    if (isSupa) {
      // Dado do lead para evento retroativo
      const { data: lead } = await sb.from('leads').select('criado_em,nome').eq('id', leadId).maybeSingle();

      // Notas
      const { data: msgs } = await sb.from('mensagens').select('*, autor:usuarios!usuario_id(nome)').eq('lead_id', leadId).order('criado_em');
      notas = (msgs||[]).map(m => ({
        id: m.id, tipo: 'NOTA', acao: 'NOTA',
        icone: '📝', titulo: 'Nota adicionada',
        conteudo: m.texto || m.conteudo || '',
        autor_nome: m.autor?.nome || 'Sistema',
        criado_em: m.criado_em,
      }));

      // Logs de auditoria
      const { data: lgData } = await sb.from('logs').select('*').eq('entidade_id', leadId).order('criado_em');

      // Resolve nomes de etapas para MOVER
      const etapaIds = [...new Set((lgData||[])
        .flatMap(l => [_parseSafe(l.depois).etapa_id, _parseSafe(l.antes).etapa_id])
        .filter(Boolean))];
      let etapaMap = {};
      if (etapaIds.length) {
        const { data: etapas } = await sb.from('etapas').select('id,nome').in('id', etapaIds);
        etapaMap = Object.fromEntries((etapas||[]).map(e => [e.id, e.nome]));
      }

      logs = (lgData||[]).map(l => formatarLog(l, etapaMap));

      // Evento retroativo: Lead criado (se não houver log de criação)
      const temCreate = logs.some(l => l.acao === 'CREATE');
      if (!temCreate && lead) {
        logs.unshift({
          id: `retro-${leadId}`,
          tipo: 'LOG', acao: 'CREATE',
          icone: '🌱', titulo: 'Lead criado',
          conteudo: 'Lead registrado no CRM.',
          autor_nome: 'Sistema',
          criado_em: lead.criado_em,
        });
      }
    } else {
      notas = sqlite.prepare(`SELECT m.*, u.nome as autor_nome FROM mensagens m LEFT JOIN usuarios u ON m.usuario_id=u.id WHERE m.lead_id=? ORDER BY m.enviado_em`).all(leadId)
        .map(m => ({ ...m, tipo:'NOTA', acao:'NOTA', icone:'📝', titulo:'Nota adicionada' }));
      const lgRaw = sqlite.prepare(`SELECT l.*, u.nome as autor_nome FROM logs l LEFT JOIN usuarios u ON l.usuario_id=u.id WHERE l.entidade_id=? ORDER BY l.criado_em`).all(leadId);
      // Mapeia etapas
      const eIds = [...new Set(lgRaw.flatMap(l => [_parseSafe(l.depois).etapa_id, _parseSafe(l.antes).etapa_id]).filter(Boolean))];
      let etapaMap = {};
      if (eIds.length) {
        const rows = sqlite.prepare(`SELECT id, nome FROM etapas WHERE id IN (${eIds.map(()=>'?').join(',')}) `).all(...eIds);
        etapaMap = Object.fromEntries(rows.map(e => [e.id, e.nome]));
      }
      logs = lgRaw.map(l => formatarLog(l, etapaMap));
    }

    const todos = [...notas, ...logs].sort((a,b) => new Date(a.criado_em) - new Date(b.criado_em));
    return res.json({ sucesso:true, dados:todos });
  } catch(e) {
    console.error('[leads.historico]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── Helper: recalcula valor_venda do lead pela soma dos produtos ativos ────────
async function recalcularValorVenda(leadId, sb, isSupa, sqlite) {
  try {
    if (isSupa) {
      const { data: itens } = await sb.from('lead_produtos')
        .select('valor_total').eq('lead_id', leadId).is('deleted_at', null);
      const soma = (itens||[]).reduce((s, i) => s + Number(i.valor_total||0), 0);
      await sb.from('leads').update({ valor_venda: soma, atualizado_em: new Date().toISOString() }).eq('id', leadId);
      return soma;
    } else {
      try {
        const row = sqlite.prepare(
          `SELECT COALESCE(SUM(quantidade * valor_unitario),0) as soma FROM lead_produtos WHERE lead_id=? AND deleted_at IS NULL`
        ).get(leadId);
        sqlite.prepare(`UPDATE leads SET valor_venda=?, atualizado_em=? WHERE id=?`).run(row.soma, new Date().toISOString(), leadId);
        return row.soma;
      } catch { return 0; }
    }
  } catch(e) { console.error('[recalcularValorVenda]', e.message); return 0; }
}

// ── GET /api/leads/:id/produtos ───────────────────────────────────────────────
async function listarProdutosLead(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const leadId = req.params.id;
  try {
    if (isSupa) {
      const { data, error } = await sb.from('lead_produtos')
        .select('*').eq('lead_id', leadId).is('deleted_at', null).order('criado_em');
      if (error) throw error;
      return res.json({ sucesso: true, dados: data || [] });
    }
    try {
      const rows = sqlite.prepare(
        `SELECT * FROM lead_produtos WHERE lead_id=? AND deleted_at IS NULL ORDER BY criado_em`
      ).all(leadId);
      return res.json({ sucesso: true, dados: rows });
    } catch {
      return res.json({ sucesso: true, dados: [], aviso: 'Tabela lead_produtos não existe ainda no SQLite.' });
    }
  } catch(e) { return res.status(500).json({ sucesso: false, erro: e.message }); }
}

// ── POST /api/leads/:id/produtos ──────────────────────────────────────────────
async function adicionarProdutoLead(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const leadId = req.params.id;
  const { produto_id, produto_nome, produto_cor, quantidade = 1, valor_unitario = 0 } = req.body;

  if (!produto_nome) return res.status(400).json({ sucesso: false, erro: 'produto_nome é obrigatório.' });
  if (Number(quantidade) <= 0) return res.status(400).json({ sucesso: false, erro: 'quantidade deve ser maior que zero.' });

  const id    = require('crypto').randomBytes(16).toString('hex');
  const agora = new Date().toISOString();
  const qty   = Number(quantidade);
  const vUnit = Number(valor_unitario);
  const vTot  = Number((qty * vUnit).toFixed(2));

  try {
    if (isSupa) {
      // Verifica se o lead existe
      const { data: lead } = await sb.from('leads').select('id').eq('id', leadId).single();
      if (!lead) return res.status(404).json({ sucesso: false, erro: 'Lead não encontrado.' });

      const { data, error } = await sb.from('lead_produtos').insert({
        id, lead_id: leadId,
        produto_id:    produto_id    || null,
        produto_nome,
        produto_cor:   produto_cor   || null,
        quantidade:    qty,
        valor_unitario: vUnit,
        // valor_total é coluna GENERATED — não enviar
        criado_em:    agora,
        atualizado_em: agora,
      }).select().single();
      if (error) throw error;

      const novoTotal = await recalcularValorVenda(leadId, sb, isSupa, sqlite);
      req.log?.({ acao: 'ADD_PRODUTO', entidade: 'lead_produtos', entidade_id: leadId, depois: { produto_nome, quantidade: qty, valor_unitario: vUnit, valor_total: vTot } });
      return res.status(201).json({ sucesso: true, dados: data, valor_venda_lead: novoTotal });
    }

    // SQLite
    try {
      sqlite.prepare(
        `INSERT INTO lead_produtos (id,lead_id,produto_id,produto_nome,produto_cor,quantidade,valor_unitario,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(id, leadId, produto_id||null, produto_nome, produto_cor||null, qty, vUnit, agora, agora);
      const novoTotal = await recalcularValorVenda(leadId, sb, isSupa, sqlite);
      const row = sqlite.prepare(`SELECT * FROM lead_produtos WHERE id=?`).get(id);
      return res.status(201).json({ sucesso: true, dados: row, valor_venda_lead: novoTotal });
    } catch(e2) {
      return res.status(500).json({ sucesso: false, erro: e2.message, aviso: 'Execute supabase_patch_v6_lead_produtos.sql no banco.' });
    }
  } catch(e) { return res.status(500).json({ sucesso: false, erro: e.message }); }
}

// ── PATCH /api/leads/:id/produtos/:itemId ─────────────────────────────────────
async function atualizarProdutoLead(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id: leadId, itemId } = req.params;
  const { produto_id, produto_nome, produto_cor, quantidade, valor_unitario } = req.body;
  const agora = new Date().toISOString();

  try {
    if (isSupa) {
      const { data: atual } = await sb.from('lead_produtos').select('*').eq('id', itemId).eq('lead_id', leadId).single();
      if (!atual) return res.status(404).json({ sucesso: false, erro: 'Item não encontrado.' });
      if (atual.deleted_at) return res.status(400).json({ sucesso: false, erro: 'Item está removido da venda.' });

      const upd = { atualizado_em: agora };
      if (produto_id    !== undefined) upd.produto_id    = produto_id    || null;
      if (produto_nome  !== undefined) upd.produto_nome  = produto_nome;
      if (produto_cor   !== undefined) upd.produto_cor   = produto_cor   || null;
      if (quantidade    !== undefined) upd.quantidade    = Number(quantidade);
      if (valor_unitario !== undefined) upd.valor_unitario = Number(valor_unitario);
      // valor_total é GENERATED — não enviar

      const { data, error } = await sb.from('lead_produtos').update(upd).eq('id', itemId).select().single();
      if (error) throw error;

      const novoTotal = await recalcularValorVenda(leadId, sb, isSupa, sqlite);
      return res.json({ sucesso: true, dados: data, valor_venda_lead: novoTotal });
    }

    // SQLite
    try {
      const atual = sqlite.prepare(`SELECT * FROM lead_produtos WHERE id=? AND lead_id=?`).get(itemId, leadId);
      if (!atual) return res.status(404).json({ sucesso: false, erro: 'Item não encontrado.' });
      const sets = []; const vals = [];
      if (produto_id    !== undefined) { sets.push('produto_id=?');    vals.push(produto_id||null); }
      if (produto_nome  !== undefined) { sets.push('produto_nome=?');  vals.push(produto_nome); }
      if (produto_cor   !== undefined) { sets.push('produto_cor=?');   vals.push(produto_cor||null); }
      if (quantidade    !== undefined) { sets.push('quantidade=?');    vals.push(Number(quantidade)); }
      if (valor_unitario !== undefined) { sets.push('valor_unitario=?'); vals.push(Number(valor_unitario)); }
      sets.push('atualizado_em=?'); vals.push(agora);
      sqlite.prepare(`UPDATE lead_produtos SET ${sets.join(',')} WHERE id=?`).run(...vals, itemId);
      const novoTotal = await recalcularValorVenda(leadId, sb, isSupa, sqlite);
      return res.json({ sucesso: true, dados: sqlite.prepare(`SELECT * FROM lead_produtos WHERE id=?`).get(itemId), valor_venda_lead: novoTotal });
    } catch(e2) { return res.status(500).json({ sucesso: false, erro: e2.message }); }
  } catch(e) { return res.status(500).json({ sucesso: false, erro: e.message }); }
}

// ── DELETE /api/leads/:id/produtos/:itemId (soft delete) ──────────────────────
async function removerProdutoLead(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id: leadId, itemId } = req.params;
  const agora = new Date().toISOString();

  try {
    if (isSupa) {
      const { data: atual } = await sb.from('lead_produtos').select('id,deleted_at').eq('id', itemId).eq('lead_id', leadId).single();
      if (!atual) return res.status(404).json({ sucesso: false, erro: 'Item não encontrado.' });
      if (atual.deleted_at) return res.status(400).json({ sucesso: false, erro: 'Item já foi removido.' });

      const { error } = await sb.from('lead_produtos').update({ deleted_at: agora, atualizado_em: agora }).eq('id', itemId);
      if (error) throw error;

      const novoTotal = await recalcularValorVenda(leadId, sb, isSupa, sqlite);
      req.log?.({ acao: 'REMOVE_PRODUTO', entidade: 'lead_produtos', entidade_id: leadId, depois: { item_id: itemId, deleted_at: agora } });
      return res.json({ sucesso: true, mensagem: 'Produto removido da venda.', valor_venda_lead: novoTotal });
    }

    // SQLite
    try {
      sqlite.prepare(`UPDATE lead_produtos SET deleted_at=?, atualizado_em=? WHERE id=? AND lead_id=?`).run(agora, agora, itemId, leadId);
      const novoTotal = await recalcularValorVenda(leadId, sb, isSupa, sqlite);
      return res.json({ sucesso: true, mensagem: 'Produto removido da venda.', valor_venda_lead: novoTotal });
    } catch(e2) { return res.status(500).json({ sucesso: false, erro: e2.message }); }
  } catch(e) { return res.status(500).json({ sucesso: false, erro: e.message }); }
}

// ── POST /api/leads/:id/clonar ───────────────────────────────────────────────
async function clonar(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  const novoId = crypto.randomBytes(16).toString('hex');
  const agora  = new Date().toISOString();

  try {
    if (isSupa) {
      const { data: origem, error: errO } = await sb.from('leads').select('*').eq('id', id).single();
      if (errO || !origem) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
      // Permissão: vendedor só clona seus leads
      if (req.usuario.role === 'VENDEDOR' && origem.responsavel_id !== req.usuario.id)
        return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

      // Copia APENAS Dados Principais — zera tudo comercial/produção/histórico
      const clone = {
        id:             novoId,
        nome:           `${origem.nome} (Cópia)`,
        empresa:        origem.empresa        || null,
        telefone:       origem.telefone       || null,
        email:          origem.email          || null,
        funil_id:       origem.funil_id       || null,
        etapa_id:       origem.etapa_id       || null,
        pipeline_id:    origem.pipeline_id    || null,
        responsavel_id: origem.responsavel_id || null,
        status:         'ativo',
        origem:         'clone',
        valor:          0,
        // Zera campos comerciais
        valor_venda:          null,
        forma_pagamento:      null,
        quantidade_parcelas:  null,
        parcelas_json:        null,
        produto_id:           null,
        produto_nome:         null,
        produto_cor:          null,
        ganho_em:             null,
        perdido_em:           null,
        perdido_motivo:       null,
        motivo_perda:         null,
        data_fechamento:      null,
        tags:                 null,
        observacoes:          null,
        criado_em:            agora,
        atualizado_em:        agora,
      };

      const { data, error } = await sb.from('leads').insert(clone).select().single();
      if (error) throw error;
      req.log({ acao:'CLONE', entidade:'leads', entidade_id:novoId, depois:{ clonado_de:id, nome:clone.nome } });
      return res.status(201).json({ sucesso:true, dados: normalizeLead(data), mensagem:'Lead clonado com sucesso. Apenas Dados Principais copiados.' });
    }

    // SQLite
    const origem = sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id);
    if (!origem) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    if (req.usuario.role === 'VENDEDOR' && origem.responsavel_id !== req.usuario.id)
      return res.status(403).json({ sucesso:false, erro:'Acesso negado.' });

    sqlite.prepare(`INSERT INTO leads (id,nome,empresa,telefone,email,funil_id,etapa_id,pipeline_id,responsavel_id,status,origem,valor,criado_em,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,'ABERTO','clone',0,?,?)`).
      run(novoId, `${origem.nome} (Cópia)`, origem.empresa||null, origem.telefone||null,
          origem.email||null, origem.funil_id||null, origem.etapa_id||null,
          origem.pipeline_id||null, origem.responsavel_id||null, agora, agora);

    req.log({ acao:'CLONE', entidade:'leads', entidade_id:novoId, depois:{ clonado_de:id } });
    return res.status(201).json({ sucesso:true, dados: sqlite.prepare('SELECT * FROM leads WHERE id=?').get(novoId), mensagem:'Lead clonado com sucesso.' });
  } catch(e) {
    console.error('[leads.clonar]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── POST /api/leads/:id/tags ──────────────────────────────────────────────────
async function adicionarTag(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  const tagRaw = (req.body.tag || '').trim();
  if (!tagRaw) return res.status(400).json({ sucesso:false, erro:'tag é obrigatória.' });
  const tag = tagRaw.toLowerCase();
  try {
    if (isSupa) {
      const { data: lead } = await sb.from('leads').select('tags').eq('id', id).single();
      if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
      let tags = Array.isArray(lead.tags) ? lead.tags
        : (typeof lead.tags === 'string' ? (() => { try { return JSON.parse(lead.tags); } catch { return lead.tags.split(',').map(t=>t.trim()).filter(Boolean); } })() : []);
      if (tags.map(t=>t.toLowerCase()).includes(tag)) return res.status(409).json({ sucesso:false, erro:'Tag já existe neste lead.' });
      tags = [...tags, tag];
      const { error } = await sb.from('leads').update({ tags, atualizado_em: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      req.log({ acao:'TAG_ADD', entidade:'leads', entidade_id:id, depois:{ tag } });
      return res.json({ sucesso:true, dados:{ tags } });
    }
    const lead = sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id);
    if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    let tags = [];
    try { tags = lead.tags ? JSON.parse(lead.tags) : []; } catch { tags = []; }
    if (tags.map(t=>t.toLowerCase()).includes(tag)) return res.status(409).json({ sucesso:false, erro:'Tag já existe neste lead.' });
    tags = [...tags, tag];
    sqlite.prepare('UPDATE leads SET tags=?, atualizado_em=? WHERE id=?').run(JSON.stringify(tags), new Date().toISOString(), id);
    req.log({ acao:'TAG_ADD', entidade:'leads', entidade_id:id, depois:{ tag } });
    return res.json({ sucesso:true, dados:{ tags } });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

// ── DELETE /api/leads/:id/tags/:tag ───────────────────────────────────────────
async function removerTag(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  const tag = decodeURIComponent(req.params.tag || '').trim().toLowerCase();
  if (!tag) return res.status(400).json({ sucesso:false, erro:'tag é obrigatória.' });
  try {
    if (isSupa) {
      const { data: lead } = await sb.from('leads').select('tags').eq('id', id).single();
      if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
      let tags = Array.isArray(lead.tags) ? lead.tags
        : (typeof lead.tags === 'string' ? (() => { try { return JSON.parse(lead.tags); } catch { return []; } })() : []);
      const novasTags = tags.filter(t => t.toLowerCase() !== tag);
      const { error } = await sb.from('leads').update({ tags: novasTags, atualizado_em: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      req.log({ acao:'TAG_REMOVE', entidade:'leads', entidade_id:id, depois:{ tag } });
      return res.json({ sucesso:true, dados:{ tags: novasTags } });
    }
    const lead = sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id);
    if (!lead) return res.status(404).json({ sucesso:false, erro:'Lead não encontrado.' });
    let tags = [];
    try { tags = lead.tags ? JSON.parse(lead.tags) : []; } catch { tags = []; }
    const novasTags = tags.filter(t => t.toLowerCase() !== tag);
    sqlite.prepare('UPDATE leads SET tags=?, atualizado_em=? WHERE id=?').run(JSON.stringify(novasTags), new Date().toISOString(), id);
    req.log({ acao:'TAG_REMOVE', entidade:'leads', entidade_id:id, depois:{ tag } });
    return res.json({ sucesso:true, dados:{ tags: novasTags } });
  } catch(e) { return res.status(500).json({ sucesso:false, erro:e.message }); }
}

module.exports = { listar, buscarPorId, criar, atualizar, mover, transferir, deletar, clonar, adicionarMensagem, historico, adicionarTag, removerTag, getDistribuicao, setDistribuicao, listarProdutosLead, adicionarProdutoLead, atualizarProdutoLead, removerProdutoLead };
