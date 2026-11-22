'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../static/route-worker.js'),'utf8');
const begin=code.indexOf('function nearby(lat,lng,radius=1050,limit=22) {');
const end=code.indexOf('function neighbors(idx,expanded=false)',begin);
assert.ok(begin>=0&&end>begin,'Nearby code moved');
function fixture(){
  const start=[-19.9,-43.9];
  const stops=[],grid=new Map();
  function add(lat,lng,label){
    const id=stops.length;
    stops.push([String(id),label,lat,lng]);
    const key=Math.floor(lat*200)+','+Math.floor(lng*200);
    if(!grid.has(key))grid.set(key,[]);
    grid.get(key).push(id);
    return id;
  }
  // Dense nearby corridor on one side, enough to crowd out other directions
  // under the old 48/80-nearest-stop cap.
  for(let i=0;i<185;i++)
    add(start[0]+0.0003+(i%13)*0.000008,
        start[1]+0.0002+(i%17)*0.000005,'Corredor leste');
  // Several valid boarding corridors further away yet inside 1.3km.
  const other=[];
  for(let k=0;k<8;k++){
    const theta=k*Math.PI/4;
    for(let j=0;j<3;j++){
      const d=0.004+j*0.001;
      const lat=start[0]+Math.sin(theta)*d;
      const lng=start[1]+Math.cos(theta)*d;
      other.push(add(lat,lng,'Outro corredor '+k));
    }
  }
  const distance=([a,b],[c,d])=>Math.hypot((a-c)*111000,(b-d)*105000);
  const nearby=new Function('grid','stops','distance',
    code.slice(begin,end)+';return nearby')(grid,stops,distance);
  return {nearby,start,other};
}
test('Nearby retains nearest but also stops from multiple directions',()=>{
  const {nearby,start,other}=fixture();
  const current=nearby(...start,1300,120);
  assert.equal(current.length,120);
  const otherKept=current.filter(([,id])=>other.includes(id));
  assert.ok(otherKept.length>=8,
    'near-side cluster must not consume every available candidate');
  assert.ok(current.some(([,id])=>id===0),'nearest stop must remain');
  const expanded=nearby(...start,1700,160);
  assert.equal(expanded.length,160);
  assert.ok(expanded.filter(([,id])=>other.includes(id)).length>=8);
});
test('Transfer mode with small limits preserves nearest-first semantics',()=>{
  const {nearby,start}=fixture();
  const stops=nearby(...start,300,18);
  assert.ok(stops.length<=18);
  assert.ok(stops.every(([m])=>m<=300));
  assert.deepEqual(stops.map(x=>x[0]),
    [...stops.map(x=>x[0])].sort((a,b)=>a-b));
});
test('Standard and expanded use bounded broad-area candidate budgets',()=>{
  assert.match(code,/accessRadius:expanded\?1700:1300/);
  assert.match(code,/accessLimit:expanded\?160:120/);
  assert.match(code,/distancesToStops\(place,found\.map/);
  assert.match(code,/roads?|walking_unavailable|pedestrianAccess/);
});
