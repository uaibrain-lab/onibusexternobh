'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const file=p=>fs.readFileSync(path.join(base,p),'utf8');
const page=file('static/index.html'),app=file('static/app.js'),bus=file('static/static-bus.js');
const arrivals=file('static/static-arrivals.js'),sw=file('static/service-worker.js');
const build=file('scripts/build_static_site.py');

test('quatro abas coexistem com o rastreador na mesma interface',()=>{
  for(const tab of ['pontos','linhas','metro','rotas']){
    assert.match(page,new RegExp('id="quick-'+tab+'"'));
    assert.match(page,new RegExp('id="'+tab+'Pane"'));
  }
  assert.match(app,/function updateArrivalButton/);
  assert.match(app,/function focusVehicle/);
  assert.match(app,/function centerStopInAvailableMap/);
  assert.match(app,/function loadMetro/);
  assert.match(app,/new Worker/);
  assert.match(app,/itineraryLabel/);
});
test('horários no celular vêm de GTFS real sem afirmar GPS',()=>{
  assert.match(bus,/StaticArrivals\.lookup/);
  assert.match(bus,/servesStop/);
  assert.match(arrivals,/America\/Sao_Paulo/);
  assert.match(arrivals,/lastTripToday/);
  assert.match(arrivals,/validThrough/);
  assert.match(arrivals,/byDirection/);
  assert.match(app,/GTFS · horários programados, GPS indisponível/);
});
test('build contém o mesmo app, PWA e catálogos de horários sob demanda',()=>{
  for(const p of ['static-arrivals.js','static-bus.js','route-worker.js',
                  'metro-timing.js','hub-parity.css','manifest.webmanifest']){
    assert.ok(build.includes(p),p);
  }
  assert.ok(sw.includes('boundedCache(request,ARRIVALS,16)'));
  assert.ok(sw.includes('catalog\\/arrivals\\/'));
  assert.match(sw,/ARRIVALS/);
  assert.doesNotMatch(sw,/precacheAllHourlyShards/);
});
test('segurança de integração com Hub apenas no mesmo domínio',()=>{
  assert.match(page,/href="\.\/hub-parity\.css"/);
  assert.match(page,/dataset\.embedded/);
  assert.doesNotMatch(page,/id="bandeco-navigation"/);
  assert.doesNotMatch(app,/firebase\.functions/);
});

test('V1 municipal oculta planejador e RMBH sem apagar implementação futura',()=>{
  assert.match(page,/id="quick-rotas"[^>]*hidden[^>]*disabled/);
  assert.match(page,/<section id="rotasPane" hidden inert/);
  assert.doesNotMatch(page,/href="\.\/metropolitan\.html"/);
  assert.match(app,/if\(tab==='rotas'\)tab='pontos'/);
  assert.match(app,/function submitRoute/); // código preservado para V2
  assert.match(page,/horários GTFS programados/);
});
