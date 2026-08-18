// Amana Way — PWA service worker.
// Cache-first for static assets (JS, CSS, ZK artifacts, icons).
// Network-first for /api/* — the app needs live data, stale responses break the demo.
const CACHE = 'amana-v1';

self.addEventListener('install', (e) => {
  // Activate immediately without waiting for existing tabs to close.
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  // Clean up any caches from previous versions on activation.
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Always hit the network for API calls — stale consent/audit data would confuse the demo.
  if (e.request.url.includes('/api/')) return;

  // Cache-first for everything else: check cache, fall through to network and store.
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // Only cache successful responses — don't cache errors or opaque responses.
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      });
    })
  );
});
