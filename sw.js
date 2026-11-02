// Pilote V3 : cache de l'interface, lecture reseau en premier pour eviter d'afficher une ancienne version.
// Donnees Supabase et authentification : jamais interceptees ni mises en cache par ce Service Worker.
const CACHE = 'atelier-projets-pilote-v3-2';
const SHELL = ['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('atelier-projets-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('/config.js')) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(request,response.clone()));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put('./index.html',response.clone()));
      return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(fetch(request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request,response.clone()));
    return response;
  }).catch(() => caches.match(request)));
});
