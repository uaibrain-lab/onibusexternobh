'use strict';
const $=id=>document.getElementById(id);
const state={routes:[],route:null,geometry:null,fleet:null,pattern:'',selectedVehicle:'',
  center:[-19.8695,-43.9675],zoom:15,markers:[],stopMarkers:[],mapStops:[],selectedStop:null,stopCoordinates:null,nearby:[],userPosition:null,tiles:new Map(),frame:0,drag:null};
const $canvas=$('mapCanvas'),ctx=$canvas.getContext('2d');
const MAX_Z=18,MIN_Z=10;
const MOBILE_DPR_CAP=(navigator.deviceMemory&&navigator.deviceMemory<=3)?1.35:1.75;
const TILE_CACHE_LIMIT=(navigator.deviceMemory&&navigator.deviceMemory<=3)?72:120;
function mercator(lat,lng,z){const size=256*2**z;let y=Math.max(-85.0511,Math.min(85.0511,lat));return [(lng+180)/360*size,(1-Math.asinh(Math.tan(y*Math.PI/180))/Math.PI)/2*size]}
function invMercator(x,y,z){const size=256*2**z;const n=Math.PI-2*Math.PI*y/size;return [180/Math.PI*Math.atan(Math.sinh(n)),x/size*360-180]}
function screen(lat,lng){let [cx,cy]=mercator(...state.center,state.zoom),[px,py]=mercator(lat,lng,state.zoom);return [px-cx+$canvas.clientWidth/2,py-cy+$canvas.clientHeight/2]}
function resize(){let dpr=Math.min(window.devicePixelRatio||1,MOBILE_DPR_CAP);$canvas.width=Math.floor($canvas.clientWidth*dpr);$canvas.height=Math.floor($canvas.clientHeight*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);drawSoon();scheduleMapStops()}
function drawSoon(){if(!state.frame)state.frame=requestAnimationFrame(()=>{state.frame=0;draw()})}
function getTile(z,x,y){let n=2**z;if(y<0||y>=n)return null;let key=`${z}/${((x%n)+n)%n}/${y}`;let ent=state.tiles.get(key);if(!ent){let img=new Image();ent={img,ready:false,error:false};state.tiles.set(key,ent);img.onload=()=>{ent.ready=true;drawSoon()};img.onerror=()=>{ent.error=true;drawSoon()};img.src=`https://tile.openstreetmap.org/${z}/${((x%n)+n)%n}/${y}.png`;}if(state.tiles.size>TILE_CACHE_LIMIT+16){for(const k of state.tiles.keys()){if(state.tiles.size<=TILE_CACHE_LIMIT)break;state.tiles.delete(k)}}return ent}
function drawTiles(w,h){let z=Math.floor(state.zoom),scale=2**(state.zoom-z),[cx,cy]=mercator(...state.center,z),tx=cx-w/2/scale,ty=cy-h/2/scale;ctx.fillStyle='#d9e4e4';ctx.fillRect(0,0,w,h);let minx=Math.floor(tx/256)-1,maxx=Math.ceil((tx+w/scale)/256)+1,miny=Math.floor(ty/256)-1,maxy=Math.ceil((ty+h/scale)/256)+1;for(let y=miny;y<=maxy;y++)for(let x=minx;x<=maxx;x++){let px=(x*256-tx)*scale,py=(y*256-ty)*scale,tile=getTile(z,x,y);if(tile&&tile.ready){ctx.drawImage(tile.img,px,py,256*scale+.5,256*scale+.5)}else{ctx.fillStyle=((x+y)&1)?'#e8eeea':'#dfe9e6';ctx.fillRect(px,py,256*scale+.5,256*scale+.5);ctx.strokeStyle='#cddad7';ctx.strokeRect(px,py,256*scale,256*scale)}}}
function draw(){const w=$canvas.clientWidth,h=$canvas.clientHeight;if(!w||!h)return;ctx.clearRect(0,0,w,h);drawTiles(w,h);  state.stopMarkers=[];
  const bucketSize=state.zoom<14?62:state.zoom<15.5?48:state.zoom<17?34:0;
  const buckets=new Map();
  for(const stop of state.mapStops){
    const [x,y]=screen(stop.lat,stop.lng);
    if(x<-20||y<-20||x>w+20||y>h+20)continue;
    if(String(stop.id)===String(state.selectedStop))continue;
    const key=bucketSize?`${Math.floor(x/bucketSize)}:${Math.floor(y/bucketSize)}`:String(stop.id);
    let bucket=buckets.get(key);
    if(!bucket){bucket={x:0,y:0,stops:[]};buckets.set(key,bucket)}
    bucket.x+=x;bucket.y+=y;bucket.stops.push(stop);
  }
  for(const bucket of buckets.values()){
    const x=bucket.x/bucket.stops.length,y=bucket.y/bucket.stops.length,count=bucket.stops.length;
    const grouped=count>1,r=grouped?Math.min(17,11+Math.log2(count)*1.7):state.zoom>=15?6:4;
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fillStyle=grouped?'#e6f4f1':'#fff';ctx.fill();ctx.lineWidth=grouped?2.5:2;
    ctx.strokeStyle=grouped?'#0c7169':'#344054';ctx.stroke();
    if(grouped){ctx.fillStyle='#075f58';ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(count),x,y)}
    state.stopMarkers.push({x,y,stop:bucket.stops[0],cluster:grouped?bucket.stops:null});
  }
  if(state.geometry?.selected){let selected=state.geometry.selected,coords=selected.coordinates;if(coords.length){ctx.beginPath();coords.forEach(([lat,lng],i)=>{let [x,y]=screen(lat,lng);if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.strokeStyle='#0c6e6b';ctx.lineWidth=7;ctx.globalAlpha=.25;ctx.stroke();ctx.lineWidth=3;ctx.strokeStyle='#007f75';ctx.globalAlpha=.9;ctx.stroke();ctx.globalAlpha=1;}for(let s of selected.stops){let [x,y]=screen(s.lat,s.lng);if(x<-10||y<-10||x>w+10||y>h+10)continue;ctx.beginPath();ctx.arc(x,y,state.zoom>=14?3:2,0,Math.PI*2);ctx.fillStyle='#fefefe';ctx.fill();ctx.strokeStyle='#168f83';ctx.lineWidth=1.4;ctx.stroke();state.stopMarkers.push({x,y,stop:s})}}
  state.markers=[];let vehicles=state.fleet?.vehicles||[];for(let v of vehicles){let [x,y]=screen(v.latitude,v.longitude);if(x<-25||y<-25||x>w+25||y>h+25)continue;let changedAge=diffSeconds(v.positionUnchangedSinceAt);let stale=diffSeconds(v.lastGpsFixAt)>120,frozen=changedAge>120;let isSelected=state.selectedVehicle===v.source+'|'+v.vehicleId;ctx.save();ctx.translate(x,y);if(isSelected){ctx.beginPath();ctx.arc(0,0,24,0,Math.PI*2);ctx.fillStyle='#38d5ab44';ctx.fill()}ctx.beginPath();ctx.arc(0,0,13,0,Math.PI*2);ctx.fillStyle=stale?'#a6565d':frozen?'#ad7728':'#136c66';ctx.fill();ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.stroke();ctx.rotate((v.heading||0)*Math.PI/180);ctx.fillStyle='#ffffff';ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(-5,6);ctx.lineTo(0,3);ctx.lineTo(5,6);ctx.closePath();ctx.fill();ctx.restore();state.markers.push({x,y,id:v.source+'|'+v.vehicleId});}
  if(state.stopCoordinates && state.selectedStop){const [sx,sy]=screen(...state.stopCoordinates);ctx.beginPath();ctx.arc(sx,sy,11,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=4;ctx.strokeStyle='#f79009';ctx.stroke();ctx.beginPath();ctx.arc(sx,sy,3,0,Math.PI*2);ctx.fillStyle='#f79009';ctx.fill();}
  if(state.stopCoordinates&&state.selectedStop&&state.selectedVehicle){const v=vehicles.find(x=>x.source+'|'+x.vehicleId===state.selectedVehicle);if(v){const [sx,sy]=screen(...state.stopCoordinates);const [vx,vy]=screen(v.latitude,v.longitude);const area=visibleMapRect(),inView=vx>=area.left&&vx<=area.right&&vy>=area.top&&vy<=area.bottom;ctx.save();ctx.setLineDash([5,7]);ctx.strokeStyle='#0c6e6b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx,sy);if(inView)ctx.lineTo(vx,vy);else{const dx=vx-sx,dy=vy-sy;const tx=dx>0?(area.right-sx)/dx:dx<0?(area.left-sx)/dx:Infinity;const ty=dy>0?(area.bottom-sy)/dy:dy<0?(area.top-sy)/dy:Infinity;const t=Math.max(0,Math.min(tx,ty,1));const ex=sx+dx*t,ey=sy+dy*t;ctx.lineTo(ex,ey);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(ex,ey,14,0,Math.PI*2);ctx.fillStyle='#136c66';ctx.fill();ctx.fillStyle='#fff';ctx.font='16px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('➤',ex,ey);ctx.restore();}if(inView){ctx.stroke();ctx.restore()}}}
  if(state.userPosition){const [x,y]=screen(...state.userPosition);ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fillStyle='#1570ef';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke()}
  $('mapToast').textContent=state.selectedStop&&state.selectedVehicle?`Ponto em destaque · ônibus selecionado`:(state.route?`Linha ${state.route.code} · ${vehicles.length} ônibus`:'Toque em um ponto para ver as chegadas');}

function diffSeconds(iso){if(!iso)return Infinity;let t=Date.parse(iso);return Number.isFinite(t)?Math.max(0,Math.floor((Date.now()-t)/1000)):Infinity}
function fmtAge(n){if(!Number.isFinite(n))return 'desconhecido';if(n<60)return `${n}s`;if(n<3600)return `${Math.floor(n/60)}min ${String(n%60).padStart(2,'0')}s`;return `${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}min`}
function fmtTime(iso){try{return new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(iso))}catch(e){return '—'}}
async function api(path,options={}){const base=location.pathname.startsWith('/externo')?'/externo':'';let r=await fetch(base+path,{cache:'no-store',...options});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json()}
function statusLed(ok,label){$('sourceLed').className='dot '+(ok?'ok':'bad');$('sourceText').textContent=label}
function updateStatus(obj){
  const errors=Object.values(obj.sources||{}).filter(x=>x.lastError);
  const recent=Number(obj.gpsRecent||0)>0;
  statusLed(recent&&!errors.length,errors.length?'Dados parcialmente indisponíveis':recent?'GPS recente disponível':'Sem posições GPS recentes');
}
async function loadRoutes(){try{state.routes=await api('/api/routes')}catch(e){state.routes=[];statusLed(false,'Sem conexão · chegadas indisponíveis')}let dl=$('routeList');dl.innerHTML='';for(let r of state.routes){let op=document.createElement('option');op.value=r.code;op.label=r.name;dl.append(op)}$('lineInput').value='';renderAllLines('');renderFavoriteLines();renderFavoriteStops();try{await loadNearbyStops(-19.8695,-43.9675,false)}catch(e){$('nearbyHint').textContent='Sem conexão. Seus favoritos continuam disponíveis; chegadas exigem internet.';}
  api('/api/status').then(updateStatus).catch(()=>statusLed(false,'Localizações indisponíveis'));
  const point=new URLSearchParams(location.search).get('ponto');
  if(point&&/^[\w-]{1,60}$/.test(point)){
    try{const detail=await api('/api/stop?id='+encodeURIComponent(point));focusStop(detail);openSheet()}
    catch(e){console.warn('Link para ponto indisponível',e)}
  }
}
// O trajeto com mais viagens e a referência inicial; não é confirmação do veículo.
let routeSelectionSeq=0;
const normalizeDestination=s=>String(s||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function itineraryLabel(p, all, primary){
  const destination=p.headsign||'Destino não informado';
  const same=all.filter(x=>normalizeDestination(x.headsign)===normalizeDestination(p.headsign))
                .sort((a,b)=>b.tripCount-a.tripCount);
  const main=same[0]?.id===p.id;
  if(p.id===primary?.id)return 'Mais viagens · '+destination;
  if(normalizeDestination(p.headsign)!==normalizeDestination(primary?.headsign))
    return (main?'Outro sentido · ':'Outro sentido · rota alternativa · ')+destination;
  return 'Rota alternativa · '+destination;
}
async function selectLine(code,{fromStop=false,vehicleKey=null,destination=null}={}){
  const route=state.routes.find(r=>r.code.toUpperCase()===String(code).trim().toUpperCase()
     ||(r.code+' — '+r.name).toUpperCase()===String(code).trim().toUpperCase());
  if(!route){$('lineTitle').textContent='Linha não encontrada';return}
  const seq=++routeSelectionSeq;
  if(!fromStop){state.selectedStop=null;state.stopCoordinates=null;}
  const stop=fromStop&&state.selectedStop?String(state.selectedStop):null;
  state.route=route;state.geometry=null;state.fleet=null;state.pattern='';state.selectedVehicle='';
  $('lineInput').value=route.code;$('lineTitle').textContent=route.name;
  const fav=$('lineFavorite');fav.hidden=false;
  fav.textContent=favorites.routes.includes(route.code)?'★':'☆';
  fav.setAttribute('aria-pressed',String(favorites.routes.includes(route.code)));
  fav.onclick=()=>toggleFavorite('routes',route.code);
  renderFavoriteLines();$('vehicleList').textContent='Carregando ônibus…';
  const query='/api/route?code='+encodeURIComponent(route.code)+(stop?'&stop='+encodeURIComponent(stop):'');
  const [geo,fleet]=await Promise.all([api(query),api('/api/fleet?route='+encodeURIComponent(route.code))]);
  if(seq!==routeSelectionSeq||state.route?.code!==route.code)return;
  state.geometry=geo;state.fleet=fleet;
  const patterns=[...geo.patterns].sort((a,b)=>b.tripCount-a.tripCount);
  const primary=patterns[0];
  const sel=$('patternInput');sel.replaceChildren();
  const none=document.createElement('option');none.value='';none.textContent='Escolher outro percurso';sel.append(none);
  for(const p of patterns){
    const option=document.createElement('option');option.value=p.id;
    option.textContent=itineraryLabel(p,patterns,primary);
    sel.append(option);
  }
  const desired=normalizeDestination(destination);
  const candidate=vehicleKey&&fleet.vehicles.find(v=>v.source+'|'+v.vehicleId===vehicleKey);
  const atStop=stop?patterns.filter(p=>p.servesStop):patterns;
  const matching=desired?atStop.filter(p=>normalizeDestination(p.headsign)===desired):atStop;
  let chosen=null;
  if(stop){
    // Somente um padrão que atende ESTE ponto e ESTE destino é elegível.
    if(matching.length){
      const confirmedShape=candidate?.shapeMatch?.status==='probable'
          ?String(candidate.shapeMatch.shapeId):null;
      chosen=(confirmedShape&&matching.find(p=>String(p.shapeId)===confirmedShape))
          ||matching[0];
    }
  }else{
    chosen=primary;
  }
  renderVehicles();renderStops();drawSoon();
  if(chosen){sel.value=chosen.id;await selectPattern();}
  else{
    sel.value='';state.geometry.selected=null;
    $('patternHint').textContent=stop
       ?'Nenhum percurso com esse destino foi confirmado neste ponto. Escolha outro sentido para consultar.'
       :'Escolha o sentido ou uma rota alternativa.';
  }
  if(seq!==routeSelectionSeq)return;
  if(stop&&state.stopCoordinates){
    if(candidate)focusVehicle(candidate);
    else{centerStopInAvailableMap();drawSoon();scheduleMapStops()}
  }else{
    const first=fleet.vehicles.find(v=>diffSeconds(v.lastGpsFixAt)<=120);
    // A geometria escolhida permanece como referência; não substituir por
    // um veículo de outra variante de itinerário.
    if(!chosen&&first){state.center=[first.latitude,first.longitude];state.zoom=15;drawSoon();scheduleMapStops()}
  }
}
// Keep a selected stop centered in the *visible* map, avoiding the overlaid
// Hub sheet on mobile and desktop. Never zoom out to all of Belo Horizonte.
function visibleMapRect(){const w=$canvas.clientWidth,h=$canvas.clientHeight,r=$('sheet').getBoundingClientRect();if(window.innerWidth>=760){let left=Math.max(20,Math.min(w-120,r.right+14));return {left,top:65,right:w-16,bottom:h-18}}let bottom=Math.max(100,Math.min(h-10,r.top-14));return {left:15,top:70,right:w-15,bottom}}
function centerStopInAvailableMap(){if(!state.stopCoordinates)return;const a=visibleMapRect(),x=(a.left+a.right)/2,y=(a.top+a.bottom)/2;const [px,py]=mercator(...state.stopCoordinates,state.zoom);state.center=invMercator(px-(x-$canvas.clientWidth/2),py-(y-$canvas.clientHeight/2),state.zoom)}
function focusVehicle(v){state.selectedVehicle=v.source+'|'+v.vehicleId;if(state.stopCoordinates&&state.selectedStop){const rect=visibleMapRect(),w=Math.max(130,rect.right-rect.left),h=Math.max(130,rect.bottom-rect.top);let z=16;for(;z>=14.5;z-=0.25){const stop=mercator(...state.stopCoordinates,z),bus=mercator(v.latitude,v.longitude,z);if(Math.abs(stop[0]-bus[0])<w*.40&&Math.abs(stop[1]-bus[1])<h*.40)break;}state.zoom=Math.max(14.5,z);switchTab('pontos',true);centerStopInAvailableMap(); // The selected stop stays in context.
 }else{state.center=[v.latitude,v.longitude];state.zoom=Math.max(state.zoom,15);switchTab('linhas',true)}renderVehicles();drawSoon();scheduleMapStops()}
function vehicleMeta(v){const age=fmtAge(diffSeconds(v.lastGpsFixAt));const since=diffSeconds(v.positionUnchangedSinceAt);return `Última posição há ${age}`+(since>120?` · Sem mudança há ${fmtAge(since)}`:'')}
function vehicleRow(v){let b=document.createElement('button');b.type='button';b.className='vehicle'+(state.selectedVehicle===v.source+'|'+v.vehicleId?' selected':'');b.dataset.vehicleKey=v.source+'|'+v.vehicleId;let top=document.createElement('div');top.className='top';let name=document.createElement('b');name.textContent='Ônibus';let lab=document.createElement('span');lab.className='label';let gpsAge=diffSeconds(v.lastGpsFixAt),stillAge=diffSeconds(v.positionUnchangedSinceAt);if(gpsAge>120)lab.classList.add('old');else if(stillAge>120)lab.classList.add('warn');lab.textContent=gpsAge>300?'Sinal antigo':gpsAge>120?'Sinal atrasado':stillAge>120?'Sem movimento recente':'Localização recente';top.append(name,lab);let m=document.createElement('div');m.className='meta';m.textContent=vehicleMeta(v);m.style.whiteSpace='pre-line';b.append(top,m);b.onclick=()=>focusVehicle(v);return b}
function tickVehicleAges(){let byId=new Map((state.fleet?.vehicles||[]).map(v=>[v.source+'|'+v.vehicleId,v]));for(let node of $('vehicleList').querySelectorAll('.vehicle')){let v=byId.get(node.dataset.vehicleKey);if(v){let m=node.querySelector('.meta');if(m)m.textContent=vehicleMeta(v)}}}
function renderVehicles(){let arr=state.fleet?.vehicles||[];let list=$('vehicleList');list.innerHTML='';if(!arr.length){let p=document.createElement('p');p.className='notice';p.textContent='Nenhum ônibus com localização disponível nesta linha.';list.append(p);return}for(let v of arr.slice(0,200))list.append(vehicleRow(v));}
async function selectPattern(){
  if(!state.route||!state.geometry)return;
  const code=state.route.code,pattern=$('patternInput').value;
  state.pattern=pattern;
  if(!pattern){
    state.geometry.selected=null;
    $('patternHint').textContent='Escolha o sentido ou uma rota alternativa.';
    renderStops();drawSoon();return;
  }
  const p=state.geometry.patterns.find(x=>x.id===pattern);
  $('patternHint').textContent=state.selectedStop&&state.stopCoordinates
    ?'Percurso de referência passando pelo ponto selecionado · toque acima para mudar.'
    :(p?.headsign?'Sentido: '+p.headsign+' · toque acima para mudar.':'Traçado de referência · toque acima para mudar.');
  const geo=await api('/api/route?code='+encodeURIComponent(code)+'&pattern='+encodeURIComponent(pattern));
  if(state.route?.code!==code||state.pattern!==pattern)return;
  if(geo?.selected){
    state.geometry={...state.geometry,selected:geo.selected};
    renderStops();
    if(state.stopCoordinates&&state.selectedStop)centerStopInAvailableMap();
    else fitCoordinates(geo.selected.coordinates);
    drawSoon();scheduleMapStops();
  }
}
function fitCoordinates(coords){if(!coords.length)return;let la=coords.map(p=>p[0]),lo=coords.map(p=>p[1]);let bounds=[Math.min(...la),Math.min(...lo),Math.max(...la),Math.max(...lo)];state.center=[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2];let w=$canvas.clientWidth*.81,h=$canvas.clientHeight*.8;for(let z=17;z>=10;z--){let a=mercator(bounds[0],bounds[1],z),b=mercator(bounds[2],bounds[3],z);if(Math.abs(b[0]-a[0])<=w && Math.abs(b[1]-a[1])<=h){state.zoom=z;break}}}
function zoom(delta,at=null){const old=state.zoom,newZ=Math.max(MIN_Z,Math.min(MAX_Z,old+delta));if(old===newZ)return;let anchor=at||[$canvas.clientWidth/2,$canvas.clientHeight/2];let [cx,cy]=mercator(...state.center,old), world=[cx+anchor[0]-$canvas.clientWidth/2,cy+anchor[1]-$canvas.clientHeight/2];let point=invMercator(...world,old);state.zoom=newZ;let [nx,ny]=mercator(...point,newZ);state.center=invMercator(nx-anchor[0]+$canvas.clientWidth/2,ny-anchor[1]+$canvas.clientHeight/2,newZ);drawSoon();scheduleMapStops()}
$canvas.addEventListener('wheel',e=>{e.preventDefault();let rc=$canvas.getBoundingClientRect();zoom(e.deltaY<0?.5:-.5,[e.clientX-rc.left,e.clientY-rc.top])},{passive:false});
$canvas.addEventListener('pointerdown',e=>{let box=$canvas.getBoundingClientRect();state.drag={x:e.clientX,y:e.clientY,moved:false,at:[e.clientX-box.left,e.clientY-box.top]};$canvas.setPointerCapture(e.pointerId);$canvas.classList.add('dragging')});
$canvas.addEventListener('pointermove',e=>{if(!state.drag)return;let dx=e.clientX-state.drag.x,dy=e.clientY-state.drag.y;if(Math.abs(dx)+Math.abs(dy)>3)state.drag.moved=true;let [cx,cy]=mercator(...state.center,state.zoom);state.center=invMercator(cx-dx,cy-dy,state.zoom);state.drag.x=e.clientX;state.drag.y=e.clientY;drawSoon()});
$canvas.addEventListener('pointerup',e=>{const drag=state.drag;state.drag=null;$canvas.classList.remove('dragging');if(drag?.moved){scheduleMapStops();return}if(!drag)return;let p=drag.at, near=state.markers.map(m=>({...m,d:Math.hypot(m.x-p[0],m.y-p[1])})).sort((a,b)=>a.d-b.d)[0];if(near&&near.d<20){const v=(state.fleet?.vehicles||[]).find(x=>x.source+'|'+x.vehicleId===near.id);if(v)focusVehicle(v);return}let stop=state.stopMarkers.map(m=>({...m,d:Math.hypot(m.x-p[0],m.y-p[1])})).sort((a,b)=>a.d-b.d)[0];if(stop&&stop.d<28){
    if(stop.cluster){
      state.center=[stop.cluster.reduce((a,s)=>a+s.lat,0)/stop.cluster.length,stop.cluster.reduce((a,s)=>a+s.lng,0)/stop.cluster.length];
      state.zoom=Math.min(17.25,state.zoom+1.25);drawSoon();scheduleMapStops();
    }else focusStop(stop.stop);
    return
  }});
$('zoomIn').onclick=()=>zoom(1);$('zoomOut').onclick=()=>zoom(-1);
// Recenter prefers an actual position, never labels the UFMG fallback as the user.
$('recenter').onclick=()=>{
  const focus=(pos,personal)=>{state.center=pos;state.zoom=personal?15.5:15;drawSoon();scheduleMapStops();loadNearbyStops(...pos,personal).catch(reportError)};
  const fallback=()=>{if(state.userPosition)focus(state.userPosition,true);else focus([-19.8695,-43.9675],false)};
  if(!window.isSecureContext||!navigator.geolocation){fallback();return}
  navigator.geolocation.getCurrentPosition(p=>{
    state.userPosition=[p.coords.latitude,p.coords.longitude];
    $('recenter').title='Minha localização';
    $('recenter').setAttribute('aria-label','Centralizar na minha localização');
    focus(state.userPosition,true)
  },fallback,{enableHighAccuracy:false,maximumAge:30000,timeout:10000});
};
$('goLine').onclick=()=>selectLine($('lineInput').value).catch(reportError);$('lineInput').onkeydown=e=>{if(e.key==='Enter')$('goLine').click()};$('patternInput').onchange=()=>selectPattern().catch(reportError);
$('refresh').onclick=()=>refresh().catch(reportError);
function reportError(e){console.error(e);statusLed(false,'Erro ao consultar dados');$('mapToast').textContent=`Não foi possível atualizar: ${e.message}`}
async function refresh(){if(document.hidden)return;if(!state.route)return;const code=state.route.code;let [fleet,status]=await Promise.all([api('/api/fleet?route='+encodeURIComponent(code)),api('/api/status')]);if(state.route?.code!==fleet.line)return;state.fleet=fleet;updateStatus(status);renderVehicles();drawSoon()}
// Interface compartilhada com o padrão visual do Hub UFMG / Interno.
let activeTab='pontos';
function openSheet(full=false){const sheet=$('sheet');sheet.classList.remove('peek');sheet.classList.toggle('full',!!full);$('sheet-toggle').setAttribute('aria-expanded','true');$('grab').setAttribute('aria-expanded','true');$('body').setAttribute('aria-hidden','false')}
function closeSheet(){const sheet=$('sheet');sheet.classList.add('peek');sheet.classList.remove('full');$('sheet-toggle').setAttribute('aria-expanded','false');$('grab').setAttribute('aria-expanded','false');$('body').setAttribute('aria-hidden','true')}
function switchTab(tab,open=false){activeTab=tab;const pts=tab==='pontos';$('pontosPane').hidden=!pts;$('linhasPane').hidden=pts;$('quick-pontos').classList.toggle('on',pts);$('quick-linhas').classList.toggle('on',!pts);$('quick-pontos').setAttribute('aria-pressed',String(pts));$('quick-linhas').setAttribute('aria-pressed',String(!pts));if(open)openSheet()}
function renderStops(){const el=$('stopList');el.textContent='';const stops=state.geometry?.selected?.stops||[];$('pontosHelp').textContent=stops.length?`${stops.length} paradas no trajeto`:'Selecione uma linha para ver suas paradas.';if(!stops.length){const b=document.createElement('button');b.type='button';b.className='row-item';b.textContent='Escolher linha e percurso';b.onclick=()=>switchTab('linhas',true);el.append(b);return}for(let [i,s] of stops.entries()){const b=document.createElement('button');b.type='button';b.className='row-item';b.dataset.stopId=s.id;const num=document.createElement('span');num.className='num';num.textContent=String(i+1);const text=document.createElement('span');text.className='name';const name=document.createElement('b');name.textContent=s.name;const meta=document.createElement('small');meta.textContent='Ponto '+(i+1)+' · toque para localizar';text.append(name,meta);b.append(num,text);b.onclick=()=>focusStop(s);el.append(b)}}
function focusStop(stop){state.selectedStop=String(stop.id);updatePointLink(state.selectedStop);state.stopCoordinates=[Number(stop.lat),Number(stop.lng)];state.selectedVehicle="";state.center=[Number(stop.lat),Number(stop.lng)];state.zoom=Math.max(state.zoom,16);switchTab('pontos',true);centerStopInAvailableMap();$('body').scrollTo({top:0,behavior:'smooth'});for(let node of $('stopList').querySelectorAll('[data-stop-id]'))node.classList.toggle('selected',node.dataset.stopId===String(stop.id));drawSoon();scheduleMapStops();openStopDetail(state.selectedStop).catch(reportError)}
function renderAllLines(query){const el=$('allLineList');el.textContent='';let arr=state.routes||[];const q=String(query||'').trim().toLocaleLowerCase('pt-BR');if(q)arr=arr.filter(x=>(x.code+' '+x.name).toLocaleLowerCase('pt-BR').includes(q));let limited=q?arr.slice(0,80):[];for(let r of limited){const wrap=document.createElement('div');wrap.className='fav-row';const b=document.createElement('button');b.type='button';b.className='row-item';const n=document.createElement('span');n.className='num';n.textContent=r.code;const t=document.createElement('span');t.className='name';const title=document.createElement('b');title.textContent=r.name||'Sem descrição';t.append(title);b.append(n,t);b.onclick=()=>selectLine(r.code).then(()=>{openSheet();$('body').scrollTo({top:0,behavior:'smooth'})}).catch(reportError);wrap.append(b,starButton('routes',r.code));el.append(wrap)}if(q&&arr.length>limited.length){const msg=document.createElement('p');msg.className='muted info-small';msg.textContent='Refine a busca para ver mais linhas.';el.append(msg)}}
let stopSearchSeq=0;
async function searchAllStops(query){const seq=++stopSearchSeq;const el=$('stopSearchResult');el.textContent='';const q=String(query||'').trim();if(q.length<2)return;try{const data=await api('/api/stops?q='+encodeURIComponent(q));if(seq!==stopSearchSeq)return;const stops=data.items||[];if(!stops.length){const m=document.createElement('p');m.className='muted info-small';m.textContent='Nenhum ponto localizado.';el.append(m);return}for(const stop of stops){const b=document.createElement('button');b.type='button';b.className='row-item';const badge=document.createElement('span');badge.className='num';badge.textContent='●';const name=document.createElement('span');name.className='name';const title=document.createElement('b');title.textContent=stop.name;const subtitle=document.createElement('small');subtitle.textContent='Localizar no mapa';name.append(title,subtitle);b.append(badge,name);b.onclick=()=>focusStop(stop);el.append(b)}if(data.truncated){const m=document.createElement('p');m.className='muted info-small';m.textContent='Exibindo os primeiros pontos; refine sua busca.';el.append(m)}}catch(e){if(seq===stopSearchSeq){el.textContent='Não foi possível buscar os pontos.';console.error(e)}}}
let stopSearchTimer;
$('stopInput').addEventListener('input',e=>{clearTimeout(stopSearchTimer);stopSearchTimer=setTimeout(()=>searchAllStops(e.target.value),220)});
$('allLineSearch').addEventListener('input',e=>renderAllLines(e.target.value));
$('quick-pontos').onclick=()=>switchTab('pontos',true);
$('quick-linhas').onclick=()=>switchTab('linhas',true);
$('sheet-toggle').onclick=()=>{$('sheet').classList.contains('peek')?openSheet():closeSheet()};
// Swipe only on the handle: do not interfere with scrolling the list or map.
let sheetDrag=null,skipSheetClick=false;
const grab=$('grab');
grab.addEventListener('pointerdown',e=>{
  if(innerWidth>=760||!e.isPrimary)return;
  const sheet=$('sheet');
  sheetDrag={pointerId:e.pointerId,startY:e.clientY,startHeight:sheet.getBoundingClientRect().height,moved:false};
  grab.setPointerCapture(e.pointerId);
});
grab.addEventListener('pointermove',e=>{
  if(!sheetDrag||sheetDrag.pointerId!==e.pointerId)return;
  const dy=sheetDrag.startY-e.clientY;
  if(Math.abs(dy)<8&&!sheetDrag.moved)return;
  sheetDrag.moved=true;
  const sheet=$('sheet');
  sheet.classList.remove('peek');
  sheet.style.transition='none';
  sheet.style.height=Math.max(82,Math.min(innerHeight*.82,sheetDrag.startHeight+dy))+'px';
  $('body').setAttribute('aria-hidden','false');
});
function finishSheetSwipe(e){
  if(!sheetDrag||sheetDrag.pointerId!==e.pointerId)return;
  const moved=sheetDrag.moved, h=$('sheet').getBoundingClientRect().height;
  sheetDrag=null;
  const sheet=$('sheet');sheet.style.height='';sheet.style.transition='';
  if(!moved)return;
  skipSheetClick=true;
  // Suppress the synthetic click fired after a touch drag.
  if(h<(82+Math.min(innerHeight*.42,360))/2)closeSheet();
  else if(h>(Math.min(innerHeight*.42,360)+innerHeight*.82)/2)openSheet(true);
  else openSheet(false);
}
grab.addEventListener('pointerup',finishSheetSwipe);
grab.addEventListener('pointercancel',finishSheetSwipe);
grab.onclick=()=>{if(skipSheetClick){skipSheetClick=false;return}sheetDrag=null;$('sheet').classList.contains('peek')?openSheet():closeSheet()};
function askLocation(){hideLocationPrompt();if(!window.isSecureContext||!navigator.geolocation){$('nearbyHint').textContent='Localização requer HTTPS ou localhost. Mostrando pontos próximos à UFMG.';openSheet();return}navigator.geolocation.getCurrentPosition(async p=>{const lat=p.coords.latitude,lng=p.coords.longitude;state.userPosition=[lat,lng];$('recenter').title='Minha localização';$('recenter').setAttribute('aria-label','Centralizar na minha localização');state.center=[lat,lng];state.zoom=15.5;drawSoon();scheduleMapStops();try{await loadNearbyStops(lat,lng,true);switchTab('pontos',true)}catch(e){reportError(e)}},()=>{$('nearbyHint').textContent='Localização não autorizada. Você ainda pode buscar pontos no mapa da UFMG.';openSheet()},{enableHighAccuracy:false,timeout:12000,maximumAge:60000})}
$('loc').onclick=askLocation;$('allowLocation').onclick=askLocation;$('skipLocation').onclick=hideLocationPrompt;
function hideLocationPrompt(){$('locationPrompt').hidden=true;try{sessionStorage.setItem('bh-externo-location-intro-seen','yes')}catch(e){}}
try{if(sessionStorage.getItem('bh-externo-location-intro-seen')==='yes')hideLocationPrompt()}catch(e){}

// Quando incorporado pelo Hub (mesma origem), o tema acompanha o contêiner.
try{if(window.parent!==window){const theme=window.parent.document.documentElement.dataset.theme;if(theme==='dark'||theme==='light')document.documentElement.dataset.theme=theme}}catch(e){}
window.addEventListener('message',e=>{if(e.origin!==location.origin)return;if(e.data?.type==='hub-theme'&&['dark','light'].includes(e.data.theme))document.documentElement.dataset.theme=e.data.theme});

// P3: ponto-first map, location-aware suggestions, favorites and scheduled arrivals.
const FAVORITES_KEY='hubufmg-externo-favorites-v1';
function readFavorites(){try{const o=JSON.parse(localStorage.getItem(FAVORITES_KEY)||'{}');return {stops:Array.isArray(o.stops)?o.stops.map(String):[],routes:Array.isArray(o.routes)?o.routes.map(String):[],aliases:o.aliases&&typeof o.aliases==='object'&&!Array.isArray(o.aliases)?o.aliases:{},names:o.names&&typeof o.names==='object'&&!Array.isArray(o.names)?o.names:{}}}catch(e){return {stops:[],routes:[],aliases:{},names:{}}}}
let favorites=readFavorites();
function saveFavorites(){try{localStorage.setItem(FAVORITES_KEY,JSON.stringify(favorites))}catch(e){console.warn('Favoritos apenas nesta sessão',e)}}
function favoriteTitle(kind,id,name){return favorites.aliases[kind+':'+id]||name|| (kind==='stops'?'Ponto favorito':String(id))}
function renameFavorite(kind,id,title){
  const dlg=document.createElement('dialog');dlg.className='fav-dialog';
  const form=document.createElement('form');form.method='dialog';
  const h=document.createElement('h2');h.textContent='Nome do favorito';
  const input=document.createElement('input');input.type='text';input.maxLength=50;input.required=true;
  input.value=favorites.aliases[kind+':'+id]||title||'';input.setAttribute('aria-label','Nome do favorito');
  const actions=document.createElement('div');actions.className='fav-dialog-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancelar';cancel.onclick=()=>dlg.close();
  const save=document.createElement('button');save.type='submit';save.textContent='Salvar';save.className='btn';
  form.append(h,input,actions);actions.append(cancel,save);dlg.append(form);document.body.append(dlg);
  dlg.addEventListener('close',()=>dlg.remove(),{once:true});
  form.onsubmit=e=>{e.preventDefault();const name=input.value.trim();if(!name)return;
    favorites.aliases[kind+':'+id]=name;saveFavorites();renderFavoriteStops();renderFavoriteLines();dlg.close()};
  if(typeof dlg.showModal==='function'){dlg.showModal();input.focus();input.select()}else{dlg.remove()}
}
function editFavoriteButton(kind,id,title){const b=document.createElement('button');b.type='button';b.className='fav-edit';b.textContent='✎';
  b.title='Renomear favorito';b.setAttribute('aria-label','Renomear '+title);b.onclick=()=>renameFavorite(kind,id,title);return b}

function toggleFavorite(kind,id){id=String(id);let arr=favorites[kind];favorites[kind]=arr.includes(id)?arr.filter(v=>v!==id):[...arr,id];saveFavorites();renderFavoriteStops();renderFavoriteLines();if(state.route){$('lineFavorite').textContent=favorites.routes.includes(state.route.code)?'★':'☆';$('lineFavorite').setAttribute('aria-pressed',String(favorites.routes.includes(state.route.code)))}if(state.selectedStop)renderStopFavoriteButton()}
function starButton(kind,id){let b=document.createElement('button');b.type='button';b.className='fav-btn';const current=favorites[kind].includes(String(id));b.textContent=current?'★':'☆';b.title=current?'Remover favorito':'Adicionar aos favoritos';b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(current));b.onclick=e=>{e.stopPropagation();toggleFavorite(kind,id)};return b}
let mapStopsTimer=0,mapStopsSeq=0,mapStopsController=null,mapStopsCoverage=null;
function scheduleMapStops(){
  clearTimeout(mapStopsTimer);
  const seq=++mapStopsSeq;
  // An old view must not overwrite the current one after rapid panning.
  if(mapStopsController){mapStopsController.abort();mapStopsController=null;}
  mapStopsTimer=setTimeout(()=>loadMapStops(seq),220);
}
async function loadMapStops(seq=mapStopsSeq){
  if(state.zoom<12.5){state.mapStops=[];mapStopsCoverage=null;drawSoon();return}
  const w=$canvas.clientWidth,h=$canvas.clientHeight;
  if(!w||!h||document.hidden)return;
  const [cx,cy]=mercator(...state.center,state.zoom);
  // Viewport plus a buffer: short pans reuse already loaded stops.
  const visSW=invMercator(cx-w*.51,cy+h*.51,state.zoom);
  const visNE=invMercator(cx+w*.51,cy-h*.51,state.zoom);
  const visible=[visSW[0],visSW[1],visNE[0],visNE[1]];
  if(mapStopsCoverage&&!mapStopsCoverage.truncated){
    const box=mapStopsCoverage.bounds;
    if(visible[0]>=box[0]&&visible[1]>=box[1]&&visible[2]<=box[2]&&visible[3]<=box[3])return;
  }
  const a=invMercator(cx-w*.82,cy+h*.82,state.zoom);
  const b=invMercator(cx+w*.82,cy-h*.82,state.zoom);
  const bounds=[a[0],a[1],b[0],b[1]];
  const controller=new AbortController();mapStopsController=controller;
  const url=`/api/map-stops?minlat=${bounds[0]}&minlng=${bounds[1]}&maxlat=${bounds[2]}&maxlng=${bounds[3]}`;
  try{
    const data=await api(url,{signal:controller.signal});
    if(seq!==mapStopsSeq||controller.signal.aborted)return;
    state.mapStops=data.items||[];
    mapStopsCoverage={bounds,truncated:!!data.truncated};
    drawSoon();
  }catch(e){if(e.name!=='AbortError')console.warn('Paradas do mapa indisponíveis',e)}
  finally{if(mapStopsController===controller)mapStopsController=null}
}
async function loadNearbyStops(lat,lng,personal){let data=await api(`/api/nearby-stops?lat=${lat}&lng=${lng}`);state.nearby=data.items||[];$('nearbyHeading').textContent=personal?'Pontos perto de você':'Pontos próximos à UFMG';$('nearbyHint').textContent=personal?'Distâncias aproximadas; sua localização não é armazenada no servidor.':'Sem localização, exibimos os pontos próximos ao campus UFMG.';renderNearbyStops()}
function renderNearbyStops(){const area=$('nearbyStops');area.replaceChildren();for(const stop of state.nearby){let b=document.createElement('button');b.type='button';b.className='row-item';const n=document.createElement('span');n.className='num';n.textContent='●';const txt=document.createElement('span');txt.className='name';let t=document.createElement('b');t.textContent=stop.name;let d=document.createElement('small');d.textContent=`A ${stop.distanceM} m · ver linhas e chegadas`;txt.append(t,d);b.append(n,txt);b.onclick=()=>focusStop(stop);area.append(b)}if(!state.nearby.length){let e=document.createElement('p');e.className='muted-empty';e.textContent='Nenhum ponto encontrado neste raio.';area.append(e)}}
const favoritePreviewCache=new Map();
function favoritePreview(id){
  const cached=favoritePreviewCache.get(id);
  if(cached&&Date.now()-cached.when<35000)return Promise.resolve(cached.text);
  if(cached?.pending)return cached.pending;
  const pending=api('/api/stop?id='+encodeURIComponent(id)).then(data=>{
    const next=data.routes.filter(r=>r.nextArrival).slice(0,2);
    const text=next.length?next.map(r=>{
      const arrival=r.nextArrival;
      return r.code+' '+(arrival.type==='gps_estimate'?'≈ ':'')+arrival.minutes+' min';
    }).join(' · '):'Sem chegadas próximas';
    favoritePreviewCache.set(id,{when:Date.now(),text});return text;
  }).catch(()=>{
    const text='Chegadas indisponíveis';favoritePreviewCache.set(id,{when:Date.now(),text});return text;
  });
  favoritePreviewCache.set(id,{when:Date.now(),pending});return pending;
}
function renderFavoriteStops(){
  const area=$('favoriteStops');area.replaceChildren();
  if(!favorites.stops.length){let p=document.createElement('p');p.className='muted-empty';p.textContent='Nenhum ponto favorito ainda.';area.append(p);return}
  for(const [index,id] of favorites.stops.entries()){
    const wrap=document.createElement('div');wrap.className='fav-row';
    const found=state.nearby.find(s=>String(s.id)===id)||state.mapStops.find(s=>String(s.id)===id);
    const name=found?.name||favorites.names[id]||'';
    const b=document.createElement('button');b.type='button';b.className='row-item favorite-stop';
    const title=document.createElement('b');title.textContent=favoriteTitle('stops',id,name);
    const next=document.createElement('small');next.className='favorite-next';
    next.textContent=favoritePreviewCache.get(id)?.text||'Consultando chegadas…';
    b.append(title,next);
    if(index<5)favoritePreview(id).then(value=>{if(next.isConnected)next.textContent=value});
    else next.textContent='Toque para ver chegadas';
    b.onclick=async()=>{if(found){focusStop(found)}else{try{const detail=await api('/api/stop?id='+encodeURIComponent(id));focusStop(detail)}catch(e){reportError(e)}}};
    wrap.append(b,editFavoriteButton('stops',id,name),starButton('stops',id));area.append(wrap);
  }
}
function renderFavoriteLines(){
  const area=$('favoriteLines');area.replaceChildren();
  if(!favorites.routes.length){let p=document.createElement('p');p.className='muted-empty';p.textContent='Nenhuma linha favorita ainda.';area.append(p);return}
  for(const code of favorites.routes){
    const route=state.routes.find(r=>r.code===code),base=route?`${route.code} — ${route.name}`:code;
    const wrap=document.createElement('div');wrap.className='fav-row';
    const b=document.createElement('button');b.type='button';b.className='row-item';b.textContent=favoriteTitle('routes',code,base);
    b.onclick=()=>selectLine(code).catch(reportError);
    wrap.append(b,editFavoriteButton('routes',code,base),starButton('routes',code));area.append(wrap)
  }
}
let stopDetailSeq=0;
function closeStopDetail(){
  stopDetailSeq++;
  state.selectedStop=null;
  state.stopCoordinates=null;
  state.selectedVehicle='';
  updatePointLink(null);
  $('stopDetail').hidden=true;
  $('stopDetail').replaceChildren();
  $('pontosPane').classList.remove('has-open-stop');
  renderFavoriteStops();
  drawSoon();
}
function updatePointLink(id){
  try{const u=new URL(location.href);if(id)u.searchParams.set('ponto',id);else u.searchParams.delete('ponto');
    history.replaceState(history.state,'',u.pathname+u.search+u.hash)}catch(e){}
}
function makeShareButton(stop){
  const b=document.createElement('button');b.type='button';b.className='stop-action';
  b.textContent='↗';b.title='Compartilhar ponto';b.setAttribute('aria-label','Compartilhar link do ponto');
  b.onclick=async()=>{
    const u=new URL(location.href);u.searchParams.set('ponto',String(stop.id));
    try{
      if(navigator.share){await navigator.share({title:stop.name,url:u.href});return}
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(u.href);b.textContent='✓';b.setAttribute('aria-label','Link copiado');setTimeout(()=>{b.textContent='↗'},2500);return}
    }catch(e){if(e.name==='AbortError')return}
    const t=document.createElement('textarea');t.value=u.href;t.style.position='fixed';t.style.left='-9999px';document.body.append(t);t.select();
    try{if(document.execCommand('copy')){b.textContent='✓';setTimeout(()=>b.textContent='↗',2500)}else{b.textContent='Link';b.title=u.href}}finally{t.remove()}
  };
  return b;
}
function renderStopFavoriteButton(){const area=$('stopDetail');if(!state.selectedStop)return;const current=area.querySelector('.stop-head .fav-btn');if(current){current.replaceWith(starButton('stops',state.selectedStop))}}
async function openStopDetail(id,silent=false){const seq=++stopDetailSeq;const area=$('stopDetail');area.hidden=false;$('pontosPane').classList.add('has-open-stop');if(!silent){area.replaceChildren();let message=document.createElement('p');message.className='muted-empty';message.textContent='Consultando linhas e horários desta parada…';area.append(message)}let data=await api('/api/stop?id='+encodeURIComponent(id));if(seq!==stopDetailSeq||String(state.selectedStop)!==String(id))return;
if(favorites.stops.includes(String(id))&&favorites.names[id]!==data.name){favorites.names[id]=data.name;saveFavorites()}
area.replaceChildren();const head=document.createElement('div');head.className='stop-head';const text=document.createElement('div');let title=document.createElement('h2');title.textContent=data.name;const small=document.createElement('small');small.textContent='Próximas chegadas';text.append(title,small);const back=document.createElement('button');back.type='button';back.className='stop-back';back.textContent='‹';back.setAttribute('aria-label','Voltar para pontos');back.onclick=closeStopDetail;head.append(back,text,makeShareButton(data),starButton('stops',data.id));area.append(head);
if(!data.routes.length){let p=document.createElement('p');p.className='muted-empty';p.textContent='Nenhuma linha vinculada a este ponto na versão atual do GTFS.';area.append(p)}
for(const r of data.routes){const b=document.createElement('button');b.type='button';b.className='route-arrival';const n=document.createElement('span');n.className='num';n.textContent=r.code;const label=document.createElement('span');label.className='arrival-info';const name=document.createElement('b');name.textContent=r.destination||r.nextArrival?.destination||r.name;const sub=document.createElement('small');sub.textContent=(r.destination?'Sentido / destino · '+r.name:r.name)+(r.nextArrival?.type==='gps_estimate'?' · ver ônibus no mapa':'');label.append(name,sub);const eta=document.createElement('span');eta.className='eta';if(r.nextArrival){eta.textContent=r.nextArrival.type==='gps_estimate'?`≈ ${r.nextArrival.minutes} min`:(r.nextArrival.minutes<=0?'Agora':`${r.nextArrival.minutes} min`);const when=document.createElement('small');when.textContent=r.nextArrival.type==='gps_estimate'?'Estimativa GPS':'Tabela · '+fmtTime(r.nextArrival.at).slice(0,5);eta.append(when);
  if(r.nextArrival.type==='scheduled'&&r.nextArrival.following?.length){
    const extra=document.createElement('small');extra.className='arrival-following';
    extra.textContent='Depois: '+r.nextArrival.following.map(x=>fmtTime(x.at).slice(0,5)).join(' · ');
    eta.append(extra)
  }
  if(r.nextArrival.type==='scheduled'&&r.nextArrival.lastTripToday){
    const last=document.createElement('small');last.className='arrival-last';last.textContent='Última de hoje';eta.append(last)
  }
}else{eta.textContent='—';const status=document.createElement('small');status.textContent='Sem previsão';eta.append(status)}b.append(n,label,eta);b.onclick=async()=>{const gps=r.nextArrival?.type==='gps_estimate'&&r.nextArrival.vehicleId;const key=gps?r.nextArrival.vehicleSource+'|'+r.nextArrival.vehicleId:null;if(!gps)switchTab('linhas',true);try{await selectLine(r.code,{fromStop:true,vehicleKey:key,destination:r.destination||r.nextArrival?.destination});if(!gps)switchTab('linhas',true)}catch(e){reportError(e)}};area.append(b)}
if(data.alternatives?.length){
  const alt=document.createElement('details');alt.className='stop-alternatives';
  const summary=document.createElement('summary');summary.textContent='Outros pontos próximos';alt.append(summary);
  const explanation=document.createElement('p');explanation.className='stop-forecast-note';
  explanation.textContent='Algumas linhas têm destinos diferentes em pontos próximos. Confira o sentido antes de embarcar.';alt.append(explanation);
  for(const nearby of data.alternatives){
    const button=document.createElement('button');button.type='button';button.className='row-item';
    button.textContent=nearby.name+' · '+nearby.distanceM+' m';button.onclick=()=>focusStop(nearby);alt.append(button);
  }
  area.append(alt);
}
const note=document.createElement('p');note.className='stop-forecast-note';note.textContent=data.routes.some(r=>r.nextArrival?.type==='gps_estimate')?'≈ GPS estimado. Outros horários seguem a tabela.':(data.timetableAvailable?'Horários da tabela; podem variar.':'Sem horários disponíveis.');area.append(note);renderFavoriteStops();drawSoon()}

switchTab('pontos');renderStops();
window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{if(!document.hidden){drawSoon();scheduleMapStops();refresh().catch(reportError)}});
resize();loadRoutes().catch(reportError);setInterval(()=>{if(document.hidden)return;tickVehicleAges();if(state.fleet?.vehicles?.length)drawSoon()},15000);setInterval(()=>refresh().catch(reportError),35000);setInterval(()=>{if(!document.hidden&&state.selectedStop)openStopDetail(state.selectedStop,true).catch(reportError)},35000);

// P8 PWA: cache only the static app shell, never GPS APIs or map tiles.
if('serviceWorker' in navigator && (location.protocol==='https:' || ['localhost','127.0.0.1'].includes(location.hostname))
   && location.pathname.startsWith('/externo')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(e=>console.info('PWA indisponível',e)));
}
