/**
 * PROSPEKT CRM — Dashboard Controller v2
 * Corrige: filtros de data, status case-insensitive, valor_venda, ganho real.
 */
const { getProvider } = require('../database/dbProvider');
const { ETAPAS_CARTEIRA_REMOVIDAS, ETAPAS_GLOBAIS_REMOVIDAS, ETAPAS_SEM_DASHBOARD } = require('./funisController');
const etapaHistoricoSvc = require('../services/etapaHistoricoService');

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

// isPerdidoLead declarada ANTES de isGanhoLead (que a referencia)
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

function isGanhoLead(l, etapaMap) {
  // ── REGRA CRÍTICA: lead perdido NUNCA conta como venda ──────────────────────
  // Perdido tem prioridade absoluta — mesmo que tenha ganho_em preenchido
  if (isPerdidoLead(l, etapaMap)) return false;

  const s = (l.status||'').toUpperCase();
  if (['GANHO','VENDIDO','VENDA'].includes(s)) return true;
  if (l.ganho_em) return true;
  const et = etapaMap[l.etapa_id];
  if (et?.is_ganho) return true;
  if (et?.probabilidade >= 100) return true;
  if (/venda|vendas|ganho|fechad|fechamento/i.test(et?.nome||'')) return true;
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
  console.log('[FILTRO_VENDEDOR_BACKEND_RECEBIDO] dashboard.resumo | responsavel_id:', responsavel_id || '(nao enviado/todos)', '| role:', req.usuario?.role);

  try {
    if (isSupa) {
      // ── 0. Resolve ids de funis a excluir em modo "Todos - Novos" ──────────────
      // Exclui: Carteira Recorrente + Adm. de Vendas + funis inativos
      // SEMPRE resolve no modo todos-novos para garantir consistência em todos os indicadores.
      let carteiraFunilId  = null;
      let admFunilId       = null;              // ← NOVO: Adm. de Vendas também excluído
      let funisExcluirIds  = [];               // ids combinados (carteira + adm + inativos)
      let funisInativosIds = [];

      if (!funil_id) {
        // Modo todos-novos: busca Carteira Recorrente e Adm. de Vendas para excluir
        const [{ data: cr }, { data: adm }, { data: inativos }] = await Promise.all([
          sb.from('funis').select('id,nome').ilike('nome','%Carteira%').limit(5),
          sb.from('funis').select('id,nome').or('nome.ilike.%Adm%,nome.ilike.%Administra%').limit(5),
          sb.from('funis').select('id,nome').in('ativo', [0, false]),
        ]);

        // Carteira Recorrente — qualquer funil com "Carteira" no nome (inclui variações)
        carteiraFunilId = (cr || []).find(f => /carteira/i.test(f.nome))?.id || null;
        console.log('[DASH_TODOS_NOVOS] Carteira Recorrente id:', carteiraFunilId, '| nome:', (cr||[]).find(f=>/carteira/i.test(f.nome))?.nome);

        // Adm. de Vendas — qualquer funil com "Adm" ou "Administra"
        admFunilId = (adm || []).find(f => /adm|administra/i.test(f.nome))?.id || null;
        console.log('[DASH_TODOS_NOVOS] Adm. de Vendas id:', admFunilId, '| nome:', (adm||[]).find(f=>/adm|administra/i.test(f.nome))?.nome);

        // Funis inativos (ex: Tráfego Pago) — campo INTEGER, usar in([0,false])
        funisInativosIds = (inativos || []).map(f => f.id);
        if (funisInativosIds.length) {
          console.log('[DASH_TODOS_NOVOS] funis inativos excluidos:', (inativos||[]).map(f=>f.nome));
        }

        // Lista unificada de ids a excluir
        funisExcluirIds = [...new Set([carteiraFunilId, admFunilId, ...funisInativosIds].filter(Boolean))];
        console.log('[DASH_TODOS_NOVOS] total funis excluidos:', funisExcluirIds.length);

      } else if (excluiCarteira) {
        // Compat: excluiCarteira ainda funciona como fallback
        const [{ data: cr }, { data: inativos }] = await Promise.all([
          sb.from('funis').select('id,nome').ilike('nome','%Carteira%').limit(5),
          sb.from('funis').select('id,nome').in('ativo', [0, false]),
        ]);
        carteiraFunilId = (cr || []).find(f => /carteira/i.test(f.nome))?.id || null;
        funisInativosIds = (inativos || []).map(f => f.id);
        funisExcluirIds  = [...new Set([carteiraFunilId, ...funisInativosIds].filter(Boolean))];
        console.log('[DASH_EXCLUIR_CARTEIRA] excluindo Carteira id:', carteiraFunilId);
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
      if (funil_id)    q = q.eq('funil_id', funil_id);
      // Exclui funis operacionais (Carteira + Adm) e inativos em "Todos - Novos"
      if (funisExcluirIds?.length) {
        q = q.not('funil_id', 'in', `(${funisExcluirIds.join(',')})`);
      } else if (carteiraFunilId) {
        // Fallback compat
        q = q.neq('funil_id', carteiraFunilId);
      }
      // Fix #3: exclui clones de Carteira Recorrente da contagem de leads recebidos
      q = q.is('tipo_clone', null);
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
      // Fix #4: perdidos filtrados por perdido_em quando há filtro de data
      let perdidos = leads.filter(l => isPerdidoLead(l, etapaMap));
      if (periodo?.ini || periodo?.fim) {
        // Perdidos SEMPRE filtrados por perdido_em (independente do data_tipo principal)
        // Isso garante que o card de perdidos não "some" quando data_tipo=fechamento
        const ini = periodo.ini ? new Date(periodo.ini + 'T00:00:00').getTime() : null;
        const fim = periodo.fim ? new Date(periodo.fim + 'T23:59:59').getTime() : null;
        if (data_tipo === 'perdido' || data_tipo === 'perda') {
          // Já filtrado pelo campo perdido_em via query principal
          perdidos = perdidos.filter(l => {
            if (!l.perdido_em) return false;
            const t = new Date(l.perdido_em).getTime();
            if (ini && t < ini) return false;
            if (fim && t > fim) return false;
            return true;
          });
        } else {
          // Para outros tipos de data: busca perdidos adicionais por perdido_em
          // mas NÃO filtra pela data (já que a query foi filtrada por outro campo)
          // Mantém todos os perdidos que existem nos leads do período
          // (ex: lead criado no período que foi perdido)
          // Nenhuma mudança necessária — perdidos já vêm do array `leads` filtrado
        }
      }
      const ganhos   = leads.filter(l => isGanhoLead(l, etapaMap));
      const abertos  = leads.filter(l => !isGanhoLead(l, etapaMap) && !isPerdidoLead(l, etapaMap));

      // Fix #1: NO modo Todos-Novos, Carteira Recorrente NÃO é somada ao faturamento.
      let faturamento  = ganhos.reduce((s,l) => s + valorVenda(l), 0);
      let totalGanhos  = ganhos.length;

      // Fix #1: Carteira Recorrente excluída da query via neq('funil_id', carteiraFunilId)
      // NÃO somamos vendas da Carteira no total de Todos-Novos — cada funil conta separado.

      const ticket_medio   = totalGanhos ? faturamento / totalGanhos : 0;
      const taxa_conversao = leads.length > 0 ? ((ganhos.length/leads.length)*100).toFixed(1) : '0.0';

      const kpis = {
        total_leads:    leads.length,
        total_ganhos:   totalGanhos,
        total_perdidos: perdidos.length,
        total_abertos:  abertos.length,
        faturamento,
        ticket_medio,
        taxa_conversao,
      };

      // ── 4. Funil Visual ─────────────────────────────────────────────────
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
        // Exclui clones da Carteira Recorrente (mesmo filtro do array principal)
        qFunil = qFunil.is('tipo_clone', null);
        const { data: allLeads } = await qFunil;
        leadsParaFunil = allLeads || leads;
      }

      let etapasEstrutura = [];
      const nomeParaIds = {}; 

      if (funil_id) {
        const { data: funilSel } = await sb.from('funis').select('id,nome').eq('id', funil_id).single();
        const { data: pipesF } = await sb.from('pipelines').select('id').eq('funil_id', funil_id).order('criado_em', { ascending: true }).limit(1);
        const pipeIdF = pipesF?.[0]?.id || null;
        if (pipeIdF) {
          const { data: etPipe } = await sb.from('etapas')
            .select('id,nome,cor,ordem,probabilidade,is_ganho,is_perdido')
            .eq('pipeline_id', pipeIdF)
            .order('ordem', { ascending: true });
          etapasEstrutura = etPipe || [];
        }
        const { data: etFunil } = await sb.from('etapas')
          .select('id,nome,cor,ordem,probabilidade,is_ganho,is_perdido')
          .eq('funil_id', funil_id)
          .order('ordem', { ascending: true });
        const nomesPipeline = new Set(etapasEstrutura.map(e => e.nome));
        for (const e of (etFunil || [])) {
          if (!nomesPipeline.has(e.nome)) {
            etapasEstrutura.push(e);
            nomesPipeline.add(e.nome);
          }
        }
        etapasEstrutura.sort((a, b) => a.ordem - b.ordem);
        if (/carteira\s*recorrente/i.test(funilSel?.nome || '')) {
          etapasEstrutura = etapasEstrutura.filter(e => !ETAPAS_CARTEIRA_REMOVIDAS.includes(e.nome));
        }
        etapasEstrutura = etapasEstrutura.filter(e => !ETAPAS_GLOBAIS_REMOVIDAS.includes(e.nome));
        etapasEstrutura = etapasEstrutura.filter(e => !ETAPAS_SEM_DASHBOARD.includes(e.nome));
        etapasEstrutura.forEach(e => { nomeParaIds[e.nome] = [e.id]; });
      } else {
        let { data: funisAtivos } = await sb.from('funis').select('id,nome').in('ativo', [1, true]);
        funisAtivos = (funisAtivos || []).filter(f => {
          // Exclui a lista unificada de funis operacionais/inativos (Carteira + Adm + inativos)
          if (funisExcluirIds?.length && funisExcluirIds.includes(f.id)) return false;
          // Guards de nome como segunda camada de defesa
          if (/carteira/i.test(f.nome || '')) return false;
          if (/adm\.?\s*(de\s*)?vendas|administra/i.test(f.nome || '')) return false;
          if (/BASE.?Antiga|teste/i.test(f.nome || '')) return false;
          return true;
        });

        if (funisAtivos.length) {
          const funilIds = funisAtivos.map(f => f.id);
          const { data: pipesT } = await sb.from('pipelines').select('id,funil_id').in('funil_id', funilIds);
          const pipeIdsT = (pipesT || []).map(p => p.id);

          let todasEtapasT = [];
          if (pipeIdsT.length) {
            const { data: etsPipe } = await sb.from('etapas')
              .select('id,nome,cor,ordem,probabilidade,is_ganho,is_perdido,pipeline_id')
              .in('pipeline_id', pipeIdsT)
              .order('ordem', { ascending: true });
            todasEtapasT = etsPipe || [];
          }
          const { data: etsFunil } = await sb.from('etapas')
            .select('id,nome,cor,ordem,probabilidade,is_ganho,is_perdido,funil_id')
            .in('funil_id', funilIds)
            .order('ordem', { ascending: true });
          const idsJaAdicionados = new Set(todasEtapasT.map(e => e.id));
          for (const e of (etsFunil || [])) {
            if (!idsJaAdicionados.has(e.id)) {
              todasEtapasT.push(e);
              idsJaAdicionados.add(e.id);
            }
          }
          todasEtapasT.sort((a, b) => a.ordem - b.ordem);

          const seen = new Set();
          for (const e of todasEtapasT) {
            if (!nomeParaIds[e.nome]) nomeParaIds[e.nome] = [];
            nomeParaIds[e.nome].push(e.id);
            if (!seen.has(e.nome)) {
              seen.add(e.nome);
              etapasEstrutura.push(e);
            }
          }
          etapasEstrutura.sort((a, b) => a.ordem - b.ordem);
        }
        etapasEstrutura = etapasEstrutura.filter(e => !ETAPAS_GLOBAIS_REMOVIDAS.includes(e.nome));
        etapasEstrutura = etapasEstrutura.filter(e => !ETAPAS_SEM_DASHBOARD.includes(e.nome));
      }

      const todosEtapaIds = [...new Set(Object.values(nomeParaIds).flat())];
      const leadIdsEscopo = new Set(leadsParaFunil.map(l => l.id));
      let passagemMap = {}; 

      if (todosEtapaIds.length) {
        passagemMap = await etapaHistoricoSvc.buscarPassagensPorEtapa({
          etapaIds: todosEtapaIds,
          leadIds:  [...leadIdsEscopo],
          dataIni:  periodo?.ini || null,
          dataFim:  periodo?.fim || null,
        });
      }

      const funil_visual_raw = etapasEstrutura.map(e => {
        const ids = nomeParaIds[e.nome] || [e.id];
        const leadIdsPassaram = new Set();
        for (const eid of ids) {
          for (const lid of (passagemMap[eid] || [])) leadIdsPassaram.add(lid);
        }
        const qty = leadIdsPassaram.size;
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
      // Fix: busca TODOS os usuários sem filtro de ativo (campo INTEGER bugado com .in())
      // Filtra no Node-side para garantir consistência (mesmo padrão do resto do sistema)
      const { data: todosUsuarios } = await sb.from('usuarios').select('id,nome,role,ativo');
      const usuariosAtivosMap = Object.fromEntries(
        (todosUsuarios || []).filter(u =>
          u.ativo === true || u.ativo === 1 || u.ativo === '1'
        ).map(u => [u.id, u])
      );
      const idsAtivos = new Set(Object.keys(usuariosAtivosMap));

      // Precisamos do total de leads por vendedor para calcular taxa de conversão real
      let todosLeadsRankingBase = leads;
      const temFiltroData = periodo?.ini || periodo?.fim;
      if (temFiltroData && data_tipo === 'fechamento') {
        // Busca todos os leads (sem filtro de data) para contar o total por vendedor
        let qTodos = sb.from('leads').select('id,responsavel_id,status,etapa_id,ganho_em,perdido_em');
        if (funil_id)    qTodos = qTodos.eq('funil_id', funil_id);
        // Aplica mesma exclusão de funis operacionais/inativos
        if (funisExcluirIds?.length) {
          qTodos = qTodos.not('funil_id', 'in', `(${funisExcluirIds.join(',')})`);
        } else if (carteiraFunilId) {
          qTodos = qTodos.neq('funil_id', carteiraFunilId);
        }
        if (responsavel_id)     qTodos = qTodos.eq('responsavel_id', responsavel_id);
        if (req.usuario.role === 'VENDEDOR') qTodos = qTodos.eq('responsavel_id', req.usuario.id);
        // Exclui clones — mesma regra do array principal
        qTodos = qTodos.is('tipo_clone', null);
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
        .filter(r => r.leads > 0 || r.ganhos > 0) // Fix #5: inclui mesmo sem ganhos
        .sort((a,b) => b.faturamento - a.faturamento || b.ganhos - a.ganhos)
        .slice(0, 10)
        .map(r => {
          // Usa total real de leads para conversão
          const totalLeads = totalLeadsMap[r.id] || r.leads;
          return {
            ...r,
            nome: usuariosAtivosMap[r.id]?.nome || '—',
            conversao: totalLeads > 0 ? ((r.ganhos/totalLeads)*100).toFixed(1) : '0.0',
            ticket_medio: r.ganhos > 0 ? (r.faturamento / r.ganhos).toFixed(2) : '0.00',
          };
        });

      console.log('[DASHBOARD_RANKING]', ranking.length, 'vendedores |',
        ranking.map(r => `${r.nome}: ${r.ganhos}v R$${r.faturamento.toFixed(0)}`).join(', ') || '(vazio)');


      // ── 6. Por funil ─────────────────────────────────────────────────────────
      const porFunilMap = {};
      leads.forEach(l => {
        const fid = l.funil_id;
        if (!fid) return;
        // Exclui funis operacionais (Carteira + Adm) do gráfico por funil em Todos-Novos
        if (funisExcluirIds?.length && funisExcluirIds.includes(fid)) return;
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

      // ── 7. Leads por dia (últimos 30 dias) — respeitando exclusão de inativos e Carteira/Adm ──
      const { data: leadsAll30 } = await (() => {
        const d30 = new Date(); d30.setDate(d30.getDate()-30);
        let q2 = sb.from('leads').select('criado_em,ganho_em,status,etapa_id,valor,valor_venda');
        if (funil_id)    q2 = q2.eq('funil_id', funil_id);
        // Aplica mesma exclusão de funis operacionais/inativos
        if (funisExcluirIds?.length) {
          q2 = q2.not('funil_id', 'in', `(${funisExcluirIds.join(',')})`);
        } else if (carteiraFunilId) {
          q2 = q2.neq('funil_id', carteiraFunilId);
        }
        if (responsavel_id)     q2 = q2.eq('responsavel_id', responsavel_id);
        if (req.usuario.role === 'VENDEDOR') q2 = q2.eq('responsavel_id', req.usuario.id);
        // Exclui clones — consistência com query principal
        q2 = q2.is('tipo_clone', null);
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

    // Resolve Carteira Recorrente, Adm. de Vendas e funis inativos para exclusão (Todos - Novos)
    let carteiraFunilIdSql = null;
    let admFunilIdSql      = null;
    let funisInativosSql   = [];
    let funisExcluirSql    = [];
    // SEMPRE exclui Carteira e Adm quando não há funil_id específico (equivalente ao Supabase)
    if (!funil_id) {
      const cr  = db.prepare(`SELECT id FROM funis WHERE nome LIKE '%Carteira%' LIMIT 1`).get();
      const adm = db.prepare(`SELECT id FROM funis WHERE nome LIKE '%Adm%' OR nome LIKE '%Administra%' LIMIT 1`).get();
      carteiraFunilIdSql = cr?.id  || null;
      admFunilIdSql      = adm?.id || null;
      const inativosRows = db.prepare(`SELECT id FROM funis WHERE ativo=0`).all();
      funisInativosSql   = inativosRows.map(f => f.id);
      funisExcluirSql    = [...new Set([carteiraFunilIdSql, admFunilIdSql, ...funisInativosSql].filter(Boolean))];
      console.log('[DASH_SQL_EXCLUIR] Carteira:', carteiraFunilIdSql, '| Adm:', admFunilIdSql, '| total:', funisExcluirSql.length);
    } else if (excluiCarteira) {
      // Compat: excluiCarteira ainda funciona como fallback
      const cr = db.prepare(`SELECT id FROM funis WHERE nome LIKE '%Carteira%' LIMIT 1`).get();
      carteiraFunilIdSql = cr?.id || null;
      const inativosRows = db.prepare(`SELECT id FROM funis WHERE ativo=0`).all();
      funisInativosSql   = inativosRows.map(f => f.id);
      funisExcluirSql    = [...new Set([carteiraFunilIdSql, ...funisInativosSql].filter(Boolean))];
      console.log('[DASH_EXCLUIR_CARTEIRA_SQL] excluindo funil_id:', carteiraFunilIdSql);
    }

    const base = `FROM leads l LEFT JOIN pipelines p ON l.pipeline_id=p.id LEFT JOIN funis f ON p.funil_id=f.id LEFT JOIN usuarios u ON l.responsavel_id=u.id WHERE 1=1`;
    const baseParams = [];
    let baseFilter = '';
    if (funil_id) { baseFilter += ' AND p.funil_id=?'; baseParams.push(funil_id); }
    // Exclui funis operacionais (Carteira + Adm) e inativos em "Todos - Novos"
    if (funisExcluirSql.length) {
      const ph = funisExcluirSql.map(() => '?').join(',');
      baseFilter += ` AND (p.funil_id IS NULL OR p.funil_id NOT IN (${ph}))`;
      baseParams.push(...funisExcluirSql);
    } else if (carteiraFunilIdSql) {
      // Fallback compat
      baseFilter += ' AND (p.funil_id IS NULL OR p.funil_id<>?)';
      baseParams.push(carteiraFunilIdSql);
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

    // ── Regra de negócio: no modo "Todos - Novos", soma vendas+faturamento da Carteira Recorrente
    let kpisCarteira = { total_ganhos: 0, faturamento: 0 };
    if (excluiCarteira && carteiraFunilIdSql) {
      let cartBaseFilter = ` AND p.funil_id=?`;
      const cartParams = [carteiraFunilIdSql];
      if (responsavel_id) { cartBaseFilter += ' AND l.responsavel_id=?'; cartParams.push(responsavel_id); }
      if (req.usuario.role === 'VENDEDOR') { cartBaseFilter += ' AND l.responsavel_id=?'; cartParams.push(req.usuario.id); }
      if (periodo?.ini || periodo?.fim) {
        const campo = campoData(data_tipo);
        if (periodo.ini) { cartBaseFilter += ` AND l.${campo}>=?`; cartParams.push(periodo.ini + 'T00:00:00'); }
        if (periodo.fim) { cartBaseFilter += ` AND l.${campo}<=?`; cartParams.push(periodo.fim + 'T23:59:59'); }
      }
      kpisCarteira = db.prepare(`SELECT
        SUM(CASE WHEN ${ganhoExpr} THEN 1 ELSE 0 END) as total_ganhos,
        SUM(CASE WHEN ${ganhoExpr} THEN ${valorExpr} ELSE 0 END) as faturamento
        ${base}${cartBaseFilter}`).get(...cartParams) || { total_ganhos: 0, faturamento: 0 };
      if (kpisCarteira.total_ganhos > 0) {
        console.log('[DASHBOARD_CARTEIRA_VENDAS_SQL] vendas Carteira somadas:', kpisCarteira.total_ganhos, '| fat +', kpisCarteira.faturamento);
      }
    }
    const totalGanhosFinal  = (kpis.total_ganhos || 0) + (kpisCarteira.total_ganhos || 0);
    const faturamentoFinal  = (kpis.faturamento  || 0) + (kpisCarteira.faturamento  || 0);
    const ticket_medioFinal = totalGanhosFinal ? faturamentoFinal / totalGanhosFinal : 0;

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
      // Remove etapas globalmente ocultas (Tratativa em andamento e variações)
      etapas = etapas.filter(e => !ETAPAS_GLOBAIS_REMOVIDAS.includes(e.nome));
      // Remove etapas sem dashboard (BASE-Antiga etc.)
      etapas = etapas.filter(e => !ETAPAS_SEM_DASHBOARD.includes(e.nome));
      // Rebuild nomeParaIds sem as etapas removidas
      Object.keys(etapaNomeParaIds).forEach(k => { if (ETAPAS_GLOBAIS_REMOVIDAS.includes(k) || ETAPAS_SEM_DASHBOARD.includes(k)) delete etapaNomeParaIds[k]; });
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
      // Remove etapas globalmente ocultas (Tratativa em andamento e variações)
      etapas = etapas.filter(e => !ETAPAS_GLOBAIS_REMOVIDAS.includes(e.nome));
      // Remove etapas sem dashboard (BASE-Antiga etc.)
      etapas = etapas.filter(e => !ETAPAS_SEM_DASHBOARD.includes(e.nome));
      Object.keys(etapaNomeParaIds).forEach(k => { if (ETAPAS_GLOBAIS_REMOVIDAS.includes(k) || ETAPAS_SEM_DASHBOARD.includes(k)) delete etapaNomeParaIds[k]; });
      console.log('[DASHBOARD_ETAPAS_ENCONTRADAS] todos-novos | etapas dedup:', etapas.length, '|', etapas.map(e => `${e.ordem}:${e.nome}`).join(', '));
    }
    console.log('[DASHBOARD_PIPELINE_SELECTED]', funil_id || 'todos-novos', '| etapas finais:', etapas.length);


    // ── Conta leads que PASSARAM por cada etapa (histórico via tabela logs) ─────
    // Usa acao IN ('MOVER','CREATE') com etapa_id no JSON de 'dados_depois'.
    // COUNT DISTINCT lead_id por etapa — cada lead conta 1x por etapa.
    const todosEtapaIdsSql = [...new Set(Object.values(etapaNomeParaIds).flat())];
    const passagemMapSql = {}; // etapa_id → Set(lead_ids)

    if (todosEtapaIdsSql.length) {
      // Busca leads no escopo (mesmos filtros de funil/vendedor/data já aplicados em leads)
      const leadsScopeSql = db.prepare(`
        SELECT l.id FROM leads l
        LEFT JOIN pipelines p ON l.pipeline_id=p.id
        WHERE 1=1${baseFilter}
      `).all(...baseParams);
      const leadIdsEscopoSql = new Set(leadsScopeSql.map(r => r.id));

      // Busca logs de movimentação
      let logSql = `SELECT entidade_id, dados_depois, acao FROM logs
        WHERE entidade = 'leads' AND acao IN ('MOVER','CREATE')`;
      const logParams = [];
      if (periodo?.ini) { logSql += ` AND criado_em >= ?`; logParams.push(periodo.ini + 'T00:00:00'); }
      if (periodo?.fim) { logSql += ` AND criado_em <= ?`; logParams.push(periodo.fim + 'T23:59:59'); }
      logSql += ` ORDER BY criado_em ASC LIMIT 100000`;

      const logsMovSql = db.prepare(logSql).all(...logParams);
      for (const lg of logsMovSql) {
        const leadId = lg.entidade_id;
        if (!leadIdsEscopoSql.has(leadId)) continue;
        let dep = null;
        try { dep = JSON.parse(lg.dados_depois || 'null'); } catch(_) {}
        const etapaDestId = dep?.etapa_id;
        if (!etapaDestId) continue;
        if (!passagemMapSql[etapaDestId]) passagemMapSql[etapaDestId] = new Set();
        passagemMapSql[etapaDestId].add(leadId);
      }
      console.log('[DASHBOARD_LEADS_CONTADOS] passagem via logs SQLite | etapas com dados:', Object.keys(passagemMapSql).length);

      // Fallback: sem histórico → etapa atual do lead como posição mínima
      const totalPassSql = Object.values(passagemMapSql).reduce((s, st) => s + st.size, 0);
      if (totalPassSql === 0 && leadIdsEscopoSql.size > 0) {
        console.log('[DASHBOARD_LEADS_CONTADOS] fallback SQLite: usando etapa atual');
        const leadsComEtapaSql = db.prepare(`
          SELECT l.id, l.etapa_id FROM leads l
          LEFT JOIN pipelines p ON l.pipeline_id=p.id
          WHERE l.etapa_id IS NOT NULL${baseFilter}
        `).all(...baseParams);
        for (const l of leadsComEtapaSql) {
          if (!passagemMapSql[l.etapa_id]) passagemMapSql[l.etapa_id] = new Set();
          passagemMapSql[l.etapa_id].add(l.id);
        }
      }
    }

    const funil_visual_raw_sql = etapas.map(e => {
      const idsEtapa = funil_id ? [e.id] : (etapaNomeParaIds[e.nome] || [e.id]);
      const leadIdsPassaram = new Set();
      for (const eid of idsEtapa) {
        for (const lid of (passagemMapSql[eid] || [])) leadIdsPassaram.add(lid);
      }
      const qty = leadIdsPassaram.size;
      const isG = e.is_ganho || /venda|vendas|ganho|fechad|fechamento/i.test(e.nome || '');
      const isP = e.is_perdido || /perdid|desqualif/i.test(e.nome || '');
      return { id: e.id, nome: e.nome, cor: e.cor, ordem: e.ordem,
        is_ganho: isG ? 1 : 0, is_perdido: isP ? 1 : 0, quantidade: qty };
    });

    const funil_visual = funil_visual_raw_sql.map((e, i) => {
      const prev = i > 0 ? funil_visual_raw_sql[i-1].quantidade : null;
      const taxa_entrada = prev != null && prev > 0 ? ((e.quantidade / prev) * 100).toFixed(0) : null;
      return { ...e, taxa_entrada };
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
      kpis: {
        ...kpis,
        total_ganhos:  totalGanhosFinal,
        faturamento:   faturamentoFinal,
        ticket_medio:  ticket_medioFinal,
        taxa_conversao,
      },
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

module.exports = { resumo, resumoSdr };

// ── GET /api/dashboard/sdr ────────────────────────────────────────────────────
// Métricas do painel Filtro SDR — visível apenas para SDR e SUPER_ADMIN
async function resumoSdr(req, res) {
  // Permissão: VENDEDOR e GESTOR sem SDR não veem
  if (req.usuario.role === 'VENDEDOR') {
    return res.status(403).json({ sucesso: false, acesso: false, erro: 'Acesso restrito a SDR e Super Admin.' });
  }

  const { sb, isSupa } = getProvider();
  const { funil_id, sdr_id, vendedor_id, data_inicio, data_fim } = req.query;

  console.log('[DASHBOARD_SDR_API_PARAMS]', { funil_id, sdr_id, vendedor_id, data_inicio, data_fim, role: req.usuario.role });

  // SDR só vê dados dos próprios leads (onde ele era o SDR)
  const filtroSdrId = req.usuario.role === 'SDR' ? req.usuario.id : (sdr_id || null);

  if (!isSupa) {
    return res.json({ sucesso: true, dados: _sdrMetricasVazias() });
  }

  try {
    // ── 1. Busca nomes das etapas SDR no banco ──────────────────────────────
    const ETAPAS_SDR = ['Lead Recebido', 'Contato Realizado', 'Lead Desqualificado', 'Lead Qualificado SDR'];

    let etapasQ = sb.from('etapas').select('id, nome, pipeline_id, funil_id').in('nome', ETAPAS_SDR);
    if (funil_id) etapasQ = etapasQ.eq('funil_id', funil_id);
    const { data: etapasDados } = await etapasQ;

    // Mapas: nome → [ids] e id → nome
    const etapasMap = {};   // nome_normalizado → [etapa_id, ...]
    const idToNome  = {};   // etapa_id → nome_normalizado

    (etapasDados || []).forEach(e => {
      const nomeNorm = e.nome.trim();
      if (!etapasMap[nomeNorm]) etapasMap[nomeNorm] = [];
      etapasMap[nomeNorm].push(e.id);
      idToNome[e.id] = nomeNorm;
    });

    const todosEtapaIds = Object.values(etapasMap).flat();

    // ── 2. Busca histórico de etapas SDR ────────────────────────────────────
    let histQ = sb.from('lead_etapa_historico')
      .select('lead_id, etapa_id, entrou_em, responsavel_id, funil_id')
      .in('etapa_id', todosEtapaIds.length ? todosEtapaIds : ['__nenhum__']);

    if (data_inicio) histQ = histQ.gte('entrou_em', `${data_inicio}T00:00:00`);
    if (data_fim)    histQ = histQ.lte('entrou_em', `${data_fim}T23:59:59`);
    if (funil_id)    histQ = histQ.eq('funil_id', funil_id);

    const { data: historico } = await histQ;

    // Agrupa por lead_id → Map<lead_id, { etapas visitadas com timestamps }>
    const porLead = {};
    (historico || []).forEach(h => {
      if (!porLead[h.lead_id]) porLead[h.lead_id] = {};
      const n = idToNome[h.etapa_id];
      if (n && (!porLead[h.lead_id][n] || h.entrou_em < porLead[h.lead_id][n])) {
        // Guarda a PRIMEIRA passagem por cada etapa
        porLead[h.lead_id][n] = h.entrou_em;
      }
    });

    // Filtra por SDR se necessário (via leads.sdr_id)
    let leadIdsValidos = Object.keys(porLead);
    if (filtroSdrId || vendedor_id) {
      let leadsQ = sb.from('leads').select('id, sdr_id, vendedor_destino_id, criado_em, responsavel_id')
        .in('id', leadIdsValidos.length ? leadIdsValidos : ['__nenhum__']);
      if (filtroSdrId) leadsQ = leadsQ.eq('sdr_id', filtroSdrId);
      if (vendedor_id) leadsQ = leadsQ.eq('vendedor_destino_id', vendedor_id);
      const { data: leadsF } = await leadsQ;
      leadIdsValidos = (leadsF || []).map(l => l.id);
    }

    // ── 3. Calcula contadores por etapa ────────────────────────────────────
    const cnt = { 'Lead Recebido': 0, 'Contato Realizado': 0, 'Lead Desqualificado': 0, 'Lead Qualificado SDR': 0 };
    leadIdsValidos.forEach(lid => {
      const etapasDoLead = porLead[lid] || {};
      ETAPAS_SDR.forEach(n => { if (etapasDoLead[n]) cnt[n]++; });
    });

    const totalRecebido = cnt['Lead Recebido'] || 0;
    const pct = (n) => totalRecebido > 0 ? Math.round((n / totalRecebido) * 100) : 0;

    // ── 4. Oportunidades por vendedor ───────────────────────────────────────
    const leadsQualificadosIds = leadIdsValidos.filter(lid => porLead[lid]?.['Lead Qualificado SDR']);

    let oportunidadesPorVendedor = [];
    if (leadsQualificadosIds.length > 0) {
      const { data: leadsQual } = await sb.from('leads')
        .select('id, vendedor_destino_id, responsavel_id')
        .in('id', leadsQualificadosIds)
        .not('vendedor_destino_id', 'is', null);

      const vendMap = {};
      (leadsQual || []).forEach(l => {
        const vid = l.vendedor_destino_id || l.responsavel_id;
        if (!vid) return;
        vendMap[vid] = (vendMap[vid] || 0) + 1;
      });

      if (Object.keys(vendMap).length > 0) {
        const { data: vendedores } = await sb.from('usuarios')
          .select('id, nome').in('id', Object.keys(vendMap));
        const nomeMap = Object.fromEntries((vendedores || []).map(v => [v.id, v.nome]));
        const totalQual = Object.values(vendMap).reduce((a, b) => a + b, 0);
        oportunidadesPorVendedor = Object.entries(vendMap)
          .map(([vid, qty]) => ({
            vendedor_id:   vid,
            vendedor_nome: nomeMap[vid] || 'Desconhecido',
            quantidade:    qty,
            percentual:    totalQual > 0 ? Math.round((qty / totalQual) * 100) : 0,
          }))
          .sort((a, b) => b.quantidade - a.quantidade);
      }
    }

    // ── 5. SLAs ──────────────────────────────────────────────────────────────
    // Busca criado_em de todos os leads válidos com passagem nas etapas SDR
    const todosLeadsIds = leadIdsValidos.length ? leadIdsValidos : ['__nenhum__'];
    const { data: leadsDados } = await sb.from('leads')
      .select('id, criado_em, lead_qualificado_sdr_em')
      .in('id', todosLeadsIds);
    const leadsDadosMap = Object.fromEntries((leadsDados || []).map(l => [l.id, l]));

    const ETAPAS_ACAO_SDR = ['Contato Realizado', 'Lead Desqualificado', 'Lead Qualificado SDR'];

    let somaSlAAtendimento  = 0, cntSlaAtend  = 0;
    let somaSlaQualificado  = 0, cntSlaQual   = 0;

    leadIdsValidos.forEach(lid => {
      const etapas = porLead[lid] || {};
      const lead   = leadsDadosMap[lid];
      if (!lead?.criado_em) return;

      const criadoMs = new Date(lead.criado_em).getTime();
      if (isNaN(criadoMs)) return;

      // SLA Atendimento: criado_em → primeira ação SDR
      const primeiraAcao = ETAPAS_ACAO_SDR
        .map(n => etapas[n] ? new Date(etapas[n]).getTime() : null)
        .filter(Boolean)
        .sort((a, b) => a - b)[0];

      if (primeiraAcao && primeiraAcao > criadoMs) {
        somaSlAAtendimento += (primeiraAcao - criadoMs) / 60000; // minutos
        cntSlaAtend++;
      }

      // SLA Qualificado: criado_em → Lead Qualificado SDR
      const tsQual = etapas['Lead Qualificado SDR']
        ? new Date(etapas['Lead Qualificado SDR']).getTime()
        : (lead.lead_qualificado_sdr_em ? new Date(lead.lead_qualificado_sdr_em).getTime() : null);

      if (tsQual && tsQual > criadoMs) {
        somaSlaQualificado += (tsQual - criadoMs) / 60000;
        cntSlaQual++;
      }
    });

    const slaAtendimento = cntSlaAtend  > 0 ? Math.round(somaSlAAtendimento / cntSlaAtend)  : null;
    const slaQualificado = cntSlaQual   > 0 ? Math.round(somaSlaQualificado / cntSlaQual)   : null;

    // ── 6. Resposta ─────────────────────────────────────────────────────────
    console.log('[DASHBOARD_SDR_RESULT]', { totalRecebido, cnt, cntSlaAtend, cntSlaQual });
    return res.json({
      sucesso: true,
      acesso:  true,
      dados: {
        etapas: {
          lead_recebido:       { quantidade: cnt['Lead Recebido'],       percentual: 100 },
          contato_realizado:   { quantidade: cnt['Contato Realizado'],   percentual: pct(cnt['Contato Realizado']) },
          lead_desqualificado: { quantidade: cnt['Lead Desqualificado'], percentual: pct(cnt['Lead Desqualificado']) },
          lead_qualificado_sdr:{ quantidade: cnt['Lead Qualificado SDR'],percentual: pct(cnt['Lead Qualificado SDR']) },
        },
        conversao_qualificado: {
          quantidade:  cnt['Lead Qualificado SDR'],
          percentual:  pct(cnt['Lead Qualificado SDR']),
          total_base:  totalRecebido,
        },
        sla_atendimento: {
          media_minutos:      slaAtendimento,
          leads_considerados: cntSlaAtend,
          formatado:          _fmtSla(slaAtendimento),
        },
        sla_qualificado: {
          media_minutos:      slaQualificado,
          leads_considerados: cntSlaQual,
          formatado:          _fmtSla(slaQualificado),
        },
        oportunidades_por_vendedor: oportunidadesPorVendedor,
      },
    });

  } catch(e) {
    console.error('[dashboard.resumoSdr]', e.message);
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
}

function _sdrMetricasVazias() {
  const etapa0 = { quantidade: 0, percentual: 0 };
  return {
    etapas: { lead_recebido: etapa0, contato_realizado: etapa0, lead_desqualificado: etapa0, lead_qualificado_sdr: etapa0 },
    conversao_qualificado: { quantidade: 0, percentual: 0, total_base: 0 },
    sla_atendimento:  { media_minutos: null, leads_considerados: 0, formatado: '—' },
    sla_qualificado:  { media_minutos: null, leads_considerados: 0, formatado: '—' },
    oportunidades_por_vendedor: [],
  };
}

function _fmtSla(minutos) {
  if (minutos == null || minutos <= 0) return '—';
  if (minutos < 60) return `${minutos}min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr > 0 ? `${d}d ${hr}h` : `${d}d`;
}
