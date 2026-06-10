/**
 * PROSPEKT CRM — Service Worker
 * Minimal SW para habilitar instalação PWA.
 * NÃO faz cache de dados sensíveis (leads, mensagens, metas, comissões, usuários).
 * Apenas cacheia assets estáticos imutáveis para carregamento rápido.
 */

const CACHE_NAME = 'prospekt-static-v1';

// Apenas assets que não contêm dados do negócio
const STATIC_CACHE = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/css/design-system.css',
  '/css/mobile.css',
];

// Install: pré-cache de assets estáticos
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_CACHE).catch(() => {
        // Ignora falhas de cache individual — não bloqueia instalação
      })
    )
  );
  self.skipWaiting();
});

// Activate: limpa caches antigos
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

// Fetch: network-first para TODA a API e páginas HTML (dados sempre frescos)
// Cache-first apenas para ícones e CSS estático
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // NUNCA interceptar chamadas de API — dados sempre da rede
  if (url.pathname.startsWith('/api/')) return;

  // NUNCA cachear páginas HTML — sempre buscar da rede
  if (e.request.destination === 'document') return;

  // Assets estáticos: cache-first
  if (
    e.request.destination === 'style' ||
    e.request.destination === 'script' ||
    url.pathname.startsWith('/icons/')
  ) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
    return;
  }

  // Tudo mais: network-first
});
