'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../static/route-worker.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
const a=source.indexOf('function journeyQuality(trip){');
const b=source.indexOf('async function metroHints(',a);
assert.ok(a>=0&&b>a,'Balanced shortlist functions not found');
const helpers=new Function('WALK_SPEED','reconstruct',source.slice(a,b)+
  ';return {journeyQuality,ranked,chooseDiverseItineraries}')(1.15,x=>x);
const time=(h,m)=>new Date(Date.UTC(2026,10,17,h,m)).toISOString();
function itinerary({duration,walk,transfers,arrival,lines,short=false}){
 const legs=[];
 let prevArrival=null;
 for(let i=0;i<lines.length;i++){
   let depMinute=0;
   if(i>0){
     // A plausible real-life between-stop walk from the previous bus.
     const nextArrival=prevArrival+3;
     legs.push({mode:'walk',departure:time(20,prevArrival),
       arrival:time(20,nextArrival)});
     depMinute=prevArrival+(short?4:8);
   }
   const endMinute=depMinute+7;
   legs.push({mode:'bus',line:lines[i],tripId:'trip-'+lines[i],
     from:i,to:i+1,
     departure:time(20,depMinute),arrival:time(20,endMinute)});
   prevArrival=endMinute;
 }
 return {departure:time(19,58),arrival:time(20,arrival),
   durationMinutes:duration,walkMetersApprox:walk,transfers,legs};
}
test('fastest preference remains earliest scheduled arrival',()=>{
 const early=itinerary({duration:40,walk:1000,transfers:2,
   arrival:38,lines:['9106','9502','63'],short:true});
 const comfortable=itinerary({duration:45,walk:300,transfers:0,
   arrival:43,lines:['5106']});
 const fastest=helpers.ranked({finals:[comfortable,early],backward:false},
   'fastest',6);
 assert.equal(fastest[0],early);
});
test('balanced considers walking, transfers, and tight connections as tradeoffs',()=>{
 const risky=itinerary({duration:40,walk:1000,transfers:2,
   arrival:38,lines:['9106','9502','63'],short:true});
 const comfortable=itinerary({duration:45,walk:300,transfers:0,
   arrival:43,lines:['5106']});
 assert.ok(helpers.journeyQuality(risky).costMinutes>
   helpers.journeyQuality(comfortable).costMinutes);
 assert.ok(helpers.journeyQuality(risky).tightTransfers>0);
 const balanced=helpers.ranked({finals:[comfortable,risky],backward:false},
   'balanced',6);
 assert.equal(balanced[0],comfortable);
});
test('preserves balanced search option and avoids proprietary cost assertions',()=>{
 assert.match(html,/value="balanced"/);
 assert.match(source,/preference==='balanced'/);
 assert.match(app,/route-transfer-warning/);
 assert.match(source,/heuristic_duration_plus_walking_transfers_and_short_connections/);
});
