import {parseVehiclePositions} from './gtfs-rt.mjs';
/* Externo BH GPS reader: independent Cloudflare Workers Free candidate.
 * No KV, D1, secret, scheduled task, paid plan, private geolocation or routing.
 * Disabled at the client until public PBH access and Free quotas are verified.
 */
const FEEDS=Object.freeze({
  CONVENCIONAL:'https://temporeal.pbh.gov.br/?param=D',
  SUPLEMENTAR:'https://temporeal.pbh.gov.br/?param=SD'
});
const ORIGINS=new Set(['https://hubufmg.web.app','https://hubufmg.firebaseapp.com']);
// Alternative official SUMOB GTFS-RT feed, publicly catalogued under CC BY 4.0.
// Endpoint is fixed: callers cannot supply their own URL.
const REALTIME_URL='http://realtime4.mobilibus.com/web/4ch6j/vehicle-positions?accesskey=982a57efd77a9462bf1665696fb25984';
const RT_MAX_BODY=8*1024*1024;
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
