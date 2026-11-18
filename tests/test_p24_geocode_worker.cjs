'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const api=import(pathToFileURL(path.resolve(__dirname,
  '../gps-worker/src/index.mjs')).href);
const ORIGIN='https://externo-bh-hml-uaibrain.pages.dev';
const ENDPOINT='https://externo-bh-gps-free.hubufmg.workers.dev/api/geocode';
const req=(q,origin=ORIGIN)=>new Request(ENDPOINT+'?q='+encodeURIComponent(q),
  {headers:{Origin:origin}});
const results={features:[
  {geometry:{coordinates:[-43.942,-19.923]},
   properties:{name:'Padaria Serra',street:'Rua Teste',housenumber:'112',
     city:'Belo Horizonte'}},
  {geometry:{coordinates:[-46.63,-23.55]},
   properties:{name:'São Paulo'}},
  {geometry:{coordinates:[-43.942,-19.923]},
   properties:{name:'Padaria Serra',street:'Rua Teste',housenumber:'112'}}
]};
test('Free Worker geocodes explicitly typed place; fixed upstream, no passenger GPS, exact CORS',async()=>{
  const {handleGpsRequest}=await api;
  const urls=[];
  const result=await handleGpsRequest(req('Padaria Serra'),{
    cache:null,fetchFn:async(url,opts)=>{
      urls.push(new URL(url));
      assert.equal(opts.redirect,'manual');
      return new Response(JSON.stringify(results),{
        headers:{'Content-Type':'application/json'}
      });
    }
  });
  assert.equal(result.status,200);
  assert.equal(result.headers.get('Access-Control-Allow-Origin'),ORIGIN);
  const body=await result.json();
  assert.equal(body.available,true);
  assert.equal(body.items.length,1);
  assert.equal(body.items[0].label,'Padaria Serra · Rua Teste · 112 · Belo Horizonte');
  assert.equal(urls.length,1);
  assert.equal(urls[0].origin,'https://photon.komoot.io');
  assert.equal(urls[0].searchParams.get('q'),'Padaria Serra');
  assert.equal(urls[0].searchParams.get('lat'),'-19.9208');
  assert.equal(urls[0].searchParams.get('lon'),'-43.9378');
  assert.equal(urls[0].searchParams.get('bbox'),'-44.4,-20.45,-43.5,-19.5');
  assert.equal(urls[0].searchParams.has('userLocation'),false);
});
test('Reject arbitrary origin, originless geocode, extra fields and oversized query',async()=>{
  const {handleGpsRequest}=await api;
  let upstream=0;
  const fetchFn=async()=>{upstream++;throw Error('must not call upstream')};
  const wrong=await handleGpsRequest(req('Rua Teste','https://evil.example'),
    {cache:null,fetchFn});
  assert.equal(wrong.status,403);
  const noOrigin=new Request(ENDPOINT+'?q=Padaria');
  assert.equal((await handleGpsRequest(noOrigin,{cache:null,fetchFn})).status,403);
  assert.equal((await handleGpsRequest(new Request(ENDPOINT+'?q=Padaria&url=evil',{
    headers:{Origin:ORIGIN}
  }),{cache:null,fetchFn})).status,400);
  assert.equal((await handleGpsRequest(req('https://example.com/attack'),{
    cache:null,fetchFn
  })).status,400);
  assert.equal((await handleGpsRequest(req('a'.repeat(200)),{
    cache:null,fetchFn
  })).status,400);
  assert.equal(upstream,0);
});
test('Photon rate limit surfaces 429; network outage is explicit, never an empty success',async()=>{
  const {handleGpsRequest}=await api;
  const limited=await handleGpsRequest(req('Rua Teste'),{
    cache:null,fetchFn:async()=>new Response('',{status:429})
  });
  assert.equal(limited.status,429);
  assert.equal((await limited.json()).error,'GEOCODE_RATE_LIMITED');
  const down=await handleGpsRequest(req('Rua Teste'),{
    cache:null,fetchFn:async()=>{throw new TypeError('secret upstream')}
  });
  assert.equal(down.status,503);
  const body=await down.json();
  assert.equal(body.error,'GEOCODE_UPSTREAM_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(body),/secret upstream/);
});
test('Repeated query is served from free edge cache without contacting Photon twice',async()=>{
  const {handleGpsRequest}=await api;
  const table=new Map();let calls=0;
  const cache={
    async match(key){return table.get(key.url)?.clone()||null},
    async put(key,response){table.set(key.url,response.clone())}
  };
  const opts={cache,fetchFn:async()=>{calls++;
    return new Response(JSON.stringify(results),{status:200});
  }};
  const first=await handleGpsRequest(req('Rua Teste'),opts);
  const second=await handleGpsRequest(req('Rua Teste'),opts);
  assert.equal(first.status,200);assert.equal(second.status,200);
  assert.equal(calls,1);
});
