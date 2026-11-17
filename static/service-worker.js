/* P8: same-origin bounded offline caching for the free-static preview only.
 * Never intercept third-party maps, authenticated data or Hub UFMG root.
 * No predownload of 100+ MB: store at most 16 used hourly GTFS shards.
 */
'use strict';
const SHELL='externo-p8-shell-v1',SHARDS='externo-p8-gtfs-hours-v1';
const MAX_SHARDS=16;
const scope=new URL(self.registration.scope);
const base=scope.pathname.endsWith('/')?scope.pathname:scope.pathname+'/';
const shellPaths=[
  base,base+'index.html',base+'app.js',base+'style.css',
  base+'route-worker.js',base+'catalog/metro.json',
  base+'catalog/scan/index.json'
];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(SHELL);
    await cache.addAll(shellPaths);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(n=>
      n.startsWith('externo-p')&&!([SHELL,SHARDS].includes(n)))
      .map(n=>caches.delete(n)));
    await self.clients.claim();
  })());
});
async function networkFirst(request,cacheName) {
  const cache=await caches.open(cacheName);
  try{
    const response=await fetch(request);
    if(response.ok){
      try{await cache.put(request,response.clone())}
      catch(e){/* QuotaExceededError must not block a valid online response. */}
    }
    return response;
  }catch(error){
    const hit=await cache.match(request,{ignoreSearch:request.url?.includes('/index.json')});
    if(hit)return hit;
    throw error;
  }
}
async function boundedCache(request){
  const cache=await caches.open(SHARDS);
  const cached=await cache.match(request);
  if(cached)return cached;
  const response=await fetch(request);
  if(!response.ok)return response;
  try{
    await cache.put(request,response.clone());
    const keys=await cache.keys();
    if(keys.length>MAX_SHARDS){
      await Promise.all(keys.slice(0,keys.length-MAX_SHARDS).map(req=>cache.delete(req)));
    }
  }catch(e){
    // Limited mobile storage should never prevent a route that was downloaded.
  }
  return response;
}
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==scope.origin||!url.pathname.startsWith(base))return;
  const relative=url.pathname.slice(base.length);
  if(/^catalog\/scan\/(out|in)\/\d+\/\d{2}\.bin\.gz$/.test(relative)||
     /^catalog\/scan\/(out|in)\/\d{2}\.bin\.gz$/.test(relative)){
    event.respondWith(boundedCache(request));return;
  }
  if(shellPaths.includes(url.pathname)){
    event.respondWith(networkFirst(request,SHELL));
  }
});
