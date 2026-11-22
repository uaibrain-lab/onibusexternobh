'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../static/route-worker.js'),'utf8');
function excerpt(start,end){
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 if(a<0||b<=a)throw Error('Expected worker source structure changed: '+start);
 return src.slice(a,b);
}
const ranker=excerpt('function ranked(ctx,preference,limit=6) {','async function metroHints(');
const buildRanked=new Function('reconstruct',ranker+
  ';return {ranked,chooseDiverseItineraries};');
function itinerary(when,lines,idx){
 return {
   departure:new Date(when-30*60000).toISOString(),
   arrival:new Date(when).toISOString(),
   walkMetersApprox:800,transfers:lines.length-1,rides:lines.length,
   legs:lines.map((line,i)=>({mode:'bus',line,tripId:'t'+idx+'-'+i,
     from:i,to:i+1}))
 };
}
test('ranker includes a distinct 9106+5106 alternative after crowding from another line combination',()=>{
 const original=Date.UTC(2026,10,17,23,0);
 const candidates=[];
 for(let i=0;i<64;i++)candidates.push(itinerary(original+i*1000,['9106','9502'],i));
 candidates.push(itinerary(original+65*1000,['9106','5106'],65));
 const {ranked}=buildRanked(x=>x);
 const result=ranked({finals:candidates,backward:false},'fastest',56);
 const signatures=result.map(t=>t.legs.filter(x=>x.mode==='bus').map(x=>x.line).join('+'));
 assert.ok(signatures.includes('9106+5106'),'A different line combination must survive candidate pruning');
 assert.equal(result[0].legs[0].line,'9106');
});
test('after walking validation, 6 answers keep earliest and multiple line combinations',()=>{
 const {chooseDiverseItineraries}=buildRanked(x=>x);
 const base=Date.UTC(2026,10,17,23,0);
 const candidates=[];
 for(let i=0;i<9;i++)candidates.push(itinerary(base+i*60000,['9106','9502'],i));
 candidates.push(itinerary(base+10*60000,['9106','5106'],10));
 candidates.push(itinerary(base+11*60000,['9209','5106'],11));
 const result=chooseDiverseItineraries(candidates,6);
 assert.equal(result.length,6);
 const sig=result.map(t=>t.legs.filter(x=>x.mode==='bus').map(x=>x.line).join('+'));
 assert.equal(sig[0],'9106+9502');
 assert.ok(sig.includes('9106+5106'));
 assert.ok(sig.includes('9209+5106'));
 assert.ok(sig.filter(x=>x==='9106+9502').length<=4);
});
test('expanded routing tests more access points without inventing GPS or paid APIs',()=>{
 const seed=excerpt('function seedStops(ctx,which) {','async function scanHour(');
 const calls=[];
 const fn=new Function('nearby','walkSeconds','rounded','insert',seed+';return seedStops')(
   (...args)=>{calls.push(args);return [[100,2],[200,5]]},
   ()=>90,x=>Math.round(x),
   (labels,node)=>{labels.set(node.stop,node);return true}
 );
 const ctx={origin:[-19.9,-43.9],destination:[-19.8,-43.95],
   backward:false,requested:Date.UTC(2026,10,17,23,0),
   accessRadius:1450,accessLimit:80,ends:new Map(),labels:new Map()};
 fn(ctx,'start');fn(ctx,'end');
 assert.equal(calls.length,2);
 assert.equal(calls[0][2],1450);
 assert.equal(calls[0][3],80);
 assert.equal(ctx.labels.size,2);
 assert.equal(ctx.ends.size,2);
});
test('routing UI remains honest about scheduled data and date limitations',()=>{
 assert.match(src,/validFrom/);
 assert.match(src,/validThrough/);
 assert.match(src,/GTFS scheduled/);
 assert.match(src,/walkCandidatesRejected/);
 assert.ok(!/Moovit.{0,30}39\s*min/.test(src));
});
