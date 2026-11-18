'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {options}=require('../scripts/diagnose_route.cjs');
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
test('diagnosis never connects to a public API or sends passenger GPS externally',()=>{
 const script=fs.readFileSync(path.join(__dirname,'../scripts/diagnose_route.cjs'),'utf8');
 assert.match(script,/local-only\.invalid/);
 assert.match(script,/REDE EXTERNA BLOQUEADA/);
 assert.doesNotMatch(script,/https:\/\/(api\.moovit|routes\.googleapis|photon\.komoot)/);
 assert.match(script,/focusCombinations/);
});
