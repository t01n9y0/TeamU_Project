const CACHE_NAME = 'scorezero-beta15';
const FILES = ['./','./index.html','./style.css?v=beta15','./app.js?v=beta15','./niuniu.js?v=beta15','./manifest.json?v=beta15','./icon.png','./icon.png?v=beta15','./tribute.webp?v=2','./poker-portrait.webp'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(FILES)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k.startsWith('scorezero-') && k!==CACHE_NAME).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const {request}=e;
  if(request.method!=='GET' || !request.url.startsWith(self.registration.scope)) return;
  const url=new URL(request.url);
  if(request.mode==='navigate'){
    e.respondWith(fetch(request).catch(()=>caches.match(new URL('./index.html',self.registration.scope))));
  } else if(FILES.some(file=>new URL(file,self.registration.scope).href===url.href)){
    e.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
  }
});
