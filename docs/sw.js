// Service worker minimal : rend l'application installable et ouvrable hors ligne.
// Il ne met en cache que la page d'accueil et les fichiers compilés (/assets/). Il n'intercepte JAMAIS /api/
// (connexion bancaire, soldes, opérations) : ces échanges passent toujours directement par le réseau.
const CACHE = 'mon-budget-static-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

/** Mémorise la page d'accueil, précharge les fichiers compilés qu'elle référence et purge les anciens. */
async function cacheShell(response) {
  if (response.status !== 200) return;
  const cache = await caches.open(CACHE);
  const assets = [...new Set((await response.clone().text()).match(/\/assets\/[^"'\s)]+/g) ?? [])];
  await cache.put('/', response);
  await Promise.all(assets.map(async path => {
    if (await cache.match(path)) return;
    const asset = await fetch(path);
    if (asset.status === 200) await cache.put(path, asset);
  }));
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/assets/') && !assets.includes(pathname)) await cache.delete(request);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages : réseau d'abord (toujours la dernière version). Seule la page d'accueil est mémorisée ;
  // les pages légales ne doivent jamais remplacer l'application dans le cache.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (url.pathname === '/') event.waitUntil(cacheShell(response.clone()).catch(() => {}));
        return response;
      } catch {
        return (url.pathname === '/' ? await caches.match('/') : undefined) ?? Response.error();
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
      if (response.status === 200) event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, response.clone())).catch(() => {}));
      return response;
    })());
  }
});
