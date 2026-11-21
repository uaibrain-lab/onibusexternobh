#!/usr/bin/env node
/* P18: one-shot, read-only verification of the ACTUAL published Pages site.
 * Makes <15 small GETs + ONE GPS observation request. No loops, writes,
 * origin bypass, vehicle identifiers, passenger location or load testing.
 */
'use strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const SITE='https://externo-bh-hml-uaibrain.pages.dev';
const WORKER='https://externo-bh-gps-free.hubufmg.workers.dev';
const EXPECTED_ROUTE='5102';
const PREFIX='/externo/';
const expectedSource='gtfs_rt';
const nowISO=()=>new Date().toISOString();
const maxAgeMs=10*60*1000;

export async function auditPublishedSite({
  fetchImpl=fetch,
  clock=()=>Date.now(),
  sourceConfigFile=new URL('../static/gps-config.json',import.meta.url)
}={}){
  const checks=[],details={},warnings=[];
  const check=(name,ok,description='')=>{
    checks.push({name,ok:Boolean(ok),...(description?{description}:{})});
  };
  const get=async(path,{origin,expectJson=false}={})=>{
    const url=new URL(path,SITE);
    if(url.origin!==SITE)throw Error('UNEXPECTED_PUBLIC_ORIGIN');
    const headers={Accept:expectJson?'application/json':'*/*'};
    if(origin)headers.Origin=origin;
    const response=await fetchImpl(url.href,{
      method:'GET',headers,cache:'no-store',
      signal:AbortSignal.timeout(15000)
    });
    let body;
    if(expectJson)body=await response.json();
    else body=await response.text();
    return {response,body};
  };
  let source;
  try {
    source=JSON.parse(readFileSync(sourceConfigFile,'utf8'));
    check('repo-default-gps-disabled',source.enabled===false);
  }catch(e){check('repo-default-gps-disabled',false,String(e.message).slice(0,120))}

  let html;
  try{
    const {response,body}=await get(PREFIX);
    html=body;
    check('pages-html-200',response.status===200);
    check('pages-marked-gps-staging',
      body.includes('data-gps-homologacao="true"')&&
      body.includes('data-app-mode="free-static"')&&
      body.includes('gps-staging-label'));
    check('noindex-staging',body.includes('noindex,nofollow,noarchive')||
      String(response.headers.get('x-robots-tag')||'').includes('noindex'));
  }catch(e){check('pages-html-200',false,e.message)}

  let config;
  try{
    const {response,body}=await get(PREFIX+'gps-config.json',{expectJson:true});
    config=body;
    check('pages-gps-enabled-staging-only',response.status===200&&
      body.enabled===true&&body.provider===expectedSource&&
      body.endpoint===WORKER+'/api/gps'&&body.refreshSeconds>=25);
    check('gps-config-uncached',
      /no-store/i.test(response.headers.get('cache-control')||''),
      'Cache-Control no-store is required on staged GPS config');
    details.gpsConfig={enabled:body.enabled,provider:body.provider,
      refreshSeconds:body.refreshSeconds};
  }catch(e){check('pages-gps-enabled-staging-only',false,e.message)}

  for(const asset of ['app.js','live-gps.js','static-bus.js','service-worker.js']){
    try{
      const {response,body}=await get(PREFIX+asset);
      check('asset-'+asset,response.status===200&&body.length>120);
    }catch(e){check('asset-'+asset,false,e.message)}
  }

  try{
    const {response,body}=await get(PREFIX+'catalog/routes.json',{expectJson:true});
    const found=Array.isArray(body)&&body.find(x=>String(x.code)===EXPECTED_ROUTE);
    check('catalog-route-5102',response.status===200&&Boolean(found));
    details.gtfsRouteId=found?.id||null;
  }catch(e){check('catalog-route-5102',false,e.message)}

  let index,manifest;
  try{
    const [i,m,a]=await Promise.all([
      get(PREFIX+'catalog/scan/index.json',{expectJson:true}),
      get(PREFIX+'catalog/manifest.json',{expectJson:true}),
      get(PREFIX+'catalog/arrivals/index.json',{expectJson:true})
    ]);
    index=i.body;manifest=m.body;
    check('published-gtfs-same-edition',
      i.response.status===200&&m.response.status===200&&
      String(index.validThrough)===String(manifest.feedEndDate)&&
      Number(index.tripCount)>1000);
    check('published-arrivals-catalog',
      a.response.status===200&&a.body?.schema===1&&
      Number(a.body?.stopCount)>9000);
    // Official BH GTFS catalog uses YYYYMMDD (e.g. 20261231), not ISO.
    // Accept both to prevent a false expiry alarm for a valid official feed.
    const rawDate=String(index.validThrough||'');
    const datePart=/^\d{8}$/.test(rawDate)
      ?rawDate.slice(0,4)+'-'+rawDate.slice(4,6)+'-'+rawDate.slice(6,8)
      :rawDate;
    const validDate=/^\d{4}-\d{2}-\d{2}$/.test(datePart)
      ?Date.parse(datePart+'T23:59:59-03:00')
      :NaN;
    details.gtfsValidThrough=index.validThrough;
    check('published-gtfs-valid-today',
      Number.isFinite(validDate)&&clock()<=validDate,
      'If expired, scheduled times are not verified for the current date');
  }catch(e){check('published-gtfs-same-edition',false,e.message)}

  // Fetch from a browser-like, exact Pages Origin and verify the same
  // Access-Control-Allow-Origin the browser enforces.
  try{
    const response=await fetchImpl(WORKER+'/api/gps/capabilities',{
      headers:{Origin:SITE,Accept:'application/json'},cache:'no-store',
      signal:AbortSignal.timeout(15000)
    });
    const body=await response.json();
    check('gps-worker-cors-stage-origin',
      response.status===200&&
      response.headers.get('access-control-allow-origin')===SITE&&
      body?.supportedSources?.includes('GTFS_RT'));
    details.workerVersion=body.apiVersion||null;
  }catch(e){check('gps-worker-cors-stage-origin',false,e.message)}

  try{
    const url=new URL(WORKER+'/api/gps');
    url.searchParams.set('source','GTFS_RT');
    url.searchParams.set('routes',EXPECTED_ROUTE);
    const started=performance.now();
    const response=await fetchImpl(url.href,{
      headers:{Origin:SITE,Accept:'application/json'},cache:'no-store',
      signal:AbortSignal.timeout(15000)
    });
    const body=await response.json();
    const ok=response.status===200&&body?.available===true&&
      body?.source==='GTFS_RT'&&Array.isArray(body?.records)&&
      response.headers.get('access-control-allow-origin')===SITE;
    check('official-sumob-gtfs-rt-live',ok);
    const records=Array.isArray(body?.records)?body.records:[];
    const time=clock();
    const valid=records.every(v=>
      String(v.routeId)===EXPECTED_ROUTE&&
      Number.isFinite(Date.parse(v.lastGpsFixAt))&&
      Date.parse(v.lastGpsFixAt)<=time+60000&&
      time-Date.parse(v.lastGpsFixAt)<=maxAgeMs&&
      Number.isFinite(Number(v.latitude))&&
      Number.isFinite(Number(v.longitude))&&
      !('etaMinutes' in v));
    check('gps-no-stale-or-fabricated-eta',ok&&valid);
    const ages=records.map(v=>(time-Date.parse(v.lastGpsFixAt))/1000);
    details.gps={
      http:response.status,
      vehiclesObserved:records.length,
      feedEntities:Number.isInteger(body?.feedEntities)?body.feedEntities:null,
      freshestFixAgeSeconds:ages.length?Math.round(Math.min(...ages)):null,
      elapsedMs:Math.round(performance.now()-started),
      upstreamError:body?.error||null,
      reason:body?.reason||null,
      upstreamStatus:body?.upstreamStatus||null
    };
    if(ok&&records.length===0)
      warnings.push('Sem correspondência GPS da linha 5102 nesta consulta; isso NÃO prova ausência de ônibus.');
    if(!ok)warnings.push('GPS oficial indisponível nesta consulta. Horários GTFS devem permanecer acessíveis.');
  }catch(e){
    check('official-sumob-gtfs-rt-live',false,e.message);
  }

  const failed=checks.filter(x=>!x.ok);
  return {audit:'P18_PUBLIC_PAGES_READ_ONLY',
    site:SITE+PREFIX,checkedAt:nowISO(),
    passed:checks.length-failed.length,total:checks.length,
    failed:failed.map(x=>x.name),
    checks,details,warnings,
    productionSiteChanged:false};
}

async function main(){
  const report=await auditPublishedSite();
  console.log(JSON.stringify(report,null,2));
  if(report.failed.length){
    console.error('P18_PUBLIC_AUDIT_FAILED: veja failed e checks acima.');
    process.exitCode=2;
  }else console.log('P18_PUBLIC_AUDIT_OK');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{
    console.error('P18_PUBLIC_AUDIT_UNEXPECTED_ERROR:',e.message);
    process.exitCode=2;
  });
