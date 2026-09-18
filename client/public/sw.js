const CACHE_NAME = 'fcgs-portal-v3';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.png',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/uploads/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const isStaticAsset = Boolean(url.pathname.match(/\.(js|css|wasm|png|jpg|jpeg|webp|svg|woff2?)$/)) || url.pathname === '/';
        const isWasm = url.pathname.endsWith('.wasm');
        const contentType = response.headers.get('content-type') || '';
        // Never cache an SPA HTML fallback under a .wasm URL. A cached HTML
        // response there makes WebAssembly fail with the `<!DO` magic bytes.
        const hasValidWasmContentType = !isWasm || contentType.includes('application/wasm');

        if (response.ok && isStaticAsset && hasValidWasmContentType) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
