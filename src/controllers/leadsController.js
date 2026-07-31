/**
 * PROSPEKT CRM — Leads Controller
 * Supabase JS nativo quando DATABASE_PROVIDER=supabase, SQLite caso contrário.
 */
const crypto = require('crypto');
const { getProvider } = require('../database/dbProvider');
const etapaHistorico = require('../services/etapaHistoricoService');
const { registrarTimeline } = require('../services/auditService');

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
  const d = _parseSafe(l.depois || l.dados_depois);
  const a = _parseSafe(l.antes  || l.dados_antes);
  const origemAuto = (l.origem_acao || '').toLowerCase().includes('autom') || (l.acao||'').startsWith('AUTOMACAO');
  const badge = origemAuto ? ' 🤖' : '';
  let icone = '📋', titulo = l.acao || '', conteudo = '';

  switch ((l.acao || '').toUpperCase()) {
    case 'CREATE':
      icone = '🌱'; titulo = 'Lead criado';
      conteudo = [
        d.funil_nome  ? `Funil: ${d.funil_nome}` : '',
        d.origem      ? `Origem: ${d.origem}` : '',
        d.responsavel_nome ? `Responsável: ${d.responsavel_nome}` : '',
      ].filter(Boolean).join(' · ') || 'Lead registrado no CRM.';
      break;
    case 'MOVER':
    case 'UPDATE_ETAPA': {
      icone = '➡️'; titulo = 'Etapa alterada' + badge;
      const eAntes  = a.etapa_nome || etapaMap[a.etapa_id] || '';
      const eDepois = d.etapa_nome || etapaMap[d.etapa_id] || '';
      const stStr   = d.status ? ` · Status: ${d.status}` : '';
      const userStr = (l.usuario_nome && l.usuario_nome !== 'Sistema') ? ` por ${l.usuario_nome}` : '';
      conteudo = eAntes && eDepois && eAntes !== eDepois
        ? `Movido de "${eAntes}" para "${eDepois}"${stStr}${userStr}`
        : eDepois
          ? `Movido para "${eDepois}"${stStr}${userStr}`
          : `Etapa atualizada${stStr}${userStr}`;
      break;
    }
    case 'MOVER_FUNIL':
    case 'UPDATE_FUNIL':
      icone = '🔀'; titulo = 'Funil alterado';
      conteudo = a.funil_nome && d.funil_nome
        ? `Funil alterado de "${a.funil_nome}" para "${d.funil_nome}".`
        : d.funil_nome ? `Funil: ${d.funil_nome}` : 'Funil alterado.';
      break;
    case 'UPDATE_RESPONSAVEL':
    case 'RESPONSAVEL_ALTERADO':
      icone = '👤'; titulo = 'Responsável alterado';
      conteudo = a.responsavel_nome && d.responsavel_nome
        ? `Responsável: "${a.responsavel_nome}" → "${d.responsavel_nome}".`
        : d.responsavel_nome ? `Responsável: ${d.responsavel_nome}` : 'Responsável alterado.';
      break;
    case 'DESQUALIFICAR':
    case 'LEAD_DESQUALIFICADO':
      icone = '🚫'; titulo = 'Lead desqualificado' + badge;
      conteudo = d.motivo
        ? `Motivo: "${d.motivo}". ${d.etapa_anterior ? `Etapa anterior: ${d.etapa_anterior}.` : ''}`
        : 'Lead movido para Lead Desqualificado.';
      break;
    case 'LEAD_PERDIDO':
    case 'PERDIDO':
      icone = '❌'; titulo = 'Lead marcado como perdido';
      conteudo = d.motivo_perda || d.perdido_motivo
        ? `Motivo: "${d.motivo_perda || d.perdido_motivo}".`
        : 'Lead marcado como perdido.';
      break;
    case 'AUTOMACAO_SEM_RESPOSTA':
    case 'AUTOMACAO':
      icone = '🤖'; titulo = 'Ação automática';
      conteudo = l.descricao || d.descricao || 'Automação executada pelo sistema.';
      break;
    case 'LAYOUT_VIRTUAL_ENTRADA':
      icone = '🖥️'; titulo = 'Layout Virtual — entrada na etapa';
      conteudo = `Lead entrou na etapa Layout Virtual. Data de entrada registrada.`;
      break;
    case 'LAYOUT_VIRTUAL_APROVADO':
      icone = '✅'; titulo = 'Layout Virtual aprovado';
      conteudo = d.layout_virtual_aprovado_em
        ? `Layout aprovado em ${new Date(d.layout_virtual_aprovado_em).toLocaleDateString('pt-BR')}.`
        : 'Layout Virtual aprovado. Lead liberado para Amostra Física.';
      break;
    case 'TAG_ADD':
      icone = '🏷️'; titulo = 'Tag adicionada';
      conteudo = d.tag ? `Tag "${d.tag}" adicionada.` : 'Tag adicionada.';
      break;
    case 'TAG_REMOVE':
      icone = '🗑️'; titulo = 'Tag removida';
      conteudo = d.tag ? `Tag "${d.tag}" removida.` : 'Tag removida.';
      break;
    case 'ADD_NOTA':
      icone = '📝'; titulo = 'Nota adicionada';
      conteudo = d.conteudo ? `"${String(d.conteudo).slice(0, 120)}${d.conteudo.length > 120 ? '…' : ''}"` : '';
      break;
    case 'ATIVIDADE_CRIADA':
      icone = '📅'; titulo = 'Atividade criada';
      conteudo = [
        d.tipo ? `Tipo: ${d.tipo}` : '',
        d.descricao ? String(d.descricao).slice(0,80) : '',
        d.data_prevista ? `Prevista: ${new Date(d.data_prevista).toLocaleDateString('pt-BR')}` : '',
      ].filter(Boolean).join(' · ');
      break;
    case 'ATIVIDADE_CONCLUIDA':
      icone = '✔️'; titulo = 'Atividade concluída';
      conteudo = [
        d.tipo ? `Tipo: ${d.tipo}` : '',
        d.concluida_em ? `Concluída em: ${new Date(d.concluida_em).toLocaleDateString('pt-BR')}` : '',
      ].filter(Boolean).join(' · ');
      break;
    case 'ATIVIDADE_ADIADA':
      icone = '⏩'; titulo = 'Atividade adiada';
      conteudo = a.data_prevista && d.data_prevista
        ? `Data: ${new Date(a.data_prevista).toLocaleDateString('pt-BR')} → ${new Date(d.data_prevista).toLocaleDateString('pt-BR')}`
        : 'Data da atividade adiada.';
      break;
    case 'VENDA_REGISTRADA':
    case 'VENDA_ATUALIZADA':
      icone = '💰'; titulo = 'Venda registrada';
      conteudo = d.valor_venda
        ? `Valor: ${Number(d.valor_venda).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}.`
        : 'Venda atualizada.';
      break;
    case 'PRODUCAO_ATUALIZADA':
      icone = '🏭'; titulo = 'Produção atualizada';
      conteudo = d.descricao || 'Dados de produção atualizados.';
      break;
    case 'ADM_VENDAS_CRIADO':
      icone = '📦'; titulo = 'Venda enviada para Administração de Vendas';
      conteudo = l.descricao || 'Venda concluída e enviada para Administração de Vendas.';
      break;
    case 'ARQUIVO_ANEXADO':
      icone = '📎'; titulo = 'Arquivo anexado';
      conteudo = d.arquivo_nome ? `Arquivo: "${d.arquivo_nome}".` : 'Arquivo anexado ao lead.';
      break;
    case 'CLONE_CARTEIRA':
      icone = '🔄'; titulo = 'Cliente enviado para Carteira Recorrente';
      conteudo = l.descricao || (d.previsao
        ? `Enviado para Carteira Recorrente. Previsão: "${d.previsao}". Data prevista: ${d.dataPrevista || '?'}.`
        : 'Cliente adicionado à Carteira Recorrente para acompanhamento de recompra.');
      break;
    case 'CLONE':
      icone = '📋'; titulo = 'Lead clonado';
      conteudo = d.tipo_clone === 'carteira_recorrente'
        ? `Card criado para acompanhamento de recompra na Carteira Recorrente.`
        : 'Lead criado como cópia de outro.';
      break;
    case 'DELETE':
      icone = '🗑️'; titulo = 'Lead excluído';
      conteudo = 'Lead removido do CRM.';
      break;
    case 'AUTOMACAO_MSG_ENVIADA':
    case 'SLA_CONTATO_1':
      icone = '🤖'; titulo = 'Mensagem automática enviada';
      conteudo = l.descricao || 'SLA de contato disparado automaticamente.';
      break;
    default:
      titulo = l.descricao ? (l.acao || '?') : (l.acao || '?');
      conteudo = l.descricao || (d.nome ? `"${d.nome}"` : JSON.stringify(d).slice(0, 80));
  }

  return {
    id: l.id,
    tipo: 'LOG',
    acao: l.acao || '',
    icone,
    titulo,
    conteudo,
    autor_nome: l.autor_nome || l.usuario_nome || 'Sistema',
    origem_acao: origemAuto ? 'automação' : 'manual',
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
  const { funil_id, etapa_id, responsavel_id, status, busca, excluir_carteira } = req.query;
  const excluiCarteira = excluir_carteira === 'true' && !funil_id;

  // Log de diagnóstico do filtro por vendedor
  console.log('[FILTRO_VENDEDOR_BACKEND_RECEBIDO] leads.listar | responsavel_id:', responsavel_id || '(nao enviado)', '| role:', req.usuario?.role, '| funil_id:', funil_id || '(todos)');

  try {
    if (isSupa) {

      // Resolve id da Carteira Recorrente e funis inativos se necessário
      let carteiraFunilId = null;
      let funisInativosIds = [];
      if (excluiCarteira) {
        const { data: cr } = await sb.from('funis').select('id').ilike('nome','%Carteira Recorrente%').limit(1);
        carteiraFunilId = cr?.[0]?.id || null;
        // Funis inativos (ex: Tráfego Pago) não aparecem em "Todos - Novos"
        const { data: inativos } = await sb.from('funis').select('id').eq('ativo', false);
        funisInativosIds = (inativos || []).map(f => f.id).filter(id => id !== carteiraFunilId);
      }

      let q = sb.from('leads').select(`
        *,
        responsavel:usuarios!responsavel_id(id,nome),
        etapa:etapas!etapa_id(id,nome,cor),
        funil:funis!funil_id(id,nome,cor)
      `);

      if (etapa_id)       q = q.eq('etapa_id', etapa_id);
      if (responsavel_id) q = q.eq('responsavel_id', responsavel_id);
      if (funil_id)       q = q.eq('funil_id', funil_id);
      if (carteiraFunilId) q = q.neq('funil_id', carteiraFunilId);
      // Exclui leads de funis inativos (Tráfego Pago etc.) em "Todos - Novos"
      if (funisInativosIds.length) q = q.not('funil_id', 'in', `(${funisInativosIds.join(',')})`);
      if (status)         q = q.eq('status', toSupaStatus(status));
      if (req.usuario.role === 'VENDEDOR') q = q.eq('responsavel_id', req.usuario.id);
      if (busca) q = q.or(`nome.ilike.%${busca}%,email.ilike.%${busca}%,telefone.ilike.%${busca}%,empresa.ilike.%${busca}%`);
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
    // Resolve Carteira Recorrente e funis inativos para exclusão
    let carteiraFunilIdSql = null;
    let funisInativosSql = [];
    if (excluiCarteira) {
      const cr = sqlite.prepare(`SELECT id FROM funis WHERE nome LIKE '%Carteira Recorrente%' LIMIT 1`).get();
      carteiraFunilIdSql = cr?.id || null;
      // Funis inativos (ex: Tráfego Pago)
      const inat = sqlite.prepare(`SELECT id FROM funis WHERE ativo=0`).all();
      funisInativosSql = inat.map(f => f.id).filter(id => id !== carteiraFunilIdSql);
    }

    let sql = `SELECT l.*, u.nome as responsavel_nome, e.nome as etapa_nome, e.cor as etapa_cor,
      f.nome as funil_nome, f.id as funil_id_real
      FROM leads l
      LEFT JOIN usuarios u ON l.responsavel_id=u.id
      LEFT JOIN etapas e ON l.etapa_id=e.id
      LEFT JOIN pipelines p ON l.pipeline_id=p.id
      LEFT JOIN funis f ON p.funil_id=f.id
      WHERE 1=1`;
    const params = [];
    if (funil_id)          { sql += ' AND p.funil_id=?';                                     params.push(funil_id); }
    if (carteiraFunilIdSql){ sql += ' AND (p.funil_id IS NULL OR p.funil_id<>?)';            params.push(carteiraFunilIdSql); }
    // Exclui funis inativos (Tráfego Pago etc.) em "Todos - Novos"
    if (funisInativosSql.length) {
      const ph = funisInativosSql.map(()=>'?').join(',');
      sql += ` AND (p.funil_id IS NULL OR p.funil_id NOT IN (${ph}))`;
      params.push(...funisInativosSql);
    }
    if (etapa_id)          { sql += ' AND l.etapa_id=?';                                     params.push(etapa_id); }
    if (status)            { sql += ' AND l.status=?';                                       params.push(status); }
    if (responsavel_id)    { sql += ' AND l.responsavel_id=?';                               params.push(responsavel_id); }
    if (req.usuario.role === 'VENDEDOR') { sql += ' AND l.responsavel_id=?';                 params.push(req.usuario.id); }
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

  // ── Roteamento de responsável ──────────────────────────────────────────────
  // VENDEDOR: sempre fica com o próprio lead (criação manual)
  // SDR: lead fica com o SDR que criou (até ele direcionar para vendedor)
  // SUPER_ADMIN/GESTOR com responsavel_id explícito: respeita a escolha
  // SUPER_ADMIN/GESTOR sem responsavel_id + lead manual: usa SDR ativo como padrão
  // Lead automático (origem != 'manual'): sempre vai para SDR ativo
  // Rodízio entre vendedores: DESATIVADO (leads automáticos agora vão para SDR)
  const { resolverSdrAtivo } = require('../services/sdrService');
  const origemLead = (origem || '').toLowerCase().trim();
  const ehLeadAutomatico = origemLead && origemLead !== 'manual';

  let respId;
  if (req.usuario.role === 'VENDEDOR') {
    // Vendedor criando lead manual → fica com ele mesmo
    respId = req.usuario.id;
  } else if (req.usuario.role === 'SDR') {
    // SDR criando lead → fica com a SDR até direcionar para vendedor
    respId = req.usuario.id;
  } else if (ehLeadAutomatico && !responsavel_id) {
    // Lead automático (webhook, integração, etc.) → SDR ativo
    const sdrId = await resolverSdrAtivo();
    respId = sdrId || req.usuario.id; // fallback: quem criou
    if (!sdrId) console.warn('[leads.criar] SDR não configurado — lead automático sem SDR:', nome);
  } else if (responsavel_id) {
    // Responsável explícito escolhido → respeita
    respId = responsavel_id;
  } else {
    // SUPER_ADMIN/GESTOR sem responsável explícito → tenta SDR ativo, fallback: quem criou
    const sdrId = await resolverSdrAtivo();
    respId = sdrId || req.usuario.id;
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
      // ── Timeline: Criação do Lead ────────────────────────────────────────────
      setImmediate(async () => {
        try {
          // Resolve nomes para Timeline
          let funilNome = '', etapaNome = '', respNome = req.usuario?.nome || 'Sistema';
          const { sb: _sb } = getProvider();
          if (_sb) {
            const [fRes, eRes, rRes] = await Promise.all([
              fId ? _sb.from('funis').select('nome').eq('id', fId).single() : { data: null },
              etapa_id ? _sb.from('etapas').select('nome').eq('id', etapa_id).single() : { data: null },
              respId && respId !== req.usuario?.id ? _sb.from('usuarios').select('nome').eq('id', respId).single() : { data: null },
            ]);
            funilNome = fRes.data?.nome || '';
            etapaNome = eRes.data?.nome || '';
            if (rRes.data?.nome) respNome = rRes.data.nome;
          }
          console.log('TIMELINE_LEAD_CREATE_EVENT', { leadId: id, nome });
          await registrarTimeline({
            leadId: id,
            usuarioId:   req.usuario?.id,
            usuarioNome: req.usuario?.nome || 'Sistema',
            tipoAcao:    'CRIACAO_LEAD',
            descricao:   'Lead criado no CRM.',
            dadosNovos:  {
              nome,
              email:       email     || null,
              telefone:    telefone  || null,
              empresa:     empresa   || null,
              funil:       funilNome,
              etapa:       etapaNome,
              responsavel: respNome,
              origem:      origem    || 'manual',
            },
            origem: 'crm',
          });
        } catch (e) { console.error('[TIMELINE_CREATE]', e.message); }
      });
      // Registra passagem pela etapa inicial no histórico do Funil de Conversão
      // E também pela PRIMEIRA etapa da pipeline (garante Lead Recebido = Cockpit)
      console.log('[FUNIL_CONVERSAO_HISTORICO_CREATE_LEAD] lead:', id, '→ etapa:', etapa_id, '| funil:', fId, '| pipeline:', pipeline_id || 'resolve-via-funil');
      setImmediate(async () => {
        try {
          if (etapa_id) {
            await etapaHistorico.registrarPassagem({
              leadId: id, etapaId: etapa_id, funilId: fId, responsavelId: respId,
              origem: 'create', entrou_em: row.criado_em,
            });
          }
          // Garante registro na primeira etapa da pipeline do funil (Lead Recebido)
          // Resolve divergência cockpit vs Funil de Conversão
          await etapaHistorico.registrarPrimeiraEtapa({
            leadId: id, funilId: fId, pipelineId: pipeline_id || null,
            responsavelId: respId, criadoEm: row.criado_em,
          });
        } catch(e) { console.error('[FUNIL_HISTORICO_CREATE]', e.message); }
      });
      // Dispara SLA Contato 1 de forma assíncrona (não bloqueia resposta)
      setImmediate(() => {
        getAutomacaoSvc().enviarSlaContato1({ id, nome: nome.trim(), telefone: telefone || null, responsavel_id: respId, origem: origem || 'manual' })
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
    // Registra passagem pela etapa inicial + primeira etapa da pipeline (SQLite)
    setImmediate(async () => {
      let funilIdCreate = null;
      if (pipeline_id) {
        try {
          const { getDb: _gdb } = require('../database/db');
          const _pr = _gdb().prepare('SELECT funil_id FROM pipelines WHERE id=? LIMIT 1').get(pipeline_id);
          if (_pr) funilIdCreate = _pr.funil_id;
        } catch(_) {}
      }
      const agora_ = new Date().toISOString();
      console.log('[FUNIL_CONVERSAO_HISTORICO_CREATE_LEAD] lead:', id, '→ etapa:', etapa_id, '| funil:', funilIdCreate, '| origem: create (SQLite)');
      if (etapa_id) {
        await etapaHistorico.registrarPassagem({
          leadId: id, etapaId: etapa_id, funilId: funilIdCreate, responsavelId: respId,
          origem: 'create', entrou_em: agora_,
        }).catch(e => console.error('[FUNIL_HISTORICO_CREATE_SQLite]', e.message));
      }
      // Garante Lead Recebido = Cockpit
      await etapaHistorico.registrarPrimeiraEtapa({
        leadId: id, funilId: funilIdCreate, pipelineId: pipeline_id || null,
        responsavelId: respId, criadoEm: agora_,
      });
    });
    // Dispara SLA Contato 1 de forma assíncrona
    setImmediate(() => {
      getAutomacaoSvc().enviarSlaContato1({ id, nome: nome.trim(), telefone: telefone || null, responsavel_id: respId, origem: origem || 'manual' })
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
        // endereço de entrega (campos separados)
        'endereco_entrega','cep_entrega','numero_entrega','complemento_entrega',
        'referencia_entrega','bairro_entrega','cidade_entrega','uf_entrega',
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
          // Endereço completo de entrega
          const _end = (f) => (req.body[f] ?? atual[f] ?? '').toString().trim();
          if (!_end('cep_entrega') || _end('cep_entrega').replace(/\D/g,'').length < 8) faltando.push('CEP de Entrega');
          if (!_end('endereco_entrega'))    faltando.push('Logradouro/Rua');
          if (!_end('numero_entrega'))      faltando.push('Número');
          if (!_end('complemento_entrega')) faltando.push('Complemento');
          if (!_end('referencia_entrega'))  faltando.push('Referência');
          if (!_end('bairro_entrega'))      faltando.push('Bairro');
          if (!_end('cidade_entrega'))      faltando.push('Cidade');
          if (!_end('uf_entrega'))          faltando.push('UF');
          if (faltando.length)
            return res.status(400).json({
              sucesso: false,
              erro: faltando.some(f => ['CEP de Entrega','Logradouro/Rua','Número','Complemento','Referência','Bairro','Cidade','UF'].includes(f))
                ? 'Para concluir a venda, preencha todos os dados do Endereço de Entrega.'
                : `Para registrar a venda, preencha: ${faltando.join(', ')}.`,
              campos_faltando: faltando
            });
        }
      }

      const { data, error } = await sb.from('leads').update(upd).eq('id', id).select().single();
      if (error) throw error;
      // ── Log: mudança de responsável ───────────────────────────────────────────
      if (upd.responsavel_id && upd.responsavel_id !== atual.responsavel_id) {
        req.log({ acao:'UPDATE_RESPONSAVEL', entidade:'leads', entidade_id:id,
          antes:{ responsavel_id: atual.responsavel_id },
          depois:{ responsavel_id: upd.responsavel_id } });
      }
      // Log: mudança de funil
      if (upd.funil_id && upd.funil_id !== atual.funil_id) {
        req.log({ acao:'MOVER_FUNIL', entidade:'leads', entidade_id:id,
          antes:{ funil_id: atual.funil_id },
          depois:{ funil_id: upd.funil_id } });
      }
      // ── Timeline: diff completo de campos editados ───────────────────────────
      setImmediate(async () => {
        try {
          const CAMPOS_RASTREADOS = [
            ['nome',            'Nome'],
            ['email',           'E-mail'],
            ['telefone',        'Telefone'],
            ['empresa',         'Empresa'],
            ['cargo',           'Cargo'],
            ['observacoes',     'Observações'],
            ['valor',           'Valor'],
            ['valor_venda',     'Valor da Venda'],
            ['forma_pagamento',  'Forma de Pagamento'],
            ['produto_nome',    'Produto'],
            ['endereco_entrega','Endereço'],
            ['cep_entrega',     'CEP'],
            ['numero_entrega',  'Número'],
            ['complemento_entrega','Complemento'],
            ['referencia_entrega','Referência'],
            ['bairro_entrega',  'Bairro'],
            ['cidade_entrega',  'Cidade'],
            ['uf_entrega',      'UF'],
            ['motivo_perda',    'Motivo de Perda'],
            ['responsavel_id',  'Responsável'],
          ];
          const ant = {};
          const nov = {};
          for (const [campo, label] of CAMPOS_RASTREADOS) {
            const v_antes = atual[campo];
            const v_depois = upd[campo];
            if (v_depois !== undefined && String(v_depois||'') !== String(v_antes||'')) {
              ant[label] = v_antes  ?? '';
              nov[label] = v_depois ?? '';
            }
          }
          if (Object.keys(nov).length > 0) {
            console.log('TIMELINE_LEAD_UPDATE_EVENT', { leadId: id, campos: Object.keys(nov) });
            await registrarTimeline({
              leadId: id,
              usuarioId:   req.usuario?.id,
              usuarioNome: req.usuario?.nome || 'Sistema',
              tipoAcao:    'EDICAO_DADOS',
              descricao:   'Dados do lead atualizados.',
              dadosAnteriores: ant,
              dadosNovos:      nov,
              origem: 'crm',
            });
          }
        } catch(e) { console.error('[TIMELINE_UPDATE]', e.message); }
      });
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
    // Log: mudança de responsável
    if (campos.responsavel_id && campos.responsavel_id !== atual.responsavel_id) {
      req.log({ acao:'UPDATE_RESPONSAVEL', entidade:'leads', entidade_id:id,
        antes:{ responsavel_id: atual.responsavel_id },
        depois:{ responsavel_id: campos.responsavel_id } });
    }
    return res.json({ sucesso:true, dados: sqlite.prepare('SELECT * FROM leads WHERE id=?').get(id) });
  } catch(e) {
    console.error('[leads.atualizar]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── Clona lead ganho para o funil Carteira Recorrente ────────────────────────
// Chamado APENAS pelo admVendasController.moverEtapa ao ir para "concluido"
// Idempotência: não cria duplicata para o mesmo ciclo (admVendaId + dia)
async function _clonarParaCarteiraRecorrente(sb, isSupa, sqlite, leadData, previsao, usuarioId, admVendaId) {
  try {
    const nomeEtapa = PREVISAO_ETAPA_CARTEIRA[previsao];
    if (!nomeEtapa) {
      console.warn('[CARTEIRA_RECORRENTE] Previsão desconhecida:', previsao);
      return { sucesso: false, erro: 'Previsão desconhecida' };
    }

    const crypto = require('crypto');
    const agr = new Date().toISOString();
    const leadOrigId = leadData.lead_original_id || leadData.id;

    // Chave de idempotência: ciclo específico (admVendaId OU lead_original_id + dia do ganho)
    const cicloKey = admVendaId || leadData.id;
    const diaGanho = (leadData.ganho_em || leadData.data_venda || agr).slice(0, 10);

    // Calcula data prevista e alerta
    const diasOffset = PREVISAO_DIAS[previsao] || 30;
    const dppc = new Date();
    dppc.setDate(dppc.getDate() + diasOffset);
    const dataPrevista = dppc.toISOString().slice(0, 10);
    const alertaDate = new Date(dppc);
    alertaDate.setDate(alertaDate.getDate() - 7);
    const alertaEm = alertaDate.toISOString().slice(0, 10);

    if (isSupa && sb) {
      // Idempotência: mesmo ciclo (admVendaId) → não duplicar
      const { data: dupCheck } = await sb.from('leads')
        .select('id')
        .eq('lead_original_id', leadOrigId)
        .eq('tipo_clone', 'carteira_recorrente')
        .eq('venda_origem_id', cicloKey)
        .limit(1);
      if (dupCheck?.length) {
        console.log('[CARTEIRA_RECORRENTE] Clone já existe para este ciclo:', dupCheck[0].id);
        return { sucesso: false, criado: false, id: dupCheck[0].id, erro: 'Duplicata do mesmo ciclo' };
      }

      // Busca funil Carteira Recorrente
      const { data: funisCarteiraList } = await sb.from('funis')
        .select('id').ilike('nome', '%Carteira Recorrente%').eq('ativo', true).limit(1);
      const funilCartId = funisCarteiraList?.[0]?.id;
      if (!funilCartId) {
        console.warn('[CARTEIRA_RECORRENTE] Funil "Carteira Recorrente" não encontrado.');
        return { sucesso: false, erro: 'Funil Carteira Recorrente não encontrado' };
      }

      // Busca etapa pelo pipeline vinculado ao funil (arquitetura Supabase: etapas.pipeline_id)
      // Fallback: tenta funil_id direto (etapas criadas via API)
      let etapaId = null;
      const { data: pipes } = await sb.from('pipelines').select('id').eq('funil_id', funilCartId).limit(1);
      const pipeCartId = pipes?.[0]?.id;
      if (pipeCartId) {
        const { data: etapasPipe } = await sb.from('etapas')
          .select('id,nome').eq('pipeline_id', pipeCartId).eq('nome', nomeEtapa).limit(1);
        etapaId = etapasPipe?.[0]?.id || null;
      }
      if (!etapaId) {
        // Fallback: etapas criadas diretamente com funil_id
        const { data: etapasFunil } = await sb.from('etapas')
          .select('id,nome').eq('funil_id', funilCartId).eq('nome', nomeEtapa).limit(1);
        etapaId = etapasFunil?.[0]?.id || null;
      }

      const novoId = crypto.randomBytes(16).toString('hex');
      const clonePayload = {
        id: novoId,
        nome: leadData.nome,
        empresa: leadData.empresa || null,
        email: leadData.email || null,
        telefone: leadData.telefone || null,
        responsavel_id: leadData.responsavel_id || null,
        funil_id: funilCartId,
        etapa_id: etapaId || null,
        status: 'ativo',
        valor: 0,
        valor_venda: leadData.valor_venda || leadData.valor || 0,
        produto_id: leadData.produto_id || null,
        produto_nome: leadData.produto_nome || null,
        produto_cor: leadData.produto_cor || null,
        forma_pagamento: leadData.forma_pagamento || null,
        tags: leadData.tags || null,
        observacoes: leadData.observacoes || null,
        origem: leadData.origem || null,
        previsao_proxima_compra: previsao,
        data_prevista_proxima_compra: dataPrevista,
        alerta_recompra_em: alertaEm,
        alerta_recompra_enviado: 0,
        tipo_clone: 'carteira_recorrente',
        lead_original_id: leadOrigId,
        venda_origem_id: cicloKey,
        etapa_atualizada_em: agr,
        criado_em: agr,
        atualizado_em: agr,
      };
      await sb.from('leads').insert(clonePayload);

      // Timeline: log no CLONE
      await sb.from('logs').insert({
        id: crypto.randomBytes(16).toString('hex'),
        acao: 'CREATE', entidade: 'leads', entidade_id: novoId,
        descricao: `Card criado automaticamente para acompanhamento de recompra. Previsão: "${previsao}". Data prevista: ${dataPrevista}. Alerta: ${alertaEm}.`,
        depois: JSON.stringify({ funil: 'Carteira Recorrente', etapa: nomeEtapa, lead_original_id: leadOrigId, tipo_clone: 'carteira_recorrente', previsao, dataPrevista, alertaEm }),
        criado_em: agr, origem_acao: 'automacao',
      }).catch(() => {});

      // Timeline: log no LEAD ORIGINAL
      await sb.from('logs').insert({
        id: crypto.randomBytes(16).toString('hex'),
        acao: 'CLONE_CARTEIRA', entidade: 'leads', entidade_id: leadOrigId,
        descricao: `Cliente enviado para Carteira Recorrente. Previsão: "${previsao}". Data prevista: ${dataPrevista}. Clone ID: ${novoId}.`,
        depois: JSON.stringify({ clone_id: novoId, previsao, etapa_carteira: nomeEtapa, dataPrevista, alertaEm }),
        criado_em: agr, origem_acao: 'automacao',
      }).catch(() => {});

      console.log(`[CARTEIRA_RECORRENTE] ✅ Clone criado: ${novoId} | Etapa: ${nomeEtapa} | Data prevista: ${dataPrevista}`);
      return { sucesso: true, criado: true, id: novoId };

    } else if (sqlite) {
      const { getDb } = require('../database/db');
      const db = getDb();

      // Idempotência SQLite: mesmo ciclo
      const dup = db.prepare(
        `SELECT id FROM leads WHERE lead_original_id=? AND tipo_clone='carteira_recorrente' AND venda_origem_id=? LIMIT 1`
      ).get(leadOrigId, cicloKey);
      if (dup) {
        console.log('[CARTEIRA_RECORRENTE] Clone já existe para este ciclo (SQLite):', dup.id);
        return { sucesso: false, criado: false, id: dup.id };
      }

      const funilCart = db.prepare(`SELECT id FROM funis WHERE nome LIKE '%Carteira Recorrente%' AND ativo=1 LIMIT 1`).get();
      if (!funilCart) {
        console.warn('[CARTEIRA_RECORRENTE] Funil não encontrado (SQLite).');
        return { sucesso: false, erro: 'Funil não encontrado' };
      }
      const pipeRec = db.prepare(`SELECT id FROM pipelines WHERE funil_id=? LIMIT 1`).get(funilCart.id);
      let etapaCR = null;
      if (pipeRec) {
        etapaCR = db.prepare(`SELECT id FROM etapas WHERE pipeline_id=? AND nome=? LIMIT 1`).get(pipeRec.id, nomeEtapa);
      }

      const novoId = crypto.randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO leads (id,nome,empresa,email,telefone,responsavel_id,funil_id,pipeline_id,etapa_id,status,
          valor,valor_venda,produto_id,produto_nome,produto_cor,forma_pagamento,tags,observacoes,origem,
          previsao_proxima_compra,data_prevista_proxima_compra,alerta_recompra_em,alerta_recompra_enviado,
          tipo_clone,lead_original_id,venda_origem_id,etapa_atualizada_em,criado_em,atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        novoId, leadData.nome, leadData.empresa||null, leadData.email||null, leadData.telefone||null,
        leadData.responsavel_id||null, funilCart.id, pipeRec?.id||null, etapaCR?.id||null, 'ABERTO',
        0, leadData.valor_venda||0, leadData.produto_id||null, leadData.produto_nome||null, leadData.produto_cor||null,
        leadData.forma_pagamento||null, leadData.tags||null, leadData.observacoes||null, leadData.origem||null,
        previsao, dataPrevista, alertaEm, 0,
        'carteira_recorrente', leadOrigId, cicloKey, agr, agr, agr
      );

      // Timeline clone
      try {
        db.prepare(`INSERT INTO logs (id,acao,entidade,entidade_id,dados_depois,criado_em) VALUES (?,?,?,?,?,?)`)
          .run(crypto.randomBytes(16).toString('hex'), 'CREATE', 'leads', novoId,
            JSON.stringify({ funil: 'Carteira Recorrente', etapa: nomeEtapa, lead_original_id: leadOrigId, tipo_clone: 'carteira_recorrente', previsao, dataPrevista, alertaEm }),
            agr);
      } catch(eLg) { console.warn('[CARTEIRA_RECORRENTE] Timeline clone (SQLite):', eLg.message); }

      // Timeline original
      try {
        db.prepare(`INSERT INTO logs (id,acao,entidade,entidade_id,dados_depois,criado_em) VALUES (?,?,?,?,?,?)`)
          .run(crypto.randomBytes(16).toString('hex'), 'CLONE_CARTEIRA', 'leads', leadOrigId,
            JSON.stringify({ clone_id: novoId, previsao, etapa_carteira: nomeEtapa, dataPrevista, alertaEm }),
            agr);
      } catch(eLg) { console.warn('[CARTEIRA_RECORRENTE] Timeline original (SQLite):', eLg.message); }

      console.log(`[CARTEIRA_RECORRENTE] ✅ Clone criado (SQLite): ${novoId} | Etapa: ${nomeEtapa} | Data prevista: ${dataPrevista}`);
      return { sucesso: true, criado: true, id: novoId };
    }
  } catch(e) {
    console.error('[CARTEIRA_RECORRENTE] Erro ao clonar:', e.message);
    return { sucesso: false, erro: e.message };
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

      // ── Validação SDR: ao mover para Lead Qualificado SDR, vendedor é obrigatório ──
      const isLeadQualificadoSDR = /lead qualificado sdr/i.test(etapa.nome || '');
      if (isLeadQualificadoSDR && req.usuario.role === 'SDR') {
        const novoResponsavel = req.body.responsavel_id;
        if (!novoResponsavel) {
          return res.status(400).json({
            sucesso: false,
            erro: 'Para qualificar o lead, selecione o vendedor responsável.',
            codigo: 'SDR_VENDEDOR_OBRIGATORIO',
          });
        }
        // Verifica se o responsável escolhido é um VENDEDOR ativo
        const { data: vendedorEscolhido } = await sb.from('usuarios')
          .select('id, nome, role').eq('id', novoResponsavel).maybeSingle();
        if (!vendedorEscolhido || vendedorEscolhido.role !== 'VENDEDOR') {
          return res.status(400).json({
            sucesso: false,
            erro: 'O responsável selecionado deve ser um vendedor ativo.',
            codigo: 'SDR_RESPONSAVEL_INVALIDO',
          });
        }
        // Atualiza responsável para o vendedor selecionado + registra qualificação
        const agora = new Date().toISOString();
        await sb.from('leads').update({
          responsavel_id:   novoResponsavel,
          sdr_qualificador: req.usuario.id,
          atualizado_em:    agora,
        }).eq('id', id);
        // Registra na timeline
        await sb.from('timeline').insert({
          id:          require('crypto').randomBytes(16).toString('hex'),
          lead_id:     id,
          tipo:        'sdr_qualificacao',
          descricao:   `Lead qualificado pela SDR ${req.usuario.nome || 'SDR'} e direcionado para o vendedor ${vendedorEscolhido.nome}.`,
          usuario_id:  req.usuario.id,
          criado_em:   agora,
        }).catch(() => {});
        console.log(`[SDR_QUALIFICACAO] Lead ${id} qualificado por ${req.usuario.nome} → vendedor: ${vendedorEscolhido.nome}`);
      }

      // ── VENDEDOR não pode mover lead de outro responsável (já existia) ──
      // Proteção extra: VENDEDOR não vê leads SDR até serem direcionados a ele
      if (req.usuario.role === 'VENDEDOR' && lead.responsavel_id !== req.usuario.id) {
        return res.status(403).json({ sucesso: false, erro: 'Acesso negado.' });
      }

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

        // ── Verifica produto oficial ativo (validarProdutosObrigatoriosParaGanho) ────
        // Exige: pelo menos 1 lead_produto com produto_id vinculado a produto ativo
        let temProdutoOficial = false;
        try {
          // Busca itens de lead_produtos com produto_id não-nulo
          const { data: itensProd } = await sb.from('lead_produtos')
            .select('id, produto_id, produto_nome')
            .eq('lead_id', id)
            .is('deleted_at', null)
            .not('produto_id', 'is', null);

          if (itensProd && itensProd.length > 0) {
            // Verifica se pelo menos 1 produto_id existe e está ativo no catálogo
            const ids = itensProd.map(p => p.produto_id).filter(Boolean);
            if (ids.length > 0) {
              const { data: prodsAtivos } = await sb.from('produtos')
                .select('id, ativo')
                .in('id', ids);
              // Filtra ativos (aceita boolean ou integer)
              temProdutoOficial = (prodsAtivos || []).some(
                p => p.ativo === true || p.ativo === 1 || p.ativo === '1'
              );
            }
          }
        } catch (errProd) {
          console.warn('[validar_ganho] Erro ao checar lead_produtos:', errProd.message);
        }

        if (!temProdutoOficial) {
          return res.status(400).json({
            sucesso: false,
            erro: 'Para concluir a venda, selecione pelo menos um produto válido da lista oficial. Acesse a aba Venda e adicione um produto.',
            campos_faltando: ['Produto Oficial Ativo'],
          });
        }

        // Previsão de próxima compra — opcional (não bloqueia ganho)
        // Endereço de entrega — campos essenciais; complemento e referência são opcionais
        const _e = (f) => (req.body[f] ?? lead[f] ?? '').toString().trim();
        if (!_e('cep_entrega') || _e('cep_entrega').replace(/\D/g,'').length < 8) faltando.push('CEP de Entrega');
        if (!_e('endereco_entrega'))    faltando.push('Logradouro/Rua');
        if (!_e('numero_entrega'))      faltando.push('Número');
        // complemento_entrega e referencia_entrega são opcionais — não bloqueiam
        if (!_e('bairro_entrega'))      faltando.push('Bairro');
        if (!_e('cidade_entrega'))      faltando.push('Cidade');
        if (!_e('uf_entrega'))          faltando.push('UF');
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

      // ── Bloqueio de retrocesso no backend ──────────────────────────────────
      // Garante integridade do Funil de Conversão: proíbe mover para etapa de ordem menor.
      // Exceção: SUPER_ADMIN pode corrigir erros (avisa mas permite).
      if (lead.etapa_id && lead.etapa_id !== etapa_id) {
        const { data: etapaAtual } = await sb.from('etapas').select('ordem').eq('id', lead.etapa_id).single();
        if (etapaAtual && typeof etapaAtual.ordem === 'number' && typeof etapa.ordem === 'number') {
          if (etapa.ordem < etapaAtual.ordem) {
            if (req.usuario.role !== 'SUPER_ADMIN') {
              console.warn('[PIPELINE_MOVE_BACKWARD_BLOCKED] lead:', id, '| de etapa ordem', etapaAtual.ordem, '→', etapa.ordem, '| bloqueado para role:', req.usuario.role);
              return res.status(400).json({
                sucesso: false,
                erro: 'Não é permitido voltar o lead para uma etapa anterior. O funil deve seguir apenas para frente para preservar a conversão.',
                retrocesso: true,
              });
            }
            console.warn('[PIPELINE_MOVE_BACKWARD_BLOCKED] SUPER_ADMIN permitido | lead:', id, '| ordem', etapaAtual.ordem, '→', etapa.ordem);
          }
        }
      }

      const upd = { etapa_id, atualizado_em: agora, status: novoStatus, etapa_atualizada_em: agora };

      if (funilIdUpd) upd.funil_id = funilIdUpd;
      if (pipeline_id) upd.pipeline_id = pipeline_id;
      if (isGanho && !lead.ganho_em) upd.ganho_em = agora;
      if (isPerdido && motivo_perda) { upd.perdido_em = agora; upd.perdido_motivo = motivo_perda; upd.motivo_perda = motivo_perda; }
      // ── Layout Virtual: entrada e saída ────────────────────────────────────
      const isLayoutVirtual = /layout.?virtual/i.test(etapa.nome||'');
      const isAmostrafisica  = /amostra.?física/i.test(etapa.nome||'');
      const etapaAnterior   = lead.etapa_id ? ((await sb.from('etapas').select('nome').eq('id', lead.etapa_id).single())?.data?.nome||'') : '';
      const vemDeLayoutVirtual = /layout.?virtual/i.test(etapaAnterior);

      if (isLayoutVirtual) {
        // Registra entrada na etapa Layout Virtual
        upd.layout_virtual_entrada_em = agora;
        // Limpa aprovação de execução anterior se o lead voltar para esta etapa
        upd.layout_virtual_aprovado_em = null;
      }

      if (isAmostrafisica && vemDeLayoutVirtual) {
        // Bloqueia se não houver aprovação do Layout Virtual
        const aprovadoEm = req.body.layout_virtual_aprovado_em || lead.layout_virtual_aprovado_em;
        if (!aprovadoEm) {
          return res.status(400).json({
            sucesso: false,
            erro: 'Para mover para Amostra Física, confirme a aprovação do Layout Virtual preenchendo a data de aprovação.',
            campos_faltando: ['layout_virtual_aprovado_em'],
          });
        }
        upd.layout_virtual_aprovado_em = aprovadoEm;
      }

      // Salva data de aprovação se enviada manualmente
      if (req.body.layout_virtual_aprovado_em && !isLayoutVirtual) {
        upd.layout_virtual_aprovado_em = req.body.layout_virtual_aprovado_em;
      }

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
        // ── Conta Azul: muda para 'pendente' automaticamente ao ganhar ────────
        // Se ainda era 'nao_aplicavel', sinaliza que a ficha está pronta para envio
        if (!lead.conta_azul_status || lead.conta_azul_status === 'nao_aplicavel') {
          upd.conta_azul_status = 'pendente';
          console.log('CONTA_AZUL_STATUS_PENDENTE', { leadId: id, motivo: 'lead_ganho' });
        }
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

      req.log({ acao:'MOVER', entidade:'leads', entidade_id:id,
        antes:{ etapa_id:lead.etapa_id, status:lead.status, etapa_nome:etapaAnterior },
        depois:{ etapa_id, status:novoStatus, etapa_nome:etapa.nome,
          layout_virtual_entrada_em: isLayoutVirtual ? agora : undefined,
          layout_virtual_aprovado_em: upd.layout_virtual_aprovado_em || undefined } });

      // ── TIMELINE VISUAL DO CARD (lead_timeline) ────────────────────────────
      // CAUSA RAIZ DO BUG: o caminho Supabase nunca chamava registrarTimeline().
      // req.log() salva em 'logs'; a timeline visual usa 'lead_timeline'.
      // Corrigido: chamada setImmediate para não bloquear resposta.
      if (lead.etapa_id !== etapa_id) { // só registra se etapa realmente mudou
        const tipoAcaoTimeline = isGanho ? 'LEAD_GANHO' : isPerdido ? 'LEAD_PERDIDO' : 'MUDANCA_ETAPA';
        let descricaoTimeline;
        if (isGanho) {
          descricaoTimeline = `Lead ganho na etapa "${etapa.nome}".${etapaAnterior ? ` Veio de: ${etapaAnterior}.` : ''}`;
        } else if (isPerdido) {
          descricaoTimeline = `Lead perdido na etapa "${etapa.nome}".${motivo_perda ? ` Motivo: ${motivo_perda}.` : ''}${etapaAnterior ? ` Veio de: ${etapaAnterior}.` : ''}`;
        } else {
          descricaoTimeline = `Etapa alterada: ${etapaAnterior || '(início)'} → ${etapa.nome}.`;
        }
        setImmediate(() => registrarTimeline({
          leadId:          id,
          usuarioId:       req.usuario?.id   || null,
          usuarioNome:     req.usuario?.nome || 'Sistema',
          tipoAcao:        tipoAcaoTimeline,
          descricao:       descricaoTimeline,
          dadosAnteriores: { etapa_id: lead.etapa_id, etapa_nome: etapaAnterior, status: lead.status },
          dadosNovos:      { etapa_id, etapa_nome: etapa.nome, status: novoStatus },
          origem:          'pipeline_mover',
        }).catch(e => console.error('[TIMELINE_MOVER_Supabase]', e.message)));
      }

      // Registra passagem pela etapa de destino no histórico do Funil de Conversão (Supabase)
      console.log('[FUNIL_CONVERSAO_HISTORICO_MOVE_LEAD] lead:', id, '→ etapa:', etapa_id, '| funil:', funilIdUpd || lead.funil_id || null, '| origem: mover');
      setImmediate(() => etapaHistorico.registrarPassagem({
        leadId: id,
        etapaId: etapa_id,
        funilId: funilIdUpd || lead.funil_id || null,
        responsavelId: lead.responsavel_id || null,
        origem: 'mover',
        entrou_em: agora,
      }).catch(e => console.error('[FUNIL_HISTORICO_MOVER]', e.message)));


      // Log especial de etapas de Layout Virtual na timeline
      if (isLayoutVirtual) {
        req.log({ acao:'LAYOUT_VIRTUAL_ENTRADA', entidade:'leads', entidade_id:id,
          depois:{ etapa_id, etapa_nome:etapa.nome, layout_virtual_entrada_em:agora, usuario:req.usuario?.nome||'Sistema' } });
      }
      if (isAmostrafisica && vemDeLayoutVirtual) {
        req.log({ acao:'LAYOUT_VIRTUAL_APROVADO', entidade:'leads', entidade_id:id,
          depois:{ layout_virtual_aprovado_em: upd.layout_virtual_aprovado_em, etapa_nome:etapa.nome, usuario:req.usuario?.nome||'Sistema' } });
      }

      // ── Pós-ganho: clonagem Adm Vendas ─────────────────────────────────
      // FLUXO CORRETO: lead ganho → Adm Vendas; Adm Vendas → Venda Concluída → Carteira Recorrente
      if (isGanho) {
        const leadGanho = { ...lead, ...upd };
        // Carrega itens de lead_produtos para repassar ao ADM Vendas
        try {
          const { data: itensGanho } = await sb.from('lead_produtos')
            .select('*').eq('lead_id', id).is('deleted_at', null).order('criado_em');
          leadGanho._lead_produtos = itensGanho || [];
        } catch { leadGanho._lead_produtos = []; }
        try {
          console.log('[ADM_VENDAS_CLONE_TRIGGER_START] lead:', id);
          const admRes = await getAdmVendasCtrl().clonarDeLeadGanho(leadGanho, lead.responsavel_id, sb, isSupa, null);
          if (admRes.criado) {
            console.log('[ADM_VENDAS_CLONE_TRIGGER_SUCCESS] card:', admRes.id);
            // Registra na timeline do lead original
            const logAdm = require('crypto').randomBytes(16).toString('hex');
            await sb.from('logs').insert({
              id: logAdm, acao: 'ADM_VENDAS_CRIADO', entidade: 'leads', entidade_id: id,
              descricao: `Venda concluída e enviada para Administração de Vendas. Card ADM: ${admRes.id}.`,
              depois: JSON.stringify({ adm_venda_id: admRes.id, previsao: previsaoProxima }),
              criado_em: agora, origem_acao: 'automacao',
            }).catch(() => {});
          } else if (!admRes.sucesso) {
            console.warn('[ADM_VENDAS_CLONE_TRIGGER_ERROR]', admRes.erro);
          } else {
            console.log('[ADM_VENDAS_CLONE_TRIGGER_SKIP_DUPLICATE] card:', admRes.id);
          }
        } catch(eAdm) { console.error('[ADM_VENDAS_CLONE_TRIGGER_ERROR]', eAdm.message); }
        // NÃO cria clone direto na Carteira Recorrente aqui.
        // O clone da Carteira só acontece quando Adm Vendas → Venda Concluída.
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

    // ── Bloqueio de retrocesso no backend (SQLite) ────────────────────────────
    if (lead.etapa_id && lead.etapa_id !== etapa_id) {
      const etapaAtualSql = sqlite.prepare('SELECT ordem FROM etapas WHERE id=? LIMIT 1').get(lead.etapa_id);
      if (etapaAtualSql && typeof etapaAtualSql.ordem === 'number' && typeof etapa.ordem === 'number') {
        if (etapa.ordem < etapaAtualSql.ordem) {
          if (req.usuario.role !== 'SUPER_ADMIN') {
            console.warn('[PIPELINE_MOVE_BACKWARD_BLOCKED] SQLite | lead:', id, '| ordem', etapaAtualSql.ordem, '→', etapa.ordem);
            return res.status(400).json({
              sucesso: false,
              erro: 'Não é permitido voltar o lead para uma etapa anterior. O funil deve seguir apenas para frente para preservar a conversão.',
              retrocesso: true,
            });
          }
          console.warn('[PIPELINE_MOVE_BACKWARD_BLOCKED] SQLite | SUPER_ADMIN permitido | lead:', id);
        }
      }
    }

    const novoStatus = etapa.is_ganho ? 'GANHO' : etapa.is_perdido ? 'PERDIDO' : 'ABERTO';
    const agora = new Date().toISOString();
    const extras = {};

    // ── Validação obrigatória para etapa de ganho (SQLite) ───────────────────
    if (etapa.is_ganho) {
      const faltandoSql = [];
      if (!lead.email)                                          faltandoSql.push('Email');
      if (!(lead.funil_id || req.body.funil_id))               faltandoSql.push('Funil');
      const vvSql = req.body.valor_venda ?? lead.valor_venda;
      if (!vvSql || Number(vvSql) <= 0)                       faltandoSql.push('Valor da Venda');
      const fpSql = req.body.forma_pagamento ?? lead.forma_pagamento;
      if (!fpSql)                                              faltandoSql.push('Forma de Pagamento');
      // Verifica lead_produtos (multi-produto), fallback para campo legado
      let temProdutoSql = false;
      try {
        const itProd = sqlite.prepare(
          `SELECT id FROM lead_produtos WHERE lead_id=? AND deleted_at IS NULL LIMIT 1`
        ).get(id);
        temProdutoSql = !!itProd;
      } catch { /* tabela ainda não existe no SQLite */ }
      if (!temProdutoSql) {
        temProdutoSql = !!(req.body.produto_id ?? lead.produto_id ?? req.body.produto_nome ?? lead.produto_nome);
      }
      if (!temProdutoSql) faltandoSql.push('Produto Adquirido');
      const previsaoSql = req.body.previsao_proxima_compra ?? lead.previsao_proxima_compra;
      if (!previsaoSql) faltandoSql.push('Previsão de Próxima Compra');
      // Endereço completo de entrega — todos os campos obrigatórios
      const _es = (f) => (req.body[f] ?? lead[f] ?? '').toString().trim();
      if (!_es('cep_entrega') || _es('cep_entrega').replace(/\D/g,'').length < 8) faltandoSql.push('CEP de Entrega');
      if (!_es('endereco_entrega'))    faltandoSql.push('Logradouro/Rua');
      if (!_es('numero_entrega'))      faltandoSql.push('Número');
      if (!_es('complemento_entrega')) faltandoSql.push('Complemento');
      if (!_es('referencia_entrega'))  faltandoSql.push('Referência');
      if (!_es('bairro_entrega'))      faltandoSql.push('Bairro');
      if (!_es('cidade_entrega'))      faltandoSql.push('Cidade');
      if (!_es('uf_entrega'))          faltandoSql.push('UF');
      if (faltandoSql.length > 0) {
        return res.status(400).json({
          sucesso: false,
          erro: 'Para concluir a venda, preencha todos os dados do Endereço de Entrega.',
          campos_faltando: faltandoSql,
        });
      }
    }

    if (etapa.is_ganho && !lead.data_fechamento) extras.data_fechamento = agora.slice(0,10);
    if (etapa.is_perdido && motivo_perda) extras.motivo_perda = motivo_perda;
    extras.etapa_atualizada_em = agora; // rastreia entrada na etapa

    // ── Layout Virtual: entrada e saída (SQLite) ─────────────────────────
    const isLayoutVirtualSql = /layout.?virtual/i.test(etapa.nome||'');
    const isAmostrafisicaSql  = /amostra.?física/i.test(etapa.nome||'');
    let etapaAnteriorNome = '';
    if (lead.etapa_id) {
      const etaAnt = sqlite.prepare('SELECT nome FROM etapas WHERE id=? LIMIT 1').get(lead.etapa_id);
      etapaAnteriorNome = etaAnt?.nome || '';
    }
    const vemDeLayoutVirtualSql = /layout.?virtual/i.test(etapaAnteriorNome);

    if (isLayoutVirtualSql) {
      extras.layout_virtual_entrada_em = agora;
      extras.layout_virtual_aprovado_em = null; // reseta aprovação ao re-entrar
    }

    if (isAmostrafisicaSql && vemDeLayoutVirtualSql) {
      const aprovadoEm = req.body.layout_virtual_aprovado_em || lead.layout_virtual_aprovado_em;
      if (!aprovadoEm) {
        return res.status(400).json({
          sucesso: false,
          erro: 'Para mover para Amostra Física, confirme a aprovação do Layout Virtual preenchendo a data de aprovação.',
          campos_faltando: ['layout_virtual_aprovado_em'],
        });
      }
      extras.layout_virtual_aprovado_em = aprovadoEm;
    }

    if (req.body.layout_virtual_aprovado_em && !isLayoutVirtualSql) {
      extras.layout_virtual_aprovado_em = req.body.layout_virtual_aprovado_em;
    }
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

    req.log({ acao:'MOVER', entidade:'leads', entidade_id:id,
      antes:{ etapa_id:lead.etapa_id },
      depois:{ etapa_id, status:novoStatus } });
    // ── Timeline: Mudança de Etapa (SQLite) ───────────────────────────────────
    setImmediate(async () => {
      try {
        const eAnteriorNome = etapaAnteriorNome || lead.etapa_id || '';
        const eNovaNome     = etapa?.nome       || etapa_id      || '';
        const fNome         = '';
        const tipoAcao = novoStatus === 'ganho'   ? 'VENDA_GANHA'
          : novoStatus === 'perdido' ? 'LEAD_PERDIDO' : 'MUDANCA_ETAPA';
        const descricao = tipoAcao === 'VENDA_GANHA'
          ? `Lead marcado como venda/ganho. Etapa: ${eNovaNome}.`
          : tipoAcao === 'LEAD_PERDIDO'
          ? `Lead marcado como perdido. Etapa: ${eNovaNome}.`
          : eAnteriorNome && eNovaNome
          ? `Etapa alterada: ${eAnteriorNome} → ${eNovaNome}.`
          : `Movido para etapa: ${eNovaNome}.`;
        console.log('TIMELINE_LEAD_MOVE_STAGE_EVENT', { leadId: id, eAnteriorNome, eNovaNome, tipoAcao });
        await registrarTimeline({
          leadId: id,
          usuarioId:   req.usuario?.id,
          usuarioNome: req.usuario?.nome || 'Sistema',
          tipoAcao,
          descricao,
          dadosAnteriores: { etapa: eAnteriorNome, status: lead.status },
          dadosNovos:      { etapa: eNovaNome, status: novoStatus, funil: fNome },
          origem: 'crm',
        });
      } catch(e) { console.error('[TIMELINE_MOVER_SQLite]', e.message); }
    });

    // Registra passagem pela etapa de destino no histórico do Funil de Conversão (SQLite)
    // Idempotente: UNIQUE(lead_id, etapa_id) impede duplicatas
    setImmediate(() => {
      // Resolve funil_id para o lead (via pipeline)
      let funilIdSql = lead.funil_id || null;
      if (!funilIdSql && (pipeline_id || lead.pipeline_id)) {
        try {
          const { getDb: _getDbMov } = require('../database/db');
          const _dbMov = _getDbMov();
          const pipeRow = _dbMov.prepare('SELECT funil_id FROM pipelines WHERE id=? LIMIT 1').get(pipeline_id || lead.pipeline_id);
          if (pipeRow) funilIdSql = pipeRow.funil_id;
        } catch(_) {}
      }
      etapaHistorico.registrarPassagem({
        leadId: id,
        etapaId: etapa_id,
        funilId: funilIdSql,
        responsavelId: lead.responsavel_id || null,
        origem: 'mover',
        entrou_em: agora,
      }).then(() => {
        console.log('[FUNIL_CONVERSAO_HISTORICO_MOVE_LEAD] lead:', id, '→ etapa:', etapa_id, '| origem: mover');
      }).catch(e => console.error('[FUNIL_CONVERSAO_HISTORICO_MOVER_SQLite]', e.message));
    });

    const valorVendaGanhoSql = Number(lead.valor_venda ?? lead.valor ?? 0);
    if (etapa.is_ganho && lead.responsavel_id && valorVendaGanhoSql > 0) {
      try { calcularComissaoSQLite(sqlite, lead, id, pipeline_id, agora, req); } catch(e) { console.error('[COMISSAO_AUTO]', e.message); }
    }

    // ── Pós-ganho: clonagem Adm Vendas ──────────────────────────────────────
    // FLUXO CORRETO: lead ganho → Adm Vendas → Venda Concluída → Carteira Recorrente
    if (etapa.is_ganho) {
      const { getDb } = require('../database/db');
      const db = getDb();
      const leadAtual = db.prepare('SELECT * FROM leads WHERE id=?').get(id);
      // 1. Clone para Administração de Vendas
      try {
        console.log('[ADM_VENDAS_CLONE_TRIGGER_START] lead:', id);
        const admRes = await getAdmVendasCtrl().clonarDeLeadGanho(leadAtual || lead, lead.responsavel_id, null, false, sqlite);
        if (admRes.criado) {
          console.log('[ADM_VENDAS_CLONE_TRIGGER_SUCCESS] card:', admRes.id);
          try {
            db.prepare(`INSERT INTO logs (id,acao,entidade,entidade_id,dados_depois,criado_em) VALUES (?,?,?,?,?,?)`)
              .run(require('crypto').randomBytes(16).toString('hex'), 'ADM_VENDAS_CRIADO', 'leads', id,
                JSON.stringify({ adm_venda_id: admRes.id, previsao: previsaoProxSql }), agora);
          } catch(eLg) { console.warn('[LOG_ADM_VENDAS]', eLg.message); }
        } else if (!admRes.sucesso) {
          console.warn('[ADM_VENDAS_CLONE_TRIGGER_ERROR]', admRes.erro);
        } else {
          console.log('[ADM_VENDAS_CLONE_TRIGGER_SKIP_DUPLICATE] card:', admRes.id);
        }
      } catch(eAdm) { console.error('[ADM_VENDAS_CLONE_TRIGGER_ERROR]', eAdm.message); }
      // NÃO cria clone direto na Carteira Recorrente aqui.
      // O clone da Carteira só acontece quando Adm Vendas → Venda Concluída.
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
  const { buscarTimeline } = require('../services/auditService');
  const leadId = req.params.id;
  try {
    let notas = [];
    let logs  = [];
    let timeline = [];

    if (isSupa) {
      const { data: lead } = await sb.from('leads').select('criado_em,nome').eq('id', leadId).maybeSingle();

      // 1. Notas
      const { data: msgs } = await sb.from('mensagens').select('*, autor:usuarios!usuario_id(nome)').eq('lead_id', leadId).order('criado_em');
      notas = (msgs||[]).map(m => ({
        id: m.id, tipo: 'NOTA', acao: 'NOTA',
        icone: '📝', titulo: 'Nota adicionada',
        conteudo: m.texto || m.conteudo || '',
        autor_nome: m.autor?.nome || 'Sistema',
        criado_em: m.criado_em,
      }));

      // 2. Logs de auditoria (apenas entidade='leads')
      const { data: lgData } = await sb.from('logs')
        .select('*, usuario:usuarios!usuario_id(nome)')
        .eq('entidade', 'leads')
        .eq('entidade_id', leadId)
        .order('criado_em');

      const etapaIds = [...new Set((lgData||[])
        .flatMap(l => [_parseSafe(l.dados_depois || l.depois).etapa_id, _parseSafe(l.dados_antes || l.antes).etapa_id])
        .filter(Boolean))];
      let etapaMap = {};
      if (etapaIds.length) {
        const { data: etapas } = await sb.from('etapas').select('id,nome').in('id', etapaIds);
        etapaMap = Object.fromEntries((etapas||[]).map(e => [e.id, e.nome]));
      }

      logs = (lgData||[]).map(l => {
        const norm = {
          ...l,
          // Supabase usa dados_antes/dados_depois
          antes:  l.dados_antes,
          depois: l.dados_depois,
          autor_nome: l.usuario_nome || l.usuario?.nome || 'Sistema',
          usuario_nome: l.usuario_nome || l.usuario?.nome || 'Sistema',
        };
        return formatarLog(norm, etapaMap);
      });

      // 3. Timeline rica (lead_timeline)
      const tlRaw = await buscarTimeline(leadId);
      timeline = tlRaw.map(t => ({
        id:   t.id,
        tipo: 'TIMELINE',
        acao: t.tipo_acao,
        icone: _tipoAcaoIcone(t.tipo_acao),
        titulo: _tipoAcaoTitulo(t.tipo_acao),
        conteudo: t.descricao || '',
        dados_anteriores: t.dados_anteriores,
        dados_novos:      t.dados_novos,
        autor_nome: t.usuario_nome || 'Sistema',
        criado_em:  t.criado_em,
        origem:     t.origem,
      }));

      // Evento retroativo: Lead criado (se não houver log de criação)
      const temCreate = logs.some(l => l.acao === 'CREATE') || timeline.some(t => t.acao === 'CRIACAO_LEAD');
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

      console.log('TIMELINE_LEAD_FETCH', { leadId, logs: logs.length, timeline: timeline.length, notas: notas.length });

    } else {
      notas = sqlite.prepare(`SELECT m.*, u.nome as autor_nome FROM mensagens m LEFT JOIN usuarios u ON m.usuario_id=u.id WHERE m.lead_id=? ORDER BY m.enviado_em`).all(leadId)
        .map(m => ({ ...m, tipo:'NOTA', acao:'NOTA', icone:'📝', titulo:'Nota adicionada' }));
      const lgRaw = sqlite.prepare(`SELECT l.*, u.nome as autor_nome FROM logs l LEFT JOIN usuarios u ON l.usuario_id=u.id WHERE l.entidade='leads' AND l.entidade_id=? ORDER BY l.criado_em`).all(leadId);
      const eIds = [...new Set(lgRaw.flatMap(l => [_parseSafe(l.dados_depois).etapa_id, _parseSafe(l.dados_antes).etapa_id]).filter(Boolean))];
      let etapaMap = {};
      if (eIds.length) {
        const rows = sqlite.prepare(`SELECT id, nome FROM etapas WHERE id IN (${eIds.map(()=>'?').join(',')}) `).all(...eIds);
        etapaMap = Object.fromEntries(rows.map(e => [e.id, e.nome]));
      }
      logs = lgRaw.map(l => formatarLog(l, etapaMap));

      // Timeline para SQLite (usa tabela logs com tipo_acao)
      const tlRaw = await buscarTimeline(leadId);
      timeline = tlRaw.map(t => ({
        id: t.id, tipo: 'TIMELINE', acao: t.tipo_acao,
        icone: _tipoAcaoIcone(t.tipo_acao),
        titulo: _tipoAcaoTitulo(t.tipo_acao),
        conteudo: t.descricao || '',
        dados_anteriores: t.dados_anteriores,
        dados_novos:      t.dados_novos,
        autor_nome: t.usuario_nome || 'Sistema',
        criado_em:  t.criado_em,
      }));
    }

    // Mescla e desduplicar por id
    const seen = new Set();
    const todos = [...notas, ...logs, ...timeline]
      .filter(m => {
        if (!m.id || seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      })
      .sort((a,b) => new Date(a.criado_em||a.enviado_em) - new Date(b.criado_em||b.enviado_em));

    return res.json({ sucesso:true, dados:todos });
  } catch(e) {
    console.error('[leads.historico]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// Helpers de Timeline
function _tipoAcaoIcone(tipo) {
  const MAP = {
    CRIACAO_LEAD:    '🌱',
    EDICAO_DADOS:    '✏️',
    MUDANCA_ETAPA:   '➡️',
    LEAD_GANHO:      '🏆',
    VENDA_GANHA:     '🏆',
    LEAD_PERDIDO:    '❌',
    CLONE_CARTEIRA:  '🔄',
    CLONE:           '📋',
    ARQUIVO_ANEXADO: '📎',
    ATIVIDADE_CRIADA:'📅',
    ATIVIDADE_CONCLUIDA:'✔️',
    ADM_VENDAS_CRIADO:'📦',
    NOTA:            '📝',
  };
  return MAP[tipo] || '📋';
}

function _tipoAcaoTitulo(tipo) {
  const MAP = {
    CRIACAO_LEAD:    'Lead criado',
    EDICAO_DADOS:    'Dados atualizados',
    MUDANCA_ETAPA:   'Etapa alterada',
    LEAD_GANHO:      'Venda/Ganho',
    VENDA_GANHA:     'Venda/Ganho',
    LEAD_PERDIDO:    'Lead perdido',
    CLONE_CARTEIRA:  'Enviado para Carteira Recorrente',
    CLONE:           'Lead clonado',
    ARQUIVO_ANEXADO: 'Arquivo anexado',
    ATIVIDADE_CRIADA:'Atividade criada',
    ATIVIDADE_CONCLUIDA:'Atividade concluída',
    ADM_VENDAS_CRIADO:'Enviado para Adm. de Vendas',
    NOTA:            'Nota adicionada',
  };
  return MAP[tipo] || tipo || 'Evento';
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

// ── GET /api/leads/alertas-recompra ─────────────────────────────────────────
// Retorna leads da Carteira Recorrente com alerta_recompra_em nos próximos 7 dias
async function alertasRecompra(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  try {
    // Janela: inclui alertas vencidos (30 dias atras, ainda nao vistos) + proximos 7 dias
    const em7d   = new Date(); em7d.setDate(em7d.getDate() + 7);
    const ha30d  = new Date(); ha30d.setDate(ha30d.getDate() - 30);
    const limite = em7d.toISOString().slice(0,10);
    const inicio = ha30d.toISOString().slice(0,10);
    const isVendedor = req.usuario.role === 'VENDEDOR';

    if (isSupa) {
      let q = sb.from('leads')
        .select('id,nome,empresa,responsavel_id,alerta_recompra_em,data_prevista_proxima_compra,previsao_proxima_compra,alerta_recompra_enviado,funil_id,etapa_id')
        .eq('tipo_clone', 'carteira_recorrente')
        .eq('status', 'ABERTO')
        .eq('alerta_recompra_enviado', 0)       // so alertas pendentes (nao vistos)
        .gte('alerta_recompra_em', inicio)       // inclui vencidos (ate 30 dias atras)
        .lte('alerta_recompra_em', limite)       // ate +7 dias a frente
        .order('alerta_recompra_em');
      if (isVendedor) q = q.eq('responsavel_id', req.usuario.id);
      const { data, error } = await q;
      if (error) throw error;
      return res.json({ sucesso:true, dados: data || [], total: (data||[]).length });
    }

    // SQLite
    let sql = `SELECT id,nome,empresa,responsavel_id,alerta_recompra_em,data_prevista_proxima_compra,
      previsao_proxima_compra,alerta_recompra_enviado,funil_id,etapa_id
      FROM leads WHERE tipo_clone='carteira_recorrente' AND status='ABERTO'
      AND alerta_recompra_enviado=0
      AND alerta_recompra_em>=? AND alerta_recompra_em<=?`;
    const params = [inicio, limite];
    if (isVendedor) { sql += ' AND responsavel_id=?'; params.push(req.usuario.id); }
    sql += ' ORDER BY alerta_recompra_em';
    const dados = sqlite.prepare(sql).all(...params);
    return res.json({ sucesso:true, dados, total: dados.length });
  } catch(e) {
    console.error('[alertasRecompra]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

// ── PATCH /api/leads/:id/alerta-recompra-visto ──────────────────────────────
async function marcarAlertaVisto(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { id } = req.params;
  try {
    const agora = new Date().toISOString();
    if (isSupa) {
      await sb.from('leads').update({ alerta_recompra_enviado: 1, atualizado_em: agora }).eq('id', id);
    } else {
      sqlite.prepare('UPDATE leads SET alerta_recompra_enviado=1, atualizado_em=? WHERE id=?').run(agora, id);
    }
    req.log({ acao:'ALERTA_RECOMPRA_VISTO', entidade:'leads', entidade_id:id,
      depois:{ alerta_recompra_enviado: 1 } });
    return res.json({ sucesso:true });
  } catch(e) {
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

module.exports = { listar, buscarPorId, criar, atualizar, mover, transferir, deletar, clonar, adicionarMensagem, historico, adicionarTag, removerTag, getDistribuicao, setDistribuicao, listarProdutosLead, adicionarProdutoLead, atualizarProdutoLead, removerProdutoLead, alertasRecompra, marcarAlertaVisto, _clonarParaCarteiraRecorrente };

