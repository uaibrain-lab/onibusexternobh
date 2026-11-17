/* P9 — Adapter read-only for legacy lines/stops screens on Firebase Spark.
 * All catalog data is loaded from static public GTFS files, no paid Python API.
 * Important: live vehicle GPS is NOT fabricated or cached as real time.
 */
'use strict';
(function(global){
const root=new URL('./catalog/',location.href);
const memo=new Map();
function distance(a,b){
 const ra=Math.PI/180,p=(a[0]-b[0])*ra,q=(a[1]-b[1])*ra;
 return 12742000*Math.asin(Math.min(1,Math.sqrt(
  Math.sin(p/2)**2+Math.cos(a[0]*ra)*Math.cos(b[0]*ra)*Math.sin(q/2)**2)));
}
function normalize(str){
 return String(str??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
async function get(name){
 if(!memo.has(name)){
   memo.set(name,(async()=>{
     const response=await fetch(new URL(name,root),{cache:'force-cache'});
     if(!response.ok)throw Error('Catálogo estático '+name+' indisponível: '+response.status);
     return response.json();
   })());
 }
 try{return await memo.get(name)}catch(e){memo.delete(name);throw e}
}
function stopObject(id,row){
 return {id:String(id),name:row[0],lat:row[1],lng:row[2]};
}
async function api(path){
 const url=new URL(path,'https://offline.local');
 const p=url.pathname,params=url.searchParams;
 if(p==='/api/routes'){
   const routes=await get('routes.json');
   return routes.map(r=>({id:r.id,code:r.code,name:r.name,
     patternCount:r.patterns?.length||0}));
 }
 if(p==='/api/route'){
   const code=params.get('code'),pattern=params.get('pattern');
   const [routes,patterns]=await Promise.all([get('routes.json'),get('patterns.json')]);
   const route=routes.find(r=>r.code===code);
   if(!route)throw Error('Linha não encontrada no GTFS');
   const byId=new Map(patterns.map(x=>[x.id,x]));
   const pats=route.patterns.map(id=>byId.get(id)).filter(Boolean);
   const answer={code:route.code,name:route.name,patterns:pats.map(x=>({
     id:x.id,shapeId:x.shape,headsign:x.headsign,
     stops:x.stops.length,tripCount:x.tripCount
   }))};
   if(pattern){
     const selected=pats.find(x=>x.id===pattern);
     if(!selected)throw Error('Variante de linha não encontrada');
     const [shapes,stops]=await Promise.all([get('shapes.json'),get('stops.json')]);
     answer.selected={patternId:selected.id,shapeId:selected.shape,
       headsign:selected.headsign,coordinates:shapes[selected.shape]||[],
       stops:selected.stops.filter(id=>stops[id]).map(id=>stopObject(id,stops[id]))};
   }
   return answer;
 }
 if(p==='/api/stops'){
   const stops=await get('stops.json'),q=normalize(params.get('q')).trim();
   const result=[];
   for(const [id,row] of Object.entries(stops)){
     if(q&&!normalize(id).includes(q)&&!normalize(row[0]).includes(q))continue;
     result.push(stopObject(id,row));
     if(result.length>=50)break;
   }
   return {items:result,truncated:result.length===50,query:params.get('q')||''};
 }
 if(p==='/api/map-stops'){
   const stops=await get('stops.json');
   const bounds=['minlat','minlng','maxlat','maxlng'].map(k=>Number(params.get(k)));
   if(bounds.some(x=>!Number.isFinite(x)))throw Error('Área inválida');
   const [a,b,c,d]=bounds;
   const result=[];let total=0;
   for(const [id,row] of Object.entries(stops)){
     if(row[1]>=a&&row[1]<=c&&row[2]>=b&&row[2]<=d){
       total++;
       if(result.length<550)result.push(stopObject(id,row))
     }
   }
   return {items:result,total,truncated:total>550};
 }
 if(p==='/api/nearby-stops'){
   const stops=await get('stops.json');
   const a=Number(params.get('lat')),b=Number(params.get('lng'));
   if(!Number.isFinite(a)||!Number.isFinite(b))throw Error('Coordenadas inválidas');
   const nearest=[];
   for(const [id,row] of Object.entries(stops)){
     const m=distance([a,b],[row[1],row[2]]);
     if(m<=2500)nearest.push({...stopObject(id,row),distanceM:Math.round(m)})
   }
   nearest.sort((x,y)=>x.distanceM-y.distanceM);
   return {items:nearest.slice(0,15),count:nearest.length};
 }
 if(p==='/api/stop'){
   const id=params.get('id');
   const [stops,stopRoutes,routes]=await Promise.all([
     get('stops.json'),get('routing-stop-routes.json'),get('routes.json')]);
   if(!stops[id])throw Error('Ponto não registrado no GTFS');
   const names=new Map(routes.map(r=>[r.code,r.name]));
   return {...stopObject(id,stops[id]),
     routes:(stopRoutes[id]||[]).map(code=>({
       code,name:names.get(code)||code,nextArrival:null
     })),asOf:new Date().toISOString(),
     forecastSource:'GTFS static, not live',timetableAvailable:false};
 }
 if(p==='/api/fleet'){
   const code=params.get('route')||'';
   return {line:code,name:code,asOf:new Date().toISOString(),
     count:0,vehicles:[],sources:{},gpsAvailable:false};
 }
 if(p==='/api/status'){
   return {now:new Date().toISOString(),gpsRecent:0,vehiclesKnown:0,
     sources:{},refreshIntervalSec:null,gpsAvailable:false};
 }
 throw Error('Recurso não disponível na hospedagem estática gratuita: '+p);
}
global.__StaticCatalogAPI={api,get};
})(window);
