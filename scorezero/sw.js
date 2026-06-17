const CACHE_NAME = 'scorezero-beta7-20260618';
const FILES = ['./','./index.html?v=beta7','./style.css?v=beta7','./app.js?v=beta7','./manifest.json?v=beta7'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(FILES))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => { e.respondWith(fetch(e.request).catch(() => caches.match(e.request))); });
