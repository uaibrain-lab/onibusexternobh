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

test('skips pedestrian graph search when no stop snaps to OSM',()=>{
 const g=createGraph();
 // A graph traversal would access adjacency; empty/unsnapped targets must not.
 g.adj[0]=new Proxy(g.adj[0],{get(){throw Error('unexpected OSM traversal')}});
 assert.equal(g.distancesToStops([-19.9,-43.9],[],2500).size,0);
 assert.equal(g.distancesToStops([-19.9,-43.9],
   [{index:7,coords:[-19.95,-43.95]}],2500).size,0);
});
test('still returns walking distance for a snapped candidate',()=>{
 const g=createGraph();
 const found=g.distancesToStops([-19.9,-43.9],
   [{index:7,coords:[-19.9001,-43.9]}],2500);
 assert.ok(found.has(7));
 assert.equal(found.get(7).meters,11);
});

test('skips snapped targets when access alone exceeds walking budget',()=>{
 const g=createGraph();
 const offset=[-19.89964,-43.9]; // ~40 m from the closest OSM node
 const snap=g.nearest(offset);
 assert.ok(snap&&snap[1]>35&&snap[1]<45);
 g.adj[snap[0]]=new Proxy(g.adj[snap[0]],{
   get(){throw Error('unnecessary pedestrian traversal')}
 });
 const found=g.distancesToStops(offset,[{index:11,coords:offset}],70);
 assert.equal(found.size,0); // two access legs already exceed 70 m
});
