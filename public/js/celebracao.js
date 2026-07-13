/**
 * PROSPEKT CRM — celebracao.js
 * Animações de vitória: fogos, sino, cartão de débito, chuva de dinheiro.
 * Puro JS/CSS nativo — sem dependências externas.
 */

// ═══════════════════════════════════════════════════════════════════
// FEATURE 1 — Celebração de Venda (Pipeline)
// ═══════════════════════════════════════════════════════════════════

/**
 * Dispara a celebração completa ao fechar uma venda.
 * @param {string} nomeCliente
 * @param {number} valorVenda
 */
function celebrarVenda(nomeCliente, valorVenda) {
  try {
    _dispararFogos();
    _tocarSino();
    _exibirOverlayVitoria(nomeCliente, valorVenda);
  } catch(e) {
    console.warn('[celebracao] erro silencioso:', e);
  }
}

/* Fogos via Canvas 2D */
function _dispararFogos() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = [
    'position:fixed','inset:0','width:100%','height:100%',
    'pointer-events:none','z-index:99999','display:block'
  ].join(';');
  document.body.appendChild(canvas);
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const CORES = ['#5BDE3E','#F5A623','#E10098','#3B8BFF','#FFD700','#FF6B6B','#fff'];
  const particulas = [];
  const QTD = 90;

  for (let i = 0; i < QTD; i++) {
    particulas.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * 0.5,
      vx: (Math.random() - 0.5) * 8,
      vy: Math.random() * -6 - 3,
      cor: CORES[Math.floor(Math.random() * CORES.length)],
      raio: Math.random() * 4 + 2,
      vida: 1,
      forma: Math.random() > 0.5 ? 'circulo' : 'rect',
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.3,
    });
  }

  let inicio = null;
  const DURACAO = 3200;

  function animar(ts) {
    if (!inicio) inicio = ts;
    const prog = (ts - inicio) / DURACAO;
    if (prog >= 1) { canvas.remove(); return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particulas.forEach(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.18; // gravidade
      p.vx *= 0.99;
      p.rot += p.rotV;
      p.vida = Math.max(0, 1 - prog * 1.4);

      ctx.save();
      ctx.globalAlpha = p.vida;
      ctx.fillStyle = p.cor;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);

      if (p.forma === 'circulo') {
        ctx.beginPath();
        ctx.arc(0, 0, p.raio, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.raio, -p.raio * 0.4, p.raio * 2, p.raio * 0.8);
      }
      ctx.restore();
    });

    requestAnimationFrame(animar);
  }
  requestAnimationFrame(animar);
}

/* Sino com Web Audio API */
function _tocarSino() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const notas = [523.25, 659.25, 783.99, 1046.5]; // Dó-Mi-Sol-Dó oitava
    notas.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.start(t);
      osc.stop(t + 0.6);
    });
    setTimeout(() => ctx.close(), 3000);
  } catch(e) { /* silencioso */ }
}

/* Overlay de vitória */
function _exibirOverlayVitoria(nome, valor) {
  // Evita duplicata
  document.getElementById('overlay-vitoria')?.remove();

  const valorFmt = valor > 0
    ? 'R$ ' + Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
    : '';

  const ov = document.createElement('div');
  ov.id = 'overlay-vitoria';
  ov.style.cssText = [
    'position:fixed','top:50%','left:50%',
    'transform:translate(-50%,-50%) scale(0.7)',
    'z-index:99998',
    'background:linear-gradient(135deg,rgba(13,13,13,.97) 0%,rgba(20,30,20,.97) 100%)',
    'border:1px solid rgba(91,222,62,.4)',
    'border-radius:24px','padding:32px 44px',
    'text-align:center','max-width:380px','width:90vw',
    'box-shadow:0 0 60px rgba(91,222,62,.25), 0 24px 80px rgba(0,0,0,.6)',
    'backdrop-filter:blur(18px)',
    'transition:transform .4s cubic-bezier(.16,1,.3,1), opacity .4s ease',
    'opacity:0',
  ].join(';');

  ov.innerHTML = `
    <div style="font-size:2.8rem;margin-bottom:10px;line-height:1">🏆</div>
    <div style="font-size:1.05rem;font-weight:800;color:#fff;margin-bottom:6px;letter-spacing:.01em">
      VENDA FECHADA!
    </div>
    ${nome ? `<div style="font-size:.88rem;color:rgba(245,245,245,.7);margin-bottom:${valorFmt?'10':'0'}px">${_esc(nome)}</div>` : ''}
    ${valorFmt ? `<div style="font-size:1.6rem;font-weight:800;color:#5BDE3E;letter-spacing:-.02em;text-shadow:0 0 20px rgba(91,222,62,.5)">${valorFmt}</div>` : ''}
    <div style="margin-top:14px;font-size:.7rem;color:rgba(245,245,245,.3);letter-spacing:.1em;text-transform:uppercase">PROSPEKT CRM</div>
  `;

  document.body.appendChild(ov);

  // Anima entrada
  requestAnimationFrame(() => {
    ov.style.opacity = '1';
    ov.style.transform = 'translate(-50%,-50%) scale(1)';
  });

  // Auto-fecha em 2.8s
  setTimeout(() => {
    ov.style.opacity = '0';
    ov.style.transform = 'translate(-50%,-50%) scale(0.85)';
    setTimeout(() => ov.remove(), 400);
  }, 2800);

  // Clique fecha
  ov.addEventListener('click', () => {
    ov.style.opacity = '0';
    setTimeout(() => ov.remove(), 300);
  });
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE 2 — Chuva de Dinheiro (Comissões)
// ═══════════════════════════════════════════════════════════════════

const _STORAGE_KEY_COMISSAO = 'prospekt_last_total_receber';

/**
 * Chama ao renderizar o painel de comissões.
 * Dispara chuva se o valor aumentou.
 * @param {number} totalReceber
 */
function animarDinheiro(totalReceber) {
  try {
    const ultimo = parseFloat(localStorage.getItem(_STORAGE_KEY_COMISSAO) || '0');
    if (totalReceber > ultimo && ultimo >= 0) {
      _chuvaNotas();
    }
    localStorage.setItem(_STORAGE_KEY_COMISSAO, String(totalReceber));
  } catch(e) { /* silencioso */ }
}

function _chuvaNotas() {
  const EMOJIS = ['💵','💵','💴','💰','💎','🤑','💵','💸','💵'];
  const QTD = 18;
  const frag = document.createDocumentFragment();
  const holders = [];

  for (let i = 0; i < QTD; i++) {
    const el = document.createElement('div');
    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    const left  = Math.random() * 95;
    const delay = Math.random() * 1.4;
    const dur   = 1.6 + Math.random() * 1.2;
    const size  = 1.2 + Math.random() * 1.4;
    const rot   = (Math.random() - 0.5) * 40;

    el.textContent = emoji;
    el.style.cssText = [
      'position:fixed',
      `left:${left}vw`,
      'top:-60px',
      'z-index:99997',
      `font-size:${size}rem`,
      'pointer-events:none',
      'user-select:none',
      `animation:chuvaQueda ${dur}s ${delay}s ease-in forwards`,
      `transform:rotate(${rot}deg)`,
    ].join(';');
    frag.appendChild(el);
    holders.push(el);
  }

  // Injeta keyframe se não existe
  if (!document.getElementById('kf-chuva')) {
    const style = document.createElement('style');
    style.id = 'kf-chuva';
    style.textContent = `
      @keyframes chuvaQueda {
        0%   { transform: translateY(0) rotate(0deg); opacity:1; }
        80%  { opacity: 1; }
        100% { transform: translateY(110vh) rotate(360deg); opacity:0; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(frag);
  // Remove após animação máxima (delay 1.4 + dur 2.8 + margem)
  setTimeout(() => holders.forEach(el => el.remove()), 5000);
}

// ═══════════════════════════════════════════════════════════════════
// FEATURE 3 — Cartão de Débito PROSPEKT (Comissões)
// ═══════════════════════════════════════════════════════════════════

let _cardValorAtual = 0;
let _cardAnimTimer  = null;

/**
 * Inicializa o cartão na página de comissões.
 * Chame uma vez no init().
 * @param {string} nomeVendedor
 */
function inicializarCartao(nomeVendedor) {
  if (document.getElementById('prospekt-card-wrap')) return;

  // Injeta CSS do cartão
  if (!document.getElementById('css-card-prospekt')) {
    const s = document.createElement('style');
    s.id = 'css-card-prospekt';
    s.textContent = `
      #prospekt-card-wrap {
        display: flex;
        justify-content: center;
        margin: 0 0 24px 0;
        perspective: 1000px;
      }
      .pkt-card {
        width: 360px;
        height: 216px;
        border-radius: 20px;
        background: linear-gradient(135deg, #0a0f1a 0%, #0d1f0d 40%, #0a150a 100%);
        border: 1px solid rgba(91,222,62,.25);
        box-shadow:
          0 8px 40px rgba(0,0,0,.7),
          0 0 0 1px rgba(91,222,62,.08) inset,
          0 1px 0 rgba(255,255,255,.06) inset;
        padding: 22px 26px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        position: relative;
        overflow: hidden;
        cursor: default;
        transition: transform .4s cubic-bezier(.16,1,.3,1), box-shadow .4s ease;
        transform-style: preserve-3d;
        user-select: none;
      }
      .pkt-card:hover {
        box-shadow:
          0 16px 60px rgba(0,0,0,.75),
          0 0 0 1px rgba(91,222,62,.2) inset,
          0 0 40px rgba(91,222,62,.08);
      }
      /* Brilho holográfico */
      .pkt-card::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 20px;
        background: radial-gradient(ellipse 80% 60% at var(--mx,50%) var(--my,30%),
          rgba(91,222,62,.12) 0%, transparent 65%);
        pointer-events: none;
        transition: background .1s;
      }
      /* Linha de brilho diagonal */
      .pkt-card::after {
        content: '';
        position: absolute;
        top: -60%;
        left: -60%;
        width: 50%;
        height: 220%;
        background: linear-gradient(105deg,
          transparent 40%,
          rgba(255,255,255,.04) 50%,
          transparent 60%);
        pointer-events: none;
        transition: left 0.6s ease, top 0.6s ease;
      }
      .pkt-card:hover::after {
        left: 120%;
      }
      .pkt-card-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .pkt-logo-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .pkt-logo-icon {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: linear-gradient(135deg,#1a3a4a,#2d6a4f);
        border: 1px solid rgba(91,222,62,.3);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 12px rgba(91,222,62,.2);
      }
      .pkt-logo-text {
        font-size: .75rem;
        font-weight: 900;
        letter-spacing: .12em;
        color: rgba(245,245,245,.9);
        text-transform: uppercase;
      }
      .pkt-logo-sub {
        font-size: .52rem;
        color: rgba(91,222,62,.7);
        letter-spacing: .1em;
        font-weight: 600;
        margin-top: -2px;
      }
      .pkt-chip {
        width: 38px;
        height: 28px;
        border-radius: 6px;
        background: linear-gradient(135deg,#d4a843,#f5c842,#b8860b,#f5c842);
        box-shadow: 0 1px 4px rgba(0,0,0,.5);
        position: relative;
        overflow: hidden;
      }
      .pkt-chip::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 1px;
        background: rgba(0,0,0,.2);
        transform: translateY(-50%);
      }
      .pkt-chip::after {
        content: '';
        position: absolute;
        left: 50%;
        top: 0;
        bottom: 0;
        width: 1px;
        background: rgba(0,0,0,.2);
        transform: translateX(-50%);
      }
      .pkt-card-mid {
        margin-top: 4px;
      }
      .pkt-valor-label {
        font-size: .52rem;
        font-weight: 700;
        color: rgba(91,222,62,.6);
        letter-spacing: .15em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .pkt-valor {
        font-size: 1.6rem;
        font-weight: 800;
        color: #5BDE3E;
        letter-spacing: -.02em;
        text-shadow: 0 0 20px rgba(91,222,62,.4);
        transition: color .2s;
        min-height: 40px;
        display: flex;
        align-items: center;
      }
      .pkt-valor.atualizando {
        color: #F5A623;
        text-shadow: 0 0 24px rgba(245,166,35,.5);
      }
      .pkt-card-bot {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
      }
      .pkt-numero {
        font-size: .7rem;
        font-weight: 600;
        color: rgba(245,245,245,.35);
        letter-spacing: .18em;
        font-family: 'Courier New', monospace;
      }
      .pkt-titular {
        text-align: right;
      }
      .pkt-nome {
        font-size: .68rem;
        font-weight: 700;
        color: rgba(245,245,245,.7);
        text-transform: uppercase;
        letter-spacing: .08em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 160px;
      }
      .pkt-validade {
        font-size: .58rem;
        color: rgba(245,245,245,.3);
        margin-top: 2px;
      }
      /* Flash de atualização */
      @keyframes pktFlash {
        0%   { box-shadow: 0 8px 40px rgba(0,0,0,.7), 0 0 0 2px rgba(245,166,35,.8); }
        50%  { box-shadow: 0 8px 40px rgba(0,0,0,.7), 0 0 0 4px rgba(245,166,35,.4), 0 0 40px rgba(245,166,35,.2); }
        100% { box-shadow: 0 8px 40px rgba(0,0,0,.7), 0 0 0 1px rgba(91,222,62,.08) inset; }
      }
      .pkt-card.flash { animation: pktFlash .8s ease; }
    `;
    document.head.appendChild(s);
  }

  const wrap = document.createElement('div');
  wrap.id = 'prospekt-card-wrap';
  wrap.innerHTML = `
    <div class="pkt-card" id="prospekt-card">
      <div class="pkt-card-top">
        <div class="pkt-logo-row">
          <div class="pkt-logo-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5BDE3E" stroke-width="2.5">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>
            </svg>
          </div>
          <div>
            <div class="pkt-logo-text">PROSPEKT</div>
            <div class="pkt-logo-sub">CRM Enterprise</div>
          </div>
        </div>
        <div class="pkt-chip"></div>
      </div>
      <div class="pkt-card-mid">
        <div class="pkt-valor-label">Total a Receber</div>
        <div class="pkt-valor" id="pkt-valor-display">R$ 0,00</div>
      </div>
      <div class="pkt-card-bot">
        <div class="pkt-numero">PROSP **** **** 2024</div>
        <div class="pkt-titular">
          <div class="pkt-nome" id="pkt-nome">${_esc((nomeVendedor||'VENDEDOR').substring(0,22).toUpperCase())}</div>
          <div class="pkt-validade">VÁLIDO ATÉ 01/2030</div>
        </div>
      </div>
    </div>
  `;

  // Insere antes do summary-bar
  const ref = document.getElementById('summary-bar');
  if (ref && ref.parentNode) {
    ref.parentNode.insertBefore(wrap, ref);
  }

  // Efeito holográfico via mousemove
  const card = document.getElementById('prospekt-card');
  if (card) {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width * 100).toFixed(1);
      const my = ((e.clientY - r.top)  / r.height * 100).toFixed(1);
      card.style.setProperty('--mx', mx + '%');
      card.style.setProperty('--my', my + '%');
      const rotX = ((e.clientY - r.top  - r.height / 2) / r.height * -8).toFixed(2);
      const rotY = ((e.clientX - r.left - r.width  / 2) / r.width  *  8).toFixed(2);
      card.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.setProperty('--mx', '50%');
      card.style.setProperty('--my', '30%');
    });
  }
}

/**
 * Atualiza o valor no cartão com animação count-up.
 * @param {number} novoValor
 */
function atualizarCartao(novoValor) {
  const display = document.getElementById('pkt-valor-display');
  const card    = document.getElementById('prospekt-card');
  if (!display) return;

  const valorAnterior = _cardValorAtual;
  _cardValorAtual = novoValor;

  if (_cardAnimTimer) { clearInterval(_cardAnimTimer); _cardAnimTimer = null; }

  // Flash no cartão se valor mudou
  if (novoValor !== valorAnterior && card) {
    card.classList.remove('flash');
    void card.offsetWidth; // força reflow
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 900);
    display.classList.add('atualizando');
    setTimeout(() => display.classList.remove('atualizando'), 800);
  }

  // Count-up animation (60 steps em 800ms)
  const STEPS    = 60;
  const INTERVAL = 800 / STEPS;
  const diff     = novoValor - valorAnterior;
  let step = 0;

  _cardAnimTimer = setInterval(() => {
    step++;
    const eased = _easeOut(step / STEPS);
    const atual = valorAnterior + diff * eased;
    display.textContent = 'R$ ' + atual.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (step >= STEPS) {
      clearInterval(_cardAnimTimer);
      _cardAnimTimer = null;
      display.textContent = 'R$ ' + novoValor.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
  }, INTERVAL);
}

// Easing easeOutCubic
function _easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// Escape HTML
function _esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Expõe globalmente
window.celebrarVenda    = celebrarVenda;
window.animarDinheiro   = animarDinheiro;
window.inicializarCartao = inicializarCartao;
window.atualizarCartao  = atualizarCartao;
