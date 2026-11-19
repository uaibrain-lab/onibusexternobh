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
