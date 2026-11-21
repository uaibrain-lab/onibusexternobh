/* Optional user-triggered OSM address/POI lookup.
 * Photon public demo: one request ONLY when user presses Buscar local.
 * No autocomplete, no background batch, no paid plan, no passenger GPS.
 * The submitted text is sent to a third party; transit planning remains local.
 * Public demo is fair-use, not guaranteed: always keep stops/map fallback.
 */
'use strict';
const GeoPlaces=(()=>{
  const BASE='https://photon.komoot.io/api/';
  const BBOX={south:-20.45,north:-19.50,west:-44.40,east:-43.50};
  const cache=new Map();
  let lastRequest=0;
  const norm=q=>String(q||'').trim().replace(/\s+/g,' ');
  const inArea=(lat,lng)=>lat>=BBOX.south&&lat<=BBOX.north&&
    lng>=BBOX.west&&lng<=BBOX.east;
  function label(p){
    const parts=[p.name,p.street,p.housenumber,p.district,p.city||p.county]
      .filter(Boolean).map(String);
    const unique=[...new Set(parts)];
    return unique.join(' · ').slice(0,200);
  }
  function parse(body){
    if(!body||!Array.isArray(body.features))throw Error('Resposta de locais inesperada');
    const seen=new Set(),items=[];
    for(const f of body.features.slice(0,18)){
      const coords=f?.geometry?.coordinates;
      if(!Array.isArray(coords)||coords.length<2)continue;
      const lng=Number(coords[0]),lat=Number(coords[1]);
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||!inArea(lat,lng))continue;
      const p=f.properties||{};
      const title=label(p);
      if(!title||seen.has(title.toLowerCase()))continue;
      seen.add(title.toLowerCase());
      items.push({lat,lng,label:title,source:'Photon / OpenStreetMap'});
      if(items.length===6)break;
    }
    return items;
  }
  async function search(query,{fetchFn=fetch,now=Date.now()}={}){
    const q=norm(query);
    if(q.length<3||q.length>130)throw Error('Digite entre 3 e 130 caracteres');
    const key=q.toLocaleLowerCase('pt-BR');
    const hit=cache.get(key);
    if(hit&&now-hit.at<30*60*1000)return hit.items.map(x=>({...x}));
    // Prevent rapid repeated requests in one tab; no automatic retry.
    if(now-lastRequest<1300)throw Error('Aguarde um instante antes de buscar outro local');
    lastRequest=now;
    const url=new URL(BASE);
    url.searchParams.set('q',q);
    url.searchParams.set('lang','pt');
    url.searchParams.set('limit','12');
    url.searchParams.set('lat','-19.9208'); // fixed BH center, never user's GPS
    url.searchParams.set('lon','-43.9378');
    url.searchParams.set('bbox',[BBOX.west,BBOX.south,BBOX.east,BBOX.north].join(','));
    const officialOrigin=typeof location==='object'?String(location.origin):'';
    const allowedOrigins=new Set([
      'https://externo-bh-hml-uaibrain.pages.dev',
      'https://hubufmg.web.app',
      'https://hubufmg.firebaseapp.com'
    ]);
    // The public Photon demo has no uptime guarantee and browser CORS may
    // fail. Use our existing no-cost Worker when the page is on a whitelisted
    // origin. During phased rollout (Worker not yet deployed), HTTP 404
    // falls back to direct Photon; never bypass upstream 429 throttling.
    const viaRelay=allowedOrigins.has(officialOrigin);
    const endpoint=viaRelay
      ?'https://externo-bh-gps-free.hubufmg.workers.dev/api/geocode?q='+encodeURIComponent(q)
      :url.href;
    const request={method:'GET',mode:'cors',
      headers:{Accept:'application/json'},cache:'no-store',
      signal:typeof AbortSignal.timeout==='function'?
        AbortSignal.timeout(10000):undefined};
    let response,usingRelay=viaRelay;
    try{
      response=await fetchFn(endpoint,request);
    }catch(error){
      if(!usingRelay)throw Error('Não foi possível acessar o Photon (rede ou CORS); escolha no mapa');
      throw Error('Não foi possível acessar o serviço de endereços do Externo; escolha no mapa');
    }
    if(usingRelay&&response.status===404){
      usingRelay=false;
      response=await fetchFn(url.href,request);
    }
    if(!response.ok){
      if(response.status===429)throw Error('Busca externa limitada temporariamente; use o mapa ou pontos');
      if(usingRelay){
        let reason='';
        try{reason=String((await response.json()).error||'')}catch(_){}
        throw Error('Geocodificação indisponível no Worker'+
          (reason?': '+reason:' (HTTP '+response.status+')')+
          '. Use o mapa ou pontos locais.');
      }
      throw Error('Busca Photon indisponível (HTTP '+response.status+'); use o mapa');
    }
    const data=await response.json();
    if(usingRelay&&data?.available!==true)
      throw Error('Resposta de endereços indisponível no Worker');
    const items=usingRelay
      ?(Array.isArray(data.items)?data.items:[]).filter(item=>
        Number.isFinite(Number(item.lat))&&Number.isFinite(Number(item.lng))&&
        inArea(Number(item.lat),Number(item.lng))).slice(0,6)
      :parse(data);
    cache.set(key,{items,at:now});
    if(cache.size>40)cache.delete(cache.keys().next().value);
    return items.map(x=>({...x}));
  }
  return {search,parse,inArea};
})();
