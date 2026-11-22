const {test,expect}=require('@playwright/test');
/* P21 local browser regression: no external dependency or Photon quota.
 * Serve dist/externo/ on localhost:8765. GPS remains OFF in default build.
 */
test('Abrir 5102 mostra só paradas da linha e sair restaura mapa anterior',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://tile.openstreetmap.org/**',r=>r.abort('failed'));
  await page.goto('/externo/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#map')).toHaveAttribute('data-render-status','ready',{timeout:20000});
  await expect(page.locator('#routeList option[value="5102"]')).toHaveCount(1,{timeout:35000});
  const previous=await page.evaluate(()=>({center:[...state.center],zoom:state.zoom}));
  await page.locator('#quick-linhas').click();
  await page.locator('#lineInput').fill('5102');
  await page.locator('#goLine').click();
  await expect(page.locator('#lineExit')).toBeVisible({timeout:25000});
  await expect(page.locator('#lineStopChooser')).toBeVisible({timeout:25000});
  const result=await page.evaluate(()=>{
    const allowed=new Set(state.geometry?.selected?.stops?.map(s=>String(s.id))||[]);
    return {selected:state.route?.code||null,
      drawn:state.stopMarkers.map(s=>String(s.stop.id)),
      allowed:[...allowed],sourceTab:activeTab,
      canChoose:document.querySelector('#lineStopSelect').options.length};
  });
  expect(result.selected).toBe('5102');
  expect(result.sourceTab).toBe('linhas');
  expect(result.allowed.length).toBeGreaterThan(2);
  expect(result.drawn.every(id=>result.allowed.includes(id))).toBe(true);
  expect(result.canChoose).toBeGreaterThan(2);

  const options=await page.locator('#lineStopSelect option').all();
  await page.locator('#lineStopSelect').selectOption(await options[1].getAttribute('value'));
  await expect(page.locator('#lineStopForecast')).not.toContainText('Consultando horários programados',{timeout:25000});
  await page.locator('#lineExit').click();
  const after=await page.evaluate(()=>({selected:state.route,
    center:[...state.center],zoom:state.zoom,tab:activeTab}));
  expect(after.selected).toBeNull();
  expect(after.tab).toBe('linhas');
  expect(after.center[0]).toBeCloseTo(previous.center[0],5);
  expect(after.center[1]).toBeCloseTo(previous.center[1],5);
  expect(after.zoom).toBeCloseTo(previous.zoom,4);
  expect(errors).toEqual([]);
});
test.skip('Pesquisa explícita de padaria abre local Photon sem autocomplete',async({page})=>{
  const calls=[],routingDownloads=[];
  page.on('request',request=>{
    if(request.url().includes('/catalog/scan/index.json')||
       request.url().includes('/catalog/scan/trips.json.gz'))
      routingDownloads.push(request.url());
  });
  await page.route('https://photon.komoot.io/api/**',async route=>{
    const url=new URL(route.request().url());
    calls.push(Object.fromEntries(url.searchParams));
    return route.fulfill({status:200,contentType:'application/json',
      headers:{'Access-Control-Allow-Origin':'*'},
      body:JSON.stringify({features:[{
        type:'Feature',
        geometry:{type:'Point',coordinates:[-43.938,-19.921]},
        properties:{name:'Padaria Santa Marta',street:'Rua Santa Marta',
          housenumber:'567',city:'Belo Horizonte'}
      }]})});
  });
  await page.goto('/externo/',{waitUntil:'domcontentloaded'});
  await page.locator('#quick-rotas').click();
  await page.locator('#routeOriginInput').fill('Padaria Santa Marta');
  expect(calls.length).toBe(0); // no autocomplete or user coordinate upload
  await page.locator('#routeOriginSearch').click();
  await expect(page.locator('#routeOriginResults .row-item').first())
    .toContainText('Padaria Santa Marta',{timeout:30000});
  expect(calls.length).toBe(1);
  expect(calls[0].q).toBe('Padaria Santa Marta');
  expect(calls[0].lat).toBe('-19.9208');
  expect(routingDownloads).toHaveLength(0); // no heavy GTFS scan merely for address
  await page.locator('#routeOriginResults .row-item').first().click();
  const loc=await page.evaluate(()=>state.routeOrigin);
  expect(loc.lat).toBeCloseTo(-19.921,4);
  expect(loc.lng).toBeCloseTo(-43.938,4);
});
