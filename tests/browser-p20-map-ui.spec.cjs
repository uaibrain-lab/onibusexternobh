const {test,expect}=require('@playwright/test');
/* P20: regression test for a previously frozen initial map and overlapping
 * sheet tabs. Use LOCAL static build; no paid API or production writes.
 * OSM tiles are deliberately blocked to test resilient fallback.
 */
test('Mapa inicial sai de Carregando mapa mesmo sem tiles OSM',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://tile.openstreetmap.org/**',route=>route.abort('failed'));
  await page.goto('/externo/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#mapCanvas')).toBeVisible();
  await expect(page.locator('#map')).toHaveAttribute('data-render-status','ready',{timeout:15000});
  await expect(page.locator('#mapToast')).not.toHaveText(/Carregando mapa/i,{timeout:15000});
  await expect(page.locator('#mapToast')).toContainText(/ponto|rota|linha|metrô/i);
  await expect(page.locator('#mapBasemapNotice')).toBeVisible({timeout:15000});
  const sizes=await page.evaluate(()=>{
    const canvas=document.querySelector('#mapCanvas');
    return {width:canvas.clientWidth,height:canvas.clientHeight};
  });
  expect(sizes.width).toBeGreaterThan(250);
  expect(sizes.height).toBeGreaterThan(300);
  expect(errors).toEqual([]);
});
test('Três abas V1, botões e avisos não se sobrepõem',async({page},info)=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://tile.openstreetmap.org/**',route=>route.abort('failed'));
  await page.goto('/externo/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#map')).toHaveAttribute('data-render-status','ready',{timeout:15000});
  await expect(page.locator('#mapToast')).not.toHaveText(/Carregando mapa/i,{timeout:15000});
  await expect(page.locator('#quick-rotas')).toBeHidden();
  const measures=[];
  for(const tab of ['pontos','linhas','metro']){
    await page.locator('#quick-'+tab).click();
    await expect(page.locator('#'+tab+'Pane')).toBeVisible();
    const data=await page.evaluate(()=>{
      const rect=el=>{
        const r=el.getBoundingClientRect();
        return {x:r.x,y:r.y,left:r.left,right:r.right,top:r.top,bottom:r.bottom,
          width:r.width,height:r.height};
      };
      const ids=['pontos','linhas','metro'];
      const sheet=rect(document.getElementById('sheet'));
      const tabs=ids.map(id=>rect(document.getElementById('quick-'+id)));
      const toast=rect(document.getElementById('mapToast'));
      const controls=rect(document.querySelector('.map-controls'));
      const pill=rect(document.querySelector('.source-pill'));
      const locate=rect(document.querySelector('#top .fab'));
      const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
        Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      return {
        width:innerWidth,documentWidth:document.documentElement.scrollWidth,
        sheet,tabs,
        adjacentOverlap:tabs.slice(1).map((t,i)=>overlap(t,tabs[i])),
        minTabHeight:Math.min(...tabs.map(t=>t.height)),
        tabOverflow:tabs.some(t=>t.left<sheet.left-1||t.right>sheet.right+1),
        toastControlsOverlap:overlap(toast,controls),
        topControlsOverlap:overlap(pill,locate)
      };
    });
    measures.push({tab,...data});
    expect(data.documentWidth).toBeLessThanOrEqual(data.width+2);
    expect(data.minTabHeight).toBeGreaterThanOrEqual(44);
    expect(data.tabOverflow).toBe(false);
    expect(data.adjacentOverlap.every(a=>a<1)).toBe(true);
    expect(data.toastControlsOverlap).toBeLessThan(4);
    expect(data.topControlsOverlap).toBeLessThan(4);
  }
  expect(errors).toEqual([]);
  await info.attach('p20-layout-geometry.json',{
    body:JSON.stringify(measures,null,2),contentType:'application/json'
  });
});
