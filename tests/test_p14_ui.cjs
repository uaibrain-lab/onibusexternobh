'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('static/index.html');
const js=read('static/app.js');
const css=read('static/style.css');
const parity=read('static/hub-parity.css');
const sw=read('static/sw.js');
const server=read('server.py');

test('estilo próprio do Externo acompanha o Interno e não depende do CSS do Hub',()=>{
  for(const token of ['--bg:#fff','--bg2:#f2f4f7','--ink:#101828','--mut:#667085','--line:#e4e7ec']){
    assert.ok(css.includes(token),'faltando token '+token);
  }
  assert.match(html,/href="\.\/hub-parity\.css"/);
  assert.match(parity,/Paridade com a aba Interno/);
  assert.doesNotMatch(html,/\/assets\/styles\.css/);
  assert.doesNotMatch(html,/id="bandeco-navigation"|id="tab-interno"/);
});
test('contrato mobile: painel inferior, detalhes sem cabeçalho e foco no ponto',()=>{
  assert.match(parity,/#sheet\.detail:not\(\.peek\) \.sheet-head/);
  assert.match(parity,/#sheet\.detail:not\(\.peek\):not\(\.full\)/);
  assert.match(parity,/grid-template-columns:44px minmax\(0,1fr\) 44px 44px/);
  assert.match(js,/sheet\.classList\.toggle\('detail',detail\)/);
  assert.match(js,/activeTab==='pontos'/);
  assert.match(js,/centerStopInAvailableMap\(\)/);
  assert.match(parity,/min-height:44px/);
});
test('tema combina com o Hub no mesmo domínio, sem confiar em mensagens arbitrárias',()=>{
  assert.match(html,/root\.dataset\.embedded=/);
  assert.match(html,/window\.parent\.location\.origin===location\.origin/);
  assert.match(js,/e\.source!==window\.parent \|\| e\.origin!==location\.origin/);
  assert.match(js,/hubColorScheme\.addEventListener\('change',inheritHubTheme\)/);
  assert.match(html,/name="theme-color"/);
});
test('PWA, servidor e rotas de iframe suportam nova folha sem duplicar SW do Hub',()=>{
  assert.match(sw,/hub-externo-static-p14-r1/);
  assert.match(sw,/'\.\/hub-parity\.css'/);
  assert.match(server,/self\.send_response\(308\)/);
  assert.match(server,/self\.send_header\('Location','\/externo\/'\)/);
  assert.match(server,/'\/hub-parity\.css':'text\/css'/);
  assert.match(js,/location\.pathname\.startsWith\('\/externo'\)/);
  assert.match(js,/navigator\.serviceWorker\.register\('\.\/sw\.js',\{scope:'\.\/'\}\)/);
});
test('mapa continua consultável quando o basemap falha',()=>{
  assert.match(html,/id="mapBasemapNotice"/);
  assert.match(html,/id="mapAccessibleHelp"/);
  assert.match(js,/basemapFailures>=2/);
  assert.match(js,/\$\('mapBasemapNotice'\)\.hidden=false/);
  assert.match(parity,/\.map-basemap-notice\[hidden\]/);
  assert.match(parity,/html\[data-theme="dark"\] #map/);
});
