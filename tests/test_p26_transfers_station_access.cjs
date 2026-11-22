'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../static/route-worker.js'),'utf8');
const start=src.indexOf('function nearby(lat,lng,radius=1050,limit=22) {');
const stop=src.indexOf('function serviceActive(',start);
const verifyStart=src.indexOf('function verifyWalking(itinerary,ctx,graph,reasons=null){');
const verifyEnd=src.indexOf('function journeyQuality(trip){',verifyStart);
assert.ok(start>=0&&stop>start&&verifyStart>=0&&verifyEnd>verifyStart);

function fixtures(){
 const origin=[-19.9,-43.9],stops=[],grid=new Map(),far=[];
 const add=(lat,lng,name)=>{
   const id=stops.length;stops.push([String(id),name,lat,lng]);
   const key=Math.floor(lat*200)+','+Math.floor(lng*200);
   if(!grid.has(key))grid.set(key,[]);
   grid.get(key).push(id);return id;
 };
 const first=add(...origin,'Referência');
 for(let i=0;i<170;i++)
   add(origin[0]+.0003+(i%13)*.00001,
     origin[1]+.00021+(i%11)*.000009,'Mesmo corredor');
 for(let direction=0;direction<12;direction++){
   const theta=direction*Math.PI/6;
   for(let band=0;band<2;band++){
     const d=.0025+band*.0007;
     far.push(add(origin[0]+Math.sin(theta)*d,
       origin[1]+Math.cos(theta)*d,'Outro corredor'));
   }
 }
 const station=add(origin[0]+.0008,origin[1]+.0015,
   'Estação Rio de Janeiro - Plataforma 1B');
 const normalize=v=>String(v).normalize('NFD')
   .replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const factory=new Function('stops','grid','distance','nearCache',
   'norm','BUFFER','TRANSFER_BUFFER','STATION_ACCESS_BUFFER',
   src.slice(start,stop)+';return {nearby,neighbors,boardingBuffer}');
 const tools=factory(stops,grid,(a,b)=>
   Math.hypot((a[0]-b[0])*111000,(a[1]-b[1])*105000),
   new Map(),normalize,45000,120000,60000);
 return {origin,stops,first,far,station,...tools};
}
test('dense stations keep stops from other directions under a bounded budget',()=>{
 const x=fixtures();
 const normal=x.neighbors(x.first,false);
 const expanded=x.neighbors(x.first,true);
 assert.equal(normal.length,47);
 assert.equal(expanded.length,89);
 assert.ok(normal.filter(([,id])=>x.far.includes(id)).length>=8);
 assert.ok(expanded.filter(([,id])=>x.far.includes(id)).length>=18);
 assert.ok(normal.every(([m])=>m<=300));
 assert.ok(expanded.every(([m])=>m<=450));
 assert.deepEqual(expanded.map(([m])=>m),
   expanded.map(([m])=>m).sort((a,b)=>a-b));
});
test('station access adds an explicit conservative minute of margin',()=>{
 const x=fixtures();
 assert.equal(x.boardingBuffer({rides:0,edge:{mode:'walk',from:'origin',to:x.station}}),105000);
 assert.equal(x.boardingBuffer({rides:1,edge:{mode:'walk',from:x.first,to:x.station}}),180000);
 assert.equal(x.boardingBuffer({rides:1,edge:{mode:'walk',from:x.first,to:x.far[0]}}),120000);
 assert.equal(x.boardingBuffer({rides:1,edge:{mode:'bus'}}),120000);
});
function verifier(){
 return new Function('locationOf','stamp','BUFFER','TRANSFER_BUFFER',
   'stationAccessExtra','MAX_HOURS','HOUR','MIN',
   src.slice(verifyStart,verifyEnd)+';return verifyWalking')(
     point=>point==='origin'?[-19.9,-43.9]:point==='destination'?[-19.87,-43.87]:
       point===0?[-19.89,-43.89]:[-19.895,-43.88],
     epoch=>new Date(epoch).toISOString(),
     45000,120000,
     edge=>edge.from===0&&edge.to===1?60000:0,
     5,3600000,60000
   );
}
const clock=(m,s=0)=>new Date(Date.UTC(2026,10,17,22,m,s)).toISOString();
function itinerary(depMinute,depSecond=0){
 return {legs:[
   {mode:'walk',from:'origin',to:0,departure:clock(0),arrival:clock(1)},
   {mode:'bus',from:0,to:0,departure:clock(5),arrival:clock(11)},
   {mode:'walk',from:0,to:1,departure:clock(11),arrival:clock(18,46)},
   {mode:'bus',from:1,to:1,departure:clock(depMinute,depSecond),
     arrival:clock(depMinute+4,depSecond)},
   {mode:'walk',from:1,to:'destination',
     departure:clock(depMinute+4,depSecond),arrival:clock(depMinute+5,depSecond)}
 ]};
}
const graph={route:(from,to)=>({
  seconds:from[0]===-19.89?466:30,meters:450,
  geometry:[from,to],snapMeters:0,pathSource:'synthetic_test'
})};
test('52s margin after 7m46s station walk is not sold as viable transfer',()=>{
 const result=itinerary(19,38),reasons={};
 const ok=verifier()(result,{requested:Date.parse(clock(0)),backward:false},
   graph,reasons);
 assert.equal(ok,false);
 assert.equal(reasons.insufficientTransferMargin,1);
});
test('a genuinely comfortable transfer remains available after street verification',()=>{
 const result=itinerary(22,10),reasons={};
 const ok=verifier()(result,{requested:Date.parse(clock(0)),backward:false},
   graph,reasons);
 assert.equal(ok,true);
 assert.deepEqual(reasons,{});
 assert.equal(result.confidence,'GTFS_scheduled_with_OSM_walk_graph_and_snap_uncertainty');
});
