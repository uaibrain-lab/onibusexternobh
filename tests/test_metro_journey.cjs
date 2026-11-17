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
