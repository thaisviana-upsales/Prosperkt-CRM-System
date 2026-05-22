/**
 * PROSPERKT CRM — mensagens-padrao.js
 * Biblioteca de scripts reutilizáveis
 */

let _usuario   = null;
let _msgs      = [];
let _funis     = [];
let _cats      = [];
let _catAtiva  = '';
let _buscaVal  = '';
let _editId    = null;
let _delId     = null;
let _canEdit   = false; // gestor ou super_admin

async function init() {
  _usuario = await Sidebar.init('mensagens-padrao');
  if (!_usuario) return;

  _canEdit = ['SUPER_ADMIN','GESTOR'].includes(_usuario.role);
  const isSA = _usuario.role === 'SUPER_ADMIN';

  if (_canEdit) {
    document.getElementById('btn-nova').style.display = '';
  } else {
    document.getElementById('info-perm').style.display = 'flex';
  }

  await Promise.all([carregarCategorias(), carregarFunis(), carregarMensagens()]);
  bindEvents();
}

// ── Data ────────────────────────────────────────────────────────────────────
async function carregarCategorias() {
  const r = await Auth.api('GET', '/mensagens-padrao/categorias');
  _cats = r?.data?.dados || [];
  renderCatFilters();
  popularSelectCat();
}

async function carregarFunis() {
  const r = await Auth.api('GET', '/funis');
  _funis = r?.data?.dados || [];
  const sel = document.getElementById('f-funil');
  sel.innerHTML = '<option value="">Todos os funis</option>' +
    _funis.map(f => `<option value="${f.id}">${esc(f.nome)}</option>`).join('');
}

async function carregarMensagens() {
  const params = new URLSearchParams();
  if (_catAtiva)  params.set('categoria', _catAtiva);
  if (_buscaVal)  params.set('busca', _buscaVal);
  const r = await Auth.api('GET', `/mensagens-padrao?${params}`);
  if (!r?.ok) { Toast.show('Erro ao carregar mensagens.', 'error'); return; }
  _msgs = r.data.dados || [];
  renderGrid();
  renderStats();
}

// ── Render filtros ───────────────────────────────────────────────────────────
function renderCatFilters() {
  const el = document.getElementById('cat-filters');
  // Apenas categorias presentes na base (+ "Todas")
  const catsPresentes = [...new Set(_cats)];
  el.innerHTML = `<button class="mp-cat-chip ${_catAtiva===''?'active':''}" data-cat="">Todas</button>` +
    catsPresentes.map(c => `<button class="mp-cat-chip ${_catAtiva===c?'active':''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');

  el.querySelectorAll('.mp-cat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      _catAtiva = btn.dataset.cat;
      carregarMensagens();
      el.querySelectorAll('.mp-cat-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function popularSelectCat() {
  const sel = document.getElementById('f-categoria');
  sel.innerHTML = _cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

// ── Render stats ─────────────────────────────────────────────────────────────
function renderStats() {
  document.getElementById('stat-total').textContent = _msgs.length;
  document.getElementById('stat-ativas').textContent = _msgs.filter(m => m.ativo).length;
  const catSet = new Set(_msgs.map(m => m.categoria));
  document.getElementById('stat-cats').textContent = catSet.size;
}

// ── Render grid ──────────────────────────────────────────────────────────────
function renderGrid() {
  const el = document.getElementById('mp-grid');
  if (!_msgs.length) {
    el.innerHTML = `
      <div class="mp-empty" style="grid-column:1/-1">
        <div class="mp-empty-icon">📋</div>
        <div style="font-size:1rem;font-weight:700;color:var(--text-secondary);margin-bottom:6px">Nenhuma mensagem encontrada</div>
        <div style="font-size:.82rem;margin-bottom:20px">${_canEdit ? 'Crie a primeira mensagem padrão da sua equipe.' : 'Nenhuma mensagem cadastrada ainda.'}</div>
        ${_canEdit ? `<button class="btn btn-primary" id="btn-empty-nova">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Criar mensagem
        </button>` : ''}
      </div>`;
    document.getElementById('btn-empty-nova')?.addEventListener('click', () => abrirModalForm());
    return;
  }
  el.innerHTML = _msgs.map(m => renderCard(m)).join('');
  // Bind toggle e botões nos cards
  _msgs.forEach(m => {
    const tog = document.getElementById(`tog-${m.id}`);
    if (tog) {
      tog.addEventListener('change', () => toggleAtivo(m.id, tog.checked));
    }
    document.getElementById(`btn-edit-${m.id}`)?.addEventListener('click', () => abrirModalForm(m.id));
    document.getElementById(`btn-del-${m.id}`)?.addEventListener('click', () => confirmarDel(m.id));
  });
}

function renderCard(m) {
  const isSA = _usuario.role === 'SUPER_ADMIN';
  const podeEditar = _canEdit;
  const podeExcluir = isSA;
  const preview = m.texto.slice(0, 140);

  return `
  <div class="mp-card ${m.ativo?'':'inactive'}">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
      <div style="min-width:0;flex:1">
        <div style="font-size:.9rem;font-weight:800;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.titulo)}</div>
        <span class="mp-cat-badge">${esc(m.categoria)}</span>
        ${m.funil_nome ? `<span style="font-size:.68rem;color:var(--text-muted);margin-left:6px">· ${esc(m.funil_nome)}</span>` : ''}
      </div>
      ${podeEditar ? `<label class="toggle" style="margin-top:2px">
        <input type="checkbox" id="tog-${m.id}" ${m.ativo?'checked':''}>
        <span class="toggle-slider"></span>
      </label>` : ''}
    </div>

    <div class="mp-texto">${esc(preview)}${preview.length < m.texto.length ? '…' : ''}</div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <span style="font-size:.68rem;color:var(--text-muted)">${m.criado_por_nome ? `Por ${esc(m.criado_por_nome)}` : ''}</span>
      <div style="display:flex;gap:6px">
        ${podeEditar ? `<button id="btn-edit-${m.id}" class="btn btn-secondary btn-sm">Editar</button>` : ''}
        ${podeExcluir ? `<button id="btn-del-${m.id}" class="btn btn-sm" style="background:rgba(225,0,152,.08);color:var(--pink);border:1px solid rgba(225,0,152,.2)">Excluir</button>` : ''}
      </div>
    </div>
  </div>`;
}

// ── Modal form ───────────────────────────────────────────────────────────────
async function abrirModalForm(id = null) {
  _editId = id;
  document.getElementById('form-alert').style.display = 'none';
  document.getElementById('modal-form-titulo').textContent = id ? 'Editar Mensagem' : 'Nova Mensagem Padrão';

  // Reset
  document.getElementById('f-id').value      = '';
  document.getElementById('f-titulo').value  = '';
  document.getElementById('f-categoria').value = _cats[0] || '';
  document.getElementById('f-funil').value   = '';
  document.getElementById('f-texto').value   = '';
  document.getElementById('f-ativo').checked = true;
  document.getElementById('f-preview').innerHTML = '<em style="opacity:.35">A mensagem aparecerá aqui...</em>';

  if (id) {
    const m = _msgs.find(x => x.id === id);
    if (m) {
      document.getElementById('f-id').value       = m.id;
      document.getElementById('f-titulo').value   = m.titulo;
      document.getElementById('f-categoria').value= m.categoria;
      document.getElementById('f-funil').value    = m.funil_id || '';
      document.getElementById('f-texto').value    = m.texto;
      document.getElementById('f-ativo').checked  = !!m.ativo;
      atualizarPreview();
    }
  }

  document.getElementById('modal-form-ov').classList.add('open');
  setTimeout(() => document.getElementById('f-titulo').focus(), 60);
}

function fecharModalForm() {
  document.getElementById('modal-form-ov').classList.remove('open');
  _editId = null;
}

async function salvarForm() {
  const alertEl = document.getElementById('form-alert');
  alertEl.style.display = 'none';

  const titulo    = document.getElementById('f-titulo').value.trim();
  const categoria = document.getElementById('f-categoria').value;
  const funil_id  = document.getElementById('f-funil').value;
  const texto     = document.getElementById('f-texto').value.trim();
  const ativo     = document.getElementById('f-ativo').checked ? 1 : 0;
  const id        = document.getElementById('f-id').value;

  if (!titulo)    { showAlert('Título é obrigatório.'); return; }
  if (!categoria) { showAlert('Categoria é obrigatória.'); return; }
  if (!texto)     { showAlert('Texto da mensagem é obrigatório.'); return; }

  const btn = document.getElementById('btn-modal-form-salvar');
  btn.disabled = true;

  const payload = { titulo, categoria, texto, funil_id: funil_id || null, ativo };
  const r = id
    ? await Auth.api('PATCH', `/mensagens-padrao/${id}`, payload)
    : await Auth.api('POST', '/mensagens-padrao', payload);

  btn.disabled = false;

  if (r?.ok) {
    Toast.show(id ? 'Mensagem atualizada!' : 'Mensagem criada!', 'success');
    fecharModalForm();
    await carregarMensagens();
  } else {
    showAlert(r?.data?.erro || 'Erro ao salvar.');
  }
}

function showAlert(msg) {
  const el = document.getElementById('form-alert');
  el.textContent = msg;
  el.style.display = '';
}

// ── Toggle ativo ─────────────────────────────────────────────────────────────
async function toggleAtivo(id, estado) {
  const r = await Auth.api('PATCH', `/mensagens-padrao/${id}`, { ativo: estado ? 1 : 0 });
  if (r?.ok) {
    Toast.show(estado ? 'Ativada!' : 'Desativada.', 'success');
    await carregarMensagens();
  } else {
    Toast.show('Erro ao atualizar.', 'error');
    await carregarMensagens();
  }
}

// ── Deletar ──────────────────────────────────────────────────────────────────
function confirmarDel(id) {
  _delId = id;
  document.getElementById('modal-del-ov').classList.add('open');
}
function fecharModalDel() {
  document.getElementById('modal-del-ov').classList.remove('open');
  _delId = null;
}
async function executarDel() {
  const r = await Auth.api('DELETE', `/mensagens-padrao/${_delId}`);
  if (r?.ok) {
    Toast.show('Mensagem excluída.', 'success');
    fecharModalDel();
    await carregarMensagens();
  } else {
    Toast.show(r?.data?.erro || 'Erro.', 'error');
  }
}

// ── Preview em tempo real ────────────────────────────────────────────────────
function atualizarPreview() {
  const txt = document.getElementById('f-texto').value;
  const el  = document.getElementById('f-preview');
  if (!txt.trim()) {
    el.innerHTML = '<em style="opacity:.35">A mensagem aparecerá aqui...</em>';
    return;
  }
  const preview = txt
    .replace(/\[nome_lead\]/gi,     'João Silva')
    .replace(/\[nome_vendedor\]/gi, _usuario?.nome || 'Carlos')
    .replace(/\[nome_empresa\]/gi,  'Empresa Exemplo')
    .replace(/\[telefone_lead\]/gi, '11999990000')
    .replace(/\[funil\]/gi,         'Tráfego Pago')
    .replace(/\[etapa\]/gi,         'Lead Recebido')
    .replace(/\[empresa\]/gi,       'Empresa Exemplo');
  el.textContent = preview;
}

// ── Chips de variáveis ───────────────────────────────────────────────────────
function inserirVar(v) {
  const ta = document.getElementById('f-texto');
  const s = ta.selectionStart, e = ta.selectionEnd;
  ta.value = ta.value.slice(0, s) + v + ta.value.slice(e);
  ta.setSelectionRange(s + v.length, s + v.length);
  ta.focus();
  atualizarPreview();
}

// ── Bind events ──────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btn-nova').addEventListener('click', () => abrirModalForm());

  // Busca
  let buscaTimer;
  document.getElementById('busca-input').addEventListener('input', e => {
    clearTimeout(buscaTimer);
    _buscaVal = e.target.value.trim();
    buscaTimer = setTimeout(carregarMensagens, 350);
  });

  // Modal form
  document.getElementById('btn-modal-form-close').addEventListener('click', fecharModalForm);
  document.getElementById('btn-modal-form-cancelar').addEventListener('click', fecharModalForm);
  document.getElementById('btn-modal-form-salvar').addEventListener('click', salvarForm);
  document.getElementById('modal-form-ov').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-form-ov')) fecharModalForm();
  });

  // Preview tempo real
  document.getElementById('f-texto').addEventListener('input', atualizarPreview);

  // Chips
  document.querySelectorAll('.var-chip').forEach(chip => {
    chip.addEventListener('click', () => inserirVar(chip.dataset.var));
  });

  // Modal del
  document.getElementById('btn-del-cancelar').addEventListener('click', fecharModalDel);
  document.getElementById('btn-del-confirmar').addEventListener('click', executarDel);
  document.getElementById('modal-del-ov').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-del-ov')) fecharModalDel();
  });

  // Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { fecharModalForm(); fecharModalDel(); }
  });
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
