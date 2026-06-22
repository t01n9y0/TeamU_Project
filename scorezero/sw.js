const CACHE_NAME = 'scorezero-beta11-20260618';
const FILES = ['./','./index.html?v=beta11','./style.css?v=beta11','./app.js?v=beta11','./manifest.json?v=beta11','./icon.png'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(FILES).catch(() => c.addAll(FILES.filter(f => f !== './icon.png')))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(CACHE_NAME).then(c => c.put(e.request, copy)).catch(()=>{});
    return res;
  }).catch(() => caches.match(e.request)));
});
