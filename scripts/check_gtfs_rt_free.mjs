#!/usr/bin/env node
/* One-shot, read-only GTFS-RT live test on Cloudflare Workers Free.
 * Never deploys, writes config, loops, stores positions or calls a paid API.
 */
'use strict';
const argv=Object.fromEntries(process.argv.slice(2).map(arg=>{
  const i=arg.indexOf('=');return [arg.slice(2,i<0?undefined:i),i<0?'':arg.slice(i+1)];
}));
const endpoint=argv.worker||'https://externo-bh-gps-free.hubufmg.workers.dev/api/gps';
const routes=argv.routes||'562055,5102'; // Official GTFS id and public code of UFMG/Santo Antônio
async function run(){
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.pathname!=='/api/gps'||url.search||url.hash)
    throw Error('A URL do Worker deve usar HTTPS e terminar em /api/gps');
  url.searchParams.set('source','GTFS_RT');
  url.searchParams.set('routes',routes);
  const start=performance.now();
  const response=await fetch(url,{
    headers:{Origin:'https://hubufmg.web.app',Accept:'application/json'},
    cache:'no-store',signal:AbortSignal.timeout(12000)
  });
  const raw=await response.text();
  let data;
  try{data=JSON.parse(raw)}catch(_){throw Error('RESPOSTA_NAO_JSON: HTTP '+response.status)}
  const result={
    http:response.status,
    workerReachable:true,
    source:data.source||'GTFS_RT',
    upstreamError:data.error||null,
    reason:data.reason||null,
    upstreamStatus:data.upstreamStatus??null,
    corsAuthorized:response.headers.get('Access-Control-Allow-Origin')==='https://hubufmg.web.app',
    feedEntities:Number.isSafeInteger(data.feedEntities)?data.feedEntities:null,
    vehicleEntities:Number.isSafeInteger(data.vehicleEntities)?data.vehicleEntities:null,
    missingRouteIds:Number.isSafeInteger(data.missingRouteIds)?data.missingRouteIds:null,
    sampleRouteIds:Array.isArray(data.sampleRouteIds)?data.sampleRouteIds.slice(0,12):[],
    matchedVehicles:Array.isArray(data.records)?data.records.length:null,
    matchingRoutes:routes,
    transferBytes:new TextEncoder().encode(raw).length,
    elapsedMs:Math.round(performance.now()-start),
    checkedAt:new Date().toISOString()
  };
  if(Array.isArray(data.records)){
    const ages=data.records.map(v=>Date.now()-Date.parse(v.lastGpsFixAt||''))
      .filter(ms=>Number.isFinite(ms));
    result.freshestFixAgeSeconds=ages.length?Math.round(Math.min(...ages)/1000):null;
    result.matchedRouteIds=[...new Set(data.records.map(v=>v.routeId))].sort();
  }
  console.log(JSON.stringify(result,null,2));
  if(!response.ok||data.available!==true||!result.corsAuthorized){
    console.error('GTFS_RT_PUBLIC_TEST_FAILED: veja reason e upstreamStatus acima');
    process.exitCode=2;
  }else if(result.matchedVehicles===0){
    console.log('FEED_ACESSIVEL_SEM_VEICULOS_DAS_ROTAS: validar ids de rota e horário');
  }else{
    console.log('GTFS_RT_CLOUDFLARE_RESPONSE_OK: posição recebida; ainda verificar CPU e percurso');
  }
}
run().catch(error=>{
  console.error('GTFS_RT_PUBLIC_TEST_FAILED:',error.message);
  process.exitCode=2;
});
