'use strict';
/* P20: regression for ReferenceError in initial OSM tile drawing.
   Extract the actual map/tile functions from app.js so this test fails if
   TILE_CACHE_LIMIT is removed again. No DOM, external network or API costs.
 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');

function slice(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  if(a<0||b<a)throw Error('Unexpected map source layout: '+start);
  return app.slice(a,b);
}
const settings=slice('const MAX_Z=18,MIN_Z=10;','function mercator(');
const mercator=slice('function mercator(','function invMercator(');
const tileCode=slice('let basemapFailures=0;','function draw(){');
const compilation=settings+mercator+tileCode+
  '\nreturn {drawTiles,getTile,tileLimit:TILE_CACHE_LIMIT};';

function start(){
  const state={zoom:15,center:[-19.8695,-43.9675],tiles:new Map()};
  const counters={fill:0,stroke:0,drawImage:0};
  const ctx={
    fillStyle:'',strokeStyle:'',
    fillRect(){counters.fill++},
    strokeRect(){counters.stroke++},
    drawImage(){counters.drawImage++}
  };
  const document={documentElement:{dataset:{theme:'light'}}};
  const get=id=>({hidden:true});
  const tiles=new Function('state','ctx','document','Image','drawSoon','$',compilation)(
    state,ctx,document,class Image{
      constructor(){this.onload=null;this.onerror=null;this.src=''}
    },()=>{},get);
  return {state,counters,...tiles};
}

test('initial canvas paints fallback grid instead of throwing ReferenceError',()=>{
  const map=start();
  assert.equal(map.tileLimit,120);
  assert.doesNotThrow(()=>map.drawTiles(390,720));
  assert.ok(map.counters.fill>0,'drawTiles must actually paint canvas');
  assert.ok(map.counters.stroke>0,'the fallback outlines must paint');
  assert.ok(map.state.tiles.size>0,'must schedule tiles asynchronously');
});
test('tile cache remains bounded during repeated map pans',()=>{
  const map=start();
  for(let i=0;i<240;i++)map.getTile(15,11000+i,18000);
  assert.ok(map.state.tiles.size<=map.tileLimit+16);
});
test('responsive P20 CSS defines separate desktop and mobile four-column tabs',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../static/hub-parity.css'),'utf8');
  assert.match(css,/P20 — mapa \+ painel/);
  assert.match(css,/#sheet \.quick-tabs\s*\{[\s\S]*?grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/#map \.map-toast\s*\{[\s\S]*?right:72px/);
  assert.match(css,/#map \.map-controls\s*\{[\s\S]*?right:12px/);
  assert.match(css,/#sheet \.quick-tabs button\s*\{[\s\S]*?min-width:0/);
});
