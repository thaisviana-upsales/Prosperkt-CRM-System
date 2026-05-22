/**
 * PROSPERKT CRM — Funis.js
 * Grid de funis + modal criar/editar + drawer editor de pipeline
 */

let _funis = [], _usuario = null, _canEdit = false;
let _drawerFunilId = null, _pipelineId = null;
let _etapas = []; // etapas do funil no drawer
let _dragSrc = null;

const CORES = ['#6CFF4E','#E10098','#3B8BFF','#FFB627','#FF3B5C','#25D366','#6C47FF','#FF6B35','#0077B5','#9b59b6','#F5F5F5'];

// ── Init ──────────────────────────────────────────────────────
async function init() {
  _usuario = await Sidebar.init('funis', 'GESTOR');
  if (!_usuario) return;
  _canEdit = _usuario.role === 'SUPER_ADMIN';
  if (_canEdit) document.getElementById('btn-novo').style.display = '';
  renderSwatches('modal-swatches', 'f-cor');
  await carregar();
  bindEvents();
}

// ── Dados ─────────────────────────────────────────────────────
async function carregar() {
  const r = await Auth.api('GET', '/funis');
  if (!r?.ok) { Toast.show('Erro ao carregar funis.', 'error'); return; }
  _funis = r.data.dados;
  renderGrid();
}

// ── Grid ──────────────────────────────────────────────────────
function renderGrid() {
  const el = document.getElementById('funis-grid');
  if (!_funis.length) {
    el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:64px;color:var(--text-muted)">Nenhum funil encontrado.</div>';
    return;
  }
  el.innerHTML = _funis.map(f => `
    <div class="funil-card">
      <div class="funil-card-bar" style="background:${f.cor}"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div class="color-dot" style="background:${f.cor}"></div>
        <div class="funil-name">${f.nome}</div>
        <span class="badge ${f.ativo ? 'badge-green' : 'badge-muted'}" style="margin-left:auto">${f.ativo ? 'Ativo' : 'Inativo'}</span>
      </div>
      <div class="funil-meta">${f.descricao || 'Pipeline própria · Etapas configuradas'}</div>
      <div class="funil-actions">
        <a href="/pipeline.html?funil_id=${f.id}" class="btn btn-ghost btn-sm" style="flex:1;text-decoration:none">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
          Ver Pipeline
        </a>
        ${_canEdit ? `
        <button class="btn btn-ghost btn-sm" data-edit="${f.id}" title="Editar funil">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-primary btn-sm" data-pipeline="${f.id}" title="Editar pipeline">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          Pipeline
        </button>` : ''}
      </div>
    </div>`).join('');

  // Event delegation — sem onclick inline (CSP)
  el.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => abrirModalEditar(btn.dataset.edit)));
  el.querySelectorAll('[data-pipeline]').forEach(btn =>
    btn.addEventListener('click', () => abrirDrawer(btn.dataset.pipeline)));
}

// ── Swatches ──────────────────────────────────────────────────
function renderSwatches(containerId, inputId) {
  const el = document.getElementById(containerId);
  el.innerHTML = CORES.map(c =>
    `<div class="cswatch" style="background:${c}" data-cor="${c}" title="${c}"></div>`).join('');
  el.querySelectorAll('.cswatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.getElementById(inputId).value = sw.dataset.cor;
      el.querySelectorAll('.cswatch').forEach(x => x.classList.remove('sel'));
      sw.classList.add('sel');
    });
  });
}

function setSwatch(containerId, cor) {
  document.getElementById(containerId).querySelectorAll('.cswatch').forEach(sw => {
    sw.classList.toggle('sel', sw.dataset.cor === cor);
  });
}

// ── Modal criar/editar funil ──────────────────────────────────
function abrirModalCriar() {
  document.getElementById('modal-title').textContent = 'Novo Funil';
  document.getElementById('f-id').value = '';
  document.getElementById('f-nome').value = '';
  document.getElementById('f-cor').value = '#6CFF4E';
  document.getElementById('f-desc').value = '';
  document.getElementById('f-ativo').value = '1';
  document.getElementById('modal-alert').style.display = 'none';
  setSwatch('modal-swatches', '#6CFF4E');
  document.getElementById('modal-ov').classList.add('open');
  document.getElementById('f-nome').focus();
}

function abrirModalEditar(id) {
  const f = _funis.find(x => x.id === id);
  if (!f) return;
  document.getElementById('modal-title').textContent = 'Editar Funil';
  document.getElementById('f-id').value = f.id;
  document.getElementById('f-nome').value = f.nome;
  document.getElementById('f-cor').value = f.cor || '#6CFF4E';
  document.getElementById('f-desc').value = f.descricao || '';
  document.getElementById('f-ativo').value = String(f.ativo ?? 1);
  document.getElementById('modal-alert').style.display = 'none';
  setSwatch('modal-swatches', f.cor || '#6CFF4E');
  document.getElementById('modal-ov').classList.add('open');
  document.getElementById('f-nome').focus();
}

function fecharModal() { document.getElementById('modal-ov').classList.remove('open'); }

async function salvarFunil() {
  const id   = document.getElementById('f-id').value;
  const nome = document.getElementById('f-nome').value.trim();
  const alertEl = document.getElementById('modal-alert');
  alertEl.style.display = 'none';
  if (!nome) { alertEl.className='alert alert-error'; alertEl.textContent='Nome é obrigatório.'; alertEl.style.display=''; return; }

  const body = {
    nome, cor: document.getElementById('f-cor').value,
    descricao: document.getElementById('f-desc').value.trim() || undefined,
    ativo: parseInt(document.getElementById('f-ativo').value),
  };

  const btn = document.getElementById('modal-salvar');
  btn.disabled = true;
  document.getElementById('modal-salvar-txt').textContent = 'Salvando...';
  document.getElementById('modal-spinner').classList.remove('hidden');
  try {
    const r = id ? await Auth.api('PATCH', `/funis/${id}`, body) : await Auth.api('POST', '/funis', body);
    if (r?.ok) { Toast.show(id ? 'Funil atualizado!' : 'Funil criado!', 'success'); fecharModal(); await carregar(); }
    else { alertEl.className='alert alert-error'; alertEl.textContent=r?.data?.erro||'Erro.'; alertEl.style.display=''; }
  } finally {
    btn.disabled = false;
    document.getElementById('modal-salvar-txt').textContent = 'Salvar';
    document.getElementById('modal-spinner').classList.add('hidden');
  }
}

// ── Drawer pipeline editor ─────────────────────────────────────
async function abrirDrawer(funilId) {
  _drawerFunilId = funilId;
  const funil = _funis.find(f => f.id === funilId);
  document.getElementById('drawer-title').textContent = `Editar Pipeline — ${funil?.nome || ''}`;
  document.getElementById('drawer-sub').textContent = 'Etapas, ordem, cor e SLA';
  document.getElementById('df-nome').value = funil?.nome || '';
  document.getElementById('df-cor').value = funil?.cor || '#6CFF4E';
  document.getElementById('df-ativo').value = String(funil?.ativo ?? 1);
  document.getElementById('drawer-alert').style.display = 'none';
  document.getElementById('drawer-ov').classList.add('open');
  await carregarEtapas();
}

function fecharDrawer() { document.getElementById('drawer-ov').classList.remove('open'); }

async function carregarEtapas() {
  const r = await Auth.api('GET', `/funis/${_drawerFunilId}`);
  if (!r?.ok) { Toast.show('Erro ao carregar etapas.', 'error'); return; }
  _pipelineId = r.data.dados.pipeline_id;
  _etapas = r.data.dados.etapas || [];
  renderEtapas();
}

function renderEtapas() {
  const el = document.getElementById('etapas-list');
  if (!_etapas.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:.875rem;padding:8px 0">Sem etapas cadastradas.</div>'; return; }
  el.innerHTML = _etapas.map((e, i) => `
    <div class="etapa-row" data-id="${e.id}" data-idx="${i}" draggable="true">
      <span class="etapa-handle">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </span>
      <button class="etapa-color-btn" style="background:${e.cor}" data-id="${e.id}" title="Mudar cor"></button>
      <input class="etapa-name-input" data-id="${e.id}" value="${e.nome}" placeholder="Nome da etapa">
      <input class="etapa-sla" data-id="${e.id}" type="number" value="${e.sla_horas||''}" placeholder="SLA(h)" min="0" title="SLA em horas">
      ${e.is_ganho ? '<span class="etapa-badge ganho">GANHO</span>' : ''}
      ${e.is_perdido ? '<span class="etapa-badge perdido">PERDIDO</span>' : ''}
      <button class="etapa-del" data-id="${e.id}" title="Excluir etapa">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
      </button>
    </div>`).join('');

  // Bind inline events (no onclick inline — CSP safe)
  el.querySelectorAll('.etapa-name-input').forEach(inp => {
    inp.addEventListener('change', e => salvarCampoEtapa(inp.dataset.id, { nome: inp.value.trim() }));
  });
  el.querySelectorAll('.etapa-sla').forEach(inp => {
    inp.addEventListener('change', () => salvarCampoEtapa(inp.dataset.id, { sla_horas: parseInt(inp.value)||null }));
  });
  el.querySelectorAll('.etapa-del').forEach(btn => {
    btn.addEventListener('click', () => excluirEtapa(btn.dataset.id));
  });
  el.querySelectorAll('.etapa-color-btn').forEach(btn => {
    btn.addEventListener('click', () => escolherCorEtapa(btn.dataset.id, btn));
  });

  // Drag-and-drop para reordenar
  el.querySelectorAll('.etapa-row').forEach(row => {
    row.addEventListener('dragstart', () => { _dragSrc = row; row.classList.add('dragging'); });
    row.addEventListener('dragend',   () => row.classList.remove('dragging'));
    row.addEventListener('dragover',  e => { e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', e => {
      e.preventDefault(); row.classList.remove('drag-over');
      if (_dragSrc && _dragSrc !== row) {
        const srcIdx = parseInt(_dragSrc.dataset.idx);
        const dstIdx = parseInt(row.dataset.idx);
        const moved  = _etapas.splice(srcIdx, 1)[0];
        _etapas.splice(dstIdx, 0, moved);
        renderEtapas();
      }
    });
  });
}

async function salvarCampoEtapa(id, campos) {
  const r = await Auth.api('PATCH', `/etapas/${id}`, campos);
  if (r?.ok) {
    const etapa = _etapas.find(e => e.id === id);
    if (etapa) Object.assign(etapa, campos);
    Toast.show('Etapa salva!', 'success');
  } else {
    Toast.show(r?.data?.erro || 'Erro ao salvar etapa.', 'error');
  }
}

async function escolherCorEtapa(id, btn) {
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = btn.style.background || '#6CFF4E';
  inp.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0';
  document.body.appendChild(inp);
  inp.addEventListener('change', async () => {
    const cor = inp.value;
    await salvarCampoEtapa(id, { cor });
    btn.style.background = cor;
    const etapa = _etapas.find(e => e.id === id);
    if (etapa) etapa.cor = cor;
    inp.remove();
  });
  inp.click();
}

async function excluirEtapa(id) {
  const etapa = _etapas.find(e => e.id === id);
  if (!etapa) return;
  const r = await Auth.api('DELETE', `/etapas/${id}`);
  if (r?.ok) {
    _etapas = _etapas.filter(e => e.id !== id);
    renderEtapas();
    Toast.show('Etapa excluída.', 'success');
  } else {
    // Pode ter leads — mostra mensagem
    const msg = r?.data?.erro || 'Não é possível excluir.';
    const alertEl = document.getElementById('drawer-alert');
    alertEl.className = 'alert alert-error';
    alertEl.textContent = msg;
    alertEl.style.display = '';
    setTimeout(() => alertEl.style.display = 'none', 6000);
  }
}

async function adicionarEtapa() {
  if (!_pipelineId) { Toast.show('Funil sem pipeline.', 'error'); return; }
  const novaOrdem = _etapas.length > 0 ? Math.max(..._etapas.map(e => e.ordem || 0)) + 1 : 0;
  const r = await Auth.api('POST', '/etapas', {
    pipeline_id: _pipelineId,
    nome: 'Nova Etapa',
    cor: '#3B8BFF',
    ordem: novaOrdem,
  });
  if (r?.ok) {
    _etapas.push(r.data.dados);
    renderEtapas();
    // Foca no novo campo de nome
    setTimeout(() => {
      const inputs = document.querySelectorAll('.etapa-name-input');
      if (inputs.length) { const last = inputs[inputs.length-1]; last.select(); last.focus(); }
    }, 50);
    Toast.show('Etapa adicionada!', 'success');
  } else {
    Toast.show(r?.data?.erro || 'Erro ao adicionar etapa.', 'error');
  }
}

async function salvarOrdemEtapas() {
  const ordemPayload = _etapas.map((e, i) => ({ id: e.id, ordem: i }));
  const r = await Auth.api('POST', '/etapas/reordenar', { ordem: ordemPayload });
  if (r?.ok) {
    Toast.show('Ordem salva com sucesso!', 'success');
    // Atualiza ordens localmente
    _etapas.forEach((e, i) => e.ordem = i);
  } else {
    Toast.show(r?.data?.erro || 'Erro ao salvar ordem.', 'error');
  }
}

async function salvarDadosFunil() {
  const nome  = document.getElementById('df-nome').value.trim();
  const cor   = document.getElementById('df-cor').value;
  const ativo = parseInt(document.getElementById('df-ativo').value);
  if (!nome) { Toast.show('Nome é obrigatório.', 'error'); return; }
  const r = await Auth.api('PATCH', `/funis/${_drawerFunilId}`, { nome, cor, ativo });
  if (r?.ok) {
    document.getElementById('drawer-title').textContent = `Editar Pipeline — ${nome}`;
    Toast.show('Funil atualizado!', 'success');
    await carregar(); // Atualiza o grid
  } else {
    Toast.show(r?.data?.erro || 'Erro ao salvar.', 'error');
  }
}

// ── Events ────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btn-novo').addEventListener('click', abrirModalCriar);
  document.getElementById('modal-close').addEventListener('click', fecharModal);
  document.getElementById('modal-cancelar').addEventListener('click', fecharModal);
  document.getElementById('modal-salvar').addEventListener('click', salvarFunil);
  document.getElementById('modal-ov').addEventListener('click', e => { if (e.target === document.getElementById('modal-ov')) fecharModal(); });

  document.getElementById('drawer-close').addEventListener('click', fecharDrawer);
  document.getElementById('drawer-cancelar').addEventListener('click', fecharDrawer);
  document.getElementById('drawer-ov').addEventListener('click', e => { if (e.target === document.getElementById('drawer-ov')) fecharDrawer(); });
  document.getElementById('drawer-salvar-ordem').addEventListener('click', salvarOrdemEtapas);
  document.getElementById('btn-add-etapa').addEventListener('click', adicionarEtapa);
  document.getElementById('df-salvar-funil').addEventListener('click', salvarDadosFunil);
}

init();
