/* P9: actual Chromium rendering with Android emulation and desktop viewport.
 * Not a claim of physical testing on a user's Android device.
 * Prerequisite: static preview built under dist/, Playwright Chromium installed.
 */
'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const BASE=process.env.PREVIEW_URL||'http://127.0.0.1:8765/externo/';
async function check(name,config){
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext(config);
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('#quick-pontos').waitFor({state:'visible',timeout:30000});
  for(const tab of ['pontos','linhas','metro','rotas']){
   const button=page.locator('#quick-'+tab);
   assert.ok(await button.isVisible(),name+': missing '+tab);
   await button.click();
   await page.locator('#'+tab+'Pane').waitFor({state:'visible'});
  }
  await page.locator('#quick-pontos').click();
  await page.locator('#stopInput').fill('Avenida');
  await page.locator('#stopSearchResult .row-item').first().waitFor({timeout:30000});
  await page.locator('#quick-linhas').click();
  await page.locator('#lineInput').fill('67');
  await page.locator('#goLine').click();
  await page.waitForFunction(()=>document.querySelector('#lineTitle')?.textContent
    ?.toLowerCase()!=='selecione uma linha',{timeout:30000});
  await page.locator('#vehicleList').getByText(
    'Posições GPS ao vivo ainda não disponíveis',{exact:false}).waitFor({timeout:30000});
  await page.locator('#quick-metro').click();
  await page.locator('#metroPane').waitFor({state:'visible'});
  await page.locator('#quick-rotas').click();
  await page.locator('#routeOriginInput').fill('-19.8695,-43.9675');
  await page.locator('#routeOriginSearch').click();
  await page.locator('#routeDestinationInput').fill('-19.918,-43.938');
  await page.locator('#routeDestinationSearch').click();
  await page.locator('#routeWhen').selectOption('departAt');
  await page.locator('#routeDate').fill('2026-11-18');
  await page.locator('#routeTime').fill('08:00');
  await page.locator('#routeSubmit').click();
  await page.locator('#routeResults .route-result').first().waitFor({timeout:150000});
  const count=await page.locator('#routeResults .route-result').count();
  assert.ok(count>0,'No itinerary rendered in Chromium');
  const routing=await page.evaluate(()=>({
    confidence:state.routeResults[0]?.confidence,
    walks:state.routeResults[0]?.legs?.filter(x=>x.mode==='walk')
       .map(x=>({pathVerified:x.pathVerified,hasGeometry:Array.isArray(x.geometry)}))
  }));
  const pedestrianManifestStatus=await page.evaluate(async()=>{
    const r=await fetch('./catalog/pedestrian/index.json');
    return {status:r.status,url:r.url}
  });
  const workerDetails=await Promise.all(page.workers().map(w=>
    w.evaluate(()=>({
      pedType:typeof self.__PedestrianNetwork,
      metroType:typeof self.__MetroJourney,
      hasPedestrian:typeof pedestrian!=='undefined'&&Boolean(pedestrian),
      pedKnown:typeof pedestrian!=='undefined'&&pedestrian?pedestrian.known:null,
      graphRoot:typeof pedestrian!=='undefined'&&pedestrian?pedestrian.root:null
    })).catch(e=>({error:e.message}))));
  console.log('P9_BROWSER_ROUTE_DIAGNOSTIC',JSON.stringify({
    name,routing,pedestrianManifestStatus,workerDetails}));
  if(await page.locator('#routeResults').count()){
    assert.ok(routing.confidence?.startsWith('GTFS_scheduled_'),
      'A complete OSM pedestrian graph must be used in the installed P9 build');
    assert.ok(routing.walks?.length>0&&routing.walks.every(w=>w.hasGeometry),
      'Each selected walk must be routed on a real OSM path');
  }
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+4);
  assert.equal(overflow,false,'Page has horizontal overflow');
  if(errors.length)throw Error(name+' page errors: '+errors.join('; '));
  console.log('P9_BROWSER_OK',JSON.stringify({name,itineraries:count,routing,
   viewport:config.viewport,hasHorizontalOverflow:false}));
  fs.mkdirSync('/tmp/p9-browser',{recursive:true});
  await page.screenshot({path:'/tmp/p9-browser/'+name+'.png',fullPage:false});
 }finally{await browser.close()}
}
(async()=>{
 await check('android-emulated',{
  viewport:{width:390,height:844},deviceScaleFactor:2,
  isMobile:true,hasTouch:true
 });
 await check('desktop',{viewport:{width:1365,height:840},deviceScaleFactor:1});
})().catch(e=>{console.error(e);process.exitCode=1});
