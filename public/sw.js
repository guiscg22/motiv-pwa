const CACHE = 'motiv-pwa-v1';
const ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];
self.addEventListener('install', evt => {
  evt.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', evt => {
  evt.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', evt => {
  const { request } = evt;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api')) {
    evt.respondWith(
      fetch(request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
        return res;
      }).catch(()=> caches.match(request))
    );
    return;
  }
  evt.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(res => {
      const clone = res.clone();
      if (res.ok && request.method === 'GET') {
        caches.open(CACHE).then(c => c.put(request, clone));
      }
      return res;
    }))
  );
});
