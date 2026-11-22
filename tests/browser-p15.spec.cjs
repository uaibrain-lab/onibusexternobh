const {test,expect}=require('@playwright/test');
test('UI integrada, GPS opcional desligado e métricas reais de navegador',async({page},info)=>{
  const requests=[];
  const failures=[];
  page.on('requestfinished',async request=>{
    try{
      const sizes=await request.sizes();
      requests.push({url:request.url().split('?')[0],bodyBytes:sizes.responseBodySize,
        resourceType:request.resourceType()});
    }catch(_){}
  });
  page.on('pageerror',error=>failures.push(error.message));
  await page.goto('/externo/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#quick-pontos')).toBeVisible();
  const toggle=page.locator('#sheet-toggle');
  if(await toggle.isVisible())await toggle.click();
  await expect(page.locator('#nearbyStops .row-item').first()).toBeVisible({timeout:25000});
  for(const pane of ['pontos','linhas','metro']){
    await page.locator('#quick-'+pane).click();
    await expect(page.locator('#'+pane+'Pane')).toBeVisible();
  }
  await expect(page.locator('#quick-rotas')).toBeHidden();
  const result=await page.evaluate(()=>{
    const tabHeights=['pontos','linhas','metro','rotas']
      .map(key=>Math.round(document.querySelector('#quick-'+key).getBoundingClientRect().height));
    const entries=performance.getEntriesByType('resource');
    const n=performance.getEntriesByType('navigation')[0];
    return {
      viewportWidth:innerWidth,
      pageScrollWidth:document.documentElement.scrollWidth,
      tabHeights,
      initialResourceTransfers:entries.reduce((acc,r)=>acc+(r.transferSize||0),0),
      jsHeapBytes:performance.memory?.usedJSHeapSize??null,
      navigationDomReadyMs:Math.round(n?.domContentLoadedEventEnd||0),
      serviceWorkerEnabled:'serviceWorker' in navigator,
      userAgent:navigator.userAgent
    };
  });
  expect(result.pageScrollWidth).toBeLessThanOrEqual(result.viewportWidth+2);
  expect(result.tabHeights.every(v=>v>=44)).toBeTruthy();
  expect(failures).toEqual([]);
  const config=await page.evaluate(async()=>{
    const response=await fetch('./gps-config.json',{cache:'no-store'});
    return response.json();
  });
  expect(config.enabled).toBe(false);
  const stats={...result,requests:requests.length,
    requestsTransferredBytes:requests.reduce((s,r)=>s+r.bodyBytes,0),
    topResponses:requests.sort((a,b)=>b.bodyBytes-a.bodyBytes).slice(0,8),
    gpsPublicEnabled:config.enabled};
  await info.attach('mobile-and-transfer-metrics.json',{
    body:JSON.stringify(stats,null,2),contentType:'application/json'
  });
});
