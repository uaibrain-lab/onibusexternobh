'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const worker=import('../gps-worker/src/index.mjs');
const predictions=import('../gps-worker/src/arrival-predictions.mjs');
const NOW=1795120000;
function v(num){let n=BigInt(num);const out=[];while(n>127n){out.push(Number((n&127n)|128n));n>>=7n;}out.push(Number(n));return out;}
function f(n,p){return [...v(n*8+2),...v(p.length),...p];}
function u(n,value){return [...v(n*8),...v(value)];}
function s(n,text){return f(n,[...Buffer.from(text)]);}
function wire({stop='14791950',route='5102',at=NOW+240,tripRelationship,stopRelationship,old=false}={}){
  const trip=[...s(1,'TRIP-5102-A'),...s(3,'20261119'),...s(5,route),
    ...(tripRelationship===undefined?[]:u(4,tripRelationship))];
  const stopInfo=[...u(1,12),...f(2,u(2,at)),...s(4,stop),
    ...(stopRelationship===undefined?[]:u(5,stopRelationship))];
  const update=[...f(1,trip),...f(2,stopInfo),...u(4,old?NOW-130:NOW-10)];
  const entity=[...s(1,'e-1'),...f(3,update)];
  const header=[...s(1,'2.0'),...u(3,NOW)];
  return Uint8Array.from([...f(1,header),...f(2,entity)]);
}
const req=(query,origin='https://hubufmg--homologacao-exbdd4qe.web.app')=>
  new Request('https://externo-bh-gps-free.hubufmg.workers.dev/api/arrivals'+query,
    {headers:{Origin:origin}});
test('ETA oficial por ponto e linha, sem extrapolação de distância',async()=>{
  const {handleGpsRequest}=await worker;
  let urls=[];
  const result=await handleGpsRequest(req('?stop=14791950'),{
    now:NOW*1000,cache:null,fetchFn:async url=>{
      urls.push(url);return new Response(wire(),{status:200});}
  });
  const data=await result.json();
  assert.equal(result.status,200);
  assert.equal(result.headers.get('Access-Control-Allow-Origin'),
    'https://hubufmg--homologacao-exbdd4qe.web.app');
  assert.equal(data.source,'SUMOB_GTFS_RT_TRIP_UPDATES');
  assert.equal(data.stopId,'14791950');
  assert.equal(data.items.length,1);
  assert.equal(data.items[0].routeId,'5102');
  assert.equal(data.items[0].tripId,'TRIP-5102-A');
  assert.equal(data.items[0].at,new Date((NOW+240)*1000).toISOString());
  assert.equal(data.items[0].eventType,'arrival');
  assert.ok(!('distance' in data.items[0])&&!('speed' in data.items[0]));
  assert.equal(urls.length,1);
  assert.match(urls[0],/\/trip-updates\?accesskey=/);
});
test('não atribui ETA a ponto errado, dados antigos ou viagens canceladas',async()=>{
  const {handleGpsRequest}=await worker;
  for(const data of [
    wire({stop:'14790000'}),wire({old:true}),
    wire({tripRelationship:3}),wire({stopRelationship:1}),
    wire({at:NOW+3*3600})
  ]){
    const response=await handleGpsRequest(req('?stop=14791950'),{
      now:NOW*1000,cache:null,fetchFn:async()=>new Response(data)});
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).items,[]);
  }
});
test('feed inválido, parâmetro arbitrário e origem não autorizada falham sem previsão',async()=>{
  const {handleGpsRequest}=await worker;
  const responses=await Promise.all([
    handleGpsRequest(req('?stop=../../etc/passwd'),{cache:null,now:NOW*1000}),
    handleGpsRequest(req('?stop=14791950&url=https://evil.invalid'),{cache:null,now:NOW*1000}),
    handleGpsRequest(req('?stop=14791950','https://evil.example'),{cache:null,now:NOW*1000})
  ]);
  assert.deepEqual(responses.map(x=>x.status),[400,400,403]);
  const fail=await handleGpsRequest(req('?stop=14791950'),{
    now:NOW*1000,cache:null,fetchFn:async()=>new Response('denied',{status:403})
  });
  assert.equal(fail.status,503);
  const error=await fail.json();
  assert.equal(error.reason,'UPSTREAM_HTTP');
  assert.ok(!JSON.stringify(error).includes('denied'));
});
test('cache na borda evita downloads repetidos por 25 segundos',async()=>{
  const {handleGpsRequest}=await worker;
  const entries=new Map();
  const cache={match:async k=>entries.get(k.url)?.clone()||null,
    put:async(k,response)=>{entries.set(k.url,response.clone())}};
  let count=0;
  const options={cache,now:NOW*1000,fetchFn:async()=>{count++;return new Response(wire())}};
  const a=await handleGpsRequest(req('?stop=14791950'),options);
  const b=await handleGpsRequest(req('?stop=14791950'),{...options,now:NOW*1000+5000});
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal(count,1);
});
test('seleção da fonte descarta registros duplos e horários sem stop_id',async()=>{
  const {officialStopPredictions}=await predictions;
  const item={trip:{tripId:'a',routeId:'5102',startDate:'20261119'},
    timestamp:NOW-10,stopTimeUpdate:[{stopId:'14791950',stopSequence:8,
      arrival:{time:NOW+150}}]};
  const decoded={updates:[item,item,{...item,trip:{tripId:'b',routeId:'5102'},
    stopTimeUpdate:[{stopSequence:8,arrival:{time:NOW+180}}]}]};
  const all=officialStopPredictions(decoded,'14791950',NOW);
  assert.equal(all.length,1);
  assert.equal(all[0].at,new Date((NOW+150)*1000).toISOString());
});
