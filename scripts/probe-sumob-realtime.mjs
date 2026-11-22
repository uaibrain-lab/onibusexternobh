/**
 * Diagnostic read-only for PBH/SUMOB GTFS-RT public endpoints.
 * No credentials, raw protobuf, locations, or vehicle IDs are logged.
 * A failed source becomes a diagnostic status; never triggers a deploy.
 */
import {writeFile} from 'node:fs/promises';
import {SUMOB_FEEDS} from '../gps-worker/src/sumob-feeds.mjs';
import {parseTripUpdates} from '../gps-worker/src/gtfs-rt-trip-updates.mjs';
import {parseServiceAlerts} from '../gps-worker/src/service-alerts.mjs';
import {parseVehiclePositions} from '../gps-worker/src/gtfs-rt.mjs';

const now=Date.now();
const safeReason=error=>{
  if(error?.name==='TimeoutError'||error?.name==='AbortError')return 'TIMEOUT';
  if(/TOO_LARGE/.test(String(error?.message)))return 'TOO_LARGE';
  if(/INVALID|PROTO/.test(String(error?.message)))return 'INVALID_OR_STALE_PROTOBUF';
  if(/^HTTP_/.test(String(error?.message)))return String(error.message);
  return 'FETCH_OR_NETWORK_FAILURE';
};
async function probe(kind,upstream){
  const started=Date.now();
  const basic={kind,accessible:false,parsed:false};
  try{
    const res=await fetch(upstream,{redirect:'manual',headers:{
      Accept:'application/x-protobuf,application/octet-stream'
    },signal:AbortSignal.timeout(10000)});
    if(res.status<200||res.status>=300)throw Error('HTTP_'+res.status);
    if(Number(res.headers.get('content-length')||0)>8*1024*1024)
      throw Error('GTFS_RT_TOO_LARGE');
    const data=new Uint8Array(await res.arrayBuffer());
    if(data.byteLength>8*1024*1024||data.byteLength<5)
      throw Error('GTFS_RT_TOO_LARGE');
    basic.accessible=true;
    basic.bytes=data.byteLength;
    if(kind==='tripUpdates'){
      const parsed=parseTripUpdates(data,Math.floor(now/1000));
      Object.assign(basic,{parsed:true,feedTimestamp:new Date(parsed.feedTimestamp*1000).toISOString(),
        sourceEntities:parsed.sourceEntities,freshTripUpdates:parsed.updates.length,
        withAbsoluteStopTime:parsed.updates.filter(u=>u.stopTimeUpdate?.some(st=>
          Number.isSafeInteger(st.arrival?.time)||Number.isSafeInteger(st.departure?.time))).length,
        withExactStopId:parsed.updates.filter(u=>u.stopTimeUpdate?.some(st=>st.stopId)).length});
    }else if(kind==='serviceAlerts'){
      const parsed=parseServiceAlerts(data,{routes:[],nowSeconds:Math.floor(now/1000)});
      Object.assign(basic,{parsed:true,feedTimestamp:new Date(parsed.feedTimestamp*1000).toISOString(),
        sourceEntities:parsed.sourceEntities});
    }else{
      const parsed=parseVehiclePositions(data,[],now);
      Object.assign(basic,{parsed:true,sourceEntities:parsed.sourceEntities,
        vehicleEntities:parsed.vehicleEntities,missingRouteIds:parsed.missingRouteIds});
    }
  }catch(error){basic.reason=safeReason(error);}
  basic.elapsedMs=Date.now()-started;
  return basic;
}
const results=await Promise.all(Object.entries(SUMOB_FEEDS).map(
  ([kind,url])=>probe(kind,url)));
const output={checkedAt:new Date(now).toISOString(),
  status:results.every(x=>x.parsed)?'ALL_VALID':
    results.some(x=>x.parsed)?'PARTIAL':'NO_VALID_FEEDS',
  items:results};
await writeFile('sumob-feed-diagnostic.json',JSON.stringify(output,null,2)+'\n');
for(const x of results){
  console.log(x.kind+': '+(x.parsed?'VALID':x.reason||'FAILED')+
    ' entities='+(x.sourceEntities??'n/a')+' bytes='+(x.bytes??'n/a'));
}
console.log('SUMOB_LIVE_PROBE='+output.status);
if(process.argv.includes('--require-all')&&output.status!=='ALL_VALID')process.exitCode=1;
