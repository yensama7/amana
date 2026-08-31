// Amana Way — PWA service worker.
//
// Strategy (learned the hard way — cache-first HTML across a redeploy serves
// stale pages that reference deleted JS chunks and crashes the app):
//   /api/*          — never touched: the app needs live data.
//   /zk/*           — never touched: the prover worker manages these in its
//                     own versioned cache (ZK_CACHE below); caching them twice
//                     doubles ~19MB and can go stale independently.
//   /_next/static/* — cache-first: content-hashed, immutable forever.
//   everything else — network-first, cache fallback: always fresh after a
//                     deploy, still works offline.
//
// Bump BOTH names on any deploy that changes cached content — activate()
// deletes every cache not in KEEP, which purges stale proving keys too.
const CACHE = 'amana-v2';
const ZK_CACHE = 'zk-v2'; // owned by prover.worker.js / wallet warm-up
const KEEP = [CACHE, ZK_CACHE];

self.addEventListener('install', (e) => {
  // Activate immediately without waiting for existing tabs to close.
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  // Purge every cache from previous versions (including old zk key caches).
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheOk(res) {
  return res && res.status === 200 && res.type !== 'opaque';
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/zk/')) return;

  // Immutable hashed assets: cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (cacheOk(res)) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }))
    );
    return;
  }

  // Pages, manifest, icons: network-first so a redeploy is picked up
  // immediately; fall back to the last good copy when offline.
  e.respondWith(
    fetch(e.request).then(res => {
      if (cacheOk(res)) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
