'use strict';
// Browser adapter contract for the actual official SUMOB GTFS Realtime
// identifier: public route code "5102", not static GTFS internal "562055".
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../static/live-gps.js'),'utf8');
function fake({enabled=true,offline=false,fail=false,empty=false}={}){
  const calls=[],now=Date.now();
  const fixes=[
    {routeId:'5102',vehicleId:'BH-1',tripId:'real-trip-1',
      latitude:-19.869,longitude:-43.963,heading:120,lastGpsFixAt:new Date(now-55000).toISOString()},
    {routeId:'562055',vehicleId:'WRONG-ID',
      latitude:-19.869,longitude:-43.963,lastGpsFixAt:new Date(now-60000).toISOString()},
    {routeId:'5102',vehicleId:'OLD',
      latitude:-19.869,longitude:-43.963,lastGpsFixAt:new Date(now-650000).toISOString()}
  ];
  async function fetch(input){
    const url=new URL(String(input));
    calls.push(url);
    if(url.pathname.endsWith('/gps-config.json'))return{
      ok:true,json:async()=>({
        enabled,provider:'gtfs_rt',
        endpoint:'https://externo-bh-gps-free.hubufmg.workers.dev/api/gps'
      })
    };
    if(url.pathname==='/api/gps'){
      if(fail)throw Error('Worker offline');
      return {ok:true,json:async()=>({
        source:'GTFS_RT',available:true,
        fetchedAt:new Date(now).toISOString(),
        records:empty?[]:fixes
      })};
    }
    throw Error('Unexpected request to '+url);
  }
  const context=vm.createContext({
    URL,Date,Number,String,Object,Math,Map,Set,Promise,fetch,
    navigator:{onLine:!offline},
    location:{href:'https://hubufmg.web.app/externo/'}
  });
  vm.runInContext(script+';this.adapter=StaticLive',context);
  return {adapter:context.adapter,calls};
}
test('SUMOB static adapter requests public GTFS-RT route code, not internal static GTFS ID',async()=>{
  const {adapter,calls}=fake();
  const result=await adapter.fleet('562055','5102','UFMG/Santo Antonio','some-gtfs-version');
  assert.equal(result.available,true);
  assert.equal(result.count,1);
  assert.equal(result.vehicles[0].vehicleId,'BH-1');
  assert.equal(result.vehicles[0].tripId,'real-trip-1');
  assert.equal(result.vehicles[0].source,'GTFS_RT');
  assert.equal(result.vehicles[0].shapeMatch.status,'unknown');
  assert.equal(result.vehicles[0].lastGpsFixAt.length,24);
  assert.equal('etaMinutes' in result.vehicles[0],false);
  assert.equal(adapter.status().gpsRecent,1);
  assert.ok(adapter.status().note.includes('SUMOB'));
  const gps=calls.filter(x=>x.pathname==='/api/gps');
  assert.equal(gps.length,1);
  assert.equal(gps[0].searchParams.get('routes'),'5102');
  assert.equal(gps[0].searchParams.get('source'),'GTFS_RT');
  assert.ok(calls.every(x=>!x.href.includes('gps-nl-map.json')));
  assert.ok(calls.every(x=>!x.searchParams.has('lat')&&!x.searchParams.has('lng')));
});
test('SUMOB adapter cannot invent circulation when feed returns no matching fixes',async()=>{
  const {adapter}=fake({empty:true});
  const r=await adapter.fleet('562055','5102','UFMG','gtfs');
  assert.equal(r.available,true);
  assert.equal(r.vehicles.length,0);
  assert.ok(r.note.includes('não confirma ausência de ônibus'));
});
test('SUMOB outage yields unavailable GPS not zero vehicles',async()=>{
  const {adapter}=fake({fail:true});
  const r=await adapter.fleet('562055','5102','UFMG','gtfs');
  assert.equal(r.available,false);
  assert.equal(r.count,null);
  assert.equal(adapter.status().available,false);
});
test('disabled and offline GPS never query official SUMOB feed',async()=>{
  for(const options of [{enabled:false},{offline:true}]){
    const {adapter,calls}=fake(options);
    const r=await adapter.fleet('562055','5102','UFMG','gtfs');
    assert.equal(r.available,false);
    assert.equal(calls.some(x=>x.pathname==='/api/gps'),false);
  }
});
test('snapshot is shared during repeated simultaneous requests for same GTFS route',async()=>{
  const {adapter,calls}=fake();
  const a=await Promise.all([
    adapter.fleet('562055','5102','UFMG','gtfs'),
    adapter.fleet('562055','5102','UFMG','gtfs')
  ]);
  assert.equal(a[0].count,1);
  assert.equal(a[1].count,1);
  assert.equal(calls.filter(x=>x.pathname==='/api/gps').length,1);
});
