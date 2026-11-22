'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../static/route-worker.js'),'utf8');
const begin=source.indexOf('function verifyWalking(itinerary,ctx,graph,reasons=null){');
const end=source.indexOf('function journeyQuality(trip){',begin);
assert.ok(begin>=0&&end>begin);
const coords={origin:[-19.90,-43.92],destination:[-19.88,-43.94],
  0:[-19.901,-43.921],1:[-19.897,-43.924],
  2:[-19.895,-43.93],3:[-19.89,-43.934]};
const verify=new Function('locationOf','stamp','BUFFER','TRANSFER_BUFFER',
  'stationAccessExtra','MAX_HOURS','HOUR','MIN',
  source.slice(begin,end)+';return verifyWalking')(
  endpoint=>coords[endpoint],epoch=>new Date(epoch).toISOString(),
  45000,120000,()=>0,5,3600000,60000);
const iso=m=>new Date(Date.UTC(2026,10,17,22,m)).toISOString();
function trip(){return {legs:[
  {mode:'walk',from:'origin',to:0,departure:iso(0),arrival:iso(1)},
  {mode:'bus',from:0,to:1,departure:iso(4),arrival:iso(11)},
  {mode:'walk',from:1,to:2,departure:iso(11),arrival:iso(12)},
  {mode:'bus',from:2,to:3,departure:iso(15),arrival:iso(20)},
  {mode:'walk',from:3,to:'destination',departure:iso(20),arrival:iso(21)}
]};}
const ctx={requested:Date.parse(iso(0)),backward:false};
function graphWithFailure(fromIndex){
  let calls=0;
  return {
    route(a,b){calls++;return calls===fromIndex?null:{
      meters:38,seconds:40,snapMeters:3,geometry:[a,b],
      pathSource:'fixture_OSM'}},
    explainFailure(){return {reason:'disconnectedPedestrianComponents',
      straightDistanceMeters:123}}
  };
}
test('missing OSM pedestrian connector reports transfer, not absent bus',()=>{
  const reasons={},t=trip();
  const ok=verify(t,ctx,graphWithFailure(2),reasons);
  assert.equal(ok,false);
  assert.equal(reasons.streetPathUnavailable,1);
  assert.equal(reasons.stage_transfer,1);
  assert.equal(reasons.street_disconnectedPedestrianComponents,1);
  assert.doesNotMatch(JSON.stringify(reasons),/-19\.9/);
});
test('egress walking failure is distinguished from transfer',()=>{
  const reasons={};
  assert.equal(verify(trip(),ctx,graphWithFailure(3),reasons),false);
  assert.equal(reasons.stage_egress,1);
  assert.equal(reasons.stage_transfer||0,0);
});
test('no opt-in diagnostics means no expensive OSM connectivity analysis',()=>{
  let attempted=0;
  const graph=graphWithFailure(2);
  graph.explainFailure=()=>{attempted++;return {reason:'test'}};
  assert.equal(verify(trip(),ctx,graph,null),false);
  assert.equal(attempted,0);
});
