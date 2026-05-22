/**
 * PROSPERKT CRM — automacoes.js
 * Interface de configuração de automações de primeira mensagem WA
 */

let _usuario    = null;
let _automacoes = [];
let _funis      = [];
let _editId     = null;
let _delId      = null;

// Mensagem padrão para Tráfego Pago
const MSG_PADRAO = `Olá! 😊 Aqui é o(a) [nome_vendedor] da Prosperkt.

Recebi seu contato e vou assumir seu atendimento por aqui. Antes de começarmos, me conta:

1️⃣ Como você prefere ser chamado(a)?
2️⃣ Qual empresa ou negócio você representa?
3️⃣ O que você procura hoje: orçamento, informação ou uma solução específica?

Assim consigo direcionar você mais rápido 🚀`;

async function init() {
  _usuario = await Sidebar.init('automacoes');
  if (!_usuario) return;

  // Controle de permissão
  const isSuperAdmin = _usuario.role === 'SUPER_ADMIN';
  document.getElementById('btn-nova').style.display = isSuperAdmin ? '' : 'none';
  if (!isSuperAdmin) {
    document.getElementById('info-permissao').style.display = 'flex';
  }

  await Promise.all([carregarFunis(), carregarAutomacoes()]);
  bindEvents();
}

// ── Carregar funis ──────────────────────────────────────────────────────────
async function carregarFunis() {
  const r = await Auth.api('GET', '/funis');
  _funis = r?.data?.dados || [];
  const sel = document.getElementById('f-funil');
  sel.innerHTML = '<option value="">Todos os funis</option>' +
    _funis.map(f => `<option value="${f.id}">${escHtml(f.nome)}</option>`).join('');
}

// ── Carregar automações ─────────────────────────────────────────────────────
async function carregarAutomacoes() {
  const r = await Auth.api('GET', '/automacoes/mensagens');
  if (!r?.ok) { Toast.show('Erro ao carregar automações.', 'error'); return; }
  _automacoes = r.data.dados || [];
  renderLista();
}

// ── Render ──────────────────────────────────────────────────────────────────
function renderLista() {
  const el = document.getElementById('auto-lista');

  if (!_automacoes.length) {
    el.innerHTML = `
      <div class="auto-empty">
        <div class="auto-empty-icon">⚡</div>
        <div style="font-size:1rem;font-weight:700;color:var(--text-secondary);margin-bottom:6px">Nenhuma automação configurada</div>
        <div style="font-size:.82rem;margin-bottom:20px">Crie uma automação para enviar mensagens automáticas quando leads entrarem no CRM</div>
        ${_usuario.role === 'SUPER_ADMIN'
          ? `<button class="btn btn-primary" onclick="abrirModal()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Criar primeira automação
             </button>`
          : ''}
      </div>`;
    return;
  }

  el.innerHTML = _automacoes.map(a => renderCard(a)).join('');
}

function renderCard(a) {
  const tc   = JSON.parse(a.trigger_config || '{}');
  const ac   = JSON.parse(a.acao_config    || '{}');
  const funil = _funis.find(f => f.id === tc.funil_id);
  const funilNome = funil?.nome || a.funil_nome || 'Todos os funis';
  const delay = Number(ac.delay_segundos) || 0;
  const delayStr = delay === 0 ? 'Imediato'
    : delay < 60 ? `${delay}s`
    : delay < 3600 ? `${delay/60} min`
    : `${delay/3600}h`;

  const preview = (ac.mensagem_texto || '').slice(0, 120);
  const isSA = _usuario.role === 'SUPER_ADMIN';

  return `
  <div class="auto-card ${a.ativo ? '' : 'inactive'}" id="auto-card-${a.id}">
    <div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">
      <!-- Status indicator -->
      <div style="width:42px;height:42px;border-radius:12px;background:${a.ativo
        ? 'linear-gradient(135deg,#1a6b10,#6CFF4E)'
        : 'var(--surface-2)'};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${a.ativo ? '#0D0D0D' : 'var(--text-muted)'}" stroke-width="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
      </div>

      <!-- Info -->
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
          <span style="font-size:.95rem;font-weight:800">${escHtml(a.nome)}</span>
          <span style="padding:2px 10px;border-radius:20px;font-size:.66rem;font-weight:700;
            background:${a.ativo ? 'rgba(108,255,78,.12)' : 'rgba(255,255,255,.05)'};
            color:${a.ativo ? 'var(--green)' : 'var(--text-muted)'}">
            ${a.ativo ? '● Ativa' : '○ Inativa'}
          </span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <span style="font-size:.75rem;color:var(--text-muted);display:flex;align-items:center;gap:4px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
            ${escHtml(funilNome)}
          </span>
          <span class="delay-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${delayStr}
          </span>
        </div>
        <div style="font-size:.78rem;color:var(--text-muted);white-space:pre-wrap;max-height:60px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;background:var(--surface-2);border-radius:8px;padding:8px 12px;font-style:italic">
          "${escHtml(preview)}${preview.length < ac.mensagem_texto?.length ? '...' : ''}"
        </div>
        ${a.criado_por_nome ? `<div style="font-size:.68rem;color:var(--text-muted);margin-top:8px">Criado por ${escHtml(a.criado_por_nome)}</div>` : ''}
      </div>

      <!-- Ações -->
      <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0;align-items:flex-end">
        ${isSA ? `
        <div class="toggle-wrap">
          <label class="toggle">
            <input type="checkbox" ${a.ativo ? 'checked' : ''} onchange="toggleAtivo('${a.id}', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <button class="btn btn-secondary btn-sm" onclick="abrirModal('${a.id}')">Editar</button>
        <button class="btn btn-sm" style="background:rgba(225,0,152,.1);color:var(--pink);border:1px solid rgba(225,0,152,.2)"
          onclick="confirmarDeletar('${a.id}')">Excluir</button>
        ` : `
        <button class="btn btn-secondary btn-sm" onclick="abrirModal('${a.id}', true)">Ver</button>
        `}
      </div>
    </div>
  </div>`;
}

// ── Abrir Modal ─────────────────────────────────────────────────────────────
async function abrirModal(id = null, readOnly = false) {
  _editId = id;
  const modal = document.getElementById('modal-ov');
  document.getElementById('modal-alert').style.display = 'none';
  document.getElementById('modal-titulo').textContent = id ? (readOnly ? 'Visualizar Automação' : 'Editar Automação') : 'Nova Automação';

  // Reset form
  document.getElementById('f-id').value    = '';
  document.getElementById('f-nome').value  = '';
  document.getElementById('f-funil').value = '';
  document.getElementById('f-delay').value = '0';
  document.getElementById('txt-msg').value = id ? '' : MSG_PADRAO;
  document.getElementById('f-ativo').checked = true;

  if (id) {
    const auto = _automacoes.find(a => a.id === id);
    if (auto) {
      const tc = JSON.parse(auto.trigger_config || '{}');
      const ac = JSON.parse(auto.acao_config    || '{}');
      document.getElementById('f-id').value    = auto.id;
      document.getElementById('f-nome').value  = auto.nome;
      document.getElementById('f-funil').value = tc.funil_id || '';
      document.getElementById('f-delay').value = String(ac.delay_segundos || 0);
      document.getElementById('txt-msg').value = ac.mensagem_texto || '';
      document.getElementById('f-ativo').checked = !!auto.ativo;
    }
  }

  // ReadOnly
  ['f-nome','f-funil','f-delay','txt-msg','f-ativo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = readOnly;
  });
  document.getElementById('modal-salvar').style.display = readOnly ? 'none' : '';

  atualizarPreview();
  modal.classList.add('open');
  setTimeout(() => document.getElementById('f-nome').focus(), 50);
}

function fecharModal() {
  document.getElementById('modal-ov').classList.remove('open');
  _editId = null;
}

// ── Salvar ──────────────────────────────────────────────────────────────────
async function salvar() {
  const alertEl = document.getElementById('modal-alert');
  alertEl.style.display = 'none';

  const nome     = document.getElementById('f-nome').value.trim();
  const funilId  = document.getElementById('f-funil').value;
  const delay    = Number(document.getElementById('f-delay').value) || 0;
  const msg      = document.getElementById('txt-msg').value.trim();
  const ativo    = document.getElementById('f-ativo').checked ? 1 : 0;
  const id       = document.getElementById('f-id').value;

  if (!nome) { alertEl.className='alert alert-error'; alertEl.textContent='Nome é obrigatório.'; alertEl.style.display=''; return; }
  if (!msg)  { alertEl.className='alert alert-error'; alertEl.textContent='Texto da mensagem é obrigatório.'; alertEl.style.display=''; return; }

  const payload = {
    nome, funil_id: funilId || null,
    delay_segundos: delay,
    mensagem_texto: msg, ativo
  };

  const btn = document.getElementById('modal-salvar');
  btn.disabled = true;

  let r;
  if (id) {
    r = await Auth.api('PATCH', `/automacoes/mensagens/${id}`, payload);
  } else {
    r = await Auth.api('POST', '/automacoes/mensagens', payload);
  }

  btn.disabled = false;

  if (r?.ok) {
    Toast.show(id ? 'Automação atualizada!' : 'Automação criada!', 'success');
    fecharModal();
    await carregarAutomacoes();
  } else {
    alertEl.className = 'alert alert-error';
    alertEl.textContent = r?.data?.erro || 'Erro ao salvar.';
    alertEl.style.display = '';
  }
}

// ── Toggle ativo ────────────────────────────────────────────────────────────
async function toggleAtivo(id, novoEstado) {
  const r = await Auth.api('PATCH', `/automacoes/mensagens/${id}`, { ativo: novoEstado ? 1 : 0 });
  if (r?.ok) {
    Toast.show(novoEstado ? 'Automação ativada!' : 'Automação desativada.', 'success');
    await carregarAutomacoes();
  } else {
    Toast.show('Erro ao atualizar status.', 'error');
    await carregarAutomacoes(); // reverte UI
  }
}

// ── Deletar ─────────────────────────────────────────────────────────────────
function confirmarDeletar(id) {
  _delId = id;
  document.getElementById('modal-del-ov').classList.add('open');
}
function fecharModalDel() {
  document.getElementById('modal-del-ov').classList.remove('open');
  _delId = null;
}
async function executarDeletar() {
  if (!_delId) return;
  const r = await Auth.api('DELETE', `/automacoes/mensagens/${_delId}`);
  if (r?.ok) {
    Toast.show('Automação excluída.', 'success');
    fecharModalDel();
    await carregarAutomacoes();
  } else {
    Toast.show(r?.data?.erro || 'Erro ao excluir.', 'error');
  }
}

// ── Preview em tempo real ───────────────────────────────────────────────────
function atualizarPreview() {
  const txt = document.getElementById('txt-msg').value;
  const previewEl = document.getElementById('preview-msg');
  if (!txt.trim()) {
    previewEl.innerHTML = '<em style="opacity:.4">A mensagem aparecerá aqui...</em>';
    return;
  }
  // Substitui com exemplos
  const preview = txt
    .replace(/\[nome_lead\]/gi,     'João Silva')
    .replace(/\[nome_vendedor\]/gi, _usuario?.nome || 'Carlos')
    .replace(/\[nome_empresa\]/gi,  'Empresa Exemplo')
    .replace(/\[telefone_lead\]/gi, '11999999999')
    .replace(/\[funil\]/gi,         'Tráfego Pago')
    .replace(/\[empresa\]/gi,       'Empresa Exemplo');
  previewEl.textContent = preview;
}

// ── Variáveis chips ─────────────────────────────────────────────────────────
function inserirVariavel(variavel) {
  const ta = document.getElementById('txt-msg');
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const texto = ta.value;
  ta.value = texto.slice(0, start) + variavel + texto.slice(end);
  ta.setSelectionRange(start + variavel.length, start + variavel.length);
  ta.focus();
  atualizarPreview();
}

// ── Bind events ─────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btn-nova').addEventListener('click', () => abrirModal());
  document.getElementById('modal-close').addEventListener('click', fecharModal);
  document.getElementById('modal-cancelar').addEventListener('click', fecharModal);
  document.getElementById('modal-salvar').addEventListener('click', salvar);
  document.getElementById('modal-ov').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-ov')) fecharModal();
  });

  document.getElementById('del-cancelar').addEventListener('click', fecharModalDel);
  document.getElementById('del-confirmar').addEventListener('click', executarDeletar);
  document.getElementById('modal-del-ov').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-del-ov')) fecharModalDel();
  });

  // Preview em tempo real
  document.getElementById('txt-msg').addEventListener('input', atualizarPreview);

  // Chips de variáveis
  document.querySelectorAll('.var-chip').forEach(chip => {
    chip.addEventListener('click', () => inserirVariavel(chip.dataset.var));
  });

  // Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      fecharModal();
      fecharModalDel();
    }
  });
}

// ── Utilidades ───────────────────────────────────────────────────────────────
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
