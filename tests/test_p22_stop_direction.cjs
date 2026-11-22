'use strict';
/* P22 — timetable by route/direction must never show opposite-side arrivals. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
const from=app.indexOf('async function loadLineStopForecast(stop){');
const to=app.indexOf('async function selectPattern(){',from);
assert.ok(from>=0&&to>from,'Route-stop forecast function moved');
const body=app.slice(from,to);
const fold=s=>String(s||'').trim().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase();
const stop={id:'s1',name:'Avenida Antônio Carlos'};
const otherDirection={code:'5102',destination:'UFMG',nextArrival:{
  type:'scheduled',minutes:1,at:'2026-11-17T23:01:00Z'}};
const chosenDirection={code:'5102',destination:'Santo Antônio',nextArrival:{
  type:'scheduled',minutes:8,at:'2026-11-17T23:08:00Z'}};
function setup({headsign='Santo Antônio',api=async()=>({
  routes:[otherDirection,chosenDirection],expired:false
})}={}){
 const elem={textContent:''};
 const state={route:{code:'5102'},pattern:'p1',
   geometry:{selected:{headsign}}};
 const f=new Function('state','api','fold','$','fmtTime','drawSoon',
   'let lineStopForecastSeq=0;let lineFocusStopId="s1";'+
   'const normalizeDestination=fold;'+
   'const lineMode=()=>Boolean(state.route);'+body+
   ';return loadLineStopForecast')(state,api,fold,()=>elem,
   ()=> '20:08',()=>{});
 return {state,elem,lookup:f};
}
test('show only selected direction, never earlier opposite bus at same stop',async()=>{
 const h=setup();
 await h.lookup(stop);
 assert.match(h.elem.textContent,/8 min/);
 assert.doesNotMatch(h.elem.textContent,/1 min/);
 assert.match(h.elem.textContent,/não é ETA calculado pelo GPS/);
});
test('absence of chosen direction never falls back to opposite departure',async()=>{
 const h=setup({api:async()=>({routes:[otherDirection],expired:false})});
 await h.lookup(stop);
 assert.match(h.elem.textContent,/sem horário confirmado/);
 assert.doesNotMatch(h.elem.textContent,/1 min/);
});
test('if selected pattern changes while API is pending, discard its old response',async()=>{
 let release;
 const h=setup({api:()=>new Promise(resolve=>{release=resolve})});
 const pending=h.lookup(stop);
 h.state.pattern='p2';
 h.state.geometry.selected.headsign='UFMG';
 release({routes:[otherDirection,chosenDirection],expired:false});
 await pending;
 assert.equal(h.elem.textContent,'');
});
test('unknown headsign plus two directions is ambiguous, not a reliable ETA',async()=>{
 const h=setup({headsign:''});
 await h.lookup(stop);
 assert.match(h.elem.textContent,/diferentes sentidos/);
 assert.doesNotMatch(h.elem.textContent,/1 min/);
});
