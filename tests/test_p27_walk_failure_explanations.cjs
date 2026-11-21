'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const walk=fs.readFileSync(path.join(__dirname,'../static/walk-network.js'),'utf8');
const worker=fs.readFileSync(path.join(__dirname,'../static/route-worker.js'),'utf8');
const Net=new Function(walk+';return WalkGraph.Network;')();
function fixture(){
 return new Net({schema:1,source:'fixture',nodeCount:5,edgeCount:3,
   nodes:[[-19.9,-43.9],[-19.9001,-43.9],[-19.9002,-43.9],
     [-19.9,-43.9003],[-19.9001,-43.9003]],
   edges:[[0,1,11.1],[1,2,11.1],[3,4,11.1]]});
}
test('route rejection reports disconnected pedestrian components without fabricating footbridge',()=>{
 const graph=fixture(),a=[-19.9,-43.9],b=[-19.9001,-43.9003];
 assert.equal(graph.route(a,b,500),null);
 assert.equal(graph._componentIds,undefined,'normal planner must not precompute components');
 const status=graph.explainFailure(a,b,500);
 assert.equal(status.reason,'disconnectedPedestrianComponents');
 assert.equal(graph._componentIds.length,5,'lazy component lookup is cached');
 assert.equal(status.fromSnapMeters,0);
 assert.equal(status.toSnapMeters,0);
 assert.ok(!Object.keys(status).some(k=>k==='coordinates'||k==='from'||k==='to'));
 assert.equal(graph.route(a,b,500),null,'diagnostics cannot alter graph connectivity');
});
test('no snap and walking budget are separate reported causes',()=>{
 const graph=fixture();
 assert.equal(graph.explainFailure([-19.905,-43.905],[-19.9,-43.9],500).reason,
  'fromUnsnapped');
 assert.equal(graph.explainFailure([-19.9,-43.9],[-19.9002,-43.9],8).reason,
  'minimumWalkingDistanceOverBudget');
 assert.equal(graph.explainFailure([-19.9,-43.9],[-19.9002,-43.9],500).reason,
  'walkDetourExceedsBudgetOrSearchLimit');
 // The last classification is only called for rejected routes; it does
 // not mean this connected 22m example actually failed (it can succeed).
 assert.ok(graph.route([-19.9,-43.9],[-19.9002,-43.9],500));
});
test('route worker explains why a combination failed only in opt-in diagnostics',()=>{
 assert.match(worker,/if\(reasons&&typeof graph\.explainFailure==='function'\)/);
 assert.match(worker,/streetRejectionReasons:rejectedCombinations\.get\(lines\)/);
 assert.match(worker,/if\(params\.diagnostics===true\)/);
 assert.doesNotMatch(walk,/fetch\(|XMLHttpRequest|sendBeacon/);
});
