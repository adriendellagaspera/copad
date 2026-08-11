// Deliberately caches nothing. Before adding caching, read docs/architecture.md's
// "PWA / share sheet" entry — it breaks OAuth, room routing, and namespaced storage.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => event.respondWith(fetch(event.request)));
