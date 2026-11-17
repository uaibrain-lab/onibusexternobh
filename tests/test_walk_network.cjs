/* P9 A* street graph: no fictional shortcut between disconnected sidewalks. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),vm=require('node:vm');
function createGraph(){
 const ctx=vm.createContext({Math,Map,Set,Array,Error,Number,String,console});
 vm.runInContext(fs.readFileSync('static/walk-network.js','utf8'),ctx);
 const obj={schema:1,source:'fixture',osmDate:'2026-11-17T00:00:00Z',
   nodes:[[-19.9000,-43.9000],[-19.9001,-43.9000],[-19.9002,-43.9000],
          [-19.9001,-43.9002],[-19.9002,-43.9002]],
   edges:[[0,1,11.1],[1,2,11.1],[3,4,11.1]],nodeCount:5,edgeCount:3};
 return vm.runInContext('new WalkGraph.Network('+JSON.stringify(obj)+')',ctx);
}
test('finds a real path through OSM graph, not direct crossing',()=>{
 const g=createGraph();
 const result=g.route([-19.9000,-43.9000],[-19.9002,-43.9000],400);
 assert.ok(result);
 assert.ok(result.meters>20);
 assert.equal(result.geometry.length,5);
 assert.ok(result.pathSource.includes('OSM'));
});
test('rejects an unreal walk across disconnected streets',()=>{
 const g=createGraph();
 assert.equal(g.route([-19.9000,-43.9000],[-19.9002,-43.9002],500),null);
});
test('rejects locations too far away from pedestrian OSM network',()=>{
 const g=createGraph();
 assert.equal(g.route([-19.905,-43.900],[-19.900,-43.900],1500),null);
});
test('road path length must be inside configured walk budget',()=>{
 const g=createGraph();
 assert.equal(g.route([-19.9000,-43.9000],[-19.9002,-43.9000],15),null);
});
