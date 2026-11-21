'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const os=require('node:os'),zlib=require('node:zlib');
const {options,publicStopCoordinates}=require('../scripts/diagnose_route.cjs');
const base=['--from=-19.9000,-43.9300','--to=-19.8700,-43.9600',
 '--at=2026-11-17T19:58:00-03:00'];
test('offline diagnostics accepts BH coordinates and focus combinations',()=>{
 const p=options([...base,'--depth=expanded','--preference=balanced',
   '--focus=9209+5106,9106+5106,9106+51']);
 assert.equal(p.origin.lat,-19.9);
 assert.equal(p.destination.lng,-43.96);
 assert.equal(p.searchDepth,'expanded');
 assert.equal(p.preference,'balanced');
 assert.deepEqual(p.focusCombinations,['9209+5106','9106+5106','9106+51']);
 assert.equal(p.diagnostics,true);
});
test('explicit timezone and bounded BH origin/destination are mandatory',()=>{
 assert.throws(()=>options(base.filter(x=>!x.startsWith('--at='))),/--at=/);
 assert.throws(()=>options([...base.slice(1),'--from=-23.5,-46.6']),/região BH/);
 assert.throws(()=>options([...base,'--mode=invalid']),/inválidos/);
});
test('rejects normalized impossible service dates and ambiguous CLI switches',()=>{
 for(const invalid of ['--at=2026-02-30T19:58:00-03:00',
   '--at=2026-11-31T19:58:00-03:00','--at=2026-11-17T19:58:00+00:00']){
   assert.throws(()=>options([...base.filter(x=>!x.startsWith('--at=')),invalid]),
     /inválido|--at=/);
 }
 assert.throws(()=>options([...base,'--from=-19.8,-43.8']),/duplicado/);
 assert.throws(()=>options([...base,'--unknown=anything']),/incorreto/);
 assert.throws(()=>options([...base,'--focus=9106+5106,9106+5106']),/duplicadas/);
 assert.throws(()=>options([...base,'--focus=9106+51;bad']),/inválidas/);
 assert.throws(()=>options([...base,'--focus='+Array(13).fill('9106+5106').join(',')]),/inválidas/);
 assert.deepEqual(options([...base,'--focus=9106+5106,9209+51']).focusCombinations,
   ['9106+5106','9209+51']);
});

test('diagnosis never connects to a public API or sends passenger GPS externally',()=>{
 const script=fs.readFileSync(path.join(__dirname,'../scripts/diagnose_route.cjs'),'utf8');
 assert.match(script,/local-only\.invalid/);
 assert.match(script,/REDE EXTERNA BLOQUEADA/);
 assert.doesNotMatch(script,/https:\/\/(api\.moovit|routes\.googleapis|photon\.komoot)/);
 assert.match(script,/focusCombinations/);
});

test('official public GTFS stop IDs resolve locally without network or passenger GPS',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'externo-public-stops-'));
 try{
   fs.mkdirSync(path.join(root,'scan'));
   const rows=[['a','Parada A',-19.9,-43.93],['b','Parada B',-19.87,-43.96]];
   fs.writeFileSync(path.join(root,'scan/stops.json.gz'),
     zlib.gzipSync(Buffer.from(JSON.stringify(rows))));
   const found=publicStopCoordinates(['a','b'],root);
   const parsed=options(['--fromstop=a','--tostop=b','--at=2026-11-17T19:58:00-03:00'],root);
   assert.deepEqual(parsed.origin,{lat:-19.9,lng:-43.93});
   assert.deepEqual(parsed.destination,{lat:-19.87,lng:-43.96});
   assert.throws(()=>options(['--fromstop=a',...base],root),/coordenadas OU stop_id/);
   assert.throws(()=>options(['--fromstop=missing','--tostop=b','--at=2026-11-17T19:58:00-03:00'],root),/ausente/);
   assert.deepEqual(found.get('a'),{lat:-19.9,lng:-43.93});
   assert.deepEqual(found.get('b'),{lat:-19.87,lng:-43.96});
   assert.throws(()=>publicStopCoordinates(['missing'],root),/ausente/);
   assert.throws(()=>publicStopCoordinates(['../bad'],root),/inválido/);
   fs.writeFileSync(path.join(root,'scan/stops.json.gz'),
     zlib.gzipSync(Buffer.from(JSON.stringify([...rows,['a','Conflito',-19.8,-43.93]]))));
   assert.throws(()=>publicStopCoordinates(['a'],root),/conflitantes/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
