'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const geocoderSource=fs.readFileSync(path.join(__dirname,'../static/place-geocoding.js'),'utf8');
function harness(){
  const context=vm.createContext({URL,AbortSignal,Date,Map,Set,Number,String,Array,Math,Promise,Error,fetch:null});
  vm.runInContext(geocoderSource,context);
  return vm.runInContext('GeoPlaces',context);
}
const features=[
  {geometry:{coordinates:[-43.939,-19.922]},properties:{name:'Padaria Santa Luzia',street:'Rua X',housenumber:'127',city:'Belo Horizonte'}},
  {geometry:{coordinates:[-43.935,-19.925]},properties:{name:'Faculdade Alfa',street:'Av. Antônio Carlos',city:'Belo Horizonte'}},
  {geometry:{coordinates:[-46.63,-23.55]},properties:{name:'Fora da região',city:'São Paulo'}},
  {geometry:{coordinates:[-43.939,-19.922]},properties:{name:'Padaria Santa Luzia',street:'Rua X',housenumber:'127',city:'Belo Horizonte'}}
];
test('Photon search uses only explicit address string, fixed BH bias and bounded bbox',async()=>{
  const geo=harness(),calls=[];
  const result=await geo.search('Padaria Santa Luzia',{now:3000,fetchFn:async(u,opt)=>{
    calls.push({u,opt});
    return {ok:true,json:async()=>({features})};
  }});
  assert.equal(calls.length,1);
  const u=new URL(calls[0].u);
  assert.equal(u.hostname,'photon.komoot.io');
  assert.equal(u.searchParams.get('q'),'Padaria Santa Luzia');
  assert.equal(u.searchParams.get('lat'),'-19.9208');
  assert.equal(u.searchParams.get('lon'),'-43.9378');
  assert.equal(u.searchParams.get('bbox'),'-44.45,-20.45,-43.45,-19.45');
  assert.ok(!u.searchParams.has('userLocation'));
  assert.equal(result.length,2);
  assert.equal(result[0].source,'Photon / OpenStreetMap');
  assert.ok(result[0].label.includes('Rua X'));
});
test('Photon one-click query is cached without repeated external traffic',async()=>{
  const geo=harness();let count=0;
  const request={fetchFn:async()=>{count++;return {ok:true,json:async()=>({features})}}};
  await geo.search('Faculdade Alfa',{...request,now:2500});
  const again=await geo.search('Faculdade Alfa',{...request,now:3500});
  assert.equal(count,1);assert.equal(again.length,2);
});
test('No automatic flood: second uncached query is locally throttled and 429 disclosed',async()=>{
  const geo=harness();let count=0;
  const fetchFn=async()=>{count++;return {ok:true,json:async()=>({features})}};
  await geo.search('Faculdade Alfa',{now:1500,fetchFn});
  await assert.rejects(()=>geo.search('Outra Padaria',{now:1800,fetchFn}),/Aguarde/);
  assert.equal(count,1);
  await assert.rejects(()=>geo.search('Outra Padaria',{now:3500,fetchFn:async()=>({ok:false,status:429})}),/limitada/);
});
test('Reject malicious or malformed server response and out-of-region positions',()=>{
  const geo=harness();
  assert.deepEqual(Array.from(geo.parse({features:[]})),[]);
  assert.throws(()=>geo.parse({features:'oops'}),/inesperada/);
  assert.equal(geo.inArea(-23.55,-46.63),false);
});
test('Route input never geocodes on typing, only after clicking Buscar',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
  assert.match(html,/id="routeOriginSearch"/);
  assert.match(html,/id="routeDestinationSearch"/);
  assert.match(app,/GeoPlaces\.search\(q\)/);
  assert.ok(!/routeOriginInput.*addEventListener\('input'.*GeoPlaces/s.test(app));
});
