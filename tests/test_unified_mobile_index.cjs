'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../static/static-bus.js'),'utf8');
const fixtures={
  'manifest.json':{gtfsVersion:'202611161919'},
  'routes.json':[
    {id:'10',code:'5102',name:'UFMG - Santo Antônio',patterns:['p1','p2']},
    {id:'11',code:'9502',name:'Centro - Estação',patterns:['p3']}
  ],
  'stops.json':{
    'a':['UFMG',-19.8700,-43.9700],
    'b':['Ponto vizinho',-19.8703,-43.9702],
    'c':['Centro',-19.9210,-43.9370],
    'd':['Rua distante',-20.1000,-44.2000]
  },
  'patterns.json':[
    {id:'p1',route:'10',shape:'s1',headsign:'Centro',stops:['a','b','c'],tripCount:20,direction:'0'},
    {id:'p2',route:'10',shape:'s2',headsign:'UFMG',stops:['c','b','a'],tripCount:12,direction:'1'},
    {id:'p3',route:'11',shape:'s3',headsign:'Estação',stops:['c','d'],tripCount:4,direction:'0'}
  ],
  'shapes.json':{
    's1':[[-19.87,-43.97],[-19.921,-43.937]],
    's2':[[-19.921,-43.937],[-19.87,-43.97]]
  },
  'routing-stop-routes.json':{a:['5102'],b:['5102'],c:['5102','9502'],d:['9502']}
};
let requests=[];
function makeApi(){
  requests=[];
  const sandbox={
    URL,Map,Set,Math,Number,Object,String,Promise,console,
    location:{href:'https://hubufmg.web.app/externo/'},
    fetch:async url=>{
      const file=String(url).split('/').pop().split('?')[0];
      requests.push(file);
      if(!(file in fixtures))throw Error('fixture unavailable '+file);
      return {ok:true,json:async()=>fixtures[file]};
    },
    StaticArrivals:{lookup:async()=>({available:true,expired:false,byDirection:new Map()})}
  };
  const api=vm.runInNewContext(source+'\nStaticBus',{...sandbox});
  return api;
}
test('grid espacial retorna pontos visíveis sem carregar rotas de trajetos',async()=>{
  const bus=makeApi();
  const result=await bus.api('/api/map-stops?minlat=-19.88&minlng=-43.98&maxlat=-19.86&maxlng=-43.96');
  assert.deepEqual(Array.from(result.items,x=>x.id),['a','b']);
  assert.equal(result.total,2);
  assert.equal(requests.filter(x=>x==='manifest.json').length,1);
  assert.ok(requests.includes('routes.json'));
  assert.ok(requests.includes('stops.json'));
});
test('pontos próximos são ordenados e não incluem paradas distantes',async()=>{
  const bus=makeApi();
  const result=await bus.api('/api/nearby-stops?lat=-19.8700&lng=-43.9700');
  assert.deepEqual(Array.from(result.items,x=>x.id),['a','b']);
  assert.equal(result.items[0].distanceM,0);
});
test('destinos opostos permanecem separados na consulta do ponto',async()=>{
  const bus=makeApi();
  const result=await bus.api('/api/stop?id=a');
  assert.equal(result.routes.length,2);
  assert.deepEqual(Array.from(result.routes,x=>x.destination).sort(),['Centro','UFMG']);
  assert.ok(result.routes.every(x=>x.code==='5102'));
  assert.equal(requests.filter(x=>x==='patterns.json').length,1);
  await bus.api('/api/stop?id=b');
  assert.equal(requests.filter(x=>x==='patterns.json').length,1);
});
test('seletor de percurso só marca variantes que servem ao ponto',async()=>{
  const bus=makeApi();
  const line=await bus.api('/api/route?code=5102&stop=a');
  assert.ok(line.patterns.every(p=>p.servesStop));
  const other=await bus.api('/api/route?code=5102&stop=d');
  assert.ok(other.patterns.every(p=>p.servesStop===false));
  const geom=await bus.api('/api/route?code=5102&pattern=p1&stop=a');
  assert.equal(geom.selected.patternId,'p1');
  assert.equal(geom.selected.stops.length,3);
});
test('GPS ausente não é contado como ônibus zero em funcionamento',async()=>{
  const bus=makeApi();
  const fleet=await bus.api('/api/fleet?route=5102');
  assert.equal(fleet.available,false);
  assert.equal(fleet.count,null);
  assert.equal(fleet.vehicles.length,0);
});
