'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),
fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const routes=JSON.parse(fs.readFileSync(path.join(ROOT,'catalog/routes.json'),'utf8'));
const worker=fs.readFileSync(path.join(ROOT,'static/route-worker.js'),'utf8');
const app=fs.readFileSync(path.join(ROOT,'static/app.js'),'utf8');
test('GTFS catalog is municipal-only and must not falsely include metropolitan 411C',()=>{
 assert.equal(routes.some(x=>String(x.code).toUpperCase()==='411C'),false);
 assert.ok(routes.some(x=>String(x.code)==='9209'));
 assert.ok(routes.some(x=>String(x.code)==='9106'));
 assert.ok(routes.some(x=>String(x.code)==='51'));
 assert.match(worker,/metropolitanBh:false/);
 assert.match(worker,/excludedExample:'411C'/);
});
test('UI explains that metropolitan itineraries are absent and cannot claim global fastest',()=>{
 assert.match(app,/data\.coverage\?\.metropolitanBh===false/);
 assert.match(app,/linha 411C/);
 assert.match(app,/resultados não representam necessariamente a opção mais rápida/i);
});
