/* P7 real-data smoke test: browser-like Web Worker with local static assets.
 * No network or paid service. Prints runtime, downloaded bytes and variants.
 */
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
async function main(){
  const prefix=path.resolve('catalog/scan');
  if(!fs.existsSync(path.join(prefix,'index.json'))){
    console.log('STATIC_REAL_SKIPPED: no generated index');
    return;
  }
  const messages=[];
  let transferred=0;
  let downloads=0;
  const getFile=async url=>{
    const parsed=new URL(url);
    let rel;
    if(parsed.pathname.endsWith('/catalog/metro.json'))
      rel=path.resolve('catalog/metro.json');
    else {
      const suffix=parsed.pathname.split('/catalog/scan/')[1];
      if(!suffix||suffix.includes('..'))return new Response('not found',{status:404});
      rel=path.resolve(prefix,suffix);
    }
    if(!rel.startsWith(path.resolve('catalog')+path.sep))
      return new Response('not found',{status:404});
    if(!fs.existsSync(rel))return new Response('not found',{status:404});
    const contents=fs.readFileSync(rel);
    transferred+=contents.length;downloads++;
    return new Response(contents,{status:200});
  };
  const worker={postMessage:msg=>messages.push(msg)};
  const context=vm.createContext({
    self:worker,fetch:getFile,Date,URL,Intl,Blob,Response,
    DecompressionStream,TextDecoder,Uint8Array,Uint32Array,
    Map,Set,Error,Number,Math,Promise,String,Array,console,
  });
  vm.runInContext(fs.readFileSync('static/route-worker.js','utf-8'),context,
    {filename:'route-worker.js'});
  const baseUrl='https://local.test/externo/catalog/scan/';
  await worker.onmessage({data:{kind:'init',seq:1,baseUrl}});
  const ready=messages.find(m=>m.kind==='ready');
  assert.ok(ready,messages.filter(m=>m.kind==='error').map(m=>m.message).join('; '));
  const pointA={lat:-19.8695,lng:-43.9675};
  const pointB={lat:-19.918,lng:-43.938};
  for(const [i,mode,preference] of [[2,'departAt','fastest'],
                                     [3,'arriveBy','leastTransfers']]){
    messages.length=0;
    const start=performance.now(),before=transferred;
    await worker.onmessage({data:{kind:'plan',seq:i,baseUrl,params:{
      origin:pointA,destination:pointB,at:'2026-11-18T08:00:00-03:00',
      mode,preference}}});
    const error=messages.find(m=>m.kind==='error');
    if(error)throw Error(error.message);
    const result=messages.find(m=>m.kind==='result')?.data;
    assert.ok(result,'Worker returned no result');
    assert.ok(['ok','partial'].includes(result.status),result.status);
    for(const t of result.itineraries){
      assert.ok(t.durationMinutes>=0);
      assert.ok(Date.parse(t.arrival)>=Date.parse(t.departure));
      assert.ok(t.transfers>=0&&t.transfers<=2);
    }
    console.log('STATIC_ROUTING_REAL',JSON.stringify({
      mode,status:result.status,
      itineraries:result.itineraries.length,
      ms:Math.round(performance.now()-start),
      networkMB:Math.round((transferred-before)/1048576*100)/100,
      downloadedFiles:downloads,scanned:result.stats.connectionsScanned,
      firstLines:result.itineraries[0]?.legs.filter(x=>x.mode==='bus').map(x=>x.line)
    }));
  }
  console.log('STATIC_ROUTER_SMOKE_OK');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
