/**
 * Non-destructive canary check of the DEPLOYED Cloudflare eta-qa Worker.
 * This does NOT deploy anything and does not log raw trips, routes, vehicles,
 * location or credential-bearing upstream URLs. Run after manual QA deploy.
 */
import {writeFile} from 'node:fs/promises';

const BASE='https://externo-bh-gps-eta-qa.hubufmg.workers.dev';
const ORIGIN='https://hubufmg--homologacao-exbdd4qe.web.app';
const checks=[
  {name:'capabilities',path:'/api/gps/capabilities'},
  {name:'tripUpdates',path:'/api/arrivals?stop=14791950&routes=8551',
    source:'SUMOB_GTFS_RT_TRIP_UPDATES',maxAgeSeconds:120},
  {name:'serviceAlerts',path:'/api/alerts?stop=14791950&routes=8551',
    source:'SUMOB_GTFS_RT_ALERTS',maxAgeSeconds:600}
];
async function run({name,path,source,maxAgeSeconds}){
  const out={name,reachable:false,valid:false};
  try{
    const response=await fetch(BASE+path,{
      headers:{Origin:ORIGIN,Accept:'application/json'},
      redirect:'manual',signal:AbortSignal.timeout(10000)
    });
    out.status=response.status;
    if(response.status!==200)throw Error('NON_200');
    out.reachable=true;
    if(response.headers.get('Access-Control-Allow-Origin')!==ORIGIN)
      throw Error('CORS_MISMATCH');
    const type=response.headers.get('Content-Type')||'';
    if(!type.includes('application/json'))throw Error('CONTENT_TYPE');
    const json=await response.json();
    if(name==='capabilities'){
      if(json.tripUpdatesSupported!==true||json.serviceAlertsSupported!==true)
        throw Error('FEATURE_MISSING');
    }else{
      if(json.available!==true||json.source!==source||
         !Array.isArray(json.items))throw Error('SOURCE_INCOMPATIBLE');
      const ts=Date.parse(json.feedTimestamp||'');
      const age=(Date.now()-ts)/1000;
      if(!Number.isFinite(age)||age< -60||age>maxAgeSeconds)
        throw Error('FEED_STALE');
      if(name==='tripUpdates'&&
         (json.relativeUpdates!==undefined&&!Array.isArray(json.relativeUpdates)))
        throw Error('RELATIVE_UPDATES_INVALID');
      out.hasRelativeUpdates=name==='tripUpdates'&&
        Array.isArray(json.relativeUpdates);
      out.items=json.items.length;
      // Deliberately don't log a trip id, stop sequence, or passenger location.
    }
    out.valid=true;
  }catch(error){
    const m=String(error?.message||'');
    out.reason=m==='NON_200'?'HTTP_STATUS':
      m==='CORS_MISMATCH'?'CORS_MISMATCH':
      m==='CONTENT_TYPE'?'NOT_JSON':
      m==='FEATURE_MISSING'?'OLD_WORKER':
      m==='SOURCE_INCOMPATIBLE'?'API_INCOMPATIBLE':
      m==='FEED_STALE'?'FEED_STALE':
      m==='RELATIVE_UPDATES_INVALID'?'BAD_RELATIVE_PAYLOAD':
      error?.name==='TimeoutError'||error?.name==='AbortError'?'TIMEOUT':
      'NETWORK_OR_DNS';
  }
  return out;
}
const results=await Promise.all(checks.map(run));
const summary={checkedAt:new Date().toISOString(),target:'eta-qa-only',
  status:results.every(r=>r.valid)?'READY':'NOT_READY',checks:results};
await writeFile('eta-qa-live-health.json',JSON.stringify(summary,null,2)+'\n');
for(const item of results)
  console.log(item.name+': '+(item.valid?'OK':item.reason)+(item.status?' HTTP_'+item.status:''));
console.log('ETA_QA_LIVE_HEALTH='+summary.status);
if(summary.status!=='READY')process.exitCode=1;
