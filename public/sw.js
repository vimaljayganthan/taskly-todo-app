/**
 * Taskly Customer App — Progressive Web App Service Worker
 *
 * Conservative Caching Strategy:
 * - Caches static assets only (HTML, CSS, JS, fonts, static icons/images/sounds).
 * - Strictly NEVER caches:
 *   1. Authenticated API responses (/api/*)
 *   2. Supabase auth and database requests (*.supabase.co, /auth/v1/*, /rest/v1/*)
 *   3. OAuth callbacks and URLs containing code=, access_token=, refresh_token=, error=
 *   4. Personal user data, session tokens, or sensitive state
 * - Provides offline fallback for the static application shell.
 * - Actively purges obsolete cache versions on activate.
 */

const CACHE_NAME = 'taskly-pwa-v2.4.0';

const PRECACHE_STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/styles.css?v=2.7',
  '/app.js',
  '/app.js?v=2.7',
  '/manifest.webmanifest',
  '/manifest.json',
  '/favicon.png',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/logo.png',
  '/vendor/supabase.js',
  '/assets/sounds/taskly_meow.wav'
];

// ============================================================================
// Service Worker Lifecycle: Install
// ============================================================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Pre-cache core shell assets, catching individual errors so install succeeds
      return Promise.allSettled(
        PRECACHE_STATIC_ASSETS.map((assetUrl) =>
          cache.add(assetUrl).catch((err) => {
            console.warn('[Taskly PWA SW]: Precache warning for', assetUrl, err?.message || err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ============================================================================
// Service Worker Lifecycle: Activate (Clean Up Obsolete Caches)
// ============================================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Taskly PWA SW]: Purging obsolete cache version:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================================================
// Direct Message Listener: Support explicit SKIP_WAITING
// ============================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ============================================================================
// Fetch Interception: Strict Exclusion Filtering & Conservative Caching
// ============================================================================
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 1. Only process HTTP(S) GET requests; bypass everything else directly
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 2. Strict Bypass: Supabase Auth & REST endpoints (NEVER CACHE)
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('/rest/v1/') ||
    url.pathname.includes('/storage/v1/')
  ) {
    return;
  }

  // 3. Strict Bypass: Backend API endpoints (NEVER CACHE USER DATA / TASKS)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 4. Strict Bypass: OAuth callbacks, tokens, authorization codes, errors
  if (
    url.search.includes('code=') ||
    url.search.includes('access_token=') ||
    url.search.includes('refresh_token=') ||
    url.search.includes('error=') ||
    url.search.includes('error_description=') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.includes('/auth/callback')
  ) {
    return;
  }

  // 5. Strict Bypass: Release manifests and downloadable APK binaries
  if (url.pathname.startsWith('/releases/') || url.pathname.includes('-manifest.json')) {
    return;
  }

  // 6. Navigation Requests (HTML shell): Network-First with Offline Cache Fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) return cachedIndex;
          return new Response('Offline — Taskly requires an internet connection.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        })
    );
    return;
  }

  // 7. Static Assets: Stale-While-Revalidate with search fallback to prevent stale assets
  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      const existingMatch = cachedResponse || (await caches.match(request, { ignoreSearch: true }));

      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors')
          ) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => existingMatch);

      return existingMatch || fetchPromise;
    })
  );
});
