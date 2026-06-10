/**
 * PROSPEKT CRM — Mobile Navigation
 * Bottom navigation bar + mobile header para experiência de app no celular.
 * Desktop continua usando sidebar existente sem alterações.
 */
(function() {
  'use strict';

  const MOBILE_MAX = 768;
  const isMobile = () => window.innerWidth <= MOBILE_MAX;

  // Mapa de páginas → item ativo do bottom nav
  const PAGE_MAP = {
    'dashboard.html':            'dashboard',
    'pipeline.html':             'pipeline',
    'whatsapp.html':             'conversas',
    'metas.html':                'metas',
    'comissoes.html':            'menu',
    'usuarios.html':             'menu',
    'mensagens-padrao.html':     'menu',
    'automacoes.html':           'menu',
    'funis.html':                'menu',
    'integracao-whatsapp.html':  'menu',
    'logs.html':                 'menu',
  };

  function getActivePage() {
    const path = window.location.pathname.split('/').pop() || 'dashboard.html';
    return PAGE_MAP[path] || 'menu';
  }

  // ── Bottom Navigation ───────────────────────────────────────────────────────
  function criarBottomNav() {
    if (document.getElementById('mobile-bottom-nav')) return;
    const active = getActivePage();
    const nav = document.createElement('nav');
    nav.id = 'mobile-bottom-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Navegação principal');
    nav.innerHTML = `
      <a href="/dashboard.html" class="mbn-item ${active==='dashboard'?'active':''}" id="mbn-dashboard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span>Dashboard</span>
      </a>
      <a href="/pipeline.html" class="mbn-item ${active==='pipeline'?'active':''}" id="mbn-pipeline">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M3 12h18M3 18h18"/>
        </svg>
        <span>Pipeline</span>
      </a>
      <a href="/whatsapp.html" class="mbn-item ${active==='conversas'?'active':''}" id="mbn-conversas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span>Conversas</span>
      </a>
      <a href="/metas.html" class="mbn-item ${active==='metas'?'active':''}" id="mbn-metas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
        </svg>
        <span>Metas</span>
      </a>
      <button class="mbn-item ${active==='menu'?'active':''}" id="mbn-menu-btn" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
        <span>Menu</span>
      </button>
    `;
    document.body.appendChild(nav);

    // Botão menu abre bottom sheet
    document.getElementById('mbn-menu-btn').addEventListener('click', () => {
      toggleMenuSheet();
    });
  }

  // ── Menu Sheet (bottom sheet do botão Menu) ─────────────────────────────────
  function criarMenuSheet() {
    if (document.getElementById('mobile-menu-sheet')) return;

    const overlay = document.createElement('div');
    overlay.id = 'mobile-menu-overlay';
    overlay.onclick = fecharMenuSheet;

    const sheet = document.createElement('div');
    sheet.id = 'mobile-menu-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');

    // Detecta usuário logado
    const usuario = window._usuario || JSON.parse(localStorage.getItem('usuario') || '{}');
    const isSuperAdmin = usuario.role === 'SUPER_ADMIN';

    const adminItems = isSuperAdmin ? `
      <a href="/usuarios.html" class="mms-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        Usuários
      </a>
      <a href="/funis.html" class="mms-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
        </svg>
        Funis & Etapas
      </a>
    ` : '';

    sheet.innerHTML = `
      <div class="mms-handle"></div>
      <div class="mms-header">
        <span class="mms-title">Menu</span>
        <button class="mms-close" onclick="window.__fecharMenuSheet()" aria-label="Fechar">✕</button>
      </div>
      <div class="mms-body">
        <a href="/comissoes.html" class="mms-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          Comissões
        </a>
        <a href="/mensagens-padrao.html" class="mms-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          Biblioteca de Mensagens
        </a>
        ${adminItems}
        <a href="/automacoes.html" class="mms-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41"/>
            <path d="M4.93 4.93l1.41 1.41"/><path d="M12 2v2"/><path d="M12 20v2"/>
            <path d="M2 12H4"/><path d="M20 12h2"/>
          </svg>
          Automações
        </a>
        <div class="mms-divider"></div>
        <button class="mms-item mms-item-danger" onclick="Auth.sair()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sair
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    window.__fecharMenuSheet = fecharMenuSheet;
  }

  function toggleMenuSheet() {
    criarMenuSheet();
    const sheet   = document.getElementById('mobile-menu-sheet');
    const overlay = document.getElementById('mobile-menu-overlay');
    const btn     = document.getElementById('mbn-menu-btn');
    const isOpen  = sheet.classList.contains('open');
    sheet.classList.toggle('open', !isOpen);
    overlay.classList.toggle('open', !isOpen);
    btn.setAttribute('aria-expanded', String(!isOpen));
    document.body.classList.toggle('sheet-open', !isOpen);
  }

  function fecharMenuSheet() {
    const sheet   = document.getElementById('mobile-menu-sheet');
    const overlay = document.getElementById('mobile-menu-overlay');
    const btn     = document.getElementById('mbn-menu-btn');
    if (sheet)   sheet.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    if (btn)     btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sheet-open');
  }

  // ── Mobile Header compacto ──────────────────────────────────────────────────
  function criarMobileHeader() {
    if (document.getElementById('mobile-header')) return;
    // Título da página
    const pageTitle = document.querySelector('h1.page-title, h1, title')?.textContent?.trim() || 'PROSPEKT CRM';
    const shortTitle = pageTitle.replace(/—.*/, '').trim().slice(0, 30);

    const header = document.createElement('header');
    header.id = 'mobile-header';
    header.innerHTML = `
      <div class="mh-logo">
        <img src="/icons/icon-192.png" alt="PROSPEKT" width="24" height="24" style="border-radius:6px">
        <span class="mh-brand">PROSPEKT</span>
      </div>
      <div class="mh-title">${shortTitle}</div>
      <div class="mh-actions" id="mh-actions"></div>
    `;
    document.body.prepend(header);
  }

  // ── Registro do Service Worker ──────────────────────────────────────────────
  function registrarSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => console.log('[PWA] SW registrado:', reg.scope))
        .catch(err => console.warn('[PWA] SW falhou:', err));
    }
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  function init() {
    registrarSW();
    if (isMobile()) {
      criarBottomNav();
      criarMobileHeader();
    }
    // Re-checar no resize
    window.addEventListener('resize', () => {
      if (isMobile()) {
        criarBottomNav();
        criarMobileHeader();
      }
    }, { passive: true });
  }

  // Aguarda DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
