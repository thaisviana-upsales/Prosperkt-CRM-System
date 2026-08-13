// ─── Normalização de telefone — espelho do backend normalizePhoneBR() ──────────────
// Números oficiais do CRM — NUNCA são clientes
const _NUMEROS_OFICIAIS_WA = new Set(['5511987994910', '5511967668883']);

function normalizePhone(tel) {
  if (!tel) return '';
  let t = String(tel).trim();
  console.log('WHATSAPP_PHONE_NORMALIZE_INPUT', t.slice(0, 20));

  // Rejeita @lid explicitamente
  if (t.includes('@lid')) {
    console.log('WHATSAPP_PHONE_REJECTED_LID', 'sufixo_lid');
    return '';
  }

  // Remove sufixo @s.whatsapp.net e :0 (device suffix)
  const username = t.split('@')[0].split(':')[0];

  // Se tiver letras no username → é JID nomeado ou LID, rejeita
  if (/[a-zA-Z]/.test(username)) {
    console.log('WHATSAPP_PHONE_REJECTED_LID', 'letras_no_jid');
    return '';
  }

  t = username.replace(/\D/g, '');
  if (!t) return '';

  // LID por comprimento: 14+ dígitos sem DDI 55 = identificador interno
  if (t.length >= 14 && !t.startsWith('55')) {
    console.log('WHATSAPP_PHONE_REJECTED_LID', 'comprimento_14_sem_55');
    return '';
  }

  // Rejeita timestamp unix (10 ou 13 dígitos na faixa unix)
  const numVal = Number(t);
  if ((t.length === 10 && numVal >= 1000000000 && numVal <= 2200000000) ||
      (t.length === 13 && numVal >= 1000000000000 && numVal <= 2200000000000)) {
    return '';
  }

  // Adiciona DDI 55 para DDD+número (10-11 dígitos)
  if (t.length === 10 || t.length === 11) t = '55' + t;

  // Valida formato brasileiro ou internacional
  if (!/^55\d{10,11}$/.test(t) && !/^\d{10,15}$/.test(t)) return '';

  // Rejeita número oficial — não é cliente
  if (_NUMEROS_OFICIAIS_WA.has(t)) {
    console.log('WHATSAPP_PHONE_REJECTED_OFFICIAL_AS_CLIENT', t.slice(0, 6) + '****');
    return '';
  }

  console.log('WHATSAPP_PHONE_NORMALIZE_RESULT', t.slice(0, 6) + '****');
  return t;
}

// Compara dois telefones considerando variantes com/sem DDI 55 e com/sem nono dígito
function phonesMatch(a, b) {
  if (!a || !b) return false;
  const na = normalizePhone(a), nb = normalizePhone(b);
  if (na === nb) return true;
  const sa = na.startsWith('55') ? na.slice(2) : na;
  const sb = nb.startsWith('55') ? nb.slice(2) : nb;
  if (sa === sb) return true;
  const rm9 = n => (n.length === 13 && n.startsWith('55') && n[4] === '9') ? n.slice(0,4)+n.slice(5) : n;
  if (rm9(na) === rm9(nb)) return true;
  const rm9s = n => (n.length === 11 && n[2] === '9') ? n.slice(0,2)+n.slice(3) : n;
  return rm9s(sa) === rm9s(sb);
}


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

  // Lê parâmetros da URL — botão WA do card envia: ?lead_id=...&phone=...&nome=...
  const params = new URLSearchParams(location.search);
  const leadIdParam = params.get('lead_id') || params.get('leadId') || '';
  const phoneRaw    = params.get('phone') || params.get('tel') || '';
  const phoneParam  = normalizePhone(phoneRaw);
  const nomeParam   = decodeURIComponent(params.get('nome') || '');

  // Log obrigatório — visível no console do browser
  console.log('PIPELINE_WHATSAPP_CLICK:', {
    leadId:             leadIdParam,
    nomeLead:           nomeParam,
    telefoneOriginal:   phoneRaw,
    telefoneNormalizado: phoneParam,
    urlDestino:         location.href,
  });

  // Guarda contexto do lead para o resolverConversaLead usar
  if (leadIdParam || phoneParam) {
    _leadCtx = { leadId: leadIdParam, tel: phoneParam, nome: nomeParam };
  }

  // Carrega lista de conversas, leads e status em paralelo
  await Promise.all([carregarConversas(), carregarLeads(), carregarStatusConexao()]);

  // Se veio de um card do Pipeline, resolve e abre a conversa correta.
  // IMPORTANTE: não abre outra conversa automaticamente — resolverConversaLead é determinístico.
  if (_leadCtx) {
    await resolverConversaLead(_leadCtx.leadId, _leadCtx.tel, _leadCtx.nome);
  }

  bindEvents();

  // Polling a cada 5s para novas mensagens recebidas
  _pollingTimer = setInterval(async () => {
    await carregarConversas(true);
    if (_convAtiva) await pollMensagens(_convAtiva.id);
  }, 5000);
}


// ─── Status da conexão WhatsApp (banner topo) ────────────────────────────────
async function carregarStatusConexao() {
  try {
    // Endpoint disponível apenas para SUPER_ADMIN — trata silenciosamente se der 403
    const r = await Auth.api('GET', '/whatsapp/integracao/status');
    const banner = document.getElementById('wa-status-banner');
    if (!banner) return;
    if (!r?.ok) { banner.style.display = 'none'; return; }
    const d = r.data;
    // Só exibe banner de aviso quando não há atividade recente
    if (d.msgs_24h === 0) {
      banner.style.display = '';
      banner.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        <span>⚠️ WhatsApp sem atividade nas últimas 24h. As mensagens podem não estar chegando.
        ${['SUPER_ADMIN','GESTOR'].includes(_usuario?.role) ? '<a href="/integracao-whatsapp.html" style="color:#FFB627;text-decoration:underline;margin-left:6px;font-weight:700">Ver conexão →</a>' : ''}
        </span>`;
    } else {
      banner.style.display = 'none';
    }
  } catch(e) {
    // Silencioso — banner não bloqueia a página
  }
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
    const unread    = (c.nao_lidas > 0) ? `<div class="wa-unread-badge">${c.nao_lidas}</div>` : '';
    const temNaoLidas = c.nao_lidas > 0 && !isAtiva;

    return `
    <div class="wa-conv-item${isAtiva ? ' active' : ''}${temNaoLidas ? ' tem-nao-lidas' : ''}" data-id="${c.id}" id="conv-item-${c.id}">
      <div class="wa-conv-avatar" style="${c.status === 'ABERTA' ? '' : 'opacity:.6'}">
        ${initials}
        ${c.status === 'ABERTA' ? '<div class="wa-conv-status-dot"></div>' : ''}
      </div>
      <div class="wa-conv-info">
        <div class="wa-conv-name" style="${temNaoLidas ? 'font-weight:800;color:var(--text-primary)' : ''}">${escHtml(nome)}</div>
        <div class="wa-conv-preview${isEnviada ? ' enviada' : ''}">${preview}</div>
      </div>
      <div class="wa-conv-meta">
        <div class="wa-conv-time" style="${temNaoLidas ? 'color:var(--green);font-weight:700' : ''}">${hora}</div>
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

  // ── MOBILE: abre chat em tela cheia ──────────────────────────
  const isMobile = window.innerWidth <= 768;
  const waChat = document.getElementById('wa-chat');
  if (isMobile && waChat) {
    waChat.classList.add('mobile-open');
    // Botão Voltar — injeta apenas uma vez no header
    if (!document.getElementById('btn-mobile-voltar')) {
      const btnBack = document.createElement('button');
      btnBack.id = 'btn-mobile-voltar';
      btnBack.className = 'wa-icon-btn';
      btnBack.title = 'Voltar para conversas';
      btnBack.style.cssText = 'margin-right:4px;color:var(--green)';
      btnBack.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`;
      btnBack.addEventListener('click', () => {
        waChat.classList.remove('mobile-open');
      });
      const chatHeader = document.getElementById('chat-header');
      chatHeader.insertBefore(btnBack, chatHeader.firstChild);
    }
  }

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


// ─── Resolver conversa do lead ────────────────────────────────────────────────
// DETERMINÍSTICO: busca por telefone exato, nunca abre outra conversa
async function resolverConversaLead(leadId, tel, nome) {
  const telNorm = normalizePhone(tel);

  // ── LOGS OBRIGATÓRIOS ──────────────────────────────────────────────────────
  console.log('WHATSAPP_OPEN_BY_URL_START', { leadId, telRaw: tel, telNorm });
  console.log('WHATSAPP_OPEN_BY_URL_LEAD_ID', leadId || 'sem_lead_id');
  console.log('WHATSAPP_OPEN_BY_URL_PHONE_RAW', tel);
  console.log('WHATSAPP_OPEN_BY_URL_PHONE_NORMALIZED', telNorm);
  console.log('WHATSAPP_CONVERSA_RESOLVE_START', { leadId, tel: telNorm, nome });
  console.log('WHATSAPP_PAGE_URL_PARAMS', {
    leadId: new URLSearchParams(window.location.search).get('lead_id'),
    phone:  new URLSearchParams(window.location.search).get('phone'),
    nome:   new URLSearchParams(window.location.search).get('nome'),
  });
  console.log('WHATSAPP_TARGET_PHONE_NORMALIZED', telNorm);
  console.log('WHATSAPP_URL_PARAMS:', { leadIdParam: leadId, phoneParam: telNorm, nomeParam: nome });

  // Estado de loading na área de chat
  document.getElementById('chat-empty').style.display = 'none';
  document.getElementById('chat-header').style.display = '';
  document.getElementById('wa-messages').style.display = '';
  document.getElementById('wa-input-bar').style.display = 'none';
  document.getElementById('chat-nome').textContent = nome || telNorm || 'Buscando...';
  document.getElementById('chat-avatar').textContent = (nome || '??').slice(0, 2).toUpperCase();
  document.getElementById('chat-tel').textContent = telNorm || '—';
  document.getElementById('chat-status-text').innerHTML = '<span style="color:var(--text-muted)">Buscando conversa...</span>';
  document.getElementById('wa-messages').innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:.85rem">Carregando...</div>';

  let conv = null;

  // ── PASSO 1: Backend busca por lead_id (que internamente normaliza telefone) ─
  if (leadId) {
    try {
      const r = await Auth.api('GET', `/whatsapp/lead/${leadId}`);
      if (r?.ok && r.data.dados) {
        const candidata = r.data.dados;
        const telCandidato = normalizePhone(candidata.telefone);

        // VALIDAÇÃO: aceita variantes de formato (com/sem 55, com/sem nono dígito)
        if (telNorm && !phonesMatch(telCandidato, telNorm)) {
          console.warn('WHATSAPP_CONVERSA_TELEFONE_DIVERGENTE:', { conversaId: candidata.id, telefoneDaConversa: telCandidato, telEsperado: telNorm });
        } else {
          conv = { ...candidata, lead_nome: nome };
          console.log('WHATSAPP_CONVERSA_FOUND_BY_LEAD', { conversaId: conv.id, telefone: telCandidato, nome: conv.nome_contato });
        }
      }
    } catch (e) {
      console.warn('[WA] resolverConversaLead: erro busca por lead_id:', e.message);
    }
  }

  // ── PASSO 2: Busca EXATA por telefone normalizado na lista completa ──────────
  if (!conv && telNorm) {
    try {
      const r2 = await Auth.api('GET', '/whatsapp/conversas?limit=200');
      const lista = r2?.ok ? (r2.data.dados || []) : [];
      const porTel = lista.find(c => phonesMatch(c.telefone, telNorm));
      if (porTel) {
        conv = { ...porTel, lead_nome: nome };
        console.log('WHATSAPP_CONVERSA_FOUND_BY_PHONE', { conversaId: conv.id, telefone: normalizePhone(conv.telefone), nome: conv.nome_contato });
        // Vincula lead_id se ausente
        if (leadId && !porTel.lead_id) {
          Auth.api('POST', '/whatsapp/conversas', { telefone: telNorm, lead_id: leadId, nome_contato: nome }).catch(() => {});
        }
      } else {
        console.log('WHATSAPP_SELECTED_CONVERSATION — nenhuma conversa encontrada por telefone', telNorm, '— conversas existentes:', lista.map(c => normalizePhone(c.telefone)));
      }
    } catch (e) {
      console.warn('[WA] resolverConversaLead: erro busca por telefone:', e.message);
    }
  }

  // ── PASSO 3: Não existe → cria automaticamente ──────────────────────────────
  if (!conv && telNorm) {
    console.log('WHATSAPP_CONVERSA_RESOLVIDA: criando nova conversa para', telNorm);
    try {
      const rc = await Auth.api('POST', '/whatsapp/conversas', {
        telefone: telNorm, lead_id: leadId || null,
        nome_contato: nome || null, status: 'ABERTA'
      });
      if (rc?.ok && rc.data.dados) {
        conv = { ...rc.data.dados, lead_nome: nome };
        console.log('WHATSAPP_CONVERSA_CREATED', { conversaId: conv.id, telefone: conv.telefone, nome: conv.nome_contato });
        Toast.show('Conversa iniciada!', 'success');
      }
    } catch (e) {
      console.error('[WA] resolverConversaLead: erro ao criar conversa:', e.message);
    }
  }

  // ── PASSO 4: Abre ou exibe erro ─────────────────────────────────────────────
  if (conv) {
    console.log('WHATSAPP_CONVERSA_RESOLVIDA:', {
      leadIdParam: leadId, telefoneNormalizado: telNorm,
      conversaEncontrada: !conv._criada, conversaCriada: !!conv._criada,
      conversaIdAberta: conv.id,
    });
    _conversas = _conversas.filter(c => c.id !== conv.id);
    _conversas.unshift(conv);
    renderListaConversas();
    document.getElementById('wa-input-bar').style.display = '';
    await abrirConversa(conv.id);
  } else {
    console.error('WHATSAPP_CONVERSA_RESOLVIDA: FALHA TOTAL — não abre outra conversa', { leadId, telNorm });
    document.getElementById('chat-status-text').innerHTML = '<span style="color:var(--pink)">● Erro</span>';
    document.getElementById('wa-messages').innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px 24px;gap:12px">
        <div style="font-size:2rem;opacity:.4">⚠️</div>
        <div style="font-size:.95rem;font-weight:700;color:var(--text-secondary)">Não foi possível abrir a conversa deste lead.</div>
        <div style="font-size:.8rem;color:var(--text-muted)">${telNorm ? 'Telefone: ' + telNorm : 'Lead sem telefone cadastrado.'}</div>
        ${!telNorm ? '<div style="font-size:.8rem;color:var(--pink);font-weight:600">Cadastre o telefone no card do lead e tente novamente.</div>' : ''}
      </div>`;
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
  if (!r?.ok) {
    if (!silencioso) {
      console.error('WHATSAPP_MESSAGES_LOAD_ERROR', r?.data?.erro||'sem resposta', 'convId:', convId);
      Toast.show('Erro ao carregar mensagens.', 'error');
    }
    return;
  }
  _mensagens = r.data.dados || [];
  console.log('WHATSAPP_MESSAGES_LOADED', _mensagens.length, 'msgs | convId:', convId);

  // Zera nao_lidas localmente — backend já foi avisado pelo endpoint que retorna mensagens
  _conversas = _conversas.map(c =>
    c.id === convId ? { ...c, nao_lidas: 0 } : c
  );
  renderListaConversas();
  // Re-destaca a conversa ativa após re-render
  document.getElementById('conv-item-' + convId)?.classList.add('active');

  renderMensagens();
}


// ─── Poll silencioso de mensagens novas ─────────────────────────────────────
// Chamado pelo setInterval — só re-renderiza se houver mensagens novas,
// evitando reset de scroll desnecessário.
async function pollMensagens(convId) {
  try {
    const r = await Auth.api('GET', `/whatsapp/conversas/${convId}/mensagens?limit=200`);
    if (!r?.ok) return;
    const novas = r.data.dados || [];
    const qtdAntes = _mensagens.length;
    const idAnterior = _mensagens[_mensagens.length - 1]?.id;
    const idNovo     = novas[novas.length - 1]?.id;
    if (novas.length !== qtdAntes || idAnterior !== idNovo) {
      _mensagens = novas;
      renderMensagens(); // scrollToBottom interno
      console.log('CONVERSA_MESSAGES_HAS_RECEIVED', novas.filter(m => m.direcao === 'recebida').length);
    }
    console.log('CONVERSA_MESSAGES_LOAD_COUNT', novas.length);
  } catch(e) {
    // Silencioso — erro de polling não interrompe nada
  }
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
  const dir  = msg.direcao === 'enviada' ? 'enviada' : msg.tipo === 'sistema' ? 'sistema' : 'recebida';
  const hora = fmtHoraMsg(msg.criado_em);

  // ── Ícones de status (apenas mensagens enviadas pelo CRM) ─────────────────
  // pending  → relógio (enfileirado)
  // sent     → 1 check cinza (Evolution confirmou, ainda não entregue)
  // enviado  → idem (nome antigo no banco)
  // delivered → 2 checks cinza (entregue no aparelho)
  // entregue → idem (nome antigo)
  // read     → 2 checks turquesa (lida)
  // lido     → idem (nome antigo)
  // failed / erro → X vermelho
  let statusStr = '';
  if (dir === 'enviada') {
    const s = (msg.status || 'sent').toLowerCase();
    if (s === 'pending') {
      statusStr = `<span class="wa-bubble-status pending" title="Enviando...">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </span>`;
    } else if (s === 'sent' || s === 'enviado') {
      statusStr = `<span class="wa-bubble-status sent" title="Enviado">
        <svg width="13" height="9" viewBox="0 0 16 10" fill="none"><path d="M1 5L5.5 9L15 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>`;
    } else if (s === 'delivered' || s === 'entregue') {
      statusStr = `<span class="wa-bubble-status delivered" title="Entregue">
        <svg width="17" height="9" viewBox="0 0 20 10" fill="none"><path d="M1 5L5.5 9L15 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5L10.5 9L20 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>`;
    } else if (s === 'read' || s === 'lido') {
      statusStr = `<span class="wa-bubble-status read" title="Lida">
        <svg width="17" height="9" viewBox="0 0 20 10" fill="none"><path d="M1 5L5.5 9L15 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 5L10.5 9L20 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>`;
    } else if (s === 'failed' || s === 'erro') {
      statusStr = `<span class="wa-bubble-status failed" title="Falha no envio">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      </span>`;
    } else {
      // fallback → 1 check cinza
      statusStr = `<span class="wa-bubble-status sent" title="Enviado">
        <svg width="13" height="9" viewBox="0 0 16 10" fill="none"><path d="M1 5L5.5 9L15 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>`;
    }
  }

  // ── Rótulo de autoria (interno CRM — não vai para o cliente) ─────────────
  const autorNome = msg.vendedor_nome || (dir === 'enviada' && _usuario?.nome) || '';
  const autorLabel = (dir === 'enviada' && autorNome)
    ? `<div class="wa-msg-autor">[${escHtml(autorNome)}]</div>` : '';

  // ── Conteúdo da mensagem ──────────────────────────────────────────────────
  let conteudo = '';
  if (msg.tipo === 'texto' || msg.tipo === 'sistema') {
    conteudo = `<div class="wa-bubble-text">${escHtml(msg.mensagem || '')}</div>`;
  } else if (msg.tipo === 'imagem') {
    // Preview com onerror — se URL não carregar, mostra placeholder
    const imgSrc = msg.arquivo_url || '';
    const imgAlt = escHtml(msg.arquivo_nome || 'Imagem');
    if (imgSrc) {
      conteudo = `
        <div class="wa-img-wrap">
          <img class="wa-img" src="${escHtml(imgSrc)}" alt="${imgAlt}"
            loading="lazy"
            onclick="window.open('${escHtml(imgSrc)}','_blank')"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
          >
          <div class="wa-img-error" style="display:none;align-items:center;gap:6px;padding:12px;background:var(--surface-2);border-radius:8px;font-size:.72rem;color:var(--text-muted)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Não foi possível carregar esta mídia.
            ${imgSrc ? `<a href="${escHtml(imgSrc)}" target="_blank" style="color:var(--green);text-decoration:underline;font-size:.7rem">Abrir link</a>` : ''}
          </div>
        </div>
        ${msg.mensagem ? `<div class="wa-bubble-text" style="margin-top:4px">${escHtml(msg.mensagem)}</div>` : ''}`;
    } else {
      conteudo = `<div style="font-size:.75rem;color:var(--text-muted);padding:8px 0">Imagem não disponível.</div>`;
    }
  } else if (msg.tipo === 'audio') {
    // Usa /api/whatsapp/audio/play/:msgId diretamente — endpoint robusto com fallbacks completos
    // IMPORTANTE: não usar /api/whatsapp/media/ pois servirMidia (frozen) falha com caminhos relativos Supabase
    const audioSrc = msg.arquivo_url || msg.storage_path
      ? `/api/whatsapp/audio/play/${msg.id}`
      : '';
    const dur = msg.media_duration ? ` · ${Math.floor(msg.media_duration/60)}:${String(msg.media_duration%60).padStart(2,'0')}` : '';
    conteudo = audioSrc
      ? `<div class="wa-audio-player" data-src="${escHtml(audioSrc)}" data-id="${msg.id}">
           <button class="wa-audio-play-btn" title="Play/Pause">
             <svg class="ico-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
             <svg class="ico-pause" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="display:none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
           </button>
           <div class="wa-audio-progress">
             <div class="wa-audio-bar-fill"></div>
           </div>
           <span class="wa-audio-time">0:00${dur}</span>
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.5;flex-shrink:0"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
         </div>`
      : `<div class="wa-audio-player" style="opacity:.6">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/></svg>
           <span style="font-size:.75rem;color:var(--text-muted)">Áudio não disponível</span>
         </div>`;
    console.log('WHATSAPP_AUDIO_RENDERED', { msgId: msg.id, hasSrc: !!audioSrc, dur });
  } else if (msg.tipo === 'video') {
    const url = msg.arquivo_url || '';
    const nome = msg.arquivo_nome || 'Vídeo';
    const downloadUrl = `/api/whatsapp/arquivos/${msg.id}/download`;
    conteudo = url
      ? `<div class="wa-file-card">
           <div style="display:flex;align-items:center;gap:10px">
             <div class="wa-file-icon" style="background:rgba(255,184,0,.12);border-color:rgba(255,184,0,.2)">
               <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFB800" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
             </div>
             <div style="flex:1;min-width:0">
               <p style="font-size:.78rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0" title="${escHtml(nome)}">${escHtml(nome)}</p>
               <p style="font-size:.67rem;color:var(--text-muted);margin:2px 0 0">Vídeo</p>
             </div>
             <a href="${escHtml(downloadUrl)}" download="${escHtml(nome)}" class="wa-file-dl-btn" title="Baixar">
               <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 13 7 8"/><line x1="12" y1="3" x2="12" y2="13"/></svg>
             </a>
           </div>
         </div>`
      : `<span style="font-size:.78rem;color:var(--text-muted)">Vídeo</span>`;
  } else if (msg.tipo === 'arquivo' || msg.tipo === 'documento') {
    const url  = msg.arquivo_url || '';
    const nome = msg.arquivo_nome || 'Arquivo';
    // Para arquivos enviados pelo CRM: usa rota segura de download
    // Para arquivos recebidos via webhook: usa arquivo_url diretamente (é URL da Evolution/WA)
    const downloadUrl = url ? url : `/api/whatsapp/arquivos/${msg.id}/download`;
    const mime = msg.mime_type || '';
    const icone = mime === 'application/pdf' ? '📄'
      : mime.startsWith('image/') ? '🖼️'
      : mime.includes('word') || mime.includes('doc') ? '📝'
      : mime.includes('sheet') || mime.includes('excel') || mime.includes('xls') ? '📊'
      : mime.includes('presentation') || mime.includes('powerpoint') ? '📁'
      : '📎';
    conteudo = `<div class="wa-file-card">
       <div style="display:flex;align-items:center;gap:10px">
         <div class="wa-file-icon">
           <span style="font-size:1.2rem;line-height:1">${icone}</span>
         </div>
         <div style="flex:1;min-width:0">
           <p style="font-size:.78rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0" title="${escHtml(nome)}">${escHtml(nome)}</p>
           <p style="font-size:.67rem;color:var(--text-muted);margin:2px 0 0">Documento</p>
         </div>
         ${downloadUrl ? `<a href="${escHtml(downloadUrl)}" target="_blank" download="${escHtml(nome)}" class="wa-file-dl-btn" title="Baixar">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 13 7 8"/><line x1="12" y1="3" x2="12" y2="13"/></svg>
         </a>` : ''}
       </div>
       ${msg.mensagem && msg.mensagem !== nome ? `<div class="wa-bubble-text" style="margin-top:6px">${escHtml(msg.mensagem)}</div>` : ''}
     </div>`;
  }

  return `<div class="wa-msg ${dir}" data-id="${msg.id}" data-status="${msg.status || ''}">
    ${autorLabel}
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

  // ── Estado de loading ──────────────────────────────────────────────────────
  btn.disabled  = true;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"/></svg>`;
  input.disabled = true;

  // Log diagnóstico: payload enviado
  console.log('CRM_SEND_WHATSAPP_START', { conversaId: _convAtiva.id, leadId: _convAtiva.lead_id||null, phoneNorm: normalizePhone(_convAtiva.telefone) });
  console.log('CRM_SEND_WHATSAPP_CONVERSA_ID', _convAtiva.id);
  console.log('CRM_SEND_WHATSAPP_PHONE_NORMALIZED', normalizePhone(_convAtiva.telefone));
  console.log('FRONTEND_SEND_START', {
    conversaId:   _convAtiva.id,
    telefone:     _convAtiva.telefone,
    textoSlice:   txt.slice(0, 80),
    endpoint:     `/whatsapp/conversas/${_convAtiva.id}/mensagens`,
    payload:      { mensagem: txt, tipo: 'texto' },
  });

  let r = null;
  try {
    r = await Auth.api('POST', `/whatsapp/conversas/${_convAtiva.id}/mensagens`, {
      mensagem: txt, tipo: 'texto'
    });
  } catch (netErr) {
    // Erro de rede (fetch falhou, JSON malformado, etc.)
    console.error('FRONTEND_SEND_NETWORK_ERROR', netErr);
    r = null;
  }

  // ── Restaura controles SEMPRE (independente de sucesso ou erro) ────────────
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  input.disabled = false;
  input.focus();

  // Log diagnóstico: resposta completa
  const _hs = r?.status||(r===null?'NULL':'UNKNOWN');
  console.log('EVOLUTION_SEND_RESPONSE_STATUS', _hs, '| ok:', r?.ok, '| sucesso:', r?.data?.sucesso);
  if (r?.ok||r?.data?.sucesso) console.log('EVOLUTION_SEND_SUCCESS');
  else console.error('EVOLUTION_SEND_ERROR', r?.data?.erro||'sem resposta do servidor');
  console.log('FRONTEND_SEND_RESPONSE', {
    r_ok:     r?.ok,
    r_status: r?.status,
    r_data:   r?.data,
    r_null:   r === null,
  });

  // ── Determina sucesso ──────────────────────────────────────────────────────
  // Sucesso primário: HTTP 2xx (r.ok === true)
  // Sucesso fallback: r.data.sucesso === true (para casos onde HTTP errou mas backend confirmou)
  const httpOk    = r?.ok === true;
  const bodyOk    = r?.data?.sucesso === true;
  const isSuccess = httpOk || bodyOk;

  console.log('FRONTEND_SEND_SUCCESS_CHECK', { httpOk, bodyOk, isSuccess });

  if (isSuccess) {
    // ✅ Sucesso confirmado → limpa input, mostra mensagem, atualiza lista
    input.value = '';
    input.style.height = '';
    btn.disabled = true; // desabilita até novo texto ser digitado

    const msgReal = r?.data?.dados || {
      id: Date.now().toString(),
      conversa_id: _convAtiva.id,
      mensagem: txt,
      tipo: 'texto',
      direcao: 'enviada',
      status: 'enviado',
      criado_em: new Date().toISOString(),
    };
    _mensagens.push(msgReal);
    renderMensagens();

    // Atualiza preview na lista de conversas
    _conversas = _conversas.map(c =>
      c.id === _convAtiva.id
        ? { ...c, ultima_mensagem: txt, ultima_direcao: 'enviada', ultima_msg_em: new Date().toISOString() }
        : c
    );
    renderListaConversas();
    document.getElementById('conv-item-' + _convAtiva.id)?.classList.add('active');

    console.log('FRONTEND_SEND_OK — input limpo, mensagem renderizada');

  } else {
    // ❌ Falha real → mantém texto no input, exibe erro
    btn.disabled = false; // reabilita para nova tentativa
    const erroMsg = r?.data?.erro
      || (r === null ? 'Sem resposta do servidor. Verifique a conexão.' : 'Mensagem não enviada. Tente novamente.');

    console.error('FRONTEND_SEND_FAIL', {
      r_status: r?.status,
      r_data:   r?.data,
      erroMsg,
    });

    Toast.show(erroMsg, 'error');
    // Texto permanece no input — usuário pode tentar novamente
  }
}



// ─── Upload de arquivo (WhatsApp) ────────────────────────────────────────────
const WA_LIMITE_BYTES = 300 * 1024 * 1024; // 300 MB

const WA_EXT_BLOQUEADAS = new Set([
  'exe','bat','cmd','sh','bash','msi','scr','vbs','ps1','reg','lnk','jar','hta',
]);

function waExtPermitida(nome) {
  const ext = (nome.split('.').pop() || '').toLowerCase();
  return !WA_EXT_BLOQUEADAS.has(ext);
}

function waFmtBytes(b) {
  if (!b) return '–';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

async function waEnviarArquivo(file) {
  if (!_convAtiva) { Toast.show('Selecione uma conversa primeiro.', 'error'); return; }

  // Validações front-end
  if (!waExtPermitida(file.name)) {
    Toast.show('Tipo de arquivo não permitido por segurança.', 'error'); return;
  }
  if (file.size > WA_LIMITE_BYTES) {
    Toast.show('O arquivo excede o limite máximo de 300MB.', 'error'); return;
  }

  Toast.show(`Enviando "${file.name}" (${waFmtBytes(file.size)})...`, 'info');

  const formData = new FormData();
  formData.append('arquivo', file);

  const token = localStorage.getItem('token') || '';

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/whatsapp/conversas/${_convAtiva.id}/arquivos`, true);
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);

    // Progresso (não mostramos barra separada para não sobrepor o chat)
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        console.log('WA_UPLOAD_PROGRESS', pct + '%');
      }
    });

    xhr.addEventListener('load', () => {
      let json = {};
      try { json = JSON.parse(xhr.responseText); } catch {}

      if (xhr.status >= 200 && xhr.status < 300 && json.sucesso) {
        Toast.show(`"${file.name}" enviado!`, 'success');
        if (json.aviso) Toast.show(json.aviso, 'info');

        const msgData = json.dados || {
          id: Date.now().toString(), conversa_id: _convAtiva.id,
          mensagem: file.name,
          tipo: file.type.startsWith('image/') ? 'imagem' : file.type.startsWith('video/') ? 'video' : 'arquivo',
          arquivo_url: null, arquivo_nome: file.name, mime_type: file.type,
          direcao: 'enviada', status: 'enviado', criado_em: new Date().toISOString(),
        };
        _mensagens.push(msgData);
        renderMensagens();
        _conversas = _conversas.map(c => c.id === _convAtiva.id
          ? { ...c, ultima_mensagem: `📎 ${file.name}`, ultima_msg_em: new Date().toISOString() }
          : c);
        renderListaConversas();
        document.getElementById('conv-item-' + _convAtiva.id)?.classList.add('active');
      } else {
        const erro = json.erro || `Erro HTTP ${xhr.status}`;
        Toast.show(`Erro ao enviar "${file.name}": ${erro}`, 'error');
      }
      resolve();
    });

    xhr.addEventListener('error', () => {
      Toast.show('Erro de rede ao enviar o arquivo.', 'error');
      resolve();
    });

    xhr.send(formData);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('file-input')?.addEventListener('change', async function() {
    if (!this.files?.length) return;
    for (const f of Array.from(this.files)) {
      await waEnviarArquivo(f);
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
function scrollToBottom(smooth = false) {
  const el = document.getElementById('wa-messages');
  if (!el) return;
  // Usa requestAnimationFrame para garantir render antes de rolar
  requestAnimationFrame(() => {
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  });
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
  // ── Delegação de eventos para players de áudio — CSP bloqueia onclick inline ──
  // Único listener permanente no container de mensagens captura todos os cliques
  const msgContainer = document.getElementById('wa-messages');
  if (msgContainer) {
    msgContainer.addEventListener('click', (e) => {
      // Botão play/pause
      const playBtn = e.target.closest('.wa-audio-play-btn');
      if (playBtn && typeof WAAudio !== 'undefined') {
        WAAudio.toggle(playBtn);
        return;
      }
      // Barra de progresso (seek)
      const progressBar = e.target.closest('.wa-audio-progress');
      if (progressBar && typeof WAAudio !== 'undefined') {
        WAAudio.seek(progressBar, e);
        return;
      }
    });
  }
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

  sendBtn.addEventListener('click', () => {
    // Se estiver em modo preview de áudio: envia o blob gravado
    const recWrap = document.getElementById('wa-rec-wrap');
    const prevWrap = document.getElementById('wa-audio-preview');
    if (prevWrap && prevWrap.style.display === 'flex') {
      enviarAudio(_audioBlob);
    } else {
      enviarMensagem();
    }
  });

  // Botão microfone — toca/para gravação
  const micBtn = document.getElementById('btn-mic');
  if (micBtn) {
    micBtn.addEventListener('click', () => {
      if (_mediaRecorder && _mediaRecorder.state === 'recording') {
        pararGravacao();
      } else {
        iniciarGravacao();
      }
    });
  }

  // Cancelar gravação
  document.getElementById('btn-rec-cancel')?.addEventListener('click', cancelarGravacao);

  // Cancelar preview
  document.getElementById('btn-preview-cancel')?.addEventListener('click', cancelarGravacao);

  // Anexo de arquivo de áudio
  document.getElementById('audio-file-input')?.addEventListener('change', async function() {
    const file = this.files?.[0];
    if (!file || !_convAtiva) { this.value = ''; return; }
    if (!file.type.startsWith('audio/')) { Toast.show('Formato de áudio não suportado.', 'error'); this.value = ''; return; }
    if (file.size > 16 * 1024 * 1024) { Toast.show('Arquivo de áudio muito grande (máx 16 MB).', 'error'); this.value = ''; return; }
    _audioBlob = file;
    const url = URL.createObjectURL(file);
    const prevEl = document.getElementById('wa-audio-prev-el');
    if (prevEl) prevEl.src = url;
    _setRecUI('preview');
    this.value = '';
  });

  // Anexo de arquivo (imagem/video/doc) — btn-attach abre file-input
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

// ─── Áudio: player premium + gravador MediaRecorder ──────────────────────────

// Player global — uma instância por vez
const WAAudio = (() => {
  let _current = null; // { el: HTMLAudioElement, container: HTMLElement }

  function _stopAll() {
    if (_current) {
      _current.el.pause();
      const c = _current.container;
      c.querySelector('.ico-play')?.style && (c.querySelector('.ico-play').style.display  = '');
      c.querySelector('.ico-pause')?.style && (c.querySelector('.ico-pause').style.display = 'none');
      _current = null;
    }
  }

  function toggle(btn) {
    const container = btn.closest('.wa-audio-player');
    if (!container) return;
    if (_current && _current.container === container) { _stopAll(); return; }
    _stopAll();

    const src = container.dataset.src;
    if (!src) return;

    const audioEl = new Audio();
    const token = (typeof Auth !== 'undefined' && Auth.getToken)
      ? Auth.getToken()
      : (localStorage.getItem('token') || '');

    fetch(src, { headers: token ? { 'Authorization': 'Bearer ' + token } : {} })
      .then(r => {
        if (!r.ok) throw new Error('WA_AUDIO_PLAY_HTTP_' + r.status);
        return r.blob();
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        audioEl.src = blobUrl;
        console.log('WA_AUDIO_PLAY_BLOB_READY', { msgId: container.dataset.id, bytes: blob.size, type: blob.type });
        return audioEl.play();
      })
      .catch(err => {
        console.warn('WA_AUDIO_PLAY_FALLBACK', { src, err: err?.message });
        audioEl.src = src;
        audioEl.play().catch(() => { if (typeof Toast !== 'undefined') Toast.show('Erro ao reproduzir áudio.', 'error'); });
      });

    _current = { el: audioEl, container };

    const fillEl   = container.querySelector('.wa-audio-bar-fill');
    const timeEl   = container.querySelector('.wa-audio-time');
    const btnPlay  = btn.querySelector('.ico-play');
    const btnPause = btn.querySelector('.ico-pause');
    if (btnPlay)  btnPlay.style.display  = 'none';
    if (btnPause) btnPause.style.display = '';

    audioEl.addEventListener('timeupdate', () => {
      const pct = audioEl.duration ? (audioEl.currentTime / audioEl.duration) * 100 : 0;
      if (fillEl) fillEl.style.width = pct + '%';
      const s = Math.floor(audioEl.currentTime);
      if (timeEl) timeEl.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
    });
    audioEl.addEventListener('ended', () => { _stopAll(); if (fillEl) fillEl.style.width = '0'; });
  }

  function seek(progressEl, event) {
    if (!_current) return;
    const rect = progressEl.getBoundingClientRect();
    _current.el.currentTime = ((event.clientX - rect.left) / rect.width) * (_current.el.duration || 0);
  }

  return { toggle, seek };
})();

// ─── Gravador de áudio ────────────────────────────────────────────────────────
let _mediaRecorder = null;
let _audioChunks   = [];
let _audioBlob     = null;
let _timerInterval = null;
let _recSeconds    = 0;

function _setRecUI(modo) {
  // modo: 'idle' | 'recording' | 'preview'
  const textWrap = document.getElementById('wa-text-wrap');
  const recWrap  = document.getElementById('wa-rec-wrap');
  const prevWrap = document.getElementById('wa-audio-preview');
  const micBtn   = document.getElementById('btn-mic');
  const sendBtn  = document.getElementById('btn-send');

  if (textWrap) textWrap.style.display = modo === 'idle' ? '' : 'none';
  if (recWrap)  recWrap.style.display  = modo === 'recording' ? 'flex' : 'none';
  if (prevWrap) prevWrap.style.display = modo === 'preview'   ? 'flex' : 'none';
  if (micBtn)   micBtn.style.display   = modo === 'preview'   ? 'none' : '';

  if (sendBtn) sendBtn.disabled = (modo !== 'preview');
  if (sendBtn) {
    sendBtn.innerHTML = modo === 'preview'
      ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0D0D0D" stroke-width="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0D0D0D" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  }
}

async function iniciarGravacao() {
  if (!_convAtiva) { Toast.show('Selecione uma conversa primeiro.', 'error'); return; }
  if (!navigator.mediaDevices?.getUserMedia) {
    Toast.show('Seu navegador não suporta gravação de áudio.', 'error'); return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    Toast.show(
      e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError'
        ? 'Permita o acesso ao microfone para gravar áudio.'
        : 'Não foi possível acessar o microfone.',
      'error'
    );
    return;
  }

  console.log('WHATSAPP_AUDIO_RECORD_START');
  _audioChunks = [];
  _audioBlob   = null;
  _recSeconds  = 0;

  const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
    : 'audio/webm';

  _mediaRecorder = new MediaRecorder(stream, { mimeType });
  _mediaRecorder.ondataavailable = e => { if (e.data.size > 0) _audioChunks.push(e.data); };
  _mediaRecorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    _audioBlob = new Blob(_audioChunks, { type: mimeType });
    const prevEl = document.getElementById('wa-audio-prev-el');
    if (prevEl) prevEl.src = URL.createObjectURL(_audioBlob);
    _setRecUI('preview');
    console.log('WHATSAPP_AUDIO_RECORD_STOP', { duration: _recSeconds, mimeType });
  };
  _mediaRecorder.start(100);
  _setRecUI('recording');

  const timerEl = document.getElementById('wa-rec-timer');
  _timerInterval = setInterval(() => {
    _recSeconds++;
    if (timerEl) timerEl.textContent = `${Math.floor(_recSeconds/60)}:${String(_recSeconds%60).padStart(2,'0')}`;
    if (_recSeconds >= 300) pararGravacao();
  }, 1000);
}

function pararGravacao() {
  clearInterval(_timerInterval);
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
}

function cancelarGravacao() {
  clearInterval(_timerInterval);
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
    try { _mediaRecorder.stream?.getTracks().forEach(t => t.stop()); } catch {}
    _mediaRecorder.stop();
  }
  _audioBlob   = null;
  _audioChunks = [];
  _setRecUI('idle');
  const msgInput = document.getElementById('msg-input');
  if (msgInput) msgInput.value = '';
  const sendBtn = document.getElementById('btn-send');
  if (sendBtn) sendBtn.disabled = true;
}

async function enviarAudio(blob) {
  if (!_convAtiva || !blob) return;
  console.log('WHATSAPP_AUDIO_SEND_START', { conversaId: _convAtiva.id });

  const sendBtn = document.getElementById('btn-send');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D0D0D" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-dasharray="31.4" stroke-dashoffset="10"/></svg>`;
  }

  const base64 = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onloadend = () => res(reader.result);
    reader.onerror   = rej;
    reader.readAsDataURL(blob);
  });

  console.log('WHATSAPP_AUDIO_SEND_PAYLOAD_SAFE', { base64Length: base64.length });

  let r = null;
  try {
    r = await Auth.api('POST', `/whatsapp/conversas/${_convAtiva.id}/mensagens`, {
      mensagem: null, tipo: 'audio',
      arquivo_url: base64, arquivo_nome: 'audio.ogg',
    });
  } catch (e) { console.error('WHATSAPP_AUDIO_SEND_ERROR', e); }

  console.log('WHATSAPP_AUDIO_SEND_RESPONSE_STATUS', r?.status || 'null');

  if (r?.ok || r?.data?.sucesso) {
    console.log('WHATSAPP_AUDIO_SEND_SUCCESS');
    Toast.show('Áudio enviado!', 'success');
    const msgReal = r?.data?.dados || {
      id: Date.now().toString(), conversa_id: _convAtiva.id,
      mensagem: 'Áudio', tipo: 'audio', direcao: 'enviada',
      status: 'enviado', criado_em: new Date().toISOString(),
    };
    _mensagens.push(msgReal);
    renderMensagens();
    _conversas = _conversas.map(c => c.id === _convAtiva.id
      ? { ...c, ultima_mensagem: 'Áudio 🎤', ultima_direcao: 'enviada', ultima_msg_em: new Date().toISOString() }
      : c);
    renderListaConversas();
    document.getElementById('conv-item-' + _convAtiva.id)?.classList.add('active');
  } else {
    const err = r?.data?.erro || 'Não foi possível enviar o áudio.';
    console.error('WHATSAPP_AUDIO_SEND_ERROR', err);
    Toast.show(err, 'error');
  }

  cancelarGravacao();
}

// ─── Kick-off ─────────────────────────────────────────────────────────────────
init();
