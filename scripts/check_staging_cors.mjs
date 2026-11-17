#!/usr/bin/env node
/* P17: diagnostics-only check of exact CORS staging origin.
 * Uses Node's built-in fetch, not Windows PowerShell 5.1 Schannel.
 * Read-only; never deploys, calls the SUMOB feed, or alters configuration.
 */
'use strict';
const url='https://externo-bh-gps-free.hubufmg.workers.dev/api/gps/capabilities';
const expectedOrigin='https://externo-bh-hml-uaibrain.pages.dev';
const timeoutMs=15000;
const now=()=>new Date().toISOString();
function shortError(error){
  const text=String(error?.cause?.code||error?.code||error?.message||'UNKNOWN_NETWORK_ERROR');
  return text.slice(0,160);
}
async function check(){
  const start=performance.now();
  let response,body={};
  try{
    response=await fetch(url,{
      headers:{Origin:expectedOrigin,Accept:'application/json'},
      cache:'no-store',signal:AbortSignal.timeout(timeoutMs)
    });
    const text=await response.text();
    try{body=JSON.parse(text)}catch(_){body={error:'NON_JSON_RESPONSE'}}
  }catch(error){
    console.error('P17_CORS_PROBE_NETWORK_FAILED',JSON.stringify({
      at:now(),reason:shortError(error),url,expectedOrigin
    }));
    process.exitCode=2;
    return;
  }
  const receivedOrigin=response.headers.get('access-control-allow-origin');
  const result={
    at:now(),url,
    httpStatus:response.status,
    workerApiVersion:body.apiVersion||null,
    workerError:body.error||null,
    originExpected:expectedOrigin,
    originReceived:receivedOrigin||null,
    methods:response.headers.get('access-control-allow-methods')||null,
    elapsedMs:Math.round(performance.now()-start)
  };
  console.log(JSON.stringify(result,null,2));
  if(response.status!==200||body.apiVersion!=='p16-gtfs-rt-20261117-1'||
     !Array.isArray(body.supportedSources)||
     !body.supportedSources.includes('GTFS_RT')||
     receivedOrigin!==expectedOrigin){
    console.error('P17_CORS_PROBE_FAILED: verifique httpStatus, workerError e originReceived');
    process.exitCode=2;
    return;
  }
  console.log('P17_CORS_PROBE_OK');
}
check().catch(error=>{
  console.error('P17_CORS_PROBE_UNEXPECTED_FAILURE',shortError(error));
  process.exitCode=2;
});
