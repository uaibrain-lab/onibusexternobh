'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../static/metropolitan.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../catalog/der-rmbh-411c-511c.json'), 'utf8'));

function fakePage(payload) {
  const elems = new Map();
  class El {
    constructor() {
      this.children = []; this.handlers = new Map();
      this.value = ''; this.textContent = ''; this.disabled = false;
    }
    replaceChildren(...c) { this.children = c; }
    add(c) { this.children.push(c); }
    append(c) { if (c.fragment) this.children.push(...c.children); else this.children.push(c); }
    addEventListener(name, f) { this.handlers.set(name, f); }
    change() { this.handlers.get('change')(); }
  }
  const doc = {
    getElementById(id) {
      if (!elems.has(id)) elems.set(id, new El());
      return elems.get(id);
    },
    createElement() { return new El(); },
    createDocumentFragment() { const e = new El(); e.fragment = true; return e; }
  };
  vm.runInNewContext(script, {
    document: doc,
    Option: class { constructor(label, value) { this.textContent=label; this.value=value; } },
    fetch: async() => ({ok:true,json:async()=>payload})
  });
  return {doc};
}

test('renders only manually selected DER day, preserving source RI/PI suffix', async()=>{
  const {doc}=fakePage(data);
  await new Promise(resolve=>setImmediate(resolve));
  const line=doc.getElementById('derLine'),day=doc.getElementById('derDay');
  assert.equal(line.children.length,3);
  assert.equal(day.children.length,0);
  line.value='411C';line.change();
  assert.equal(day.children.length,10);
  assert.equal(doc.getElementById('derTimes').children.length,0);
  day.value=day.children[1].value;day.change();
  assert.equal(doc.getElementById('derTimes').children.length,120);
  assert.match(doc.getElementById('derStatus').textContent,/120 partidas/);
  const entries=doc.getElementById('derTimes').children;
  assert.equal(entries[0].children[0].textContent,'04:00');
  assert.ok(entries.some(item=>item.children[1]?.textContent?.trim()==='RI'));
  line.value='511C';line.change();
  assert.equal(doc.getElementById('derTimes').children.length,0);
});

test('fails closed if informational catalog is replaced with routing enabled', async()=>{
  const {doc}=fakePage({...data,routePlanningEnabled:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(doc.getElementById('derLine').disabled,true);
  assert.match(doc.getElementById('derStatus').textContent,/indisponíveis/);
});
