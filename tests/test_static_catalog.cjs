/* Static adapter parity tests — no Python backend or GPS invented. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),vm=require('node:vm');
function create(){
 const data={
  'routes.json':[{id:'r1',code:'123',name:'Teste BH',patterns:['p1']}],
  'patterns.json':[{id:'p1',route:'r1',shape:'s1',headsign:'Centro',
                    tripCount:12,stops:['a','b']}],
  'shapes.json':{s1:[[-19.9,-43.9],[-19.91,-43.91]]},
  'stops.json':{a:['Rua A',-19.9,-43.9],b:['Rua B',-19.91,-43.91]},
  'routing-stop-routes.json':{a:['123'],b:['123']}
 };
 const fetched=[];
 const sandbox={window:{},location:{href:'https://test.local/externo/'},
   URL,Promise,Object,Number,Math,Map,String,Set,console,
   fetch:async url=>{
    const name=new URL(url).pathname.split('/').at(-1);
    fetched.push(name);
    return new Response(JSON.stringify(data[name]||{}),
                        {status:data[name]?200:404});
   }};
 sandbox.Response=Response;
 vm.runInNewContext(fs.readFileSync('static/catalog-api.js','utf8'),sandbox);
 return {api:sandbox.window.__StaticCatalogAPI.api,fetched}
}
test('routes, pattern geometry and stop search use static data',async()=>{
 const {api}=create();
 const routes=await api('/api/routes');assert.equal(routes[0].code,'123');
 const pattern=await api('/api/route?code=123&pattern=p1');
 assert.equal(pattern.selected.stops.length,2);
 assert.equal(pattern.selected.coordinates.length,2);
 const stops=await api('/api/stops?q=Rua%20A');
 assert.equal(stops.items[0].id,'a');
});
test('viewport, nearby and stop detail use no external endpoint',async()=>{
 const {api,fetched}=create();
 const map=await api('/api/map-stops?minlat=-20&minlng=-44&maxlat=-19&maxlng=-43');
 assert.equal(map.total,2);
 const nearby=await api('/api/nearby-stops?lat=-19.9&lng=-43.9');
 assert.equal(nearby.items[0].id,'a');
 const detail=await api('/api/stop?id=a');
 assert.equal(detail.routes[0].code,'123');
 assert.equal(detail.routes[0].nextArrival,null);
 assert.equal(detail.timetableAvailable,false);
 assert.ok(fetched.every(name=>name.endsWith('.json')));
});
test('GPS is explicitly absent, not an empty live fleet assertion',async()=>{
 const {api}=create();
 const fleet=await api('/api/fleet?route=123');
 assert.equal(fleet.gpsAvailable,false);
 assert.equal(fleet.vehicles.length,0);
 const status=await api('/api/status');
 assert.equal(status.gpsAvailable,false);
});
