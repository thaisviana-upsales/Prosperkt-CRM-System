/**
 * PROSPEKT CRM — Mobile Navigation v2
 *
 * O que faz:
 *  1. Registra o Service Worker (PWA)
 *  2. Cria a Bottom Navigation Bar no mobile
 *  3. Cria o Mobile Header compacto
 *  4. Cria o Menu Bottom Sheet
 *  5. Exibe banner de instalar PWA (Android/Chrome: A2HS nativo)
 *  6. Exibe dica de "Adicionar à tela inicial" no iOS/Safari
 *  7. Botão de voltar no WhatsApp mobile
 *
 * Desktop: NADA é renderizado (tudo fica hidden ou condicional).
 * Não altera regras de negócio, rotas ou integrações.
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
    'trocar-senha.html':         'menu',
  };

  function getActivePage() {
    const path = window.location.pathname.split('/').pop() || 'dashboard.html';
    return PAGE_MAP[path] || 'menu';
  }

  function getCurrentPageName() {
    const path = window.location.pathname.split('/').pop() || '';
    const titles = {
      'dashboard.html':           'Dashboard',
      'pipeline.html':            'Pipeline',
      'whatsapp.html':            'Conversas',
      'metas.html':               'Metas',
      'comissoes.html':           'Comissões',
      'usuarios.html':            'Usuários',
      'mensagens-padrao.html':    'Mensagens Padrão',
      'automacoes.html':          'Automações',
      'funis.html':               'Funis',
      'integracao-whatsapp.html': 'Integração WA',
      'logs.html':                'Logs',
      'trocar-senha.html':        'Trocar Senha',
      'login.html':               'Login',
    };
    return titles[path] || document.title.replace(/—.*/, '').trim().slice(0, 24) || 'PROSPEKT CRM';
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

    const usuario = window._usuario || JSON.parse(sessionStorage.getItem('pkt_user') || '{}');
    const isSuperAdmin = usuario.role === 'SUPER_ADMIN';
    const isGestor = usuario.role === 'GESTOR' || isSuperAdmin;

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
      <a href="/integracao-whatsapp.html" class="mms-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        Integração WhatsApp
      </a>
    ` : '';

    // Informações do usuário logado
    const nomeUsuario = usuario.nome || usuario.email || 'Usuário';
    const roleDisplay = { SUPER_ADMIN: 'Super Admin', GESTOR: 'Gestor', VENDEDOR: 'Vendedor' }[usuario.role] || usuario.role || '';
    const iniciais = nomeUsuario.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);

    sheet.innerHTML = `
      <div class="mms-handle"></div>
      <div class="mms-header">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#5BDE3E,#D6008E);display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;color:#0A0A0A;flex-shrink:0">${iniciais}</div>
          <div style="min-width:0">
            <div style="font-size:.8rem;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nomeUsuario}</div>
            <div style="font-size:.62rem;color:rgba(255,255,255,.45)">${roleDisplay}</div>
          </div>
        </div>
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
        <a href="/automacoes.html" class="mms-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41"/>
            <path d="M4.93 4.93l1.41 1.41"/><path d="M12 2v2"/><path d="M12 20v2"/>
            <path d="M2 12H4"/><path d="M20 12h2"/>
          </svg>
          Automações
        </a>
        ${adminItems}
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
    const shortTitle = getCurrentPageName();
    const isWA = window.location.pathname.includes('whatsapp.html');

    const header = document.createElement('header');
    header.id = 'mobile-header';
    header.innerHTML = `
      <div class="mh-logo">
        <img src="/icons/icon-192.png" alt="PROSPEKT" width="24" height="24" style="border-radius:6px">
        <span class="mh-brand">PROSPEKT</span>
      </div>
      <div class="mh-title" id="mh-page-title">${shortTitle}</div>
      <div class="mh-actions" id="mh-actions">
        ${isWA ? `
          <button id="btn-wa-nova-conv-mobile" style="background:none;border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.7);border-radius:8px;padding:5px 10px;font-size:.7rem;font-weight:700;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent" title="Nova Conversa">
            + Nova
          </button>
        ` : ''}
      </div>
    `;
    document.body.prepend(header);

    // Conecta botão "Nova Conversa" do header mobile com o btn-nova-conv da página
    if (isWA) {
      const btnHeader = document.getElementById('btn-wa-nova-conv-mobile');
      if (btnHeader) {
        btnHeader.addEventListener('click', () => {
          const btnPage = document.getElementById('btn-nova-conv');
          if (btnPage) btnPage.click();
        });
      }
    }
  }

  // ── Botão "Voltar" no WhatsApp mobile ───────────────────────────────────────
  // Injetado no header do chat quando uma conversa está aberta
  function injetarBotaoVoltarWA() {
    if (!window.location.pathname.includes('whatsapp.html')) return;

    // Aguarda o chat header existir (pode ser carregado dinamicamente)
    const observer = new MutationObserver(() => {
      const chatHeader = document.getElementById('chat-header');
      if (chatHeader && !document.getElementById('btn-mobile-voltar')) {
        const btnVoltar = document.createElement('button');
        btnVoltar.id = 'btn-mobile-voltar';
        btnVoltar.title = 'Voltar para lista';
        btnVoltar.style.cssText = `
          display:none;background:none;border:none;color:rgba(255,255,255,.7);
          cursor:pointer;padding:6px;border-radius:8px;align-items:center;
          flex-shrink:0;-webkit-tap-highlight-color:transparent;
        `;
        btnVoltar.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>`;
        chatHeader.prepend(btnVoltar);

        btnVoltar.addEventListener('click', () => {
          const waChat = document.getElementById('wa-chat');
          if (waChat) {
            waChat.classList.remove('mobile-open');
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Ativa botão voltar quando chat abre e esconde quando fecha
  function monitorarChatWA() {
    if (!window.location.pathname.includes('whatsapp.html')) return;

    const waChat = document.getElementById('wa-chat');
    if (!waChat) {
      setTimeout(monitorarChatWA, 500);
      return;
    }

    const obs = new MutationObserver(() => {
      const btnVoltar = document.getElementById('btn-mobile-voltar');
      if (!btnVoltar) return;
      const isOpen = waChat.classList.contains('mobile-open');
      if (isMobile()) {
        btnVoltar.style.display = isOpen ? 'flex' : 'none';
      }
    });
    obs.observe(waChat, { attributes: true, attributeFilter: ['class'] });

    // Ao abrir conversa, adiciona classe mobile-open (hook para whatsapp.js)
    // O whatsapp.js deve adicionar .mobile-open ao #wa-chat ao clicar em conversa
    // Aqui garantimos que se já houver chat-header visível, ativamos o botão
    const chatHeader = document.getElementById('chat-header');
    if (chatHeader && chatHeader.style.display !== 'none') {
      waChat.classList.add('mobile-open');
    }
  }

  // ── Desregistro do Service Worker (Desktop) ─────────────────────────────────
  function desregistrarSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          registration.unregister().then(success => {
            if (success) console.log('[PWA] SW desregistrado com sucesso no desktop');
          });
        }
      }).catch(err => console.warn('[PWA] Erro ao desregistrar SW no desktop:', err));
    }
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(k => {
          caches.delete(k).then(() => {
            console.log('[PWA] Cache deletado no desktop:', k);
          });
        });
      }).catch(err => console.warn('[PWA] Erro ao limpar caches no desktop:', err));
    }
  }

  // ── Registro do Service Worker ──────────────────────────────────────────────
  function registrarSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => {
          console.log('[PWA] SW registrado:', reg.scope);
          // Verifica se há um SW aguardando e força atualização
          if (reg.waiting) {
            reg.waiting.postMessage('SKIP_WAITING');
          }
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // Novo SW instalado — força atualização silenciosa
                  newWorker.postMessage('SKIP_WAITING');
                }
              });
            }
          });
        })
        .catch(err => console.warn('[PWA] SW falhou:', err));

      // Reload quando o SW toma controle (garante conteúdo atualizado)
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          // Não recarrega automaticamente — usuário pode estar em meio a uma ação
          // O reload acontece na próxima navegação naturalmente
        }
      });
    }
  }

  // ── Banner de Instalar PWA (Android/Chrome) ─────────────────────────────────
  let _deferredPrompt = null;
  let _bannerDismissed = false;

  function configurarBannerInstalacao() {
    // Captura o evento beforeinstallprompt (Chrome/Android)
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      _deferredPrompt = e;

      // Só mostra se não foi dispensado antes (salvo em localStorage)
      const dispensado = localStorage.getItem('pwa_banner_dismissed');
      if (dispensado) return;

      if (isMobile()) {
        setTimeout(() => mostrarBannerAndroid(), 3000);
      }
    });

    // Quando o app já está instalado
    window.addEventListener('appinstalled', () => {
      _deferredPrompt = null;
      esconderBanners();
      console.log('[PWA] App instalado com sucesso!');
    });
  }

  function mostrarBannerAndroid() {
    if (_bannerDismissed || !_deferredPrompt) return;
    if (document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.style.display = 'flex';
    banner.innerHTML = `
      <img class="pwa-banner-icon" src="/icons/icon-192.png" alt="PROSPEKT CRM">
      <div class="pwa-banner-text">
        <div class="pwa-banner-title">Instalar PROSPEKT CRM</div>
        <div class="pwa-banner-sub">Acesso rápido como um app</div>
      </div>
      <button class="pwa-banner-btn" id="pwa-install-btn">Instalar</button>
      <button class="pwa-banner-close" id="pwa-banner-close" aria-label="Fechar">✕</button>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
      if (!_deferredPrompt) return;
      _deferredPrompt.prompt();
      const { outcome } = await _deferredPrompt.userChoice;
      console.log('[PWA] Resultado instalação:', outcome);
      _deferredPrompt = null;
      esconderBanners();
    });

    document.getElementById('pwa-banner-close').addEventListener('click', () => {
      _bannerDismissed = true;
      localStorage.setItem('pwa_banner_dismissed', '1');
      esconderBanners();
    });
  }

  // ── Dica de instalação para iOS/Safari ──────────────────────────────────────
  function configurarDicaIOS() {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true;
    const jaViu = localStorage.getItem('ios_hint_dismissed');

    if (!isIOS || !isSafari || isStandalone || jaViu) return;
    if (!isMobile()) return;

    // Mostra a dica após 4 segundos
    setTimeout(() => mostrarDicaIOS(), 4000);
  }

  function mostrarDicaIOS() {
    if (document.getElementById('ios-install-hint')) return;

    const hint = document.createElement('div');
    hint.id = 'ios-install-hint';
    hint.style.display = 'flex';
    hint.innerHTML = `
      <div class="ios-hint-row">
        <img src="/icons/icon-192.png" alt="" width="28" height="28" style="border-radius:7px;flex-shrink:0">
        <div class="ios-hint-title">Instalar PROSPEKT CRM</div>
        <button class="ios-hint-close" id="ios-hint-close" aria-label="Fechar">✕</button>
      </div>
      <div class="ios-hint-steps">
        Toque em <span>⎋ Compartilhar</span> no Safari e depois em <span>Adicionar à Tela de Início</span>.
      </div>
    `;
    document.body.appendChild(hint);

    document.getElementById('ios-hint-close').addEventListener('click', () => {
      localStorage.setItem('ios_hint_dismissed', '1');
      hint.remove();
    });
  }

  function esconderBanners() {
    ['pwa-install-banner', 'ios-install-hint'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  function init() {
    if (isMobile()) {
      registrarSW();
      configurarBannerInstalacao();
      criarBottomNav();
      criarMobileHeader();
      injetarBotaoVoltarWA();
      monitorarChatWA();
      configurarDicaIOS();
    } else {
      desregistrarSW();
    }

    // Re-checar no resize
    window.addEventListener('resize', () => {
      if (isMobile()) {
        criarBottomNav();
        criarMobileHeader();
        injetarBotaoVoltarWA();
        monitorarChatWA();
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
