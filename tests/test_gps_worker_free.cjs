'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const mod=import(pathToFileURL(path.resolve(__dirname,'../gps-worker/src/index.mjs')).href);
const NOW=Date.UTC(2026,10,17,15,0,0);
const FEED=[{NL:'120',NV:'BUS-A',HR:'20261117115930',LT:-19.8695,LG:-43.9675,DG:90},
 {NL:'999',NV:'BUS-B',HR:'20261117115930',LT:-19.8800,LG:-43.9700},
 {NL:'120',NV:'BUS-OLD',HR:'20261117103000',LT:-19.8695,LG:-43.9675},
 {NL:'120',NV:'BUS-BAD',HR:'20261117115900',LT:70,LG:80}];
const request=(path,opts={})=>new Request('https://externo-bh-gps-free.workers.dev'+path,
 {headers:{Origin:'https://hubufmg.web.app'},...opts});
test('only official line NL records are returned, with immutable fix timestamp',async()=>{
 const {handleGpsRequest}=await mod;
 const urls=[];
 const response=await handleGpsRequest(request('/api/gps?source=CONVENCIONAL&nls=120'),{
   cache:null,now:NOW,fetchFn:async url=>{
     urls.push(url);return new Response(JSON.stringify(FEED),{status:200,headers:{'Content-Type':'application/json'}});
   }
 });
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.available,true);
 assert.equal(data.records.length,1);
 assert.equal(data.records[0].NV,'BUS-A');
 assert.equal(data.records[0].HR,'20261117115930');
 assert.equal(data.records[0].NL,'120');
 assert.ok(!('passengerLat' in data));
 assert.deepEqual(urls,['https://temporeal.pbh.gov.br/?param=D']);
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://hubufmg.web.app');
 assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('unauthorized Origin, unsupported source and arbitrary URLs are rejected without upstream fetch',async()=>{
 const {handleGpsRequest}=await mod;
 let calls=0;
 const options={cache:null,now:NOW,fetchFn:async()=>{calls++;throw Error('not allowed')}};
 const badOrigin=new Request('https://foo.workers.dev/api/gps?source=CONVENCIONAL&nls=120',
 {headers:{Origin:'https://third-party.example'}});
 assert.equal((await handleGpsRequest(badOrigin,options)).status,403);
 for(const url of [
  '/api/gps?source=HACK&nls=120',
  '/api/gps?source=CONVENCIONAL&nls=120%2Cabc',
  '/api/gps?source=CONVENCIONAL&nls=120&url=https://example.com',
  '/api/gps?source=CONVENCIONAL&nls=120,120',
  '/api/forward?source=CONVENCIONAL&nls=120'
 ]){
   const result=await handleGpsRequest(request(url),options);
   assert.ok(result.status>=400);
 }
 assert.equal(calls,0);
});
test('no live data is fabricated when PBH fails',async()=>{
 const {handleGpsRequest}=await mod;
 const result=await handleGpsRequest(request('/api/gps?source=SUPLEMENTAR&nls=120'),{
   cache:null,now:NOW,fetchFn:async()=>{throw Error('origin offline')}
 });
 assert.equal(result.status,503);
 assert.deepEqual(await result.json(),{available:false,error:'GPS_SOURCE_UNAVAILABLE',reason:'WORKER_PROCESSING_ERROR'});
});
test('the bridge refuses a non-array feed and oversized body',async()=>{
 const {handleGpsRequest}=await mod;
 for(const input of ['{}',JSON.stringify({error:'PBH backend'})]){
   const response=await handleGpsRequest(request('/api/gps?source=CONVENCIONAL&nls=120'),{
    cache:null,now:NOW,fetchFn:async()=>new Response(input,{status:200})
   });
   assert.equal(response.status,503);
 }
 const huge=await handleGpsRequest(request('/api/gps?source=CONVENCIONAL&nls=120'),{
   cache:null,now:NOW,fetchFn:async()=>new Response('[]',{
     headers:{'Content-Length':String(14*1024*1024)}})
 });
 assert.equal(huge.status,503);
});
test('OPTIONS only permits approved origin and GET is read only',async()=>{
 const {handleGpsRequest}=await mod;
 const preflight=await handleGpsRequest(request('/api/gps',{method:'OPTIONS'}),{cache:null,now:NOW});
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://hubufmg.web.app');
 const post=await handleGpsRequest(request('/api/gps?source=CONVENCIONAL&nls=120',{method:'POST'}),{cache:null,now:NOW});
 assert.equal(post.status,405);
});

test('same NL query uses normalized per-POP cache without repeating PBH fetch',async()=>{
 const {handleGpsRequest}=await mod;
 const items=new Map();
 const cache={
   match:async key=>items.get(key.url)||null,
   put:async(key,response)=>{items.set(key.url,response)}
 };
 let downloads=0;
 const options={cache,now:NOW,fetchFn:async()=>{
   downloads++;
   return new Response(JSON.stringify(FEED),{status:200});
 }};
 const req=request('/api/gps?source=CONVENCIONAL&nls=120');
 const first=await handleGpsRequest(req,options);
 const second=await handleGpsRequest(req,{...options,now:NOW+5000});
 assert.equal(first.status,200);
 assert.equal(second.status,200);
 assert.equal(downloads,1);
 assert.equal((await second.json()).records.length,1);
 assert.ok([...items.keys()].some(url=>url.includes('/__gps_cache/filtered/')));
});

test('Worker reports bounded, safe failure categories without leaking upstream details',async()=>{
 const {handleGpsRequest}=await mod;
 const endpoint=request('/api/gps?source=CONVENCIONAL&nls=120');
 const scenarios=[
  {upstream:async()=>new Response('restricted',{status:403}),expected:'PBH_HTTP_ERROR'},
  {upstream:async()=>new Response('[]',{headers:{'Content-Length':String(15*1024*1024)}}),expected:'PBH_RESPONSE_TOO_LARGE'},
  {upstream:async()=>new Response('{"oops":true}',{status:200}),expected:'PBH_FORMAT_UNEXPECTED'},
  {upstream:async()=>new Response('{invalid json',{status:200}),expected:'PBH_INVALID_JSON'}
 ];
 for(const {upstream,expected} of scenarios){
  const response=await handleGpsRequest(endpoint,{cache:null,now:NOW,fetchFn:upstream});
  assert.equal(response.status,503);
  const data=await response.json();
  assert.equal(data.error,'GPS_SOURCE_UNAVAILABLE');
  assert.equal(data.reason,expected);
  assert.ok(!JSON.stringify(data).includes('restricted'));
 }
});
