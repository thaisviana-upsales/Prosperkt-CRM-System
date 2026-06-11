/**
 * PROSPEKT CRM — Service Worker v3
 * PWA installation enabler.
 *
 * ESTRATÉGIA DE CACHE:
 *  - HTML/API   : network-only (dados sempre frescos)
 *  - CSS/JS     : network-first com fallback de cache (garante que atualizações de layout chegam imediatamente)
 *  - Ícones/PNG : cache-first (imutáveis)
 *
 * v3 — bumped para invalidar cache de CSS antigo que prendia os estilos premium
 */

const CACHE_NAME = 'prospekt-static-v3';

// Pré-cache mínimo — só ícones (imutáveis)
const PRECACHE = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE).catch(() => {})
    )
  );
  self.skipWaiting(); // ativa imediatamente sem esperar aba ser fechada
});

// Activate: remove TODOS os caches antigos (v1, v2…)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 1. API — nunca interceptar
  if (url.pathname.startsWith('/api/')) return;

  // 2. HTML — network-only (sempre da rede)
  if (e.request.destination === 'document') return;

  // 3. Ícones/imagens — cache-first (não mudam)
  if (url.pathname.startsWith('/icons/') || e.request.destination === 'image') {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request).then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return resp;
      }))
    );
    return;
  }

  // 4. CSS e JS — network-first: sempre tenta rede, usa cache só se offline
  //    Isso garante que atualizações de design-system.css chegam imediatamente
  if (e.request.destination === 'style' || e.request.destination === 'script') {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return resp;
        })
        .catch(() => caches.match(e.request)) // fallback offline
    );
    return;
  }

  // 5. Tudo mais — network-first silencioso
});
