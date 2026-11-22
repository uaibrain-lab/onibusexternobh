'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../gps-worker/src');
const reader=import(pathToFileURL(path.join(root,'gtfs-rt.mjs')).href);
const worker=import(pathToFileURL(path.join(root,'index.mjs')).href);
const NOW=Date.UTC(2026,10,17,16,0);
const ts=Math.floor((NOW-60_000)/1000);
const txt=s=>new TextEncoder().encode(s);
function varint(num){
  const parts=[];
  do{const v=num%128;num=Math.floor(num/128);parts.push(v+(num?128:0))}while(num);
  return parts;
}
function bytes(...chunks){return Uint8Array.from(chunks.flatMap(c=>Array.from(c)))}
function field(n,v){return bytes(varint(n*8+2),varint(v.length),v)}
function integral(n,v){return bytes(varint(n*8),varint(v))}
function float(n,v){const out=new Uint8Array(5);out[0]=n*8+5;
  new DataView(out.buffer).setFloat32(1,v,true);return out}
function vehicle({route='562055',id='BUS-17',when=ts,lat=-19.870,lng=-43.966,
  trip='TRIP-1',direction=0}={}){
  const tripInfo=bytes(field(1,txt(trip)),field(5,txt(route)),integral(6,direction));
  const location=bytes(float(1,lat),float(2,lng),float(3,80));
  const descriptor=field(1,txt(id));
  return bytes(field(1,tripInfo),field(2,location),integral(5,when),field(8,descriptor));
}
function feed(vehicles){
  const header=bytes(field(1,txt('2.0')),integral(2,0),integral(3,ts));
  return bytes(field(1,header),...vehicles.map((v,i)=>
    field(2,bytes(field(1,txt(String(i+1))),field(4,vehicle(v))))));
}
const req=path=>new Request('https://externo-bh-gps-free.hubufmg.workers.dev'+path,
 {headers:{Origin:'https://hubufmg.web.app'}});
test('homologation Pages origin permitted by CORS without wildcard or GPS call',async()=>{
  const {handleGpsRequest}=await worker;
  let network=0;
  const request=new Request('https://externo-bh-gps-free.hubufmg.workers.dev/api/gps/capabilities',{
    headers:{Origin:'https://externo-bh-hml-uaibrain.pages.dev'}
  });
  const res=await handleGpsRequest(request,{
    cache:null,now:NOW,fetchFn:async()=>{network++;throw Error('no feed')}
  });
  assert.equal(res.status,200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'),
               'https://externo-bh-hml-uaibrain.pages.dev');
  assert.equal(network,0);
  const forbidden=new Request(request.url,{
    headers:{Origin:'https://random-stage.pages.dev'}
  });
  assert.equal((await handleGpsRequest(forbidden,{cache:null,now:NOW})).status,403);
});

test('Firebase homologacao exact Origin is permitted, other preview URLs stay blocked',async()=>{
  const {handleGpsRequest}=await worker;
  const allowed='https://hubufmg--homologacao-exbdd4qe.web.app';
  const target='https://externo-bh-gps-free.hubufmg.workers.dev/api/gps/capabilities';
  let upstream=0;
  for(const method of ['GET','OPTIONS']){
    const request=new Request(target,{method,headers:{Origin:allowed}});
    const res=await handleGpsRequest(request,{cache:null,now:NOW,
      fetchFn:async()=>{upstream++;throw Error('Unexpected upstream call')}});
    assert.equal(res.status,method==='GET'?200:204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'),allowed);
  }
  const disallowed=new Request(target,{
    headers:{Origin:'https://hubufmg--homologacao-outro.web.app'}});
  const blocked=await handleGpsRequest(disallowed,{cache:null,now:NOW});
  assert.equal(blocked.status,403);
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'),null);
  assert.equal(upstream,0);
});

test('capability probe exposes Worker revision and GTFS-RT support without contacting PBH',async()=>{
  const {handleGpsRequest}=await worker;
  let calls=0;
  const res=await handleGpsRequest(req('/api/gps/capabilities'),{
    cache:null,now:NOW,fetchFn:async()=>{calls++;throw Error('unexpected upstream')}
  });
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.apiVersion,'p24-gtfs-rt-geocode-20261117-1');
  assert.ok(data.supportedSources.includes('GTFS_RT'));
  assert.equal(calls,0);
});
test('GTFS-RT wire parser accepts official VehiclePosition shape and keeps only fresh matching route',async()=>{
  const {parseVehiclePositions}=await reader;
  const raw=feed([
    {route:'562055',id:'A'},
    {route:'5102',id:'B'},
    {route:'562055',id:'OLD',when:ts-2000},
    {route:'562055',id:'INVALID',lat:90},
    {route:'562055',id:'A',when:ts-10}
  ]);
  const result=parseVehiclePositions(raw,['562055'],NOW);
  assert.equal(result.sourceEntities,5);
  assert.equal(result.vehicleEntities,5);
  assert.equal(result.missingRouteIds,0);
  assert.deepEqual([...result.sampleRouteIds].sort(),['5102','562055']);
  assert.equal(result.records.length,1);
  assert.equal(result.records[0].routeId,'562055');
  assert.equal(result.records[0].vehicleId,'A');
  assert.equal(result.records[0].tripId,'TRIP-1');
  assert.equal(result.records[0].directionId,0);
  assert.equal(result.records[0].lastGpsFixAt,new Date(ts*1000).toISOString());
  assert.ok(Math.abs(result.records[0].latitude+19.87)<0.0001);
  assert.ok(!('etaMinutes' in result.records[0]));
});
test('invalid/truncated protobuf and bodies above 8 MiB are rejected',async()=>{
  const {parseVehiclePositions}=await reader;
  for(const invalid of [new Uint8Array(),new Uint8Array([10,200]),new Uint8Array([10,2,50,46])]){
    assert.throws(()=>parseVehiclePositions(invalid,['562055'],NOW));
  }
  assert.throws(()=>parseVehiclePositions(new Uint8Array(8*1024*1024+1),['562055'],NOW),
    /GTFS_RT_TOO_LARGE/);
});
test('optional GTFS RT endpoint reads fixed official source, responds CORS and metadata without ETA',async()=>{
  const {handleGpsRequest}=await worker;
  let urls=[];
  const response=await handleGpsRequest(req('/api/gps?source=GTFS_RT&routes=562055%2C5102'),{
    cache:null,now:NOW,fetchFn:async (url,options)=>{
      urls.push(url);
      assert.equal(options.redirect,'manual');
      const raw=feed([{route:'562055',id:'Q'},{route:'5102',id:'Z'}]);
      return new Response(raw,{status:200,headers:{'Content-Type':'application/x-protobuf'}});
    }
  });
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://hubufmg.web.app');
  const data=await response.json();
  assert.equal(data.available,true);
  assert.equal(data.source,'GTFS_RT');
  assert.equal(data.feedEntities,2);
  assert.equal(data.vehicleEntities,2);
  assert.deepEqual([...data.sampleRouteIds].sort(),['5102','562055']);
  assert.equal(data.records.length,2);
  assert.equal(data.attribution,'Superintendência de Mobilidade Urbana de Belo Horizonte (SUMOB)');
  assert.equal(data.license,'CC BY 4.0');
  assert.equal(data.records[0].vehicleId,'Q');
  assert.ok(!('etaMinutes' in data.records[0]));
  assert.equal(urls.length,1);
  assert.ok(urls[0].includes('/vehicle-positions?accesskey='));
});
test('GTFS RT access failure exposes HTTP status and never upstream response body',async()=>{
  const {handleGpsRequest}=await worker;
  for(const upstreamStatus of [301,403,429,500]){
    const response=await handleGpsRequest(req('/api/gps?source=GTFS_RT&routes=562055'),{
      cache:null,now:NOW,
      fetchFn:async()=>new Response('internal error details here',{status:upstreamStatus,headers:{Location:'https://example.invalid'}})
    });
    assert.equal(response.status,503);
    const body=await response.json();
    assert.equal(body.reason,'GTFS_RT_HTTP_ERROR');
    assert.equal(body.upstreamStatus,upstreamStatus);
    assert.ok(!JSON.stringify(body).includes('internal error details'));
  }
});
test('reject arbitrary feed URLs, malformed routes, missing parameters, mismatched origin',async()=>{
  const {handleGpsRequest}=await worker;
  let upstreamCalls=0;
  const opts={cache:null,now:NOW,fetchFn:async()=>{upstreamCalls++;throw Error('no')}};
  for(const url of [
    '/api/gps?source=GTFS_RT',
    '/api/gps?source=GTFS_RT&routes=562055&url=https://evil.example',
    '/api/gps?source=GTFS_RT&routes=562055,562055',
    '/api/gps?source=GTFS_RT&routes=%2Fetc%2Fpasswd',
    '/api/gps?source=GTFS_RT&nls=393',
    '/api/gps?source=CONVENCIONAL&routes=562055'
  ]){
    const response=await handleGpsRequest(req(url),opts);
    assert.equal(response.status,400,url);
  }
  const wrong=new Request('https://externo-bh-gps-free.hubufmg.workers.dev/api/gps?source=GTFS_RT&routes=562055',
  {headers:{Origin:'https://evil.example'}});
  assert.equal((await handleGpsRequest(wrong,opts)).status,403);
  assert.equal(upstreamCalls,0);
});
test('valid official GTFS-RT with no matching route is available, not a fake zero-bus claim',async()=>{
  const {handleGpsRequest}=await worker;
  const response=await handleGpsRequest(req('/api/gps?source=GTFS_RT&routes=999999'),{
    cache:null,now:NOW,fetchFn:async()=>new Response(feed([{route:'562055',id:'A'}]),{status:200})
  });
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.feedEntities,1);
  assert.equal(data.records.length,0);
});
