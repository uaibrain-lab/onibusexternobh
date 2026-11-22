'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const alerts=import('../gps-worker/src/service-alerts.mjs');
const worker=import('../gps-worker/src/index.mjs');
const NOW=1795120000;
function v(num){let n=BigInt(num),out=[];
  while(n>127n){out.push(Number((n&127n)|128n));n>>=7n;}
  out.push(Number(n));return out;}
function f(n,x){return [...v(n*8+2),...v(x.length),...x]}
function u(n,x){return [...v(n*8),...v(x)]}
function s(n,x){return f(n,[...Buffer.from(x)])}
function tr(text,lang='pt-BR'){return f(1,[...s(1,text),...s(2,lang)])}
function wire({route='5102',stop='14791950',time=NOW,from=NOW-3600,
  until=NOW+3600, header='Desvio de rota',bad=false,includeStop=true,
  includeRoute=true,deleted=false}={}){
  const sel=[...(includeRoute?s(2,route):[]),...(includeStop?s(5,stop):[])];
  const a=[...f(1,[...u(1,from),...u(2,until)]),
    ...f(5,sel),...u(6,3),...u(7,2),
    ...f(10,tr(header)),...f(11,tr('Ponto temporariamente transferido.'))];
  const entity=[...s(1,'alert-a'),...(deleted?u(2,1):[]),...f(5,a)];
  const head=[...s(1,'2.0'),...u(3,bad?NOW-700:time)];
  return Uint8Array.from([...f(1,head),...f(2,entity)]);
}
test('alerta oficial ativo de parada e rota, texto PT e evento com escopo',async()=>{
  const {parseServiceAlerts}=await alerts;
  const out=parseServiceAlerts(wire(),{routes:['5102'],stopId:'14791950',nowSeconds:NOW});
  assert.equal(out.alerts.length,1);
  assert.equal(out.alerts[0].title,'Desvio de rota');
  assert.equal(out.alerts[0].description,'Ponto temporariamente transferido.');
  assert.deepEqual(out.alerts[0].matchedRoutes,['5102']);
  assert.deepEqual(out.alerts[0].matchedStops,['14791950']);
});
test('alertas vencidos, não pertinentes, deletados ou antigos não aparecem',async()=>{
  const {parseServiceAlerts}=await alerts;
  const opts={routes:['5102'],stopId:'14791950',nowSeconds:NOW};
  for(const data of [
    wire({until:NOW-1}),wire({from:NOW+2}),
    wire({route:'9999',stop:'00000000'}),
    wire({deleted:true})])
    assert.equal(parseServiceAlerts(data,opts).alerts.length,0);
  assert.throws(()=>parseServiceAlerts(wire({bad:true}),opts),/INVALID/);
});
test('worker limita a origem e entrega alertas oficiais sem intermediários pagos',async()=>{
  const {handleGpsRequest}=await worker;
  const req=new Request('https://externo-bh-gps-free.hubufmg.workers.dev/api/alerts?stop=14791950&routes=5102',
    {headers:{Origin:'https://hubufmg--homologacao-exbdd4qe.web.app'}});
  let count=0;
  const out=await handleGpsRequest(req,{
    now:NOW*1000,cache:null,fetchFn:async url=>{
      count++;
      assert.match(url,/\/alerts\?accesskey=/);
      return new Response(wire(),{status:200});
    }
  });
  assert.equal(out.status,200);
  const j=await out.json();
  assert.equal(j.available,true);assert.equal(j.source,'SUMOB_GTFS_RT_ALERTS');
  assert.equal(j.items.length,1);assert.equal(count,1);
});
test('worker rejeita query arbitrária e mantém indisponibilidade explícita',async()=>{
  const {handleGpsRequest}=await worker;
  const origin='https://hubufmg.web.app';
  const target=q=>new Request('https://externo-bh-gps-free.hubufmg.workers.dev/api/alerts'+q,
    {headers:{Origin:origin}});
  let calls=0;
  const options={now:NOW*1000,cache:null,fetchFn:async()=>{calls++;throw Error('no')}};
  for(const q of ['','?routes=5102&url=https://evil.example','?stop=abc',
    '?routes=5102,5102','?routes=../../etc/passwd'])
    assert.equal((await handleGpsRequest(target(q),options)).status,400);
  assert.equal(calls,0);
  const blocked=new Request('https://externo-bh-gps-free.hubufmg.workers.dev/api/alerts?routes=5102',
    {headers:{Origin:'https://evil.example'}});
  assert.equal((await handleGpsRequest(blocked,options)).status,403);
  const failed=await handleGpsRequest(target('?routes=5102'),{
    ...options,fetchFn:async()=>new Response('forbidden',{status:403})
  });
  assert.equal(failed.status,503);
  const json=await failed.json();
  assert.equal(json.reason,'UPSTREAM_HTTP');
  assert.ok(!JSON.stringify(json).includes('forbidden'));
});
