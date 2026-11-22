// Visual regression: canvas glyph must be a recognizable mini-bus (not an arrow).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../static/app.js'),'utf8');
const begin=source.indexOf('function drawMiniBus(');
const end=source.indexOf('\nfunction draw(){',begin);
assert.ok(begin>=0&&end>begin,'Miniônibus definido antes da renderização');
const calls=[];
const ctx=new Proxy({}, {
  set(obj,key,value){obj[key]=value;return true},
  get(obj,key){
    if(key in obj)return obj[key];
    return (...values)=>{calls.push({name:key,values})};
  }
});
const draw=vm.runInNewContext(source.slice(begin,end)+'\ndrawMiniBus',{ctx,Math});
test('desenha ônibus com carroceria, rodas, para-brisa e faróis',()=>{
  calls.length=0;draw(100,80,90,'recent',false);
  assert.ok(calls.some(c=>c.name==='translate'&&c.values[0]===100&&c.values[1]===80));
  assert.ok(calls.some(c=>c.name==='rotate'&&Math.abs(c.values[0]-Math.PI/2)<.0001));
  assert.ok(calls.filter(c=>c.name==='fillRect').length>=7,
    'Deve desenhar rodas, janelas e faróis, não apenas seta');
  assert.ok(calls.some(c=>c.name==='quadraticCurveTo'));
  assert.ok(calls.some(c=>c.name==='restore'));
});
test('heading ausente não inventa direção',()=>{
  calls.length=0;draw(5,6,null,'recent',false);
  assert.equal(calls.filter(c=>c.name==='rotate').length,0);
});
test('estado GPS antigo continua distinguível',()=>{
  calls.length=0;draw(5,6,0,'stale',true);
  assert.ok(calls.some(c=>c.name==='arc'),'halo da seleção continua presente');
  assert.ok(calls.some(c=>c.name==='rotate'&&c.values[0]===0));
});
test('nenhuma seta GPS continua como marcador no canvas',()=>{
  assert.doesNotMatch(source,/ctx\.moveTo\(0,-9\);ctx\.lineTo\(-5,6\)/);
  assert.doesNotMatch(source,/fillText\('➤',ex,ey\)/);
});
