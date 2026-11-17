/* Rail windows are advisory and must NEVER assert train departures. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),vm=require('node:vm');
const cat=JSON.parse(fs.readFileSync('catalog/metro.json','utf8'));
const ctx=vm.createContext({Intl,Date,Number,Math,String,Map,Array});
vm.runInContext(fs.readFileSync('static/metro-timing.js','utf8'),ctx);
const rail=vm.runInContext('RailWindows',ctx);
const station=id=>cat.stations.find(s=>s.id===id);
const line=id=>cat.lines.find(l=>l.id===id);
test('line 1 uses historically published reference times, not made-up trip_ids',()=>{
  const south=rail.rideMinutes(line('1'),cat,station('eldorado'),station('central'));
  const north=rail.rideMinutes(line('1'),cat,station('central'),station('vilarinho'));
  assert.ok(Math.abs(south-18.9)<0.01,south);
  assert.ok(Math.abs(north-25.5)<0.01,north);
});
test('temporary 24-minute headway gets applied on the announced dates',()=>{
  const at='2026-11-17T20:30:00-03:00';
  const hw=rail.headway(cat,line('1'),at);
  assert.equal(hw,24);
  const result=rail.window(cat,line('1'),station('central'),station('santa-efigenia'),at);
  assert.ok(result);
  assert.equal(result.headwayMinutes,24);
  assert.ok(result.travelWindowMinutes[1]>result.travelWindowMinutes[0]);
  assert.ok(result.confidence.includes('NOT A TRAIN SCHEDULE'));
});
test('line 2 and Novo Eldorado have no verified complete rail running time',()=>{
  assert.equal(rail.window(cat,line('2'),station('nova-suica'),station('amazonas'),
    '2026-11-17T08:00:00-03:00'),null);
  assert.equal(rail.rideMinutes(line('1'),cat,station('novo-eldorado'),station('central')),null);
});
test('arrival-by outputs advisory latest departure window, not exact arrival',()=>{
  const at='2026-11-17T09:30:00-03:00';
  const range=rail.window(cat,line('1'),station('vilarinho'),station('central'),at,
    'arriveBy',500,200);
  assert.ok(range);
  assert.ok(Date.parse(range.firstPossibleAt)<Date.parse(range.lastPossibleAt));
  assert.ok(Date.parse(range.lastPossibleAt)<Date.parse(at));
});
