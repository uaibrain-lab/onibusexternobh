const {test,expect}=require('@playwright/test');
test.beforeEach(async({page})=>{
  await page.goto('/externo/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#quick-rotas')).toBeHidden();
  const toggle=page.locator('#sheet-toggle');
  if(await toggle.isVisible())await toggle.click();
  else await page.locator('#sheet').evaluate(el=>{el.classList.remove('peek');el.classList.add('full')});
});
test('navegação V1 por Pontos, Linhas e Metrô',async({page},info)=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.locator('#quick-pontos').click();
  await expect(page.locator('#quick-pontos')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#nearbyStops .row-item').first()).toBeVisible();
  await page.locator('#quick-linhas').click();
  await expect(page.locator('#allLineList .row-item').first()).toBeVisible();
  await page.locator('#lineInput').fill('67');
  await page.locator('#goLine').click();
  // GPS may be enabled on staging or unavailable; never fabricate a fleet.
  await expect(page.locator('#vehicleList')).not.toContainText('Carregando ônibus…', {timeout:20000});
  await expect(page.locator('#vehicleList')).toContainText(/GPS|ônibus|Ônibus|posição|Posição/);
  await page.locator('#quick-metro').click();
  await expect(page.locator('#metroStations .row-item').first()).toBeVisible();
  await expect(page.locator('#quick-rotas')).toBeDisabled();
  const horizontal=await page.evaluate(()=>({
    width:window.innerWidth,documentWidth:document.documentElement.scrollWidth}));
  expect(horizontal.documentWidth).toBeLessThanOrEqual(horizontal.width+2);
  await page.screenshot({path:info.outputPath('p9-4-abas.png'),fullPage:true});
  expect(errors).toEqual([]);
});
test.skip('calcula trajeto real GTFS sem backend, e responde a mudança de data',async({page},info)=>{
  await page.locator('#quick-rotas').click();
  await page.locator('#routeOriginInput').fill('-19.8695,-43.9675');
  await page.locator('#routeOriginSearch').click();
  await page.locator('#routeDestinationInput').fill('-19.918,-43.938');
  await page.locator('#routeDestinationSearch').click();
  await page.locator('#routeWhen').selectOption('departAt');
  await page.locator('#routeDate').fill('2026-11-18');
  await page.locator('#routeTime').fill('08:00');
  await page.locator('#routeSubmit').click();
  await expect(page.locator('#routeResults .route-result').first()).toBeVisible({timeout:85000});
  await expect(page.locator('#routePlanStatus')).not.toContainText('Falha');
  await page.screenshot({path:info.outputPath('p9-trajetos.png'),fullPage:true});
  await page.locator('#routeTime').fill('10:00');
  await expect(page.locator('#routeResults .route-result')).toHaveCount(0);
  await expect(page.locator('#routeSubmit')).toBeEnabled();
});
