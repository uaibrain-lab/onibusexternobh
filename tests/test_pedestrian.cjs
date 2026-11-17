/* Deterministic OSM graph routing tests; zero external service calls. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib');
function setup(){
 const n=[
 [100,-19900000,-43900000,[[101,-19900000,-43899800,21]]],
 [101,-19900000,-43899800,[[100,-19900000,-43900000,21],[102,-19899800,-43899800,22]]],
 [102,-19899800,-43899800,[[101,-19900000,-43899800,22]]],
 [200,-19899900,-43899900,[[201,-19899700,-43899900,22]]],
 [201,-19899700,-43899900,[[200,-19899900,-43899900,22]]],
 ];
 const out=[],gzip=zlib.gzipSync(JSON.stringify(n));
 const manifest={schema:1,nodeCount:5,tileCount:1,tileScale:100,
   tileNames:['-1990_-4390']};
 const fetcher=async url=>{
   if(url.endsWith('index.json'))return new Response(JSON.stringify(manifest),{status:200});
   if(url.includes('/tiles/'))return new Response(gzip,{status:200});
   return new Response('',{status:404});
 };
 const ctx=vm.createContext({self:{},fetch:fetcher,
  Blob,Response,URL,DecompressionStream,TextDecoder,Uint8Array,
  Math,Number,Map,Set,Promise,Error,console});
 vm.runInContext(fs.readFileSync('static/pedestrian.js','utf8'),ctx);
 return {P:ctx.self.__PedestrianNetwork,fetcher,out};
}
test('OSM connected L-shaped path, not an invented straight-line crossing',async()=>{
 const {P,fetcher}=setup();
 const router=new P('https://example.com/externo/catalog/pedestrian/',fetcher);
 const route=await router.route([-19.900,-43.900],[-19.8998,-43.8998]);
 assert.ok(route);
 assert.ok(route.meters>=43);
 assert.equal(route.graphConnected,true);
 assert.equal(route.pathVerified,true);
 assert.ok(route.geometry.length>=4);
});
test('disconnected OSM segments return null, even when nearby by air',async()=>{
 const {P,fetcher}=setup();
 const router=new P('https://example.com/externo/catalog/pedestrian/',fetcher);
 const route=await router.route([-19.900,-43.900],[-19.8997,-43.8999]);
 assert.equal(route,null);
});
test('missing static graph does not invent pedestrian routing',async()=>{
 const {P}=setup();
 const router=new P('https://example.com/pedestrian/',async()=>new Response('',{status:404}));
 assert.equal(await router.init(),false);
 assert.equal(await router.route([-19.9,-43.9],[-19.8998,-43.8998]),null);
});
