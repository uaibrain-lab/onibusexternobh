'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const script=pathToFileURL(path.resolve(__dirname,'../scripts/check_p18_public_site.mjs')).href;
const SITE='https://externo-bh-hml-uaibrain.pages.dev';
const WORKER='https://externo-bh-gps-free.hubufmg.workers.dev';
const NOW=Date.UTC(2026,10,17,20,0,0);
const asJson=(body,{status=200,headers={}}={})=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json',...headers}
});
const asText=(body,{status=200,headers={}}={})=>new Response(body,{status,headers});
const STAGE_HTML='<html lang="pt-BR" data-app-mode="free-static" data-gps-homologacao="true">'+
  '<head><meta name="robots" content="noindex,nofollow,noarchive"></head>'+
  '<body><span class="gps-staging-label">TESTE</span></body></html>';
function makeFetch({badCors=false,noGps=false,badHtml=false,badEdition=false,
                    gpsUnavailable=false}={}){
  const calls=[];
  async function fetchImpl(address,{headers}={}){
    const url=new URL(address);calls.push({href:url.href,origin:headers?.Origin||null});
    if(url.href===SITE+'/externo/')
      return asText(badHtml?'<html></html>':STAGE_HTML);
    if(url.href===SITE+'/externo/gps-config.json')
      return asJson({enabled:true,provider:'gtfs_rt',
        endpoint:WORKER+'/api/gps',refreshSeconds:45},
        {headers:{'Cache-Control':'no-store, max-age=0'}});
    for(const asset of ['app.js','live-gps.js','static-bus.js','service-worker.js']){
      if(url.href===SITE+'/externo/'+asset)return asText('/*stage*/'+'x'.repeat(135));
    }
    if(url.href===SITE+'/externo/catalog/routes.json')
      return asJson([{code:'5102',id:'562055',name:'UFMG/Santo Antônio'}]);
    if(url.href===SITE+'/externo/catalog/scan/index.json')
      return asJson({schema:1,validThrough:'2026-12-31',tripCount:1200});
    if(url.href===SITE+'/externo/catalog/manifest.json')
      return asJson({feedEndDate:badEdition?'2027-01-31':'2026-12-31'});
    if(url.href===SITE+'/externo/catalog/arrivals/index.json')
      return asJson({schema:1,stopCount:9828});
    if(url.href===SITE+'/externo/_headers')return asText('not found',{status:404});
    const cors={'Access-Control-Allow-Origin':badCors?'https://wrong.example':SITE};
    if(url.href===WORKER+'/api/gps/capabilities')
      return asJson({service:'Externo BH GPS',apiVersion:'p16-gtfs-rt-20261117-1',
        supportedSources:['CONVENCIONAL','SUPLEMENTAR','GTFS_RT']},
        {headers:cors});
    if(url.origin===WORKER&&url.pathname==='/api/gps'){
      if(gpsUnavailable)return asJson({available:false,error:'GPS_SOURCE_UNAVAILABLE',
        reason:'GTFS_RT_HTTP_ERROR',upstreamStatus:503},{status:503,headers:cors});
      return asJson({available:true,source:'GTFS_RT',feedEntities:1779,
        fetchedAt:new Date(NOW-3000).toISOString(),
        records:noGps?[]:[{routeId:'5102',vehicleId:'TEST-VEHICLE',
          latitude:-19.87,longitude:-43.966,
          lastGpsFixAt:new Date(NOW-50e3).toISOString()}]},
        {headers:cors});
    }
    throw Error('Unexpected request '+url.href);
  }
  return {fetchImpl,calls};
}
test('P18 public audit verifies stage CORS GTFS GPS without writes or offsite calls',async()=>{
  const {auditPublishedSite}=await import(script);
  const fake=makeFetch();
  const r=await auditPublishedSite({fetchImpl:fake.fetchImpl,clock:()=>NOW});
  assert.deepEqual(r.failed,[]);
  assert.equal(r.passed,r.total);
  assert.equal(r.details.gtfsRouteId,'562055');
  assert.equal(r.details.gps.vehiclesObserved,1);
  assert.equal(r.details.gps.freshestFixAgeSeconds,50);
  assert.equal(r.productionSiteChanged,false);
  const gpsCalls=fake.calls.filter(x=>x.href.includes('/api/gps?'));
  assert.equal(gpsCalls.length,1);
  assert.equal(new URL(gpsCalls[0].href).searchParams.get('routes'),'5102');
  assert.equal(gpsCalls[0].origin,SITE);
});
test('P18 audit detects CORS mismatch or GPS outage',async()=>{
  const {auditPublishedSite}=await import(script);
  const fake=makeFetch({badCors:true,gpsUnavailable:true});
  const r=await auditPublishedSite({fetchImpl:fake.fetchImpl,clock:()=>NOW});
  assert.ok(r.failed.includes('gps-worker-cors-stage-origin'));
  assert.ok(r.failed.includes('official-sumob-gtfs-rt-live'));
  assert.ok(r.warnings.some(x=>x.includes('GPS oficial indisponível')));
  assert.equal(r.details.gps.vehiclesObserved,0);
});
test('P18 distinguishes zero GPS observations from zero circulating buses',async()=>{
  const {auditPublishedSite}=await import(script);
  const fake=makeFetch({noGps:true});
  const r=await auditPublishedSite({fetchImpl:fake.fetchImpl,clock:()=>NOW});
  assert.equal(r.failed.length,0);
  assert.equal(r.details.gps.vehiclesObserved,0);
  assert.ok(r.warnings.some(x=>x.includes('NÃO prova ausência')));
});
test('P18 audit rejects missing staging and mismatched GTFS editions',async()=>{
  const {auditPublishedSite}=await import(script);
  const fake=makeFetch({badHtml:true,badEdition:true});
  const r=await auditPublishedSite({fetchImpl:fake.fetchImpl,clock:()=>NOW});
  assert.ok(r.failed.includes('pages-marked-gps-staging'));
  assert.ok(r.failed.includes('published-gtfs-same-edition'));
});
