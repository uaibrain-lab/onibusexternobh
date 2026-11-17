'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'static','app.js'),'utf8');
const page=fs.readFileSync(path.join(root,'static','index.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'static','sw.js'),'utf8');
const begin=app.indexOf('const normalizeDestination=');
const end=app.indexOf('async function selectLine(',begin);
assert.ok(begin>=0&&end>begin,'pure itinerary helpers are present');
const {normalizeDestination,itineraryLabel}=vm.runInNewContext(
  app.slice(begin,end)+'; ({normalizeDestination,itineraryLabel})'
);
const principal={id:'a',headsign:'UFMG / Santo Antônio',tripCount:300};
const retorno={id:'b',headsign:'Santo Antônio / UFMG',tripCount:280};
const variante={id:'c',headsign:'UFMG / Santo Antônio',tripCount:90};
const retornoAlternativo={id:'d',headsign:'Santo Antônio / UFMG',tripCount:40};
const all=[principal,retorno,variante,retornoAlternativo];

test('a referência é o percurso com maior oferta, sem inventar ida/volta',()=>{
  assert.match(itineraryLabel(principal,all,principal),/^Mais viagens/);
  assert.match(itineraryLabel(retorno,all,principal),/^Outro sentido/);
  assert.match(itineraryLabel(variante,all,principal),/^Rota alternativa/);
  assert.match(itineraryLabel(retornoAlternativo,all,principal),/rota alternativa/);
});
test('destinos equivalentes ignoram acentos e caixa',()=>{
  assert.equal(normalizeDestination('  SÃO FRANCISCO '),normalizeDestination('sao francisco'));
});
test('um clique a partir do ponto mantém sentido, parada e variante',()=>{
  assert.match(app,/patterns\.filter\(p=>p\.servesStop\)/);
  assert.match(app,/matching\.find\(p=>String\(p\.shapeId\)===confirmedShape\)/);
  assert.match(app,/destination:r\.destination\|\|arrival\?\.destination/);
  assert.match(page,/id="patternHint"/);
});
test('atualizações de chegada reutilizam botões e não recriam o painel',()=>{
  assert.match(app,/function updateArrivalButton\(/);
  assert.match(app,/new Map\(\[\.\.\.rows\.querySelectorAll/);
  assert.match(app,/if\(!b\)\{b=document\.createElement\('button'\)/);
  assert.match(app,/if\(area\.dataset\.stopId!==String\(data\.id\)/);
});
test('cache PWA é renovável e não guarda coordenadas ou tiles',()=>{
  assert.match(worker,/hub-externo-static-p11-r1/);
  assert.match(worker,/latestOrCached\(request,cacheKey\)/);
  assert.match(worker,/u(?:rl)?\.origin!==self\.location\.origin/);
  assert.match(worker,/pathname\.includes\('\/api\/'\)/);
  assert.doesNotMatch(worker,/cache\.addAll\(\[.*tile\.openstreetmap/);
});
