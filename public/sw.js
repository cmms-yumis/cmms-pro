'use strict';
// Service worker: kesira ljusku aplikacije (HTML/CSS/JS/ikone) da se otvori i bez veze.
// API pozivi se NIKAD ne kesiraju (podaci uvek dolaze sa servera).
const CACHE = 'cmms-shell-v4-0-0';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/icons.js', '/js/core.js', '/js/print.js', '/js/views.js', '/js/modals.js', '/js/app.js', '/manifest.json', '/icons/icon-192.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('/index.html'))));
});
