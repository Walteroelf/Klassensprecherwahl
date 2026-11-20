/*
 * sw.js – macht die App offline nutzbar.
 * Beim ersten Öffnen (mit Internet) werden die App-Dateien gespeichert.
 * Danach startet die App ohne Internet. Hier liegen nur Programmdateien, keine Wahldaten.
 * Bei einer neuen App-Version bitte die Nummer unten erhöhen.
 */
var CACHE = 'klassensprecherwahl-v25';
var FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'design.css?v=3', 'schriften/andika-400.woff2', 'schriften/andika-700.woff2',
  'js/dom.js', 'js/logic.js', 'js/db.js', 'js/security.js', 'js/qr.js', 'js/qrscan.js', 'js/link.js', 'js/reveal.js', 'js/export.js', 'js/app.js', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(function (hit) { return hit || fetch(e.request); }));
});
