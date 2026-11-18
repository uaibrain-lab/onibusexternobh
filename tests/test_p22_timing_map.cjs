'use strict';
/* P22 regression: explain trip times without inventing GPS ETA. */
const test=require('node:test'),assert=require('node:assert/strict'),
fs=require('node:fs'),path=require('node:path');
const worker=fs.readFileSync(path.join(__dirname,'../static/route-worker.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
const a=worker.indexOf('function summarizeTravelTimes(itinerary){');
const b=worker.indexOf('function chooseDiverseItineraries(',a);
assert.ok(a>=0&&b>a,'Trip timing function missing');
const summarize=new Function('MIN',worker.slice(a,b)+';return summarizeTravelTimes')(60000);
const iso=(hour,min)=>new Date(Date.UTC(2026,10,17,hour,min)).toISOString();
test('travel duration explicitly includes walk, onboard, and GTFS waiting',()=>{
 const trip={departure:iso(22,58),arrival:iso(23,37),legs:[
   {mode:'walk',departure:iso(22,58),arrival:iso(23,4)},
   {mode:'bus',departure:iso(23,7),arrival:iso(23,16)},
   {mode:'walk',departure:iso(23,16),arrival:iso(23,18)},
   {mode:'bus',departure:iso(23,22),arrival:iso(23,32)},
   {mode:'walk',departure:iso(23,32),arrival:iso(23,37)}
 ]};
 const result=summarize(trip);
 assert.equal(result.totalMinutes,39);
 assert.equal(result.walkingMinutes,13);
 assert.equal(result.onboardMinutes,19);
 assert.equal(result.waitingMinutes,7);
 assert.match(result.basis,/GTFS scheduled/);
});
test('reject inconsistent overlapping legs instead of publishing misleading breakdown',()=>{
 const trip={departure:iso(22,58),arrival:iso(23,20),legs:[
   {mode:'walk',departure:iso(22,58),arrival:iso(23,20)},
   {mode:'bus',departure:iso(23,0),arrival:iso(23,15)}
 ]};
 assert.equal(summarize(trip),null);
});
test('show timing only on the selected result and never describe GPS estimates',()=>{
 assert.match(app,/const times=trip\.timeBreakdown;/);
 assert.match(app,/horários GTFS/);
 assert.match(worker,/trip\.timeBreakdown=summary/);
 assert.doesNotMatch(worker,/timeBreakdown:.*gps/i);
});
test('touch a selected route stop on the map without closing tracked line',()=>{
 assert.match(app,/else if\(lineMode\(\)\)\s*\{\s*\/\/ Touching a stop/);
 assert.match(app,/focusLineBoardingStop\(stop\.stop,\{userInitiated:true\}\)/);
 assert.match(app,/if\(selectionSeq!==routeSelectionSeq\|\|/);
 assert.match(app,/if\(activeTab==='linhas'&&tab!=='linhas'&&lineMapSession\)/);
});
