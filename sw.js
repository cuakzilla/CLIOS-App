// CLIOS Service Worker v1.1
// Offline-first: cache estrategico + background sync

const CACHE_NAME = 'clios-v2';
const ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:ital,wght@0,300;0,400;1,300&family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,200&display=swap'
];

// Install: cache assets criticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: limpiar caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: estrategia por tipo de request
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Proxy API (/api/chat): solo online, nunca cachear
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/functions/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({
          content: [{ type: 'text', text: 'Sin conexion. El copiloto IA estara disponible cuando recuperes internet. El sistema CLIOS sigue funcionando offline.' }]
        }), { headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // Google Fonts: cache-first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return resp;
        });
      })
    );
    return;
  }

  // App shell: cache-first con fallback a red, luego a index.html
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

// Background Sync: al recuperar conexion
self.addEventListener('sync', event => {
  if (event.tag === 'clios-sync') {
    event.waitUntil(syncPendingData());
  }
});

async function syncPendingData() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_COMPLETE', timestamp: Date.now() });
  });
}

// Push notifications
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'CLIOS', {
      body: data.body || 'Nueva recomendacion del sistema',
      icon: '/icon.png',
      badge: '/badge.png',
      tag: 'clios-notification',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});

// Mensajes desde el cliente
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CACHE_URLS') {
    caches.open(CACHE_NAME).then(cache => cache.addAll(event.data.urls || []));
  }
});
