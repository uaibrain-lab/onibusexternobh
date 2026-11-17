/* P9: zero-server bus tabs tested with a synthetic static GTFS catalog. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),vm=require('node:vm');
const data={
 'manifest.json':{gtfsVersion:'202611161919'},
 'routes.json':[{id:'A',code:'2020',name:'Centro / Universidade',
   patterns:['p1'],shapes:['s1']}],
 'stops.json':{'101':['Rua Campus',-19.869,-43.967],
   '102':['Praça Central',-19.915,-43.941]},
 'patterns.json':[{id:'p1',route:'A',shape:'s1',
   headsign:'Centro',stops:['101','102'],tripCount:100}],
 'shapes.json':{'s1':[[-19.869,-43.967],[-19.915,-43.941]]},
 'routing-stop-routes.json':{'101':['2020'],'102':['2020']}
};
function setup(){
 const fetched=[];
 const fetcher=async u=>{
   const n=new URL(u).pathname.split('/catalog/')[1];
   fetched.push(n);
   return new Response(data[n]?JSON.stringify(data[n]):'missing',
     {status:data[n]?200:404});
 };
 const scope=vm.createContext({fetch:fetcher,
   location:{href:'http://127.0.0.1:8765/externo/'},
   URL,Response,Map,Promise,Number,String,Math,Array,Object,Date,console});
 vm.runInContext(fs.readFileSync('static/static-bus.js','utf8'),scope);
 return {api:path=>vm.runInContext('StaticBus.api('+JSON.stringify(path)+')',scope),
   fetched};
}
test('loads official route list and defers shapes',async()=>{
 const t=setup();
 const lines=await t.api('/api/routes');
 assert.equal(lines[0].code,'2020');
 assert.equal(lines[0].patternCount,1);
 assert.ok(!t.fetched.includes('shapes.json'));
});
test('reconstructs route geometry entirely from static GTFS',async()=>{
 const t=setup();
 const route=await t.api('/api/route?code=2020');
 assert.equal(route.patterns[0].headsign,'Centro');
 const full=await t.api('/api/route?code=2020&pattern=p1');
 assert.equal(full.selected.stops.length,2);
 assert.equal(full.selected.stops[0].name,'Rua Campus');
 assert.equal(full.selected.coordinates.length,2);
});
test('nearby points, search, detail work without a server',async()=>{
 const t=setup();
 const near=await t.api('/api/nearby-stops?lat=-19.869&lng=-43.967');
 assert.equal(near.items[0].id,'101');
 const found=await t.api('/api/stops?q=campus');
 assert.equal(found.items[0].name,'Rua Campus');
 const detail=await t.api('/api/stop?id=101');
 assert.equal(detail.routes[0].code,'2020');
 assert.equal(detail.routes[0].nextArrival,null);
 assert.equal(detail.timetableAvailable,false);
});
test('does not disguise unavailable GPS as an empty fleet',async()=>{
 const t=setup();
 const fleet=await t.api('/api/fleet?route=2020');
 assert.equal(fleet.available,false);
 assert.equal(fleet.count,null);
 assert.equal(fleet.vehicles.length,0);
});
