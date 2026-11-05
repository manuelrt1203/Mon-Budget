// Service worker minimal : rend l'application installable et ouvrable hors ligne.
// Il ne met en cache que des fichiers statiques de l'application. Il n'intercepte JAMAIS /api/
// (connexion bancaire, soldes, opérations) : ces échanges passent toujours directement par le réseau.
const CACHE = 'mon-budget-static-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages : réseau d'abord (toujours la dernière version), copie locale si hors ligne.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE)).put('/', response.clone());
        return response;
      } catch {
        return (await caches.match('/')) ?? Response.error();
      }
    })());
    return;
  }

  // Fichiers compilés (noms à empreinte, donc immuables) : cache d'abord.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
      return response;
    })());
  }
});
