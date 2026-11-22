'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const busCode=fs.readFileSync(path.join(root,'static/static-bus.js'),'utf8');
const liveCode=fs.readFileSync(path.join(root,'static/live-gps.js'),'utf8');
const config=JSON.parse(fs.readFileSync(path.join(root,'static/gps-config.json'),'utf8'));
const build=fs.readFileSync(path.join(root,'scripts/build_static_site.py'),'utf8');
function recentHr(){
  const date=new Date(Date.now()-40000-3*3600000);
  const z=x=>String(x).padStart(2,'0');
  return String(date.getUTCFullYear())+z(date.getUTCMonth()+1)+z(date.getUTCDate())+
    z(date.getUTCHours())+z(date.getUTCMinutes())+z(date.getUTCSeconds());
}
function setup(enabled){
  const calls=[];
  const fixture={
    'manifest.json':{gtfsVersion:'202611161919'},
    'gps-config.json':{enabled,endpoint:'https://externo-bh-gps-free.workers.dev/api/gps'},
    'routes.json':[{id:'562055',code:'5102',name:'UFMG',patterns:['p1']}],
    'stops.json':{'14791407':['UFMG',-19.8695,-43.9675]},
    'gps-nl-map.json':{'CONVENCIONAL|393':{public:'5102',routeIds:['562055']}},
  };
  const fetcher=async input=>{
    const url=new URL(String(input));
    calls.push(url.href);
    if(url.pathname==='/api/gps'){
      return {ok:true,json:async()=>({
        available:true,source:'CONVENCIONAL',fetchedAt:new Date().toISOString(),
        records:[{NL:'393',NV:'V393',HR:recentHr(),LT:-19.8695,LG:-43.9675,DG:90}]
      })};
    }
    const file=url.pathname.split('/').pop();
    return {ok:!!fixture[file],json:async()=>fixture[file]};
  };
  const ctx=vm.createContext({URL,Map,Set,Promise,Math,Number,String,Date,Object,
    fetch:fetcher,location:{href:'https://hubufmg.web.app/externo/'},
    navigator:{onLine:true},console});
  vm.runInContext(liveCode+'\n'+busCode,ctx);
  return {bus:vm.runInContext('StaticBus',ctx),live:vm.runInContext('StaticLive',ctx),calls};
}
test('default static package remains GPS-free without paid dependencies',()=>{
  assert.equal(config.enabled,false);
  assert.equal(config.provider,'gtfs_rt');
  // The source has a fixed official GPS relay, but it is disabled by default;
  // merely storing its URL must never trigger traffic or a paid service.
  assert.equal(config.endpoint,'https://externo-bh-gps-free.hubufmg.workers.dev/api/gps');
  assert.ok(build.includes('gps-config.json'));
  assert.ok(build.includes('live-gps.js'));
  assert.ok(build.includes('gps-nl-map.json'));
  assert.ok(build.includes('manifest.json'));
});
test('static Externo remains usable when opt-in GPS is disabled',async()=>{
  const {bus,calls}=setup(false);
  const routes=await bus.api('/api/routes');
  const fleet=await bus.api('/api/fleet?route=5102');
  assert.equal(routes.length,1);
  assert.equal(fleet.available,false);
  assert.equal(fleet.count,null);
  assert.ok(!calls.some(x=>x.includes('/api/gps')));
});
test('GPS NL mapping supplies only line-specific fresh positions, never ETA',async()=>{
  const {bus,calls}=setup(true);
  const fleet=await bus.api('/api/fleet?route=5102');
  const status=await bus.api('/api/status');
  assert.equal(fleet.available,true);
  assert.equal(fleet.count,1);
  assert.equal(fleet.vehicles[0].vehicleId,'V393');
  assert.equal(fleet.vehicles[0].positionUnchangedSinceAt,null);
  assert.equal(fleet.vehicles[0].shapeMatch.status,'unknown');
  assert.ok(!('etaMinutes' in fleet.vehicles[0]));
  assert.equal(status.gpsRecent,1);
  assert.ok(calls.some(x=>x.includes('/api/gps?source=CONVENCIONAL&nls=393')));
  assert.ok(calls.every(x=>!x.includes('passengerLat=')&&!x.includes('destination=')));
});
