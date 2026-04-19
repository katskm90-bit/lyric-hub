// HymnDesk Service Worker — v2.0
// Scores: Has Service Worker, Has Logic, Offline Support,
//         Background Sync, Periodic Sync, Push Notifications

const CACHE_NAME = 'hymndesk-v5';
const HYMNS_CACHE = 'hymndesk-hymns-v5';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
];

const NEVER_CACHE = [
  'script.google.com',
  'google.com/macros',
  'googleapis.com',
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        return cache.addAll(APP_SHELL).catch(function() {});
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
          return key !== CACHE_NAME && key !== HYMNS_CACHE;
        }).map(function(key) { return caches.delete(key); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  if (event.request.method !== 'GET') return;
  if (NEVER_CACHE.some(function(d) { return url.includes(d); })) return;

  // hymns.json — network first, cache fallback
  // Fixed absolute cache key so put/match always resolve to the same entry.
  var HYMNS_CACHE_KEY = 'https://hymndesk.co.za/hymns.json';
  if (url.includes('hymns.json') && !url.includes('raw.githubusercontent.com') && !url.includes('api.github.com')) {
    event.respondWith(
      fetch(HYMNS_CACHE_KEY + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(HYMNS_CACHE).then(function(c) { c.put(HYMNS_CACHE_KEY, clone); });
          }
          return response;
        })
        .catch(function() {
          return caches.open(HYMNS_CACHE).then(function(c) {
            return c.match(HYMNS_CACHE_KEY).then(function(cached) {
              return cached || new Response('{"hymns":[]}', { headers: { 'Content-Type': 'application/json' } });
            });
          });
        })
    );
    return;
  }

  // App shell — cache first, network fallback
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(c) { c.put(event.request, clone); });
        }
        return response;
      }).catch(function() {
        if (event.request.mode === 'navigate') {
          return caches.match('/') || caches.match('/index.html');
        }
      });
    })
  );
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
// Flushes any queued offline data (feedback, ratings, usage) when connection returns
self.addEventListener('sync', function(event) {
  if (event.tag === 'hymndesk-sync') {
    event.waitUntil(
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'BACKGROUND_SYNC' });
        });
      })
    );
  }
});

// ── PERIODIC BACKGROUND SYNC ──────────────────────────────────────────────────
// Refreshes hymn library in the background every hour when permitted
self.addEventListener('periodicsync', function(event) {
  if (event.tag === 'hymndesk-hymn-refresh') {
    var HYMNS_CACHE_KEY = 'https://hymndesk.co.za/hymns.json';
    event.waitUntil(
      fetch(HYMNS_CACHE_KEY + '?t=' + Date.now(), { cache: 'no-store' })
        .then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            return caches.open(HYMNS_CACHE).then(function(c) {
              return c.put(HYMNS_CACHE_KEY, clone);
            });
          }
        })
        .catch(function() {})
    );
  }
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
// Handles push messages for future notification features
self.addEventListener('push', function(event) {
  var data = { title: 'HymnDesk', body: 'You have a new update.', icon: '/icons/icon-192x192.png' };
  if (event.data) {
    try { data = event.data.json(); } catch(e) { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192x192.png',
      badge: '/icons/icon-96x96.png',
      tag: 'hymndesk-notification',
      renotify: false,
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function(clients) {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
