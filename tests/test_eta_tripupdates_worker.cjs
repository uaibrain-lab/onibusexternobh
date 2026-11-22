'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const worker=import('../gps-worker/src/index.mjs');
const predictions=import('../gps-worker/src/arrival-predictions.mjs');
const NOW=1795120000;
function v(num){let n=BigInt(num);if(n<0n)n=BigInt.asUintN(64,n);const out=[];while(n>127n){out.push(Number((n&127n)|128n));n>>=7n;}out.push(Number(n));return out;}
function f(n,p){return [...v(n*8+2),...v(p.length),...p];}
function u(n,value){return [...v(n*8),...v(value)];}
function s(n,text){return f(n,[...Buffer.from(text)]);}
function wire({stop='14791950',route='5102',at=NOW+240,tripRelationship,stopRelationship,
  old=false,withoutTimestamp=false,withoutSequence=false,duplicateStop=false,
  delayOnly=false,delaySeconds=180}={}){
  const trip=[...s(1,'TRIP-5102-A'),...s(2,'19:00:00'),...s(3,'20261119'),...s(5,route),
    ...(tripRelationship===undefined?[]:u(4,tripRelationship))];
  const stopInfo=[...(withoutSequence?[]:u(1,12)),
    ...f(2,delayOnly?u(1,delaySeconds):u(2,at)),...s(4,stop),
    ...(stopRelationship===undefined?[]:u(5,stopRelationship))];
  const update=[...f(1,trip),...f(2,stopInfo),
    ...(duplicateStop?f(2,stopInfo):[]),
    ...(withoutTimestamp?[]:u(4,old?NOW-130:NOW-10))];
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

test('GTFS-RT aceita carimbo individual e sequência opcionais só em casos inequívocos',async()=>{
  const {handleGpsRequest}=await worker;
  const samples=[
    {input:wire({withoutTimestamp:true,withoutSequence:true}),items:1,source:'feed'},
    {input:wire({withoutSequence:true}),items:1,source:'trip'},
    {input:wire({withoutSequence:true,duplicateStop:true}),items:0},
    {input:wire({withoutTimestamp:true,old:true}),items:1,source:'feed'},
    {input:wire({old:true}),items:0}
  ];
  for(const sample of samples){
    const response=await handleGpsRequest(req('?stop=14791950'),{
      now:NOW*1000,cache:null,fetchFn:async()=>new Response(sample.input)});
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.items.length,sample.items);
    if(sample.items){
      assert.equal(data.items[0].freshnessSource,sample.source);
      if(sample.source==='feed')
        assert.equal(data.items[0].lastFeedUpdateAt,new Date(NOW*1000).toISOString());
      if(sample.input===samples[0].input)
        assert.equal('stopSequence' in data.items[0],false);
    }
  }
});
test('o cabeçalho vencido não pode legitimar atualização sem timestamp',async()=>{
  const {handleGpsRequest}=await worker;
  const input=wire({withoutTimestamp:true});
  // Feed header NOW is 3 minutes old even if a data update omitted its timestamp.
  const response=await handleGpsRequest(req('?stop=14791950'),{
    now:(NOW+190)*1000,cache:null,fetchFn:async()=>new Response(input)});
  assert.equal(response.status,503);
  assert.equal((await response.json()).reason,'FEED_INVALID_OR_STALE');
});

test('atraso real vinculado a trip_id e stop_sequence, sem confundir com horário absoluto',async()=>{
  const {handleGpsRequest}=await worker;
  for(const delay of [-65,0,120]){
    const response=await handleGpsRequest(req('?stop=14791950&routes=5102'),{
      now:NOW*1000,cache:null,fetchFn:async()=>new Response(
        wire({delayOnly:true,delaySeconds:delay,withoutTimestamp:true}))});
    assert.equal(response.status,200);
    const data=await response.json();
    assert.deepEqual(data.items,[],'Atraso não pode virar horário de chegada sem GTFS');
    assert.equal(data.relativeUpdates.length,1);
    const update=data.relativeUpdates[0];
    assert.equal(update.delaySeconds,delay);
    assert.equal(update.tripId,'TRIP-5102-A');
    assert.equal(update.observedStopId,'14791950');
    assert.equal(update.observedStopSequence,12);
    assert.equal(update.startDate,'20261119');
    assert.equal(update.startTime,'19:00:00');
  }
  const wrong=await handleGpsRequest(req('?stop=14791950&routes=9999'),{
    now:NOW*1000,cache:null,fetchFn:async()=>new Response(
      wire({delayOnly:true}))});
  assert.equal((await wrong.json()).relativeUpdates.length,0);
});
test('consulta de atrasos proíbe seleção de feed externo, rotas duplicadas e dados sem sequência',async()=>{
  const {handleGpsRequest}=await worker;
  const bad=['?stop=14791950&routes=5102,5102',
    '?stop=14791950&routes=%2F%2Fevil',
    '?stop=14791950&routes=5102&routes=9999',
    '?stop=14791950&routes=5102&url=https://evil.example'];
  for(const q of bad){
    const response=await handleGpsRequest(req(q),{now:NOW*1000,cache:null});
    assert.equal(response.status,400);
  }
  const noSeq=await handleGpsRequest(req('?stop=14791950&routes=5102'),{
    now:NOW*1000,cache:null,fetchFn:async()=>new Response(
      wire({delayOnly:true,withoutSequence:true}))});
  assert.deepEqual((await noSeq.json()).relativeUpdates,[]);
});

test('250 observações são distribuídas entre linhas; linha minoritária não desaparece',async()=>{
  const {officialTripDelays}=await predictions;
  const make=(route,n)=>({
    trip:{tripId:route+'-trip-'+n,routeId:route,
      startDate:'20261119',startTime:'19:00:00'},
    timestamp:NOW-10,
    stopTimeUpdate:[{stopId:'14791950',stopSequence:12,
      arrival:{delay:60}}]
  });
  const feed={feedTimestamp:NOW,updates:[
    ...Array.from({length:270},(_,n)=>make('51',n)),
    ...Array.from({length:10},(_,n)=>make('52',n))
  ]};
  const result=officialTripDelays(feed,['51','52'],NOW);
  assert.equal(result.length,250);
  assert.equal(result.filter(item=>item.routeId==='52').length,10,
    'Linha com poucos ônibus precisa continuar representada');
  assert.equal(result.filter(item=>item.routeId==='51').length,240);
  assert.deepEqual(officialTripDelays(feed,['999'],NOW),[]);
});

test('marcadores oficiais NO_DATA e SKIPPED preservam propagação segura',async()=>{
  const {officialTripDelays}=await predictions;
  const trip={tripId:'T-51',routeId:'51',startDate:'20261119',startTime:'19:00:00'};
  const stopTimeUpdate=[
    {stopId:'14780100',stopSequence:3,arrival:{delay:120}},
    {stopId:'14780200',stopSequence:4,scheduleRelationship:2},
    {stopId:'14780300',stopSequence:5,departure:{delay:240}},
    {stopId:'14780400',stopSequence:6,scheduleRelationship:1},
    {stopId:'14780500',stopSequence:7,arrival:{delay:360,time:NOW+300}},
  ];
  const values=officialTripDelays({feedTimestamp:NOW,updates:[
    {trip,timestamp:NOW-10,stopTimeUpdate}
  ]},['51'],NOW);
  assert.deepEqual(values.map(x=>x.observedStopSequence),[3,4,5,6,7]);
  assert.equal(values[0].delaySeconds,120);
  assert.equal(values[1].kind,'NO_DATA');
  assert.equal(values[1].delaySeconds,undefined);
  assert.equal(values[2].delaySeconds,240);
  assert.equal(values[3].kind,'SKIPPED');
  assert.equal(values[4].kind,'NO_DATA',
    'Um horário absoluto tem prioridade sobre um delay relativo conflitante');
});
test('duas previsões conflitantes para o mesmo trip+stop bloqueiam ETA',async()=>{
  const {officialTripDelays}=await predictions;
  const trip={tripId:'T-51',routeId:'51',startDate:'20261119',startTime:'19:00:00'};
  const feed={feedTimestamp:NOW,updates:[{trip,stopTimeUpdate:[
    {stopId:'14791950',stopSequence:12,arrival:{delay:120}},
    {stopId:'14791950',stopSequence:12,arrival:{delay:240}}
  ]}]};
  const result=officialTripDelays(feed,['51'],NOW);
  assert.equal(result.length,1);
  assert.equal(result[0].kind,'NO_DATA');
  assert.equal(result[0].delaySeconds,undefined);
});

test('limite da API não corta NO_DATA no meio de uma viagem',async()=>{
  const {officialTripDelays}=await predictions;
  const day='20261119',startTime='19:00:00';
  const trip={tripId:'T-250-MARKERS',routeId:'51',startDate:day,startTime};
  const huge={trip,stopTimeUpdate:[
    ...Array.from({length:250},(_,n)=>({stopId:String(14780000+n),
      stopSequence:n+1,arrival:{delay:120}})),
    {stopId:'14791950',stopSequence:251,scheduleRelationship:2}
  ]};
  const small={trip:{...trip,tripId:'T-SAFE'},stopTimeUpdate:[
    {stopId:'14791950',stopSequence:1,arrival:{delay:180}}
  ]};
  const feed={feedTimestamp:NOW,updates:[huge,small]};
  const out=officialTripDelays(feed,['51'],NOW);
  assert.equal(out.length,1,'Viagem com 251 alterações não pode ser truncada');
  assert.equal(out[0].tripId,'T-SAFE');
  assert.equal(out[0].delaySeconds,180);
});
