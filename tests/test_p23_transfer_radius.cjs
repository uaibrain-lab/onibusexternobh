'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../static/route-worker.js'),'utf8');
const a=src.indexOf('function neighbors(idx,expanded=false) {');
const b=src.indexOf('function serviceActive(',a);
assert.ok(a>=0&&b>a,'Transfer search extracted incorrectly');
test('expanded search checks 450m + 90 diversified stops without changing standard 300m radius',()=>{
 const requests=[],cache=new Map(),stops=[null,['A','Ponto',-19.9,-43.9]];
 const neighbors=new Function('stops','nearCache','nearby',src.slice(a,b)+
   ';return neighbors')(stops,cache,(lat,lng,radius,limit)=>{
   requests.push({lat,lng,radius,limit});
   return [[0,1],[120,2],[350,3]].filter(([meters])=>meters<=radius);
 });
 const normal=neighbors(1,false),expanded=neighbors(1,true);
 assert.equal(requests.length,2);
 assert.equal(requests[0].radius,300);
 assert.equal(requests[1].radius,450);
 assert.equal(requests[0].limit,48);
 assert.equal(requests[1].limit,90);
 assert.deepEqual(normal,[[120,2]]);
 assert.deepEqual(expanded,[[120,2],[350,3]]);
 assert.equal(cache.size,2,'must not accidentally reuse 300m stop-list for 450m');
 neighbors(1,false);neighbors(1,true);
 assert.equal(requests.length,2,'per-stop caches avoid repeated scans');
});
test('transfer walking radius is only expanded when user selects deeper search',()=>{
 assert.match(src,/neighbors\(node\.stop,ctx\.expanded\)/);
 assert.match(src,/transferWalkRadiusMeters:expanded\?450:300/);
 assert.match(src,/verifyWalking\(t,ctx,graph\)/);
});
