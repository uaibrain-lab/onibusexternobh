'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
function slice(begin,end){
 const a=app.indexOf(begin),b=app.indexOf(end,a+begin.length);
 if(a<0||b<=a)throw Error('Missing app source: '+begin);
 return app.slice(a,b);
}
const sessionSrc=slice('let routeSelectionSeq=0;','const normalizeDestination=');
const tabSrc=slice('function switchTab(tab,open=false){','function renderStops(){');
function harness(initialTab='linhas'){
 const els=new Map();
 const element=id=>{
   if(els.has(id))return els.get(id);
   const classes=new Set();
   const obj={textContent:'',value:'',hidden:false,
      setAttribute(){},replaceChildren(){},
      classList:{
        add:k=>classes.add(k),remove:k=>classes.delete(k),
        contains:k=>classes.has(k),toggle:(k,yes)=>{
          if(yes===false)classes.delete(k);
          else if(yes===true)classes.add(k);
          else if(classes.has(k))classes.delete(k);
          else classes.add(k);
        }
      }};
   els.set(id,obj);return obj;
 };
 const ctx={state:{
   route:{code:'5102'},geometry:{selected:{stops:[{id:'a'}]}},
   fleet:{available:true,vehicles:[{vehicleId:'x'}]},
   selectedStop:'a',stopCoordinates:[-19.9,-43.9],
   center:[-19.7,-43.7],zoom:16,selectedVehicle:'x',pattern:'p1',
   lastBusStatus:null,metroVisible:false
 }};
 const src='let activeTab='+JSON.stringify(initialTab)+';'+
  'const state=mockState;const $=element;'+
  'function drawSoon(){} function scheduleMapStops(){} function renderStops(){} '+
  'function syncSheetAccessibility(){} function openSheet(){}'+
  'function updateStatus(){} function loadMetroNews(){return Promise.resolve()}'+
  sessionSrc+tabSrc+
  ';return {state,enter:s=>{lineMapSession=s},exitLineTracking,switchTab,'+
  'isTracking:()=>Boolean(lineMapSession),lineMode:()=>lineMode(),tab:()=>activeTab}';
 return new Function('mockState','element',src)(ctx.state,element);
}
test('line opened from a point restores point context and exact previous viewport',()=>{
 const h=harness('linhas');
 h.enter({tab:'pontos',center:[-19.9,-43.9],zoom:15,stopId:'a'});
 h.exitLineTracking();
 assert.equal(h.tab(),'pontos');
 assert.equal(h.state.route,null);
 assert.equal(h.state.selectedStop,'a');
 assert.deepEqual(h.state.stopCoordinates,[-19.9,-43.9]);
 assert.deepEqual(h.state.center,[-19.9,-43.9]);
 assert.equal(h.state.zoom,15);
 assert.equal(h.isTracking(),false);
});
test('switching away from an independently opened line closes tracking without clearing GPS permission',()=>{
 const h=harness('linhas');
 h.state.userPosition=[-19.8,-43.8];
 h.enter({tab:'linhas',center:[-19.85,-43.85],zoom:14.5});
 // V1 hides the planner: a legacy request for Rotas safely opens Pontos.
 h.switchTab('rotas');
 assert.equal(h.tab(),'pontos');
 assert.equal(h.state.route,null);
 assert.deepEqual(h.state.center,[-19.85,-43.85]);
 assert.deepEqual(h.state.userPosition,[-19.8,-43.8]);
 assert.equal(h.isTracking(),false);
});
test('line selected stops hide all unrelated map stops and preserve individual route markers',()=>{
 assert.match(app,/for\(const stop of \(lineMode\(\)\?\[\]:state\.mapStops\)\)/);
 assert.match(app,/if\(state\.geometry\?\.selected&&lineMode\(\)\)/);
 assert.match(app,/state\.stopMarkers\.push\(\{x,y,stop:s\}\)/);
 assert.match(app,/if\(activeTab==='linhas'&&tab!=='linhas'&&lineMapSession\)/);
 assert.match(app,/function focusLineBoardingStop\(/);
 assert.match(html,/id="lineExit"/);
 assert.match(html,/id="lineStopSelect"/);
 assert.match(html,/id="lineStopForecast"/);
});
test('schedule lookup reports GTFS time only, never bus GPS ETA',()=>{
 const text=slice('async function loadLineStopForecast(stop){','async function selectPattern(){');
 assert.match(text,/type==='scheduled'/);
 assert.match(text,/não é ETA calculado pelo GPS/);
 assert.match(text,/result\.expired/);
});
