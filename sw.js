// Garde l'appli disponible sans réseau (au gymnase, au stade…).
const CACHE = 'parcours-v12';
const FILES = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
const FIXED = /fonts\.gstatic\.com|fonts\.googleapis\.com|www\.gstatic\.com\/firebasejs/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // polices et bibliothèque Firebase : la réserve d'abord (elles ne changent pas)
  if (FIXED.test(url.href)) {
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== location.origin) return;
  // nos fichiers : le réseau d'abord (pour avoir la dernière version), la réserve si pas de réseau
  e.respondWith(fetch(req).then(res => { if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())); return res; })
    .catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
});
