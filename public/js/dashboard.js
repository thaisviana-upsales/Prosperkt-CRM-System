/**
 * PROSPEKT CRM — Dashboard JS
 * Dados reais do banco via API. Sem mocks.
 */
let _usuario = null;
let _funis   = [];
let _filtros = { funil:'', resp:'', dataTipo:'', dataPeriodo:'', dataInicio:'', dataFim:'' };
let _autoTimer = null;

const fmt = n => n != null ? Number(n).toLocaleString('pt-BR', {minimumFractionDigits:0, maximumFractionDigits:0}) : '—';
const fmtR = n => n != null && n > 0 ? 'R$ ' + Number(n).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) : 'R$ 0';
const fmtPct = n => n != null ? n + '%' : '—';

async function init() {
  _usuario = await Sidebar.init('dashboard');
  if (!_usuario) return;
  await carregarFunis();
  await carregarUsuarios();

  // Mostra card de pendentes apenas para GESTOR+
  if (['SUPER_ADMIN','GESTOR'].includes(_usuario.role)) {
    document.getElementById('kpi-pendentes-card').style.display = '';
  }

  // Mostra painel SDR apenas para SDR e SUPER_ADMIN
  if (['SUPER_ADMIN','SDR'].includes(_usuario.role)) {
    document.getElementById('sdr-painel').style.display = '';
    await _sdrPopularFiltros();
    await carregarSdr();
    _sdrBindEvents();
  }

  await carregar();
  await carregarAlertasRecompra();
  bindEvents();
  // Auto-refresh a cada 60s
  _autoTimer = setInterval(() => {
    carregar();
    carregarAlertasRecompra();
    if (['SUPER_ADMIN','SDR'].includes(_usuario?.role)) carregarSdr();
  }, 60000);
}

// Helper: identifica funil Carteira Recorrente por nome (case-insensitive)
function isCarteiraRecorrente(nome) {
  return /carteira\s*recorrente/i.test((nome||'').trim());
}

async function carregarFunis() {
  const r = await Auth.api('GET', '/funis?somente_ativos=true');
  _funis = r?.data?.dados || [];
  const sel = document.getElementById('f-funil');
  // Separa Carteira Recorrente do restante
  const funisNovos   = _funis.filter(f => !isCarteiraRecorrente(f.nome));
  const funisCarteira = _funis.filter(f =>  isCarteiraRecorrente(f.nome));
  sel.innerHTML =
    '<option value="">Todos - Novos</option>' +
    funisNovos.map(f => `<option value="${f.id}">${f.nome}</option>`).join('') +
    (funisCarteira.length ? '<option disabled>──────────────</option>' : '') +
    funisCarteira.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
}

async function carregarUsuarios() {
  if (_usuario.role === 'VENDEDOR') {
    const fRespEl = document.getElementById('f-resp');
    if (fRespEl?.closest('.fg')) fRespEl.closest('.fg').style.display = 'none';
    return;
  }

  console.log('[FILTRO_VENDEDOR_LOAD_START] dashboard | carregando usuários comerciais...');

  // Usa módulo global centralizado — inclui VENDEDOR, SDR, GESTOR, CLOSER, COMERCIAL, etc.
  if (typeof UsuariosComerciais !== 'undefined') {
    await UsuariosComerciais.carregar();
    const sel = document.getElementById('f-resp');
    if (sel) UsuariosComerciais.popular(sel, { primeiraNome: 'Todos', primeiroValor: '' });
    console.log('[FILTRO_VENDEDOR_USUARIOS_RENDERIZADOS] dashboard | via UsuariosComerciais:', UsuariosComerciais.lista().length);
    sel?.addEventListener('change', e => {
      console.log('[FILTRO_VENDEDOR_SELECT_CHANGE] valor:', e.target.value, '| nome:', sel.selectedOptions[0]?.text);
    });
    return;
  }

  // Fallback manual
  const ROLES_COMERCIAIS = new Set(['vendedor','sdr','gestor','closer','comercial','sales','seller','super_admin']);

  function filtrarVendedoresValidos(lista, origem) {
    const validos = [];
    const descartados = [];
    (lista || []).forEach(u => {
      const isAtivo = u.ativo === true || u.ativo === 1 || u.ativo === '1' || u.ativo === 'true';
      const roleOk  = ROLES_COMERCIAIS.has((u.role || '').toLowerCase());
      if (isAtivo && roleOk) validos.push(u);
      else descartados.push({ nome: u.nome, role: u.role, ativo: u.ativo, motivo: !isAtivo ? 'inativo' : 'role_nao_comercial' });
    });
    console.log('[FILTRO_VENDEDOR_USUARIOS_TOTAL_API]', origem, '| recebidos:', (lista||[]).length);
    console.log('[FILTRO_VENDEDOR_USUARIOS_ATIVOS_TOTAL]', validos.length, 'válidos após filtro');
    if (descartados.length > 0)
      console.log('[FILTRO_VENDEDOR_USUARIO_DESCARTADO_INATIVO]', JSON.stringify(descartados));
    return validos.sort((a,b) => (a.nome||'').localeCompare(b.nome||'','pt-BR'));
  }

  let users = [];
  const r = await Auth.api('GET', '/usuarios');
  const raw1 = r?.data?.dados || [];
  users = filtrarVendedoresValidos(raw1, '/usuarios');

  if (users.length === 0) {
    console.warn('[FILTRO_VENDEDOR_LOAD_START] dashboard | /usuarios sem resultado — tentando /usuarios/responsaveis...');
    const r2 = await Auth.api('GET', '/usuarios/responsaveis');
    const raw2 = r2?.data?.dados || [];
    users = filtrarVendedoresValidos(raw2, '/usuarios/responsaveis');
  }

  const sel = document.getElementById('f-resp');
  if (sel) {
    sel.innerHTML = '<option value="">Todos</option>' +
      users.map(u => `<option value="${u.id}">${u.nome}</option>`).join('');
    console.log('[FILTRO_VENDEDOR_USUARIOS_RENDERIZADOS]', sel.options.length - 1, 'usuários + opção Todos');
    sel.addEventListener('change', e => {
      console.log('[FILTRO_VENDEDOR_SELECT_CHANGE] valor:', e.target.value, '| nome:', sel.selectedOptions[0]?.text);
    });
  }
}

function buildQuery() {
  const p = [];
  if (_filtros.funil)       p.push(`funil_id=${_filtros.funil}`);
  else                      p.push('excluir_carteira=true'); // "Todos - Novos" exclui Carteira Recorrente
  if (_filtros.resp)        p.push(`responsavel_id=${_filtros.resp}`);
  if (_filtros.dataTipo)    p.push(`data_tipo=${_filtros.dataTipo}`);
  if (_filtros.dataPeriodo) p.push(`data_periodo=${_filtros.dataPeriodo}`);
  if (_filtros.dataInicio)  p.push(`data_inicio=${_filtros.dataInicio}`);
  if (_filtros.dataFim)     p.push(`data_fim=${_filtros.dataFim}`);
  const query = '?' + p.join('&');
  console.log('[FILTRO_VENDEDOR_PAYLOAD_API] query construída:', query,
    '| vendedor_id:', _filtros.resp || '(todos)');
  return query;
}

async function carregar() {
  console.log('[DASHBOARD_FILTERS_APPLIED]', _filtros, { excluir_carteira: !_filtros.funil });
  const r = await Auth.api('GET', '/dashboard' + buildQuery());
  if (!r?.ok) { Toast.show('Erro ao carregar dashboard.', 'error'); return; }
  const d = r.data.dados;
  renderKPIs(d.kpis);
  renderFunilVisual(d.funil_visual);
  renderRanking(d.ranking);
  renderPorFunil(d.por_funil);
  renderTempoResposta(d.tempo_resposta);
  renderSparkline(d.leads_por_dia);
  renderMetaPreview(d.kpis);
  // Atualiza pendentes em background para GESTOR+
  if (['SUPER_ADMIN','GESTOR'].includes(_usuario?.role)) {
    carregarPendentes();
  }
  document.getElementById('last-update').textContent = 'Atualizado ' + new Date().toLocaleTimeString('pt-BR');
}

function renderKPIs(k) {
  document.getElementById('kpi-leads').textContent    = fmt(k.total_leads);
  document.getElementById('kpi-ganhos').textContent   = fmt(k.total_ganhos);
  document.getElementById('kpi-fat').textContent      = fmtR(k.faturamento);
  document.getElementById('kpi-ticket').textContent   = fmtR(k.ticket_medio);
  document.getElementById('kpi-conv').textContent     = fmtPct(k.taxa_conversao);
  document.getElementById('kpi-perdidos').textContent = fmt(k.total_perdidos);

  const taxaAbertos = k.total_leads > 0 ? ((k.total_abertos/k.total_leads)*100).toFixed(0) : 0;
  document.getElementById('kpi-leads-sub').textContent    = `${k.total_abertos} em aberto`;
  document.getElementById('kpi-ganhos-sub').textContent   = `${k.taxa_conversao}% de conversão`;
  document.getElementById('kpi-fat-sub').textContent      = k.total_ganhos > 0 ? `${k.total_ganhos} vendas` : 'Sem vendas no período';
  document.getElementById('kpi-perdidos-sub').textContent = k.total_leads > 0
    ? `${((k.total_perdidos/k.total_leads)*100).toFixed(1)}% dos leads`
    : '';
}

// Cor por tipo de etapa — paleta executiva
function etapaCor(e, idx, total) {
  // Negativos: scarlett escuro elegante
  if (e.is_perdido) return '#6b0a1a';
  const n = e.nome?.toLowerCase() || '';
  if (n.includes('desqualif') || n.includes('perdid')) return '#5a0f1f';
  // Ganho: verde PROSPEKT em destaque
  if (e.is_ganho || /venda|ganho|fechad/i.test(n)) return '#1f5c2e';
  // Sequência verde escuro → verde médio ao longo do funil
  // idx vai de 0 (topo) a total-1 (fundo)
  const pct = total <= 1 ? 0 : idx / (total - 1);
  // De #0d2e1a (verde quase preto) até #1a6b38 (verde médio executivo)
  const r = Math.round(13  + pct * (26  - 13));
  const g = Math.round(46  + pct * (107 - 46));
  const b = Math.round(26  + pct * (56  - 26));
  return `rgb(${r},${g},${b})`;
}

function renderFunilVisual(etapas) {
  const el = document.getElementById('funil-visual');
  if (!etapas?.length) { el.innerHTML = '<div class="empty">Nenhum dado disponível</div>'; return; }

  // Funil real: 1ª etapa = 100%, demais proporcional à quantidade
  const MAX_W = 100;
  const MIN_W = 48;
  const maxQtd = Math.max(...etapas.map(e => e.quantidade), 1);
  const total  = etapas.length;

  // Largura decrescente: simula forma de funil
  // Se quantidade for 0, mantém MIN_W para não desaparecer
  const widths = etapas.map((e, i) => {
    if (i === 0) return MAX_W;
    const proporcional = Math.max(MIN_W, Math.round((e.quantidade / maxQtd) * MAX_W));
    // garante decrescente: nunca mais largo que a etapa anterior
    return proporcional;
  });

  let html = '<div class="fv-premium">';
  etapas.forEach((e, i) => {
    const w       = widths[i];
    const cor     = etapaCor(e, i, total);
    const isNeg   = e.is_perdido || /desqualif|perdid/i.test(e.nome || '');
    const isGanho = e.is_ganho   || /venda|ganho|fechad/i.test(e.nome || '');

    const shadow = isGanho
      ? '0 0 0 1.5px rgba(91,222,62,.45), 0 4px 16px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.12)'
      : isNeg
      ? '0 0 0 1px rgba(160,10,30,.3), 0 2px 10px rgba(0,0,0,.5)'
      : '0 2px 10px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06)';

    const taxaTxt = e.taxa_entrada != null
      ? (isNeg ? `↘ ${e.taxa_entrada}%` : `→ ${e.taxa_entrada}%`) : '';

    // Conector entre etapas com taxa de conversão
    if (i > 0) {
      html += `<div class="fv-connector">
        <div class="fv-connector-line"></div>
        <span class="fv-connector-rate">${taxaTxt}</span>
        <div class="fv-connector-line"></div>
      </div>`;
    }

    html += `<div class="fv-layer" style="width:${w}%;background:${cor};box-shadow:${shadow}">
      <div class="fv-layer-inner">
        <span class="fv-layer-name">${e.nome}</span>
        <span class="fv-layer-count">${e.quantidade}</span>
      </div>
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;

  requestAnimationFrame(() => {
    el.querySelectorAll('.fv-layer').forEach((layer, i) => {
      layer.style.opacity = '0';
      layer.style.transform = 'scaleX(.88)';
      setTimeout(() => {
        layer.style.transition = 'opacity .4s cubic-bezier(.16,1,.3,1), transform .4s cubic-bezier(.16,1,.3,1)';
        layer.style.opacity = '1';
        layer.style.transform = 'scaleX(1)';
      }, i * 60);
    });
  });
}

function renderRanking(ranking) {
  const el = document.getElementById('ranking');
  if (!ranking?.length) {
    el.innerHTML = '<div class="empty" style="text-align:center;padding:20px 10px"><div style="font-size:1.4rem;opacity:.25;margin-bottom:8px">🏆</div><div style="font-weight:600;margin-bottom:4px">Nenhum vendedor com vendas no período</div><div style="font-size:.72rem;opacity:.6">Ajuste os filtros ou amplie o período para visualizar o ranking.</div></div>';
    return;
  }
  const MEDALS  = ['🥇','🥈','🥉'];
  const ROWCLS  = ['gold-row','silver-row','bronze-row'];
  const AVCLS   = ['av-gold','av-silver','av-bronze'];
  const maxFat  = Math.max(...ranking.map(r => r.faturamento || 0), 1);
  const BAR_COLORS = [
    'linear-gradient(90deg,#b8860b,#F5A623)',
    'linear-gradient(90deg,#888,#ccc)',
    'linear-gradient(90deg,#8B4513,#cd7f32)',
  ];

  el.innerHTML = ranking.map((r, i) => {
    const initials  = r.nome.slice(0,2).toUpperCase();
    const isTop3    = i < 3;
    const medal     = isTop3 ? `<span class="rank-medal">${MEDALS[i]}</span>` : `<span class="rank-pos-num">${i+1}</span>`;
    const rowCls    = isTop3 ? ROWCLS[i] : 'other-row';
    const avCls     = isTop3 ? AVCLS[i] : '';
    const barW      = Math.round((r.faturamento || 0) / maxFat * 100);
    const barGrad   = isTop3 ? BAR_COLORS[i] : 'var(--green)';
    return `<div class="rank-row ${rowCls}">
      ${medal}
      <div class="rank-avatar ${avCls}">${initials}</div>
      <div class="rank-info">
        <div class="rank-name">${r.nome}</div>
        <div class="rank-bar-wrap"><div class="rank-bar-fill" style="width:0%;background:${barGrad}" data-w="${barW}"></div></div>
      </div>
      <div class="rank-right">
        <span class="rank-vendas">${r.ganhos} venda${r.ganhos !== 1 ? 's' : ''}</span>
        <span class="rank-fat">${fmtR(r.faturamento)}</span>
        <span class="rank-conv">${r.conversao}% conv.</span>
      </div>
    </div>`;
  }).join('');

  // Anima barras
  requestAnimationFrame(() => {
    el.querySelectorAll('.rank-bar-fill').forEach(bar => {
      const w = bar.dataset.w;
      setTimeout(() => { bar.style.width = w + '%'; }, 120);
    });
  });
}

function renderPorFunil(lista) {
  const el = document.getElementById('por-funil');
  if (!lista?.length) { el.innerHTML = '<div class="empty">Nenhum dado disponível</div>'; return; }
  const maxFat = Math.max(...lista.map(f => f.faturamento), 1);
  const totalGanhos = lista.reduce((s,f) => s + (f.ganhos||0), 0);
  el.innerHTML = lista.map(f => {
    const pct  = Math.round((f.faturamento / maxFat) * 100);
    const funil = _funis.find(x => x.id === f.id);
    const cor  = funil?.cor || f.cor || '#6CFF4E';
    const pctGanhos = totalGanhos > 0 ? ((f.ganhos||0)/totalGanhos*100).toFixed(0) : '0';
    return `<div class="funil-row">
      <div class="funil-dot" style="background:${cor}"></div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
          <span class="funil-nome">${f.nome}</span>
          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0">
            <span style="font-size:.65rem;color:var(--text-muted)">${f.ganhos||0} venda${(f.ganhos||0)!==1?'s':''}</span>
            <span class="funil-val">${fmtR(f.faturamento)}</span>
          </div>
        </div>
        <div style="height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${cor};border-radius:3px;transition:width .5s"></div>
        </div>
        <div style="font-size:.6rem;color:var(--text-muted);margin-top:2px">${f.leads} lead${f.leads!==1?'s':''} · ${pctGanhos}% das vendas do período</div>
      </div>
    </div>`;
  }).join('');
}


function renderTempoResposta(t) {
  const el = document.getElementById('resp-num');
  if (!t || !t.media_minutos) { el.textContent = '—'; document.getElementById('resp-leads').textContent = 'Sem dados de interação'; return; }
  const mins = Math.round(t.media_minutos);
  if (mins < 60) { el.textContent = mins + ' min'; }
  else { el.textContent = (mins/60).toFixed(1) + ' h'; }
  document.getElementById('resp-leads').textContent = `Baseado em ${t.leads_com_resposta} leads com 1ª interação registrada`;
}

function renderSparkline(dias) {
  const wrap   = document.getElementById('spark-wrap');
  const labels = document.getElementById('spark-labels');
  if (!dias?.length) { wrap.innerHTML = '<div class="empty" style="width:100%">Sem dados no período</div>'; return; }
  const max = Math.max(...dias.map(d => d.quantidade), 1);
  wrap.innerHTML = dias.map(d => {
    const h = Math.max(Math.round((d.quantidade / max) * 100), 4);
    const green = d.ganhos > 0 ? 'var(--green)' : 'rgba(108,255,78,.35)';
    return `<div class="spark-bar" style="height:${h}%;background:${green}" title="${d.dia}: ${d.quantidade} leads, ${d.ganhos} vendas"></div>`;
  }).join('');
  // Labels: primeiro e último dia
  const first = dias[0]?.dia?.slice(5) || '';
  const last  = dias[dias.length-1]?.dia?.slice(5) || '';
  labels.innerHTML = `<span>${first}</span><span>${last}</span>`;
}

function renderMetaPreview(k) {
  document.getElementById('mp-leads').textContent  = fmt(k.total_leads);
  document.getElementById('mp-ganhos').textContent = fmt(k.total_ganhos);
  document.getElementById('mp-fat').textContent    = fmtR(k.faturamento);
  document.getElementById('mp-conv').textContent   = fmtPct(k.taxa_conversao);
}

// ─── Alertas de Recompra (Carteira Recorrente) ───────────────────────────────
let _alertasRecompra = [];

async function carregarAlertasRecompra() {
  const r = await Auth.api('GET', '/leads/alertas-recompra').catch(() => null);
  if (!r?.ok) return;
  _alertasRecompra = r.data.dados || [];
  renderAlertasRecompra();
}

function renderAlertasRecompra() {
  const pendentes = _alertasRecompra.filter(a => !a.alerta_recompra_enviado);
  const n = pendentes.length;

  // Badge no painel dashboard
  const badge = document.getElementById('badge-alertas-recompra');
  if (badge) { badge.textContent = n; badge.style.display = n > 0 ? '' : 'none'; }

  // Badge global na sidebar (todas as páginas via sidebar.js hook)
  const badgeGlobal = document.getElementById('sidebar-badge-recompra');
  if (badgeGlobal) { badgeGlobal.textContent = n; badgeGlobal.style.display = n > 0 ? '' : 'none'; }

  const el = document.getElementById('alertas-recompra-list');
  if (!el) return;
  if (!n) {
    el.innerHTML = '<div class="empty" style="font-size:.73rem">✅ Nenhum alerta de recompra pendente.</div>';
    return;
  }

  const hoje = new Date().toISOString().slice(0,10);

  el.innerHTML = _alertasRecompra.map(a => {
    const alertaDate = a.alerta_recompra_em || '';
    const prevDate   = a.data_prevista_proxima_compra || '';
    const previsao   = a.previsao_proxima_compra || '';
    const vencido    = alertaDate && alertaDate < hoje;

    const alertaStr  = alertaDate ? new Date(alertaDate  + 'T00:00:00').toLocaleDateString('pt-BR') : '?';
    const prevStr    = prevDate   ? new Date(prevDate     + 'T00:00:00').toLocaleDateString('pt-BR') : previsao || '?';

    const urgencia   = vencido
      ? '<span style="color:#ff4d4d;font-weight:700;font-size:.6rem">⚠ VENCIDO</span> '
      : '';

    return `<div class="alerta-recompra-row${vencido?' ar-vencido':''}" data-id="${a.id}">
      <div class="ar-icon" style="color:${vencido?'#ff4d4d':'#F5A623'}">🔄</div>
      <div class="ar-info">
        <div class="ar-nome">${urgencia}${escHtml(a.nome)}${a.empresa ? ' <span style=opacity:.55>· '+escHtml(a.empresa)+'</span>' : ''}</div>
        <div class="ar-meta">
          ${previsao ? 'Faixa: <b>'+escHtml(previsao)+'</b> · ' : ''}
          Próxima compra: <b>${prevStr}</b><br>
          Alerta desde: ${alertaStr}
        </div>
      </div>
      <div class="ar-actions">
        <button class="btn-sm ar-btn-visto" data-lead="${a.id}" title="Marcar como visto">✔</button>
        <button class="btn-sm ar-btn-abrir" data-lead="${a.id}" title="Abrir card na Carteira">→</button>
      </div>
    </div>`;
  }).join('');

  // Bind via addEventListener — seguro e sem XSS
  el.querySelectorAll('.ar-btn-visto').forEach(btn => {
    btn.addEventListener('click', () => marcarAlertaVisto(btn.dataset.lead));
  });
  el.querySelectorAll('.ar-btn-abrir').forEach(btn => {
    btn.addEventListener('click', () => abrirLeadAlerta(btn.dataset.lead));
  });
}

async function marcarAlertaVisto(leadId) {
  const btn = document.querySelector(`.ar-btn-visto[data-lead="${leadId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  const r = await Auth.api('PATCH', `/leads/${leadId}/alerta-recompra-visto`);
  if (r?.ok || r?.data?.sucesso) {
    _alertasRecompra = _alertasRecompra.filter(a => a.id !== leadId); // remove da lista
    renderAlertasRecompra();
    if (typeof Toast !== 'undefined') Toast.show('Alerta marcado como visto.', 'success');
  } else {
    if (btn) { btn.disabled = false; btn.textContent = '✔'; }
    if (typeof Toast !== 'undefined') Toast.show('Erro ao marcar alerta.', 'error');
  }
}

function abrirLeadAlerta(leadId) {
  // Abre pipeline com filtro Carteira Recorrente e lead destacado
  window.open(`/pipeline.html?lead_id=${leadId}`, '_blank');
}


// ─── Mensagens Pendentes ──────────────────────────────────────────────────────────────────
let _pendentes = [];

async function carregarPendentes() {
  const r = await Auth.api('GET', '/whatsapp/pendentes');
  if (!r?.ok) return;
  _pendentes = r.data.dados || [];
  atualizarCardPendentes(_pendentes.length);
}

function atualizarCardPendentes(total) {
  const card = document.getElementById('kpi-pendentes-card');
  const val  = document.getElementById('kpi-pendentes');
  if (!card) return;
  val.textContent = total;
  // Alterna visual: rosa (alert) se há pendentes, verde (zero) se não
  card.className = 'kpi-card ' + (total > 0 ? 'pendente-alert' : 'pendente-zero');
  card.style.cursor = 'pointer';
  // Atualiza sub-título drawer se estiver aberto
  const drawerSub = document.getElementById('drawer-sub');
  if (drawerSub) {
    drawerSub.textContent = total > 0
      ? `${total} conversa${total !== 1 ? 's' : ''} aguardando resposta`
      : 'Nenhuma conversa pendente';
  }
}

function abrirDrawerPendentes() {
  const ov = document.getElementById('drawer-ov');
  ov.classList.add('open');
  renderDrawerPendentes();
}

function fecharDrawerPendentes() {
  document.getElementById('drawer-ov').classList.remove('open');
}

function renderDrawerPendentes() {
  const body = document.getElementById('drawer-body');
  const sub  = document.getElementById('drawer-sub');
  const n    = _pendentes.length;

  if (sub) sub.textContent = n > 0
    ? `${n} conversa${n !== 1 ? 's' : ''} aguardando resposta`
    : 'Nenhuma pendente';

  if (!n) {
    body.innerHTML = `
      <div style="text-align:center;padding:48px 24px;color:var(--text-muted)">
        <div style="font-size:3rem;margin-bottom:12px;opacity:.4">✅</div>
        <div style="font-size:.95rem;font-weight:700;color:var(--text-secondary);margin-bottom:6px">Tudo em dia!</div>
        <div style="font-size:.8rem">Nenhuma conversa aguardando resposta.</div>
      </div>`;
    return;
  }

  body.innerHTML = _pendentes.map(p => {
    const nome     = p.lead_nome || p.nome_contato || p.telefone;
    const initials = (nome || '??').slice(0, 2).toUpperCase();
    const mins     = Number(p.minutos_aguardando) || 0;
    const urgente  = mins > 60;
    const tempoStr = mins < 60 ? `${mins} min` : `${(mins/60).toFixed(1)} h`;
    const preview  = escHtml((p.ultima_mensagem || '').slice(0, 80));
    const funil    = p.funil_nome || '';
    const vendedor = p.vendedor_nome || '—';
    const href = `/whatsapp.html?lead_id=${p.lead_id || ''}&tel=${encodeURIComponent(p.telefone)}&nome=${encodeURIComponent(nome)}`;

    return `<div class="pend-row" data-href="${href}" data-conv="${p.conversa_id}" onclick="abrirPendente(this)">
      <div class="pend-avatar">${initials}</div>
      <div class="pend-info">
        <div class="pend-name">${escHtml(nome)}</div>
        <div class="pend-tel">${p.telefone}${p.lead_empresa ? ' · ' + escHtml(p.lead_empresa) : ''}</div>
        ${preview ? `<div class="pend-preview">“${preview}”</div>` : ''}
        <div class="pend-meta">
          ${funil ? `<span class="pend-badge funil">${escHtml(funil)}</span>` : ''}
          <span class="pend-badge">👤 ${escHtml(vendedor)}</span>
          <span class="pend-badge tempo${urgente ? ' urgente' : ''}">⏱ ${tempoStr}</span>
        </div>
      </div>
      <div style="flex-shrink:0;color:var(--pink);opacity:.7">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      </div>
    </div>`;
  }).join('');
}

function abrirPendente(el) {
  const href = el.dataset.href;
  if (href) {
    fecharDrawerPendentes();
    window.location.href = href;
  }
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function bindEvents() {
  document.getElementById('btn-apply').addEventListener('click', () => {
    _filtros.funil       = document.getElementById('f-funil').value;
    _filtros.resp        = document.getElementById('f-resp').value;
    _filtros.dataTipo    = document.getElementById('f-data-tipo').value;
    _filtros.dataPeriodo = document.getElementById('f-periodo').value;
    _filtros.dataInicio  = document.getElementById('f-inicio').value;
    _filtros.dataFim     = document.getElementById('f-fim').value;

    // ── Logs de diagnóstico ──────────────────────────────────────────────
    console.log('[DASHBOARD_FILTER_APPLY]', _filtros);
    console.log('[FILTRO_VENDEDOR_VALOR_SELECIONADO]',
      _filtros.resp || '(todos)',
      '| nome:', document.getElementById('f-resp').selectedOptions[0]?.text || 'Todos');
    if (_filtros.funil)       console.log('[DASHBOARD_FILTER_FUNIL_SELECTED]',    _filtros.funil,    document.getElementById('f-funil').selectedOptions[0]?.text);
    if (_filtros.resp)        console.log('[DASHBOARD_FILTER_VENDEDOR_SELECTED]', _filtros.resp,     document.getElementById('f-resp').selectedOptions[0]?.text);
    if (_filtros.dataTipo)    console.log('[DASHBOARD_FILTER_DATE_SELECTED]',     _filtros.dataTipo, _filtros.dataPeriodo, _filtros.dataInicio, _filtros.dataFim);

    carregar();
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    _filtros = { funil:'', resp:'', dataTipo:'', dataPeriodo:'', dataInicio:'', dataFim:'' };
    document.getElementById('f-funil').value    = '';
    document.getElementById('f-resp').value     = '';
    document.getElementById('f-data-tipo').value = '';
    document.getElementById('f-periodo').value  = '';
    document.getElementById('f-inicio').value   = '';
    document.getElementById('f-fim').value      = '';
    document.getElementById('periodo-group').style.display = 'none';
    document.getElementById('f-inicio').classList.remove('show');
    document.getElementById('f-fim').classList.remove('show');
    carregar();
  });

  document.getElementById('btn-refresh').addEventListener('click', carregar);

  document.getElementById('f-data-tipo').addEventListener('change', e => {
    document.getElementById('periodo-group').style.display = e.target.value ? '' : 'none';
    if (!e.target.value) { document.getElementById('f-inicio').classList.remove('show'); document.getElementById('f-fim').classList.remove('show'); }
  });

  document.getElementById('f-periodo').addEventListener('change', e => {
    const custom = e.target.value === 'personalizado';
    document.getElementById('f-inicio').classList.toggle('show', custom);
    document.getElementById('f-fim').classList.toggle('show', custom);
  });

  // Drawer pendentes
  document.getElementById('kpi-pendentes-card')?.addEventListener('click', abrirDrawerPendentes);
  document.getElementById('drawer-close')?.addEventListener('click', fecharDrawerPendentes);
  document.getElementById('drawer-ov')?.addEventListener('click', e => {
    if (e.target === document.getElementById('drawer-ov')) fecharDrawerPendentes();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('drawer-ov')?.classList.contains('open')) {
      fecharDrawerPendentes();
    }
  });
}

init();

// ═══════════════════════════════════════════════════════════════════════════════
// PAINEL SDR — Filtro SDR
// ═══════════════════════════════════════════════════════════════════════════════

let _sdrFiltros = { funil_id: '', sdr_id: '', vendedor_id: '', data_inicio: '', data_fim: '' };

async function _sdrPopularFiltros() {
  // Funis
  const selFunil = document.getElementById('sdr-f-funil');
  if (selFunil && _funis.length) {
    selFunil.innerHTML = '<option value="">Todos</option>' +
      _funis.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
  }

  // SDRs ativos
  const selSdr = document.getElementById('sdr-f-sdr');
  if (selSdr) {
    const r = await Auth.api('GET', '/usuarios?incluir_inativos=false');
    const sdrs = (r?.data?.dados || []).filter(u => u.role === 'SDR' && (u.ativo === 1 || u.ativo === true));
    selSdr.innerHTML = '<option value="">Todos</option>' +
      sdrs.map(u => `<option value="${u.id}">${u.nome}</option>`).join('');
    // SDR vê apenas a si mesmo
    if (_usuario.role === 'SDR') {
      selSdr.value = _usuario.id;
      selSdr.disabled = true;
      _sdrFiltros.sdr_id = _usuario.id;
    }
  }

  // Vendedores ativos (destino)
  const selVend = document.getElementById('sdr-f-vendedor');
  if (selVend) {
    const r = await Auth.api('GET', '/responsaveis');
    const vends = (r?.data?.dados || []).filter(u => u.role === 'VENDEDOR');
    selVend.innerHTML = '<option value="">Todos</option>' +
      vends.map(u => `<option value="${u.id}">${u.nome}</option>`).join('');
  }
  console.log('[PERMISSION_SDR_APPLIED] painel SDR exibido para:', _usuario.role);
}

async function carregarSdr() {
  const params = new URLSearchParams();
  if (_sdrFiltros.funil_id)    params.set('funil_id',    _sdrFiltros.funil_id);
  if (_sdrFiltros.sdr_id)      params.set('sdr_id',      _sdrFiltros.sdr_id);
  if (_sdrFiltros.vendedor_id) params.set('vendedor_id', _sdrFiltros.vendedor_id);
  if (_sdrFiltros.data_inicio) params.set('data_inicio', _sdrFiltros.data_inicio);
  if (_sdrFiltros.data_fim)    params.set('data_fim',    _sdrFiltros.data_fim);

  const r = await Auth.api('GET', `/dashboard/sdr?${params}`);
  if (!r?.ok || !r.data?.acesso) {
    console.warn('[PERMISSION_VENDOR_CANNOT_SEE_SDR_QUEUE] acesso negado ou erro:', r?.data?.erro);
    return;
  }
  const d = r.data.dados;
  _renderSdrEtapas(d.etapas);
  _renderSdrConversao(d.conversao_qualificado);
  _renderSdrSla(d.sla_atendimento, d.sla_qualificado);
  _renderSdrOportunidades(d.oportunidades_por_vendedor);
}

function _renderSdrEtapas(etapas) {
  const upd = (sufixo, e) => {
    const el = document.getElementById(`sdr-num-${sufixo}`);
    const pe = document.getElementById(`sdr-pct-${sufixo}`);
    const be = document.getElementById(`sdr-bar-${sufixo}`);
    if (el) el.textContent = e.quantidade;
    if (pe) pe.textContent = sufixo === 'recebido' ? 'base (100%)' : `${e.percentual}%`;
    if (be) be.style.width = `${Math.min(e.percentual, 100)}%`;
  };
  upd('recebido',   etapas.lead_recebido);
  upd('contato',    etapas.contato_realizado);
  upd('desqualif',  etapas.lead_desqualificado);
  upd('qualificado',etapas.lead_qualificado_sdr);
}

function _renderSdrConversao(conv) {
  const el = document.getElementById('sdr-conv-num');
  const pp = document.getElementById('sdr-conv-pct');
  const pb = document.getElementById('sdr-conv-base');
  if (el) el.textContent = conv.quantidade;
  if (pp) pp.textContent = `${conv.percentual}%`;
  if (pb) pb.textContent = conv.total_base > 0 ? `de ${conv.total_base} recebidos` : 'sem base';
}

function _renderSdrSla(slaAtend, slaQual) {
  const atEl = document.getElementById('sdr-sla-atend');
  const alEl = document.getElementById('sdr-sla-atend-leads');
  const quEl = document.getElementById('sdr-sla-qual');
  const qlEl = document.getElementById('sdr-sla-qual-leads');
  if (atEl) atEl.textContent = slaAtend.formatado || '—';
  if (alEl) alEl.textContent = slaAtend.leads_considerados ? `${slaAtend.leads_considerados} leads considerados` : '';
  if (quEl) quEl.textContent = slaQual.formatado || '—';
  if (qlEl) qlEl.textContent = slaQual.leads_considerados ? `${slaQual.leads_considerados} leads considerados` : '';
}

function _renderSdrOportunidades(lista) {
  const el = document.getElementById('sdr-oportunidades');
  if (!el) return;
  if (!lista || lista.length === 0) {
    el.innerHTML = '<div class="empty">Nenhuma oportunidade qualificada no período</div>';
    return;
  }
  el.innerHTML = lista.map((v, i) => `
    <div class="sdr-oport-row">
      <span class="sdr-oport-rank">${i + 1}</span>
      <span class="sdr-oport-nome">${v.vendedor_nome}</span>
      <span class="sdr-oport-qty">${v.quantidade} <small>leads</small></span>
      <span class="sdr-oport-pct-badge">${v.percentual}%</span>
      <div class="sdr-oport-bar-wrap">
        <div class="sdr-oport-bar-fill" style="width:${v.percentual}%"></div>
      </div>
    </div>
  `).join('');
}

function _sdrBindEvents() {
  document.getElementById('sdr-btn-apply')?.addEventListener('click', () => {
    _sdrFiltros.funil_id    = document.getElementById('sdr-f-funil')?.value    || '';
    _sdrFiltros.sdr_id      = document.getElementById('sdr-f-sdr')?.value      || '';
    _sdrFiltros.vendedor_id = document.getElementById('sdr-f-vendedor')?.value || '';
    _sdrFiltros.data_inicio = document.getElementById('sdr-f-inicio')?.value   || '';
    _sdrFiltros.data_fim    = document.getElementById('sdr-f-fim')?.value      || '';
    // SDR nunca pode mudar o filtro sdr_id para outro
    if (_usuario.role === 'SDR') _sdrFiltros.sdr_id = _usuario.id;
    carregarSdr();
  });
  document.getElementById('sdr-btn-clear')?.addEventListener('click', () => {
    _sdrFiltros = { funil_id: '', sdr_id: _usuario.role === 'SDR' ? _usuario.id : '', vendedor_id: '', data_inicio: '', data_fim: '' };
    ['sdr-f-funil','sdr-f-sdr','sdr-f-vendedor','sdr-f-inicio','sdr-f-fim'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.disabled) el.value = '';
    });
    carregarSdr();
  });
}
