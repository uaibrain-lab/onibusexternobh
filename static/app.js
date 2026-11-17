'use strict';
const isStaticOnly=document.documentElement.dataset.appMode==='free-static';
const $=id=>document.getElementById(id);
const state={routes:[],route:null,geometry:null,fleet:null,pattern:'',selectedVehicle:'',
  center:[-19.8695,-43.9675],zoom:15,markers:[],stopMarkers:[],mapStops:[],selectedStop:null,nearby:[],userPosition:null,tiles:new Map(),frame:0,drag:null,
  metro:null,metroMarkers:[],metroVisible:false,metroLine:'',selectedMetroStation:'',
  routeOrigin:null,routeDestination:null,routePick:null,routeResults:[],routeSelected:0};
const $canvas=$('mapCanvas'),ctx=$canvas.getContext('2d');
const MAX_Z=18,MIN_Z=10;
function mercator(lat,lng,z){const size=256*2**z;let y=Math.max(-85.0511,Math.min(85.0511,lat));return [(lng+180)/360*size,(1-Math.asinh(Math.tan(y*Math.PI/180))/Math.PI)/2*size]}
function invMercator(x,y,z){const size=256*2**z;const n=Math.PI-2*Math.PI*y/size;return [180/Math.PI*Math.atan(Math.sinh(n)),x/size*360-180]}
function screen(lat,lng){let [cx,cy]=mercator(...state.center,state.zoom),[px,py]=mercator(lat,lng,state.zoom);return [px-cx+$canvas.clientWidth/2,py-cy+$canvas.clientHeight/2]}
function resize(){let dpr=Math.min(window.devicePixelRatio||1,2);$canvas.width=Math.floor($canvas.clientWidth*dpr);$canvas.height=Math.floor($canvas.clientHeight*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);drawSoon();scheduleMapStops()}
function drawSoon(){if(!state.frame)state.frame=requestAnimationFrame(()=>{state.frame=0;draw()})}
function getTile(z,x,y){let n=2**z;if(y<0||y>=n)return null;let key=`${z}/${((x%n)+n)%n}/${y}`;let ent=state.tiles.get(key);if(!ent){let img=new Image();ent={img,ready:false,error:false};state.tiles.set(key,ent);img.onload=()=>{ent.ready=true;drawSoon()};img.onerror=()=>{ent.error=true;drawSoon()};img.src=`https://tile.openstreetmap.org/${z}/${((x%n)+n)%n}/${y}.png`;}if(state.tiles.size>180){for(const k of state.tiles.keys()){if(state.tiles.size<=160)break;state.tiles.delete(k)}}return ent}
function drawTiles(w,h){let z=Math.floor(state.zoom),scale=2**(state.zoom-z),[cx,cy]=mercator(...state.center,z),tx=cx-w/2/scale,ty=cy-h/2/scale;ctx.fillStyle='#d9e4e4';ctx.fillRect(0,0,w,h);let minx=Math.floor(tx/256)-1,maxx=Math.ceil((tx+w/scale)/256)+1,miny=Math.floor(ty/256)-1,maxy=Math.ceil((ty+h/scale)/256)+1;for(let y=miny;y<=maxy;y++)for(let x=minx;x<=maxx;x++){let px=(x*256-tx)*scale,py=(y*256-ty)*scale,tile=getTile(z,x,y);if(tile&&tile.ready){ctx.drawImage(tile.img,px,py,256*scale+.5,256*scale+.5)}else{ctx.fillStyle=((x+y)&1)?'#e8eeea':'#dfe9e6';ctx.fillRect(px,py,256*scale+.5,256*scale+.5);ctx.strokeStyle='#cddad7';ctx.strokeRect(px,py,256*scale,256*scale)}}}
function draw(){const w=$canvas.clientWidth,h=$canvas.clientHeight;if(!w||!h)return;ctx.clearRect(0,0,w,h);drawTiles(w,h);state.stopMarkers=[];for(const s of state.mapStops){let [x,y]=screen(s.lat,s.lng);if(x<-20||y<-20||x>w+20||y>h+20)continue;const selected=state.selectedStop===s.id;ctx.beginPath();ctx.arc(x,y,selected?8:state.zoom>=15?5:3,0,Math.PI*2);ctx.fillStyle=selected?'#f79009':'#fff';ctx.fill();ctx.lineWidth=selected?3:2;ctx.strokeStyle=selected?'#8d5904':'#344054';ctx.stroke();state.stopMarkers.push({x,y,stop:s})}if(state.geometry?.selected&&activeTab!=='rotas'){let selected=state.geometry.selected,coords=selected.coordinates;if(coords.length){ctx.beginPath();coords.forEach(([lat,lng],i)=>{let [x,y]=screen(lat,lng);if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.strokeStyle='#0c6e6b';ctx.lineWidth=7;ctx.globalAlpha=.25;ctx.stroke();ctx.lineWidth=3;ctx.strokeStyle='#007f75';ctx.globalAlpha=.9;ctx.stroke();ctx.globalAlpha=1;}for(let s of selected.stops){let [x,y]=screen(s.lat,s.lng);if(x<-10||y<-10||x>w+10||y>h+10)continue;ctx.beginPath();ctx.arc(x,y,state.zoom>=14?3:2,0,Math.PI*2);ctx.fillStyle='#fefefe';ctx.fill();ctx.strokeStyle='#168f83';ctx.lineWidth=1.4;ctx.stroke();state.stopMarkers.push({x,y,stop:s})}}
  drawMetroLayer();
  drawRouteLayer();
  state.markers=[];let vehicles=state.fleet?.vehicles||[];for(let v of vehicles){let [x,y]=screen(v.latitude,v.longitude);if(x<-25||y<-25||x>w+25||y>h+25)continue;let changedAge=diffSeconds(v.positionUnchangedSinceAt);let stale=diffSeconds(v.lastGpsFixAt)>120,frozen=changedAge>120;let isSelected=state.selectedVehicle===v.source+'|'+v.vehicleId;ctx.save();ctx.translate(x,y);if(isSelected){ctx.beginPath();ctx.arc(0,0,24,0,Math.PI*2);ctx.fillStyle='#38d5ab44';ctx.fill()}ctx.beginPath();ctx.arc(0,0,13,0,Math.PI*2);ctx.fillStyle=stale?'#a6565d':frozen?'#ad7728':'#136c66';ctx.fill();ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.stroke();ctx.rotate((v.heading||0)*Math.PI/180);ctx.fillStyle='#ffffff';ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(-5,6);ctx.lineTo(0,3);ctx.lineTo(5,6);ctx.closePath();ctx.fill();ctx.restore();state.markers.push({x,y,id:v.source+'|'+v.vehicleId});}
  if(state.userPosition){const [x,y]=screen(...state.userPosition);ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fillStyle='#1570ef';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke()}
  $('mapToast').textContent=activeTab==='rotas'
    ?'Rotas · ônibus em horários GTFS; traços esquemáticos; caminhada aproximada'
    :state.metroVisible&&state.metro
    ?'Metrô · linhas esquemáticas e estações em operação · sem previsão GPS dos trens'
    :state.route?`${vehicles.length} ônibus da linha ${state.route.code} · ${state.geometry?.selected?'Traçado de referência':'Escolha um percurso para vê-lo'}`
    :`${state.mapStops.length} pontos no mapa · toque em um ponto para ver linhas e chegadas`;}

function diffSeconds(iso){if(!iso)return Infinity;let t=Date.parse(iso);return Number.isFinite(t)?Math.max(0,Math.floor((Date.now()-t)/1000)):Infinity}
function fmtAge(n){if(!Number.isFinite(n))return 'desconhecido';if(n<60)return `${n}s`;if(n<3600)return `${Math.floor(n/60)}min ${String(n%60).padStart(2,'0')}s`;return `${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}min`}
function fmtTime(iso){try{return new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(iso))}catch(e){return '—'}}
async function api(path){
  if(isStaticOnly){
    if(!window.__StaticCatalogAPI)throw Error('Catálogo estático indisponível');
    return window.__StaticCatalogAPI.api(path);
  }
  const base=location.pathname.startsWith('/externo')?'/externo':'';
  let r=await fetch(base+path,{cache:'no-store'});
  if(!r.ok)throw Error(`HTTP ${r.status}`);
  return r.json()
}
function statusLed(ok,label){$('sourceLed').className='dot '+(ok?'ok':'bad');$('sourceText').textContent=label}
function updateStatus(obj){state.lastBusStatus=obj;if(activeTab==='metro')return;let errors=Object.entries(obj.sources).filter(([_,x])=>x.lastError);let newest=Math.min(...Object.values(obj.sources).map(x=>diffSeconds(x.lastFetchedAt)));let fresh=Number.isFinite(newest)&&newest<180;statusLed(errors.length===0&&fresh,errors.length?`Falha em ${errors.map(x=>x[0]).join(', ')}`:fresh?'PBH · fontes consultadas':'PBH · aguardando atualização');$('lastPoll').textContent=`Última consulta PBH: ${Number.isFinite(newest)?'há '+fmtAge(newest):'indisponível'}`}
async function loadRoutes(){state.routes=await api('/api/routes');let dl=$('routeList');dl.innerHTML='';for(let r of state.routes){let op=document.createElement('option');op.value=r.code;op.label=r.name;dl.append(op)}$('lineInput').value='';renderAllLines('');renderFavoriteLines();renderFavoriteStops();await loadNearbyStops(-19.8695,-43.9675,false)}
async function selectLine(code){let route=state.routes.find(r=>r.code.toUpperCase()===String(code).trim().toUpperCase()||`${r.code} — ${r.name}`.toUpperCase()===String(code).trim().toUpperCase());if(!route){$('lineTitle').textContent='Linha não encontrada no catálogo GTFS';return}state.route=route;state.geometry=null;state.fleet=null;state.pattern='';state.selectedVehicle='';$('lineInput').value=route.code;$('lineTitle').textContent=route.name;const fav=$('lineFavorite');fav.hidden=false;fav.textContent=favorites.routes.includes(route.code)?'★':'☆';fav.setAttribute('aria-pressed',String(favorites.routes.includes(route.code)));fav.onclick=()=>toggleFavorite('routes',route.code);renderFavoriteLines();$('vehicleList').textContent='Carregando veículos…';let [geo,fleet]=await Promise.all([api('/api/route?code='+encodeURIComponent(route.code)),api('/api/fleet?route='+encodeURIComponent(route.code))]);if(state.route?.code!==route.code)return;state.geometry=geo;state.fleet=fleet;let sel=$('patternInput');sel.innerHTML='';let op=document.createElement('option');op.value='';op.textContent=`Sem traçado (${geo.patterns.length} opções)`;sel.append(op);for(let p of geo.patterns){let o=document.createElement('option');o.value=p.id;o.textContent=`${p.headsign||'Sem destino'} · ${p.stops} paradas`;sel.append(o)}renderVehicles();renderStops();drawSoon();if(geo.patterns.length){let preferred=[...geo.patterns].sort((a,b)=>b.tripCount-a.tripCount)[0];$('patternInput').value=preferred.id;await selectPattern();}let loc=fleet.vehicles.find(v=>diffSeconds(v.lastGpsFixAt)<=120);if(loc){state.center=[loc.latitude,loc.longitude];state.zoom=13.5;drawSoon();}}
function vehicleMeta(v){let match=v.shapeMatch;let shape=match.status==='probable'?`Traçado provável ${match.shapeId} (não confirmado)`:'Traçado ainda indeterminado';return `Último GPS: ${fmtTime(v.lastGpsFixAt)} · há ${fmtAge(diffSeconds(v.lastGpsFixAt))}\nPosição sem mudança: ${fmtAge(diffSeconds(v.positionUnchangedSinceAt))}\n${shape}`}
function vehicleRow(v){let b=document.createElement('button');b.type='button';b.className='vehicle'+(state.selectedVehicle===v.source+'|'+v.vehicleId?' selected':'');b.dataset.vehicleKey=v.source+'|'+v.vehicleId;let top=document.createElement('div');top.className='top';let name=document.createElement('b');name.textContent=`Ônibus ${v.vehicleId}`;let lab=document.createElement('span');lab.className='label';let gpsAge=diffSeconds(v.lastGpsFixAt),stillAge=diffSeconds(v.positionUnchangedSinceAt);if(gpsAge>120)lab.classList.add('old');else if(stillAge>120)lab.classList.add('warn');lab.textContent=gpsAge>300?'GPS antigo':gpsAge>120?'GPS atrasado':stillAge>120?'Posição repetida':'GPS recente';top.append(name,lab);let m=document.createElement('div');m.className='meta';m.textContent=vehicleMeta(v);m.style.whiteSpace='pre-line';b.append(top,m);b.onclick=()=>{state.selectedVehicle=v.source+'|'+v.vehicleId;state.center=[v.latitude,v.longitude];state.zoom=Math.max(state.zoom,15);switchTab('linhas',true);renderVehicles();drawSoon();scheduleMapStops()};return b}
function tickVehicleAges(){let byId=new Map((state.fleet?.vehicles||[]).map(v=>[v.source+'|'+v.vehicleId,v]));for(let node of $('vehicleList').querySelectorAll('.vehicle')){let v=byId.get(node.dataset.vehicleKey);if(v){let m=node.querySelector('.meta');if(m)m.textContent=vehicleMeta(v)}}}
function renderVehicles(){
  if(isStaticOnly){
    $('vTotal').textContent='—';$('vRecent').textContent='—';
    const list=$('vehicleList');list.replaceChildren();
    const p=document.createElement('p');p.className='notice';
    p.textContent='Posições GPS ao vivo ainda não disponíveis na hospedagem estática. A linha, os sentidos e suas paradas são do GTFS oficial; não confundir tabela com localização de veículo.';
    list.append(p);return;
  }
  let arr=state.fleet?.vehicles||[];$('vTotal').textContent=arr.length;$('vRecent').textContent=arr.filter(v=>diffSeconds(v.lastGpsFixAt)<=120).length;let list=$('vehicleList');list.innerHTML='';if(!arr.length){let p=document.createElement('p');p.className='notice';p.textContent='Nenhum GPS recente ou recente o suficiente (até 10 minutos) foi encontrado para esta linha. A linha pode estar sem operação ou sem sinal.';list.append(p);return}for(let v of arr.slice(0,200))list.append(vehicleRow(v));}
async function selectPattern(){state.pattern=$('patternInput').value;if(!state.pattern){state.geometry.selected=null;renderStops();drawSoon();return}let geo=await api('/api/route?code='+encodeURIComponent(state.route.code)+'&pattern='+encodeURIComponent(state.pattern));if(geo?.selected && state.pattern===geo.selected.patternId){state.geometry=geo;renderStops();fitCoordinates(geo.selected.coordinates);drawSoon();scheduleMapStops();}}
function fitCoordinates(coords){if(!coords.length)return;let la=coords.map(p=>p[0]),lo=coords.map(p=>p[1]);let bounds=[Math.min(...la),Math.min(...lo),Math.max(...la),Math.max(...lo)];state.center=[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2];let w=$canvas.clientWidth*.81,h=$canvas.clientHeight*.8;for(let z=17;z>=10;z--){let a=mercator(bounds[0],bounds[1],z),b=mercator(bounds[2],bounds[3],z);if(Math.abs(b[0]-a[0])<=w && Math.abs(b[1]-a[1])<=h){state.zoom=z;break}}}
function zoom(delta,at=null){const old=state.zoom,newZ=Math.max(MIN_Z,Math.min(MAX_Z,old+delta));if(old===newZ)return;let anchor=at||[$canvas.clientWidth/2,$canvas.clientHeight/2];let [cx,cy]=mercator(...state.center,old), world=[cx+anchor[0]-$canvas.clientWidth/2,cy+anchor[1]-$canvas.clientHeight/2];let point=invMercator(...world,old);state.zoom=newZ;let [nx,ny]=mercator(...point,newZ);state.center=invMercator(nx-anchor[0]+$canvas.clientWidth/2,ny-anchor[1]+$canvas.clientHeight/2,newZ);drawSoon();scheduleMapStops()}
$canvas.addEventListener('wheel',e=>{e.preventDefault();let rc=$canvas.getBoundingClientRect();zoom(e.deltaY<0?.5:-.5,[e.clientX-rc.left,e.clientY-rc.top])},{passive:false});
$canvas.addEventListener('pointerdown',e=>{let box=$canvas.getBoundingClientRect();state.drag={x:e.clientX,y:e.clientY,moved:false,at:[e.clientX-box.left,e.clientY-box.top]};$canvas.setPointerCapture(e.pointerId);$canvas.classList.add('dragging')});
$canvas.addEventListener('pointermove',e=>{if(!state.drag)return;let dx=e.clientX-state.drag.x,dy=e.clientY-state.drag.y;if(Math.abs(dx)+Math.abs(dy)>3)state.drag.moved=true;let [cx,cy]=mercator(...state.center,state.zoom);state.center=invMercator(cx-dx,cy-dy,state.zoom);state.drag.x=e.clientX;state.drag.y=e.clientY;drawSoon()});
$canvas.addEventListener('pointerup',e=>{const drag=state.drag;state.drag=null;$canvas.classList.remove('dragging');if(drag?.moved){scheduleMapStops();return}if(!drag)return;let p=drag.at;
if(state.routePick){
  const [cx,cy]=mercator(...state.center,state.zoom);
  const [lat,lng]=invMercator(cx+p[0]-$canvas.clientWidth/2,cy+p[1]-$canvas.clientHeight/2,state.zoom);
  const which=state.routePick;state.routePick=null;
  setRoutePoint(which,{lat,lng,label:`Mapa: ${lat.toFixed(5)}, ${lng.toFixed(5)}`});
  switchTab('rotas',true);drawSoon();return;
}
let near=state.markers.map(m=>({...m,d:Math.hypot(m.x-p[0],m.y-p[1])})).sort((a,b)=>a.d-b.d)[0];if(near&&near.d<20){state.selectedVehicle=near.id;switchTab('linhas',true);renderVehicles();drawSoon();return}let station=state.metroMarkers.map(m=>({...m,d:Math.hypot(m.x-p[0],m.y-p[1])})).sort((a,b)=>a.d-b.d)[0];if(station&&station.d<23){focusMetroStation(station.station.id);return}let stop=state.stopMarkers.map(m=>({...m,d:Math.hypot(m.x-p[0],m.y-p[1])})).sort((a,b)=>a.d-b.d)[0];if(stop&&stop.d<24){focusStop(stop.stop);return}});
$('zoomIn').onclick=()=>zoom(1);$('zoomOut').onclick=()=>zoom(-1);$('recenter').onclick=()=>{state.center=[-19.8695,-43.9675];state.zoom=15;drawSoon();scheduleMapStops();loadNearbyStops(-19.8695,-43.9675,false).catch(reportError)};
$('goLine').onclick=()=>selectLine($('lineInput').value).catch(reportError);$('lineInput').onkeydown=e=>{if(e.key==='Enter')$('goLine').click()};$('patternInput').onchange=()=>selectPattern().catch(reportError);
$('refresh').onclick=()=>refresh().catch(reportError);
function reportError(e){console.error(e);statusLed(false,'Erro ao consultar dados');$('mapToast').textContent=`Não foi possível atualizar: ${e.message}`}
async function refresh(){if(document.hidden)return;if(!state.route)return;const code=state.route.code;let [fleet,status]=await Promise.all([api('/api/fleet?route='+encodeURIComponent(code)),api('/api/status')]);if(state.route?.code!==fleet.line)return;state.fleet=fleet;updateStatus(status);renderVehicles();drawSoon()}
// Interface compartilhada com o padrão visual do Hub UFMG / Interno.
let activeTab='pontos';
function openSheet(full=false){const sheet=$('sheet');sheet.classList.remove('peek');sheet.classList.toggle('full',!!full);$('sheet-toggle').setAttribute('aria-expanded','true');$('grab').setAttribute('aria-expanded','true');$('body').setAttribute('aria-hidden','false')}
function closeSheet(){const sheet=$('sheet');sheet.classList.add('peek');sheet.classList.remove('full');$('sheet-toggle').setAttribute('aria-expanded','false');$('grab').setAttribute('aria-expanded','false');$('body').setAttribute('aria-hidden','true')}
function switchTab(tab,open=false){activeTab=tab;const pts=tab==='pontos',lin=tab==='linhas',met=tab==='metro',rot=tab==='rotas';
$('pontosPane').hidden=!pts;$('linhasPane').hidden=!lin;$('metroPane').hidden=!met;$('rotasPane').hidden=!rot;
for(const [name,on] of [['pontos',pts],['linhas',lin],['metro',met],['rotas',rot]]){const button=$('quick-'+name);button.classList.toggle('on',on);button.setAttribute('aria-pressed',String(on))}
state.metroVisible=met;
if(met){$('sourceLed').className='dot';$('sourceText').textContent='Metrô BH · horários informativos';loadMetroNews().catch(e=>console.warn('RSS da concessionária indisponível',e))}
else if(isStaticOnly){$('sourceLed').className='dot';$('sourceText').textContent='GTFS programado · sem GPS ao vivo';}
else if(state.lastBusStatus)updateStatus(state.lastBusStatus);
drawSoon();if(open)openSheet()}
function renderStops(){const el=$('stopList');el.textContent='';const stops=state.geometry?.selected?.stops||[];$('pontosHelp').textContent=stops.length?`${state.route?.code||''} · ${stops.length} paradas deste percurso de referência. Toque para localizar no mapa.`:'Selecione uma linha na aba Linhas e escolha o percurso de referência para visualizar as paradas.';if(!stops.length){const b=document.createElement('button');b.type='button';b.className='row-item';b.textContent='Escolher linha e percurso';b.onclick=()=>switchTab('linhas',true);el.append(b);return}for(let [i,s] of stops.entries()){const b=document.createElement('button');b.type='button';b.className='row-item';b.dataset.stopId=s.id;const num=document.createElement('span');num.className='num';num.textContent=String(i+1);const text=document.createElement('span');text.className='name';const name=document.createElement('b');name.textContent=s.name;const meta=document.createElement('small');meta.textContent='Ponto '+(i+1)+' · toque para localizar';text.append(name,meta);b.append(num,text);b.onclick=()=>focusStop(s);el.append(b)}}
function focusStop(stop){state.selectedStop=String(stop.id);state.center=[Number(stop.lat),Number(stop.lng)];state.zoom=Math.max(state.zoom,16);switchTab('pontos',true);$('body').scrollTo({top:0,behavior:'smooth'});for(let node of $('stopList').querySelectorAll('[data-stop-id]'))node.classList.toggle('selected',node.dataset.stopId===String(stop.id));drawSoon();scheduleMapStops();openStopDetail(state.selectedStop).catch(reportError)}
function renderAllLines(query){const el=$('allLineList');el.textContent='';let arr=state.routes||[];const q=String(query||'').trim().toLocaleLowerCase('pt-BR');if(q)arr=arr.filter(x=>(x.code+' '+x.name).toLocaleLowerCase('pt-BR').includes(q));let limited=arr.slice(0,q?80:40);for(let r of limited){const wrap=document.createElement('div');wrap.className='fav-row';const b=document.createElement('button');b.type='button';b.className='row-item';const n=document.createElement('span');n.className='num';n.textContent=r.code;const t=document.createElement('span');t.className='name';const title=document.createElement('b');title.textContent=r.name||'Sem descrição';const meta=document.createElement('small');meta.textContent=`${r.patternCount} variantes GTFS`;t.append(title,meta);b.append(n,t);b.onclick=()=>selectLine(r.code).then(()=>{openSheet();$('body').scrollTo({top:0,behavior:'smooth'})}).catch(reportError);wrap.append(b,starButton('routes',r.code));el.append(wrap)}if(arr.length>limited.length){const msg=document.createElement('p');msg.className='muted info-small';msg.textContent=`Exibindo ${limited.length} de ${arr.length} linhas. Use a busca para filtrar.`;el.append(msg)}}
let stopSearchSeq=0;
async function searchAllStops(query){const seq=++stopSearchSeq;const el=$('stopSearchResult');el.textContent='';const q=String(query||'').trim();if(q.length<2)return;try{const data=await api('/api/stops?q='+encodeURIComponent(q));if(seq!==stopSearchSeq)return;const stops=data.items||[];if(!stops.length){const m=document.createElement('p');m.className='muted info-small';m.textContent='Nenhum ponto localizado.';el.append(m);return}for(const stop of stops){const b=document.createElement('button');b.type='button';b.className='row-item';const badge=document.createElement('span');badge.className='num';badge.textContent='●';const name=document.createElement('span');name.className='name';const title=document.createElement('b');title.textContent=stop.name;const subtitle=document.createElement('small');subtitle.textContent='Localizar no mapa';name.append(title,subtitle);b.append(badge,name);b.onclick=()=>focusStop(stop);el.append(b)}if(data.truncated){const m=document.createElement('p');m.className='muted info-small';m.textContent='Exibindo os primeiros pontos; refine sua busca.';el.append(m)}}catch(e){if(seq===stopSearchSeq){el.textContent='Não foi possível buscar os pontos.';console.error(e)}}}
let stopSearchTimer;
$('stopInput').addEventListener('input',e=>{clearTimeout(stopSearchTimer);stopSearchTimer=setTimeout(()=>searchAllStops(e.target.value),220)});
$('allLineSearch').addEventListener('input',e=>renderAllLines(e.target.value));
$('quick-pontos').onclick=()=>switchTab('pontos',true);
$('quick-linhas').onclick=()=>switchTab('linhas',true);
$('quick-metro').onclick=()=>switchTab('metro',true);
$('quick-rotas').onclick=()=>switchTab('rotas',true);
$('sheet-toggle').onclick=()=>{$('sheet').classList.contains('peek')?openSheet():closeSheet()};
$('grab').onclick=()=>{$('sheet').classList.contains('peek')?openSheet():closeSheet()};
function askLocation(){if(isStaticOnly){useRouteLocation();return}hideLocationPrompt();if(!window.isSecureContext||!navigator.geolocation){$('nearbyHint').textContent='Localização requer HTTPS ou localhost. Mostrando pontos próximos à UFMG.';openSheet();return}navigator.geolocation.getCurrentPosition(async p=>{const lat=p.coords.latitude,lng=p.coords.longitude;state.userPosition=[lat,lng];state.center=[lat,lng];state.zoom=15.5;drawSoon();scheduleMapStops();try{if(activeTab==='metro'){await loadMetroNearby(lat,lng);switchTab('metro',true)}else{await loadNearbyStops(lat,lng,true);switchTab('pontos',true)}}catch(e){reportError(e)}},()=>{$('nearbyHint').textContent='Localização não autorizada. Você ainda pode buscar pontos no mapa da UFMG.';openSheet()},{enableHighAccuracy:false,timeout:12000,maximumAge:60000})}
$('loc').onclick=askLocation;$('allowLocation').onclick=askLocation;$('skipLocation').onclick=hideLocationPrompt;
function hideLocationPrompt(){$('locationPrompt').hidden=true;try{sessionStorage.setItem('bh-externo-location-intro-seen','yes')}catch(e){}}
try{if(sessionStorage.getItem('bh-externo-location-intro-seen')==='yes')hideLocationPrompt()}catch(e){}

// Quando incorporado pelo Hub (mesma origem), o tema acompanha o contêiner.
try{if(window.parent!==window){const theme=window.parent.document.documentElement.dataset.theme;if(theme==='dark'||theme==='light')document.documentElement.dataset.theme=theme}}catch(e){}
window.addEventListener('message',e=>{if(e.origin!==location.origin)return;if(e.data?.type==='hub-theme'&&['dark','light'].includes(e.data.theme))document.documentElement.dataset.theme=e.data.theme});

// P3: ponto-first map, location-aware suggestions, favorites and scheduled arrivals.
const FAVORITES_KEY='hubufmg-externo-favorites-v1';
function readFavorites(){try{const o=JSON.parse(localStorage.getItem(FAVORITES_KEY)||'{}');return {stops:Array.isArray(o.stops)?o.stops.map(String):[],routes:Array.isArray(o.routes)?o.routes.map(String):[]}}catch(e){return {stops:[],routes:[]}}}
let favorites=readFavorites();
function toggleFavorite(kind,id){id=String(id);let arr=favorites[kind];favorites[kind]=arr.includes(id)?arr.filter(v=>v!==id):[...arr,id];try{localStorage.setItem(FAVORITES_KEY,JSON.stringify(favorites))}catch(e){console.warn('Favoritos armazenados apenas nesta sessão',e)}renderFavoriteStops();renderFavoriteLines();if(state.route){$('lineFavorite').textContent=favorites.routes.includes(state.route.code)?'★':'☆';$('lineFavorite').setAttribute('aria-pressed',String(favorites.routes.includes(state.route.code)))}if(state.selectedStop)renderStopFavoriteButton()}
function starButton(kind,id){let b=document.createElement('button');b.type='button';b.className='fav-btn';const current=favorites[kind].includes(String(id));b.textContent=current?'★':'☆';b.title=current?'Remover favorito':'Adicionar aos favoritos';b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(current));b.onclick=e=>{e.stopPropagation();toggleFavorite(kind,id)};return b}
let mapStopsTimer=0,mapStopsSeq=0;
function scheduleMapStops(){clearTimeout(mapStopsTimer);mapStopsTimer=setTimeout(loadMapStops,180)}
async function loadMapStops(){const seq=++mapStopsSeq;if(state.zoom<12.5){state.mapStops=[];drawSoon();return}const w=$canvas.clientWidth,h=$canvas.clientHeight;if(!w||!h)return;const [cx,cy]=mercator(...state.center,state.zoom);const a=invMercator(cx-(w*.65),cy+(h*.65),state.zoom),b=invMercator(cx+(w*.65),cy-(h*.65),state.zoom);const url=`/api/map-stops?minlat=${a[0]}&minlng=${a[1]}&maxlat=${b[0]}&maxlng=${b[1]}`;try{const data=await api(url);if(seq!==mapStopsSeq)return;state.mapStops=data.items||[];drawSoon()}catch(e){console.warn('Paradas do mapa indisponíveis',e)}}
async function loadNearbyStops(lat,lng,personal){let data=await api(`/api/nearby-stops?lat=${lat}&lng=${lng}`);state.nearby=data.items||[];$('nearbyHeading').textContent=personal?'Pontos perto de você':'Pontos próximos à UFMG';$('nearbyHint').textContent=personal?'Distâncias aproximadas; sua localização não é armazenada no servidor.':'Sem localização, exibimos os pontos próximos ao campus UFMG.';renderNearbyStops()}
function renderNearbyStops(){const area=$('nearbyStops');area.replaceChildren();for(const stop of state.nearby){let b=document.createElement('button');b.type='button';b.className='row-item';const n=document.createElement('span');n.className='num';n.textContent='●';const txt=document.createElement('span');txt.className='name';let t=document.createElement('b');t.textContent=stop.name;let d=document.createElement('small');d.textContent=`A ${stop.distanceM} m · ver linhas e chegadas`;txt.append(t,d);b.append(n,txt);b.onclick=()=>focusStop(stop);area.append(b)}if(!state.nearby.length){let e=document.createElement('p');e.className='muted-empty';e.textContent='Nenhum ponto encontrado neste raio.';area.append(e)}}
function renderFavoriteStops(){const area=$('favoriteStops');area.replaceChildren();if(!favorites.stops.length){let p=document.createElement('p');p.className='muted-empty';p.textContent='Nenhum ponto favorito ainda.';area.append(p);return}for(const id of favorites.stops){const wrap=document.createElement('div');wrap.className='fav-row';const b=document.createElement('button');b.type='button';b.className='row-item';b.textContent='Ponto '+id;const found=state.nearby.find(s=>s.id===id)||state.mapStops.find(s=>s.id===id);if(found)b.textContent=found.name;b.onclick=async()=>{if(found){focusStop(found)}else{try{const detail=await api('/api/stop?id='+encodeURIComponent(id));focusStop(detail)}catch(e){reportError(e)}}};wrap.append(b,starButton('stops',id));area.append(wrap)}}
function renderFavoriteLines(){const area=$('favoriteLines');area.replaceChildren();if(!favorites.routes.length){const p=document.createElement('p');p.className='muted-empty';p.textContent='Nenhuma linha favorita ainda.';area.append(p);return}for(const code of favorites.routes){const route=state.routes.find(r=>r.code===code);const wrap=document.createElement('div');wrap.className='fav-row';const b=document.createElement('button');b.type='button';b.className='row-item';b.textContent=route?`${route.code} — ${route.name}`:code;b.onclick=()=>selectLine(code).catch(reportError);wrap.append(b,starButton('routes',code));area.append(wrap)}}
let stopDetailSeq=0;
function renderStopFavoriteButton(){const area=$('stopDetail');if(!state.selectedStop)return;const current=area.querySelector('.stop-head .fav-btn');if(current){current.replaceWith(starButton('stops',state.selectedStop))}}
async function openStopDetail(id,silent=false){const seq=++stopDetailSeq;const area=$('stopDetail');area.hidden=false;if(!silent){area.replaceChildren();let message=document.createElement('p');message.className='muted-empty';message.textContent='Consultando linhas e horários desta parada…';area.append(message)}let data=await api('/api/stop?id='+encodeURIComponent(id));if(seq!==stopDetailSeq||String(state.selectedStop)!==String(id))return;area.replaceChildren();const head=document.createElement('div');head.className='stop-head';const text=document.createElement('div');let title=document.createElement('h2');title.textContent=data.name;const small=document.createElement('small');small.textContent=`Ponto ${data.id} · ${data.routes.length} linha(s)`;text.append(title,small);head.append(text,starButton('stops',data.id));area.append(head);
if(!data.routes.length){let p=document.createElement('p');p.className='muted-empty';p.textContent='Nenhuma linha vinculada a este ponto na versão atual do GTFS.';area.append(p)}
for(const r of data.routes){const b=document.createElement('button');b.type='button';b.className='route-arrival';const n=document.createElement('span');n.className='num';n.textContent=r.code;const label=document.createElement('span');label.className='arrival-info';const name=document.createElement('b');name.textContent=r.name;const sub=document.createElement('small');sub.textContent=r.nextArrival?`Destino: ${r.nextArrival.destination||'não informado'} · horário da tabela`:'Sem passagem programada nas próximas 5h';label.append(name,sub);const eta=document.createElement('span');eta.className='eta';if(r.nextArrival){eta.textContent=r.nextArrival.minutes<=0?'Agora':`${r.nextArrival.minutes} min`;const when=document.createElement('small');when.textContent=fmtTime(r.nextArrival.at).slice(0,5);eta.append(when)}else{eta.textContent='—';const status=document.createElement('small');status.textContent='Sem previsão';eta.append(status)}b.append(n,label,eta);b.onclick=()=>{switchTab('linhas',true);selectLine(r.code).catch(reportError)};area.append(b)}
const note=document.createElement('p');note.className='stop-forecast-note';note.textContent=data.timetableAvailable?'Os minutos indicam o próximo horário programado no GTFS, NÃO uma previsão ajustada pelo GPS. Trânsito, cancelamentos e atrasos podem alterar a chegada.':'Não foi possível carregar os horários GTFS. Evitamos exibir estimativas sem fonte confiável.';area.append(note);renderFavoriteStops();drawSoon()}

if(isStaticOnly){
  $('locationPrompt').hidden=true;
  $('sourceText').textContent='GTFS oficial programado · sem GPS ao vivo';
  $('lastPoll').textContent='Catálogo GTFS · sem localização GPS de veículos';
  $('refresh').hidden=true;
  switchTab('rotas');renderStops();
  $('routePlanStatus').textContent='Planejamento gratuito no dispositivo. A busca por ruas está condicionada ao grafo OSM instalado.';
}else{
  switchTab('pontos');renderStops();
}
loadMetro().catch(e=>{console.warn('Catálogo de metrô indisponível',e);$('metroService').textContent='Metrô temporariamente indisponível.'});
window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!isStaticOnly)refresh().catch(reportError)});
resize();
loadRoutes().catch(reportError);
if(!isStaticOnly){
  setInterval(()=>{if(document.hidden)return;tickVehicleAges();drawSoon()},1000);
  setInterval(()=>refresh().catch(reportError),35000);
  setInterval(()=>{if(!document.hidden&&state.selectedStop)openStopDetail(state.selectedStop,true).catch(reportError)},60000);
}


// P4: metrô como modal independente. Sem trens fictícios, ETA artificial nem estação em obras.
function metroStationById(id){return state.metro?.stations.find(s=>s.id===id)}
function drawMetroLayer(){
  state.metroMarkers=[];
  if(!state.metroVisible||!state.metro)return;
  for(const line of state.metro.lines){
    if(state.metroLine&&line.id!==state.metroLine)continue;
    let stations=line.stations.map(metroStationById).filter(Boolean);
    if(stations.length>1){
      ctx.beginPath();
      stations.forEach((s,i)=>{let [x,y]=screen(s.lat,s.lng);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});
      ctx.save();ctx.strokeStyle=line.color;ctx.lineWidth=8;ctx.globalAlpha=.22;ctx.stroke();ctx.lineWidth=3;ctx.globalAlpha=.9;
      ctx.stroke();ctx.restore();
    }
  }
  for(const s of state.metro.stations){
    if(state.metroLine&&!s.lines.includes(state.metroLine))continue;
    let [x,y]=screen(s.lat,s.lng);if(x<-25||x>$canvas.clientWidth+25||y<-25||y>$canvas.clientHeight+25)continue;
    let selected=state.selectedMetroStation===s.id;
    ctx.beginPath();ctx.arc(x,y,selected?10:7,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();
    ctx.strokeStyle=s.lines.includes('2')?'#8655b7':'#ef8e25';ctx.lineWidth=selected?4:3;ctx.stroke();
    if(selected||state.zoom>=15.8){
      ctx.font='bold 11px system-ui,sans-serif';
      const text=s.name, width=Math.min(160,ctx.measureText(text).width+12);
      ctx.fillStyle='rgba(255,255,255,.92)';ctx.fillRect(x-width/2,y+11,width,18);
      ctx.fillStyle='#252a34';ctx.textAlign='center';ctx.fillText(text,x,y+24,150);
    }
    state.metroMarkers.push({x,y,station:s});
  }
}
function metroStationRow(s,subtitle){
  const b=document.createElement('button');b.className='row-item metro-station';b.type='button';
  b.classList.toggle('selected',s.id===state.selectedMetroStation);
  const badge=document.createElement('span');badge.className='num';
  badge.textContent=s.lines.map(n=>'L'+n).join('/');
  badge.style.background=s.lines.includes('2')?'#8655b7':'#ad6511';badge.style.color='#fff';
  const body=document.createElement('span');body.className='name';const title=document.createElement('b');title.textContent=s.name;
  const small=document.createElement('small');small.textContent=subtitle||s.lines.map(n=>'Linha '+n).join(' · ')+(s.interchange?' · Integração L1/L2':'');
  body.append(title,small);b.append(badge,body);
  b.onclick=()=>focusMetroStation(s.id).catch(reportError);return b;
}
function renderMetroStations(){
  const area=$('metroStations');area.replaceChildren();
  if(!state.metro)return;
  const q=$('metroSearch').value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  const stations=state.metro.stations.filter(s=>(!state.metroLine||s.lines.includes(state.metroLine))&&s.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').includes(q));
  for(const s of stations)area.append(metroStationRow(s));
  if(!stations.length){const p=document.createElement('p');p.className='muted-empty';p.textContent='Nenhuma estação encontrada.';area.append(p)}
}
function formatHeadway(n){return Number.isInteger(n)?String(n):String(n).replace('.',',')}
function renderMetroService(){
  const area=$('metroService');area.replaceChildren();if(!state.metro)return;
  const lines=state.metro.lines.filter(l=>!state.metroLine||l.id===state.metroLine);
  for(const line of lines){
    const card=document.createElement('div');card.className='metro-service-card';
    card.style.borderLeftColor=line.color;
    const title=document.createElement('strong');title.textContent=line.name;
    const details=document.createElement('p');const s=line.service;
    details.textContent='Estações: '+line.stations.length+' · Funcionamento habitual: '+line.hours.start+'–'+line.hours.end+
      (s?.typicalHeadwayMinutes!==null&&s?.typicalHeadwayMinutes!==undefined?' · Intervalo divulgado: '+formatHeadway(s.typicalHeadwayMinutes)+' min':' · Intervalo não confirmado');
    const open=document.createElement('small');open.textContent=s?.stationOpenAtTime?'Dentro do horário habitual':'Fora do horário habitual';
    card.append(title,details,open);
    if(s?.note){const note=document.createElement('small');note.textContent=s.note;card.append(note)}
    for(const alert of s?.alerts||[]){const p=document.createElement('p');p.className='metro-alert';p.textContent=alert.text+' ';const a=document.createElement('a');a.href=alert.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Aviso oficial';p.append(a);card.append(p)}
    area.append(card);
  }
}
function bhLocalClock(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
    hour12:false}).formatToParts(date);
  const value=type=>parts.find(x=>x.type===type)?.value;
  const day=value('year')+'-'+value('month')+'-'+value('day');
  const time=value('hour')+':'+value('minute');
  const weekday=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
  return {day,time,weekday};
}
function staticMetroCatalog(raw){
  const {day,time,weekday}=bhLocalClock();
  const now=raw.lines.map(line=>{
    let start=line.hours.start,end=line.hours.end;
    const alerts=[];
    for(const e of raw.operations.hoursExceptions||[]){
      if(e.line===line.id&&e.from<=day&&day<=e.through){
        end=e.end;alerts.push({text:e.note,url:e.url});
      }
    }
    let frequency=null,note='';
    if(line.id==='1'){
      const spec=raw.operations.headways['1'];
      if(weekday<5){
        const peak=spec.weekdays.peakWindows.some(([a,b])=>a<=time&&time<b);
        frequency=peak?spec.weekdays.peakMinutes:spec.weekdays.offPeakMinutes;
      }else if(weekday===5){
        const [a,b]=spec.saturday.morningWindow;
        frequency=a<=time&&time<b?spec.saturday.morningMinutes:spec.saturday.otherMinutes;
      }else frequency=spec.sundayAndHolidays.minutes;
    }else note='Intervalo não confirmado. Consulte a concessionária.';
    for(const e of raw.operations.exceptional||[]){
      if(e.line===line.id&&e.from<=day&&day<=e.through&&time>=e.after){
        frequency=e.headwayMinutes;alerts.push({text:e.note,url:e.url});
      }
    }
    const open=start<=time&&time<end;
    return {...line,service:{
      lineId:line.id,stationHours:{start,end},stationOpenAtTime:open,
      typicalHeadwayMinutes:open?frequency:null,
      note,realtimeAvailable:false,alerts,
      frequencyOnly:true,predictionType:'frequency'
    }};
  });
  return {...raw,lines:now,fareBRL:raw.operations.fareBRL};
}
function distanceCoords(a,b){
  const r=Math.PI/180;
  const x=(b[0]-a[0])*r,y=(b[1]-a[1])*r;
  const v=Math.sin(x/2)**2+Math.cos(a[0]*r)*Math.cos(b[0]*r)*Math.sin(y/2)**2;
  return Math.round(12742000*Math.asin(Math.min(1,Math.sqrt(Math.max(0,v)))));
}
async function loadMetro(){
  let metro=isStaticOnly
    ?staticMetroCatalog(await (await fetch('./catalog/metro.json',{cache:'force-cache'})).json())
    :await api('/api/metro');
  state.metro=metro;
  renderMetroStations();renderMetroService();drawSoon();
  const fare=document.createElement('p');fare.className='hint';fare.textContent='Tarifa divulgada: R$ '+Number(metro.fareBRL).toFixed(2).replace('.',',')+' · confirme condições e integrações na operadora.';$('metroService').append(fare);
  $('metroPlanned').textContent='Estações futuras, ainda sem operação: '+
    (metro.lines.find(l=>l.id==='2')?.plannedStations||[]).join(', ')+'.';
}
function showMetroLine(id){
  state.metroLine=id;
  state.selectedMetroStation='';
  $('metroDetail').hidden=true;
  renderMetroStations();renderMetroService();drawSoon();
  if(!state.metro)return;
  const lines=state.metro.lines.filter(l=>!id||l.id===id);
  const ids=new Set(lines.flatMap(l=>l.stations));
  const points=state.metro.stations.filter(s=>ids.has(s.id)).map(s=>[s.lat,s.lng]);
  if(points.length>1){fitCoordinates(points);drawSoon();scheduleMapStops()}
}
async function focusMetroStation(id){
  const s=metroStationById(id);if(!s)return;
  state.selectedMetroStation=id;state.center=[s.lat,s.lng];state.zoom=Math.max(15.5,state.zoom);
  switchTab('metro',true);drawSoon();scheduleMapStops();renderMetroStations();
  const area=$('metroDetail');area.hidden=false;area.textContent='Consultando estação…';
  const detail=isStaticOnly?
    {...s,services:s.lines.map(n=>state.metro.lines.find(l=>l.id===n)?.service).filter(Boolean),
     busStops:[]}:
    await api('/api/metro/station?id='+encodeURIComponent(id));
  if(state.selectedMetroStation!==id)return;
  area.replaceChildren();
  const h=document.createElement('h2');h.textContent=detail.name;area.append(h);
  const label=document.createElement('p');label.className='info-small';
  label.textContent='Em operação · '+detail.lines.map(n=>'Linha '+n).join(' / ')+(detail.interchange?' · Integração entre linhas':'');
  area.append(label);
  const forecast=document.createElement('a');
  forecast.className='metro-forecast-link';
  forecast.href=detail.officialForecastUrl||'https://www.metrobh.com.br/va-de-metro/';
  forecast.target='_blank';forecast.rel='noopener noreferrer';
  forecast.textContent=detail.officialForecastUrl?'Consultar previsões oficiais desta estação ↗':'Consultar operação no site do Metrô BH ↗';
  area.append(forecast);
  for(const service of detail.services){
    const p=document.createElement('p');p.className='info-small';
    p.textContent='Linha '+service.lineId+': funcionamento habitual '+service.stationHours.start+'–'+service.stationHours.end+
       (service.typicalHeadwayMinutes!=null?' · intervalo divulgado '+formatHeadway(service.typicalHeadwayMinutes)+' min':' · sem intervalo confirmado');
    area.append(p);
    for(const alert of service.alerts||[]){const n=document.createElement('p');n.className='metro-alert';n.textContent=alert.text;area.append(n)}
  }
  const note=document.createElement('p');note.className='hint';note.textContent='Não exibimos tempo de chegada dos trens sem fonte pública verificável. Pontos abaixo estão próximos em linha reta — não representam acesso caminhável.';area.append(note);
  const heading=document.createElement('h3');heading.textContent='Pontos de ônibus próximos';area.append(heading);
  if(!detail.busStops.length){const p=document.createElement('p');p.className='muted-empty';p.textContent='Nenhum ponto do catálogo de ônibus em até 650 m em linha reta.';area.append(p)}
  for(const stop of detail.busStops){
    const b=document.createElement('button');b.className='row-item';b.type='button';
    const name=document.createElement('span');name.className='name';name.textContent=stop.name;
    const dist=document.createElement('small');dist.textContent=stop.distanceM+' m em linha reta';
    name.append(dist);b.append(name);b.onclick=()=>focusStop(stop);area.append(b);
  }
  try{$('body').scrollTo({top:0,behavior:'smooth'})}catch(e){}
}
async function loadMetroNearby(lat,lng){
  const data=isStaticOnly
    ?{items:state.metro.stations.map(s=>({...s,distanceM:distanceCoords([lat,lng],[s.lat,s.lng])}))
       .filter(s=>s.distanceM<=4000).sort((a,b)=>a.distanceM-b.distanceM).slice(0,12)}
    :await api('/api/metro/nearby?lat='+encodeURIComponent(lat)+'&lng='+encodeURIComponent(lng));
  const area=$('metroNearby');area.replaceChildren();
  const h=document.createElement('h3');h.textContent='Estações próximas';area.append(h);
  if(!data.items?.length){const p=document.createElement('p');p.className='muted-empty';p.textContent='Nenhuma estação num raio de 4 km.';area.append(p);return}
  for(const s of data.items)area.append(metroStationRow(s,s.distanceM+' m em linha reta'));
}
$('metroSearch').addEventListener('input',renderMetroStations);
$('metroLineSelect').addEventListener('change',e=>showMetroLine(e.target.value));
$('metroNearMe').onclick=()=>{if(state.userPosition){loadMetroNearby(...state.userPosition).catch(reportError)}else{switchTab('metro',true);askLocation()}};
setInterval(()=>{if(!document.hidden)loadMetro().catch(e=>console.warn('Metrô indisponível',e))},300000);


// Notícias RSS oficiais — sem declarar que qualquer notícia é uma ocorrência ativa.
let lastMetroNewsAt=0;
async function loadMetroNews(){
  if(isStaticOnly){
    const area=$('metroNews');area.replaceChildren();
    const link=document.createElement('a');link.className='metro-news';
    link.href='https://www.metrobh.com.br/';link.target='_blank';
    link.rel='noopener noreferrer';
    link.textContent='Consultar comunicados recentes diretamente no Metrô BH';
    area.append(link);
    return;
  }
  if(Date.now()-lastMetroNewsAt<15*60*1000)return;
  lastMetroNewsAt=Date.now();
  let data;
  try{data=await api('/api/metro/news')}catch(e){lastMetroNewsAt=0;throw e}
  const area=$('metroNews');area.replaceChildren();
  if(!data.items?.length){
    const p=document.createElement('p');p.className='muted-empty';
    p.textContent='Comunicados indisponíveis. Consulte o site oficial do Metrô BH.';area.append(p);
  }else for(const item of data.items){
    const a=document.createElement('a');a.className='metro-news';a.href=item.url;
    a.target='_blank';a.rel='noopener noreferrer';
    const b=document.createElement('b');b.textContent=item.title;
    a.append(b);area.append(a);
  }
  if(data.status!=='ok'){
    const p=document.createElement('p');p.className='hint';
    p.textContent='Consulta de notícias indisponível ou desatualizada; confira os comunicados diretamente com a operadora.';area.append(p);
  }
}



// P5 — viagens GTFS. Nenhum GPS é apresentado como ETA de viagem individual.
function routeClock(date){
  return new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',
    timeZone:'America/Sao_Paulo'}).format(new Date(date));
}
function initRouteDate(){
  const now=new Date();
  $('routeDate').value=new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',
    timeZone:'America/Sao_Paulo'}).format(now);
  $('routeTime').value=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false,
    timeZone:'America/Sao_Paulo'}).format(now);
}
function routeStatus(message,kind='info'){
  $('routePlanStatus').textContent=message;
  $('routePlanStatus').dataset.status=kind;
}
function routeInput(which){return $(which==='origin'?'routeOriginInput':'routeDestinationInput')}
function routeCandidates(which){return $(which==='origin'?'routeOriginResults':'routeDestinationResults')}
function setRoutePoint(which,point){
  invalidateRouteResults();
  const lat=Number(point.lat),lng=Number(point.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
  const normalized={lat,lng,label:String(point.label||'Local no mapa')};
  if(which==='origin')state.routeOrigin=normalized;
  else state.routeDestination=normalized;
  routeInput(which).value=normalized.label;
  routeCandidates(which).replaceChildren();
  routeStatus('Locais selecionados. Escolha o horário e pressione Encontrar trajetos.');
  drawSoon();
}
// P7: calculate all bus itineraries locally. Static GTFS, no paid backend.
let freeWorker=null,freeInit=null,freeInitResolve=null,freeInitReject=null;
let freeSeq=0,freeCallbacks=new Map();
const freeBase=new URL('./catalog/scan/',location.href).href;
function ensureFreeWorker(){
  if(freeInit)return freeInit;
  if(typeof Worker==='undefined')return Promise.reject(Error('Este navegador não suporta Web Workers.'));
  freeInit=new Promise((resolve,reject)=>{freeInitResolve=resolve;freeInitReject=reject});
  freeWorker=new Worker(new URL('./route-worker.js',location.href));
  freeWorker.onmessage=event=>{
    const msg=event.data||{};
    if(msg.kind==='ready'){
      if(freeInitResolve){freeInitResolve(msg);freeInitResolve=null;freeInitReject=null}
      return;
    }
    const call=freeCallbacks.get(msg.seq);
    if(msg.kind==='progress'){
      if(call?.type==='plan')routeStatus('Buscando conexões GTFS no dispositivo: '+
        msg.done+'/'+msg.total+' faixas de horário · '+msg.scanned.toLocaleString('pt-BR')+
        ' conexões verificadas…');
      return;
    }
    if(msg.kind==='error'){
      if(freeInitReject){freeInitReject(Error(msg.message));freeInitResolve=null;freeInitReject=null}
      if(call){freeCallbacks.delete(msg.seq);call.reject(Error(msg.message))}
      return;
    }
    if((msg.kind==='result'||msg.kind==='places')&&call){
      freeCallbacks.delete(msg.seq);call.resolve(msg);
    }
  };
  freeWorker.onerror=event=>{
    const error=Error(event.message||'Falha no motor local de rotas');
    if(freeInitReject)freeInitReject(error);
    freeInitReject=null;freeInitResolve=null;
    for(const call of freeCallbacks.values())call.reject(error);
    freeCallbacks.clear();freeInit=null;
    freeWorker?.terminate();freeWorker=null;
  };
  freeWorker.postMessage({kind:'init',seq:++freeSeq,baseUrl:freeBase});
  return freeInit;
}
function invalidateRouteResults(){
  cancelFreeCalls();
  state.routeResults=[];state.routeSelected=0;
  $('routeResults').replaceChildren();
  $('routeMetroHints').replaceChildren();
  drawSoon();
}
function cancelFreeCalls(){
  if(!freeCallbacks.size)return;
  const seq=++freeSeq;
  for(const call of freeCallbacks.values())call.reject(Error('Consulta substituída'));
  freeCallbacks.clear();
  if(freeWorker)freeWorker.postMessage({kind:'cancel',seq});
  $('routeSubmit').disabled=false;
}
async function freeCall(kind,props={}){
  await ensureFreeWorker();
  cancelFreeCalls();
  return new Promise((resolve,reject)=>{
    const seq=++freeSeq;
    freeCallbacks.set(seq,{resolve,reject,type:kind});
    freeWorker.postMessage({kind,seq,baseUrl:freeBase,...props});
  });
}
async function searchRoutePlace(which){
  const q=routeInput(which).value.trim(),area=routeCandidates(which);
  if(q.length<2){routeStatus('Digite pelo menos 2 caracteres de um ponto ou estação.','warn');return}
  const coords=q.match(/^(-?\d{1,2}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)$/);
  if(coords){
    setRoutePoint(which,{lat:Number(coords[1]),lng:Number(coords[2]),label:'Coordenadas: '+q});return;
  }
  area.textContent='Procurando pontos e estações no catálogo…';
  try{
    const result=await freeCall('places',{which,query:q});
    area.replaceChildren();
    if(!result.items?.length){
      area.textContent='Não localizado no catálogo. Use Escolher no mapa para marcar um endereço.';
      return;
    }
    for(const p of result.items){
      const b=document.createElement('button');b.type='button';b.className='row-item';
      b.textContent=p.label;b.onclick=()=>setRoutePoint(which,p);area.append(b);
    }
  }catch(e){if(e.message!=='Consulta substituída')
    area.textContent='Busca local indisponível: '+e.message+' — use o mapa.'}
}
function pickRoutePlace(which){
  state.routePick=which;switchTab('rotas',false);closeSheet();
  routeStatus('Toque no mapa para marcar '+(which==='origin'?'a origem.':'o destino.'));
  $('mapToast').textContent='Toque no mapa para definir '+(which==='origin'?'a origem':'o destino');
}
function useRouteLocation(){
  if(!window.isSecureContext||!navigator.geolocation){
    routeStatus('Geolocalização exige HTTPS ou localhost; escolha a origem no mapa.','warn');return}
  routeStatus('Aguardando autorização de localização…');
  navigator.geolocation.getCurrentPosition(p=>{
    const pt={lat:p.coords.latitude,lng:p.coords.longitude,label:'Minha localização'};
    state.userPosition=[pt.lat,pt.lng];setRoutePoint('origin',pt);
    state.center=[pt.lat,pt.lng];state.zoom=15;drawSoon();scheduleMapStops();
  },()=>routeStatus('Localização não autorizada. Você pode buscar o endereço ou selecionar no mapa.','warn'),
  {enableHighAccuracy:false,timeout:12000,maximumAge:60000});
}
function routeWhenChanged(){
  invalidateRouteResults();
  const now=$('routeWhen').value==='now',arrive=$('routeWhen').value==='arriveBy';
  $('routeDatetime').hidden=now;$('routeBufferLabel').hidden=!arrive;
}
async function submitRoute(){
  const origin=state.routeOrigin,destination=state.routeDestination;
  if(!origin||!destination){routeStatus('Escolha a origem e o destino nos resultados de endereço ou no mapa.','warn');return}
  const when=$('routeWhen').value;
  let at;
  if(when!=='now'){
    const date=$('routeDate').value,time=$('routeTime').value;
    if(!date||!time){routeStatus('Informe data e horário válidos.','warn');return}
    const dt=new Date(date+'T'+time+':00-03:00');
    if(!Number.isFinite(dt.getTime())){routeStatus('Data ou horário inválidos.','warn');return}
    if(when==='arriveBy')dt.setTime(dt.getTime()-Number($('routeBuffer').value)*60000);
    at=dt.toISOString();
  }
  const btn=$('routeSubmit');btn.disabled=true;
  routeStatus('Calculando viagens a partir dos horários GTFS…');
  $('routeResults').replaceChildren();$('routeMetroHints').replaceChildren();
  try{
    const response=await freeCall('plan',{params:{origin,destination,
      mode:when==='arriveBy'?'arriveBy':'departAt',
      at:when==='now'?undefined:at,
      preference:$('routePreference').value}});
    const data=response.data;
    state.routeResults=data.itineraries||[];state.routeSelected=0;
    renderRouteResults(data);
  }catch(e){
    if(e.message!=='Consulta substituída')
      routeStatus('Falha ao calcular rotas neste dispositivo: '+e.message,'warn');
  }finally{btn.disabled=false}
}
function renderRouteResults(data){
  const area=$('routeResults');area.replaceChildren();
  const rail=$('routeMetroHints');rail.replaceChildren();
  if(data.status==='not_ready'){
    routeStatus('O catálogo detalhado de viagens ainda não está instalado. Execute a geração oficial no GitHub.','warn');
  }else if(data.status==='out_of_calendar'){
    routeStatus(data.message+' Válido de '+data.validFrom+' até '+data.validThrough+'.','warn');
  }else if(data.status==='walking_unavailable'){
    routeStatus('O roteador de ruas não confirmou uma caminhada viável. Nenhuma conexão não verificada foi apresentada.','warn');
  }else if(!data.itineraries?.length){
    routeStatus('Nenhum trajeto de ônibus encontrado nesta janela. Experimente outro horário, origem ou destino.','warn');
  }else{
    routeStatus((data.status==='partial'?'Busca limitada: não garante a opção globalmente ótima. ':'')+
      data.itineraries.length+' itinerário(s) programado(s). '+(
       data.pedestrianRouting==='osm_real_graph'
       ?'Conexões pedestres calculadas na rede OSM. Trechos de acesso às vias podem não estar mapeados.'
       :'Caminhadas aproximadas; os percursos pelas ruas ainda não foram verificados.'),
      data.status==='partial'?'warn':'info');
  }
  for(const [index,trip] of (data.itineraries||[]).entries()){
    const container=document.createElement('div');container.className='route-result';
    if(index===state.routeSelected)container.classList.add('selected');
    const select=document.createElement('button');select.type='button';select.className='route-summary';
    const clock=document.createElement('strong');
    clock.textContent=routeClock(trip.departure)+' → '+routeClock(trip.arrival)+' · '+trip.durationMinutes+' min';
    const detail=document.createElement('small');
    const buses=trip.legs.filter(x=>x.mode==='bus');
    const verified=trip.confidence==='GTFS_scheduled_and_OSM_footpaths'||
                   trip.confidence==='scheduled_gtfs_with_osm_pedestrian_paths';
    detail.textContent=buses.map(x=>x.line).join(' + ')+' · '+trip.walkMetersApprox+
      (verified?' m a pé (vias OSM)':' m a pé (aprox.)')+' · '+trip.transfers+' baldeação(ões)';
    select.append(clock,detail);
    select.onclick=()=>{state.routeSelected=index;renderRouteResults(data);focusSelectedRoute(trip)};
    container.append(select);
    if(index===state.routeSelected){
      const legs=document.createElement('div');legs.className='route-legs';
      for(const leg of trip.legs){
        const item=document.createElement('div');item.className='route-leg';
        const icon=document.createElement('span');icon.className='route-leg-icon';icon.textContent=leg.mode==='bus'?'🚌':'🚶';
        const txt=document.createElement('span');txt.className='route-leg-body';
        const title=document.createElement('strong');
        if(leg.mode==='bus'){
          title.textContent='Linha '+leg.line+(leg.headsign?' · '+leg.headsign:'');
          const desc=document.createElement('small');
          desc.textContent=routeClock(leg.departure)+' — '+leg.fromName+' → '+
                           routeClock(leg.arrival)+' — '+leg.toName;
          txt.append(title,desc);
        }else{
          title.textContent='Caminhada '+(leg.pathVerified?'':'≈ ')+leg.metersApprox+' m';
          const desc=document.createElement('small');
          desc.textContent=(leg.from==='origin'?'Origem':leg.from==='destination'?'Destino':
                            leg.fromName||'Ponto '+leg.from)+' → '+
                           (leg.to==='destination'?'Destino':leg.to==='origin'?'Origem':
                            leg.toName||'Ponto '+leg.to)+
                           (leg.pathVerified?' · via rede pedestre OSM':' · percurso pelas ruas ainda não verificado');
          txt.append(title,desc);
        }
        item.append(icon,txt);legs.append(item);
      }
      container.append(legs);
    }
    area.append(container);
  }
  if(data.metroHints?.length){
    const h=document.createElement('h3');h.textContent='Possibilidades com metrô (sem horário calculado)';
    rail.append(h);
    for(const hint of data.metroHints){
      const card=document.createElement('div');card.className='metro-hint';
      const strong=document.createElement('strong');strong.textContent='Linha '+hint.line+
        ': '+hint.fromStation+' → '+hint.toStation;
      const p=document.createElement('p');p.textContent='Passa por '+hint.stationCount+
        ' trecho(s) entre estações. Frequência e horários de partida ainda não validados para esta viagem; não comparável às opções de ônibus.';
      card.append(strong,p);rail.append(card);
    }
  }
  if(data.itineraries?.length)focusSelectedRoute(data.itineraries[0]);
}
function focusSelectedRoute(itinerary){
  if(!itinerary)return;
  const coords=[state.routeOrigin,state.routeDestination].filter(Boolean)
     .map(p=>[p.lat,p.lng]);
  for(const leg of itinerary.legs){
    if(leg.fromCoords)coords.push(leg.fromCoords);
    if(leg.toCoords)coords.push(leg.toCoords);
    if(leg.mode==='walk'&&leg.geometry)coords.push(...leg.geometry);
  }
  if(coords.length>1){fitCoordinates(coords);drawSoon();scheduleMapStops()}
}
function drawRouteLayer(){
  if(activeTab!=='rotas')return;
  const trip=state.routeResults[state.routeSelected];
  if(trip){
    for(const leg of trip.legs){
      if(leg.mode==='walk'&&Array.isArray(leg.geometry)&&leg.geometry.length>1){
        ctx.save();ctx.beginPath();
        leg.geometry.forEach((p,i)=>{const [x,y]=screen(p[0],p[1]);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y)});
        ctx.strokeStyle=leg.pathVerified?'#16866e':'#d09a29';
        ctx.lineWidth=4;ctx.globalAlpha=.9;ctx.stroke();ctx.restore();
        continue;
      }
      if(!leg.fromCoords||!leg.toCoords)continue;
      const [x1,y1]=screen(...leg.fromCoords),[x2,y2]=screen(...leg.toCoords);
      ctx.save();ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);
      ctx.strokeStyle='#1265a8';ctx.lineWidth=4;ctx.setLineDash([8,5]);ctx.globalAlpha=.7;ctx.stroke();ctx.setLineDash([]);
      for(const [x,y] of [[x1,y1],[x2,y2]]){
        ctx.beginPath();ctx.arc(x,y,5,0,2*Math.PI);ctx.fillStyle='#fff';ctx.fill();
        ctx.strokeStyle='#1265a8';ctx.lineWidth=2;ctx.stroke();
      }
      ctx.restore();
    }
  }
  for(const [which,p] of [['origin',state.routeOrigin],['destination',state.routeDestination]]){
    if(!p)continue;
    const [x,y]=screen(p.lat,p.lng);
    ctx.beginPath();ctx.arc(x,y,9,0,2*Math.PI);
    ctx.fillStyle=which==='origin'?'#027a48':'#b42318';ctx.fill();
    ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke();
  }
}
for(const which of ['origin','destination']){
  const id=which==='origin'?'routeOrigin':'routeDestination';
  $(id+'Search').onclick=()=>searchRoutePlace(which);
  $(id+'Map').onclick=()=>pickRoutePlace(which);
  routeInput(which).addEventListener('input',()=>{
    invalidateRouteResults();
    if(which==='origin')state.routeOrigin=null;else state.routeDestination=null;
    routeCandidates(which).replaceChildren();
  });
  routeInput(which).addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();searchRoutePlace(which)}
  });
}
$('routeOriginLocation').onclick=useRouteLocation;
$('routeWhen').onchange=routeWhenChanged;
for(const id of ['routeDate','routeTime','routeBuffer','routePreference']){
  $(id).addEventListener('change',()=>invalidateRouteResults());
}
$('routeSubmit').onclick=submitRoute;
initRouteDate();routeWhenChanged();
// Route calculations use only browser Worker and static data files.
$('quick-rotas').addEventListener('click',()=>{
  ensureFreeWorker().catch(e=>routeStatus('Catálogo estático indisponível: '+e.message,'warn'));
});

// P8: cache only public route archives used by this free-static preview.
if(isStaticOnly&&'serviceWorker' in navigator&&window.isSecureContext){
  const install=()=>navigator.serviceWorker.register('./service-worker.js',{scope:'./'})
    .catch(e=>console.warn('Cache offline opcional indisponível',e));
  if(document.readyState==='complete')install();
  else window.addEventListener('load',install,{once:true});
}
