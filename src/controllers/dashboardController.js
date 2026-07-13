/**
 * PROSPEKT CRM — Dashboard Controller v2
 * Corrige: filtros de data, status case-insensitive, valor_venda, ganho real.
 */
const { getProvider } = require('../database/dbProvider');
const { ETAPAS_CARTEIRA_REMOVIDAS } = require('./funisController');

// ── Helpers de período ────────────────────────────────────────────────────────
function calcPeriodo(dataTipo, dataPeriodo, dataInicio, dataFim) {
  // dataTipo: criacao | fechamento | perdido
  // dataPeriodo: hoje | ontem | 7d | 30d | mes_atual | mes_ant | personalizado
  const agora = new Date();
  const pad  = n => String(n).padStart(2,'0');
  const iso  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  if (!dataPeriodo) return null;

  let ini, fim;
  if (dataPeriodo === 'hoje') {
    ini = fim = iso(agora);
  } else if (dataPeriodo === 'ontem') {
    const d = new Date(agora); d.setDate(d.getDate()-1);
    ini = fim = iso(d);
  } else if (dataPeriodo === '7d') {
    const d = new Date(agora); d.setDate(d.getDate()-6);
    ini = iso(d); fim = iso(agora);
  } else if (dataPeriodo === 'essa_semana') {
    // Segunda-feira até hoje (semana corrente)
    const dow = agora.getDay(); // 0=dom,1=seg...
    const diffSeg = dow === 0 ? 6 : dow - 1;
    const seg = new Date(agora); seg.setDate(seg.getDate() - diffSeg);
    ini = iso(seg); fim = iso(agora);
  } else if (dataPeriodo === '30d') {
    const d = new Date(agora); d.setDate(d.getDate()-29);
    ini = iso(d); fim = iso(agora);
  } else if (dataPeriodo === 'mes_atual') {
    ini = `${agora.getFullYear()}-${pad(agora.getMonth()+1)}-01`;
    const lastDay = new Date(agora.getFullYear(), agora.getMonth()+1, 0);
    fim = iso(lastDay);
  } else if (dataPeriodo === 'mes_ant') {
    const m = agora.getMonth(); // 0-based
    const y = m === 0 ? agora.getFullYear()-1 : agora.getFullYear();
    const mm = m === 0 ? 12 : m;
    ini = `${y}-${pad(mm)}-01`;
    const lastDay = new Date(y, mm, 0);
    fim = iso(lastDay);
  } else if (dataPeriodo === 'personalizado') {
    ini = dataInicio || null;
    fim = dataFim    || null;
  }
  return { ini, fim };
}

// ── Campo de data por tipo ────────────────────────────────────────────────────
function campoData(dataTipo) {
  if (dataTipo === 'fechamento') return 'ganho_em';   // HTML usa 'fechamento'
  if (dataTipo === 'ganho')      return 'ganho_em';   // alternativa
  if (dataTipo === 'perdido')    return 'perdido_em'; // HTML usa 'perdido'
  if (dataTipo === 'perda')      return 'perdido_em'; // alternativa
  return 'criado_em'; // default: criação
}

// ── Detecção de ganho/perda a partir de um lead + etapas ─────────────────────
function isGanhoLead(l, etapaMap) {
  const s = (l.status||'').toUpperCase();
  if (['GANHO','VENDIDO','VENDA'].includes(s)) return true;
  if (l.ganho_em) return true;
  const et = etapaMap[l.etapa_id];
  if (et?.is_ganho) return true;
  if (et?.probabilidade >= 100) return true;
  if (/venda|vendas|ganho|fechad|fechamento/i.test(et?.nome||'')) return true;
  return false;
}

function isPerdidoLead(l, etapaMap) {
  const s = (l.status||'').toUpperCase();
  if (s === 'PERDIDO') return true;
  if (l.perdido_em) return true;
  const et = etapaMap[l.etapa_id];
  if (et?.is_perdido) return true;
  if (et?.probabilidade === 0) return true;
  if (/perdid|desqualif/i.test(et?.nome||'')) return true;
  return false;
}

function valorVenda(l) {
  // Fonte principal: valor_venda; fallback: valor
  if (l.valor_venda != null && Number(l.valor_venda) > 0) return Number(l.valor_venda);
  return Number(l.valor||0);
}

// GET /api/dashboard
async function resumo(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { funil_id, responsavel_id, data_tipo, data_periodo, data_inicio, data_fim, excluir_carteira } = req.query;
  const excluiCarteira = excluir_carteira === 'true' && !funil_id;

  // ── Logs de diagnóstico ────────────────────────────────────────────────
  console.log('[DASHBOARD_API_PARAMS]', {
    funil_id:        funil_id       || '(nenhum)',
    responsavel_id:  responsavel_id || '(todos)',
    data_tipo:       data_tipo      || '(sem filtro)',
    data_periodo:    data_periodo   || '(sem período)',
    data_inicio:     data_inicio    || null,
    data_fim:        data_fim       || null,
    excluir_carteira,
    excluiCarteira,
    usuario_role:    req.usuario?.role,
  });

  try {
    if (isSupa) {
      // ── 0. Resolve ids de funis a excluir em modo "Todos - Novos" ──────────────
      let carteiraFunilId = null;
      let funisInativosIds = []; // ids de funis inativos (ex: Tráfego Pago) a excluir

      if (excluiCarteira) {
        // Carteira Recorrente
        const { data: cr } = await sb.from('funis').select('id').ilike('nome','%Carteira Recorrente%').limit(1);
        carteiraFunilId = cr?.[0]?.id || null;
        console.log('[DASHBOARD_FILTER_FUNIL_SELECTED] excluindo Carteira Recorrente id:', carteiraFunilId);

        // Funis inativos (ex: Tráfego Pago) — não devem aparecer em "Todos - Novos"
        const { data: inativos } = await sb.from('funis').select('id,nome').eq('ativo', false);
        funisInativosIds = (inativos || []).map(f => f.id);
        if (funisInativosIds.length) {
          console.log('[DASHBOARD_EXCLUIR_INATIVOS] funis inativos excluídos:', (inativos||[]).map(f=>f.nome));
        }
      } else if (funil_id) {
        console.log('[DASHBOARD_FILTER_FUNIL_SELECTED] funil_id:', funil_id);
      }
      if (responsavel_id) console.log('[DASHBOARD_FILTER_VENDEDOR_SELECTED]', responsavel_id);
      if (data_tipo)      console.log('[DASHBOARD_FILTER_DATE_SELECTED]', { data_tipo, data_periodo, data_inicio, data_fim });

      // ── 1. Carrega etapas — etapas usa funil_id ─────────────────────────────────
      const { data: todasEtapas } = await sb.from('etapas').select('id,nome,cor,ordem,probabilidade,is_ganho,is_perdido,funil_id');
      const etapaMap = Object.fromEntries((todasEtapas||[]).map(e => [e.id, e]));

      // ── 2. Monta query de leads ─────────────────────────────────────────────
      let q = sb.from('leads').select(
        'id,nome,status,valor,valor_venda,etapa_id,pipeline_id,funil_id,responsavel_id,' +
        'criado_em,atualizado_em,ganho_em,perdido_em,produto_id,produto_nome,forma_pagamento'
      );
      if (funil_id)           q = q.eq('funil_id', funil_id);
      if (carteiraFunilId)    q = q.neq('funil_id', carteiraFunilId);
      // Exclui leads de funis inativos (Tráfego Pago etc.) no modo "Todos - Novos"
      if (funisInativosIds.length) {
        const idsParaExcluir = funisInativosIds.filter(id => id !== carteiraFunilId);
        if (idsParaExcluir.length) q = q.not('funil_id', 'in', `(${idsParaExcluir.join(',')})`);
      }
      if (responsavel_id)     q = q.eq('responsavel_id', responsavel_id);
      if (req.usuario.role === 'VENDEDOR') q = q.eq('responsavel_id', req.usuario.id);

      // Filtro de data
      const periodo = calcPeriodo(data_tipo, data_periodo, data_inicio, data_fim);
      if (periodo?.ini || periodo?.fim) {
        const campo = campoData(data_tipo);
        if (periodo.ini) q = q.gte(campo, periodo.ini + 'T00:00:00');
        if (periodo.fim) q = q.lte(campo, periodo.fim + 'T23:59:59');
      }

      const { data: leads, error } = await q;
      if (error) throw error;

      // ── 3. KPIs ──────────────────────────────────────────────────────────────
      const ganhos   = leads.filter(l => isGanhoLead(l, etapaMap));
      const perdidos = leads.filter(l => isPerdidoLead(l, etapaMap));
      const abertos  = leads.filter(l => !isGanhoLead(l, etapaMap) && !isPerdidoLead(l, etapaMap));

      const faturamento  = ganhos.reduce((s,l) => s + valorVenda(l), 0);
      const ticket_medio = ganhos.length ? faturamento / ganhos.length : 0;
      const taxa_conversao = leads.length > 0 ? ((ganhos.length/leads.length)*100).toFixed(1) : '0.0';

      const kpis = {
        total_leads:    leads.length,
        total_ganhos:   ganhos.length,
        total_perdidos: perdidos.length,
        total_abertos:  abertos.length,
        faturamento,
        ticket_medio,
        taxa_conversao,
      };

      // ── 4. Funil Visual ─────────────────────────────────────────────────
      // Carrega a estrutura de etapas da pipeline real.
      // Leads são contados por etapa depois; etapas com 0 são preservadas.
      // Para posicionamento no funil: usa leads sem filtro de data, mas COM filtro de funil/vendedor.
      let leadsParaFunil = leads;
      if (periodo?.ini || periodo?.fim) {
        let qFunil = sb.from('leads').select('id,etapa_id,funil_id,status,ganho_em,perdido_em,valor,valor_venda');
        if (funil_id)         qFunil = qFunil.eq('funil_id', funil_id);
        if (carteiraFunilId)  qFunil = qFunil.neq('funil_id', carteiraFunilId);
        if (funisInativosIds.length) {
          const idsExcl = funisInativosIds.filter(id => id !== carteiraFunilId);
          if (idsExcl.length) qFunil = qFunil.not('funil_id', 'in', `(${idsExcl.join(',')})`);
        }
        if (responsavel_id)   qFunil = qFunil.eq('responsavel_id', responsavel_id);
        if (req.usuario.role === 'VENDEDOR') qFunil = qFunil.eq('responsavel_id', req.usuario.id);
        const { data: allLeads } = await qFunil;
        leadsParaFunil = allLeads || leads;
      }
      console.log('[DASHBOARD_RESULT_COUNTS] leads KPIs (filtrados):', leads.length, '| leads funil visual (sem filtro data):', leadsParaFunil.length);

      // ── Carrega etapas estruturais da pipeline do funil selecionado ─────────────
      // ARQUITETURA Supabase: etapas.funil_id → funis.id (sem pipeline_id na tabela etapas)
      let etapasEstrutura = [];
      const nomeParaIds = {}; // nome → [ids de etapas com esse nome]

      console.log('[DASHBOARD_FUNIL_CONVERSAO_START] funil_id:', funil_id || 'todos-novos', '| modo:', funil_id ? 'especifico' : 'todos-novos');

      if (funil_id) {
        // ── FUNIL ESPECÍFICO: carrega etapas diretamente do funil, ordenadas por ordem ──
        console.log('[DASHBOARD_FUNIL_FILTRO_RECEBIDO] funil_id:', funil_id);
        const { data: etFunil } = await sb.from('etapas')
          .select('id,nome,cor,ordem,probabilidade,is_ganho,is_perdido')
          .eq('funil_id', funil_id)
          .order('ordem', { ascending: true });
        etapasEstrutura = etFunil || [];
        // Filtra etapas obsoletas se for Carteira Recorrente
        const { data: funilSel } = await sb.from('funis').select('nome').eq('id', funil_id).single();
        if (/carteira\s*recorrente/i.test(funilSel?.nome || '')) {
          etapasEstrutura = etapasEstrutura.filter(e => !ETAPAS_CARTEIRA_REMOVIDAS.includes(e.nome));
        }
        // Monta mapa nome→[id] (sem dedup — funil único)
        etapasEstrutura.forEach(e => {
          nomeParaIds[e.nome] = [e.id];
        });
        console.log('[DASHBOARD_PIPELINES_ENCONTRADAS] funil_id:', funil_id, '| 1 pipeline');
        console.log('[DASHBOARD_ETAPAS_ENCONTRADAS] funil_id:', funil_id, '| etapas:', etapasEstrutura.length, '|', etapasEstrutura.map(e => `${e.ordem}:${e.nome}`).join(', '));
      } else {
        // ── TODOS - NOVOS: agrega etapas de todos os funis ativos, exceto Carteira Recorrente ──
        console.log('[DASHBOARD_FUNIL_FILTRO_RECEBIDO] modo: todos-novos');
        let { data: funisAtivos } = await sb.from('funis').select('id,nome').eq('ativo', true);
        funisAtivos = (funisAtivos || []).filter(f => {
          if (f.id === carteiraFunilId) return false; // exclui Carteira Recorrente
          if (funisInativosIds.includes(f.id)) return false; // exclui inativos
          return true;
        });
        console.log('[DASHBOARD_PIPELINES_ENCONTRADAS] todos-novos | funis comerciais ativos:', funisAtivos.map(f => f.nome).join(', '));

        if (funisAtivos.length) {
          const funilIds = funisAtivos.map(f => f.id);
          const { data: ets } = await sb.from('etapas')
            .select('id,nome,cor,ordem,probabilidade,is_ganho,is_perdido,funil_id')
            .in('funil_id', funilIds)
            .order('ordem', { ascending: true });
          // Dedup por nome: agrega ids de etapas com mesmo nome entre funis
          const seen = new Set();
          for (const e of (ets || [])) {
            if (!nomeParaIds[e.nome]) nomeParaIds[e.nome] = [];
            nomeParaIds[e.nome].push(e.id);
            if (!seen.has(e.nome)) {
              seen.add(e.nome);
              etapasEstrutura.push(e);
            }
          }
          etapasEstrutura.sort((a, b) => a.ordem - b.ordem);
        }
        console.log('[DASHBOARD_ETAPAS_ENCONTRADAS] todos-novos | etapas dedup:', etapasEstrutura.length, '|', etapasEstrutura.map(e => `${e.ordem}:${e.nome}`).join(', '));
      }

      // ⚠️ NÃO adiciona etapas "órfãs" (leads cujas etapas não estão na pipeline do funil selecionado).
      // Isso causava contaminacao do funil com etapas de outros funis.
      // Etapas com 0 leads JA aparecem porque a estrutura de etapas vem da pipeline, não dos leads.

      console.log('[DASHBOARD_PIPELINE_SELECTED]', funil_id || 'todos-novos', '| etapas finais:', etapasEstrutura.length, '|', etapasEstrutura.map(e => `${e.ordem}:${e.nome}`).join(', '));

      // ── Conta leads por etapa (respeitando todos os filtros) ────────────────────
      // Etapas com 0 leads SEMPRE aparecem porque a estrutura vem da pipeline
      const funil_visual_raw = etapasEstrutura.map(e => {
        const ids = nomeParaIds[e.nome] || [e.id];
        const qty = leadsParaFunil.filter(l => ids.includes(l.etapa_id)).length;
        const isG = e.is_ganho || e.probabilidade >= 100 || /venda|vendas|ganho|fechad|fechamento/i.test(e.nome||'');
        const isP = e.is_perdido || /perdid|desqualif/i.test(e.nome||'');
        return { ...e, is_ganho: isG?1:0, is_perdido: isP?1:0, quantidade: qty };
      });

      const funil_visual = funil_visual_raw.map((e, i) => {
        const prev = i > 0 ? funil_visual_raw[i-1].quantidade : null;
        const taxa_entrada = prev != null && prev > 0 ? ((e.quantidade/prev)*100).toFixed(0) : null;
        return { ...e, taxa_entrada };
      });

      console.log('[DASHBOARD_FUNIL_CONVERSAO_RESULTADO]',
        funil_visual.map(e => `${e.nome}:${e.quantidade}(${e.taxa_entrada ?? '—'}%)`).join(' → '));

      // ── 5. Ranking vendedores ─────────────────────────────────────────────────
      // Carrega SOMENTE usuários ativos
      const { data: usuariosAtivos } = await sb.from('usuarios')
        .select('id,nome,role')
        .eq('ativo', true);
      const usuariosAtivosMap = Object.fromEntries((usuariosAtivos||[]).map(u => [u.id, u]));
      const idsAtivos = new Set(Object.keys(usuariosAtivosMap));

      // Para conversão correta: busca TODOS os leads do período sem filtro de status
      // (leads filtrados por data podem ser apenas os ganhos quando data_tipo=fechamento)
      // Precisamos do total de leads por vendedor para calcular taxa de conversão real
      let todosLeadsRankingBase = leads;
      const temFiltroData = periodo?.ini || periodo?.fim;
      if (temFiltroData && data_tipo === 'fechamento') {
        // Busca todos os leads (sem filtro de data) para contar o total por vendedor
        let qTodos = sb.from('leads').select('id,responsavel_id,status,etapa_id,ganho_em,perdido_em');
        if (funil_id)           qTodos = qTodos.eq('funil_id', funil_id);
        if (carteiraFunilId)    qTodos = qTodos.neq('funil_id', carteiraFunilId);
        // Exclui funis inativos (Tráfego Pago etc.) no ranking também
        if (funisInativosIds.length) {
          const idsExcl = funisInativosIds.filter(id => id !== carteiraFunilId);
          if (idsExcl.length) qTodos = qTodos.not('funil_id', 'in', `(${idsExcl.join(',')})`);
        }
        if (responsavel_id)     qTodos = qTodos.eq('responsavel_id', responsavel_id);
        if (req.usuario.role === 'VENDEDOR') qTodos = qTodos.eq('responsavel_id', req.usuario.id);
        qTodos = qTodos.is('deleted_at', null);
        const { data: todosLeads } = await qTodos;
        todosLeadsRankingBase = todosLeads || leads;
      }

      // Mapa: total de leads por vendedor (para denominador de conversão)
      const totalLeadsMap = {};
      todosLeadsRankingBase.forEach(l => {
        if (!l.responsavel_id || !idsAtivos.has(l.responsavel_id)) return;
        totalLeadsMap[l.responsavel_id] = (totalLeadsMap[l.responsavel_id] || 0) + 1;
      });

      // Dados de ganho/faturamento vêm dos leads já filtrados pelo período
      const vendedorMap = {};
      leads.forEach(l => {
        if (!l.responsavel_id) return;
        if (!idsAtivos.has(l.responsavel_id)) return;
        if (!vendedorMap[l.responsavel_id]) vendedorMap[l.responsavel_id] = { id:l.responsavel_id, leads:0, ganhos:0, faturamento:0 };
        // 'leads' aqui = leads no período filtrado (para KPI de leads no período)
        vendedorMap[l.responsavel_id].leads++;
        if (isGanhoLead(l, etapaMap)) {
          vendedorMap[l.responsavel_id].ganhos++;
          vendedorMap[l.responsavel_id].faturamento += valorVenda(l);
        }
      });

      const ranking = Object.values(vendedorMap)
        .sort((a,b) => b.faturamento - a.faturamento)
        .slice(0, 10)
        .map(r => {
          // Usa total real de leads para conversão
          const totalLeads = totalLeadsMap[r.id] || r.leads;
          return {
            ...r,
            nome: usuariosAtivosMap[r.id]?.nome || '—',
            conversao: totalLeads > 0 ? ((r.ganhos/totalLeads)*100).toFixed(1) : '0.0',
          };
        });

      // ── 6. Por funil ─────────────────────────────────────────────────────────
      const porFunilMap = {};
      leads.forEach(l => {
        const fid = l.funil_id;
        if (!fid) return;
        if (!porFunilMap[fid]) porFunilMap[fid] = { id:fid, leads:0, ganhos:0, faturamento:0 };
        porFunilMap[fid].leads++;
        if (isGanhoLead(l, etapaMap)) {
          porFunilMap[fid].ganhos++;
          porFunilMap[fid].faturamento += valorVenda(l);
        }
      });
      let por_funil = [];
      if (Object.keys(porFunilMap).length) {
        const fids = Object.keys(porFunilMap);
        const { data: funisList } = await sb.from('funis').select('id,nome,cor').in('id', fids);
        const funisMap = Object.fromEntries((funisList||[]).map(f => [f.id, f]));
        por_funil = Object.values(porFunilMap).map(f => ({
          ...f,
          nome: funisMap[f.id]?.nome || f.id,
          cor:  funisMap[f.id]?.cor  || '#6CFF4E',
        })).sort((a,b) => b.faturamento - a.faturamento);
      }

      // ── 7. Leads por dia (últimos 30 dias) — respeitando exclusão de inativos e Carteira ──
      const { data: leadsAll30 } = await (() => {
        const d30 = new Date(); d30.setDate(d30.getDate()-30);
        let q2 = sb.from('leads').select('criado_em,ganho_em,status,etapa_id,valor,valor_venda');
        if (funil_id)           q2 = q2.eq('funil_id', funil_id);
        if (carteiraFunilId)    q2 = q2.neq('funil_id', carteiraFunilId);
        // Exclui funis inativos (Tráfego Pago etc.) no gráfico de leads por dia
        if (funisInativosIds.length) {
          const idsExcl = funisInativosIds.filter(id => id !== carteiraFunilId);
          if (idsExcl.length) q2 = q2.not('funil_id', 'in', `(${idsExcl.join(',')})`);
        }
        if (responsavel_id)     q2 = q2.eq('responsavel_id', responsavel_id);
        if (req.usuario.role === 'VENDEDOR') q2 = q2.eq('responsavel_id', req.usuario.id);
        q2 = q2.gte('criado_em', d30.toISOString());
        return q2;
      })();

      // Agrupa por dia
      const diaMap = {};
      for (const l of (leadsAll30||[])) {
        const dia = (l.criado_em||'').slice(0,10);
        if (!dia) continue;
        if (!diaMap[dia]) diaMap[dia] = { dia, quantidade:0, ganhos:0 };
        diaMap[dia].quantidade++;
        if (isGanhoLead(l, etapaMap)) diaMap[dia].ganhos++;
      }
      const leads_por_dia = Object.values(diaMap).sort((a,b) => a.dia.localeCompare(b.dia));

      return res.json({ sucesso:true, dados:{
        kpis,
        funil_visual,
        por_funil,
        ranking,
        tempo_resposta: { media_minutos: null, leads_com_resposta: 0 },
        leads_por_dia,
      }});
    }

    // ── SQLite ────────────────────────────────────────────────────────────────
    const { getDb } = require('../database/db');
    const db = getDb();

    // Resolve Carteira Recorrente e funis inativos para exclusão (Todos - Novos)
    let carteiraFunilIdSql = null;
    let funisInativosSql = []; // ids de funis inativos (ex: Tráfego Pago)
    if (excluiCarteira) {
      const cr = db.prepare(`SELECT id FROM funis WHERE nome LIKE '%Carteira Recorrente%' LIMIT 1`).get();
      carteiraFunilIdSql = cr?.id || null;
      console.log('[DASH_EXCLUIR_CARTEIRA_SQL] excluindo funil_id:', carteiraFunilIdSql);
      // Funis inativos (Tráfego Pago etc.)
      const inativosRows = db.prepare(`SELECT id FROM funis WHERE ativo=0`).all();
      funisInativosSql = inativosRows.map(f => f.id).filter(id => id !== carteiraFunilIdSql);
      if (funisInativosSql.length) console.log('[DASH_EXCLUIR_INATIVOS_SQL] ids:', funisInativosSql);
    }

    const base = `FROM leads l LEFT JOIN pipelines p ON l.pipeline_id=p.id LEFT JOIN funis f ON p.funil_id=f.id LEFT JOIN usuarios u ON l.responsavel_id=u.id WHERE 1=1`;
    const baseParams = [];
    let baseFilter = '';
    if (funil_id)          { baseFilter += ' AND p.funil_id=?';         baseParams.push(funil_id); }
    if (carteiraFunilIdSql){ baseFilter += ' AND (p.funil_id IS NULL OR p.funil_id<>?)'; baseParams.push(carteiraFunilIdSql); }
    // Exclui funis inativos (ex: Tráfego Pago) no modo "Todos - Novos"
    if (funisInativosSql.length) {
      const ph = funisInativosSql.map(() => '?').join(',');
      baseFilter += ` AND (p.funil_id IS NULL OR p.funil_id NOT IN (${ph}))`;
      baseParams.push(...funisInativosSql);
    }
    if (responsavel_id)    { baseFilter += ' AND l.responsavel_id=?';   baseParams.push(responsavel_id); }
    if (req.usuario.role === 'VENDEDOR') { baseFilter += ' AND l.responsavel_id=?'; baseParams.push(req.usuario.id); }

    const periodo = calcPeriodo(data_tipo, data_periodo, data_inicio, data_fim);
    if (periodo?.ini || periodo?.fim) {
      const campo = campoData(data_tipo);
      if (periodo.ini) { baseFilter += ` AND l.${campo}>=?`; baseParams.push(periodo.ini + 'T00:00:00'); }
      if (periodo.fim) { baseFilter += ` AND l.${campo}<=?`; baseParams.push(periodo.fim + 'T23:59:59'); }
    }

    const params = [...baseParams];
    const ganhoExpr  = `(UPPER(l.status)='GANHO' OR UPPER(l.status)='VENDIDO' OR UPPER(l.status)='VENDA' OR l.ganho_em IS NOT NULL)`;
    const perdExpr   = `(UPPER(l.status)='PERDIDO' OR l.perdido_em IS NOT NULL)`;
    const valorExpr  = `COALESCE(NULLIF(l.valor_venda,0), l.valor, 0)`;

    const kpis = db.prepare(`SELECT COUNT(*) as total_leads,
      SUM(CASE WHEN ${ganhoExpr} THEN 1 ELSE 0 END) as total_ganhos,
      SUM(CASE WHEN ${perdExpr} THEN 1 ELSE 0 END) as total_perdidos,
      SUM(CASE WHEN NOT(${ganhoExpr}) AND NOT(${perdExpr}) THEN 1 ELSE 0 END) as total_abertos,
      SUM(CASE WHEN ${ganhoExpr} THEN ${valorExpr} ELSE 0 END) as faturamento,
      AVG(CASE WHEN ${ganhoExpr} THEN ${valorExpr} ELSE NULL END) as ticket_medio
      ${base}${baseFilter}`).get(...params);

    const taxa_conversao = kpis.total_leads > 0 ? ((kpis.total_ganhos/kpis.total_leads)*100).toFixed(1) : '0.0';

    // ── Funil Visual (SQLite) — lê dinamicamente do banco, sem hardcode ─────────
    console.log('[DASHBOARD_FUNIL_CONVERSAO_START] funil_id:', funil_id || 'todos-novos', '| modo:', funil_id ? 'especifico' : 'todos-novos');
    let etapas = [];
    let etapaNomeParaIds = {}; // nome → [ids] para agregação "Todos - Novos"

    if (funil_id) {
      // ── FUNIL ESPECÍFICO: carrega etapas da pipeline vinculada ao funil ──
      console.log('[DASHBOARD_FUNIL_FILTRO_RECEBIDO] funil_id:', funil_id);
      const pipeRow = db.prepare(`SELECT id FROM pipelines WHERE funil_id=? ORDER BY ordem ASC LIMIT 1`).get(funil_id);
      console.log('[DASHBOARD_PIPELINES_ENCONTRADAS] funil_id:', funil_id, '| pipeline:', pipeRow?.id || 'não encontrada');
      if (pipeRow) {
        etapas = db.prepare(`SELECT e.id,e.nome,e.cor,e.ordem,e.is_ganho,e.is_perdido
          FROM etapas e WHERE e.pipeline_id=? ORDER BY e.ordem ASC`).all(pipeRow.id);
      }
      // Filtra etapas removidas se for Carteira Recorrente
      const funilSelSql = db.prepare('SELECT nome FROM funis WHERE id=? LIMIT 1').get(funil_id);
      if (/carteira\s*recorrente/i.test(funilSelSql?.nome || '')) {
        etapas = etapas.filter(e => !ETAPAS_CARTEIRA_REMOVIDAS.includes(e.nome));
      }
      // Mapa nome→[id] — sem dedup necessária (pipeline única)
      etapas.forEach(e => { etapaNomeParaIds[e.nome] = [e.id]; });
      console.log('[DASHBOARD_ETAPAS_ENCONTRADAS] funil_id:', funil_id, '| etapas:', etapas.length, '|', etapas.map(e => `${e.ordem}:${e.nome}`).join(', '));
    } else {
      // ── TODOS - NOVOS: agrega etapas de todos os pipelines comerciais ativos ──
      // Exclui: Carteira Recorrente, funis inativos (Tráfego Pago)
      console.log('[DASHBOARD_FUNIL_FILTRO_RECEBIDO] modo: todos-novos');
      let pipeQuery = `SELECT p.id, p.funil_id FROM pipelines p
        JOIN funis f ON p.funil_id = f.id
        WHERE f.ativo = 1`;
      const pipeParams = [];
      if (carteiraFunilIdSql) {
        pipeQuery += ` AND p.funil_id <> ?`;
        pipeParams.push(carteiraFunilIdSql);
      }
      if (funisInativosSql.length) {
        const ph = funisInativosSql.map(() => '?').join(',');
        pipeQuery += ` AND p.funil_id NOT IN (${ph})`;
        pipeParams.push(...funisInativosSql);
      }
      const pipes = db.prepare(pipeQuery).all(...pipeParams);
      const pipeIds = pipes.map(p => p.id);
      console.log('[DASHBOARD_PIPELINES_ENCONTRADAS] todos-novos | pipelines encontradas:', pipeIds.length);

      const todasEtapas = pipeIds.length
        ? db.prepare(`SELECT e.id,e.nome,e.cor,e.ordem,e.is_ganho,e.is_perdido
            FROM etapas e WHERE e.pipeline_id IN (${pipeIds.map(() => '?').join(',')})
            ORDER BY e.ordem ASC`).all(...pipeIds)
        : [];

      // Dedup por nome — agrega ids para somar leads entre funis equivalentes
      const seen = new Map();
      todasEtapas.forEach(e => {
        if (!etapaNomeParaIds[e.nome]) etapaNomeParaIds[e.nome] = [];
        etapaNomeParaIds[e.nome].push(e.id);
        if (!seen.has(e.nome)) seen.set(e.nome, e);
      });
      etapas = Array.from(seen.values()).sort((a, b) => a.ordem - b.ordem);
      console.log('[DASHBOARD_ETAPAS_ENCONTRADAS] todos-novos | etapas dedup:', etapas.length, '|', etapas.map(e => `${e.ordem}:${e.nome}`).join(', '));
    }
    console.log('[DASHBOARD_PIPELINE_SELECTED]', funil_id || 'todos-novos', '| etapas finais:', etapas.length);


    // Conta leads por etapa (ou grupo de etapas com mesmo nome), respeitando todos os filtros
    const funil_visual = etapas.map((e, i) => {
      // Para "Todos - Novos": usa todos os ids de etapas com mesmo nome
      const idsEtapa = funil_id ? [e.id] : (etapaNomeParaIds[e.nome] || [e.id]);
      const placeholders = idsEtapa.map(() => '?').join(',');

      const cntSql = `SELECT COUNT(*) as c FROM leads l
        LEFT JOIN pipelines p ON l.pipeline_id=p.id
        WHERE l.etapa_id IN (${placeholders})
        ${funil_id ? 'AND p.funil_id=?' : ''}
        ${baseFilter.replace(/^\s*AND /, 'AND ')}`;
      const cntFinalParams = funil_id
        ? [...idsEtapa, funil_id, ...baseParams]
        : [...idsEtapa, ...baseParams];
      const countRow = db.prepare(cntSql).get(...cntFinalParams);

      // Taxa de conversão em relação à etapa anterior
      let taxa_entrada = null;
      if (i > 0) {
        const anterior = etapas[i - 1];
        const idsAnt = funil_id ? [anterior.id] : (etapaNomeParaIds[anterior.nome] || [anterior.id]);
        const antPh = idsAnt.map(() => '?').join(',');
        const antSql = `SELECT COUNT(*) as c FROM leads l LEFT JOIN pipelines p ON l.pipeline_id=p.id
          WHERE l.etapa_id IN (${antPh})
          ${funil_id ? 'AND p.funil_id=?' : ''}
          ${baseFilter.replace(/^\s*AND /, 'AND ')}`;
        const antParams = funil_id ? [...idsAnt, funil_id, ...baseParams] : [...idsAnt, ...baseParams];
        const ac = db.prepare(antSql).get(...antParams);
        taxa_entrada = ac.c > 0 ? ((countRow.c / ac.c) * 100).toFixed(0) : null;
      }
      const isG = e.is_ganho || /venda|vendas|ganho|fechad|fechamento/i.test(e.nome || '');
      const isP = e.is_perdido || /perdid|desqualif/i.test(e.nome || '');
      return { id: e.id, nome: e.nome, cor: e.cor, ordem: e.ordem,
        is_ganho: isG ? 1 : 0, is_perdido: isP ? 1 : 0, quantidade: countRow.c, taxa_entrada };
    });
    console.log('[DASHBOARD_FUNIL_CONVERSAO_RESULTADO]',
      funil_visual.map(e => `${e.nome}:${e.quantidade}(${e.taxa_entrada ?? '—'}%)`).join(' → '));



    // Ranking: quando filtro é por fechamento, precisamos do total de leads (sem filtro de data)
    // para calcular taxa de conversão corretamente
    let rankingRows;
    if (data_tipo === 'fechamento' && (periodo?.ini || periodo?.fim)) {
      // Busca faturamento/ganhos no período filtrado
      rankingRows = db.prepare(`SELECT u.id,u.nome,
        SUM(CASE WHEN ${ganhoExpr} THEN 1 ELSE 0 END) as ganhos,
        SUM(CASE WHEN ${ganhoExpr} THEN ${valorExpr} ELSE 0 END) as faturamento
        ${base}${baseFilter} GROUP BY u.id,u.nome ORDER BY faturamento DESC LIMIT 10`
      ).all(...params);

      // Busca total real de leads por vendedor (sem filtro de data)
      let baseFilterSemData = '';
      const paramsSemData = [];
      if (funil_id)       { baseFilterSemData += ' AND p.funil_id=?';       paramsSemData.push(funil_id); }
      if (responsavel_id) { baseFilterSemData += ' AND l.responsavel_id=?'; paramsSemData.push(responsavel_id); }
      if (req.usuario.role === 'VENDEDOR') { baseFilterSemData += ' AND l.responsavel_id=?'; paramsSemData.push(req.usuario.id); }
      const totalLeadsPorVend = db.prepare(
        `SELECT l.responsavel_id, COUNT(*) as total ${base}${baseFilterSemData} GROUP BY l.responsavel_id`
      ).all(...paramsSemData);
      const totalLeadsMap = Object.fromEntries(totalLeadsPorVend.map(r => [r.responsavel_id, r.total]));

      rankingRows = rankingRows.map(r => ({
        ...r,
        leads: totalLeadsMap[r.id] || r.ganhos,
        conversao: (totalLeadsMap[r.id] || 0) > 0
          ? ((r.ganhos / totalLeadsMap[r.id]) * 100).toFixed(1)
          : '0.0',
      }));
    } else {
      rankingRows = db.prepare(`SELECT u.id,u.nome,COUNT(*) as leads,
        SUM(CASE WHEN ${ganhoExpr} THEN 1 ELSE 0 END) as ganhos,
        SUM(CASE WHEN ${ganhoExpr} THEN ${valorExpr} ELSE 0 END) as faturamento
        ${base}${baseFilter} GROUP BY u.id,u.nome ORDER BY faturamento DESC LIMIT 10`
      ).all(...params).map(r => ({...r, conversao:r.leads>0?((r.ganhos/r.leads)*100).toFixed(1):'0.0'}));
    }
    const ranking = rankingRows;

    const por_funil = db.prepare(`SELECT f.id,f.nome,f.cor,COUNT(*) as leads,
      SUM(CASE WHEN ${ganhoExpr} THEN 1 ELSE 0 END) as ganhos,
      SUM(CASE WHEN ${ganhoExpr} THEN ${valorExpr} ELSE 0 END) as faturamento
      ${base}${baseFilter} GROUP BY f.id,f.nome,f.cor ORDER BY faturamento DESC`
    ).all(...params);

    const leads_por_dia = db.prepare(`SELECT date(l.criado_em) as dia, COUNT(*) as quantidade,
      SUM(CASE WHEN ${ganhoExpr} THEN 1 ELSE 0 END) as ganhos
      ${base}${baseFilter} GROUP BY dia ORDER BY dia ASC LIMIT 30`
    ).all(...params);

    return res.json({ sucesso:true, dados:{
      kpis: { ...kpis, taxa_conversao },
      funil_visual,
      por_funil,
      ranking,
      tempo_resposta: { media_minutos: null, leads_com_resposta: 0 },
      leads_por_dia,
    }});

  } catch(e) {
    console.error('[dashboard.resumo]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

module.exports = { resumo };
