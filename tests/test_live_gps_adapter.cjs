'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.resolve(__dirname,'../static/live-gps.js'),'utf8');
function stamp(minutesAgo=0){
  const date=new Date(Date.now()-minutesAgo*60000-10800000);
  const pad=n=>String(n).padStart(2,'0');
  return date.getUTCFullYear()+pad(date.getUTCMonth()+1)+pad(date.getUTCDate())+
    pad(date.getUTCHours())+pad(date.getUTCMinutes())+pad(date.getUTCSeconds());
}
function harness({enabled=true,online=true,fail=false}={}){
  const calls=[];
  const mapping={
    'CONVENCIONAL|120':{routeIds:['R1'],public:'5102'},
    'CONVENCIONAL|121':{routeIds:['OTHER'],public:'9502'},
    'SUPLEMENTAR|72':{routeIds:['R1'],public:'5102'}
  };
  const fetch=async input=>{
    const url=new URL(String(input));
    calls.push(url.href);
    const id=url.pathname.split('/').pop();
    if(id==='gps-config.json')return {ok:true,json:async()=>({
      enabled,endpoint:'https://externo-bh-gps-free.workers.dev/api/gps'
    })};
    if(id==='gps-nl-map.json')return {ok:true,json:async()=>mapping};
    if(url.pathname==='/api/gps'){
      if(fail)throw Error('PBH timeout');
      const source=url.searchParams.get('source');
      const records=source==='CONVENCIONAL'
        ?[{NL:'120',NV:'12345',HR:stamp(.5),LT:-19.871,LG:-43.966,DG:120},
          {NL:'120',NV:'12345',HR:stamp(2),LT:-19.870,LG:-43.965,DG:120},
          {NL:'121',NV:'9999',HR:stamp(.5),LT:-19.9,LG:-43.9,DG:0},
          {NL:'120',NV:'stale',HR:stamp(25),LT:-19.871,LG:-43.966,DG:120}]
        :[{NL:'72',NV:'72A',HR:stamp(1),LT:-19.875,LG:-43.966,DG:300}];
      return {ok:true,json:async()=>({available:true,source,fetchedAt:new Date().toISOString(),records})};
    }
    throw Error('No fixture '+url);
  };
  const context=vm.createContext({URL,Date,Math,Number,String,Object,
    Map,Set,Promise,fetch,navigator:{onLine:online},
    location:{href:'https://hubufmg.web.app/externo/'}});
  vm.runInContext(script+';this.adapter=StaticLive',context);
  return {adapter:context.adapter,calls};
}
test('disabled-by-default configuration never contacts PBH',async()=>{
  const {adapter,calls}=harness({enabled:false});
  const result=await adapter.fleet('R1','5102','UFMG','202611161919');
  assert.equal(result.available,false);
  assert.equal(result.count,null);
  assert.equal(adapter.enabled(),false);
  assert.equal(calls.length,1);
  assert.ok(calls[0].endsWith('/gps-config.json'));
});
test('only matched line vehicles are displayed with real GPS timestamps, no ETA',async()=>{
  const {adapter,calls}=harness();
  const result=await adapter.fleet('R1','5102','UFMG','202611161919');
  assert.equal(result.available,true);
  assert.equal(result.count,2);
  assert.deepEqual([...result.vehicles.map(v=>v.vehicleId)].sort(),['12345','72A']);
  assert.ok(result.vehicles.every(v=>v.lastGpsFixAt&&v.shapeMatch.status==='unknown'));
  assert.ok(result.vehicles.every(v=>v.ageSec>=0&&v.ageSec<150));
  assert.ok(result.vehicles.every(v=>!('etaMinutes' in v)));
  assert.ok(calls.some(url=>url.includes('/gps-nl-map.json?v=202611161919')));
  assert.ok(calls.filter(url=>url.includes('/api/gps')).every(url=>
    !url.includes('lat=')&&!url.includes('lng=')&&!url.includes('destination=')));
  assert.ok(calls.some(url=>url.includes('source=CONVENCIONAL')&&url.includes('nls=120')));
});
test('optional GPS failure does not pretend zero buses run',async()=>{
  const {adapter}=harness({fail:true});
  const result=await adapter.fleet('R1','5102','UFMG','202611161919');
  assert.equal(result.available,false);
  assert.equal(result.count,null);
  assert.equal(adapter.status().available,false);
});
test('offline browser does not contact GPS endpoint',async()=>{
  const {adapter,calls}=harness({online:false});
  const result=await adapter.fleet('R1','5102','UFMG','202611161919');
  assert.equal(result.available,false);
  assert.equal(calls.some(u=>u.includes('/api/gps')),false);
});
test('multiple same-line requests reuse bounded snapshot',async()=>{
  const {adapter,calls}=harness();
  const [a,b]=await Promise.all([
    adapter.fleet('R1','5102','UFMG','202611161919'),
    adapter.fleet('R1','5102','UFMG','202611161919')
  ]);
  assert.equal(a.count,2);
  assert.equal(b.count,2);
  assert.equal(calls.filter(u=>u.includes('/api/gps')).length,2);
});
