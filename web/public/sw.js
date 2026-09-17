// Amana Way — PWA service worker.
//
// Strategy (learned the hard way — cache-first HTML across a redeploy serves
// stale pages that reference deleted JS chunks and crashes the app):
//
//   /api/*           — bypass completely: the app needs live data, never cached.
//   /zk/*            — bypass completely: the prover worker manages these in its
//                      own versioned cache (ZK_CACHE below); caching them here too
//                      would double ~19MB of storage and could go stale independently.
//   /_next/static/*  — cache-first: filenames are content-hashed by Next.js so they
//                      are immutable — a given URL will always return the same bytes.
//   everything else  — network-first with cache fallback: always fetches a fresh copy
//                      after a deploy, but still works offline if the network is down.
//
// To pick up a new deploy: BUMP BOTH CACHE and ZK_CACHE names.
// activate() deletes every cache not in KEEP, which purges stale proving keys too.
// Mismatched versions (sw.js says v3, prover says v2) will cause cache misses on
// the first proof after a deploy — always update all three version strings together.
const CACHE = 'amana-v2';
const ZK_CACHE = 'zk-v2'; // owned by prover.worker.js and wallet warm-up (wallet/page.jsx)
const KEEP = [CACHE, ZK_CACHE]; // every cache NOT in this list is deleted on activate

// install: force this worker to take control immediately, without waiting for
// existing tabs to navigate away. This ensures a freshly deployed worker is
// active on the very next fetch, rather than waiting for all tabs to close.
self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

// activate: sweep out all caches from previous versions.
// This fires after skipWaiting() resolves. Deleting old caches reclaims storage
// and prevents stale proving keys from being served to the prover worker.
// After cleanup, clients.claim() makes this worker the active controller for
// all currently open pages — they don't need to reload to get the new worker.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => !KEEP.includes(k)) // only delete caches from old versions
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim()) // take control of open pages immediately
  );
});

// cacheOk: true only for real, successful, same-origin responses.
// opaque responses (cross-origin, no-cors) have status 0 and should not be stored
// because we can't inspect them — a cached opaque error would look like valid content.
function cacheOk(res) {
  return res && res.status === 200 && res.type !== 'opaque';
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Pass API calls and ZK artifacts straight through — no service worker involvement.
  // API calls need live data; ZK artifacts are managed by prover.worker.js.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/zk/')) return;

  // Immutable hashed assets (/_next/static/...): cache-first.
  // Next.js content-hashes every file name, so the same URL always returns
  // the same bytes. We cache on first fetch and never re-validate.
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        // Cache hit: return immediately without touching the network.
        if (cached) return cached;

        // Cache miss: fetch from network, store for next time, return the response.
        return fetch(e.request).then(res => {
          if (cacheOk(res)) {
            // Clone before storing: the response body stream can only be read once.
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Pages, manifest, icons — network-first with cache fallback.
  // Always attempt a fresh network fetch so a new deploy is picked up immediately.
  // If the network request fails (offline, server unreachable), fall back to the
  // last cached copy so the app still loads for users with poor connectivity.
  e.respondWith(
    fetch(e.request).then(res => {
      if (cacheOk(res)) {
        // Update the cache with the fresh response for future offline fallback.
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() =>
      // Network failed — serve the stale cached copy if we have one.
      caches.match(e.request)
    )
  );
});
