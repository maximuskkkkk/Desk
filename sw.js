/* Service worker: caches the app shell so it opens full screen offline. Never caches desk data (d/...). */
const C = 'desk-shell-v5', SHELL = ['./', 'index.html', 'app.css', 'app.js', 'chart.js', 'manifest.json', 'icons/apple-touch-icon.png', 'icons/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || u.pathname.includes('/d/')) return;          // desk data: always network
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(C).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request)));
});
