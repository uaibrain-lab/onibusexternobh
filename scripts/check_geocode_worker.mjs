#!/usr/bin/env node
/* P24: one-shot check of the already-deployed Free geocoding relay.
 * This is not a load test; sends only ONE fixed, non-personal OSM query.
 * Called by the stage deployment gate AFTER optional Worker update.
 */
'use strict';
const worker='https://externo-bh-gps-free.hubufmg.workers.dev';
const origin='https://externo-bh-hml-uaibrain.pages.dev';
const options={headers:{Origin:origin,Accept:'application/json'},
 cache:'no-store',signal:AbortSignal.timeout(12000)};
async function main(){
  const capabilities=await fetch(worker+'/api/gps/capabilities',options);
  const metadata=await capabilities.json();
  if(capabilities.status!==200||metadata.geocodingSupported!==true||
     capabilities.headers.get('access-control-allow-origin')!==origin){
    throw Error('P24_WORKER_GEOCODE_NOT_DEPLOYED: publique Worker com -AtualizarWorker');
  }
  const url=worker+'/api/geocode?q='+encodeURIComponent('Belo Horizonte');
  const response=await fetch(url,options);
  const body=await response.json();
  if(response.status!==200||body.available!==true||
     !Array.isArray(body.items)||!body.items.length||
     response.headers.get('access-control-allow-origin')!==origin){
    console.error('P24_GEOCODE_SOURCE_STATUS',JSON.stringify({
      http:response.status,error:body.error||null,reason:body.reason||null,
      upstreamStatus:body.upstreamStatus||null
    }));
    throw Error('P24_GEOCODE_SOURCE_UNAVAILABLE: servidor externo não retornou locais no teste');
  }
  console.log('P24_WORKER_GEOCODE_OK');
  console.log('P24_GEOCODE_RESULTS='+body.items.length);
  console.log('P24_EXTERNAL_REQUESTS=1 (no passenger coordinates, no load test)');
}
main().catch(error=>{
 console.error('P24_GEOCODE_CHECK_FAILED: '+error.message);
 process.exitCode=2;
});
