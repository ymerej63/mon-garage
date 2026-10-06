/* Service worker : fonctionnement hors ligne + notifications. */
const VERSION = 'mon-garage-v3';
const SHELL = ['./', 'index.html', 'style.css', 'core.js', 'app.js', 'manifest.json', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
importScripts('core.js');

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'mongarage-data').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Réseau d'abord (pour recevoir vos mises à jour GitHub), cache si hors ligne.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

// Vérification en arrière-plan (Android / Chrome uniquement, appli installée).
self.addEventListener('periodicsync', e => {
  if (e.tag === 'check-entretiens') e.waitUntil(checkInBackground());
});

async function checkInBackground() {
  const store = await caches.open('mongarage-data');
  const r = await store.match('./__data.json'); if (!r) return;
  const data = await r.json();
  const n = await store.match('./__notified.json');
  const notified = n ? await n.json() : {};
  const now = Date.now();
  const todo = Core.alertes(data).filter(a => (a.statut === 'late' || a.statut === 'warn') && (!notified[a.key] || (a.statut === 'late' && now - notified[a.key] > 3 * 86400000)));
  for (const a of todo.slice(0, 3)) {
    await self.registration.showNotification(a.voiture + ' — ' + a.titre, {
      body: a.statut === 'late' ? 'Échéance dépassée' : 'Échéance proche', tag: a.key,
      icon: 'icons/icon-192.png', data: { carId: a.carId }
    });
    notified[a.key] = now;
  }
  await store.put('./__notified.json', new Response(JSON.stringify(notified)));
}

// Push serveur (pour plus tard : un serveur pourra envoyer {title, body, carId}).
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch (_) { d = { title: 'Mon Garage', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Mon Garage', { body: d.body || '', icon: 'icons/icon-192.png', data: { carId: d.carId } }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const carId = e.notification.data && e.notification.data.carId;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list[0];
    if (w) { w.postMessage({ openCar: carId }); return w.focus(); }
    return self.clients.openWindow('./' + (carId ? '?car=' + carId : ''));
  }));
});
