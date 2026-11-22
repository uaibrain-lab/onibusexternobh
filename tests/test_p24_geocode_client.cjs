'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const geocoderSource=fs.readFileSync(path.resolve(__dirname,
  '../static/place-geocoding.js'),'utf8');
function geocoder(origin){
  const context=vm.createContext({URL,AbortSignal,Date,Map,Set,Number,
    String,Array,Math,Promise,Error,location:{origin},fetch:()=>{}});
  vm.runInContext(geocoderSource,context);
  return vm.runInContext('GeoPlaces',context);
}
const feature={geometry:{coordinates:[-43.94,-19.92]},properties:{
  name:'Padaria BH',street:'Rua Teste',city:'Belo Horizonte'
}};
test('Pages sends user-clicked text to bounded Free relay, not personal coordinates',async()=>{
  const instance=geocoder('https://externo-bh-hml-uaibrain.pages.dev'),calls=[];
  const items=await instance.search('Padaria BH',{now:5000,fetchFn:async(url)=>{
    calls.push(new URL(url));
    return {ok:true,status:200,json:async()=>({available:true,items:[{
      lat:-19.92,lng:-43.94,label:'Padaria BH',source:'Photon / OpenStreetMap'
    }]})};
  }});
  assert.equal(items.length,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].pathname,'/api/geocode');
  assert.equal(calls[0].searchParams.get('q'),'Padaria BH');
  assert.equal(calls[0].searchParams.has('lat'),false);
  assert.equal(calls[0].searchParams.has('lon'),false);
});
test('Worker 429 does not bypass Photon throttling by opening direct URL',async()=>{
  const instance=geocoder('https://externo-bh-hml-uaibrain.pages.dev');
  const calls=[];
  await assert.rejects(()=>instance.search('Rua Teste',{now:5000,
    fetchFn:async url=>{
      calls.push(url);
      return {ok:false,status:429,json:async()=>({error:'GEOCODE_RATE_LIMITED'})};
    }}),/limitada/);
  assert.equal(calls.length,1);
});
test('Worker not yet deployed (404) gracefully falls back to direct Photon',async()=>{
  const instance=geocoder('https://externo-bh-hml-uaibrain.pages.dev');
  const calls=[];
  const items=await instance.search('Rua Teste',{now:5000,fetchFn:async url=>{
    calls.push(url);
    if(calls.length===1)return {ok:false,status:404};
    return {ok:true,status:200,json:async()=>({features:[feature]})};
  }});
  assert.equal(calls.length,2);
  assert.equal(new URL(calls[1]).hostname,'photon.komoot.io');
  assert.equal(items.length,1);
});
test('Unsupported hosts use direct provider, not a Worker that would reject their origin',async()=>{
  const instance=geocoder('http://localhost:8765');
  let url='';
  const items=await instance.search('Rua Teste',{now:5000,fetchFn:async u=>{
    url=u;return {ok:true,status:200,json:async()=>({features:[feature]})};
  }});
  assert.equal(new URL(url).hostname,'photon.komoot.io');
  assert.equal(items.length,1);
});
