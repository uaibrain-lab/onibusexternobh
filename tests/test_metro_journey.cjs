/* Zero-paid metro timing: bounded estimates, NEVER invented departure times. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
 fs=require('node:fs'),vm=require('node:vm');
function system(){
 const sandbox={self:{},Date,Intl,Map,Math,Number,Set,console};
 vm.runInNewContext(fs.readFileSync('static/metro-journeys.js','utf8'),sandbox);
 const data=JSON.parse(fs.readFileSync('catalog/metro.json','utf8'));
 return {metro:sandbox.self.__MetroJourney,catalog:data,
   station:id=>data.stations.find(x=>x.id===id)};
}
test('line1 weekday frequency obeys operator, including maintenance exception',()=>{
 const {metro,catalog}=system();
 const line=catalog.lines.find(x=>x.id==='1');
 assert.equal(metro.lineState(catalog,line,Date.parse('2026-11-17T07:00:00-03:00')).headway,7.5);
 assert.equal(metro.lineState(catalog,line,Date.parse('2026-11-17T14:00:00-03:00')).headway,15);
 assert.equal(metro.lineState(catalog,line,Date.parse('2026-11-17T21:00:00-03:00')).headway,24);
 assert.equal(metro.lineState(catalog,line,Date.parse('2026-11-17T23:20:00-03:00')).open,false);
});
test('historical distance-scaled train duration remains an interval, never exact departure',()=>{
 const {metro,catalog,station}=system();
 const a=station('eldorado'),b=station('central');
 const hints=metro.suggest(catalog,[a.lat,a.lng],[b.lat,b.lng],
   Date.parse('2026-11-17T14:00:00-03:00'),'departAt');
 const h=hints.find(x=>x.line==='1'&&x.fromStationId==='eldorado'&&x.toStationId==='central');
 assert.ok(h,'Expected actual line 1 option');
 assert.equal(h.status,'estimated_range_not_timetable');
 assert.ok(h.waitRangeMinutes[1]>=15);
 assert.ok(Date.parse(h.timeWindow.latestArrival)>Date.parse(h.timeWindow.earliestArrival));
});
test('arriveBy provides conservative leaving window, not a train timetable',()=>{
 const {metro,catalog,station}=system();
 const a=station('eldorado'),b=station('central');
 const deadline=Date.parse('2026-11-17T14:30:00-03:00');
 const h=metro.suggest(catalog,[a.lat,a.lng],[b.lat,b.lng],deadline,'arriveBy')
  .find(x=>x.fromStationId==='eldorado'&&x.toStationId==='central');
 assert.ok(h);
 assert.ok(Date.parse(h.timeWindow.conservativeDeparture)<
           Date.parse(h.timeWindow.latestDeparture));
});
test('line2 has no fictitious wait time without a validated frequency',()=>{
 const {metro,catalog,station}=system();
 const a=station('nova-suica'),b=station('amazonas');
 const opts=metro.suggest(catalog,[a.lat,a.lng],[b.lat,b.lng],
   Date.parse('2026-11-17T12:00:00-03:00'));
 const h=opts.find(x=>x.line==='2');
 assert.ok(h,'Line2 in operation');
 assert.equal(h.waitRangeMinutes,null);
 assert.equal(h.timeWindow.latestArrival,null);
 assert.equal(h.estimatedRideMinutes,3);
});
test('closed line2 station not proposed during exceptional early close',()=>{
 const {metro,catalog,station}=system();
 const a=station('nova-suica'),b=station('amazonas');
 const h=metro.suggest(catalog,[a.lat,a.lng],[b.lat,b.lng],
   Date.parse('2026-11-17T22:15:00-03:00'));
 assert.ok(!h.some(x=>x.line==='2'));
});

test('late departure plus access walk never proposes a train after station closes',()=>{
 const {metro,catalog,station}=system();
 const a=station('eldorado'),b=station('central');
 const origin=[a.lat+0.008,a.lng];
 const options=metro.suggest(catalog,origin,[b.lat,b.lng],
   Date.parse('2026-11-17T22:58:00-03:00'),'departAt');
 assert.ok(!options.some(x=>x.line==='1'&&x.fromStationId==='eldorado'),
   'Reaching the station after 23:00 cannot produce a train proposal');
});
test('metro+bus combinations remain conditional, never scheduled rail departures',()=>{
 const {metro,catalog,station}=system();
 const central=station('central'),eldorado=station('eldorado');
 const bus={
  legs:[{mode:'bus',tripId:'scheduled-1',line:'123',
     fromCoords:[central.lat+0.0002,central.lng],
     toCoords:[central.lat+0.006,central.lng+0.002],
     departure:'2026-11-17T15:30:00Z',arrival:'2026-11-17T15:48:00Z'}]
 };
 const found=metro.multimodal(catalog,[eldorado.lat,eldorado.lng],
   [central.lat+0.006,central.lng+0.002],
   Date.parse('2026-11-17T11:30:00-03:00'),
   'departAt',[bus]);
 // Every returned option uses an existing exact GTFS bus trip and a
 // separate, clearly estimated metro interval. Empty is allowed if
 // a conservative transfer cannot be confirmed.
 assert.ok(found.every(x=>x.status==='conditional_bus_metro'));
 assert.ok(found.every(x=>x.busTripId==='scheduled-1'));
});
