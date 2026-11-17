'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/static-arrivals.js'),'utf8');
function harness(indexVersion,releaseVersion){
  const calls=[];
  const fake={index:{schema:1,buckets:256,version:indexVersion,validThrough:'20261231'},
    calendar:{services:{a:{start_date:'20260101',end_date:'20261231',monday:'1'}},exceptions:{}}};
  const context={
    URL,Map,Promise,String,Number,Date,Math,Intl,TextDecoder,
    location:{href:'https://hubufmg.web.app/externo/'},
    StaticBus:{version:async()=>releaseVersion},
    fetch:async u=>{
      const name=String(u).split('/').pop().split('?')[0];
      calls.push(String(u));
      if(name==='index.json')return {ok:true,json:async()=>fake.index};
      if(name==='calendar.json')return {ok:true,json:async()=>fake.calendar};
      throw Error('unexpected network fetch '+name);
    }
  };
  const api=vm.runInNewContext(source+'\nStaticArrivals',context);
  return {api,calls};
}
test('GTFS edition mismatch rejects timetable before downloading any shard',async()=>{
  const {api,calls}=harness('202611151200','202611161919');
  await assert.rejects(()=>api.lookup('14791407'),/versões GTFS diferentes/);
  assert.ok(calls.some(u=>u.includes('index.json')));
  assert.ok(!calls.some(u=>u.includes('calendar.json')));
  assert.ok(!calls.some(u=>u.includes('.json.gz')));
});
test('calendar is fetched with release version and only once on concurrent lookups',async()=>{
  const {api,calls}=harness('202611161919','202611161919');
  const [a,b]=await Promise.all([api.lookup('x'),api.lookup('x')].map(p=>p.catch(e=>e)));
  assert.ok(a instanceof Error||a&&a.name==='Error');
  assert.ok(b instanceof Error||b&&b.name==='Error');
  assert.equal(calls.filter(u=>u.includes('index.json')).length,1);
  const calendars=calls.filter(u=>u.includes('calendar.json'));
  assert.equal(calendars.length,1);
  assert.ok(calendars[0].includes('v=202611161919'));
});
