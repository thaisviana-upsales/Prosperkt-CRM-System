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

  await carregar();
  bindEvents();
  // Auto-refresh a cada 60s
  _autoTimer = setInterval(carregar, 60000);
}

async function carregarFunis() {
  const r = await Auth.api('GET', '/funis?somente_ativos=true');
  _funis = r?.data?.dados || [];
  const sel = document.getElementById('f-funil');
  sel.innerHTML = '<option value="">Todos</option>' +
    _funis.map(f => `<option value="${f.id}">${f.nome}</option>`).join('');
}

async function carregarUsuarios() {
  if (_usuario.role === 'VENDEDOR') {
    document.getElementById('f-resp').closest('.fg').style.display = 'none';
    return;
  }
  const r = await Auth.api('GET', '/usuarios');
  const users = (r?.data?.dados || []).filter(u => u.ativo);
  const sel = document.getElementById('f-resp');
  sel.innerHTML = '<option value="">Todos</option>' +
    users.map(u => `<option value="${u.id}">${u.nome}</option>`).join('');
}

function buildQuery() {
  const p = [];
  if (_filtros.funil)       p.push(`funil_id=${_filtros.funil}`);
  if (_filtros.resp)        p.push(`responsavel_id=${_filtros.resp}`);
  if (_filtros.dataTipo)    p.push(`data_tipo=${_filtros.dataTipo}`);
  if (_filtros.dataPeriodo) p.push(`data_periodo=${_filtros.dataPeriodo}`);
  if (_filtros.dataInicio)  p.push(`data_inicio=${_filtros.dataInicio}`);
  if (_filtros.dataFim)     p.push(`data_fim=${_filtros.dataFim}`);
  return p.length ? '?' + p.join('&') : '';
}

async function carregar() {
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

  // Mínimo 72% para garantir que o nome sempre cabe na camada
  const MAX_W = 100;
  const MIN_W = 72;
  const maxQtd = Math.max(...etapas.map(e => e.quantidade), 1);
  const total  = etapas.length;
  const widths = etapas.map(e => Math.max(MIN_W, Math.round((e.quantidade / maxQtd) * MAX_W)));

  el.innerHTML = '<div class="fv-premium">' + etapas.map((e, i) => {
    const w      = widths[i];
    const cor    = etapaCor(e, i, total);
    const isNeg  = e.is_perdido || /desqualif|perdid/i.test(e.nome || '');
    const isGanho = e.is_ganho || /venda|ganho|fechad/i.test(e.nome || '');

    const shadow = isGanho
      ? '0 0 0 1.5px rgba(91,222,62,.5),0 3px 14px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.14)'
      : isNeg
      ? '0 0 0 1px rgba(160,10,30,.35),0 2px 8px rgba(0,0,0,.45)'
      : '0 2px 8px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.07)';

    const convTxt = e.taxa_entrada != null
      ? (isNeg ? `↘ ${e.taxa_entrada}%` : `${e.taxa_entrada}%`) : '';

    const arrow = i > 0
      ? `<div class="fv-arrow"><span style="opacity:.3;font-size:.5rem">▼</span><span class="fv-arrow-rate">${convTxt}</span></div>`
      : '';

    return `${arrow}<div class="fv-layer" style="width:${w}%;background:${cor};box-shadow:${shadow}">
      <div class="fv-layer-inner">
        <span class="fv-layer-name">${e.nome}</span>
        <span class="fv-layer-count">${e.quantidade}</span>
      </div>
    </div>`;
  }).join('') + '</div>';

  requestAnimationFrame(() => {
    el.querySelectorAll('.fv-layer').forEach((layer, i) => {
      layer.style.opacity = '0';
      layer.style.transform = 'scaleX(.9)';
      setTimeout(() => {
        layer.style.transition = 'opacity .4s ease, transform .4s ease';
        layer.style.opacity = '1';
        layer.style.transform = 'scaleX(1)';
      }, i * 50);
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
  const max = Math.max(...lista.map(f => f.faturamento), 1);
  el.innerHTML = lista.map(f => {
    const pct = Math.round((f.faturamento / max) * 100);
    const funil = _funis.find(x => x.id === f.id);
    const cor = funil?.cor || f.cor || '#6CFF4E';
    return `<div class="funil-row">
      <div class="funil-dot" style="background:${cor}"></div>
      <span class="funil-nome">${f.nome}</span>
      <div style="flex:2;height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden;margin:0 8px">
        <div style="width:${pct}%;height:100%;background:${cor};border-radius:3px;transition:width .5s"></div>
      </div>
      <span class="funil-val">${fmtR(f.faturamento)}</span>
      <span class="funil-leads">${f.leads} leads</span>
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
