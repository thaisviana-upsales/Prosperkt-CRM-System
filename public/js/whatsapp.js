/**
 * PROSPERKT CRM — whatsapp.js
 * Central de conversas: lista, chat estilo WA, envio de mensagens
 */

// ─── Estado ───────────────────────────────────────────────────────────────────
let _usuario   = null;
let _conversas = [];
let _convAtiva = null;   // objeto conversa
let _mensagens = [];
let _filtroStatus = '';
let _busca = '';
let _leads = [];
let _refreshTimer = null;
let _pollingTimer = null;

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// ─── Init ─────────────────────────────────────────────────────────────────────
// Contexto de abertura via URL (botão WA do card)
let _leadCtx = null; // { leadId, tel, nome } — contexto do lead que abriu a página

async function init() {
  _usuario = await Sidebar.init('whatsapp');
  if (!_usuario) return;

  // Verifica se veio via ?lead_id=...&tel=...&nome=... (botão WA do card)
  const params = new URLSearchParams(location.search);
  const leadId = params.get('lead_id');
  const tel    = params.get('tel');
  const nome   = params.get('nome') || '';

  // Guarda contexto do lead para uso após carregamento
  if (leadId && tel) {
    _leadCtx = { leadId, tel, nome };
  }

  // Carrega conversas e leads em paralelo
  await Promise.all([carregarConversas(), carregarLeads()]);

  // Se veio de um card, navega direto para a conversa do lead
  if (_leadCtx) {
    await resolverConversaLead(_leadCtx.leadId, _leadCtx.tel, _leadCtx.nome);
  }

  bindEvents();

  // Polling a cada 10s para novas mensagens
  _pollingTimer = setInterval(async () => {
    await carregarConversas(true);
    if (_convAtiva) await carregarMensagens(_convAtiva.id, true);
  }, 10000);
}

// ─── Carregar conversas ───────────────────────────────────────────────────────
async function carregarConversas(silencioso = false) {
  const qs = [];
  if (_filtroStatus) qs.push('status=' + _filtroStatus);
  if (_busca)        qs.push('busca=' + encodeURIComponent(_busca));
  qs.push('limit=100');

  const r = await Auth.api('GET', '/whatsapp/conversas' + (qs.length ? '?' + qs.join('&') : ''));
  if (!r?.ok) { if (!silencioso) Toast.show('Erro ao carregar conversas.', 'error'); return; }

  _conversas = r.data.dados || [];
  renderListaConversas();

  document.getElementById('ultima-att').textContent = 'Atualizado ' + new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
  document.getElementById('conv-count').textContent = `${_conversas.length} conversa${_conversas.length !== 1 ? 's' : ''}`;
}

async function carregarLeads() {
  const r = await Auth.api('GET', '/leads?limit=200');
  _leads = r?.data?.dados || [];
  popularSelectLeads();
}

function popularSelectLeads() {
  const sel = document.getElementById('nc-lead');
  const opts = _leads.map(l => `<option value="${l.id}">${l.nome}${l.telefone ? ' — ' + l.telefone : ''}</option>`).join('');
  sel.innerHTML = '<option value="">— sem lead —</option>' + opts;
}

// ─── Render lista ─────────────────────────────────────────────────────────────
function renderListaConversas() {
  const el = document.getElementById('conv-list');
  if (!_conversas.length) {
    el.innerHTML = `<div class="wa-empty-list">
      <div style="font-size:2rem;opacity:.3;margin-bottom:8px">💬</div>
      Nenhuma conversa encontrada.<br>
      <small style="opacity:.6">Crie uma nova ou aguarde mensagens.</small>
    </div>`;
    return;
  }

  el.innerHTML = _conversas.map(c => {
    const nome      = c.nome_contato || c.lead_nome || c.telefone;
    const initials  = (nome || '??').slice(0, 2).toUpperCase();
    const preview   = c.ultima_mensagem ? escHtml(c.ultima_mensagem.slice(0, 50)) : '<em>Sem mensagens</em>';
    const isEnviada = c.ultima_direcao === 'enviada';
    const hora      = c.ultima_msg_em ? fmtHora(c.ultima_msg_em) : '';
    const isAtiva   = _convAtiva?.id === c.id;
    const unread    = c.nao_lidas > 0 ? `<div class="wa-unread-badge">${c.nao_lidas}</div>` : '';

    return `
    <div class="wa-conv-item${isAtiva ? ' active' : ''}" data-id="${c.id}" id="conv-item-${c.id}">
      <div class="wa-conv-avatar" style="${c.status === 'ABERTA' ? '' : 'opacity:.6'}">
        ${initials}
        ${c.status === 'ABERTA' ? '<div class="wa-conv-status-dot"></div>' : ''}
      </div>
      <div class="wa-conv-info">
        <div class="wa-conv-name">${escHtml(nome)}</div>
        <div class="wa-conv-preview${isEnviada ? ' enviada' : ''}">${preview}</div>
      </div>
      <div class="wa-conv-meta">
        <div class="wa-conv-time">${hora}</div>
        ${unread}
      </div>
    </div>`;
  }).join('');

  // Bind clicks
  el.querySelectorAll('.wa-conv-item').forEach(item => {
    item.addEventListener('click', () => abrirConversa(item.dataset.id));
  });
}

// ─── Abrir conversa ───────────────────────────────────────────────────────────
async function abrirConversa(id) {
  _convAtiva = _conversas.find(c => c.id === id) || null;
  if (!_convAtiva) return;

  // Destaca na lista
  document.querySelectorAll('.wa-conv-item').forEach(el => el.classList.remove('active'));
  document.getElementById('conv-item-' + id)?.classList.add('active');

  // Mostra área de chat
  document.getElementById('chat-empty').style.display = 'none';
  document.getElementById('chat-header').style.display = '';
  document.getElementById('wa-messages').style.display = '';
  document.getElementById('wa-input-bar').style.display = '';

  // Popula header
  const nome = _convAtiva.nome_contato || _convAtiva.lead_nome || _convAtiva.telefone;
  document.getElementById('chat-nome').textContent = nome;
  document.getElementById('chat-avatar').textContent = (nome || '??').slice(0, 2).toUpperCase();
  document.getElementById('chat-tel').textContent = _convAtiva.telefone;
  document.getElementById('chat-status-text').innerHTML =
    _convAtiva.status === 'ABERTA' ? '<span class="online">● Online</span>' :
    _convAtiva.status === 'AGUARDANDO' ? '⌛ Aguardando resposta' : '✓ Fechada';

  // Popula painel info
  document.getElementById('info-nome').textContent = nome;
  document.getElementById('info-tel').textContent  = _convAtiva.telefone;
  document.getElementById('info-empresa').textContent = _convAtiva.lead_empresa || '—';
  document.getElementById('info-vendedor').textContent = _convAtiva.vendedor_nome || '—';

  if (_convAtiva.lead_id) {
    const linkWrap = document.getElementById('info-lead-link-wrap');
    linkWrap.style.display = '';
    document.getElementById('info-lead-link').href = `/pipeline.html?lead=${_convAtiva.lead_id}`;
  }

  await carregarMensagens(id);
}

// Resolve conversa de um lead vindo do card da Pipeline
// Comportamento:
// - Conversa existe → injeta na lista e abre direto
// - Não existe → mostra estado "sem conversa" com botão Iniciar
async function resolverConversaLead(leadId, tel, nome) {
  // 1. Consulta backend: já existe conversa para este lead?
  const r = await Auth.api('GET', `/whatsapp/lead/${leadId}`);

  if (r?.ok && r.data.dados) {
    // ✅ CONVERSA EXISTENTE — injeta no topo da lista e abre
    const conv = { ...r.data.dados, lead_nome: nome };
    // Remove se já estiver na lista (evita duplicata)
    _conversas = _conversas.filter(c => c.id !== conv.id);
    _conversas.unshift(conv);
    renderListaConversas();
    await abrirConversa(conv.id);
  } else {
    // ⚠️ SEM CONVERSA — mostra estado especial
    mostrarEstadoSemConversa(leadId, tel, nome);
  }
}

// Estado visual quando não há conversa para o lead
function mostrarEstadoSemConversa(leadId, tel, nome) {
  // Oculta empty genérico e mostra chat area com estado personalizado
  document.getElementById('chat-empty').style.display = 'none';
  document.getElementById('chat-header').style.display = '';
  document.getElementById('wa-messages').style.display = '';
  document.getElementById('wa-input-bar').style.display = 'none'; // ocultado até iniciar

  const nomeDisplay = nome || tel || 'Lead sem nome';
  document.getElementById('chat-nome').textContent = nomeDisplay;
  document.getElementById('chat-avatar').textContent = (nomeDisplay).slice(0, 2).toUpperCase();
  document.getElementById('chat-tel').textContent = tel || '—';
  document.getElementById('chat-status-text').innerHTML = '<span style="color:var(--text-muted)">Sem conversa</span>';

  // Guarda contexto no _leadCtx para o botão usar (evita parâmetros no onclick)
  _leadCtx = { leadId, tel, nome };

  // Renderiza estado vazio — botão SEM parâmetros inline (safe para qualquer nome/tel)
  document.getElementById('wa-messages').innerHTML = `
    <div id="sem-conversa-wrap" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px 24px;gap:16px">
      <div style="font-size:3.5rem;opacity:.25">💬</div>
      <div style="font-size:1rem;font-weight:700;color:var(--text-secondary)">
        Nenhuma conversa com<br><span style="color:var(--text-primary)">${escHtml(nomeDisplay)}</span>
      </div>
      ${tel
        ? `<div style="font-size:.82rem;color:var(--text-muted)">Telefone: <strong>${escHtml(tel)}</strong></div>`
        : `<div style="font-size:.82rem;color:var(--pink);font-weight:600">⚠ Lead sem telefone cadastrado. Adicione um telefone no CRM para iniciar conversa.</div>`
      }
      <div id="iniciar-erro" style="display:none;font-size:.78rem;color:var(--pink);font-weight:600;padding:8px 16px;background:rgba(225,0,152,.08);border-radius:8px"></div>
      ${tel ? `
      <button
        id="btn-iniciar-conv"
        style="
          margin-top:8px;
          padding:12px 32px;
          background:var(--grad-brand);
          border:none;border-radius:50px;
          color:#0D0D0D;font-family:inherit;font-size:.9rem;font-weight:800;
          cursor:pointer;transition:all .2s;
          display:inline-flex;align-items:center;gap:8px
        "
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        Iniciar Conversa
      </button>` : ''}
    </div>`;

  // Bind via addEventListener — CSP bloqueia onclick inline em innerHTML dinâmico
  const btnIniciar = document.getElementById('btn-iniciar-conv');
  if (btnIniciar) {
    btnIniciar.addEventListener('mouseover', () => { btnIniciar.style.boxShadow = '0 0 20px rgba(108,255,78,.4)'; btnIniciar.style.transform = 'scale(1.04)'; });
    btnIniciar.addEventListener('mouseout',  () => { btnIniciar.style.boxShadow = ''; btnIniciar.style.transform = ''; });
    btnIniciar.addEventListener('click', iniciarConversaDoLead);
  }
}

// Chamado pelo botão "Iniciar Conversa" no estado vazio
// Usa _leadCtx como fonte de dados — sem parâmetros inline para evitar bugs com caracteres especiais
async function iniciarConversaDoLead() {
  const ctx = _leadCtx;

  // Validação: telefone obrigatório
  if (!ctx?.tel) {
    const erroEl = document.getElementById('iniciar-erro');
    if (erroEl) { erroEl.textContent = 'Telefone obrigatório para iniciar conversa. Atualize o lead no CRM.'; erroEl.style.display = ''; }
    Toast.show('Lead sem telefone. Atualize o cadastro.', 'error');
    return;
  }

  const btn = document.getElementById('btn-iniciar-conv');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite">
        <circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"/>
      </svg>
      Iniciando...`;
  }

  // Cria a conversa via API
  const r = await Auth.api('POST', '/whatsapp/conversas', {
    telefone: ctx.tel,
    lead_id:  ctx.leadId || null,
    nome_contato: ctx.nome || null
  });

  if (!r?.ok) {
    Toast.show(r?.data?.erro || 'Erro ao iniciar conversa. Tente novamente.', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        Iniciar Conversa`;
    }
    return;
  }

  // ✅ Conversa criada com sucesso
  Toast.show('Conversa iniciada!', 'success');
  const convId = r.data.dados?.id;

  // Faz fetch completo da conversa para garantir TODOS os campos (vendedor_nome, lead_empresa, etc.)
  const fetchFull = await Auth.api('GET', `/whatsapp/conversas/${convId}`);
  const convFull  = fetchFull?.ok ? { ...fetchFull.data.dados, lead_nome: ctx.nome } : { ...r.data.dados, lead_nome: ctx.nome };

  // Injeta no topo da lista (sem duplicar)
  _conversas = _conversas.filter(c => c.id !== convFull.id);
  _conversas.unshift(convFull);
  renderListaConversas();

  // Restaura barra de input e abre a conversa
  document.getElementById('wa-input-bar').style.display = '';
  await abrirConversa(convFull.id);

  // Foca no campo de mensagem automaticamente
  setTimeout(() => {
    const input = document.getElementById('msg-input');
    if (input) input.focus();
  }, 150);
}

// Função legada mantida por compatibilidade
async function abrirOuCriarConversaLead(leadId, tel, nome) {
  return resolverConversaLead(leadId, tel, nome);
}

// ─── Carregar mensagens ───────────────────────────────────────────────────────
async function carregarMensagens(convId, silencioso = false) {
  const r = await Auth.api('GET', `/whatsapp/conversas/${convId}/mensagens?limit=200`);
  if (!r?.ok) { if (!silencioso) Toast.show('Erro ao carregar mensagens.', 'error'); return; }

  _mensagens = r.data.dados || [];
  renderMensagens();
}

// ─── Render mensagens ─────────────────────────────────────────────────────────
function renderMensagens() {
  const el = document.getElementById('wa-messages');
  if (!_mensagens.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-muted);font-size:.82rem">
        <div style="font-size:2.5rem;margin-bottom:10px;opacity:.3">💬</div>
        Nenhuma mensagem ainda.<br>
        <small>Comece a conversa digitando abaixo.</small>
      </div>
      <div class="wa-typing" id="wa-typing"><span></span><span></span><span></span></div>`;
    scrollToBottom();
    return;
  }

  let html = '';
  let ultimaData = null;

  _mensagens.forEach(msg => {
    // Separador de data
    const dataMsg = fmtData(msg.criado_em);
    if (dataMsg !== ultimaData) {
      html += `<div class="wa-date-sep"><span>${dataMsg}</span></div>`;
      ultimaData = dataMsg;
    }

    html += renderMensagem(msg);
  });

  html += `<div class="wa-typing" id="wa-typing"><span></span><span></span><span></span></div>`;

  el.innerHTML = html;
  scrollToBottom();
}

function renderMensagem(msg) {
  const dir      = msg.direcao === 'enviada' ? 'enviada' : msg.tipo === 'sistema' ? 'sistema' : 'recebida';
  const hora     = fmtHoraMsg(msg.criado_em);
  const statusIcon = { enviado: '✓', entregue: '✓✓', lido: '✓✓', erro: '✕' };
  const statusStr  = msg.direcao === 'enviada'
    ? `<span class="wa-bubble-status ${msg.status}">${statusIcon[msg.status] || '✓'}</span>` : '';

  let conteudo = '';
  if (msg.tipo === 'texto' || msg.tipo === 'sistema') {
    conteudo = `<div class="wa-bubble-text">${escHtml(msg.mensagem || '')}</div>`;
  } else if (msg.tipo === 'imagem') {
    conteudo = `<img class="wa-img" src="${msg.arquivo_url}" alt="Imagem" onclick="window.open('${msg.arquivo_url}','_blank')">
      ${msg.mensagem ? `<div class="wa-bubble-text" style="margin-top:4px">${escHtml(msg.mensagem)}</div>` : ''}`;
  } else if (msg.tipo === 'audio') {
    conteudo = `<div class="wa-audio">
      <button class="wa-audio-play" onclick="toggleAudio(this,'${msg.arquivo_url}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      </button>
      <div class="wa-audio-bar"><div class="wa-audio-bar-fill" id="ab-${msg.id}"></div></div>
      <span style="font-size:.65rem;color:rgba(255,255,255,.45)">Áudio</span>
    </div>`;
  } else if (msg.tipo === 'arquivo' || msg.tipo === 'video') {
    conteudo = `<a href="${msg.arquivo_url}" target="_blank" style="display:flex;align-items:center;gap:8px;color:var(--green);font-size:.82rem;text-decoration:none">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      ${escHtml(msg.arquivo_nome || 'Arquivo')}
    </a>`;
  }

  return `<div class="wa-msg ${dir}" data-id="${msg.id}">
    <div class="wa-bubble">
      ${conteudo}
      <div class="wa-bubble-footer">
        <span class="wa-bubble-time">${hora}</span>
        ${statusStr}
      </div>
    </div>
  </div>`;
}

// ─── Enviar mensagem ──────────────────────────────────────────────────────────
async function enviarMensagem() {
  if (!_convAtiva) return;
  const input = document.getElementById('msg-input');
  const txt   = input.value.trim();
  if (!txt) return;

  const btn = document.getElementById('btn-send');
  btn.disabled = true;
  input.value  = '';
  input.style.height = '';
  btn.disabled = true;

  // Otimista: renderiza imediatamente
  const msgTemp = {
    id: 'temp-' + Date.now(),
    direcao: 'enviada', tipo: 'texto',
    mensagem: txt, status: 'enviado',
    criado_em: new Date().toISOString(),
    vendedor_nome: _usuario.nome
  };
  _mensagens.push(msgTemp);
  renderMensagens();

  const r = await Auth.api('POST', `/whatsapp/conversas/${_convAtiva.id}/mensagens`, {
    mensagem: txt, tipo: 'texto'
  });

  if (r?.ok) {
    // Atualiza com dado real
    _mensagens = _mensagens.filter(m => m.id !== msgTemp.id);
    _mensagens.push(r.data.dados);
    renderMensagens();
    // Atualiza preview na lista
    _conversas = _conversas.map(c =>
      c.id === _convAtiva.id ? { ...c, ultima_mensagem: txt, ultima_direcao: 'enviada', ultima_msg_em: new Date().toISOString() } : c
    );
    renderListaConversas();
    // Re-destaca a conversa ativa
    document.getElementById('conv-item-' + _convAtiva.id)?.classList.add('active');
  } else {
    // Marca como erro
    _mensagens = _mensagens.map(m => m.id === msgTemp.id ? { ...m, status: 'erro' } : m);
    renderMensagens();
    Toast.show(r?.data?.erro || 'Erro ao enviar mensagem.', 'error');
  }

  btn.disabled = false;
}

// ─── Upload de arquivo ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('file-input')?.addEventListener('change', async function() {
    if (!_convAtiva || !this.files[0]) return;
    const file = this.files[0];
    // Simulação de URL (em produção usar upload real)
    const tipo = file.type.startsWith('image/') ? 'imagem'
                : file.type.startsWith('video/') ? 'video'
                : file.type.startsWith('audio/') ? 'audio' : 'arquivo';

    Toast.show(`Arquivo "${file.name}" selecionado. Em produção, configure upload para S3/CDN.`, 'info');
    const r = await Auth.api('POST', `/whatsapp/conversas/${_convAtiva.id}/mensagens`, {
      mensagem: null, tipo, arquivo_url: '#', arquivo_nome: file.name
    });
    if (r?.ok) {
      _mensagens.push(r.data.dados);
      renderMensagens();
    }
    this.value = '';
  });
});

// ─── Nova conversa (modal) ────────────────────────────────────────────────────
function abrirModalNova() {
  document.getElementById('nc-tel').value   = '';
  document.getElementById('nc-nome').value  = '';
  document.getElementById('nc-lead').value  = '';
  document.getElementById('modal-alert').style.display = 'none';
  document.getElementById('modal-ov').classList.add('open');
  setTimeout(() => document.getElementById('nc-tel').focus(), 50);
}

function fecharModal() {
  document.getElementById('modal-ov').classList.remove('open');
}

async function salvarNovaConversa() {
  const tel   = document.getElementById('nc-tel').value.trim();
  const nome  = document.getElementById('nc-nome').value.trim();
  const leadId = document.getElementById('nc-lead').value;
  const alertEl = document.getElementById('modal-alert');
  alertEl.style.display = 'none';

  if (!tel) {
    alertEl.className = 'alert alert-error';
    alertEl.textContent = 'Telefone é obrigatório.';
    alertEl.style.display = '';
    return;
  }

  const r = await Auth.api('POST', '/whatsapp/conversas', {
    telefone: tel, nome_contato: nome || null, lead_id: leadId || null
  });

  if (r?.ok) {
    fecharModal();
    Toast.show('Conversa iniciada!', 'success');
    await carregarConversas();
    await abrirConversa(r.data.dados.id);
  } else {
    alertEl.className = 'alert alert-error';
    alertEl.textContent = r?.data?.erro || 'Erro ao criar conversa.';
    alertEl.style.display = '';
  }
}

// ─── Atualizar status da conversa ─────────────────────────────────────────────
async function atualizarStatusConversa(novoStatus) {
  if (!_convAtiva) return;
  const r = await Auth.api('PATCH', `/whatsapp/conversas/${_convAtiva.id}/status`, { status: novoStatus });
  if (r?.ok) {
    Toast.show('Status atualizado!', 'success');
    _convAtiva.status = novoStatus;
    await carregarConversas();
    // Re-destaca
    document.getElementById('conv-item-' + _convAtiva.id)?.classList.add('active');
    // Atualiza botões
    atualizarBotoesStatus(novoStatus);
  } else {
    Toast.show('Erro ao atualizar status.', 'error');
  }
}

function atualizarBotoesStatus(status) {
  ['ABERTA','AGUARDANDO','FECHADA'].forEach(s => {
    const btn = document.getElementById('conv-status-' + s.toLowerCase());
    if (btn) btn.classList.toggle('active', s === status);
  });
}

// ─── Utilidades ───────────────────────────────────────────────────────────────
function scrollToBottom() {
  const el = document.getElementById('wa-messages');
  if (el) setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
}

function fmtHora(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

function fmtHoraMsg(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtData(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const hoje = new Date();
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return 'Hoje';
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';
  return `${d.getDate()} de ${['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][d.getMonth()]}`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ─── Bind eventos ─────────────────────────────────────────────────────────────
function bindEvents() {
  // Botões topo
  document.getElementById('btn-nova-conv').addEventListener('click', abrirModalNova);
  document.getElementById('btn-refresh').addEventListener('click', () => carregarConversas());

  // Filtros de status
  document.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _filtroStatus = btn.dataset.status;
      carregarConversas();
    });
  });

  // Busca
  let buscaTimer;
  document.getElementById('busca-conv').addEventListener('input', e => {
    _busca = e.target.value;
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(() => carregarConversas(), 300);
  });

  // Modal
  document.getElementById('modal-close').addEventListener('click', fecharModal);
  document.getElementById('modal-cancelar').addEventListener('click', fecharModal);
  document.getElementById('modal-salvar').addEventListener('click', salvarNovaConversa);
  document.getElementById('modal-ov').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-ov')) fecharModal();
  });

  // Input mensagem
  const msgInput = document.getElementById('msg-input');
  const sendBtn  = document.getElementById('btn-send');

  msgInput.addEventListener('input', function() {
    sendBtn.disabled = !this.value.trim();
    // Auto-resize
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) enviarMensagem();
    }
  });

  sendBtn.addEventListener('click', enviarMensagem);

  // Anexo
  document.getElementById('btn-attach').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  // Painel info
  document.getElementById('btn-info-panel').addEventListener('click', () => {
    const panel = document.getElementById('info-panel');
    panel.classList.toggle('open');
  });
  document.getElementById('btn-fechar-info').addEventListener('click', () => {
    document.getElementById('info-panel').classList.remove('open');
  });

  // Fechar conversa (status FECHADA)
  document.getElementById('btn-fechar-conv').addEventListener('click', () => {
    if (_convAtiva) atualizarStatusConversa('FECHADA');
  });

  // Botões de status da conversa no painel info
  document.querySelectorAll('[data-conv-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      atualizarStatusConversa(btn.dataset.convStatus);
    });
  });

  // Escape fecha modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('modal-ov').classList.contains('open')) fecharModal();
  });
}

// ─── Áudio (simulado) ─────────────────────────────────────────────────────────
let _audioAtual = null;
function toggleAudio(btn, url) {
  if (url === '#') { Toast.show('Áudio não disponível na simulação.', 'info'); return; }
  if (_audioAtual) { _audioAtual.pause(); _audioAtual = null; }
  const audio = new Audio(url);
  _audioAtual = audio;
  audio.play().catch(() => Toast.show('Erro ao reproduzir áudio.', 'error'));
}

// ─── Kick-off ─────────────────────────────────────────────────────────────────
init();
