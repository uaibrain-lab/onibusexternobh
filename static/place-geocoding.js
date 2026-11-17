/* Optional user-triggered OSM address/POI lookup.
 * Photon public demo: one request ONLY when user presses Buscar local.
 * No autocomplete, no background batch, no paid plan, no passenger GPS.
 * The submitted text is sent to a third party; transit planning remains local.
 * Public demo is fair-use, not guaranteed: always keep stops/map fallback.
 */
'use strict';
const GeoPlaces=(()=>{
  const BASE='https://photon.komoot.io/api/';
  const BBOX={south:-20.45,north:-19.45,west:-44.45,east:-43.45};
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
    url.searchParams.set('bbox','-44.45,-20.45,-43.45,-19.45');
    const response=await fetchFn(url.href,{method:'GET',mode:'cors',
      headers:{Accept:'application/json'},cache:'no-store',
      signal:AbortSignal.timeout(10000)});
    if(!response.ok){
      if(response.status===429)throw Error('Busca externa limitada temporariamente; use o mapa ou pontos');
      throw Error('Busca externa indisponível (HTTP '+response.status+')');
    }
    const items=parse(await response.json());
    cache.set(key,{items,at:now});
    if(cache.size>40)cache.delete(cache.keys().next().value);
    return items.map(x=>({...x}));
  }
  return {search,parse,inArea};
})();
