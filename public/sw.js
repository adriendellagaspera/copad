// Deliberately cache NOTHING. This worker exists only because some platforms gate
// install-ability on a registered service worker (docs/architecture.md, "PWA /
// share sheet"). Do not turn it into an app-shell cache without reading this:
//
//   1. A navigation fallback that answers every navigation with the cached index
//      also swallows /redirect.html — the OAuth popup target (redirect.html,
//      vite.config.ts) — and every storage backend's sign-in silently stops
//      returning its token.
//   2. Cache keys must not ignore the query string. Rooms are `?room=<id>` and
//      share-target launches are `?text=…`, all on one path, so a
//      `cache.match(…, { ignoreSearch: true })` (Workbox's NavigationRoute does
//      this by default) collapses every distinct entry point onto one entry.
//   3. index.html is not a static file: vite.config.ts injects VITE_APP_NAMESPACE
//      into its pre-paint theme script at build time, so a stale cached copy
//      keeps reading the previous deployment's localStorage keys.
//
// If caching is ever genuinely wanted, precache only hashed /assets/* and leave
// navigations alone.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => event.respondWith(fetch(event.request)));
