'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const parser = import('../gps-worker/src/gtfs-rt-trip-updates.mjs');
const now = 1795120000;
const sched = {tripId:'T42', routeId:'9106', startDate:'20261119',
  startTime:'25:15:00', stopSequence:12, stopId:'STOP_A'};
function v(num) {
  let x=BigInt(num);
  if(x<0n)x=(1n<<64n)+x;
  const out=[];
  while(x>127n){out.push(Number((x&127n)|128n));x>>=7n;}
  out.push(Number(x));return out;
}
function f(n,payload) {return [ ...v(n*8+2),...v(payload.length),...payload ];}
function u(n,value) {return [...v(n*8),...v(value)];}
function s(n,value) {return f(n,[...Buffer.from(value)]);}
function build({headerTime=now,tripTime=now-10,tripId='T42',stopId='STOP_A',
  stopSequence=12,departureTime=now+100,negativeDelay=false,
  duplicate=false,deleted=false,withoutTimestamp=false,
  tripRelationship, stopRelationship}={}){
  const trip=[...s(1,tripId),...s(2,'25:15:00'),...s(3,'20261119'),...s(5,'9106'),
    ...(tripRelationship === undefined ? [] : u(4,tripRelationship))];
  const event=[...(!negativeDelay?[]:u(1,-50)), ...u(2,departureTime)];
  const stop=[...u(1,stopSequence),...f(3,event),...s(4,stopId),
    ...(stopRelationship === undefined ? [] : u(5,stopRelationship))];
  const upd=[...f(1,trip),...f(2,stop),...(!withoutTimestamp?u(4,tripTime):[])];
  const entity=[...s(1,'e-1'),...(deleted?u(2,1):[]),...f(3,upd)];
  const header=[...s(1,'2.0'),...u(3,headerTime)];
  return Uint8Array.from([...f(1,header),...f(2,entity),...(duplicate?f(2,entity):[])]);
}
test('decode official trip_update wire fields and exact stop event', async()=>{
  const {parseTripUpdates,matchTripUpdate}=await parser;
  const data=build();
  const decoded=parseTripUpdates(data,now);
  assert.equal(decoded.feedTimestamp,now);
  assert.equal(decoded.sourceEntities,1);
  assert.equal(decoded.updates[0].trip.startTime,'25:15:00');
  assert.equal(matchTripUpdate(data,sched,now).stop.departure.time,now+100);
});
test('negative signed protobuf delay does not block absolute time',async()=>{
  const {matchTripUpdate}=await parser;
  const result=matchTripUpdate(build({negativeDelay:true}),sched,now);
  assert.equal(result.stop.departure.time,now+100);
  assert.equal(result.stop.departure.delay,undefined);
});
test('feed timestamp freshness enforced separately',async()=>{
  const {parseTripUpdates}=await parser;
  for(const headerTime of [now-121,now+61])
    assert.throws(()=>parseTripUpdates(build({headerTime}),now),/INVALID/);
});
test('stale and missing update timestamps cannot match',async()=>{
  const {matchTripUpdate,parseTripUpdates}=await parser;
  assert.equal(parseTripUpdates(build({tripTime:now-121}),now).updates.length,0);
  assert.equal(matchTripUpdate(build({tripTime:now-121}),sched,now),null);
  assert.equal(matchTripUpdate(build({withoutTimestamp:true}),sched,now),null);
});
test('exact trip, stop id and sequence are mandatory',async()=>{
  const {matchTripUpdate}=await parser;
  for (const data of [build({tripId:'another'}),build({stopId:'STOP_B'}),build({stopSequence:13})])
    assert.equal(matchTripUpdate(data,sched,now),null);
});
test('duplicates and deleted entities fail closed',async()=>{
  const {matchTripUpdate}=await parser;
  assert.equal(matchTripUpdate(build({duplicate:true}),sched,now),null);
  assert.equal(matchTripUpdate(build({deleted:true}),sched,now),null);
});
test('truncated, empty and oversized protobuf rejected',async()=>{
  const {parseTripUpdates}=await parser;
  for(const data of [new Uint8Array(0),build().subarray(0,7),new Uint8Array(8*1024*1024+1)])
    assert.throws(()=>parseTripUpdates(data,now));
});

test('scheduled relationships can match but canceled or skipped fail closed',async()=>{
  const {parseTripUpdates,matchTripUpdate}=await parser;
  assert.equal(matchTripUpdate(build({tripRelationship:0,stopRelationship:0}),sched,now).stop.departure.time,now+100);
  for(const relationship of [1,2,3,5,6,7]) {
    const encoded=build({tripRelationship:relationship});
    assert.equal(parseTripUpdates(encoded,now).updates[0].trip.scheduleRelationship,relationship);
    assert.equal(matchTripUpdate(encoded,sched,now),null);
  }
  for(const relationship of [1,2,3])
    assert.equal(matchTripUpdate(build({stopRelationship:relationship}),sched,now),null);
});
