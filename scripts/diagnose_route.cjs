#!/usr/bin/env node
/* P23: offline, read-only route diagnosis against the SAME browser GTFS engine.
 * No Google/Moovit API, no external requests, no paid service, no GPS.
 * Usage:
 * node scripts/diagnose_route.cjs --from=-19.90,-43.93 --to=-19.87,-43.96
 *   --at=2026-11-17T19:58:00-03:00 --depth=expanded
 *   --focus=9209+5106,9106+5106,9106+51
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const zlib=require('node:zlib');
const {performance}=require('node:perf_hooks');
const ROOT=path.resolve(__dirname,'..'),CATALOG=path.resolve(ROOT,'catalog');
const BASE='https://local-only.invalid/externo/catalog/scan/';
const TZ='America/Sao_Paulo';
const PUBLIC_STOP_RE=/^[A-Za-z0-9_-]{1,64}$/;
const MAX_STOPS_GZIP=25*1024*1024,MAX_STOPS_JSON=25*1024*1024;

function publicStopCoordinates(ids, catalog=CATALOG){
 if(!Array.isArray(ids)||ids.length>2||ids.some(id=>!PUBLIC_STOP_RE.test(id)))
   throw Error('Identificador público GTFS inválido');
 const file=path.join(catalog,'scan/stops.json.gz');
 if(!fs.existsSync(file)||fs.statSync(file).size>MAX_STOPS_GZIP)
   throw Error('Catálogo público de paradas ausente ou excessivo');
 const bytes=zlib.gunzipSync(fs.readFileSync(file),{maxOutputLength:MAX_STOPS_JSON});
 const stops=JSON.parse(bytes.toString('utf8'));
 if(!Array.isArray(stops)||stops.length>50000)throw Error('Catálogo GTFS de paradas inválido');
 const wanted=new Set(ids),found=new Map();
 for(const row of stops){
   if(!Array.isArray(row)||row.length<4)throw Error('Parada GTFS inválida');
   const id=String(row[0]);
   if(!wanted.has(id))continue;
   const lat=Number(row[2]),lng=Number(row[3]);
   if(!Number.isFinite(lat)||!Number.isFinite(lng)||
      lat< -20.5||lat> -19.5||lng< -44.4||lng> -43.5)
     throw Error('Coordenadas públicas GTFS fora da região BH');
   const previous=found.get(id);
   if(previous&&(previous.lat!==lat||previous.lng!==lng))
     throw Error('Stop_id GTFS duplicado com coordenadas conflitantes');
   found.set(id,{lat,lng});
 }
 for(const id of wanted)if(!found.has(id))throw Error('Stop_id público ausente do catálogo: '+id);
 return found;
}
function options(args,catalog=CATALOG){
 const map=Object.create(null);
 const allowed=new Set(['from','to','fromstop','tostop','at','focus','mode','depth','preference']);
 for(const arg of args){
   const match=arg.match(/^--([a-z]+)=(.+)$/);
   if(!match||!allowed.has(match[1]))throw Error('Argumento incorreto: '+arg);
   if(Object.hasOwn(map,match[1]))throw Error('Argumento duplicado: --'+match[1]);
   map[match[1]]=match[2];
 }
 const publicIds=['fromstop','tostop'].filter(key=>map[key]).map(key=>map[key]);
 const lookup=publicIds.length?publicStopCoordinates(publicIds,catalog):new Map();
 const coords=key=>{
   if(map[key+'stop']){
     if(map[key])throw Error('Escolha coordenadas OU stop_id para --'+key);
     return lookup.get(map[key+'stop']);
   }
   const v=(map[key]||'').split(',').map(Number);
   if(v.length!==2||!v.every(Number.isFinite)||
      v[0]<-20.5||v[0]>-19.5||v[1]<-44.4||v[1]>-43.5)
     throw Error('Use --'+key+'=LAT,LNG na região BH');
   return {lat:v[0],lng:v[1]};
 };
 const at=map.at||'';
 const parsed=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(-03:00|Z)$/.exec(at);
 if(!parsed||!Number.isFinite(Date.parse(at)))
   throw Error('Use --at=2026-11-17T19:58:00-03:00 (fuso explícito)');
 const [,year,month,day,hour,minute,second='00',zone]=parsed;
 const shifted=new Date(Date.parse(at)+(zone==='Z'?0:-3*3600000));
 const actual=[shifted.getUTCFullYear(),shifted.getUTCMonth()+1,
   shifted.getUTCDate(),shifted.getUTCHours(),shifted.getUTCMinutes(),shifted.getUTCSeconds()];
 if(actual.some((value,i)=>value!==Number([year,month,day,hour,minute,second][i])))
   throw Error('Data ou horário GTFS inválido');
 const preference=map.preference||'fastest';
 const mode=map.mode||'departAt',depth=map.depth||'expanded';
 if(!['fastest','balanced','leastWalking','leastTransfers'].includes(preference)||
    !['departAt','arriveBy'].includes(mode)||
    !['standard','expanded'].includes(depth))
   throw Error('Preferência, modo ou profundidade inválidos');
 const focus=(map.focus||'9106+5106,9209+5106,9106+51')
   .split(',').map(x=>x.trim().toUpperCase());
 if(focus.length>12||focus.some(x=>! /^[A-Z0-9]{1,12}\+[A-Z0-9]{1,12}$/.test(x)))
   throw Error('Combinações de linhas inválidas (máximo 12)');
 if(new Set(focus).size!==focus.length)throw Error('Combinações de linhas duplicadas');
 return {origin:coords('from'),destination:coords('to'),at,
   mode,preference,searchDepth:depth,diagnostics:true,focusCombinations:focus};
}
function workerEnv(){
 const messages=[],files=[];
 const fetchLocal=async url=>{
   const u=new URL(url);
   if(u.origin!=='https://local-only.invalid')
     throw Error('REDE EXTERNA BLOQUEADA PELO DIAGNÓSTICO');
   const prefix='/externo/catalog/';
   if(!u.pathname.startsWith(prefix))throw Error('Caminho fora do catálogo');
   const relative=u.pathname.slice(prefix.length);
   if(!/^[a-zA-Z0-9_.\/-]+$/.test(relative)||relative.includes('..'))
     throw Error('Caminho estático inválido');
   const file=path.resolve(CATALOG,relative);
   if(!file.startsWith(CATALOG+path.sep))throw Error('Acesso fora do catálogo');
   files.push(relative);
   if(!fs.existsSync(file))return new Response('missing',{status:404});
   return new Response(fs.readFileSync(file),{status:200});
 };
 const worker={postMessage:x=>messages.push(x)};
 const ctx=vm.createContext({
   self:worker,fetch:fetchLocal,Blob,Response,URL,Date,Intl,
   DecompressionStream,TextDecoder,Uint8Array,Uint32Array,
   Map,Set,Error,Number,Math,Promise,String,Array,console
 });
 ctx.importScripts=file=>{
   if(!['./walk-network.js','./metro-timing.js'].includes(file))
     throw Error('Importação não autorizada: '+file);
   vm.runInContext(fs.readFileSync(path.resolve(ROOT,'static',file),'utf8'),
     ctx,{filename:file});
 };
 vm.runInContext(fs.readFileSync(path.resolve(ROOT,'static/route-worker.js'),'utf8'),
   ctx,{filename:'route-worker.js'});
 async function run(data){
   messages.length=0;
   await worker.onmessage({data});
   const failure=messages.find(x=>x.kind==='error');
   if(failure)throw Error(failure.message);
   return messages;
 }
 return {run,files};
}
function displayTime(input){
 return new Intl.DateTimeFormat('pt-BR',{timeZone:TZ,day:'2-digit',
   month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(input));
}
async function main(){
 const params=options(process.argv.slice(2));
 if(!fs.existsSync(path.join(CATALOG,'scan/index.json')))
   throw Error('Falta catalog/scan/index.json — execute no clone completo do Externo');
 const {run,files}=workerEnv(),started=performance.now();
 await run({kind:'init',seq:1,baseUrl:BASE});
 const events=await run({kind:'plan',seq:2,baseUrl:BASE,params});
 const result=events.find(x=>x.kind==='result')?.data;
 if(!result)throw Error('Motor não retornou resposta');
 const lines=result.itineraries.map((trip,index)=>({
   ordem:index+1,
   linhas:trip.legs.filter(l=>l.mode==='bus').map(l=>l.line).join(' + '),
   saida:displayTime(trip.departure),chegada:displayTime(trip.arrival),
   minutos:trip.durationMinutes,
   caminhadaMetros:trip.walkMetersApprox,
   baldeacoes:trip.transfers,
   tempoApeMin:trip.timeBreakdown?.walkingMinutes??null,
   tempoEmOnibusMin:trip.timeBreakdown?.onboardMinutes??null,
   esperaProgramadaMin:trip.timeBreakdown?.waitingMinutes??null,
   baldeacoesApertadas:trip.journeyQuality?.tightTransfers??0
 }));
 console.log(JSON.stringify({
   diagnostico:'P23_GTFS_OFFLINE_SAME_ENGINE',
   dados:'GTFS programado + OSM local; sem ETA GPS',
   horarioSolicitado:params.at,criterio:params.preference,
   sentidoDaBusca:params.mode,profundidade:params.searchDepth,
   status:result.status,
   stats:result.stats,diagnostics:result.diagnostics,
   linhasEncontradas:lines,
   pedestrianRouting:result.pedestrianRouting,
   arquivosLidos:files.length,
   tempoTotalCalculoMs:Math.round(performance.now()-started)
 },null,2));
 if(result.status==='out_of_calendar'){
   console.error('P23_FORA_DO_CALENDARIO_GTFS');
   process.exitCode=2;
 }else console.log('P23_DIAGNOSTIC_OK');
}
if(require.main===module)
 main().catch(e=>{console.error('P23_DIAGNOSTIC_FAILED:',e.stack||e.message);process.exitCode=2});
module.exports={options,workerEnv,publicStopCoordinates};
