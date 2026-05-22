/**
 * PROSPERKT CRM — Dashboard Controller
 * Todos os dados vêm do banco. Sem mocks.
 */
const { getDb } = require('../database/db');

// Constrói WHERE clause de data
function buildDateFilter(dataTipo, dataPeriodo, dataInicio, dataFim) {
  const colMap = { criacao:'l.criado_em', fechamento:'l.data_fechamento', perdido:'l.atualizado_em' };
  const col = colMap[dataTipo] || 'l.criado_em';
  const parts = []; const params = [];

  if (dataTipo === 'perdido') { parts.push("l.status='PERDIDO'"); }

  let de = dataInicio, ate = dataFim;
  if (dataPeriodo && dataPeriodo !== 'personalizado') {
    const hoje = new Date();
    const fmt  = d => d.toISOString().slice(0,10);
    switch(dataPeriodo) {
      case 'hoje':       de = ate = fmt(hoje); break;
      case 'ontem':      { const d=new Date(hoje); d.setDate(d.getDate()-1); de=ate=fmt(d); break; }
      case '7d':         { const d=new Date(hoje); d.setDate(d.getDate()-6); de=fmt(d); ate=fmt(hoje); break; }
      case '30d':        { const d=new Date(hoje); d.setDate(d.getDate()-29); de=fmt(d); ate=fmt(hoje); break; }
      case 'mes_atual':  { de=fmt(new Date(hoje.getFullYear(),hoje.getMonth(),1)); ate=fmt(hoje); break; }
      case 'mes_ant':    {
        de=fmt(new Date(hoje.getFullYear(),hoje.getMonth()-1,1));
        ate=fmt(new Date(hoje.getFullYear(),hoje.getMonth(),0)); break;
      }
    }
  }
  if (de)  { parts.push(`date(${col}) >= ?`); params.push(de); }
  if (ate) { parts.push(`date(${col}) <= ?`); params.push(ate); }
  return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

// GET /api/dashboard
function resumo(req, res) {
  const db = getDb();
  const { funil_id, responsavel_id, data_tipo, data_periodo, data_inicio, data_fim } = req.query;

  const base = `FROM leads l
    LEFT JOIN pipelines p ON l.pipeline_id=p.id
    LEFT JOIN funis f ON p.funil_id=f.id
    LEFT JOIN usuarios u ON l.responsavel_id=u.id
    WHERE 1=1`;

  const baseParams = [];
  let baseFilter = '';
  if (funil_id)       { baseFilter += ' AND p.funil_id=?';       baseParams.push(funil_id); }
  if (responsavel_id) { baseFilter += ' AND l.responsavel_id=?'; baseParams.push(responsavel_id); }
  // RBAC
  if (req.usuario.role === 'VENDEDOR') { baseFilter += ' AND l.responsavel_id=?'; baseParams.push(req.usuario.id); }

  const { sql: dateSql, params: dateParams } = data_tipo
    ? buildDateFilter(data_tipo, data_periodo, data_inicio, data_fim)
    : { sql:'', params:[] };
  const filter = baseFilter + dateSql;
  const params = [...baseParams, ...dateParams];

  // ── KPIs ──────────────────────────────────────────────────────
  const kpis = db.prepare(`
    SELECT
      COUNT(*) as total_leads,
      SUM(CASE WHEN l.status='GANHO' THEN 1 ELSE 0 END) as total_ganhos,
      SUM(CASE WHEN l.status='PERDIDO' THEN 1 ELSE 0 END) as total_perdidos,
      SUM(CASE WHEN l.status='ABERTO' THEN 1 ELSE 0 END) as total_abertos,
      SUM(CASE WHEN l.status='GANHO' THEN l.valor ELSE 0 END) as faturamento,
      AVG(CASE WHEN l.status='GANHO' THEN l.valor ELSE NULL END) as ticket_medio
    ${base}${filter}
  `).get(...params);

  const taxa_conversao = kpis.total_leads > 0
    ? ((kpis.total_ganhos / kpis.total_leads) * 100).toFixed(1)
    : '0.0';

  // ── Funil visual (etapas do primeiro funil ou do selecionado) ──
  const funilParaFunil = funil_id || null;
  let etapas = [];
  if (funilParaFunil) {
    etapas = db.prepare(`SELECT e.id, e.nome, e.cor, e.ordem, e.is_ganho, e.is_perdido
      FROM etapas e JOIN pipelines p ON e.pipeline_id=p.id
      WHERE p.funil_id=? ORDER BY e.ordem`).all(funilParaFunil);
  } else if (!funil_id) {
    // Usa etapas do 1o funil como referência visual
    const primFunil = db.prepare('SELECT id FROM funis WHERE ativo=1 LIMIT 1').get();
    if (primFunil) {
      etapas = db.prepare(`SELECT e.id, e.nome, e.cor, e.ordem, e.is_ganho, e.is_perdido
        FROM etapas e JOIN pipelines p ON e.pipeline_id=p.id
        WHERE p.funil_id=? ORDER BY e.ordem`).all(primFunil.id);
    }
  }

  const funilVisual = etapas.map((etapa, i) => {
    const countRow = db.prepare(`SELECT COUNT(*) as c
      FROM leads l LEFT JOIN pipelines p ON l.pipeline_id=p.id LEFT JOIN funis f ON p.funil_id=f.id
      WHERE l.etapa_id=?${baseFilter}${dateSql}`).get(etapa.id, ...baseParams, ...dateParams);
    const anterior = i > 0 ? etapas[i-1] : null;
    let taxa_entrada = null;
    if (anterior) {
      const antCount = db.prepare(`SELECT COUNT(*) as c
        FROM leads l LEFT JOIN pipelines p ON l.pipeline_id=p.id LEFT JOIN funis f ON p.funil_id=f.id
        WHERE l.etapa_id=?${baseFilter}${dateSql}`).get(anterior.id, ...baseParams, ...dateParams);
      taxa_entrada = antCount.c > 0 ? ((countRow.c / antCount.c)*100).toFixed(0) : null;
    }
    return { ...etapa, quantidade: countRow.c, taxa_entrada };
  });

  // ── Por funil ──────────────────────────────────────────────────
  const porFunil = db.prepare(`
    SELECT f.id, f.nome, f.cor,
      COUNT(*) as leads,
      SUM(CASE WHEN l.status='GANHO' THEN 1 ELSE 0 END) as ganhos,
      SUM(CASE WHEN l.status='GANHO' THEN l.valor ELSE 0 END) as faturamento
    ${base}${filter}
    GROUP BY f.id, f.nome, f.cor
    ORDER BY faturamento DESC
  `).all(...params);

  // ── Ranking vendedores ─────────────────────────────────────────
  const ranking = db.prepare(`
    SELECT u.id, u.nome,
      COUNT(*) as leads,
      SUM(CASE WHEN l.status='GANHO' THEN 1 ELSE 0 END) as ganhos,
      SUM(CASE WHEN l.status='GANHO' THEN l.valor ELSE 0 END) as faturamento,
      AVG(CASE WHEN l.status='GANHO' THEN l.valor ELSE NULL END) as ticket_medio
    ${base}${filter}
    GROUP BY u.id, u.nome
    ORDER BY faturamento DESC
    LIMIT 10
  `).all(...params);

  const rankingComConv = ranking.map(r => ({
    ...r,
    conversao: r.leads > 0 ? ((r.ganhos/r.leads)*100).toFixed(1) : '0.0'
  }));

  // ── Tempo médio de resposta (1a mensagem após criação) ─────────
  const tempoResposta = db.prepare(`
    SELECT
      AVG(CAST((julianday(m.enviado_em) - julianday(l.criado_em)) * 24 * 60 AS REAL)) as media_minutos,
      COUNT(DISTINCT l.id) as leads_com_resposta
    FROM leads l
    JOIN mensagens m ON m.lead_id=l.id
    WHERE m.id = (SELECT id FROM mensagens WHERE lead_id=l.id ORDER BY enviado_em LIMIT 1)
    ${baseFilter ? 'AND' + baseFilter.replace(/^ AND/,'') : ''}
  `).get(...baseParams);

  // ── Leads por dia (últimos 30 dias) para mini-gráfico ─────────
  const leadsPorDia = db.prepare(`
    SELECT date(l.criado_em) as dia, COUNT(*) as quantidade,
      SUM(CASE WHEN l.status='GANHO' THEN 1 ELSE 0 END) as ganhos
    ${base}${filter}
    GROUP BY dia ORDER BY dia ASC LIMIT 30
  `).all(...params);

  return res.json({
    sucesso: true,
    dados: {
      kpis: { ...kpis, taxa_conversao },
      funil_visual: funilVisual,
      por_funil: porFunil,
      ranking: rankingComConv,
      tempo_resposta: tempoResposta,
      leads_por_dia: leadsPorDia,
    }
  });
}

module.exports = { resumo };
