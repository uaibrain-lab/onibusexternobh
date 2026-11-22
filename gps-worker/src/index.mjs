import {parseVehiclePositions} from './gtfs-rt.mjs';
import {SUMOB_FEEDS} from './sumob-feeds.mjs';
import {parseTripUpdates} from './gtfs-rt-trip-updates.mjs';
import {officialStopPredictions} from './arrival-predictions.mjs';
import {parseServiceAlerts} from './service-alerts.mjs';
/* Externo BH GPS reader: independent Cloudflare Workers Free candidate.
 * No KV, D1, secret, scheduled task, paid plan, private geolocation or routing.
 * Disabled at the client until public PBH access and Free quotas are verified.
 */
const FEEDS=Object.freeze({
  CONVENCIONAL:'https://temporeal.pbh.gov.br/?param=D',
  SUPLEMENTAR:'https://temporeal.pbh.gov.br/?param=SD'
});
const ORIGINS=new Set([
  'https://hubufmg.web.app',
  'https://hubufmg.firebaseapp.com',
  // Firebase Hosting preview channel for isolated Hub UFMG QA.
  'https://hubufmg--homologacao-exbdd4qe.web.app',
  // Isolated Pages Free project for GPS homologation; never a wildcard.
  'https://externo-bh-hml-uaibrain.pages.dev'
]);
// Alternative official SUMOB GTFS-RT feed, publicly catalogued under CC BY 4.0.
// Endpoint is fixed: callers cannot supply their own URL.
const REALTIME_URL=SUMOB_FEEDS.vehiclePositions;
// SUMOB/PBH public CC BY 4.0 feed published at dados.pbh.gov.br.
// Caller can NEVER supply the upstream host or feed credentials.
const TRIP_UPDATES_URL=SUMOB_FEEDS.tripUpdates;
const SERVICE_ALERTS_URL=SUMOB_FEEDS.serviceAlerts;
const RT_MAX_BODY=8*1024*1024;
const API_VERSION='p24-gtfs-rt-geocode-20261117-1';
const MAX_BODY=12*1024*1024;
const MAX_RESPONSE_ROWS=1500;
const MIN_CACHE_SECONDS=25;
function headers(origin){
  const h=new Headers({'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer','Vary':'Origin'});
  if(ORIGINS.has(origin)){
    h.set('Access-Control-Allow-Origin',origin);
    h.set('Access-Control-Allow-Methods','GET, OPTIONS');
    h.set('Access-Control-Allow-Headers','Accept');
    h.set('Access-Control-Max-Age','3600');
  }
  return h;
}
function reply(body,status,origin){
  return new Response(JSON.stringify(body),{status,headers:headers(origin)});
}
function codeTimestamp(hr){
  const value=String(hr||'');
  if(!/^\d{14}$/.test(value))return NaN;
  const a=Number(value.slice(0,4)),b=Number(value.slice(4,6)),c=Number(value.slice(6,8));
  const h=Number(value.slice(8,10)),m=Number(value.slice(10,12)),s=Number(value.slice(12,14));
  if(b<1||b>12||c<1||c>31||h>23||m>59||s>59)return NaN;
  const t=Date.UTC(a,b-1,c,h+3,m,s);
  if(new Date(t-10800000).getUTCDate()!==c)return NaN;
  return t;
}
function parseFeed(body,nls,now){
  const records=JSON.parse(body);
  if(!Array.isArray(records))throw Error('PBH_NON_ARRAY');
  const filtered=[];
  for(const record of records){
    if(!record||typeof record!=='object')continue;
    const NL=String(record.NL??'').trim();
    if(!nls.has(NL))continue;
    const NV=String(record.NV??'').trim();
    const HR=String(record.HR??'').trim();
    const t=codeTimestamp(HR);
    const LT=Number(String(record.LT??'').replace(',','.'));
    const LG=Number(String(record.LG??'').replace(',','.'));
    if(!/^[A-Za-z0-9_.-]{1,30}$/.test(NV)||
       !Number.isFinite(t)||t>now+60000||t<now-12*60000||
       !Number.isFinite(LT)||!Number.isFinite(LG)||
       LT<-20.5||LT>-19.4||LG<-44.5||LG>-43.4)continue;
    const DG=Number(record.DG);
    filtered.push({NL,NV,HR,LT,LG,
      DG:Number.isFinite(DG)&&DG>=0&&DG<=360?DG:null});
    if(filtered.length>MAX_RESPONSE_ROWS)throw Error('GPS_TOO_MANY_MATCHES');
  }
  return {records:filtered,sourceRows:records.length};
}
async function readFeed(source,{fetchFn,cache,ctx,now,requestUrl}){
  // The Cache API key uses this Worker's real host, never a synthetic .invalid host.
  const key=new Request(new URL('/__gps_cache/raw/'+source,requestUrl));
  if(cache){
    try{
      const cached=await cache.match(key);
      if(cached&&cached.ok){
        const body=await cached.text();
        if(body.length<=MAX_BODY)return body;
      }
    }catch(_) { /* Optional free cache is best effort. */ }
  }
  const signal=typeof AbortSignal.timeout==='function'?AbortSignal.timeout(9000):undefined;
  const response=await fetchFn(FEEDS[source],{
    headers:{Accept:'application/json'},redirect:'manual',signal
  });
  if(!response.ok||response.status>=300)throw Error('PBH_HTTP_'+response.status);
  const length=Number(response.headers.get('content-length')||'0');
  if(length>MAX_BODY)throw Error('PBH_TOO_LARGE');
  const body=await response.text();
  if(body.length>MAX_BODY)throw Error('PBH_TOO_LARGE');
  if(cache){
    const store=cache.put(key,new Response(body,{
      headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+MIN_CACHE_SECONDS}
    })).catch(()=>{});
    if(ctx?.waitUntil)ctx.waitUntil(store);
    else await store;
  }
  return body;
}
async function readServiceAlerts({fetchFn,cache,ctx,requestUrl}){
  const key=new Request(new URL('/__gps_cache/raw/SERVICE_ALERTS',requestUrl));
  if(cache){
    try{
      const hit=await cache.match(key);
      if(hit?.ok){
        const bytes=await hit.arrayBuffer();
        if(bytes.byteLength>=5&&bytes.byteLength<=RT_MAX_BODY)return bytes;
      }
    }catch{/* cache opcional */}
  }
  const response=await fetchFn(SERVICE_ALERTS_URL,{
    headers:{Accept:'application/x-protobuf,application/octet-stream'},
    redirect:'manual',
    signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(9000):undefined
  });
  if(!response.ok||response.status>=300)throw Error('ALERTS_HTTP_'+response.status);
  if(Number(response.headers.get('content-length')||0)>RT_MAX_BODY)
    throw Error('GTFS_RT_ALERTS_TOO_LARGE');
  const body=await response.arrayBuffer();
  if(body.byteLength<5||body.byteLength>RT_MAX_BODY)throw Error('GTFS_RT_ALERTS_TOO_LARGE');
  if(cache){
    const put=cache.put(key,new Response(body,{headers:{
      'Content-Type':'application/octet-stream',
      'Cache-Control':'public, max-age='+MIN_CACHE_SECONDS
    }})).catch(()=>{});
    if(ctx?.waitUntil)ctx.waitUntil(put);else await put;
  }
  return body;
}
async function alertsRequest(url,origin,{fetchFn,cache,ctx,now}){
  const stop=String(url.searchParams.get('stop')||'');
  const raw=String(url.searchParams.get('routes')||'');
  const routes=raw?raw.split(','):[];
  if([...url.searchParams.keys()].some(k=>k!=='stop'&&k!=='routes')||
     url.searchParams.getAll('stop').length>1||
     url.searchParams.getAll('routes').length>1||
     (!stop&&!routes.length)||(stop&&!/^[0-9]{1,20}$/.test(stop))||
     routes.length>25||routes.some(r=>!/^[A-Za-z0-9_.:-]{1,70}$/.test(r))||
     new Set(routes).size!==routes.length)
    return reply({available:false,error:'INVALID_REQUEST'},400,origin);
  const key=new Request(new URL('/__gps_cache/filtered/alerts?stop='+encodeURIComponent(stop)+
    '&routes='+encodeURIComponent([...routes].sort().join(',')),url));
  if(cache){
    try{
      const hit=await cache.match(key);
      if(hit?.ok){
        const data=await hit.json();
        const age=now-Date.parse(data.fetchedAt||'');
        if(data?.available===true&&age>=0&&age<=30000&&
           Array.isArray(data.items))return reply(data,200,origin);
      }
    }catch{/* cache opcional */}
  }
  try{
    const raw=await readServiceAlerts({fetchFn,cache,ctx,requestUrl:url.href});
    const feed=parseServiceAlerts(raw,{
      stopId:stop||null,routes,nowSeconds:Math.floor(now/1000)
    });
    const data={available:true,source:'SUMOB_GTFS_RT_ALERTS',
      fetchedAt:new Date(now).toISOString(),
      feedTimestamp:new Date(feed.feedTimestamp*1000).toISOString(),
      items:feed.alerts,attribution:'Superintendência de Mobilidade Urbana de Belo Horizonte (SUMOB)',
      license:'CC BY 4.0'};
    if(cache){
      const put=cache.put(key,new Response(JSON.stringify(data),{headers:{
        'Content-Type':'application/json',
        'Cache-Control':'public, max-age='+MIN_CACHE_SECONDS
      }})).catch(()=>{});
      if(ctx?.waitUntil)ctx.waitUntil(put);else await put;
    }
    return reply(data,200,origin);
  }catch(error){
    const msg=String(error?.message||'');
    const reason=/^ALERTS_HTTP_[0-9]{3}$/.test(msg)?'UPSTREAM_HTTP':
      msg==='GTFS_RT_ALERTS_TOO_LARGE'?'FEED_TOO_LARGE':
      msg==='GTFS_RT_ALERTS_INVALID'?'FEED_INVALID_OR_STALE':
      error?.name==='AbortError'||error?.name==='TimeoutError'?'UPSTREAM_TIMEOUT':
      'SOURCE_UNAVAILABLE';
    return reply({available:false,error:'ALERTS_UNAVAILABLE',reason,
      source:'SUMOB_GTFS_RT_ALERTS'},503,origin);
  }
}
async function readTripUpdates({fetchFn,cache,ctx,requestUrl}){
  const key=new Request(new URL('/__gps_cache/raw/TRIP_UPDATES',requestUrl));
  if(cache){
    try{
      const cached=await cache.match(key);
      if(cached?.ok){
        const bytes=await cached.arrayBuffer();
        if(bytes.byteLength>=5&&bytes.byteLength<=RT_MAX_BODY)return bytes;
      }
    }catch{ /* Cache opcional. */ }
  }
  const response=await fetchFn(TRIP_UPDATES_URL,{
    headers:{Accept:'application/x-protobuf,application/octet-stream'},
    redirect:'manual',
    signal:typeof AbortSignal.timeout==='function'?AbortSignal.timeout(9000):undefined
  });
  if(!response.ok||response.status>=300)throw Error('ETA_HTTP_'+response.status);
  if(Number(response.headers.get('content-length')||0)>RT_MAX_BODY)
    throw Error('GTFS_RT_TRIP_UPDATES_TOO_LARGE');
  const body=await response.arrayBuffer();
  if(body.byteLength<5||body.byteLength>RT_MAX_BODY)
    throw Error('GTFS_RT_TRIP_UPDATES_TOO_LARGE');
  if(cache){
    const put=cache.put(key,new Response(body,{headers:{
      'Content-Type':'application/octet-stream',
      'Cache-Control':'public, max-age='+MIN_CACHE_SECONDS
    }})).catch(()=>{});
    if(ctx?.waitUntil)ctx.waitUntil(put);else await put;
  }
  return body;
}
async function arrivalRequest(url,origin,{fetchFn,cache,ctx,now}){
  const stop=url.searchParams.get('stop');
  if(url.searchParams.getAll('stop').length!==1||
     [...url.searchParams.keys()].some(k=>k!=='stop')||
     !/^[0-9]{1,20}$/.test(String(stop||'')))
    return reply({available:false,error:'INVALID_STOP'},400,origin);
  const key=new Request(new URL('/__gps_cache/filtered/arrivals/'+stop,url));
  if(cache){
    try{
      const hit=await cache.match(key);
      if(hit?.ok){
        const data=await hit.json();
        if(data?.available===true&&data.stopId===stop&&
           now-Date.parse(data.fetchedAt||'')<30000&&
           now>=Date.parse(data.fetchedAt||'')&&Array.isArray(data.items))
          return reply(data,200,origin);
      }
    }catch{/* Cache opcional. */}
  }
  try{
    const raw=await readTripUpdates({fetchFn,cache,ctx,requestUrl:url.href});
    const parsed=parseTripUpdates(raw,Math.floor(now/1000));
    const items=officialStopPredictions(parsed,stop,Math.floor(now/1000));
    const data={available:true,source:'SUMOB_GTFS_RT_TRIP_UPDATES',
      stopId:stop,fetchedAt:new Date(now).toISOString(),
      feedTimestamp:new Date(parsed.feedTimestamp*1000).toISOString(),
      items,attribution:'Superintendência de Mobilidade Urbana de Belo Horizonte (SUMOB)',
      license:'CC BY 4.0'};
    if(cache){
      const put=cache.put(key,new Response(JSON.stringify(data),{headers:{
        'Content-Type':'application/json',
        'Cache-Control':'public, max-age='+MIN_CACHE_SECONDS
      }})).catch(()=>{});
      if(ctx?.waitUntil)ctx.waitUntil(put);else await put;
    }
    return reply(data,200,origin);
  }catch(err){
    const message=String(err?.message||'');
    const reason=/^ETA_HTTP_[0-9]{3}$/.test(message)?'UPSTREAM_HTTP':
      message==='GTFS_RT_TRIP_UPDATES_TOO_LARGE'?'FEED_TOO_LARGE':
      message==='GTFS_RT_TRIP_UPDATES_INVALID'?'FEED_INVALID_OR_STALE':
      err?.name==='TimeoutError'||err?.name==='AbortError'?'UPSTREAM_TIMEOUT':
      'SOURCE_UNAVAILABLE';
    return reply({available:false,error:'ARRIVALS_UNAVAILABLE',reason,
      source:'SUMOB_GTFS_RT_TRIP_UPDATES'},503,origin);
  }
}
async function readRealtime({fetchFn,cache,ctx,requestUrl}){
  const key=new Request(new URL('/__gps_cache/raw/GTFS_RT',requestUrl));
  if(cache){
    try{
      const hit=await cache.match(key);
      if(hit&&hit.ok){
        const bytes=await hit.arrayBuffer();
        if(bytes.byteLength>0&&bytes.byteLength<=RT_MAX_BODY)return bytes;
      }
    }catch(_){/* Optional edge cache; fail open to live source. */}
  }
  const signal=typeof AbortSignal.timeout==='function'?AbortSignal.timeout(9000):undefined;
  const response=await fetchFn(REALTIME_URL,{
    headers:{Accept:'application/x-protobuf,application/octet-stream'},
    redirect:'manual',signal
  });
  if(!response.ok||response.status>=300)throw Error('RT_HTTP_'+response.status);
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>RT_MAX_BODY)throw Error('GTFS_RT_TOO_LARGE');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength>RT_MAX_BODY)throw Error('GTFS_RT_TOO_LARGE');
  if(cache){
    const put=cache.put(key,new Response(bytes,{
      headers:{'Content-Type':'application/octet-stream',
        'Cache-Control':'public, max-age='+MIN_CACHE_SECONDS}
    })).catch(()=>{});
    if(ctx?.waitUntil)ctx.waitUntil(put);else await put;
  }
  return bytes;
}

// P24: static no-cost address lookup relay. A fixed Photon origin plus bounded
// public OSM region prevents arbitrary URL fetching/SSRF. Only an explicit
// click on supported Externo BH origin can call this endpoint. Edge-cache
// reduces upstream usage; no coordinate of the passenger is ever forwarded.
const PHOTON_URL='https://photon.komoot.io/api/';
const GEO_MAX_BYTES=64*1024;
const GEO_TTL_SECONDS=86400;
function geocodeProperties(f){
  const coords=f?.geometry?.coordinates;
  if(!Array.isArray(coords)||coords.length<2)return null;
  const lng=Number(coords[0]),lat=Number(coords[1]);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||
     lat<-20.45||lat>-19.50||lng<-44.40||lng>-43.50)return null;
  const p=f?.properties||{};
  const label=[p.name,p.street,p.housenumber,p.district,p.city||p.county]
    .filter(v=>typeof v==='string'||typeof v==='number')
    .map(v=>String(v).trim()).filter(Boolean);
  const title=[...new Set(label)].join(' · ').slice(0,200);
  return title?{lat,lng,label:title,source:'Photon / OpenStreetMap'}:null;
}
async function geocodeRequest(url,origin,{fetchFn,cache,ctx}){
  // Unlike GPS status, geocoding is not accessible cross-origin or from
  // origin-less scraping: all supported origins are already whitelisted.
  if(!ORIGINS.has(origin))
    return reply({available:false,error:'ORIGIN_REQUIRED'},403,origin);
  if([...url.searchParams.keys()].some(k=>k!=='q')||
     url.searchParams.getAll('q').length!==1)
    return reply({available:false,error:'INVALID_QUERY'},400,origin);
  const query=String(url.searchParams.get('q')||'').trim().replace(/\s+/g,' ');
  if(query.length<3||query.length>130||
     !/^[\p{L}\p{N}\s.,º°ª#'"/-]+$/u.test(query))
    return reply({available:false,error:'INVALID_QUERY'},400,origin);
  const key=new Request(new URL('/__geocode_cache/v1?q='+encodeURIComponent(
    query.toLocaleLowerCase('pt-BR')),url));
  if(cache){
    try{
      const cached=await cache.match(key);
      if(cached?.ok){
        const data=await cached.json();
        if(data?.available===true&&Array.isArray(data.items))
          return reply(data,200,origin);
      }
    }catch(_){/* edge cache is best-effort */}
  }
  const upstream=new URL(PHOTON_URL);
  upstream.searchParams.set('q',query);
  upstream.searchParams.set('lang','pt');
  upstream.searchParams.set('limit','12');
  // Fixed BH bias and area, never request geolocation coordinates.
  upstream.searchParams.set('lat','-19.9208');
  upstream.searchParams.set('lon','-43.9378');
  upstream.searchParams.set('bbox','-44.4,-20.45,-43.5,-19.5');
  try{
    const res=await fetchFn(upstream.href,{method:'GET',redirect:'manual',
      headers:{Accept:'application/json'},
      signal:typeof AbortSignal.timeout==='function'?
        AbortSignal.timeout(7000):undefined
    });
    if(res.status===429)return reply({
      available:false,error:'GEOCODE_RATE_LIMITED',provider:'Photon'
    },429,origin);
    if(!res.ok||res.status>=300)return reply({
      available:false,error:'GEOCODE_UPSTREAM_UNAVAILABLE',
      provider:'Photon',upstreamStatus:res.status
    },503,origin);
    if(Number(res.headers.get('content-length')||0)>GEO_MAX_BYTES)
      return reply({available:false,error:'GEOCODE_RESPONSE_TOO_LARGE'},503,origin);
    const raw=await res.text();
    if(raw.length>GEO_MAX_BYTES)
      return reply({available:false,error:'GEOCODE_RESPONSE_TOO_LARGE'},503,origin);
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed?.features))
      return reply({available:false,error:'GEOCODE_FORMAT_ERROR'},503,origin);
    const items=[],seen=new Set();
    for(const feature of parsed.features.slice(0,24)){
      const place=geocodeProperties(feature);
      if(!place)continue;
      const distinct=place.lat.toFixed(5)+','+place.lng.toFixed(5);
      if(seen.has(distinct))continue;
      seen.add(distinct);items.push(place);
      if(items.length>=8)break;
    }
    const data={available:true,source:'Photon / OpenStreetMap',items};
    if(cache){
      const operation=cache.put(key,new Response(JSON.stringify(data),{
        headers:{'Content-Type':'application/json',
          'Cache-Control':'public, max-age='+GEO_TTL_SECONDS}
      })).catch(()=>{});
      if(ctx?.waitUntil)ctx.waitUntil(operation);else await operation;
    }
    return reply(data,200,origin);
  }catch(e){
    return reply({available:false,error:'GEOCODE_UPSTREAM_UNAVAILABLE',
      reason:e?.name==='TimeoutError'||e?.name==='AbortError'?
        'TIMEOUT':'NETWORK_OR_FORMAT_ERROR',provider:'Photon'},503,origin);
  }
}

export async function handleGpsRequest(request,{fetchFn=fetch,cache=globalThis.caches?.default,ctx=null,now=Date.now()}={}){
  const origin=request.headers.get('Origin')||'';
  if(origin&&!ORIGINS.has(origin))return reply({available:false,error:'ORIGIN_NOT_ALLOWED'},403,origin);
  if(request.method==='OPTIONS'){
    if(!origin)return reply({error:'ORIGIN_REQUIRED'},400,origin);
    const h=headers(origin);h.set('Cache-Control','no-store');
    return new Response(null,{status:204,headers:h});
  }
  if(request.method!=='GET')return reply({available:false,error:'METHOD_NOT_ALLOWED'},405,origin);
  const url=new URL(request.url);
  // Probe requires no upstream request; distinguishes stale Worker deployments
  // from malformed GPS parameters or errors returned by the official feed.
  if(url.pathname==='/api/gps/capabilities')
    return reply({service:'Externo BH GPS',apiVersion:API_VERSION,
      supportedSources:['CONVENCIONAL','SUPLEMENTAR','GTFS_RT'],
      geocodingSupported:true,tripUpdatesSupported:true,serviceAlertsSupported:true,
      tripUpdatesEndpoint:'/api/arrivals?stop=14791950',
      dataSourceVerified:false},200,origin);
  if(url.pathname==='/api/geocode')
    return geocodeRequest(url,origin,{fetchFn,cache,ctx});
  if(url.pathname==='/api/arrivals')
    return arrivalRequest(url,origin,{fetchFn,cache,ctx,now});
  if(url.pathname==='/api/alerts')
    return alertsRequest(url,origin,{fetchFn,cache,ctx,now});
  if(url.pathname!=='/api/gps')return reply({available:false,error:'NOT_FOUND'},404,origin);
  const source=url.searchParams.get('source');
  const rt=source==='GTFS_RT';
  const raw=url.searchParams.get(rt?'routes':'nls')||'';
  const names=raw.split(',').filter(Boolean);
  const pattern=rt?/^[A-Za-z0-9_.:-]{1,70}$/:/^\d{1,8}$/;
  if((!rt&&!Object.hasOwn(FEEDS,source))||!names.length||names.length>50||
     names.some(x=>!pattern.test(x))||
     new Set(names).size!==names.length||
     [...url.searchParams.keys()].some(k=>k!=='source'&&k!==(rt?'routes':'nls')))
    return reply({available:false,error:'INVALID_REQUEST'},400,origin);
  try{
    // Cache normalized output for repeated line queries at each Free POP.
    // Exact NL set is sorted to avoid duplicate cache keys; never store CORS
    // headers, coordinates of passengers, or a response older than 30s.
    const normalizedNLs=[...names].sort().join(',');
    const key=new Request(new URL('/__gps_cache/filtered/'+source+'/'+normalizedNLs,url));
    if(cache){
      try{
        const hit=await cache.match(key);
        if(hit&&hit.ok){
          const data=await hit.json();
          const age=now-Date.parse(data.fetchedAt||'');
          if(data.available===true&&data.source===source&&
             Number.isFinite(age)&&age>=0&&age<=30000&&
             Array.isArray(data.records)){
            return reply(data,200,origin);
          }
        }
      }catch(_){/* Cache is always optional, even when corrupted. */}
    }
    let result;
    if(rt){
      const bytes=await readRealtime({fetchFn,cache,ctx,requestUrl:url.href});
      result=parseVehiclePositions(bytes,names,now);
    }else{
      const body=await readFeed(source,{fetchFn,cache,ctx,now,requestUrl:url.href});
      result=parseFeed(body,new Set(names),now);
    }
    const data={available:true,source,
      fetchedAt:new Date(now).toISOString(),records:result.records,
      ...(rt?{feedEntities:result.sourceEntities,
        vehicleEntities:result.vehicleEntities,
        missingRouteIds:result.missingRouteIds,
        sampleRouteIds:result.sampleRouteIds,
        attribution:'Superintendência de Mobilidade Urbana de Belo Horizonte (SUMOB)',license:'CC BY 4.0'}:{})};
    if(cache){
      const put=cache.put(key,new Response(JSON.stringify(data),{
        headers:{'Content-Type':'application/json',
          'Cache-Control':'public, max-age='+MIN_CACHE_SECONDS}
      })).catch(()=>{});
      if(ctx?.waitUntil)ctx.waitUntil(put);else await put;
    }
    return reply(data,200,origin);
  }catch(error){
    // Report only a fixed diagnostic category, not arbitrary upstream
    // exception text, response bodies, URLs, or infrastructure internals.
    const message=String(error?.message||'');
    let reason='WORKER_PROCESSING_ERROR';
    if(/^PBH_HTTP_[0-9]{3}$/.test(message))reason='PBH_HTTP_ERROR';
    else if(message==='PBH_TOO_LARGE')reason='PBH_RESPONSE_TOO_LARGE';
    else if(message==='PBH_NON_ARRAY')reason='PBH_FORMAT_UNEXPECTED';
    else if(message==='GPS_TOO_MANY_MATCHES')reason='GPS_RESULT_LIMIT';
    else if(error instanceof SyntaxError)reason='PBH_INVALID_JSON';
    else if(/^RT_HTTP_[0-9]{3}$/.test(message))reason='GTFS_RT_HTTP_ERROR';
    else if(message==='GTFS_RT_PROTO_INVALID')reason='GTFS_RT_INVALID_PROTOBUF';
    else if(message==='GTFS_RT_TOO_LARGE')reason='GTFS_RT_TOO_LARGE';
    else if(message==='GTFS_RT_TOO_MANY_ENTITIES')reason='GTFS_RT_TOO_MANY_ENTITIES';
    else if(error?.name==='TimeoutError'||error?.name==='AbortError')
      reason=rt?'GTFS_RT_TIMEOUT':'PBH_TIMEOUT';
    else if(error instanceof TypeError)reason=rt?'GTFS_RT_NETWORK_ERROR':'PBH_NETWORK_ERROR';
    const match=/^(?:PBH|RT)_HTTP_([1-5][0-9]{2})$/.exec(message);
    // HTTP status is safe to expose; upstream bodies/headers stay private.
    const upstreamStatus=match?Number(match[1]):null;
    return reply({available:false,error:'GPS_SOURCE_UNAVAILABLE',reason,
      ...(upstreamStatus!==null?{upstreamStatus}:{})},503,origin);
  }
}
export default {fetch(request,env,ctx){return handleGpsRequest(request,{ctx});}};
