'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const worker=fs.readFileSync(path.join(__dirname,'../static/route-worker.js'),'utf8');
const walkSource=fs.readFileSync(path.join(__dirname,'../static/walk-network.js'),'utf8');
const slice=(begin,end)=>{
 const start=worker.indexOf(begin),finish=worker.indexOf(end,start+begin.length);
 if(start<0||finish<start)throw Error('Missing source: '+begin);
 return worker.slice(start,finish);
};
function walkingFixture(){
 const ctx=vm.createContext({Math,Map,Set,Array,Error,Number,String});
 vm.runInContext(walkSource,ctx);
 return vm.runInContext('new WalkGraph.Network('+JSON.stringify({
   schema:1,source:'synthetic',osmDate:'2026-11-17',
   nodes:[[-19.9000,-43.9000],[-19.9001,-43.9000],
     [-19.9002,-43.9000],[-19.9001,-43.9002],[-19.9002,-43.9002]],
   edges:[[0,1,11.1],[1,2,11.1],[3,4,11.1]],
   nodeCount:5,edgeCount:3
 })+')',ctx);
}
test('one Dijkstra finds reachable stops and rejects closer-looking disconnected street',()=>{
 const g=walkingFixture();
 const found=g.distancesToStops([-19.9000,-43.9000],[
   {index:1,coords:[-19.9002,-43.9000]},
   {index:2,coords:[-19.9002,-43.9002]}
 ],400);
 assert.equal(found.size,1);
 assert.equal(found.get(1).meters,22);
 assert.equal(found.get(1).seconds,55);
 assert.equal(found.has(2),false,'straight-line does not imply walkable');
 assert.equal(g.distancesToStops([-19.905,-43.905],[],400).size,0);
});
test('street access is seeded BEFORE timetable scan using real path seconds',()=>{
 const graph=walkingFixture();
 const records=[['unused','X',-19.9000,-43.9000],
   ['b','Reachable',-19.9002,-43.9000],
   ['c','Disconnected',-19.9002,-43.9002]];
 const seed=new Function('nearby','stops','walkSeconds','rounded','insert',
   slice('function seedStops(ctx,which) {','async function scanHour(')+';return seedStops')(
   ()=>[[22,1],[30,2]],records,m=>Math.ceil(m/1.15)+35,m=>Math.round(m*1.35),
   (labels,node)=>{labels.set(node.stop,[node]);return true}
 );
 const clock=Date.UTC(2026,10,17,22);
 const ctx={origin:[-19.9000,-43.9000],destination:[-19.9000,-43.9000],
   backward:false,requested:clock,graph,accessRadius:1100,accessLimit:48,
   labels:new Map(),ends:new Map(),accessStats:{
     streetOriginStops:null,streetDestinationStops:null,unreachableStops:0
   }};
 seed(ctx,'start');seed(ctx,'end');
 assert.equal(ctx.labels.size,1,'disconnected boarding stop is never seeded');
 assert.equal(ctx.labels.get(1)[0].time-clock,55_000);
 assert.equal(ctx.ends.size,1,'unreachable final stop is omitted');
 assert.equal(ctx.ends.get(1).meters,22);
 assert.equal(ctx.accessStats.streetOriginStops,1);
 assert.equal(ctx.accessStats.streetDestinationStops,1);
 assert.equal(ctx.accessStats.unreachableStops,2);
});
test('end walking time does not inflate OSM road distance using a second 1.35 factor',()=>{
 const emit=new Function('insert','addTransfers','walkSeconds','rounded','BUFFER',
   slice('function emit(node,ctx) {','function processConnection(conn,ctx)')+
   ';return emit')(
   ()=>true,()=>{},m=>Math.ceil(m/1.15)+35,m=>Math.round(m*1.35),45_000
 );
 const now=Date.UTC(2026,10,17,22);
 const ctx={ends:new Map([[1,{meters:100,seconds:122}]]),
   labels:new Map(),pending:new Set(),backward:false,
   lo:now-1000,hi:now+3600000,finals:[],partial:false,
   partialReasons:{finals:0}};
 const node={stop:1,time:now,walk:0,rides:1};
 emit(node,ctx);
 assert.equal(ctx.finals.length,1);
 assert.equal(ctx.finals[0].meters,100);
 assert.equal(ctx.finals[0].time,now+122000);
 assert.equal(ctx.finals[0].endingSeconds,122);
});
test('large geocode/stop set refuses unbounded pedestrian traversal',()=>{
 const g=walkingFixture();
 assert.equal(g.distancesToStops([-19.9,-43.9],
   Array.from({length:161},(_,i)=>({index:i,coords:[-19.9,-43.9]})),2500).size,0);
 assert.equal(g.distancesToStops([-19.9,-43.9],[],99999).size,0);
});
