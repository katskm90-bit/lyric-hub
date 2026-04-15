// HymnDesk Service Worker — v1.0
// Strategy:
//   App shell (HTML, fonts) → Cache first, network fallback
//   hymns.json              → Network first, cache fallback (always try fresh)
//   GAS API calls           → Network only, never cached
//   Everything else         → Network first, cache fallback

const CACHE_NAME = 'hymndesk-v1';
const HYMNS_CACHE = 'hymndesk-hymns-v1';

// App shell resources to pre-cache on install
const APP_SHELL = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap',
];

// URLs that must NEVER be cached
const NEVER_CACHE = [
  'script.google.com',      // GAS API
  'google.com/macros',      // GAS API
  'googleapis.com',         // Google APIs
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(APP_SHELL).catch(function(err) {
          // Non-fatal — app still works without pre-cache
          console.warn('HymnDesk SW: Pre-cache partial failure', err);
        });
      })
      .then(function() { return self.skipWaiting(); })
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          // Delete old cache versions but keep current ones
          return key !== CACHE_NAME && key !== HYMNS_CACHE;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  var method = event.request.method;

  // Only handle GET requests
  if (method !== 'GET') return;

  // Never cache GAS API or Google services
  if (NEVER_CACHE.some(function(domain) { return url.includes(domain); })) {
    return; // Let browser handle it directly
  }

  // hymns.json — network first, cache fallback
  // Always try to get fresh hymn data; fall back to cached if offline
  if (url.includes('hymns.json')) {
    event.respondWith(
      fetch(event.request.clone())
        .then(function(response) {
          if (response && response.status === 200) {
            var responseClone = response.clone();
            caches.open(HYMNS_CACHE).then(function(cache) {
              cache.put('/hymns.json', responseClone);
            });
          }
          return response;
        })
        .catch(function() {
          // Offline — serve cached hymns
          return caches.match('/hymns.json').then(function(cached) {
            if (cached) return cached;
            return new Response('[]', {
              headers: { 'Content-Type': 'application/json' }
            });
          });
        })
    );
    return;
  }

  // App shell and static assets — cache first, network fallback
  if (
    url.includes(self.location.origin) ||
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com')
  ) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var responseClone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        }).catch(function() {
          // Offline and not cached — return the main page for navigation
          if (event.request.mode === 'navigate') {
            return caches.match('/') || caches.match('/index.html');
          }
        });
      })
    );
    return;
  }

  // Everything else — network first, silent failure
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match(event.request);
    })
  );
});
