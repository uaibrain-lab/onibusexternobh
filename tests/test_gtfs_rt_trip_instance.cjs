'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const matcher=import('../gps-worker/src/trip-instance.mjs').then(m=>m.sameTripInstance);
const s={tripId:'T',routeId:'9106',startDate:'20261119',startTime:'25:15:00',stopSequence:12};
const r={tripId:'T',routeId:'9106',startDate:'20261119',startTime:'25:15:00',currentStopSequence:12};
test('exact service instance after midnight matches',async()=>assert.equal((await matcher)(s,r),true));
for(const key of ['tripId','routeId','startDate','startTime'])
  test('reject mismatched '+key,async()=>assert.equal((await matcher)(s,{...r,[key]:'DIFFERENT'}),false));
test('reject wrong stop sequence',async()=>assert.equal((await matcher)(s,{...r,currentStopSequence:13}),false));
test('reject missing descriptor',async()=>assert.equal((await matcher)(s,{...r,startDate:undefined}),false));
test('reject invalid calendar date',async()=>assert.equal((await matcher)({...s,startDate:'20260230'},{...r,startDate:'20260230'}),false));
test('reject invalid time',async()=>assert.equal((await matcher)({...s,startTime:'99:00:00'},{...r,startTime:'99:00:00'}),false));
test('reject inferred position without stop sequence',async()=>assert.equal((await matcher)(s,{...r,currentStopSequence:undefined}),false));

const selector=import('../gps-worker/src/trip-instance.mjs').then(m=>m.findExactStopUpdate);
const fresh={timestamp:1700000000,trip:{tripId:'T',routeId:'9106',
  startDate:'20261119',startTime:'25:15:00'},
  stopTimeUpdate:[{stopSequence:12,arrival:{time:1700000020}}]};
test('select exact fresh trip update, preserving source event',async()=>{
  const selected=(await selector)(s,[fresh],1700000050);
  assert.equal(selected.stop.arrival.time,1700000020);
});
test('reject stale or future TripUpdates',async()=>{
  const select=await selector;
  assert.equal(select(s,[fresh],1700000201),null);
  assert.equal(select(s,[fresh],1699999900),null);
});
test('reject mismatched service instance and stop sequence',async()=>{
  const select=await selector;
  for(const bad of [
    {...fresh,trip:{...fresh.trip,startDate:'20261120'}},
    {...fresh,trip:{...fresh.trip,routeId:'5106'}},
    {...fresh,stopTimeUpdate:[{stopSequence:13}]},
    {...fresh,trip:{...fresh.trip,startTime:undefined}}
  ])assert.equal(select(s,[bad],1700000050),null);
});
test('reject duplicate exact candidates instead of choosing arbitrarily',async()=>{
  assert.equal((await selector)(s,[fresh,fresh],1700000050),null);
});
test('reject missing timestamps and malformed stop update lists',async()=>{
  const select=await selector;
  assert.equal(select(s,[{...fresh,timestamp:undefined}],1700000050),null);
  assert.equal(select(s,[{...fresh,stopTimeUpdate:null}],1700000050),null);
  assert.equal(select(s,[],1700000050),null);
});

test('conflicting stop_id cannot match the same sequence',async()=>{
  const select=await selector;
  const target={...s,stopId:'STOP_A'};
  const wrong={...fresh,stopTimeUpdate:[{stopSequence:12,stopId:'STOP_B'}]};
  assert.equal(select(target,[wrong],1700000050),null);
  const right={...fresh,stopTimeUpdate:[{stopSequence:12,stopId:'STOP_A'}]};
  assert.equal(select(target,[right],1700000050).stop.stopId,'STOP_A');
});
