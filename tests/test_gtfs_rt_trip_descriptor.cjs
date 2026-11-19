'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const parser=import('../gps-worker/src/gtfs-rt.mjs').then(m=>m.parseVehiclePositions);
function vint(n){const out=[];do{const b=n%128;n=Math.floor(n/128);out.push(b|(n?128:0))}while(n);return out}
function bytes(f,p){return [...vint(f*8+2),...vint(p.length),...p]}
function str(f,v){return bytes(f,[...Buffer.from(v)])}
function num(f,v){return [...vint(f*8),...vint(v)]}
function flt(f,v){const b=Buffer.alloc(4);b.writeFloatLE(v);return [...vint(f*8+5),...b]}
function feed({date='20261119',time='25:15:00',sequence=12}={}){
 const trip=[...str(1,'TRIP-1'),...str(2,time),...str(3,date),...str(5,'9106')];
 const pos=[...flt(1,-19.9),...flt(2,-43.9)];
 const veh=[...bytes(1,trip),...bytes(2,pos),...num(3,sequence),...num(5,Math.floor(Date.now()/1000)),...bytes(8,str(1,'BUS-1'))];
 return Uint8Array.from([...bytes(1,str(1,'2.0')),...bytes(2,bytes(4,veh))]);
}
test('preserves GTFS-RT trip instance and stop sequence, never ETA',async()=>{
 const p=await parser;const x=p(feed(),['9106']).records;
 assert.equal(x.length,1);
 assert.deepEqual([x[0].tripId,x[0].routeId,x[0].startDate,x[0].startTime,x[0].currentStopSequence],['TRIP-1','9106','20261119','25:15:00',12]);
 assert.equal('eta' in x[0],false);
});
test('invalid optional instance fields are not published',async()=>{
 const p=await parser;const x=p(feed({date:'invalid',time:'wrong',sequence:0}),['9106']).records[0];
 assert.equal('startDate' in x,false);assert.equal('startTime' in x,false);assert.equal(x.currentStopSequence,0);
});
test('unrequested route remains filtered',async()=>{
 const p=await parser;assert.equal(p(feed(),['5106']).records.length,0);
});
