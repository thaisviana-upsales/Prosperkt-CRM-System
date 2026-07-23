/**
 * PROSPEKT CRM — Emoji Picker Premium v1
 * Painel de emojis para a tela de Conversas / WhatsApp
 * Sem dependências externas | localStorage para recentes
 */
(function () {

  // ── Dataset de emojis ───────────────────────────────────────────────────────
  const EMOJI_DATA = [
    {
      cat: 'Recentes', id: 'recentes', icon: '🕐',
      emojis: []
    },
    {
      cat: 'Rostos', id: 'rostos', icon: '😊',
      emojis: ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘',
               '🤔','🤨','😐','😶','🙄','😏','😒','😞','😔','😟','😕','🙁','😣','😖',
               '😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨',
               '😰','😥','😓','🤗','🤭','🤫','🤥','😬','🙃','🥴','😵','🤑','🤠','😇']
    },
    {
      cat: 'Gestos', id: 'gestos', icon: '👍',
      emojis: ['👍','👎','👏','🙌','🤲','🤝','🙏','✌️','🤞','🤟','🤘','🤙','👈','👉',
               '👆','👇','☝️','👋','🤚','🖐','✋','🖖','💪','🤜','🤛','✍️','💅','🫶']
    },
    {
      cat: 'Atendimento', id: 'atendimento', icon: '✅',
      emojis: ['✅','❌','⭕','🔴','🟡','🟢','🔵','⚠️','❗','❓','ℹ️','💬','📲','📞','☎️',
               '📝','📋','📌','📍','📎','🗂','📁','📂','📊','📈','📉','📃','📄','📑',
               '📧','📨','📩','📬','📭','📮','🗓','📅','⏰','⏱','⏲','🕐','🕑','🕒']
    },
    {
      cat: 'Comercial', id: 'comercial', icon: '💰',
      emojis: ['💰','💵','💴','💶','💷','💸','💳','🏧','💹','📦','🛒','🛍','🏷','🎁',
               '🤑','💎','👑','🏆','🥇','🎯','🏪','🏬','🏭','🏢','🏦','🚀','✈️','🚁',
               '🚢','🚗','🏎','🛄','🎪','🎉','🎊','🎈','🎀','🪄','🏅','🌟']
    },
    {
      cat: 'Símbolos', id: 'simbolos', icon: '⭐',
      emojis: ['⭐','🌟','✨','💫','🔥','💥','❄️','🌈','☀️','🌤','⛅','☁️','🌧','⛈','🌩',
               '🌨','🌪','🌊','💧','💦','☔','⚡','🌍','🌎','🌏','🌙','⚙️','🔧','🔨',
               '🔑','🗝','🔒','🔓','🛡','⚔️','🪝','📡','🔭','🔬','💡','🔦','🕯']
    },
    {
      cat: 'Corações', id: 'coracoes', icon: '❤️',
      emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓',
               '💗','💖','💘','💝','💟','♥️','💏','💑','🫀','😻','💌','🫶','💝','💋']
    }
  ];

  const RECENT_KEY = 'wa_emoji_recentes_v1';
  const MAX_RECENT = 16;

  const EMOJI_NAMES = {
    '😀':'rindo alegre','😁':'sorrindo','😂':'chorando rindo','🤣':'rolando chão rindo','😃':'sorriso',
    '😄':'alegre','😅':'suado nervoso','😆':'gargalhada','😉':'piscando','😊':'feliz contente',
    '😋':'delicia gostoso','😎':'cool estilo','😍':'amando','🥰':'apaixonado','😘':'beijo kiss',
    '🤔':'pensando duvida','🙄':'revirando olhos','😏':'malicioso','😒':'desanimado',
    '😞':'triste','😭':'chorando','😤':'irritado','😡':'furioso bravo','🤯':'chocado',
    '😱':'assustado','😨':'com medo','🤗':'abraco','✅':'check certo ok confirmado',
    '❌':'errado x nao cancelar','⚠️':'aviso alerta cuidado','📲':'celular mensagem',
    '📞':'telefone ligar chamar','💬':'conversa chat mensagem','📝':'nota escrever anotar',
    '📌':'alfinete fixar importante','📦':'caixa produto entrega envio','🛒':'carrinho compra',
    '💰':'dinheiro pagamento grana','💳':'cartao credito pagamento','📅':'calendario data agenda',
    '⏰':'alarme tempo hora','🚀':'foguete rapido urgente','⭐':'estrela destaque favorito',
    '🔥':'fogo incrivel top quente','💎':'diamante premium luxo','🏆':'trofeu vitoria campeao',
    '🎯':'alvo meta objetivo acertar','👍':'positivo ok bom aprovado','👎':'negativo nao ruim',
    '👏':'palmas parabens muito bom','🙏':'obrigado rezando por favor','🤝':'aperto mao acordo',
    '💪':'forte forca musculo','❤️':'coracao amor vermelho','💚':'coracao verde','💙':'coracao azul',
    '👋':'oi tchau ola bom dia','✨':'brilhante especial magico','💫':'estrela girar especial',
    '🎉':'celebrar parabens festa','🎊':'comemoracao festa','🏅':'medalha conquista',
    '🔑':'chave acesso','💡':'ideia luz iluminacao','📡':'sinal antena transmissao',
    '☀️':'sol dia bom dia','🌈':'arco iris alegria','💧':'gota agua','❗':'exclamacao importante',
    '❓':'pergunta duvida','ℹ️':'informacao','📊':'grafico dados relatorio','📈':'crescimento alta',
    '📉':'queda baixa','🎁':'presente brinde','🏷':'etiqueta preco','👑':'coroa rei realeza',
    '🥇':'primeiro ouro melhor','🤑':'dinheiro ganhar rico','💌':'carta amor mensagem especial',
    '😇':'anjinho bom','🤠':'cowboy estilo','🥴':'tonto confuso'
  };

  // ── State ───────────────────────────────────────────────────────────────────
  let _panelEl  = null;
  let _aberto   = false;
  let _catAtiva = 'rostos';
  let _buscaVal = '';

  // ── Recentes ────────────────────────────────────────────────────────────────
  function carregarRecentes() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
    catch(_) { return []; }
  }
  function salvarRecentes(arr) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(arr.slice(0, MAX_RECENT))); }
    catch(_) {}
  }
  function adicionarRecente(emoji) {
    const r = carregarRecentes().filter(e => e !== emoji);
    r.unshift(emoji);
    salvarRecentes(r);
    EMOJI_DATA[0].emojis = r;
    if (_catAtiva === 'recentes') renderEmojis();
  }

  // ── Criação do painel ───────────────────────────────────────────────────────
  function criarPainel() {
    const el = document.createElement('div');
    el.id = 'wa-emoji-picker';
    el.innerHTML = `
      <div class="ep-header">
        <div class="ep-search-wrap">
          <svg class="ep-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="ep-search" id="ep-busca" placeholder="Buscar emoji..." autocomplete="off" spellcheck="false">
        </div>
        <button class="ep-close" id="ep-close" title="Fechar">✕</button>
      </div>
      <div class="ep-cats" id="ep-cats"></div>
      <div class="ep-grid" id="ep-grid"></div>
    `;
    document.body.appendChild(el);
    return el;
  }

  // ── Render categorias ───────────────────────────────────────────────────────
  function renderCats() {
    const el = document.getElementById('ep-cats');
    if (!el) return;
    el.innerHTML = EMOJI_DATA.map(c => `
      <button class="ep-cat-btn${_catAtiva === c.id ? ' active' : ''}"
              data-cat="${c.id}" title="${c.cat}">${c.icon}</button>
    `).join('');
    el.querySelectorAll('.ep-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _catAtiva = btn.dataset.cat;
        _buscaVal = '';
        const busca = document.getElementById('ep-busca');
        if (busca) busca.value = '';
        renderCats();
        renderEmojis();
      });
    });
  }

  // ── Render emojis ───────────────────────────────────────────────────────────
  function renderEmojis() {
    const el = document.getElementById('ep-grid');
    if (!el) return;

    let lista;
    if (_buscaVal.length >= 1) {
      const q = _buscaVal.toLowerCase();
      lista = [];
      const seen = new Set();
      EMOJI_DATA.forEach(c => {
        if (c.id === 'recentes') return;
        c.emojis.forEach(e => {
          if (seen.has(e)) return;
          const nome = (EMOJI_NAMES[e] || '').toLowerCase();
          if (nome.includes(q) || e.includes(q)) { lista.push(e); seen.add(e); }
        });
      });
    } else if (_catAtiva === 'recentes') {
      const r = carregarRecentes();
      lista = r.length ? r : ['😊','👍','✅','🙏','👋','🤝','🚀','💬','📌','📲'];
    } else {
      const cat = EMOJI_DATA.find(c => c.id === _catAtiva);
      lista = cat ? [...cat.emojis] : [];
    }

    if (!lista.length) {
      el.innerHTML = '<div class="ep-empty">Nenhum emoji encontrado</div>';
      return;
    }

    el.innerHTML = lista.map(e =>
      `<button class="ep-emoji" data-emoji="${e}" title="${EMOJI_NAMES[e] || ''}">${e}</button>`
    ).join('');
    el.querySelectorAll('.ep-emoji').forEach(btn => {
      btn.addEventListener('click', () => inserirEmoji(btn.dataset.emoji));
    });
  }

  // ── Inserção no cursor ──────────────────────────────────────────────────────
  function inserirEmoji(emoji) {
    const ta = document.getElementById('msg-input');
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const v = ta.value;
    ta.value = v.slice(0, s) + emoji + v.slice(e);
    const pos = s + emoji.length;
    ta.selectionStart = pos;
    ta.selectionEnd   = pos;
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    adicionarRecente(emoji);
  }

  // ── Posicionamento ──────────────────────────────────────────────────────────
  function posicionarPainel(btnEl) {
    const panel = document.getElementById('wa-emoji-picker');
    if (!panel || !btnEl) return;

    const btn = btnEl.getBoundingClientRect();
    panel.style.visibility = 'hidden';
    panel.style.display    = 'flex';

    const pw = panel.offsetWidth  || 320;
    const ph = panel.offsetHeight || 380;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = btn.left;
    let top  = btn.top - ph - 8;

    // Ajuste horizontal
    if (left + pw > vw - 12) left = vw - pw - 12;
    if (left < 12) left = 12;
    // Se não couber acima, coloca abaixo
    if (top < 8) top = btn.bottom + 8;
    // Garante que não sai da tela abaixo
    if (top + ph > vh - 8) top = vh - ph - 8;

    panel.style.left       = left + 'px';
    panel.style.top        = top  + 'px';
    panel.style.visibility = 'visible';
  }

  // ── Abrir / Fechar ──────────────────────────────────────────────────────────
  function abrirPicker(btnEl) {
    EMOJI_DATA[0].emojis = carregarRecentes();

    if (!_panelEl) {
      _panelEl = criarPainel();

      document.getElementById('ep-busca').addEventListener('input', e => {
        _buscaVal = e.target.value.trim();
        renderEmojis();
      });
      document.getElementById('ep-busca').addEventListener('keydown', e => {
        if (e.key === 'Escape') fecharPicker();
      });
      document.getElementById('ep-close').addEventListener('click', fecharPicker);
    }

    renderCats();
    renderEmojis();
    posicionarPainel(btnEl);
    _panelEl.classList.add('open');
    _aberto = true;
    btnEl.classList.add('active');
  }

  function fecharPicker() {
    if (_panelEl) _panelEl.classList.remove('open');
    _aberto = false;
    const btn = document.querySelector('.wa-emoji-btn');
    if (btn) btn.classList.remove('active');
  }

  // ── Bind ────────────────────────────────────────────────────────────────────
  function init() {
    const btn = document.querySelector('.wa-emoji-btn');
    if (!btn) return;

    btn.id = 'wa-emoji-btn-main';

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (_aberto) fecharPicker();
      else abrirPicker(btn);
    });

    // Fechar ao clicar fora
    document.addEventListener('click', e => {
      if (!_aberto) return;
      const panel = document.getElementById('wa-emoji-picker');
      if (panel && panel.contains(e.target)) return;
      if (e.target.closest('.wa-emoji-btn') || e.target.id === 'wa-emoji-btn-main') return;
      fecharPicker();
    });

    // Fechar com ESC
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _aberto) fecharPicker();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
