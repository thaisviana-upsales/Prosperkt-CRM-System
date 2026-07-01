/**
 * PROSPEKT CRM — Service Worker v5
 *
 * FILOSOFIA: O SW existe APENAS para habilitar a instalação PWA.
 * NÃO cacheia HTML, CSS nem JS — deixa o browser tratar isso
 * com HTTP cache natural do servidor (sem interferência do SW).
 *
 * Isso garante que após qualquer deploy, novos arquivos chegam
 * imediatamente sem precisar de hard refresh.
 *
 * O que é cacheado:
 *   - /manifest.json       (necessário para PWA)
 *   - /icons/icon-*.png    (imutáveis, raramente mudam)
 *
 * O que NUNCA é cacheado pelo SW:
 *   - *.html   → cada página é sempre buscada da rede
 *   - *.css    → sem interferência (browser usa HTTP cache)
 *   - *.js     → sem interferência (browser usa HTTP cache)
 *   - /api/*   → dados sempre da rede
 *
 * v5: Bumped para forçar atualização do SW em todos os clientes.
 *     Versão anterior (v4) será deletada no activate.
 */

const CACHE_NAME = 'prospekt-pwa-v6';

const PRECACHE = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install: pré-cache mínimo ────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
  );
  // Ativa imediatamente — não espera abas antigas fecharem
  self.skipWaiting();
});

// ── Activate: apaga TODOS os caches antigos (v1, v2, v3, v4…) ───────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => {
            console.log('[SW] Deletando cache antigo:', k);
            return caches.delete(k);
          })
      )
    )
  );
  // Assume controle de todas as abas abertas imediatamente
  self.clients.claim();
});

// ── Fetch: passa tudo para a rede, exceto ícones ────────────────────────────
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Só intercepta requisições do mesmo origin
  if (url.origin !== self.location.origin) return;

  // Ícones PWA e manifest: cache-first (são imutáveis)
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json') {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request).then((resp) => {
          // Armazena no cache apenas se resposta válida
          if (resp && resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return resp;
        }).catch(() => cached || new Response('', { status: 404 }));
      })
    );
    return;
  }

  // TUDO O MAIS (HTML, CSS, JS, API): NÃO interceptar
  // O browser usa HTTP cache natural — nenhuma interferência do SW
  // O servidor já envia Cache-Control: no-cache, must-revalidate para HTML/CSS/JS
  // Isso garante que novos deploys chegam sem hard refresh
});

// ── Mensagem de controle de clientes ────────────────────────────────────────
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
