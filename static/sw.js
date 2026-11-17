/* P11: network-first shell, offline fallback; NEVER cache GPS/API, geolocation or OSM tiles. */
const CACHE='hub-externo-static-p11-r1';
const SHELL=['./index.html','./app.js','./style.css','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
const shellPaths=new Set(SHELL.map(file=>new URL(file,self.registration.scope).pathname));
const fallback=new URL('./index.html',self.registration.scope).href;

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(k=>k.startsWith('hub-externo-static-')&&k!==CACHE)
       .map(k=>caches.delete(k))
  )).then(()=>self.clients.claim()));
});
async function latestOrCached(request,cacheKey){
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch(request);
    if(response.ok&&response.type==='basic'){
      // Only the designated static shell is stored. A failed cache write must
      // never break the online response (e.g. low-storage Android devices).
      await cache.put(cacheKey,response.clone()).catch(()=>{});
    }
    return response;
  }catch(error){
    return (await cache.match(cacheKey))||Response.error();
  }
}
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||url.pathname.includes('/api/'))return;
  if(request.mode==='navigate'){
    if(!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
    event.respondWith(latestOrCached(request,fallback));
    return;
  }
  if(!shellPaths.has(url.pathname))return;
  const canonical=new URL(url.pathname,url.origin).href;
  event.respondWith(latestOrCached(request,canonical));
});
