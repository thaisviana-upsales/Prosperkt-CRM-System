/**
 * PROSPERKT CRM — Dashboard Controller
 * Usa Supabase JS nativo ou SQLite conforme DATABASE_PROVIDER.
 */
const { getProvider } = require('../database/dbProvider');

// GET /api/dashboard
async function resumo(req, res) {
  const { sb, isSupa, sqlite } = getProvider();
  const { funil_id, responsavel_id } = req.query;

  try {
    if (isSupa) {
      // Base query de leads
      let q = sb.from('leads').select('id,status,valor,etapa_id,responsavel_id,criado_em');
      if (funil_id)       q = q.eq('funil_id', funil_id);
      if (responsavel_id) q = q.eq('responsavel_id', responsavel_id);
      if (req.usuario.role === 'VENDEDOR') q = q.eq('responsavel_id', req.usuario.id);

      const { data: leads, error } = await q;
      if (error) throw error;

      const total_leads   = leads.length;
      const total_ganhos  = leads.filter(l => l.status === 'ganho').length;
      const total_perdidos= leads.filter(l => l.status === 'perdido').length;
      const total_abertos = leads.filter(l => l.status === 'ativo').length;
      const faturamento   = leads.filter(l => l.status === 'ganho').reduce((s,l)=>s+(l.valor||0),0);
      const valsGanho     = leads.filter(l => l.status === 'ganho' && l.valor > 0).map(l=>l.valor);
      const ticket_medio  = valsGanho.length ? valsGanho.reduce((a,b)=>a+b,0)/valsGanho.length : 0;
      const taxa_conversao= total_leads > 0 ? ((total_ganhos/total_leads)*100).toFixed(1) : '0.0';

      // ── Funil visual — carrega etapas via pipeline_id ────────────────────────
      // Mapa nome→[ids] para contagem agregada em modo "Todos"
      let etapasDedup = []; // etapas deduplicadas para exibição
      let nomeParaIds = {}; // nome → array de etapa_ids (de todas as pipelines)

      if (funil_id) {
        // Filtro por funil específico: acha o pipeline, depois as etapas
        const { data: dPipes } = await sb.from('pipelines').select('id').eq('funil_id', funil_id).order('criado_em').limit(1);
        if (dPipes?.[0]?.id) {
          const { data: et } = await sb.from('etapas').select('id,nome,cor,ordem,probabilidade,is_ganho,is_perdido').eq('pipeline_id', dPipes[0].id).order('ordem');
          etapasDedup = et || [];
          (et || []).forEach(e => { nomeParaIds[e.nome] = [e.id]; });
        }
      } else {
        // Sem filtro: carrega TODAS as etapas de todas as pipelines ativas e deduplica por nome
        const { data: pipes } = await sb.from('pipelines').select('id').eq('ativo', 1);
        if (pipes?.length) {
          const pipeIds = pipes.map(p => p.id);
          const { data: todasEtapas } = await sb.from('etapas')
            .select('id,nome,cor,ordem,probabilidade,is_ganho,is_perdido')
            .in('pipeline_id', pipeIds)
            .order('ordem');
          // Agrupa por nome para contagem e deduplicação
          const seen = new Set();
          for (const e of (todasEtapas || [])) {
            if (!nomeParaIds[e.nome]) nomeParaIds[e.nome] = [];
            nomeParaIds[e.nome].push(e.id);
            if (!seen.has(e.nome)) {
              seen.add(e.nome);
              etapasDedup.push(e); // primeira ocorrência de cada nome
            }
          }
          etapasDedup.sort((a, b) => a.ordem - b.ordem);
        }
      }

      // Monta funil_visual com contagem correta (agregada por nome em modo "Todos")
      const funil_visual_raw = etapasDedup.map(e => {
        const ids = nomeParaIds[e.nome] || [e.id];
        const qty = leads.filter(l => ids.includes(l.etapa_id)).length;
        const isGanho   = e.is_ganho || e.probabilidade >= 100 || e.nome?.toLowerCase().includes('venda');
        const isPerdido = e.is_perdido || e.nome?.toLowerCase().includes('perdid') || e.nome?.toLowerCase().includes('desqualif');
        return { ...e, is_ganho: isGanho?1:0, is_perdido: isPerdido?1:0, quantidade: qty };
      });

      // Calcula taxa_entrada agora que temos as quantidades
      const funil_visual = funil_visual_raw.map((e, i) => {
        const prev = i > 0 ? funil_visual_raw[i-1].quantidade : null;
        const taxa_entrada = prev != null && prev > 0 ? ((e.quantidade/prev)*100).toFixed(0) : null;
        return { ...e, taxa_entrada };
      });

      // Ranking vendedores
      const vendedorMap = {};
      leads.forEach(l => {
        if (!l.responsavel_id) return;
        if (!vendedorMap[l.responsavel_id]) vendedorMap[l.responsavel_id] = { id:l.responsavel_id, leads:0, ganhos:0, faturamento:0 };
        vendedorMap[l.responsavel_id].leads++;
        if (l.status==='ganho') { vendedorMap[l.responsavel_id].ganhos++; vendedorMap[l.responsavel_id].faturamento+=(l.valor||0); }
      });

      let ranking = Object.values(vendedorMap).sort((a,b)=>b.faturamento-a.faturamento).slice(0,10);
      if (ranking.length) {
        const ids = ranking.map(r=>r.id);
        const { data: users } = await sb.from('usuarios').select('id,nome').in('id', ids);
        const userMap = Object.fromEntries((users||[]).map(u=>[u.id,u.nome]));
        ranking = ranking.map(r=>({ ...r, nome:userMap[r.id]||r.id, conversao: r.leads>0?((r.ganhos/r.leads)*100).toFixed(1):'0.0' }));
      }

      // Leads por dia (últimos 30 dias)
      const leads_por_dia = [];

      return res.json({ sucesso:true, dados:{
        kpis:{ total_leads, total_ganhos, total_perdidos, total_abertos, faturamento, ticket_medio, taxa_conversao },
        funil_visual,
        por_funil: [],
        ranking,
        tempo_resposta:{ media_minutos:null, leads_com_resposta:0 },
        leads_por_dia,
      }});
    }

    // ── SQLite ────────────────────────────────────────────────────────────────
    const { getDb } = require('../database/db');
    const db = getDb();

    const base = `FROM leads l LEFT JOIN pipelines p ON l.pipeline_id=p.id LEFT JOIN funis f ON p.funil_id=f.id LEFT JOIN usuarios u ON l.responsavel_id=u.id WHERE 1=1`;
    const baseParams = [];
    let baseFilter = '';
    if (funil_id)       { baseFilter += ' AND p.funil_id=?';       baseParams.push(funil_id); }
    if (responsavel_id) { baseFilter += ' AND l.responsavel_id=?'; baseParams.push(responsavel_id); }
    if (req.usuario.role === 'VENDEDOR') { baseFilter += ' AND l.responsavel_id=?'; baseParams.push(req.usuario.id); }
    const filter = baseFilter;
    const params = [...baseParams];

    const kpis = db.prepare(`SELECT COUNT(*) as total_leads, SUM(CASE WHEN l.status='GANHO' THEN 1 ELSE 0 END) as total_ganhos, SUM(CASE WHEN l.status='PERDIDO' THEN 1 ELSE 0 END) as total_perdidos, SUM(CASE WHEN l.status='ABERTO' THEN 1 ELSE 0 END) as total_abertos, SUM(CASE WHEN l.status='GANHO' THEN l.valor ELSE 0 END) as faturamento, AVG(CASE WHEN l.status='GANHO' THEN l.valor ELSE NULL END) as ticket_medio ${base}${filter}`).get(...params);
    const taxa_conversao = kpis.total_leads > 0 ? ((kpis.total_ganhos/kpis.total_leads)*100).toFixed(1) : '0.0';

    const primFunil = funil_id || db.prepare('SELECT id FROM funis WHERE ativo=1 LIMIT 1').get()?.id;
    let etapas = [];
    if (primFunil) etapas = db.prepare(`SELECT e.id,e.nome,e.cor,e.ordem,e.is_ganho,e.is_perdido FROM etapas e JOIN pipelines p ON e.pipeline_id=p.id WHERE p.funil_id=? ORDER BY e.ordem`).all(primFunil);

    const funil_visual = etapas.map((e,i) => {
      const countRow = db.prepare(`SELECT COUNT(*) as c FROM leads l LEFT JOIN pipelines p ON l.pipeline_id=p.id LEFT JOIN funis f ON p.funil_id=f.id WHERE l.etapa_id=?${baseFilter}`).get(e.id,...baseParams);
      const anterior = i > 0 ? etapas[i-1] : null;
      let taxa_entrada = null;
      if (anterior) { const ac = db.prepare(`SELECT COUNT(*) as c FROM leads l LEFT JOIN pipelines p ON l.pipeline_id=p.id LEFT JOIN funis f ON p.funil_id=f.id WHERE l.etapa_id=?${baseFilter}`).get(anterior.id,...baseParams); taxa_entrada = ac.c > 0 ? ((countRow.c/ac.c)*100).toFixed(0) : null; }
      return { ...e, quantidade:countRow.c, taxa_entrada };
    });

    const ranking = db.prepare(`SELECT u.id,u.nome,COUNT(*) as leads,SUM(CASE WHEN l.status='GANHO' THEN 1 ELSE 0 END) as ganhos,SUM(CASE WHEN l.status='GANHO' THEN l.valor ELSE 0 END) as faturamento,AVG(CASE WHEN l.status='GANHO' THEN l.valor ELSE NULL END) as ticket_medio ${base}${filter} GROUP BY u.id,u.nome ORDER BY faturamento DESC LIMIT 10`).all(...params).map(r=>({...r, conversao:r.leads>0?((r.ganhos/r.leads)*100).toFixed(1):'0.0'}));
    const por_funil = db.prepare(`SELECT f.id,f.nome,f.cor,COUNT(*) as leads,SUM(CASE WHEN l.status='GANHO' THEN 1 ELSE 0 END) as ganhos,SUM(CASE WHEN l.status='GANHO' THEN l.valor ELSE 0 END) as faturamento ${base}${filter} GROUP BY f.id,f.nome,f.cor ORDER BY faturamento DESC`).all(...params);
    const tempo_resposta = db.prepare(`SELECT AVG(CAST((julianday(m.enviado_em)-julianday(l.criado_em))*24*60 AS REAL)) as media_minutos,COUNT(DISTINCT l.id) as leads_com_resposta FROM leads l JOIN mensagens m ON m.lead_id=l.id WHERE m.id=(SELECT id FROM mensagens WHERE lead_id=l.id ORDER BY enviado_em LIMIT 1)${baseFilter?'AND'+baseFilter.replace(/^ AND/,''):''}`).get(...baseParams);
    const leads_por_dia = db.prepare(`SELECT date(l.criado_em) as dia,COUNT(*) as quantidade,SUM(CASE WHEN l.status='GANHO' THEN 1 ELSE 0 END) as ganhos ${base}${filter} GROUP BY dia ORDER BY dia ASC LIMIT 30`).all(...params);

    return res.json({ sucesso:true, dados:{ kpis:{ ...kpis, taxa_conversao }, funil_visual, por_funil, ranking, tempo_resposta, leads_por_dia } });
  } catch(e) {
    console.error('[dashboard.resumo]', e.message);
    return res.status(500).json({ sucesso:false, erro:e.message });
  }
}

module.exports = { resumo };
