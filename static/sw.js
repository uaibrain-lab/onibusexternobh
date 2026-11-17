/* Offline app shell only. Never cache location queries, GPS data or OSM tiles. */
const CACHE='hub-externo-static-p8-r1';
const SHELL=['./','./index.html','./app.js','./style.css','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('hub-externo-static-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const u=new URL(req.url);
  if(u.origin!==self.location.origin||u.pathname.includes('/api/'))return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).catch(async()=> (await caches.match('./index.html'))||Response.error()));
    return;
  }
  const shell=new Set(SHELL.filter(p=>p!=='./').map(p=>new URL(p,self.registration.scope).pathname));
  if(!shell.has(u.pathname))return;
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req)));
});
