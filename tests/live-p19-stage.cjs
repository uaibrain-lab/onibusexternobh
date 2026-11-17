'use strict';
/* P19 — real-browser QA on the isolated public Pages stage.
 * Intentional live requests: one line selection / one GPS fetch per browser.
 * Not part of default CI because it depends on public SUMOB availability.
 * Never touches the Hub, writes server data, or uploads passenger location.
 */
const {test,expect}=require('@playwright/test');
const SITE='https://externo-bh-hml-uaibrain.pages.dev/externo/';
const GPS_HOST='externo-bh-gps-free.hubufmg.workers.dev';

test('P19: homologação real — GPS da linha 5102, abas e viewport mobile',async({page},info)=>{
  const pageErrors=[],gpsRequests=[],responses=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  page.on('request',request=>{
    if(new URL(request.url()).hostname!==GPS_HOST)return;
    const url=new URL(request.url());
    if(url.pathname==='/api/gps')
      gpsRequests.push({
        method:request.method(),
        source:url.searchParams.get('source'),
        routes:url.searchParams.get('routes'),
        // Never store location or sensitive parameters.
        queryKeys:[...url.searchParams.keys()].sort()
      });
  });
  const navigation=await page.goto(SITE,{waitUntil:'domcontentloaded',timeout:45000});
  expect(navigation?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('data-gps-homologacao','true');
  await expect(page.locator('.gps-staging-label')).toBeVisible();
  await expect(page.locator('#quick-pontos')).toBeVisible();
  await expect(page.locator('#routeList option[value="5102"]')).toHaveCount(1,{timeout:35000});

  const config=await page.evaluate(async()=>{
    const result=await fetch('./gps-config.json',{cache:'no-store'});
    return result.json();
  });
  expect(config.enabled).toBe(true);
  expect(config.provider).toBe('gtfs_rt');

  await page.locator('#quick-linhas').click();
  await expect(page.locator('#linhasPane')).toBeVisible();
  await page.locator('#lineInput').fill('5102');
  const gpsResponsePromise=page.waitForResponse(response=>{
    const url=new URL(response.url());
    return url.hostname===GPS_HOST && url.pathname==='/api/gps'
      && url.searchParams.get('source')==='GTFS_RT'
      && url.searchParams.get('routes')==='5102';
  },{timeout:40000});
  await page.locator('#goLine').click();
  const gpsResponse=await gpsResponsePromise;
  let gps;
  try{gps=await gpsResponse.json()}catch(_){gps={available:false,error:'NON_JSON'}}
  const status=gpsResponse.status();
  responses.push({http:status,available:gps?.available===true,
    route:'5102',count:Array.isArray(gps.records)?gps.records.length:null,
    upstreamError:gps.error||null,reason:gps.reason||null});
  expect(status,'Worker deve responder 200 na homologação').toBe(200);
  expect(gps.available).toBe(true);
  expect(gps.source).toBe('GTFS_RT');
  expect(Array.isArray(gps.records)).toBe(true);
  // Zero observations is a valid temporary state: don't claim no buses.
  expect(gps.records.every(record=>String(record.routeId)==='5102')).toBe(true);
  expect(gps.records.every(record=>!('etaMinutes' in record))).toBe(true);
  await expect(page.locator('#lineTitle')).not.toHaveText('Selecione uma linha');
  await expect(page.locator('#vTotal')).not.toHaveText('—',{timeout:25000});
  await expect(page.locator('#lastPoll')).toContainText('SUMOB');

  const checks=[];
  for(const tab of ['pontos','linhas','metro','rotas']){
    await page.locator('#quick-'+tab).click();
    await expect(page.locator('#'+tab+'Pane')).toBeVisible();
    const sizes=await page.evaluate(()=>{
      const scrollWidth=document.documentElement.scrollWidth;
      const width=window.innerWidth;
      const controls=['pontos','linhas','metro','rotas'].map(id=>
        Math.round(document.querySelector('#quick-'+id).getBoundingClientRect().height)
      );
      return {width,scrollWidth,overflow:scrollWidth-width,controls};
    });
    checks.push({tab,...sizes});
    expect(sizes.overflow).toBeLessThanOrEqual(2);
    expect(sizes.controls.every(v=>v>=44)).toBe(true);
  }
  expect(gpsRequests.every(request=>
    request.method==='GET'&&request.source==='GTFS_RT'&&
    request.routes==='5102'&&request.queryKeys.join(',')==='routes,source'
  )).toBe(true);
  expect(gpsRequests.length).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  const report={stage:SITE,project:info.project.name,
    checkedAt:new Date().toISOString(),gps:responses,
    gpsQueryCount:gpsRequests.length,viewportChecks:checks,
    pageErrors,warning:'Browser emulado nao substitui teste em Android real'};
  await info.attach('p19-live-mobile-result.json',{
    body:JSON.stringify(report,null,2),contentType:'application/json'
  });
  await page.screenshot({path:info.outputPath('p19-live-mobile.png'),fullPage:true});
});
