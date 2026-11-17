/* P9: free-static compatibility API for the old Points and Lines tabs.
 * Reads the project's official GTFS catalog as static JSON only. No external
 * backend; a missing live fleet is represented as unavailable, NOT zero buses.
 */
'use strict';
const StaticBus=(()=>{
  const cache=new Map();
  const base=new URL('./catalog/',location.href);
  let lines=null,stops=null,patterns=null,shapes=null,stopRoutes=null,routeIndex=null,stopIndex=null;
  let grid=null,patternsByStop=null;
  const CELL_DEGREES=0.0125;
  const cell=(lat,lng)=>Math.floor(lat/CELL_DEGREES)+':'+Math.floor(lng/CELL_DEGREES);
  function candidates(south,west,north,east){
    const out=[];
    if(!grid)return stopIndex||[];
    const s=Math.floor(south/CELL_DEGREES),n=Math.floor(north/CELL_DEGREES);
    const w=Math.floor(west/CELL_DEGREES),e=Math.floor(east/CELL_DEGREES);
    // Invalid/extremely large viewports use the fallback index.
    if((n-s+1)*(e-w+1)>800)return stopIndex;
    for(let lat=s;lat<=n;lat++)for(let lng=w;lng<=e;lng++){
      const items=grid.get(lat+':'+lng);if(items)out.push(...items);
    }
    return out;
  }
  async function getStopPatterns(){
    if(patternsByStop)return patternsByStop;
    patterns ||=await data('patterns.json');
    const index=new Map();
    for(const pattern of patterns){
      for(const id of pattern.stops){
        const stop=String(id);
        if(!index.has(stop))index.set(stop,[]);
        index.get(stop).push(pattern);
      }
    }
    patternsByStop=index;
    return index;
  }
  async function data(file){
    if(cache.has(file))return cache.get(file);
    const promise=fetch(new URL(file,base),{cache:'force-cache'}).then(r=>{
      if(!r.ok)throw Error('Catálogo GTFS não disponível: '+file+' HTTP '+r.status);
      return r.json();
    }).catch(error=>{cache.delete(file);throw error});
    cache.set(file,promise);
    return promise;
  }
  async function init(){
    if(lines&&stops)return;
    const [routes,raw]=await Promise.all([data('routes.json'),data('stops.json')]);
    lines=routes.map(r=>({code:String(r.code),name:r.name,id:String(r.id),
      patternCount:r.patterns.length,patterns:r.patterns}));
    stops=raw;
    routeIndex=new Map(lines.map(r=>[r.code.toUpperCase(),r]));
    stopIndex=Object.entries(stops).map(([id,[name,lat,lng]])=>
      ({id,name,lat:Number(lat),lng:Number(lng)}));
    grid=new Map();
    for(const s of stopIndex){const key=cell(s.lat,s.lng);
      if(!grid.has(key))grid.set(key,[]);grid.get(key).push(s)}
  }
  const fold=s=>String(s||'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  const distance=(a,b,c,d)=>{
    const rad=Math.PI/180,dl=(c-a)*rad,dn=(d-b)*rad;
    const x=Math.sin(dl/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin(dn/2)**2;
    return Math.round(12742000*Math.asin(Math.min(1,Math.sqrt(Math.max(0,x)))));
  };
  const stopObj=s=>({id:s.id,name:s.name,lat:s.lat,lng:s.lng});
  async function api(path){
    await init();
    const u=new URL(path,'https://static.invalid');
    const endpoint=u.pathname;
    if(endpoint==='/api/routes')return lines.map(({code,name,id,patternCount})=>({
      code,name,id,patternCount}));
    if(endpoint==='/api/route'){
      const route=routeIndex.get(String(u.searchParams.get('code')||'').toUpperCase());
      if(!route)throw Error('Linha não cadastrada no GTFS');
      patterns ||=await data('patterns.json');
      const all=patterns.filter(p=>String(p.route)===route.id);
      const out={code:route.code,name:route.name,patterns:all.map(p=>({
        id:p.id,shapeId:String(p.shape),headsign:p.headsign,stops:p.stops.length,
        tripCount:p.tripCount,direction:p.direction??'',
        ...(u.searchParams.has('stop')?{servesStop:p.stops.includes(u.searchParams.get('stop'))}:{})}))};
      const pid=u.searchParams.get('pattern');
      if(pid){
        const selected=all.find(p=>p.id===pid);
        if(!selected)throw Error('Percurso não cadastrado');
        shapes ||=await data('shapes.json');
        out.selected={patternId:selected.id,shapeId:String(selected.shape),
          headsign:selected.headsign,coordinates:shapes[String(selected.shape)]||[],
          stops:selected.stops.filter(id=>stops[id]).map(id=>({
            id,name:stops[id][0],lat:stops[id][1],lng:stops[id][2]}))};
      }
      return out;
    }
    if(endpoint==='/api/fleet'){
      const line=String(u.searchParams.get('route')||'');
      const route=routeIndex.get(line.toUpperCase());
      if(!route)throw Error('Linha não cadastrada');
      return {line:route.code,name:route.name,asOf:null,
        available:false,count:null,vehicles:[],sources:{},
        note:'GPS em tempo real ainda não conectado no modo gratuito.'};
    }
    if(endpoint==='/api/status'){
      return {available:false,sources:{},
        note:'Catálogo GTFS estático. Sem telemetria ao vivo.'};
    }
    if(endpoint==='/api/stops'){
      const q=fold(u.searchParams.get('q')||'').trim();
      const found=stopIndex.filter(s=>!q||fold(s.name).includes(q)||fold(s.id).includes(q));
      return {items:found.slice(0,50).map(stopObj),truncated:found.length>50,query:q};
    }
    if(endpoint==='/api/nearby-stops'){
      const lat=Number(u.searchParams.get('lat')),lng=Number(u.searchParams.get('lng'));
      if(!Number.isFinite(lat)||!Number.isFinite(lng))throw Error('Coordenadas inválidas');
      const radius=2500;
      const delta=radius/110000;
      const ranked=candidates(lat-delta,lng-delta*1.15,lat+delta,lng+delta*1.15)
        .map(s=>({...s,distanceM:distance(lat,lng,s.lat,s.lng)}))
        .filter(s=>s.distanceM<=radius).sort((a,b)=>a.distanceM-b.distanceM);
      return {items:ranked.slice(0,15),count:ranked.length};
    }
    if(endpoint==='/api/map-stops'){
      const a=Number(u.searchParams.get('minlat')),b=Number(u.searchParams.get('minlng')),
        c=Number(u.searchParams.get('maxlat')),d=Number(u.searchParams.get('maxlng'));
      if(![a,b,c,d].every(Number.isFinite)||a>c||b>d)throw Error('Limites inválidos');
      const visible=candidates(a,b,c,d).filter(s=>a<=s.lat&&s.lat<=c&&b<=s.lng&&s.lng<=d);
      return {items:visible.slice(0,550).map(stopObj),
        total:visible.length,truncated:visible.length>550};
    }
    if(endpoint==='/api/stop'){
      const id=String(u.searchParams.get('id')||'');
      if(!stops[id])throw Error('Ponto não encontrado');
      stopRoutes ||=await data('routing-stop-routes.json');
      const codes=stopRoutes[id]||[];
      let forecast=null;
      let timetableAvailable=false;
      let expired=false;
      if(typeof StaticArrivals!=='undefined'){
        try{
          forecast=await StaticArrivals.lookup(id);
          timetableAvailable=forecast.available;
          expired=forecast.expired;
        }catch(error){
          // Failed timetable loading must not hide the stop or its GTFS lines.
          console.warn('Horários deste ponto indisponíveis',error);
        }
      }
      const stopPatterns=await getStopPatterns();
      const destinationGroups=new Map();
      for(const p of stopPatterns.get(id)||[]){
        const line=lines.find(r=>r.id===String(p.route));
        if(!line)continue;
        const dest=String(p.headsign||'').trim();
        if(!destinationGroups.has(line.code))destinationGroups.set(line.code,new Set());
        destinationGroups.get(line.code).add(dest);
      }
      const routes=[];
      for(const code of codes){
        const line=routeIndex.get(String(code).toUpperCase());
        const destinations=destinationGroups.get(String(code))||new Set(['']);
        const name=line?.name||String(code);
        for(const destination of destinations){
          const arrival=forecast?.byDirection.get(String(code)+'\u0000'+destination)||null;
          routes.push({code:String(code),name,destination,nextArrival:arrival});
        }
        // A scheduled destination can exist without a geometry headsign match.
        if(forecast){
          for(const [key,arrival] of forecast.byDirection){
            const [route,destination]=key.split('\u0000');
            if(route===String(code)&&!destinations.has(destination))
              routes.push({code:String(code),name,destination,nextArrival:arrival});
          }
        }
      }
      routes.sort((a,b)=>(a.nextArrival?0:1)-(b.nextArrival?0:1)||
        ((a.nextArrival?.minutes??99999)-(b.nextArrival?.minutes??99999))||
        a.code.localeCompare(b.code));
      return {id,name:stops[id][0],lat:stops[id][1],lng:stops[id][2],
        asOf:new Date().toISOString(),routes,
        forecastSource:expired?'GTFS expirado':'GTFS scheduled (not GPS)',
        timetableAvailable,expired};
    }
    throw Error('Endpoint ainda não disponível no modo estático: '+endpoint);
  }
  return {api,init};
})();
