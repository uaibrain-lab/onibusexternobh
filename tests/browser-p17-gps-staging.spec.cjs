const {test,expect}=require('@playwright/test');

// Run only against a local GPS staging build:
//   python scripts/build_static_site.py --gps-staging
//   python -m http.server 8765 --directory dist
//   npx playwright test tests/browser-p17-gps-staging.spec.cjs --config=tests/playwright.config.cjs
// GPS response is intercepted: E2E must not spend Worker quota or require PBH.
test('P17 staging: SUMOB GPS position on bus tab, safe fallback and mobile viewport',async({page})=>{
  const jsErrors=[],gpsRequests=[];
  page.on('pageerror',e=>jsErrors.push(e.message));
  await page.route('https://externo-bh-gps-free.hubufmg.workers.dev/api/gps?*',async route=>{
    const req=new URL(route.request().url());
    gpsRequests.push(req.href);
    if(req.searchParams.get('source')!=='GTFS_RT'||
       req.searchParams.get('routes')!=='5102'){
      return route.fulfill({status:400,contentType:'application/json',
        headers:{'Access-Control-Allow-Origin':'*'},
        body:JSON.stringify({available:false,error:'BAD_TEST_REQUEST'})});
    }
    return route.fulfill({status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'},
      body:JSON.stringify({available:true,source:'GTFS_RT',
        fetchedAt:new Date().toISOString(),
        records:[{
          routeId:'5102',vehicleId:'STAGING-GPS-1',tripId:'STAGING-TRIP',
          lastGpsFixAt:new Date(Date.now()-35_000).toISOString(),
          latitude:-19.8695,longitude:-43.9675,heading:125
        }]})});
  });
  await page.goto('/externo/',{waitUntil:'domcontentloaded'});
  const stage=await page.locator('html').getAttribute('data-gps-homologacao');
  test.skip(stage!=='true','This spec requires explicit --gps-staging build');
  await expect(page.locator('html')).toHaveAttribute('data-app-mode','free-static');
  await expect(page.locator('.sheet-identity')).toContainText('GPS EM TESTE');
  const config=await page.evaluate(async()=>{
    const response=await fetch('./gps-config.json',{cache:'no-store'});
    return response.json();
  });
  expect(config.enabled).toBe(true);
  expect(config.provider).toBe('gtfs_rt');
  await page.locator('#quick-linhas').click();
  await page.locator('#lineInput').fill('5102');
  await page.locator('#goLine').click();
  await expect(page.locator('#vehicleList .vehicle')).toHaveCount(1,{timeout:30000});
  await expect(page.locator('#lastPoll')).toContainText('SUMOB');
  await expect(page.locator('#vTotal')).toHaveText('1');
  expect(gpsRequests.length).toBeGreaterThan(0);
  expect(gpsRequests.every(x=>x.includes('routes=5102'))).toBeTruthy();
  const pageMetrics=await page.evaluate(()=>({
    viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,
    title:document.title,hasGeo:'geolocation' in navigator
  }));
  expect(pageMetrics.overflow).toBeLessThanOrEqual(2);
  expect(jsErrors).toEqual([]);
});
