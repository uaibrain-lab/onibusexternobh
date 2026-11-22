'use strict';
const isStaticOnly=document.documentElement.dataset.appMode==='free-static';
const $=id=>document.getElementById(id);
const state={routes:[],route:null,geometry:null,fleet:null,pattern:'',selectedVehicle:'',
  center:[-19.8695,-43.9675],zoom:15,markers:[],stopMarkers:[],mapStops:[],selectedStop:null,stopCoordinates:null,nearby:[],userPosition:null,tiles:new Map(),frame:0,drag:null,
  metro:null,metroMarkers:[],metroVisible:false,metroLine:'',selectedMetroStation:'',
  routeOrigin:null,routeDestination:null,routePick:null,routeResults:[],routeSelected:0};
const $canvas=$('mapCanvas'),ctx=$canvas.getContext('2d');
const MAX_Z=18,MIN_Z=10;
// Keep the basemap responsive on long sessions and low-memory devices.
// A missing tile-cache constant previously raised ReferenceError inside
// drawTiles(), leaving the map frozen on "Carregando mapa".
const TILE_CACHE_LIMIT=120;
function mercator(lat,lng,z){const size=256*2**z;let y=Math.max(-85.0511,Math.min(85.0511,lat));return [(lng+180)/360*size,(1-Math.asinh(Math.tan(y*Math.PI/180))/Math.PI)/2*size]}
function invMercator(x,y,z){const size=256*2**z;const n=Math.PI-2*Math.PI*y/size;return [180/Math.PI*Math.atan(Math.sinh(n)),x/size*360-180]}
function screen(lat,lng){let [cx,cy]=mercator(...state.center,state.zoom),[px,py]=mercator(lat,lng,state.zoom);return [px-cx+$canvas.clientWidth/2,py-cy+$canvas.clientHeight/2]}
function resize(){let dpr=Math.min(window.devicePixelRatio||1,(navigator.deviceMemory&&navigator.deviceMemory<=3)?1.35:1.75);$canvas.width=Math.floor($canvas.clientWidth*dpr);$canvas.height=Math.floor($canvas.clientHeight*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);drawSoon();scheduleMapStops()}
function drawSoon(){
  if(state.frame)return;
  state.frame=requestAnimationFrame(()=>{
    state.frame=0;
    try{
      draw();
      $('map').dataset.renderStatus='ready';
    }catch(error){
      // A single rendering bug must never leave "Carregando mapa" forever.
      $('map').dataset.renderStatus='error';
      $('mapToast').textContent='Mapa temporariamente indisponível. Consulte pontos e linhas pelo painel.';
      console.error('Falha ao renderizar mapa',error);
    }
  });
}
let basemapFailures=0;
function getTile(z,x,y){
  const n=2**z;
  if(y<0||y>=n)return null;
  const key=`${z}/${((x%n)+n)%n}/${y}`;
  let ent=state.tiles.get(key);
  if(!ent){
    const img=new Image();
    ent={img,ready:false,error:false};
    state.tiles.set(key,ent);
    img.onload=()=>{
      ent.ready=true;basemapFailures=0;
      $('mapBasemapNotice').hidden=true;drawSoon();
    };
    img.onerror=()=>{
      ent.error=true;
      if(++basemapFailures>=2)$('mapBasemapNotice').hidden=false;
      drawSoon();
    };
    img.src=`https://tile.openstreetmap.org/${z}/${((x%n)+n)%n}/${y}.png`;
  }
  if(state.tiles.size>TILE_CACHE_LIMIT+16){
    for(const k of state.tiles.keys()){
      if(state.tiles.size<=TILE_CACHE_LIMIT)break;
      state.tiles.delete(k);
    }
  }
  return ent;
}
function drawTiles(w,h){let z=Math.floor(state.zoom),scale=2**(state.zoom-z),[cx,cy]=mercator(...state.center,z),tx=cx-w/2/scale,ty=cy-h/2/scale;const dark=document.documentElement.dataset.theme==='dark';ctx.fillStyle=dark?'#28323c':'#d9e4e4';ctx.fillRect(0,0,w,h);let minx=Math.floor(tx/256)-1,maxx=Math.ceil((tx+w/scale)/256)+1,miny=Math.floor(ty/256)-1,maxy=Math.ceil((ty+h/scale)/256)+1;for(let y=miny;y<=maxy;y++)for(let x=minx;x<=maxx;x++){let px=(x*256-tx)*scale,py=(y*256-ty)*scale,tile=getTile(z,x,y);if(tile&&tile.ready){ctx.drawImage(tile.img,px,py,256*scale+.5,256*scale+.5)}else{ctx.fillStyle=dark?(((x+y)&1)?'#33404d':'#2c3742'):(((x+y)&1)?'#e8eeea':'#dfe9e6');ctx.fillRect(px,py,256*scale+.5,256*scale+.5);ctx.strokeStyle=dark?'#3b4650':'#cddad7';ctx.strokeRect(px,py,256*scale,256*scale)}}}
// Miniônibus visto de cima: o GPS informa posição e, quando disponível, direção.
// Não extrapola sentido do trajeto nem transforma horário de tabela em ETA.
function drawMiniBus(x,y,heading,condition='recent',selected=false,scale=1){
  ctx.save();
  ctx.translate(x,y);
  if(Number.isFinite(heading))ctx.rotate(heading*Math.PI/180);
  ctx.scale(scale,scale);
  if(selected){
    ctx.beginPath();ctx.arc(0,0,23,0,Math.PI*2);
    ctx.fillStyle='rgba(12,153,119,.20)';ctx.fill();
  }
  const bodyColor=condition==='stale'?'#a85862':
    condition==='paused'?'#b37b31':'#087a69';
  ctx.fillStyle='#263840';
  ctx.fillRect(-12,-9,3,7);ctx.fillRect(9,-9,3,7);
  ctx.fillRect(-12,7,3,6);ctx.fillRect(9,7,3,6);
  ctx.beginPath();
  ctx.moveTo(-7,-16);ctx.quadraticCurveTo(-10,-16,-10,-12);
  ctx.lineTo(-10,12);ctx.quadraticCurveTo(-10,16,-7,16);
  ctx.lineTo(7,16);ctx.quadraticCurveTo(10,16,10,12);
  ctx.lineTo(10,-12);ctx.quadraticCurveTo(10,-16,7,-16);
  ctx.closePath();
  ctx.shadowColor='rgba(0,0,0,.28)';ctx.shadowBlur=5;ctx.shadowOffsetY=2;
  ctx.fillStyle=bodyColor;ctx.fill();
  ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
  // Frente na parte superior do símbolo, alinhada ao heading verdadeiro.
  ctx.fillStyle='#d4f4ef';ctx.fillRect(-7,-11,14,7);
  ctx.fillStyle='#b7d6d2';ctx.fillRect(-7,1,14,5);
  ctx.fillStyle='#edf9f5';ctx.fillRect(-6,9,12,3);
  ctx.fillStyle='#ffe7a1';ctx.fillRect(-8,-14,4,2);ctx.fillRect(4,-14,4,2);
  ctx.restore();
}
function draw(){const w=$canvas.clientWidth,h=$canvas.clientHeight;if(!w||!h)return;ctx.clearRect(0,0,w,h);drawTiles(w,h);state.stopMarkers=[];
  const bucketSize=state.zoom<14?62:state.zoom<15.5?48:state.zoom<17?34:0;
  const buckets=new Map();
  // A selected line must not display unrelated stops, even while
  // asynchronous viewport stop lookups are still resolving.
  for(const stop of (lineMode()?[]:state.mapStops)){
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
if(state.geometry?.selected&&lineMode()){let selected=state.geometry.selected,coords=selected.coordinates;if(coords.length){ctx.beginPath();coords.forEach(([lat,lng],i)=>{let [x,y]=screen(lat,lng);if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.strokeStyle='#0c6e6b';ctx.lineWidth=7;ctx.globalAlpha=.25;ctx.stroke();ctx.lineWidth=3;ctx.strokeStyle='#007f75';ctx.globalAlpha=.9;ctx.stroke();ctx.globalAlpha=1;}for(let s of selected.stops){let [x,y]=screen(s.lat,s.lng);if(x<-10||y<-10||x>w+10||y>h+10)continue;ctx.beginPath();ctx.arc(x,y,state.zoom>=14?3:2,0,Math.PI*2);ctx.fillStyle='#fefefe';ctx.fill();ctx.strokeStyle='#168f83';ctx.lineWidth=1.4;ctx.stroke();state.stopMarkers.push({x,y,stop:s})}}
  drawMetroLayer();
  drawRouteLayer();
  state.markers=[];
  let vehicles=state.fleet?.vehicles||[];
  for(const v of vehicles){
    const [x,y]=screen(v.latitude,v.longitude);
    if(x<-28||y<-28||x>w+28||y>h+28)continue;
    const changedAge=diffSeconds(v.positionUnchangedSinceAt);
    const stale=diffSeconds(v.lastGpsFixAt)>120;
    const frozen=Boolean(v.positionUnchangedSinceAt)&&changedAge>120;
    const isSelected=state.selectedVehicle===v.source+'|'+v.vehicleId;
    const heading=v.heading!==null&&v.heading!==undefined&&
      Number.isFinite(Number(v.heading))?Number(v.heading):null;
    drawMiniBus(x,y,heading,stale?'stale':frozen?'paused':'recent',isSelected);
    state.markers.push({x,y,id:v.source+'|'+v.vehicleId});
  }
  const highlightedLineStop=lineMode()&&lineFocusStopId
    ?state.geometry?.selected?.stops?.find(s=>String(s.id)===String(lineFocusStopId))
    :null;
  const highlightedStop=highlightedLineStop
    ?[Number(highlightedLineStop.lat),Number(highlightedLineStop.lng)]
    :(!lineMode()&&state.stopCoordinates&&state.selectedStop?state.stopCoordinates:null);
  if(highlightedStop){const [sx,sy]=screen(...highlightedStop);ctx.beginPath();ctx.arc(sx,sy,11,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=4;ctx.strokeStyle='#f79009';ctx.stroke();ctx.beginPath();ctx.arc(sx,sy,3,0,Math.PI*2);ctx.fillStyle='#f79009';ctx.fill();}
  if(highlightedStop&&state.selectedVehicle){const v=vehicles.find(x=>x.source+'|'+x.vehicleId===state.selectedVehicle);if(v){const [sx,sy]=screen(...highlightedStop);const [vx,vy]=screen(v.latitude,v.longitude);const area=visibleMapRect(),inView=vx>=area.left&&vx<=area.right&&vy>=area.top&&vy<=area.bottom;ctx.save();ctx.setLineDash([5,7]);ctx.strokeStyle='#0c6e6b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx,sy);if(inView)ctx.lineTo(vx,vy);else{const dx=vx-sx,dy=vy-sy;const tx=dx>0?(area.right-sx)/dx:dx<0?(area.left-sx)/dx:Infinity;const ty=dy>0?(area.bottom-sy)/dy:dy<0?(area.top-sy)/dy:Infinity;const t=Math.max(0,Math.min(tx,ty,1));const ex=sx+dx*t,ey=sy+dy*t;ctx.lineTo(ex,ey);ctx.stroke();ctx.setLineDash([]);drawMiniBus(ex,ey,v.heading,'recent',false,.8);ctx.restore();}if(inView){ctx.stroke();ctx.restore()}}}
  if(state.userPosition){const [x,y]=screen(...state.userPosition);ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fillStyle='#1570ef';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#fff';ctx.stroke()}
  $('mapToast').textContent=activeTab==='rotas'
    ?'Rotas · ônibus em horários GTFS; traços esquemáticos; caminhada aproximada'
    :state.metroVisible&&state.metro
    ?'Metrô · linhas esquemáticas e estações em operação · sem previsão GPS dos trens'
    :state.route?`${state.fleet?.available?(vehicles.length?vehicles.length+' posição(ões) GPS observada(s)':'Sem posições GPS recentes'):'GPS indisponível'} · Linha ${state.route.code} · ${state.geometry?.selected?'Traçado de referência':'Escolha um percurso para vê-lo'}`
    :`${state.mapStops.length} pontos no mapa · toque em um ponto para ver linhas e chegadas`;}

function diffSeconds(iso){if(!iso)return Infinity;let t=Date.parse(iso);return Number.isFinite(t)?Math.max(0,Math.floor((Date.now()-t)/1000)):Infinity}
function fmtAge(n){if(!Number.isFinite(n))return 'desconhecido';if(n<60)return `${n}s`;if(n<3600)return `${Math.floor(n/60)}min ${String(n%60).padStart(2,'0')}s`;return `${Math.floor(n/3600)}h ${Math.floor(n%3600/60)}min`}
function fmtTime(iso){try{return new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(iso))}catch(e){return '—'}}
async function api(path,options={}){
  if(isStaticOnly){
    if(typeof StaticBus==='undefined')throw Error('Catálogo estático não carregado');
    return StaticBus.api(path);
  }
  const base=location.pathname.startsWith('/externo')?'/externo':'';
  let r=await fetch(base+path,{cache:'no-store',...options});
  if(!r.ok)throw Error(`HTTP ${r.status}`);
  return r.json();
}
function statusLed(health,label){
  $('sourceLed').className='dot'+(health===true?' ok':health===false?' bad':'');
  $('sourceText').textContent=label;
}
function updateStatus(obj){
  state.lastBusStatus=obj;
  if(activeTab==='metro')return;
  if(isStaticOnly){
    const recent=Number(obj?.gpsRecent||0);
    if(recent>0)statusLed(obj?.partial?null:true,obj?.partial?'GPS parcialmente disponível · horários de tabela nos pontos':'GPS oficial recente · horários de tabela nos pontos');
    else if(obj?.available)statusLed(null,'GPS sem posições recentes · horários de tabela');
    else statusLed(null,'GTFS · horários programados, GPS indisponível');
    const sumob=Boolean(obj?.sources?.GTFS_RT);
    $('lastPoll').textContent=recent>0
      ?(sumob?'Posições oficiais SUMOB · CC BY 4.0 · sem ETA validado':'Posições oficiais PBH · sem ETA validado')
      :(obj?.available
        ?(sumob?'SUMOB sem posições recentes desta linha · horários programados':'GPS sem posições recentes · horários programados')
        :'GTFS programado · GPS opcional não disponível');
    return;
  }
  const errors=Object.values(obj?.sources||{}).filter(x=>x?.lastError);
  const recent=Number(obj?.gpsRecent||0)>0;
  if(recent&&!errors.length)statusLed(true,'GPS recente disponível');
  else if(recent)statusLed(null,'GPS parcialmente disponível');
  else if(obj?.gpsUpdating)statusLed(null,'Buscando localização dos ônibus…');
  else statusLed(false,errors.length?'GPS temporariamente indisponível':'Sem GPS recente · horários da tabela');
  $('lastPoll').textContent=obj?.gpsUpdating?'Buscando posições em segundo plano…':
    recent?'Posições GPS recentes':'Horários da tabela GTFS';
}
async function loadRoutes(){state.routes=await api('/api/routes');let dl=$('routeList');dl.innerHTML='';for(let r of state.routes){let op=document.createElement('option');op.value=r.code;op.label=r.name;dl.append(op)}$('lineInput').value='';renderAllLines('');renderFavoriteLines();renderFavoriteStops();await loadNearbyStops(-19.8695,-43.9675,false)}
// O trajeto com mais viagens e a referência inicial; não é confirmação do veículo.
let routeSelectionSeq=0;
// Line tracking is a temporary map layer, never a permanent selection.
// Keep the exact previous viewport and point detail when entering from Pontos.
let lineMapSession=null,lineFocusStopId=null,lineStopForecastSeq=0;
function lineMode(){return activeTab==='linhas'&&Boolean(state.route)}
function restoreLineMapSession(){
  if(!lineMapSession)return;
  const previous=lineMapSession;lineMapSession=null;
  routeSelectionSeq++;lineStopForecastSeq++;
  state.route=null;state.geometry=null;state.fleet=null;state.pattern='';
  state.selectedVehicle='';lineFocusStopId=null;
  state.center=[...previous.center];state.zoom=previous.zoom;
  $('lineTitle').textContent='Selecione uma linha';
  $('lineInput').value='';$('lineFavorite').hidden=true;$('lineExit').hidden=true;
  $('lineStopChooser').hidden=true;$('lineStopSelect').replaceChildren();
  $('lineStopForecast').textContent='';
  $('vehicleList').textContent='Selecione uma linha.';
  $('vTotal').textContent='—';$('vRecent').textContent='—';
  renderStops();drawSoon();scheduleMapStops();
}
function exitLineTracking(){
  const back=lineMapSession?.tab==='pontos'?'pontos':'linhas';
  restoreLineMapSession();
  switchTab(back,true);
}
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
  if(!lineMapSession)lineMapSession={
    tab:activeTab,center:[...state.center],zoom:state.zoom,
    stopId:state.selectedStop||null
  };
  const stop=fromStop&&state.selectedStop?String(state.selectedStop):null;
  lineFocusStopId=stop;
  state.route=route;state.geometry=null;state.fleet=null;state.pattern='';state.selectedVehicle='';
  $('lineExit').hidden=false;
  $('lineExit').textContent=lineMapSession.tab==='pontos'?'Voltar ao ponto':'Fechar linha';
  // All selected-route map stops belong to this line; other stops are hidden.
  // The previously open point detail is preserved for the return action.
  switchTab('linhas',true);
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
  if(isStaticOnly)updateStatus(await api('/api/status'));
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
    $('lineStopChooser').hidden=true;
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
    // Standalone line search focuses the nearest stop on the selected
    // itinerary when a location permission was previously granted.
    // Otherwise the user can choose the boarding stop via lineStopSelect.
    if(!chosen)drawSoon();
  }
}
function visibleMapRect(){const w=$canvas.clientWidth,h=$canvas.clientHeight,r=$('sheet').getBoundingClientRect();if(window.innerWidth>=760){let left=Math.max(20,Math.min(w-120,r.right+14));return {left,top:65,right:w-16,bottom:h-18}}let bottom=Math.max(100,Math.min(h-10,r.top-14));return {left:15,top:70,right:w-15,bottom}}
function centerStopInAvailableMap(){if(!state.stopCoordinates)return;const a=visibleMapRect(),x=(a.left+a.right)/2,y=(a.top+a.bottom)/2;const [px,py]=mercator(...state.stopCoordinates,state.zoom);state.center=invMercator(px-(x-$canvas.clientWidth/2),py-(y-$canvas.clientHeight/2),state.zoom)}
function focusVehicle(v){state.selectedVehicle=v.source+'|'+v.vehicleId;if(lineMode()&&lineFocusStopId&&state.geometry?.selected?.stops?.some(s=>String(s.id)===String(lineFocusStopId))){const target=state.geometry.selected.stops.find(s=>String(s.id)===String(lineFocusStopId));const saved=state.stopCoordinates;state.stopCoordinates=[Number(target.lat),Number(target.lng)];const rect=visibleMapRect(),w=Math.max(130,rect.right-rect.left),h=Math.max(130,rect.bottom-rect.top);let z=16;for(;z>=14.5;z-=0.25){const stop=mercator(...state.stopCoordinates,z),bus=mercator(v.latitude,v.longitude,z);if(Math.abs(stop[0]-bus[0])<w*.40&&Math.abs(stop[1]-bus[1])<h*.40)break;}state.zoom=Math.max(14.5,z);centerStopInAvailableMap();state.stopCoordinates=saved; // Stay in tracking layer.
 }else{state.center=[v.latitude,v.longitude];state.zoom=Math.max(state.zoom,15);switchTab('linhas',true)}renderVehicles();drawSoon();scheduleMapStops()}
function vehicleMeta(v){let match=v.shapeMatch||{};let shape=match.status==='probable'?`Traçado provável ${match.shapeId} (não confirmado)`:'Traçado ainda indeterminado';const movement=v.positionUnchangedSinceAt?`Posição sem mudança: ${fmtAge(diffSeconds(v.positionUnchangedSinceAt))}`:'Movimento: não verificado';return `Último GPS: ${fmtTime(v.lastGpsFixAt)} · há ${fmtAge(diffSeconds(v.lastGpsFixAt))}\n${movement}\n${shape}`}
function vehicleRow(v){let b=document.createElement('button');b.type='button';b.className='vehicle'+(state.selectedVehicle===v.source+'|'+v.vehicleId?' selected':'');b.dataset.vehicleKey=v.source+'|'+v.vehicleId;let top=document.createElement('div');top.className='top';let name=document.createElement('b');name.textContent='Ônibus';let lab=document.createElement('span');lab.className='label';let gpsAge=diffSeconds(v.lastGpsFixAt),stillAge=diffSeconds(v.positionUnchangedSinceAt);if(gpsAge>120)lab.classList.add('old');else if(v.positionUnchangedSinceAt&&stillAge>120)lab.classList.add('warn');lab.textContent=gpsAge>300?'Sinal antigo':gpsAge>120?'Sinal atrasado':v.positionUnchangedSinceAt&&stillAge>120?'Sem movimento recente':'GPS recente';top.append(name,lab);let m=document.createElement('div');m.className='meta';m.textContent=vehicleMeta(v);m.style.whiteSpace='pre-line';b.append(top,m);b.onclick=()=>focusVehicle(v);return b}
function tickVehicleAges(){let byId=new Map((state.fleet?.vehicles||[]).map(v=>[v.source+'|'+v.vehicleId,v]));for(let node of $('vehicleList').querySelectorAll('.vehicle')){let v=byId.get(node.dataset.vehicleKey);if(v){let m=node.querySelector('.meta');if(m)m.textContent=vehicleMeta(v)}}}
function renderVehicles(){
  if(state.fleet?.available===false){
    $('vTotal').textContent='—';$('vRecent').textContent='—';
    $('vehicleList').textContent='GPS indisponível no momento. Os pontos, as linhas e os horários programados continuam disponíveis.';
    return;
  }
  let arr=state.fleet?.vehicles||[];$('vTotal').textContent=arr.length;$('vRecent').textContent=arr.filter(v=>diffSeconds(v.lastGpsFixAt)<=120).length;let list=$('vehicleList');list.innerHTML='';if(!arr.length){let p=document.createElement('p');p.className='notice';p.textContent='Nenhuma posição GPS recente foi recebida para esta linha. Isso não significa que não haja ônibus circulando. Consulte os horários programados.';list.append(p);return}for(let v of arr.slice(0,200))list.append(vehicleRow(v));}
function nearestStopForLine(stops,coords){
  if(!Array.isArray(stops)||!stops.length||!Array.isArray(coords))return null;
  return stops.filter(p=>Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng)))
    .sort((a,b)=>distanceCoords([Number(a.lat),Number(a.lng)],coords)-
                 distanceCoords([Number(b.lat),Number(b.lng)],coords))[0]||null;
}
function populateLineStopChooser(stops){
  const list=$('lineStopSelect');list.replaceChildren();
  const placeholder=document.createElement('option');
  placeholder.value='';placeholder.textContent='Selecione seu ponto neste trajeto';
  list.append(placeholder);
  const visited=new Set();
  for(const stop of stops){
    if(visited.has(String(stop.id)))continue;
    visited.add(String(stop.id));
    const item=document.createElement('option');
    item.value=String(stop.id);item.textContent=stop.name;
    list.append(item);
  }
  $('lineStopChooser').hidden=!stops.length;
  if(stops.length&&!lineFocusStopId)
    $('lineStopForecast').textContent=state.userPosition
      ?'Selecione um ponto para ver as próximas partidas programadas.'
      :'Escolha o ponto de embarque neste percurso. Localização não autorizada.';
}
async function usePreviouslyGrantedLineLocation(selectionSeq){
  if(state.userPosition||!navigator.geolocation||!navigator.permissions?.query)return;
  try{
    const permission=await navigator.permissions.query({name:'geolocation'});
    if(permission.state!=='granted')return; // Never trigger a new prompt on line open.
    navigator.geolocation.getCurrentPosition(position=>{
      if(selectionSeq!==routeSelectionSeq||!lineMode()||!state.geometry?.selected)return;
      const coords=[position.coords.latitude,position.coords.longitude];
      state.userPosition=coords;
      const closest=nearestStopForLine(state.geometry.selected.stops,coords);
      if(closest)focusLineBoardingStop(closest);
    },()=>{}, {enableHighAccuracy:false,maximumAge:60000,timeout:7000});
  }catch(_){/* Permissions API unsupported: selector remains available. */}
}
function centerLineStop(stop){
  const coords=[Number(stop.lat),Number(stop.lng)];
  const a=visibleMapRect(),x=(a.left+a.right)/2,y=(a.top+a.bottom)/2;
  const [px,py]=mercator(...coords,state.zoom);
  state.center=invMercator(px-(x-$canvas.clientWidth/2),
                           py-(y-$canvas.clientHeight/2),state.zoom);
}
function focusLineBoardingStop(stop,{userInitiated=false}={}){
  if(!state.route||!lineMode())return;
  lineFocusStopId=String(stop.id);
  $('lineStopSelect').value=lineFocusStopId;
  state.zoom=Math.max(15.5,state.zoom);
  centerLineStop(stop);drawSoon();scheduleMapStops();
  const prefix=userInitiated?'Ponto selecionado. ':'Ponto mais próximo no percurso. ';
  $('lineStopForecast').textContent=prefix+'Consultando horários programados…';
  const capturedId=lineFocusStopId,capturedCode=state.route.code;
  loadLineStopForecast(stop).catch(e=>{
    if(lineMode()&&state.route?.code===capturedCode&&
       lineFocusStopId===capturedId)
      $('lineStopForecast').textContent='Horários indisponíveis: '+e.message;
  });
}
async function loadLineStopForecast(stop){
  const seq=++lineStopForecastSeq,code=state.route?.code||'';
  const pattern=state.pattern;
  const expectedDirection=normalizeDestination(state.geometry?.selected?.headsign);
  const result=await api('/api/stop?id='+encodeURIComponent(stop.id));
  if(seq!==lineStopForecastSeq||!lineMode()||state.route?.code!==code||
     state.pattern!==pattern||String(stop.id)!==String(lineFocusStopId))return;
  const sameLine=(result.routes||[]).filter(x=>String(x.code)===String(code));
  // Do not silently show a bus travelling in the OPPOSITE direction.
  // Some stops serve both headsigns. Unknown/missing headsign cannot
  // be treated as confirmation that an arrival belongs to this pattern.
  const matched=expectedDirection
    ?sameLine.filter(x=>normalizeDestination(
        x.destination||x.nextArrival?.destination)===expectedDirection)
    :sameLine;
  const ambiguous=!expectedDirection&&new Set(sameLine.map(x=>
    normalizeDestination(x.destination||x.nextArrival?.destination))).size>1;
  const scheduled=(ambiguous?[]:matched).filter(x=>x.nextArrival?.type==='scheduled')
    .sort((a,b)=>(a.nextArrival.minutes??9999)-(b.nextArrival.minutes??9999));
  if(result.expired){
    $('lineStopForecast').textContent='GTFS vencido: não há previsão confiável neste ponto.';
  }else if(scheduled.length){
    const first=scheduled[0],minutes=Number(first.nextArrival.minutes);
    const when=first.nextArrival.at?' às '+fmtTime(first.nextArrival.at).slice(0,5):'';
    const direction=first.destination?' · '+first.destination:'';
    $('lineStopForecast').textContent=
      stop.name+direction+' — próxima passagem programada em '+
      (minutes<=0?'instantes':minutes+' min')+when+
      '. Horário de tabela; não é ETA calculado pelo GPS.';
  }else{
    $('lineStopForecast').textContent=stop.name+
      (ambiguous
        ?': este ponto recebe diferentes sentidos; selecione um percurso com destino identificado.'
        :expectedDirection
          ?': sem horário confirmado no GTFS para o sentido '+state.geometry.selected.headsign+'.'
          :': sem próximo horário programado disponível para esta linha.')+
      ' Isso não significa ausência de ônibus.';
  }
  drawSoon();
}
async function selectPattern(){
  if(!state.route||!state.geometry)return;
  const code=state.route.code,pattern=$('patternInput').value;
  const selectionSeq=routeSelectionSeq;
  state.pattern=pattern;
  if(!pattern){
    state.geometry.selected=null;$('lineStopChooser').hidden=true;lineFocusStopId=null;
    $('patternHint').textContent='Escolha o sentido ou uma rota alternativa.';
    renderStops();drawSoon();return;
  }
  const p=state.geometry.patterns.find(x=>x.id===pattern);
  $('patternHint').textContent=lineFocusStopId
    ?'Percurso de referência passando pelo ponto selecionado · toque acima para mudar.'
    :(p?.headsign?'Sentido: '+p.headsign+' · toque acima para mudar.':'Traçado de referência · toque acima para mudar.');
  const geo=await api('/api/route?code='+encodeURIComponent(code)+'&pattern='+encodeURIComponent(pattern));
  if(selectionSeq!==routeSelectionSeq||
     state.route?.code!==code||state.pattern!==pattern)return;
  if(geo?.selected){
    state.geometry={...state.geometry,selected:geo.selected};
    renderStops();
    populateLineStopChooser(geo.selected.stops||[]);
    if(lineMode()&&lineFocusStopId){
      const focus=geo.selected.stops.find(s=>String(s.id)===String(lineFocusStopId));
      if(focus)focusLineBoardingStop(focus,{userInitiated:false});
      else {
        lineFocusStopId=null;
        $('lineStopSelect').value='';
        $('lineStopForecast').textContent='Este ponto não pertence ao sentido escolhido. Selecione outro.';
        const closest=state.userPosition
          ?nearestStopForLine(geo.selected.stops,state.userPosition):null;
        if(closest)focusLineBoardingStop(closest,{userInitiated:false});
        else fitCoordinates(geo.selected.coordinates);
      }
    }else if(lineMode()&&state.userPosition){
      const best=nearestStopForLine(geo.selected.stops,state.userPosition);
      if(best)focusLineBoardingStop(best,{userInitiated:false});
      else fitCoordinates(geo.selected.coordinates);
    }else{
      fitCoordinates(geo.selected.coordinates);
      usePreviouslyGrantedLineLocation(routeSelectionSeq);
    }
    drawSoon();scheduleMapStops();
  }
}
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
let near=state.markers.map(m=>({...m,d:Math.hypot(m.x-p[0],m.y-p[1])})).sort((a,b)=>a.d-b.d)[0];if(near&&near.d<20){state.selectedVehicle=near.id;switchTab('linhas',true);renderVehicles();drawSoon();return}let station=state.metroMarkers.map(m=>({...m,d:Math.hypot(m.x-p[0],m.y-p[1])})).sort((a,b)=>a.d-b.d)[0];if(station&&station.d<23){focusMetroStation(station.station.id);return}let stop=state.stopMarkers.map(m=>({...m,d:Math.hypot(m.x-p[0],m.y-p[1])})).sort((a,b)=>a.d-b.d)[0];if(stop&&stop.d<24){
  if(stop.cluster){
    state.center=[
      stop.cluster.reduce((sum,p)=>sum+p.lat,0)/stop.cluster.length,
      stop.cluster.reduce((sum,p)=>sum+p.lng,0)/stop.cluster.length
    ];
    state.zoom=Math.min(17.25,state.zoom+1.25);
    drawSoon();scheduleMapStops();
  }else if(lineMode()){
    // Touching a stop belonging to the displayed itinerary selects that
    // boarding stop; it must not tear down the active line tracking.
    focusLineBoardingStop(stop.stop,{userInitiated:true});
  }else focusStop(stop.stop);
  return
}});
$('zoomIn').onclick=()=>zoom(1);$('zoomOut').onclick=()=>zoom(-1);$('recenter').onclick=()=>{state.center=[-19.8695,-43.9675];state.zoom=15;drawSoon();scheduleMapStops();if(!isStaticOnly)loadNearbyStops(-19.8695,-43.9675,false).catch(reportError)};
$('goLine').onclick=()=>selectLine($('lineInput').value).catch(reportError);
$('lineExit').onclick=exitLineTracking;
$('lineStopSelect').onchange=()=>{
  const stop=state.geometry?.selected?.stops?.find(
    s=>String(s.id)===$('lineStopSelect').value);
  if(stop)focusLineBoardingStop(stop,{userInitiated:true});
};$('lineInput').onkeydown=e=>{if(e.key==='Enter')$('goLine').click()};$('patternInput').onchange=()=>selectPattern().catch(reportError);
$('refresh').onclick=()=>refresh().catch(reportError);
function reportError(e){console.error(e);statusLed(false,'Erro ao consultar dados');$('mapToast').textContent=`Não foi possível atualizar: ${e.message}`}
async function refresh(){if(document.hidden||!state.route)return;const code=state.route.code;const fleet=await api('/api/fleet?route='+encodeURIComponent(code));if(state.route?.code!==fleet.line)return;state.fleet=fleet;updateStatus(await api('/api/status'));renderVehicles();drawSoon()}
// Interface compartilhada com o padrão visual do Hub UFMG / Interno.
let activeTab='pontos';
function syncSheetAccessibility(){
  const sheet=$('sheet');
  const detail=activeTab==='pontos' && Boolean(state.selectedStop) && !$('stopDetail').hidden;
  sheet.classList.toggle('detail',detail);
  const hidden=window.innerWidth<760&&sheet.classList.contains('peek');
  $('body').inert=hidden;
  $('body').setAttribute('aria-hidden',String(hidden));
  const label=sheet.classList.contains('peek')?'Expandir painel':sheet.classList.contains('full')?'Recolher painel':'Expandir detalhes';
  for(const id of ['grab','sheet-toggle'])$(id).setAttribute('aria-label',label);
}

function openSheet(full=false){const sheet=$('sheet');sheet.classList.remove('peek');sheet.classList.toggle('full',!!full);$('sheet-toggle').setAttribute('aria-expanded','true');$('grab').setAttribute('aria-expanded','true');syncSheetAccessibility()}
function closeSheet(){if($('body').contains(document.activeElement))$('sheet-toggle').focus();const sheet=$('sheet');sheet.classList.add('peek');sheet.classList.remove('full');$('sheet-toggle').setAttribute('aria-expanded','false');$('grab').setAttribute('aria-expanded','false');syncSheetAccessibility()}
function switchTab(tab,open=false){
  // V1 municipal: retain planner code for later, but never expose its tab.
  if(tab==='rotas')tab='pontos';
  // Leaving a line restores exactly the earlier map and point context.
  if(activeTab==='linhas'&&tab!=='linhas'&&lineMapSession)
    restoreLineMapSession();
  activeTab=tab;const pts=tab==='pontos',lin=tab==='linhas',met=tab==='metro',rot=tab==='rotas';
$('pontosPane').hidden=!pts;$('linhasPane').hidden=!lin;$('metroPane').hidden=!met;$('rotasPane').hidden=!rot;
for(const [name,on] of [['pontos',pts],['linhas',lin],['metro',met],['rotas',rot]]){const button=$('quick-'+name);button.classList.toggle('on',on);button.setAttribute('aria-pressed',String(on))}
state.metroVisible=met;
if(met){$('sourceLed').className='dot';$('sourceText').textContent='Metrô BH · horários informativos';loadMetroNews().catch(e=>console.warn('RSS da concessionária indisponível',e))}
else if(state.lastBusStatus)updateStatus(state.lastBusStatus);
drawSoon();if(open)openSheet();else syncSheetAccessibility()}
function renderStops(){const el=$('stopList');el.textContent='';const stops=state.geometry?.selected?.stops||[];$('pontosHelp').textContent=stops.length?`${state.route?.code||''} · ${stops.length} paradas deste percurso de referência. Toque para localizar no mapa.`:'Selecione uma linha na aba Linhas e escolha o percurso de referência para visualizar as paradas.';if(!stops.length){const b=document.createElement('button');b.type='button';b.className='row-item';b.textContent='Escolher linha e percurso';b.onclick=()=>switchTab('linhas',true);el.append(b);return}for(let [i,s] of stops.entries()){const b=document.createElement('button');b.type='button';b.className='row-item';b.dataset.stopId=s.id;const num=document.createElement('span');num.className='num';num.textContent=String(i+1);const text=document.createElement('span');text.className='name';const name=document.createElement('b');name.textContent=s.name;const meta=document.createElement('small');meta.textContent='Ponto '+(i+1)+' · toque para localizar';text.append(name,meta);b.append(num,text);b.onclick=()=>focusStop(s);el.append(b)}}
function focusStop(stop){if(lineMapSession)restoreLineMapSession();state.selectedStop=String(stop.id);updatePointLink(state.selectedStop);state.stopCoordinates=[Number(stop.lat),Number(stop.lng)];state.selectedVehicle="";state.center=[Number(stop.lat),Number(stop.lng)];state.zoom=Math.max(state.zoom,16);switchTab('pontos',true);centerStopInAvailableMap();$('body').scrollTo({top:0,behavior:'smooth'});for(let node of $('stopList').querySelectorAll('[data-stop-id]'))node.classList.toggle('selected',node.dataset.stopId===String(stop.id));drawSoon();scheduleMapStops();openStopDetail(state.selectedStop).catch(reportError)}
function renderAllLines(query){const el=$('allLineList');el.textContent='';let arr=state.routes||[];const q=String(query||'').trim().toLocaleLowerCase('pt-BR');if(q)arr=arr.filter(x=>(x.code+' '+x.name).toLocaleLowerCase('pt-BR').includes(q));arr=arr.slice().sort((a,b)=>Number(favorites.routes.includes(String(b.code)))-Number(favorites.routes.includes(String(a.code))));let limited=arr.slice(0,q?80:40);for(let r of limited){const wrap=document.createElement('div');wrap.className='fav-row';const b=document.createElement('button');b.type='button';b.className='row-item';const n=document.createElement('span');n.className='num';n.textContent=r.code;const t=document.createElement('span');t.className='name';const title=document.createElement('b');title.textContent=r.name||'Sem descrição';const meta=document.createElement('small');meta.textContent=`${r.patternCount} variantes GTFS`;t.append(title,meta);b.append(n,t);b.onclick=()=>selectLine(r.code).then(()=>{openSheet();$('body').scrollTo({top:0,behavior:'smooth'})}).catch(reportError);wrap.append(b,starButton('routes',r.code));el.append(wrap)}if(arr.length>limited.length){const msg=document.createElement('p');msg.className='muted info-small';msg.textContent=`Exibindo ${limited.length} de ${arr.length} linhas. Use a busca para filtrar.`;el.append(msg)}}
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
function askLocation(){
  if(isStaticOnly){
    if(!window.isSecureContext||!navigator.geolocation){
      statusLed(false,'Localização exige HTTPS; escolha um ponto no mapa.');return;
    }
    navigator.geolocation.getCurrentPosition(async position=>{
      const lat=position.coords.latitude,lng=position.coords.longitude;
      state.userPosition=[lat,lng];
      if(lineMode()&&state.geometry?.selected){
        const closest=nearestStopForLine(state.geometry.selected.stops,[lat,lng]);
        if(closest)focusLineBoardingStop(closest);
      }else{
        state.center=[lat,lng];state.zoom=15.5;drawSoon();scheduleMapStops();
        await loadNearbyStops(lat,lng,true).catch(reportError);
      }
    },()=>statusLed(null,'Localização não autorizada; selecione ponto ou endereço.'),
    {enableHighAccuracy:false,maximumAge:60000,timeout:12000});
    return;
  }
  hideLocationPrompt();if(!window.isSecureContext||!navigator.geolocation){$('nearbyHint').textContent='Localização requer HTTPS ou localhost. Mostrando pontos próximos à UFMG.';openSheet();return}navigator.geolocation.getCurrentPosition(async p=>{const lat=p.coords.latitude,lng=p.coords.longitude;state.userPosition=[lat,lng];state.center=[lat,lng];state.zoom=15.5;drawSoon();scheduleMapStops();try{if(activeTab==='metro'){await loadMetroNearby(lat,lng);switchTab('metro',true)}else{await loadNearbyStops(lat,lng,true);switchTab('pontos',true)}}catch(e){reportError(e)}},()=>{$('nearbyHint').textContent='Localização não autorizada. Você ainda pode buscar pontos no mapa da UFMG.';openSheet()},{enableHighAccuracy:false,timeout:12000,maximumAge:60000})}
$('loc').onclick=askLocation;$('allowLocation').onclick=askLocation;$('skipLocation').onclick=hideLocationPrompt;
function hideLocationPrompt(){$('locationPrompt').hidden=true;try{sessionStorage.setItem('bh-externo-location-intro-seen','yes')}catch(e){}}
try{if(sessionStorage.getItem('bh-externo-location-intro-seen')==='yes')hideLocationPrompt()}catch(e){}

// Quando incorporado pelo Hub (mesma origem), o tema acompanha o contêiner.
try{if(window.parent!==window){const theme=window.parent.document.documentElement.dataset.theme;if(theme==='dark'||theme==='light')document.documentElement.dataset.theme=theme}}catch(e){}
window.addEventListener('message',e=>{
  if(window.parent===window||e.source!==window.parent||e.origin!==location.origin)return;
  if(e.data?.type==='hub-theme'&&['dark','light'].includes(e.data.theme)){
    document.documentElement.dataset.theme=e.data.theme;
    drawSoon();
  }
});
const themeMedia=window.matchMedia?.('(prefers-color-scheme:dark)');
themeMedia?.addEventListener?.('change',e=>{
  document.documentElement.dataset.theme=e.matches?'dark':'light';
  drawSoon();
});

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
let mapStopsTimer=0,mapStopsSeq=0;
function scheduleMapStops(){clearTimeout(mapStopsTimer);mapStopsTimer=setTimeout(loadMapStops,180)}
async function loadMapStops(){const seq=++mapStopsSeq;if(state.zoom<12.5){state.mapStops=[];drawSoon();return}const w=$canvas.clientWidth,h=$canvas.clientHeight;if(!w||!h)return;const [cx,cy]=mercator(...state.center,state.zoom);const a=invMercator(cx-(w*.65),cy+(h*.65),state.zoom),b=invMercator(cx+(w*.65),cy-(h*.65),state.zoom);const url=`/api/map-stops?minlat=${a[0]}&minlng=${a[1]}&maxlat=${b[0]}&maxlng=${b[1]}`;try{const data=await api(url);if(seq!==mapStopsSeq)return;state.mapStops=data.items||[];drawSoon()}catch(e){console.warn('Paradas do mapa indisponíveis',e)}}
async function loadNearbyStops(lat,lng,personal){let data=await api(`/api/nearby-stops?lat=${lat}&lng=${lng}`);state.nearby=data.items||[];$('nearbyHeading').textContent=personal?'Pontos perto de você':'Pontos próximos à UFMG';$('nearbyHint').textContent=personal?'Distâncias aproximadas; sua localização não é armazenada no servidor.':'Sem localização, exibimos os pontos próximos ao campus UFMG.';renderNearbyStops()}
function renderNearbyStops(){const area=$('nearbyStops');area.replaceChildren();for(const stop of state.nearby){let b=document.createElement('button');b.type='button';b.className='row-item';const n=document.createElement('span');n.className='num';n.textContent='●';const txt=document.createElement('span');txt.className='name';let t=document.createElement('b');t.textContent=stop.name;let d=document.createElement('small');d.textContent=`A ${stop.distanceM} m · ver linhas`;txt.append(t,d);b.append(n,txt);b.onclick=()=>focusStop(stop);area.append(b)}if(!state.nearby.length){let e=document.createElement('p');e.className='muted-empty';e.textContent='Nenhum ponto encontrado neste raio.';area.append(e)}}
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
  syncSheetAccessibility();
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
// Atualizar chegadas sem destruir os botões, a rolagem ou o estado de expansão.
function updateArrivalButton(button,r){
  const arrival=r.nextArrival, title=r.destination||arrival?.destination||r.name;
  let code=button.querySelector('.num'),info=button.querySelector('.arrival-info'),eta=button.querySelector('.eta');
  if(!code){code=document.createElement('span');code.className='num';button.append(code)}
  if(!info){info=document.createElement('span');info.className='arrival-info';button.append(info)}
  if(!eta){eta=document.createElement('span');eta.className='eta';button.append(eta)}
  code.textContent=r.code;
  let name=info.querySelector('b'),sub=info.querySelector('small');
  if(!name){name=document.createElement('b');info.append(name)}
  if(!sub){sub=document.createElement('small');info.append(sub)}
  name.textContent=title;
  sub.textContent=(r.destination?'Sentido · '+r.name:r.name)+(arrival?.type==='gps_estimate'?' · ônibus no mapa':'');
  const fingerprint=JSON.stringify(arrival||null);
  if(button.dataset.arrival!==fingerprint){
    button.dataset.arrival=fingerprint;
    eta.replaceChildren();
    if(arrival){
      eta.append(document.createTextNode(arrival.type==='gps_estimate'
         ?'≈ '+arrival.minutes+' min':arrival.minutes<=0?'Agora':arrival.minutes+' min'));
      const detail=document.createElement('small');
      detail.textContent=arrival.type==='gps_estimate'
         ?'Estimativa GPS':'Tabela · '+fmtTime(arrival.at).slice(0,5);
      eta.append(detail);
      if(arrival.type==='scheduled'&&arrival.following?.length){
        const following=document.createElement('small');following.className='arrival-following';
        following.textContent='Depois: '+arrival.following.map(x=>fmtTime(x.at).slice(0,5)).join(' · ');
        eta.append(following);
      }
      if(arrival.type==='scheduled'&&arrival.lastTripToday){
        const last=document.createElement('small');last.className='arrival-last';
        last.textContent='Última de hoje';eta.append(last);
      }
    }else{
      eta.append(document.createTextNode('—'));
      const msg=document.createElement('small');msg.textContent='Sem previsão';eta.append(msg);
    }
  }
  button.setAttribute('aria-label',r.code+' para '+title+', '+
    (arrival?(arrival.type==='gps_estimate'?'GPS estimado, ':'horário de tabela, ')+arrival.minutes+' minutos':'sem previsão')+
    '. Ver linha e percurso');
  button.onclick=async()=>{
    const gps=arrival?.type==='gps_estimate'&&arrival.vehicleId;
    const key=gps?arrival.vehicleSource+'|'+arrival.vehicleId:null;
    try{
      await selectLine(r.code,{fromStop:true,vehicleKey:key,
        destination:r.destination||arrival?.destination});
      if(!gps)switchTab('linhas',true);
    }catch(e){reportError(e)}
  };
}
function initStopDetail(area,data){
  area.replaceChildren();area.dataset.stopId=String(data.id);
  const head=document.createElement('div');head.className='stop-head';
  const back=document.createElement('button');back.type='button';back.className='stop-back';
  back.textContent='‹';back.setAttribute('aria-label','Voltar para pontos');back.onclick=closeStopDetail;
  const text=document.createElement('div');const title=document.createElement('h2');title.textContent=data.name;
  const small=document.createElement('small');small.textContent='Próximas chegadas';text.append(title,small);
  head.append(back,text,makeShareButton(data),starButton('stops',data.id));area.append(head);
  const arrivals=document.createElement('div');arrivals.className='arrival-rows';area.append(arrivals);
  const empty=document.createElement('p');empty.className='muted-empty empty-arrivals';area.append(empty);
  if(data.alternatives?.length){
    const alt=document.createElement('details');alt.className='stop-alternatives';
    const summary=document.createElement('summary');summary.textContent='Outros pontos próximos';alt.append(summary);
    const explanation=document.createElement('p');explanation.className='stop-forecast-note';
    explanation.textContent='Algumas linhas têm destinos diferentes em pontos próximos. Confira o sentido antes de embarcar.';
    alt.append(explanation);
    for(const nearby of data.alternatives){
      const button=document.createElement('button');button.type='button';button.className='row-item';
      button.textContent=nearby.name+' · '+nearby.distanceM+' m';
      button.onclick=()=>focusStop(nearby);alt.append(button);
    }
    area.append(alt);
  }
  const note=document.createElement('p');note.className='stop-forecast-note';note.dataset.note='1';
  area.append(note);
}
async function openStopDetail(id,silent=false){
  const seq=++stopDetailSeq,area=$('stopDetail');
  area.hidden=false;$('pontosPane').classList.add('has-open-stop');
  syncSheetAccessibility();
  if(!silent)requestAnimationFrame(()=>{if(state.selectedStop===String(id)){centerStopInAvailableMap();drawSoon()}});
  if(!silent){area.replaceChildren();const message=document.createElement('p');
    message.className='muted-empty';message.textContent='Consultando chegadas…';area.append(message)}
  let data;
  try{data=await api('/api/stop?id='+encodeURIComponent(id))}
  catch(e){
    if(seq!==stopDetailSeq||String(state.selectedStop)!==String(id))return;
    area.classList.add('stale-arrivals');
    const note=area.querySelector('[data-note]');
    if(note)note.textContent='Sem conexão · horários não atualizados.';
    else area.textContent='Não foi possível consultar o ponto. Tente novamente.';
    return;
  }
  if(seq!==stopDetailSeq||String(state.selectedStop)!==String(id))return;
  if(favorites.stops.includes(String(id))&&favorites.names[id]!==data.name){
    favorites.names[id]=data.name;saveFavorites();
  }
  if(area.dataset.stopId!==String(data.id)||!area.querySelector('.arrival-rows')){
    initStopDetail(area,data);
    renderFavoriteStops();
  }
  area.classList.remove('stale-arrivals');
  const title=area.querySelector('.stop-head h2');if(title&&title.textContent!==data.name)title.textContent=data.name;
  const rows=area.querySelector('.arrival-rows');
  const existing=new Map([...rows.querySelectorAll('[data-arrival-key]')].map(el=>[el.dataset.arrivalKey,el]));
  const seen=new Set();
  for(const r of data.routes){
    const key=JSON.stringify([String(r.code),String(r.destination||'')]);
    seen.add(key);
    let b=existing.get(key);
    if(!b){b=document.createElement('button');b.type='button';b.className='route-arrival';
      b.dataset.arrivalKey=key;rows.append(b)}
    updateArrivalButton(b,r);
  }
  for(const [key,node] of existing){if(!seen.has(key))node.remove()}
  const empty=area.querySelector('.empty-arrivals');
  if(empty){empty.hidden=data.routes.length>0;empty.textContent='Nenhuma linha cadastrada para este ponto.'}
  const note=area.querySelector('[data-note]');
  if(note)note.textContent=data.routes.some(r=>r.nextArrival?.type==='gps_estimate')
     ?'≈ Chegada estimada por GPS. Outros horários seguem a tabela.'
     :data.timetableAvailable?'Horários programados; podem variar.':'Sem horários disponíveis.';
  drawSoon();
}

window.addEventListener('offline',()=>{
  statusLed(false,'Sem conexão · dados podem estar desatualizados');
  $('stopDetail').classList.add('stale-arrivals');
  const note=$('stopDetail').querySelector('[data-note]');
  if(note)note.textContent='Sem internet: horários e trajetos podem estar desatualizados.';
});
window.addEventListener('online',()=>{
  if(state.selectedStop)openStopDetail(state.selectedStop,true).catch(reportError);
  if(!isStaticOnly)refresh().catch(reportError);
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||document.querySelector('dialog[open]'))return;
  if(state.selectedStop&&activeTab==='pontos')closeStopDetail();
  else if(window.innerWidth<760)closeSheet();
});
if(isStaticOnly){
  $('sourceText').textContent='GTFS · horários programados, GPS indisponível';
  switchTab('pontos');renderStops();
  $('routePlanStatus').textContent='Motor gratuito no dispositivo. Selecione os locais pelo mapa ou pontos do catálogo.';
}else{switchTab('pontos');renderStops();}
loadMetro().catch(e=>{console.warn('Catálogo de metrô indisponível',e);$('metroService').textContent='Metrô temporariamente indisponível.'});
window.addEventListener('resize',()=>{resize();syncSheetAccessibility();if(state.selectedStop&&activeTab==='pontos'){requestAnimationFrame(()=>{centerStopInAvailableMap();drawSoon()})}});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!isStaticOnly)refresh().catch(reportError)});
resize();syncSheetAccessibility();
loadRoutes().catch(reportError);
if(isStaticOnly)loadMapStops().catch(reportError);
if(isStaticOnly){
  // Only poll an actively selected line when the free GPS adapter was enabled
  // by an explicit, independently validated deployment configuration.
  setInterval(()=>{
    // Do not spend free Worker requests while the user is reading Metro,
    // planning routes, or viewing stops without an active line.
    const lineVisible=activeTab==='linhas'||(activeTab==='pontos'&&state.selectedStop);
    if(!document.hidden&&navigator.onLine&&state.route&&lineVisible&&
       typeof StaticLive!=='undefined'&&StaticLive.enabled())
      refresh().catch(e=>console.warn('GPS opcional indisponível',e));
  },45000);
}
if(!isStaticOnly){
  setInterval(()=>{if(document.hidden)return;tickVehicleAges();if(state.fleet?.vehicles?.length)drawSoon()},15000);
  setInterval(()=>{if(!document.hidden&&navigator.onLine)refresh().catch(reportError)},35000);
  setInterval(()=>{if(!document.hidden&&navigator.onLine&&state.selectedStop)openStopDetail(state.selectedStop,true).catch(reportError)},60000);
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
  // Invalidate any geocoding response still in flight for this field.
  if(typeof geocodeSequence!=='undefined')geocodeSequence[which]++;
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
const geocodeSequence={origin:0,destination:0};
async function searchRoutePlace(which){
  const q=routeInput(which).value.trim(),area=routeCandidates(which);
  const seq=++geocodeSequence[which];
  if(q.length<2){routeStatus('Digite um ponto, endereço ou local com pelo menos 2 caracteres.','warn');return}
  const coords=q.match(/^(-?\d{1,2}\.\d+)\s*[,;]\s*(-?\d{1,3}\.\d+)$/);
  if(coords){
    setRoutePoint(which,{lat:Number(coords[1]),lng:Number(coords[2]),label:'Coordenadas: '+q});return;
  }
  area.textContent='Buscando pontos e endereços…';
  // One external geocoding request ONLY after the person's explicit click.
  // Coordinates of the user are never transmitted; the bias is fixed in BH.
  // Local stop lookup uses the lightweight already loaded catalog.
  // Do NOT start the 18 MB compressed routing index just to resolve a name.
  const local=api('/api/stops?q='+encodeURIComponent(q))
    .then(result=>{
      const stops=(result.items||[]).slice(0,10).map(p=>({
        lat:Number(p.lat),lng:Number(p.lng),label:'Ponto: '+p.name,
        source:'GTFS local'
      }));
      const needle=normalizeDestination(q);
      const metro=(state.metro?.stations||[])
        .filter(p=>p.active&&normalizeDestination(p.name).includes(needle))
        .slice(0,3).map(p=>({
          lat:Number(p.lat),lng:Number(p.lng),label:'Metrô: '+p.name,
          source:'Catálogo local'
        }));
      return [...metro,...stops];
    }).catch(()=>[]);
  const external=q.length>=3&&typeof GeoPlaces!=='undefined'
    ?GeoPlaces.search(q).then(v=>({items:v})).catch(error=>({items:[],error:error.message}))
    :Promise.resolve({items:[],error:null});
  function renderMatches(places,stops,{loading=false,error=null}={}){
    area.replaceChildren();
    const unique=new Set();
    const combined=[...places,...stops].filter(p=>{
      const lat=Number(p.lat),lng=Number(p.lng);
      if(!Number.isFinite(lat)||!Number.isFinite(lng))return false;
      const key=lat.toFixed(5)+','+lng.toFixed(5);
      if(unique.has(key))return false;
      unique.add(key);return true;
    }).slice(0,14);
    if(!combined.length){
      area.textContent=loading?'Pesquisando endereço no OpenStreetMap…':
        (error?'Busca externa indisponível. ':'')+
        'Nenhum local confirmado. Experimente o endereço completo ou Escolher no mapa.';
      return;
    }
    for(const p of combined){
      const button=document.createElement('button');
      button.type='button';button.className='row-item';
      const label=document.createElement('span');label.className='name';
      label.textContent=p.label;
      button.append(label);
      button.onclick=()=>setRoutePoint(which,p);
      area.append(button);
    }
    if(loading){
      const progress=document.createElement('p');progress.className='hint';
      progress.textContent='Pontos locais disponíveis. Procurando também endereços e comércios…';
      area.append(progress);
    }else if(error){
      const warn=document.createElement('p');warn.className='hint';
      warn.textContent='Busca externa indisponível; resultados locais exibidos. '+error;
      area.append(warn);
    }
  }
  // Never hold nearby GTFS stops hostage to a slow third-party service.
  const stops=await local;
  if(seq!==geocodeSequence[which])return;
  renderMatches([],stops,{loading:q.length>=3&&typeof GeoPlaces!=='undefined'});
  const places=await external;
  if(seq!==geocodeSequence[which])return;
  renderMatches(places.items,stops,{error:places.error});
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
      preference:$('routePreference').value,
      searchDepth:$('routeSearchDepth').value}});
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
    routeStatus((data.status==='partial'?
         (data.stats?.searchDepth==='expanded'
          ?'Busca ampliada com algumas alternativas descartadas por limite de processamento. '
          :'Busca com limites para manter o celular responsivo; o modo Ampliada pode encontrar outras opções. '):'')+
      data.itineraries.length+' itinerário(s) programado(s), não tempo real. '+(['local_osm','osm_walk_graph_with_unverified_access_snap'].includes(data.pedestrianRouting)
       ?'Caminhadas pelo grafo viário OSM; o acesso às ruas e às entradas ainda não foi verificado em campo.'
       :'Caminhadas aproximadas; os percursos pelas ruas ainda não foram verificados.'),
      data.status==='partial'?'warn':'info');
  }
  if(data.coverage?.metropolitanBh===false){
    const warning=document.createElement('p');
    warning.className='route-coverage-notice';
    warning.textContent='Cobertura incompleta: ônibus metropolitanos de MG, como a linha 411C, '+
      'ainda não fazem parte do GTFS municipal. Portanto, combinações com essas linhas não são avaliadas. '+
      'Os resultados não representam necessariamente a opção mais rápida de toda a Grande BH.';
    area.append(warning);
  }
  if(data.itineraries?.length){
    // Diagnostics are opt-in, to keep the route result cards concise.
    // Expose why an answer can differ from an external timetable planner.
    const more=document.createElement('details');
    more.className='route-diagnostics';
    const summary=document.createElement('summary');
    summary.textContent='Como esses trajetos foram calculados';
    const note=document.createElement('p');
    const st=data.stats||{};
    note.textContent='Horários programados GTFS, não GPS nem trânsito ao vivo. '+
      'Foram verificadas '+Number(st.connectionsScanned||0).toLocaleString('pt-BR')+
      ' conexões; '+Number(st.walkCandidatesEvaluated||0)+
      ' alternativas tiveram caminhadas avaliadas na rede de ruas e '+
      Number(st.walkCandidatesRejected||0)+' foram rejeitadas por falta de trajeto pedestre viável. '+
      'Busca '+(st.searchDepth==='expanded'?'ampliada':'normal')+
      ', pontos a até '+Number(st.boardingStopRadiusMeters||0)+
      ' m da origem/destino. Acesso real à entrada do imóvel, trânsito e dados em tempo real ainda não são confirmados. '+
      'Para comparar com outro app, utilize endereços, data e horário idênticos.';
    more.append(summary,note);area.append(more);
  }
  for(const [index,trip] of (data.itineraries||[]).entries()){
    const container=document.createElement('div');container.className='route-result';
    if(index===state.routeSelected)container.classList.add('selected');
    const select=document.createElement('button');select.type='button';select.className='route-summary';
    const clock=document.createElement('strong');
    clock.textContent=routeClock(trip.departure)+' → '+routeClock(trip.arrival)+' · '+trip.durationMinutes+' min';
    const detail=document.createElement('small');
    const buses=trip.legs.filter(x=>x.mode==='bus');
    const verified=Boolean(trip.confidence?.includes('OSM_walk_graph'))||trip.confidence==='scheduled_gtfs_with_osm_pedestrian_paths';
    detail.textContent=buses.map(x=>x.line).join(' + ')+' · '+trip.walkMetersApprox+
      (verified?' m a pé (vias OSM)':' m a pé (aprox.)')+' · '+trip.transfers+' baldeação(ões)';
    select.append(clock,detail);
    select.onclick=()=>{state.routeSelected=index;renderRouteResults(data);focusSelectedRoute(trip)};
    container.append(select);
    if(index===state.routeSelected){
      const legs=document.createElement('div');legs.className='route-legs';
      // Timetable decomposition is useful to explain why our GTFS journey
      // differs from a real-time provider. Never call this a GPS prediction.
      const quality=trip.journeyQuality;
      if(quality?.tightTransfers>0){
        const warning=document.createElement('p');
        warning.className='route-transfer-warning';
        warning.textContent=quality.tightTransfers+
          ' conexão(ões) com menos de 2 minutos de folga após caminhada/desembarque. '+
          'Risco de perder a baldeação; a partida é programada, não confirmada por GPS.';
        legs.append(warning);
      }
      const times=trip.timeBreakdown;
      if(times){
        const timings=document.createElement('p');
        timings.className='route-time-breakdown';
        timings.textContent=times.walkingMinutes+' min caminhando · '+
          times.onboardMinutes+' min nos ônibus · '+
          times.waitingMinutes+' min de espera (horários GTFS)';
        legs.append(timings);
      }
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
    const h=document.createElement('h3');h.textContent='Possibilidades com metrô — horários NÃO confirmados';
    rail.append(h);
    for(const hint of data.metroHints){
      const card=document.createElement('div');card.className='metro-hint';
      const strong=document.createElement('strong');strong.textContent='Linha '+hint.line+
        ': '+hint.fromStation+' → '+hint.toStation;
      const p=document.createElement('p');
      p.textContent=hint.note||'Trajeto por metrô sem programação confirmada.';
      card.append(strong,p);
      if(hint.timing){
        const range=document.createElement('p');range.className='info-small';
        range.textContent='Faixa temporal ilustrativa: '+hint.timing.travelWindowMinutes[0]+
          '–'+hint.timing.travelWindowMinutes[1]+' min (inclui acesso aproximado), '+
          'intervalo habitual de até '+hint.timing.headwayMinutes+
          ' min; NÃO são partidas ou chegadas garantidas.';
        const ref=document.createElement('a');
        ref.href=hint.timing.reference;ref.target='_blank';ref.rel='noopener noreferrer';
        ref.textContent='Referência histórica da operadora';
        card.append(range,ref);
      }
      rail.append(card);
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
  }
  if(coords.length>1){fitCoordinates(coords);drawSoon();scheduleMapStops()}
}
function drawRouteLayer(){
  if(activeTab!=='rotas')return;
  const trip=state.routeResults[state.routeSelected];
  if(trip){
    for(const leg of trip.legs){
      const coords=leg.mode==='walk'&&leg.geometry?.length>1?leg.geometry:
        leg.fromCoords&&leg.toCoords?[leg.fromCoords,leg.toCoords]:[];
      if(coords.length<2)continue;
      ctx.save();ctx.beginPath();
      coords.forEach(([lat,lng],i)=>{
        const [x,y]=screen(lat,lng);
        if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      });
      ctx.strokeStyle=leg.mode==='walk'?'#138a6a':'#1265a8';
      ctx.lineWidth=leg.mode==='walk'?4:3;
      ctx.setLineDash(leg.mode==='walk'&&leg.pathVerified?[]:[8,5]);
      ctx.globalAlpha=.8;ctx.stroke();ctx.setLineDash([]);
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
    geocodeSequence[which]++; // typing cancels previous asynchronous results
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
for(const id of ['routeDate','routeTime','routeBuffer','routePreference','routeSearchDepth']){
  $(id).addEventListener('change',()=>invalidateRouteResults());
}
$('routeSubmit').onclick=submitRoute;
initRouteDate();routeWhenChanged();
// Route calculations use only browser Worker and static data files.
// Loading the 18 MB schedule index is deferred until "Encontrar trajetos".
// Merely opening Rotas and searching an address no longer downloads it.

// P8: cache only public route archives used by this free-static preview.
if(isStaticOnly&&'serviceWorker' in navigator&&window.isSecureContext){
  const install=()=>navigator.serviceWorker.register('./service-worker.js',{scope:'./'})
    .catch(e=>console.warn('Cache offline opcional indisponível',e));
  if(document.readyState==='complete')install();
  else window.addEventListener('load',install,{once:true});
}
