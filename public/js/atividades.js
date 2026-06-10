/**
 * PROSPEKT CRM — Módulo de Atividades do Lead
 * Gerencia CRUD de atividades na aba "Informações" do modal
 * e sistema de lembretes no footer do CRM.
 */

const TIPOS_ATIVIDADE = ['Ligar','Mandar mensagem','Visitar','Enviar amostra','Outra'];
const STATUS_ATIVIDADE = {
  pendente:  { label:'Pendente',  cor:'#F59E0B' },
  concluida: { label:'Concluída', cor:'#6CFF4E' },
  adiada:    { label:'Adiada',    cor:'#7dbfff' },
  atrasada:  { label:'Atrasada',  cor:'#E10098' },
};

let _atividadesLeadAtual = [];
let _leadIdAtividades    = null;
let _lembretesTimer      = null;
let _notificacoesAtivas  = {}; // id → notificação já exibida

// ─────────────────────────────────────────────────────────────────────────────
// RENDER DA ABA INFORMAÇÕES — Atividades
// ─────────────────────────────────────────────────────────────────────────────

function renderAtividadesTab(leadId) {
  _leadIdAtividades = leadId;
  const container = document.getElementById('atividades-container');
  if (!container) return;
  container.innerHTML = `
    <div class="info-section" style="margin-bottom:10px">
      <div class="info-section-title">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Atividades
        <button id="btn-nova-atividade" class="btn btn-secondary btn-sm" style="font-size:.68rem;padding:2px 8px;margin-left:auto">+ Nova</button>
      </div>

      <!-- Formulário nova atividade (oculto) -->
      <div id="form-atividade" style="display:none;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px">
        <div class="fg-compact">
          <div class="fr-compact">
            <div class="input-group-sm">
              <label class="lbl-sm">Tipo *</label>
              <select id="at-tipo" class="input input-sm">
                ${TIPOS_ATIVIDADE.map(t=>`<option value="${t}">${t}</option>`).join('')}
              </select>
            </div>
            <div class="input-group-sm">
              <label class="lbl-sm">Status</label>
              <select id="at-status" class="input input-sm">
                ${Object.entries(STATUS_ATIVIDADE).map(([v,s])=>`<option value="${v}">${s.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="fr-compact">
            <div class="input-group-sm">
              <label class="lbl-sm">Data limite</label>
              <input type="date" id="at-data" class="input input-sm date-input">
            </div>
            <div class="input-group-sm">
              <label class="lbl-sm">Hora limite</label>
              <input type="time" id="at-hora" class="input input-sm">
            </div>
          </div>
          <div class="input-group-sm">
            <label class="lbl-sm">Observação</label>
            <textarea id="at-obs" class="input input-sm" rows="2" placeholder="Detalhes da atividade..."></textarea>
          </div>
        </div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button id="btn-salvar-atividade" class="btn btn-primary btn-sm" style="font-size:.72rem">Salvar</button>
          <button id="btn-cancelar-atividade" class="btn btn-secondary btn-sm" style="font-size:.72rem">Cancelar</button>
        </div>
      </div>

      <!-- Lista de atividades -->
      <div id="lista-atividades" style="display:flex;flex-direction:column;gap:6px"></div>
    </div>
  `;

  document.getElementById('btn-nova-atividade').addEventListener('click', () => {
    document.getElementById('form-atividade').style.display = '';
    document.getElementById('at-tipo').value    = 'Ligar';
    document.getElementById('at-status').value  = 'pendente';
    document.getElementById('at-data').value    = '';
    document.getElementById('at-hora').value    = '';
    document.getElementById('at-obs').value     = '';
  });
  document.getElementById('btn-cancelar-atividade').addEventListener('click', () => {
    document.getElementById('form-atividade').style.display = 'none';
  });
  document.getElementById('btn-salvar-atividade').addEventListener('click', () => salvarAtividade(leadId));

  if (leadId) carregarAtividades(leadId);
}

async function carregarAtividades(leadId) {
  const r = await Auth.api('GET', `/leads/${leadId}/atividades`);
  _atividadesLeadAtual = r?.data?.dados || [];
  _renderListaAtividades();
}

function _renderListaAtividades() {
  const lista = document.getElementById('lista-atividades');
  if (!lista) return;
  if (!_atividadesLeadAtual.length) {
    lista.innerHTML = '<p style="font-size:.72rem;color:var(--text-muted)">Nenhuma atividade registrada.</p>';
    return;
  }
  lista.innerHTML = _atividadesLeadAtual.map(at => {
    const st   = STATUS_ATIVIDADE[at.status] || STATUS_ATIVIDADE.pendente;
    const data = at.data_limite
      ? new Date(at.data_limite + 'T' + (at.hora_limite || '00:00')).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '—';
    return `<div class="atividade-item" data-id="${at.id}">
      <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">
        <span style="width:7px;height:7px;border-radius:50%;background:${st.cor};flex-shrink:0"></span>
        <span style="font-size:.78rem;font-weight:600">${at.tipo}</span>
        <span style="font-size:.65rem;color:var(--text-muted);margin-left:4px">${st.label}</span>
        <span style="font-size:.65rem;color:var(--text-muted);margin-left:auto;white-space:nowrap">${data}</span>
      </div>
      ${at.observacao ? `<div style="font-size:.72rem;color:var(--text-secondary);margin-top:2px;padding-left:13px">${at.observacao}</div>` : ''}
      <div style="display:flex;gap:5px;margin-top:5px;padding-left:13px">
        ${at.status !== 'concluida' ? `<button class="btn-at-concluir btn btn-secondary btn-sm" data-id="${at.id}" style="font-size:.65rem;padding:1px 7px;color:var(--green)">✓ Concluir</button>` : ''}
        ${at.status === 'pendente' ? `<button class="btn-at-adiar btn btn-secondary btn-sm" data-id="${at.id}" style="font-size:.65rem;padding:1px 7px">↻ Adiar</button>` : ''}
        <button class="btn-at-excluir btn btn-secondary btn-sm" data-id="${at.id}" style="font-size:.65rem;padding:1px 7px;color:var(--pink)">✕</button>
      </div>
    </div>`;
  }).join('');

  // Eventos
  lista.querySelectorAll('.btn-at-concluir').forEach(btn =>
    btn.addEventListener('click', () => atualizarAtividade(btn.dataset.id, { status: 'concluida' })));
  lista.querySelectorAll('.btn-at-adiar').forEach(btn =>
    btn.addEventListener('click', () => _adiarAtividade(btn.dataset.id)));
  lista.querySelectorAll('.btn-at-excluir').forEach(btn =>
    btn.addEventListener('click', () => excluirAtividade(btn.dataset.id)));
}

async function salvarAtividade(leadId) {
  const tipo    = document.getElementById('at-tipo').value;
  const status  = document.getElementById('at-status').value;
  const data    = document.getElementById('at-data').value;
  const hora    = document.getElementById('at-hora').value;
  const obs     = document.getElementById('at-obs').value.trim();
  if (!tipo) { Toast.show('Selecione o tipo de atividade.','error'); return; }
  const r = await Auth.api('POST', `/leads/${leadId}/atividades`, {
    tipo, status, observacao: obs || null,
    data_limite: data || null, hora_limite: hora || null,
  });
  if (r?.ok) {
    document.getElementById('form-atividade').style.display = 'none';
    await carregarAtividades(leadId);
    Toast.show('Atividade criada!','success');
  } else {
    Toast.show(r?.data?.erro || 'Erro ao criar atividade.','error');
  }
}

async function atualizarAtividade(id, dados) {
  const r = await Auth.api('PATCH', `/atividades/${id}`, dados);
  if (r?.ok) {
    _atividadesLeadAtual = _atividadesLeadAtual.map(a => a.id === id ? { ...a, ...dados } : a);
    _renderListaAtividades();
    // Remove notificação se concluída
    if (dados.status === 'concluida') _removerNotificacao(id);
    Toast.show('Atividade atualizada!','success');
  } else {
    Toast.show(r?.data?.erro || 'Erro.','error');
  }
}

async function excluirAtividade(id) {
  if (!confirm('Excluir esta atividade?')) return;
  const r = await Auth.api('DELETE', `/atividades/${id}`);
  if (r?.ok) {
    _atividadesLeadAtual = _atividadesLeadAtual.filter(a => a.id !== id);
    _renderListaAtividades();
    _removerNotificacao(id);
    Toast.show('Atividade excluída.','success');
  }
}

async function _adiarAtividade(id) {
  // Adia 1 dia por padrão
  const at = _atividadesLeadAtual.find(a => a.id === id);
  if (!at) return;
  const novaData = at.data_limite
    ? new Date(new Date(at.data_limite).getTime() + 86400000).toISOString().slice(0,10)
    : new Date(Date.now() + 86400000).toISOString().slice(0,10);
  await atualizarAtividade(id, { status: 'adiada', data_limite: novaData });
  Toast.show('Atividade adiada para amanhã.','success');
}

// ─────────────────────────────────────────────────────────────────────────────
// SISTEMA DE LEMBRETES (footer)
// ─────────────────────────────────────────────────────────────────────────────

function iniciarLembretes() {
  _verificarAtividadesPendentes();
  // Verifica a cada 60 segundos
  if (_lembretesTimer) clearInterval(_lembretesTimer);
  _lembretesTimer = setInterval(_verificarAtividadesPendentes, 60000);
}

async function _verificarAtividadesPendentes() {
  const r = await Auth.api('GET', '/atividades/pendentes');
  const lista = r?.data?.dados || [];
  const agora = Date.now();

  lista.forEach(at => {
    if (!at.data_limite) return;
    const dtAt = new Date(at.data_limite + 'T' + (at.hora_limite || '23:59')).getTime();
    const diff  = dtAt - agora; // ms até o prazo

    // Lembrar se estiver: 5 min antes, no horário, ou 10 min após
    const deveNotificar =
      (diff >= 0 && diff <= 5 * 60 * 1000) ||  // próximos 5 minutos
      (diff < 0 && diff >= -10 * 60 * 1000);    // até 10 min depois do prazo

    if (deveNotificar && !_notificacoesAtivas[at.id]) {
      _exibirNotificacao(at);
    }
  });
}

function _exibirNotificacao(at) {
  _notificacoesAtivas[at.id] = true;
  let footer = document.getElementById('notif-footer');
  if (!footer) {
    footer = document.createElement('div');
    footer.id = 'notif-footer';
    footer.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;padding:8px 16px;gap:6px;pointer-events:none';
    document.body.appendChild(footer);
  }

  const card = document.createElement('div');
  card.id = `notif-${at.id}`;
  card.style.cssText = 'pointer-events:all;background:var(--surface,#1a1a1a);border:1px solid var(--border,#333);border-left:3px solid #F59E0B;border-radius:10px;padding:10px 14px;min-width:280px;max-width:340px;box-shadow:0 4px 20px rgba(0,0,0,.5);animation:slideInUp .25s ease';
  card.innerHTML = `
    <div style="font-size:.72rem;font-weight:700;color:#F59E0B;letter-spacing:.04em;text-transform:uppercase;margin-bottom:3px">⏰ Atividade</div>
    <div style="font-size:.82rem;font-weight:600;color:#fff;margin-bottom:2px">${at.lead_nome || ''}</div>
    <div style="font-size:.75rem;color:#ccc">${at.tipo}${at.observacao ? ' — ' + at.observacao.slice(0,60) : ''}</div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button onclick="window._concluirNotif('${at.id}')" style="flex:1;background:#6CFF4E;color:#000;border:none;border-radius:6px;padding:4px 8px;font-size:.72rem;font-weight:700;cursor:pointer">✓ Concluir</button>
      <button onclick="window._adiarNotif('${at.id}')" style="flex:1;background:var(--surface-2,#222);color:#ccc;border:1px solid var(--border,#333);border-radius:6px;padding:4px 8px;font-size:.72rem;cursor:pointer">↻ Adiar</button>
      <button onclick="window._fecharNotif('${at.id}')" style="background:none;border:none;color:#888;cursor:pointer;padding:2px 4px;font-size:1rem" title="Fechar">✕</button>
    </div>
  `;
  footer.appendChild(card);

  // Auto-remove após 2 minutos se não interagir
  setTimeout(() => _fecharNotif(at.id), 120000);
}

window._concluirNotif = async (id) => {
  await Auth.api('PATCH', `/atividades/${id}`, { status: 'concluida' });
  _fecharNotif(id);
  Toast.show('Atividade marcada como concluída!','success');
};

window._adiarNotif = async (id) => {
  const novaData = new Date(Date.now() + 86400000).toISOString().slice(0,10);
  await Auth.api('PATCH', `/atividades/${id}`, { status: 'adiada', data_limite: novaData });
  _fecharNotif(id);
  Toast.show('Atividade adiada.','success');
};

window._fecharNotif = (id) => {
  const el = document.getElementById(`notif-${id}`);
  if (el) el.remove();
  delete _notificacoesAtivas[id];
};

function _removerNotificacao(id) {
  const el = document.getElementById(`notif-${id}`);
  if (el) el.remove();
  delete _notificacoesAtivas[id];
}

// CSS para animação
if (!document.getElementById('notif-css')) {
  const st = document.createElement('style');
  st.id = 'notif-css';
  st.textContent = `
    @keyframes slideInUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:none; } }
    .atividade-item { background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:8px 10px; }
    .atividade-item:hover { border-color:var(--border-hover); }
  `;
  document.head.appendChild(st);
}

// Exporta funções globais necessárias
window.Atividades = {
  renderTab: renderAtividadesTab,
  carregar: carregarAtividades,
  iniciarLembretes,
};
