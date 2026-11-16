// Garde l'appli disponible sans réseau (au gymnase, au stade…).
const CACHE = 'parcours-v93';
const FILES = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'icons/athena.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
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
  // réseau d'abord ; si le réseau traîne plus de 3 s (salle de sport, 4G faible), la copie en réserve
  const net = fetch(req, { cache: 'no-cache' }).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; });
  const fallback = () => caches.match(req).then(hit => hit || caches.match('index.html'));
  e.respondWith(new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => fallback().then(hit => { if (hit && !done) { done = true; resolve(hit); } }), 3000);
    net.then(res => { if (!done) { done = true; clearTimeout(t); resolve(res); } })
       .catch(() => fallback().then(hit => { if (!done) { done = true; clearTimeout(t); resolve(hit || Response.error()); } }));
  }));
});

// Notifications d'Athéna (point du matin, bilan du soir)
self.addEventListener('push', e => {
  let m = {title: 'Athéna', body: 'Ouvre l\'appli pour voir ta journée.', url: './index.html#accueil'};
  try { if (e.data) m = Object.assign(m, e.data.json()); } catch (err) {}
  e.waitUntil(self.registration.showNotification(m.title, {body: m.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: {url: m.url}, tag: 'athena-' + (m.tag || Date.now())}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './index.html', self.registration.scope).href;
  e.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) return c.focus().then(() => c.navigate ? c.navigate(url) : c);
    return clients.openWindow(url);
  }));
});
