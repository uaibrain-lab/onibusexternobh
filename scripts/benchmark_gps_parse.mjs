#!/usr/bin/env node
/* Synthetic local timing only. NOT Cloudflare CPU metering and NOT a live PBH sample.
 * Uses the actual Free GPS Worker handler with a mocked public feed.
 */
import {performance} from 'node:perf_hooks';
import {handleGpsRequest} from '../gps-worker/src/index.mjs';
const MiB=1048576,now=Date.UTC(2026,10,17,15,0);
const request=new Request('https://example.workers.dev/api/gps?source=CONVENCIONAL&nls=393',
  {headers:{Origin:'https://hubufmg.web.app'}});
for(const n of [1000,10000,30000]){
  const rows=Array.from({length:n},(_,i)=>({
    NL:String(i%1199===393?393:i%1199),NV:String(i),HR:'20261117115930',
    LT:-19.9+(i%10)*.002,LG:-43.9,DG:90
  }));
  const raw=JSON.stringify(rows);
  const times=[];
  for(let k=0;k<7;k++){
    const begin=performance.now();
    const response=await handleGpsRequest(request,{now,cache:null,
      fetchFn:async()=>new Response(raw,{status:200,
        headers:{'Content-Type':'application/json'}})});
    const body=await response.json();
    if(response.status!==200||body.available!==true)
      throw Error('Worker rejeitou benchmark sintético: '+response.status);
    times.push(performance.now()-begin);
  }
  times.sort((a,b)=>a-b);
  console.log(JSON.stringify({kind:'synthetic_node_not_cloudflare',
    rows:n,rawMiB:+(Buffer.byteLength(raw)/MiB).toFixed(2),
    medianWallMs:+times[3].toFixed(2),
    pWorstWallMs:+times.at(-1).toFixed(2),
    workersFreeCpuLimitMs:10,
    caveat:'Node wall time is not Cloudflare CPU: live egress benchmark required'}));
}
