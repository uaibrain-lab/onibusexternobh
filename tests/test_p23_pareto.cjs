'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../static/route-worker.js'),'utf8');
const begin=code.indexOf('function journeyQuality(trip){');
const end=code.indexOf('async function metroHints(',begin);
assert.ok(begin>=0&&end>begin,'Missing Pareto selector');
const {paretoJourneys,journeyQuality}=new Function('WALK_SPEED','reconstruct',
  code.slice(begin,end)+';return {paretoJourneys,journeyQuality}')(
  1.15,x=>x
);
const iso=(min)=>new Date(Date.UTC(2026,10,17,20,min)).toISOString();
const trip=(arrival,duration,walk,transfers,lines)=>({
  departure:iso(arrival-duration),
  arrival:iso(arrival),durationMinutes:duration,
  walkMetersApprox:walk,transfers,
  legs:lines.map((line,i)=>({
    mode:'bus',line,tripId:line+'-'+i,
    departure:iso(0),arrival:iso(10+i*5)
  }))
});
test('keep fastest AND fewer-transfer options when neither dominates',()=>{
 const fastest=trip(30,32,1200,2,['9106','9502','63']);
 const simpler=trip(35,37,300,0,['5106']);
 const worse=trip(42,44,1400,2,['9106','9502','63']);
 const ranked=paretoJourneys([fastest,simpler,worse],false);
 assert.equal(ranked.length,2);
 assert.ok(ranked.includes(fastest));
 assert.ok(ranked.includes(simpler));
 assert.ok(!ranked.includes(worse));
});
test('a later arrival but substantially shorter time in transit may remain Pareto-optimal',()=>{
 const early=trip(35,37,400,1,['9106','5106']);
 const laterButShorter=trip(39,21,400,1,['9209','5106']);
 const got=paretoJourneys([early,laterButShorter],false);
 assert.equal(got.length,2);
});
test('arriveBy keeps the latest departure when other objectives are no worse',()=>{
 const a=trip(59,44,200,0,['5106']);
 const b=trip(59,59,500,1,['9106','5106']);
 const got=paretoJourneys([b,a],true);
 assert.deepEqual(got,[a]);
});
test('invalid timestamps are never included in the Pareto front',()=>{
 const invalid=trip(39,21,400,1,['9209','5106']);
 invalid.departure='not-a-date';
 assert.deepEqual(paretoJourneys([invalid],false),[]);
});
test('all preferences work without changing official GTFS timestamps',()=>{
 const value=trip(39,21,400,1,['9209','5106']);
 const snap=value.arrival;
 const score=journeyQuality(value);
 assert.ok(score.costMinutes>21);
 assert.equal(value.arrival,snap);
 assert.match(score.costBasis,/heuristic/);
});
