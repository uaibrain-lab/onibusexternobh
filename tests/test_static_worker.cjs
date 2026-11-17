/* Deterministic P7 Worker tests: no internet, no transit API, no paid runner.
 * Execute with Node >=22: node --test tests/test_static_worker.cjs
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const zlib=require('node:zlib');

function setup(){
  const origin=[-19.900,-43.900],middle=[-19.913,-43.900],
        destination=[-19.927,-43.900];
  const stops=[
    ['a','Origem',...origin],['b','Integração',...middle],
    ['c','Destino',...destination]
  ];
  const service={id:'daily',calendar:{
    monday:'1',tuesday:'1',wednesday:'1',thursday:'1',
    friday:'1',saturday:'1',sunday:'1',start_date:'20261101',end_date:'20261231'
  }};
  const trips=[
    ['d','D','Direta',0],['x','X','Integração',0],
    ['y','Y','Destino',0],['p','P','Embarque proibido',0],
    ['q','Q','Desembarque proibido',0],
  ];
  const packed=(idx,board,alight)=>
    idx|(board?1<<20:0)|(alight?1<<21:0);
  const sec=(h,m)=>h*3600+m*60;
  const records=[
    [0,2,sec(8,0),sec(8,40),packed(0,true,true)],
    [0,1,sec(8,5),sec(8,15),packed(1,true,true)],
    [1,2,sec(8,20),sec(8,30),packed(2,true,true)],
    [0,2,sec(7,56),sec(8,10),packed(3,false,true)],
    [0,2,sec(7,58),sec(8,11),packed(4,true,false)]
  ];
  const makeRecords=(sorted)=>{
    const b=Buffer.alloc(sorted.length*20);
    for(let i=0;i<sorted.length;i++)for(let j=0;j<5;j++)
      b.writeUInt32LE(sorted[i][j],i*20+j*4);
    return zlib.gzipSync(b);
  };
  const forward=makeRecords([...records].sort((a,b)=>a[2]-b[2]));
  const backward=makeRecords([...records].sort((a,b)=>b[3]-a[3]));
  const manifest={
    schema:1,format:'uint32le/5;trip-mask=1048575;pickup-bit=1048576;dropoff-bit=2097152',
    builtUTC:'2026-11-17T12:00:00Z',validFrom:'20261101',validThrough:'20261231',
    stopCount:stops.length,tripCount:trips.length,connectionCount:records.length,
    services:[service],exceptions:{20261119:{daily:2}},
    hours:{out:{'07':{connections:2},'08':{connections:3}},
           in:{'08':{connections:5}}}
  };
  const splitForward={
    7:makeRecords(records.filter(r=>r[2]<sec(8,0)).sort((a,b)=>a[2]-b[2])),
    8:makeRecords(records.filter(r=>r[2]>=sec(8,0)).sort((a,b)=>a[2]-b[2]))
  };
  const fileMap={
    'index.json':JSON.stringify(manifest),
    'stops.json.gz':zlib.gzipSync(JSON.stringify(stops)),
    'trips.json.gz':zlib.gzipSync(JSON.stringify(trips)),
    'out/07.bin.gz':splitForward[7],
    'out/08.bin.gz':splitForward[8],
    'in/08.bin.gz':backward,
    '../metro.json':JSON.stringify({stations:[],lines:[],operations:{hoursExceptions:[]}})
  };
  const output=[];
  const fakeFetch=async(url)=>{
    const parsed=new URL(url);
    const relative=parsed.pathname.split('/catalog/scan/')[1] ||
      (parsed.pathname.endsWith('/catalog/metro.json')?'../metro.json':'');
    const value=fileMap[relative];
    if(!value)return new Response('missing',{status:404});
    return new Response(value,{status:200});
  };
  const scope={postMessage:m=>output.push(m)};
  const context=vm.createContext({
    self:scope,fetch:fakeFetch,Blob,Response,URL,Date,Intl,
    DecompressionStream,TextDecoder,Uint8Array,Uint32Array,
    Map,Set,Error,Number,Math,Promise,String,Array,console,
  });
  vm.runInContext(fs.readFileSync('static/route-worker.js','utf-8'),context,{
    filename:'route-worker.js'});
  const run=async(kind,seq,extra={})=>{
    output.length=0;
    await scope.onmessage({data:{kind,seq,
      baseUrl:'https://example.test/externo/catalog/scan/',...extra}});
    const error=output.find(x=>x.kind==='error');
    if(error)throw Error(error.message);
    return output.slice();
  };
  return {origin,destination,output,run};
}
test('initializes static gzip index and finds local stop names',async()=>{
  const t=setup();
  let result=await t.run('init',1);
  assert.equal(result[0].kind,'ready');
  result=await t.run('places',2,{query:'Integra',which:'destination'});
  assert.equal(result.find(x=>x.kind==='places').items[0].label,'Ponto: Integração');
});
test('fastest route prefers two correct trips over slower direct bus',async()=>{
  const t=setup();
  await t.run('init',1);
  const msgs=await t.run('plan',2,{params:{
    origin:{lat:t.origin[0],lng:t.origin[1]},
    destination:{lat:t.destination[0],lng:t.destination[1]},
    at:'2026-11-17T07:50:00-03:00',mode:'departAt',preference:'fastest'
  }});
  const result=msgs.find(x=>x.kind==='result').data;
  assert.ok(result.itineraries.length>0,result.status);
  const winner=result.itineraries[0];
  assert.deepEqual(winner.legs.filter(x=>x.mode==='bus').map(x=>x.line),['X','Y']);
  assert.equal(winner.transfers,1);
  assert.ok(winner.arrival.includes('11:30:')); // 08:30 BH is 11:30 UTC
  for(const itinerary of result.itineraries)
    assert.ok(!itinerary.legs.some(leg=>leg.line==='P'||leg.line==='Q'),
      'Cannot board or leave at forbidden stop');
});
test('least transfers prefers the direct trip',async()=>{
  const t=setup();await t.run('init',1);
  const msgs=await t.run('plan',2,{params:{
    origin:{lat:t.origin[0],lng:t.origin[1]},
    destination:{lat:t.destination[0],lng:t.destination[1]},
    at:'2026-11-17T07:50:00-03:00',mode:'departAt',preference:'leastTransfers'
  }});
  const trip=msgs.find(x=>x.kind==='result').data.itineraries[0];
  assert.equal(trip.transfers,0);
  assert.equal(trip.legs.find(x=>x.mode==='bus').line,'D');
});
test('arriveBy searches backwards and returns a trip before deadline',async()=>{
  const t=setup();await t.run('init',1);
  const msgs=await t.run('plan',2,{params:{
    origin:{lat:t.origin[0],lng:t.origin[1]},
    destination:{lat:t.destination[0],lng:t.destination[1]},
    at:'2026-11-17T08:45:00-03:00',mode:'arriveBy',preference:'fastest'
  }});
  const data=msgs.find(x=>x.kind==='result').data;
  assert.ok(data.itineraries.length,data.status);
  assert.ok(data.itineraries.every(x=>Date.parse(x.arrival)<=Date.parse('2026-11-17T08:45:00-03:00')));
  assert.deepEqual(data.itineraries[0].legs.filter(x=>x.mode==='bus').map(x=>x.line),['X','Y']);
});
test('calendar exceptions and expired dates do not invent journeys',async()=>{
  const t=setup();await t.run('init',1);
  const params={origin:{lat:t.origin[0],lng:t.origin[1]},
    destination:{lat:t.destination[0],lng:t.destination[1]},
    at:'2026-11-19T07:50:00-03:00',mode:'departAt'};
  const x=(await t.run('plan',2,{params})).find(m=>m.kind==='result').data;
  assert.equal(x.itineraries.length,0);
  const y=(await t.run('plan',3,{params:{...params,at:'2027-01-02T07:50:00-03:00'}}))
    .find(m=>m.kind==='result').data;
  assert.equal(y.status,'out_of_calendar');
});
