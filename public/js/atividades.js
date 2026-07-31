/**
 * PROSPEKT CRM — Módulo de Atividades do Lead v2
 * v2: + responsavel_id, + status em_andamento, Kanban vertical por status,
 *     cálculo automático de atrasada, lembretes no footer.
 */

const TIPOS_ATIVIDADE = ['Ligar','Mandar mensagem','Visitar','Enviar amostra','Reunião','Outra'];

const STATUS_ATIVIDADE = {
  atrasada:    { label:'Atrasada',     cor:'#E10098', icon:'🔴', ordem:0 },
  pendente:    { label:'Pendente',     cor:'#F59E0B', icon:'⏳', ordem:1 },
  em_andamento:{ label:'Em Andamento', cor:'#7dbfff', icon:'▶',  ordem:2 },
  adiada:      { label:'Adiada',       cor:'#888',    icon:'↻',  ordem:3 },
  concluida:   { label:'Concluída',    cor:'#6CFF4E', icon:'✓',  ordem:4 },
};

let _atividadesLeadAtual = [];
let _leadIdAtividades    = null;
let _lembretesTimer      = null;
let _notificacoesAtivas  = {};
let _usuariosCache       = [];  // lista de usuários para o select de responsável

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────────────────────────────────────

/** Calcula o status visual de uma atividade (considera prazo vencido) */
function statusVisual(at) {
  if (at.status === 'concluida') return 'concluida';
  if (!at.data_limite) return at.status || 'pendente';
  const prazo = new Date(at.data_limite + 'T' + (at.hora_limite || '23:59:59'));
  if (prazo < new Date() && at.status !== 'concluida') return 'atrasada';
  return at.status || 'pendente';
}

/** Formata prazo como string legível */
function fmtPrazo(at) {
  if (!at.data_limite) return '—';
  const d = new Date(at.data_limite + 'T' + (at.hora_limite || '00:00'));
  return d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
}

/** Carrega usuários para o select de responsável (cache) */
async function _carregarUsuarios() {
  if (_usuariosCache.length) return _usuariosCache;
  try {
    const r = await Auth.api('GET', '/usuarios/responsaveis');
    _usuariosCache = (r?.data?.dados || []).filter(u =>
      (u.role === 'VENDEDOR' || u.role === 'SDR' || u.role === 'GESTOR' || u.role === 'SUPER_ADMIN')
      && (u.ativo === true || u.ativo === 1 || u.ativo === '1')
    );
  } catch(_) {}
  return _usuariosCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER DA ABA INFORMAÇÕES — Atividades
// ─────────────────────────────────────────────────────────────────────────────

async function renderAtividadesTab(leadId) {
  _leadIdAtividades = leadId;
  const container = document.getElementById('atividades-container');
  if (!container) return;

  // Carrega usuários em paralelo com atividades
  await _carregarUsuarios();

  const usuariosOpts = _usuariosCache.map(u =>
    `<option value="${u.id}">${u.nome}</option>`
  ).join('');

  const usuarioAtual = window._usuario || {};

  container.innerHTML = `
    <div class="at-section">
      <div class="at-header">
        <div class="at-header-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Atividades
        </div>
        <button id="btn-nova-atividade" class="btn btn-primary btn-sm at-btn-nova">+ Nova Atividade</button>
      </div>

      <!-- Formulário nova atividade -->
      <div id="form-atividade" style="display:none" class="at-form">
        <div class="at-form-grid">
          <div class="at-form-row">
            <div class="input-group-sm">
              <label class="lbl-sm">Tipo *</label>
              <select id="at-tipo" class="input input-sm">
                ${TIPOS_ATIVIDADE.map(t=>`<option value="${t}">${t}</option>`).join('')}
              </select>
            </div>
            <div class="input-group-sm">
              <label class="lbl-sm">Status</label>
              <select id="at-status" class="input input-sm">
                <option value="pendente">⏳ Pendente</option>
                <option value="em_andamento">▶ Em Andamento</option>
                <option value="adiada">↻ Adiada</option>
                <option value="concluida">✓ Concluída</option>
              </select>
            </div>
          </div>
          <div class="at-form-row">
            <div class="input-group-sm">
              <label class="lbl-sm">Responsável</label>
              <select id="at-responsavel" class="input input-sm">
                <option value="">— Responsável —</option>
                ${usuariosOpts}
              </select>
            </div>
          </div>
          <div class="at-form-row">
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
        <div class="at-form-btns">
          <button id="btn-salvar-atividade" class="btn btn-primary btn-sm">💾 Salvar</button>
          <button id="btn-cancelar-atividade" class="btn btn-secondary btn-sm">Cancelar</button>
        </div>
      </div>

      <!-- Kanban vertical por status -->
      <div id="kanban-atividades"></div>
    </div>
  `;

  // Pré-seleciona usuário logado como responsável
  const selResp = document.getElementById('at-responsavel');
  if (selResp && usuarioAtual.id) selResp.value = usuarioAtual.id;

  document.getElementById('btn-nova-atividade').addEventListener('click', () => {
    const form = document.getElementById('form-atividade');
    const aberto = form.style.display !== 'none';
    form.style.display = aberto ? 'none' : '';
    if (!aberto) {
      // Limpa o form ao abrir
      document.getElementById('at-tipo').value   = 'Ligar';
      document.getElementById('at-status').value = 'pendente';
      document.getElementById('at-data').value   = '';
      document.getElementById('at-hora').value   = '';
      document.getElementById('at-obs').value    = '';
      if (selResp && usuarioAtual.id) selResp.value = usuarioAtual.id;
    }
  });

  document.getElementById('btn-cancelar-atividade').addEventListener('click', () => {
    document.getElementById('form-atividade').style.display = 'none';
  });

  document.getElementById('btn-salvar-atividade').addEventListener('click', () => salvarAtividade(leadId));

  if (leadId) await carregarAtividades(leadId);
}

async function carregarAtividades(leadId) {
  const r = await Auth.api('GET', `/leads/${leadId}/atividades`);
  _atividadesLeadAtual = r?.data?.dados || [];
  _renderKanbanAtividades();
}

// ─────────────────────────────────────────────────────────────────────────────
// KANBAN VERTICAL POR STATUS
// ─────────────────────────────────────────────────────────────────────────────

function _renderKanbanAtividades() {
  const wrap = document.getElementById('kanban-atividades');
  if (!wrap) return;

  if (!_atividadesLeadAtual.length) {
    wrap.innerHTML = `<p class="at-empty">Nenhuma atividade registrada. Clique em "+ Nova Atividade" para começar.</p>`;
    return;
  }

  // Agrupa por status visual (recalcula atrasadas)
  const grupos = {
    atrasada:    [],
    pendente:    [],
    em_andamento:[],
    adiada:      [],
    concluida:   [],
  };

  _atividadesLeadAtual.forEach(at => {
    const sv = statusVisual(at);
    if (grupos[sv]) grupos[sv].push(at);
    else grupos['pendente'].push(at);
  });

  // Renderiza apenas grupos com itens (ordem: atrasada → pendente → em_andamento → adiada → concluida)
  const ordemGrupos = ['atrasada','pendente','em_andamento','adiada','concluida'];

  let html = '';
  ordemGrupos.forEach(key => {
    const lista = grupos[key];
    const stCfg = STATUS_ATIVIDADE[key];
    if (!lista.length) return;

    html += `
      <div class="at-grupo">
        <div class="at-grupo-header" style="border-left:3px solid ${stCfg.cor}">
          <span class="at-grupo-icon">${stCfg.icon}</span>
          <span class="at-grupo-label" style="color:${stCfg.cor}">${stCfg.label}</span>
          <span class="at-grupo-count">${lista.length}</span>
        </div>
        <div class="at-grupo-lista">
          ${lista.map(at => _renderAtividadeCard(at, key)).join('')}
        </div>
      </div>`;
  });

  wrap.innerHTML = html;

  // Eventos
  wrap.querySelectorAll('.btn-at-concluir').forEach(btn =>
    btn.addEventListener('click', () => atualizarAtividade(btn.dataset.id, { status: 'concluida' })));
  wrap.querySelectorAll('.btn-at-iniciar').forEach(btn =>
    btn.addEventListener('click', () => atualizarAtividade(btn.dataset.id, { status: 'em_andamento' })));
  wrap.querySelectorAll('.btn-at-adiar').forEach(btn =>
    btn.addEventListener('click', () => _adiarAtividade(btn.dataset.id)));
  wrap.querySelectorAll('.btn-at-excluir').forEach(btn =>
    btn.addEventListener('click', () => excluirAtividade(btn.dataset.id)));
  wrap.querySelectorAll('.btn-at-reabrir').forEach(btn =>
    btn.addEventListener('click', () => atualizarAtividade(btn.dataset.id, { status: 'pendente' })));
}

function _renderAtividadeCard(at, statusVis) {
  const stCfg   = STATUS_ATIVIDADE[statusVis] || STATUS_ATIVIDADE.pendente;
  const prazo   = fmtPrazo(at);
  const resp    = at.responsavel_nome || at.usuario_nome || '—';
  const criador = at.usuario_nome || '—';
  const isConcluida = at.status === 'concluida';

  // Botões de ação conforme status
  let btns = '';
  if (!isConcluida) {
    btns += `<button class="btn-at-concluir btn btn-secondary btn-sm at-btn" data-id="${at.id}" style="color:var(--green)">✓ Concluir</button>`;
  }
  if (statusVis !== 'em_andamento' && !isConcluida) {
    btns += `<button class="btn-at-iniciar btn btn-secondary btn-sm at-btn" data-id="${at.id}" style="color:#7dbfff">▶ Iniciar</button>`;
  }
  if (statusVis === 'pendente' || statusVis === 'em_andamento') {
    btns += `<button class="btn-at-adiar btn btn-secondary btn-sm at-btn" data-id="${at.id}">↻ Adiar</button>`;
  }
  if (isConcluida) {
    btns += `<button class="btn-at-reabrir btn btn-secondary btn-sm at-btn" data-id="${at.id}">↩ Reabrir</button>`;
  }
  btns += `<button class="btn-at-excluir btn btn-secondary btn-sm at-btn" data-id="${at.id}" style="color:var(--pink)">✕</button>`;

  return `
    <div class="at-card" data-id="${at.id}">
      <div class="at-card-header">
        <span class="at-card-dot" style="background:${stCfg.cor}"></span>
        <span class="at-card-tipo">${at.tipo}</span>
        <span class="at-card-prazo">${prazo}</span>
      </div>
      ${at.observacao ? `<div class="at-card-obs">${at.observacao}</div>` : ''}
      <div class="at-card-meta">
        <span class="at-card-resp" title="Responsável">👤 ${resp}</span>
        ${criador !== resp ? `<span class="at-card-criador" title="Criado por">✏️ ${criador}</span>` : ''}
      </div>
      <div class="at-card-btns">${btns}</div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

async function salvarAtividade(leadId) {
  const tipo        = document.getElementById('at-tipo').value;
  const status      = document.getElementById('at-status').value;
  const data        = document.getElementById('at-data').value;
  const hora        = document.getElementById('at-hora').value;
  const obs         = document.getElementById('at-obs').value.trim();
  const responsavel = document.getElementById('at-responsavel')?.value || '';

  if (!tipo) { window.Toast?.show('Selecione o tipo de atividade.','error'); return; }

  const btn = document.getElementById('btn-salvar-atividade');
  if (btn) btn.disabled = true;

  const r = await Auth.api('POST', `/leads/${leadId}/atividades`, {
    tipo, status,
    observacao:     obs         || null,
    data_limite:    data        || null,
    hora_limite:    hora        || null,
    responsavel_id: responsavel || null,
  });

  if (btn) btn.disabled = false;

  if (r?.ok) {
    document.getElementById('form-atividade').style.display = 'none';
    await carregarAtividades(leadId);
    window.Toast?.show('Atividade criada!','success');
  } else {
    window.Toast?.show(r?.data?.erro || 'Erro ao criar atividade.','error');
  }
}

async function atualizarAtividade(id, dados) {
  const r = await Auth.api('PATCH', `/atividades/${id}`, dados);
  if (r?.ok) {
    // Atualiza lista local com dados retornados do servidor (status real)
    const atualizado = r.data?.dados || { ...dados };
    _atividadesLeadAtual = _atividadesLeadAtual.map(a =>
      a.id === id ? { ...a, ...atualizado } : a
    );
    _renderKanbanAtividades();
    if (dados.status === 'concluida') _removerNotificacao(id);
    window.Toast?.show('Atividade atualizada!','success');
  } else {
    window.Toast?.show(r?.data?.erro || 'Erro ao atualizar.','error');
  }
}

async function excluirAtividade(id) {
  if (!confirm('Excluir esta atividade?')) return;
  const r = await Auth.api('DELETE', `/atividades/${id}`);
  if (r?.ok) {
    _atividadesLeadAtual = _atividadesLeadAtual.filter(a => a.id !== id);
    _renderKanbanAtividades();
    _removerNotificacao(id);
    window.Toast?.show('Atividade excluída.','success');
  } else {
    window.Toast?.show(r?.data?.erro || 'Erro ao excluir.','error');
  }
}

async function _adiarAtividade(id) {
  const at = _atividadesLeadAtual.find(a => a.id === id);
  if (!at) return;
  const novaData = at.data_limite
    ? new Date(new Date(at.data_limite).getTime() + 86400000).toISOString().slice(0,10)
    : new Date(Date.now() + 86400000).toISOString().slice(0,10);
  await atualizarAtividade(id, { status: 'adiada', data_limite: novaData });
  window.Toast?.show('Atividade adiada para amanhã.','success');
}

// ─────────────────────────────────────────────────────────────────────────────
// SISTEMA DE LEMBRETES (footer)
// ─────────────────────────────────────────────────────────────────────────────

function iniciarLembretes() {
  _verificarAtividadesPendentes();
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
    const diff  = dtAt - agora;
    const deveNotificar =
      (diff >= 0 && diff <= 5 * 60 * 1000) ||
      (diff <  0 && diff >= -10 * 60 * 1000);
    if (deveNotificar && !_notificacoesAtivas[at.id]) _exibirNotificacao(at);
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

  const stCfg = STATUS_ATIVIDADE[statusVisual(at)] || STATUS_ATIVIDADE.pendente;
  const card = document.createElement('div');
  card.id = `notif-${at.id}`;
  card.style.cssText = 'pointer-events:all;background:var(--surface,#1a1a1a);border:1px solid var(--border,#333);border-left:3px solid ' + stCfg.cor + ';border-radius:10px;padding:10px 14px;min-width:280px;max-width:340px;box-shadow:0 4px 20px rgba(0,0,0,.5);animation:slideInUp .25s ease';
  card.innerHTML = `
    <div style="font-size:.72rem;font-weight:700;color:${stCfg.cor};letter-spacing:.04em;text-transform:uppercase;margin-bottom:3px">⏰ Atividade</div>
    <div style="font-size:.82rem;font-weight:600;color:#fff;margin-bottom:2px">${at.lead_nome || ''}</div>
    <div style="font-size:.75rem;color:#ccc">${at.tipo}${at.observacao ? ' — ' + at.observacao.slice(0,60) : ''}</div>
    <div style="font-size:.68rem;color:#999;margin-top:2px">👤 ${at.responsavel_nome || at.usuario_nome || ''}</div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button onclick="window._concluirNotif('${at.id}')" style="flex:1;background:#6CFF4E;color:#000;border:none;border-radius:6px;padding:4px 8px;font-size:.72rem;font-weight:700;cursor:pointer">✓ Concluir</button>
      <button onclick="window._adiarNotif('${at.id}')" style="flex:1;background:var(--surface-2,#222);color:#ccc;border:1px solid var(--border,#333);border-radius:6px;padding:4px 8px;font-size:.72rem;cursor:pointer">↻ Adiar</button>
      <button onclick="window._fecharNotif('${at.id}')" style="background:none;border:none;color:#888;cursor:pointer;padding:2px 4px;font-size:1rem" title="Fechar">✕</button>
    </div>
  `;
  footer.appendChild(card);
  setTimeout(() => _fecharNotif(at.id), 120000);
}

window._concluirNotif = async (id) => {
  await Auth.api('PATCH', `/atividades/${id}`, { status: 'concluida' });
  _fecharNotif(id);
  // Atualiza lista local se lead estiver aberto
  _atividadesLeadAtual = _atividadesLeadAtual.map(a =>
    a.id === id ? { ...a, status: 'concluida' } : a
  );
  if (document.getElementById('kanban-atividades')) _renderKanbanAtividades();
  window.Toast?.show('Atividade concluída!','success');
};

window._adiarNotif = async (id) => {
  const novaData = new Date(Date.now() + 86400000).toISOString().slice(0,10);
  await Auth.api('PATCH', `/atividades/${id}`, { status: 'adiada', data_limite: novaData });
  _fecharNotif(id);
  window.Toast?.show('Atividade adiada.','success');
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

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────

if (!document.getElementById('atividades-css')) {
  const st = document.createElement('style');
  st.id = 'atividades-css';
  st.textContent = `
    @keyframes slideInUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:none; } }

    .at-section { margin-top:10px; }

    .at-header {
      display:flex; align-items:center; justify-content:space-between;
      margin-bottom:10px;
    }
    .at-header-title {
      display:flex; align-items:center; gap:6px;
      font-size:.78rem; font-weight:700; color:var(--text-secondary);
      text-transform:uppercase; letter-spacing:.06em;
    }
    .at-btn-nova { font-size:.7rem; padding:3px 10px; }

    /* Formulário */
    .at-form {
      background:var(--surface-2,#161616);
      border:1px solid var(--border);
      border-radius:10px;
      padding:12px;
      margin-bottom:12px;
      animation:slideInUp .2s ease;
    }
    .at-form-grid { display:flex; flex-direction:column; gap:8px; }
    .at-form-row  { display:flex; gap:8px; }
    .at-form-row .input-group-sm { flex:1; min-width:0; }
    .at-form-btns { display:flex; gap:6px; margin-top:10px; }

    /* Kanban vertical */
    .at-grupo {
      margin-bottom:10px;
      border-radius:10px;
      overflow:hidden;
      border:1px solid var(--border);
    }
    .at-grupo-header {
      display:flex; align-items:center; gap:6px;
      background:var(--surface-2,#161616);
      padding:7px 10px;
      font-size:.72rem; font-weight:700;
      text-transform:uppercase; letter-spacing:.06em;
    }
    .at-grupo-icon  { font-size:.85rem; }
    .at-grupo-label { flex:1; }
    .at-grupo-count {
      background:var(--surface); border-radius:999px;
      padding:1px 7px; font-size:.65rem; font-weight:700;
      color:var(--text-muted);
    }
    .at-grupo-lista { display:flex; flex-direction:column; gap:0; }

    /* Card de atividade */
    .at-card {
      background:var(--surface);
      padding:9px 11px;
      border-top:1px solid var(--border);
      transition:background .15s;
    }
    .at-card:hover { background:var(--surface-2); }
    .at-card:last-child { border-radius:0 0 10px 10px; }

    .at-card-header {
      display:flex; align-items:center; gap:6px;
      margin-bottom:3px;
    }
    .at-card-dot {
      width:7px; height:7px; border-radius:50%; flex-shrink:0;
    }
    .at-card-tipo {
      font-size:.8rem; font-weight:700; flex:1; min-width:0;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .at-card-prazo {
      font-size:.65rem; color:var(--text-muted);
      white-space:nowrap; flex-shrink:0;
    }
    .at-card-obs {
      font-size:.72rem; color:var(--text-secondary);
      margin:2px 0 4px 13px;
      display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
      overflow:hidden;
    }
    .at-card-meta {
      display:flex; gap:10px; margin-bottom:6px; padding-left:13px;
    }
    .at-card-resp, .at-card-criador {
      font-size:.65rem; color:var(--text-muted);
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    .at-card-btns {
      display:flex; gap:4px; flex-wrap:wrap; padding-left:13px;
    }
    .at-btn {
      font-size:.63rem; padding:2px 7px;
      border-radius:5px;
    }

    /* Empty state */
    .at-empty {
      font-size:.75rem; color:var(--text-muted);
      text-align:center; padding:20px 10px;
      border:1px dashed var(--border);
      border-radius:10px; margin-top:4px;
    }
  `;
  document.head.appendChild(st);
}

// ─────────────────────────────────────────────────────────────────────────────
// Exporta API global
// ─────────────────────────────────────────────────────────────────────────────
window.Atividades = {
  renderTab:       renderAtividadesTab,
  carregar:        carregarAtividades,
  iniciarLembretes,
};
