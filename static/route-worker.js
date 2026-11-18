/* Externo BH P7 — client-side Connection Scan (CSA-like) in a Web Worker.
 * Only static GTFS files: no APIs/paid routing server, no transmission of
 * the user's origin/destination to any routing endpoint.
 *
 * Binary scan shards are built by scripts/build_static_scan.py:
 * 5 little-endian uint32 per connection [from,to,depart,arrive,packed].
 * GTFS calendar, service day >24h and pickup/dropoff restrictions apply.
 * Metro is deliberately displayed as a non-timed suggestion only.
 */
'use strict';
const HOUR=3600000, MIN=60000, DAY=86400000, MAX_HOURS=5;
const TRIP_MASK=(1<<20)-1,BOARD=1<<20,ALIGHT=1<<21;
const BUFFER=45000,WALK_SPEED=1.15,WALK_FACTOR=1.35,MAX_RIDES=3;
const MAX_SCANNED=2100000,MAX_LABELS=12,MAX_ONBOARD=12;
const cityTZ='America/Sao_Paulo';
try{importScripts('./walk-network.js')}catch(e){/* optional; no fabricated graph */}
try{importScripts('./metro-timing.js')}catch(e){/* old rail hints remain available */}
let walkGraph=null,walkLoad=null,walkGraphStatus='not_loaded';
let root='',meta=null,stops=null,trips=null,grid=null,stopLines=null,metro=null;
let currentSeq=0;
const bucketCache=new Map(),nearCache=new Map();

function bhDay(time) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:cityTZ,year:'numeric',
    month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
  const item=type=>parts.find(p=>p.type===type).value;
  return item('year')+'-'+item('month')+'-'+item('day');
}
function addDay(day,delta) {
  return new Date(Date.parse(day+'T12:00:00Z')+delta*DAY).toISOString().slice(0,10);
}
function midnight(day){return Date.parse(day+'T00:00:00-03:00');}
function stamp(epoch){return new Date(epoch).toISOString();}
function distance(a,b) {
  const dlat=(b[0]-a[0])*Math.PI/180,dlon=(b[1]-a[1])*Math.PI/180;
  const la=a[0]*Math.PI/180,lb=b[0]*Math.PI/180;
  const h=Math.sin(dlat/2)**2+Math.cos(la)*Math.cos(lb)*Math.sin(dlon/2)**2;
  return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.max(0,h))));
}
const cell=(a,b)=>Math.floor(a*200)+','+Math.floor(b*200);
const walkSeconds=m=>Math.max(20,Math.ceil(m*WALK_FACTOR/WALK_SPEED+25));
const rounded=m=>Math.round(m*WALK_FACTOR);
function coord(p){
  if(!p||!Number.isFinite(Number(p.lat))||!Number.isFinite(Number(p.lng)))throw Error('Coordenadas inválidas');
  const a=Number(p.lat),b=Number(p.lng);
  if(a < -20.5||a >-19.5||b < -44.4||b >-43.5)throw Error('Selecione um local na região de Belo Horizonte');
  return [a,b];
}
function norm(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')}
async function loadBinary(url) {
  const response=await fetch(url,{cache:'force-cache'});
  if(!response.ok)throw Error('Arquivo GTFS indisponível (HTTP '+response.status+')');
  const raw=await response.arrayBuffer();
  if(raw.byteLength>=2 && new Uint8Array(raw,0,2)[0]===31
      && new Uint8Array(raw,0,2)[1]===139) {
    if(typeof DecompressionStream==='undefined')throw Error('Navegador sem suporte a gzip');
    return new Response(new Blob([raw]).stream().pipeThrough(
      new DecompressionStream('gzip'))).arrayBuffer();
  }
  return raw; // Some hosts transparently decode .gz (Content-Encoding).
}
async function jsonGzip(url){
  return JSON.parse(new TextDecoder().decode(await loadBinary(url)));
}
async function bootstrap(base) {
  if(meta&&root===base)return;
  root=base.endsWith('/')?base:base+'/';
  meta=null;stops=null;trips=null;grid=null;metro=null;
  bucketCache.clear();nearCache.clear();
  const response=await fetch(root+'index.json',{cache:'no-store'});
  if(!response.ok)throw Error('Catálogo estático não publicado: '+response.status);
  const m=await response.json();
  if(![1,2].includes(m.schema)||m.format?.indexOf('uint32le/5')!==0)
    throw Error('Versão do catálogo de roteamento incompatível');
  const version='?v='+encodeURIComponent(m.builtUTC);
  const [s,t]=await Promise.all([
    jsonGzip(root+'stops.json.gz'+version),
    jsonGzip(root+'trips.json.gz'+version)
  ]);
  if(s.length!==m.stopCount||t.length!==m.tripCount)
    throw Error('Índice GTFS incompleto ou com versões divergentes');
  meta=m;stops=s;trips=t;
  grid=new Map();
  for(let i=0;i<stops.length;i++){
    const key=cell(stops[i][2],stops[i][3]);
    if(!grid.has(key))grid.set(key,[]);
    grid.get(key).push(i);
  }
  self.postMessage({kind:'ready',builtUTC:m.builtUTC,tripCount:m.tripCount,
    stopCount:m.stopCount,connectionCount:m.connectionCount});
}
function nearby(lat,lng,radius=1050,limit=22) {
  const result=[],span=Math.ceil(radius/400)+1;
  const x=Math.floor(lat*200),y=Math.floor(lng*200);
  for(let dx=-span;dx<=span;dx++)
    for(let dy=-span;dy<=span;dy++)
      for(const idx of grid.get((x+dx)+','+(y+dy))||[]){
        const s=stops[idx],metres=distance([lat,lng],[s[2],s[3]]);
        if(metres<=radius)result.push([metres,idx]);
      }
  result.sort((a,b)=>a[0]-b[0]);
  if(result.length<=limit||limit<40)return result.slice(0,limit);
  // For access/egress do NOT select only the geographically nearest stops:
  // in central BH dozens of near-side bays can crowd out a different line
  // two streets away. Retain the very nearest, then sample across 16
  // directions and 3 distance bands before running OSM street Dijkstra.
  const chosen=result.slice(0,Math.min(24,Math.ceil(limit/5)));
  const buckets=Array.from({length:48},()=>[]);
  for(const candidate of result.slice(chosen.length)){
    const stop=stops[candidate[1]];
    const east=(stop[3]-lng)*Math.cos(lat*Math.PI/180);
    const north=stop[2]-lat;
    const direction=(Math.atan2(north,east)+2*Math.PI)%(2*Math.PI);
    const sector=Math.min(15,Math.floor(direction/(2*Math.PI)*16));
    const band=Math.min(2,Math.floor(candidate[0]/Math.max(1,radius)*3));
    buckets[sector*3+band].push(candidate);
  }
  let pending=true;
  while(chosen.length<limit&&pending){
    pending=false;
    for(const bucket of buckets){
      if(!bucket.length)continue;
      pending=true;chosen.push(bucket.shift());
      if(chosen.length===limit)break;
    }
  }
  return chosen;
}
function neighbors(idx,expanded=false) {
  // Extended-mode inter-stop walks can recover alternatives that change
  // lines around a large avenue/interchange. Every pedestrian segment is
  // subsequently checked against actual OSM streets before being returned.
  const radius=expanded?450:300,limit=expanded?28:18;
  const key=idx+':'+radius;
  if(nearCache.has(key))return nearCache.get(key);
  const s=stops[idx];
  const list=nearby(s[2],s[3],radius,limit)
    .filter(([m,id])=>id!==idx&&m>=2);
  if(nearCache.size>20000)nearCache.clear();
  nearCache.set(key,list);
  return list;
}
function serviceActive(serviceIdx,day){
  const svc=meta.services[serviceIdx];
  if(!svc)return false;
  const compact=day.replaceAll('-','');
  const exception=meta.exceptions?.[compact]?.[svc.id];
  if(exception!=null)return Number(exception)===1;
  const cal=svc.calendar;
  if(!cal||compact<cal.start_date||compact>cal.end_date)return false;
  const week=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
  const wd=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  return String(cal[wd[week]])==='1';
}
async function bucket(direction,h,group='legacy') {
  const hh=String(h).padStart(2,'0');
  const details=meta.schema===2
    ?meta.hours[direction]?.[group]?.[hh]
    :meta.hours[direction]?.[hh];
  if(!details)return new Uint32Array(0);
  const id=direction+':'+group+':'+h;
  if(bucketCache.has(id))return bucketCache.get(id);
  const suffix=meta.schema===2?group+'/'+hh:hh;
  const url=root+direction+'/'+suffix+'.bin.gz?v='+
    encodeURIComponent(meta.builtUTC);
  const buffer=await loadBinary(url);
  // Fail closed if an old, incomplete or mismatched CDN shard is returned.
  if(buffer.byteLength!==details.connections*20)
    throw Error('Dados GTFS inconsistentes. Atualize a página para recuperar o catálogo: '+id);
  const data=new Uint32Array(buffer);
  bucketCache.set(id,data);
  if(bucketCache.size>12)bucketCache.delete(bucketCache.keys().next().value);
  return data;
}
function dominates(a,b,backward){
  return (backward?a.time>=b.time:a.time<=b.time)
    && a.walk<=b.walk+.01 && a.rides<=b.rides;
}
function insert(labels,node,ctx) {
  const existing=labels.get(node.stop)||[];
  for(const other of existing)if(dominates(other,node,ctx.backward))return false;
  const kept=existing.filter(other=>!dominates(node,other,ctx.backward));
  kept.push(node);
  if(kept.length>ctx.maxLabels){
    ctx.partial=true;ctx.partialReasons.labels++;
    kept.sort((a,b)=>(a.walk/90+a.rides*15+(ctx.backward?-a.time:a.time)/60000)
                  -(b.walk/90+b.rides*15+(ctx.backward?-b.time:b.time)/60000));
    kept.splice(ctx.maxLabels);
  }
  labels.set(node.stop,kept);
  return kept.includes(node);
}
function addTransfers(node,ctx){
  if(!ctx.pending.has(node.stop))ctx.pending.add(node.stop);
  for(const [m,next] of neighbors(node.stop,ctx.expanded)){
    const duration=walkSeconds(m)*1000;
    const newTime=node.time+(ctx.backward?-duration:duration);
    if(newTime<ctx.lo||newTime>ctx.hi)continue;
    const walk=node.walk+rounded(m);
    const edge=ctx.backward
      ?{mode:'walk',from:next,to:node.stop,departure:newTime,arrival:node.time,
        metersApprox:rounded(m),pathVerified:false}
      :{mode:'walk',from:node.stop,to:next,departure:node.time,arrival:newTime,
        metersApprox:rounded(m),pathVerified:false};
    const sibling={stop:next,time:newTime,walk,rides:node.rides,
       prev:node,edge};
    // Deliberately one walking connector per change of vehicle; no recursive
    // infinite walking paths or chaining dozens of pedestrian hops.
    if(insert(ctx.labels,sibling,ctx))ctx.pending.add(next);
  }
}
function appendOnboard(map,key,candidate,ctx){
  const before=map.get(key)||[];
  if(before.some(other=>other.prev===candidate.prev&&other.endStop===candidate.endStop))return;
  if(before.some(other=>(other.prev.walk<=candidate.prev.walk &&
       other.prev.rides<=candidate.prev.rides &&
       (ctx.backward?other.endTime>=candidate.endTime:other.endTime<=candidate.endTime))))
    return;
  let next=before.filter(other=>!(candidate.prev.walk<=other.prev.walk&&
    candidate.prev.rides<=other.prev.rides&&
    (ctx.backward?candidate.endTime>=other.endTime:candidate.endTime<=other.endTime)));
  next.push(candidate);
  if(next.length>ctx.maxOnboard){
    ctx.partial=true;ctx.partialReasons.onboard++;
    next.sort((a,b)=>a.prev.walk-b.prev.walk||a.prev.rides-b.prev.rides);
    next=next.slice(0,ctx.maxOnboard);
  }
  map.set(key,next);
}
function emit(node,ctx) {
  if(!insert(ctx.labels,node,ctx))return;
  const ending=ctx.ends.get(node.stop);
  if(ending!==undefined){
    const seconds=typeof ending==='number'?walkSeconds(ending):ending.seconds;
    const meters=typeof ending==='number'?rounded(ending):ending.meters;
    const ms=seconds*1000;
    // Reverse planning reserves a minimum boarding buffer at the very first
    // boarding point, just as forward planning does.
    const endTime=node.time+(ctx.backward?-(ms+BUFFER):ms);
    if(endTime>=ctx.lo&&endTime<=ctx.hi){
      ctx.finals.push({node,time:endTime,meters,endingSeconds:seconds});
      if(ctx.finals.length>1000){
        ctx.partial=true;ctx.partialReasons.finals++;ctx.finals.splice(1000);
      }
    }
  }
  addTransfers(node,ctx);
}
function processConnection(conn,ctx){
  const {from,to,dep,arr,flags,tripIdx,day}=conn;
  const key=day+':'+tripIdx;
  if(ctx.backward){
    // A passenger can alight at 'to' if GTFS drop_off_type permits it.
    if(flags&ALIGHT){
      for(const label of ctx.labels.get(to)||[]){
        if(label.rides>=MAX_RIDES)continue;
        const buffer=label.rides===0?0:BUFFER;
        if(label.time<arr+buffer)continue;
        appendOnboard(ctx.onboard,key,{prev:label,endStop:to,endTime:arr},ctx);
      }
    }
    if(flags&BOARD){
      for(const aboard of ctx.onboard.get(key)||[]){
        const node={stop:from,time:dep,rides:aboard.prev.rides+1,
          walk:aboard.prev.walk,prev:aboard.prev,
          edge:{mode:'bus',tripIdx,from,to:aboard.endStop,
            departure:dep,arrival:aboard.endTime}};
        emit(node,ctx);
      }
    }
  }else{
    if(flags&BOARD){
      for(const label of ctx.labels.get(from)||[]){
        if(label.rides>=MAX_RIDES||label.time+BUFFER>dep)continue;
        appendOnboard(ctx.onboard,key,{prev:label,endStop:from,endTime:dep},ctx);
      }
    }
    if(flags&ALIGHT){
      for(const aboard of ctx.onboard.get(key)||[]){
        const node={stop:to,time:arr,rides:aboard.prev.rides+1,
          walk:aboard.prev.walk,prev:aboard.prev,
          edge:{mode:'bus',tripIdx,from:aboard.endStop,to,
            departure:aboard.endTime,arrival:arr}};
        emit(node,ctx);
      }
    }
  }
}
function reconstruct(hit,ctx) {
  const all=[];
  let label=hit.node;
  while(label){
    if(label.edge)all.push({...label.edge});
    label=label.prev;
  }
  if(!ctx.backward)all.reverse();
  const endWalk=ctx.backward
    ?{mode:'walk',from:'origin',to:hit.node.stop,
      departure:hit.time,arrival:hit.node.time-BUFFER,
      metersApprox:hit.meters,pathVerified:false}
    :{mode:'walk',from:hit.node.stop,to:'destination',
      departure:hit.node.time,arrival:hit.time,
      metersApprox:hit.meters,pathVerified:false};
  const legs=ctx.backward?[endWalk,...all]:[...all,endWalk];
  const buses=legs.filter(leg=>leg.mode==='bus');
  if(!buses.length)return null;
  // A reverse search seeds the final walk using the latest arrival deadline.
  // Display the physical final arrival after the bus, not artificial waiting.
  if(ctx.backward&&legs.at(-1)?.mode==='walk'){
    const lastBus=buses.at(-1);
    const walk=legs.at(-1);
    // Reuse the real street-network walk time, not a second Euclidean
    // estimate. This matters for arriveBy routes near the deadline.
    const duration=(hit.endingSeconds??walkSeconds(
      walk.metersApprox/WALK_FACTOR))*1000;
    walk.departure=lastBus.arrival;walk.arrival=lastBus.arrival+duration;
    if(walk.arrival>ctx.requested)return null;
  }
  for(const leg of legs){
    if(leg.mode!=='bus')continue;
    const t=trips[leg.tripIdx],a=stops[leg.from],b=stops[leg.to];
    leg.tripId=t[0];leg.line=t[1];leg.headsign=t[2];
    leg.fromName=a[1];leg.toName=b[1];
    leg.fromCoords=[a[2],a[3]];leg.toCoords=[b[2],b[3]];
    leg.prediction='GTFS scheduled';
    delete leg.tripIdx;
  }
  for(const leg of legs){
    if(leg.mode==='walk'){
      const a=typeof leg.from==='number'?stops[leg.from]:null;
      const b=typeof leg.to==='number'?stops[leg.to]:null;
      if(a)leg.fromName=a[1];
      if(b)leg.toName=b[1];
    }
    leg.departure=stamp(leg.departure);
    leg.arrival=stamp(leg.arrival);
  }
  const begin=Date.parse(legs[0].departure);
  const finish=Date.parse(legs.at(-1).arrival);
  if(!(finish>begin)||finish-begin>MAX_HOURS*HOUR)return null;
  return {
    departure:stamp(begin),arrival:stamp(finish),
    durationMinutes:Math.round((finish-begin)/MIN),
    walkMetersApprox:Math.round(hit.node.walk+hit.meters),
    rides:buses.length,transfers:buses.length-1,
    legs,confidence:'scheduled_gtfs_with_unverified_walks'
  };
}
async function ensureWalkingGraph(){
  if(walkGraphStatus==='missing')return null;
  if(walkGraph)return walkGraph;
  if(walkLoad)return walkLoad;
  if(typeof WalkGraph==='undefined'){
    walkGraphStatus='missing';return null;
  }
  walkLoad=(async()=>{
    try{
      const url=new URL('../walk/graph.json.gz',root).href;
      // One request only: the graph is ~6 MB compressed. A preliminary
      // existence GET would double the paid-by-traffic Hosting bandwidth.
      const bytes=await loadBinary(url);
      const value=JSON.parse(new TextDecoder().decode(bytes));
      walkGraph=new WalkGraph.Network(value);
      walkGraphStatus='ready';
      return walkGraph;
    }catch(err){
      walkGraphStatus='missing';
      console.warn('Rede de pedestres OSM ausente ou incompleta',String(err));
      return null;
    }
  })();
  return walkLoad;
}
function locationOf(endpoint,ctx){
  if(endpoint==='origin')return ctx.origin;
  if(endpoint==='destination')return ctx.destination;
  const s=stops[endpoint];
  return s?[s[2],s[3]]:null;
}
function verifyWalking(itinerary,ctx,graph){
  const legs=itinerary.legs;
  let walked=0,unknown=false;
  for(let i=0;i<legs.length;i++){
    const leg=legs[i];
    if(leg.mode!=='walk')continue;
    const from=locationOf(leg.from,ctx),to=locationOf(leg.to,ctx);
    if(!from||!to)return false;
    const route=graph.route(from,to,i===0||i===legs.length-1?2500:800);
    if(!route)return false;
    leg.pathVerified=true;
    leg.geometry=route.geometry;
    leg.snapMeters=route.snapMeters;
    leg.metersApprox=route.meters;
    leg.walkSource=route.pathSource;
    leg.durationSeconds=route.seconds;
    walked+=route.meters;
    const prev=legs[i-1],next=legs[i+1];
    let start;
    if(prev&&prev.mode==='bus'){
      start=Date.parse(prev.arrival);
    }else if(i===0&&ctx.backward&&next?.mode==='bus'){
      start=Date.parse(next.departure)-route.seconds*1000-BUFFER;
    }else if(i===0){
      start=ctx.requested;
    }else if(prev){
      start=Date.parse(prev.arrival);
    }else return false;
    const finish=start+route.seconds*1000;
    if(next?.mode==='bus'&&finish+BUFFER>Date.parse(next.departure))
      return false;
    leg.departure=stamp(start);
    leg.arrival=stamp(finish);
  }
  const first=Date.parse(legs[0].departure),last=Date.parse(legs.at(-1).arrival);
  if(!Number.isFinite(first)||!Number.isFinite(last)||last<=first||
     last-first>MAX_HOURS*HOUR||ctx.backward&&last>ctx.requested||
     !ctx.backward&&first<ctx.requested)return false;
  itinerary.walkMetersApprox=Math.round(walked);
  itinerary.departure=stamp(first);
  itinerary.arrival=stamp(last);
  itinerary.durationMinutes=Math.ceil((last-first)/MIN);
  itinerary.confidence='GTFS_scheduled_with_OSM_walk_graph_and_snap_uncertainty';
  return true;
}
function journeyQuality(trip){
  // Transparent, adjustable generalized cost, inspired by open source
  // multicriteria planners (NOT Google's or Moovit's proprietary weights).
  // The actual arrival/departure times remain unchanged.
  const duration=Math.max(0,Number(trip.durationMinutes)||0);
  const walking=Math.max(0,Number(trip.walkMetersApprox)||0)/(WALK_SPEED*60);
  const transfers=Math.max(0,Number(trip.transfers)||0);
  let tightTransfers=0,minimumTransferSeconds=null;
  let seenBus=false;
  for(let i=0;i<(trip.legs||[]).length;i++){
    const leg=trip.legs[i];
    if(leg.mode!=='bus')continue;
    if(seenBus){
      const previous=trip.legs[i-1];
      const slack=(Date.parse(leg.departure)-Date.parse(previous.arrival))/1000;
      if(Number.isFinite(slack)){
        minimumTransferSeconds=minimumTransferSeconds===null
          ?Math.round(slack):Math.min(minimumTransferSeconds,Math.round(slack));
        if(slack<120)tightTransfers++;
      }
    }
    seenBus=true;
  }
  const costMinutes=Math.round((duration+walking+
    transfers*4+tightTransfers*3)*10)/10;
  return {costMinutes,tightTransfers,minimumTransferSeconds,
    costBasis:'heuristic_duration_plus_walking_transfers_and_short_connections'};
}
function ranked(ctx,preference,limit=6) {
  const options=[];
  const found=new Set();
  for(const hit of ctx.finals){
    const trip=reconstruct(hit,ctx);
    if(!trip)continue;
    const signature=trip.legs.filter(l=>l.mode==='bus')
      .map(l=>l.tripId+'@'+l.from+'>'+l.to).join('|');
    if(found.has(signature))continue;
    found.add(signature);options.push(trip);
  }
  const fastest=(a,b)=>ctx.backward
    ?Date.parse(b.departure)-Date.parse(a.departure)
    :Date.parse(a.arrival)-Date.parse(b.arrival);
  options.sort((a,b)=>{
    if(preference==='leastTransfers')
      return a.transfers-b.transfers||fastest(a,b)||a.walkMetersApprox-b.walkMetersApprox;
    if(preference==='leastWalking')
      return a.walkMetersApprox-b.walkMetersApprox||fastest(a,b)||a.transfers-b.transfers;
    if(preference==='balanced')
      return journeyQuality(a).costMinutes-journeyQuality(b).costMinutes||
        fastest(a,b)||a.transfers-b.transfers;
    return fastest(a,b)||a.walkMetersApprox-b.walkMetersApprox||a.transfers-b.transfers;
  });
  // Reserve room for different combinations of bus lines, rather than
  // spending all 32/56 slots on departures of the same combination.
  // The chronological best candidates remain represented.
  if(limit<=6)return options.slice(0,limit);
  const selected=options.slice(0,Math.ceil(limit*.55));
  const selectedKeys=new Set(selected.map(t=>t.legs.filter(l=>l.mode==='bus')
    .map(l=>l.line).join('>')));
  for(const trip of options){
    if(selected.length>=limit)break;
    const key=trip.legs.filter(l=>l.mode==='bus').map(l=>l.line).join('>');
    if(selectedKeys.has(key))continue;
    selectedKeys.add(key);selected.push(trip);
  }
  for(const trip of options){
    if(selected.length>=limit)break;
    if(!selected.includes(trip))selected.push(trip);
  }
  return selected;
}
function summarizeTravelTimes(itinerary){
  // Separate scheduled waiting from riding and walking, so a 56 min route
  // can be compared meaningfully to another planner. These are elapsed
  // GTFS timetable times; they are NOT GPS predictions or traffic models.
  const start=Date.parse(itinerary.departure),end=Date.parse(itinerary.arrival);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return null;
  const total=end-start;
  let walk=0,ride=0;
  for(const leg of itinerary.legs||[]){
    const from=Date.parse(leg.departure),to=Date.parse(leg.arrival);
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<from)return null;
    if(leg.mode==='walk')walk+=to-from;
    else if(leg.mode==='bus')ride+=to-from;
  }
  if(walk+ride>total+60000)return null; // Discontinuous/overlapping GTFS.
  return {
    totalMinutes:Math.ceil(total/MIN),
    walkingMinutes:Math.round(walk/MIN),
    onboardMinutes:Math.round(ride/MIN),
    waitingMinutes:Math.max(0,Math.round((total-walk-ride)/MIN)),
    basis:'GTFS scheduled, walking access approximate'
  };
}
function paretoJourneys(items,backward){
  // Multi-criteria nondominance inspired by OTP Range RAPTOR, applied AFTER
  // timetable scanning + OSM verification. Unlike a score alone, this
  // preserves a route that trades slightly later arrival for fewer
  // transfers, shorter walk, or shorter elapsed trip.
  const data=items.map(t=>{
    const first=Date.parse(t.departure),last=Date.parse(t.arrival);
    return {time:backward?-first:last,elapsed:last-first,
      walking:Math.max(0,Number(t.walkMetersApprox)||0),
      transfers:Math.max(0,Number(t.transfers)||0),
      risky:journeyQuality(t).tightTransfers};
  });
  return items.filter((_,i)=>{
    const b=data[i];
    if(!Number.isFinite(b.time)||!Number.isFinite(b.elapsed))return false;
    return !data.some((a,j)=>i!==j&&
      a.time<=b.time&&a.elapsed<=b.elapsed&&
      a.walking<=b.walking&&a.transfers<=b.transfers&&
      a.risky<=b.risky&&
      (a.time<b.time||a.elapsed<b.elapsed||a.walking<b.walking||
       a.transfers<b.transfers||a.risky<b.risky));
  });
}
function chooseDiverseItineraries(sorted,limit=6){
  // Keep the earliest/shortest verified option first, but prevent five near-
  // duplicate departures from crowding out useful alternatives (e.g. 5106).
  const picked=[],counts=new Map();
  for(const trip of sorted){
    const signature=trip.legs.filter(l=>l.mode==='bus').map(l=>l.line).join('>');
    const amount=counts.get(signature)||0;
    if(amount>=2)continue;
    picked.push(trip);counts.set(signature,amount+1);
    if(picked.length===limit)return picked;
  }
  for(const trip of sorted){
    if(picked.length===limit)break;
    if(!picked.includes(trip))picked.push(trip);
  }
  return picked;
}
async function metroHints(origin,destination,at,railHintMode='departAt'){
  try{
    if(!metro){
      const path=new URL('../metro.json',root).href;
      const r=await fetch(path,{cache:'force-cache'});
      if(!r.ok)return [];
      metro=await r.json();
    }
    const near=(p)=>metro.stations.filter(s=>s.active&&distance(p,[s.lat,s.lng])<=1050)
      .sort((a,b)=>distance(p,[a.lat,a.lng])-distance(p,[b.lat,b.lng])).slice(0,3);
    const day=bhDay(at);
    const clock=new Intl.DateTimeFormat('en-GB',{timeZone:cityTZ,
      hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
    const hints=[];
    for(const a of near(origin))for(const b of near(destination))
      for(const line of metro.lines){
        if(a.id===b.id||!line.stations.includes(a.id)||!line.stations.includes(b.id))continue;
        let end=line.hours.end;
        for(const e of metro.operations.hoursExceptions||[])
          if(e.line===line.id&&e.from<=day&&day<=e.through)end=e.end;
        if(clock<line.hours.start||clock>=end)continue;
        const timings=typeof RailWindows!=='undefined'
          ?RailWindows.window(metro,line,a,b,at,railHintMode||'departAt',
            distance(origin,[a.lat,a.lng]),distance(destination,[b.lat,b.lng]))
          :null;
        hints.push({mode:'metro',line:line.id,fromStation:a.name,toStation:b.name,
          fromStationId:a.id,toStationId:b.id,
          stationCount:Math.abs(line.stations.indexOf(a.id)-line.stations.indexOf(b.id)),
          status:timings?'historical_range_estimate':'requires_timetable',
          timing:timings,
          note:timings?'Faixa temporal ilustrativa baseada em benchmark histórico da operadora e frequência típica. Não é uma partida garantida nem rota comparável ao GTFS.':
          'Metrô sem grade de partidas verificável: possibilidade informativa, não comparável às viagens GTFS.'});
      }
    return hints.slice(0,4);
  }catch(e){return []}
}
function seedStops(ctx,which) {
  const place=which==='start'?(ctx.backward?ctx.destination:ctx.origin)
                             :(ctx.backward?ctx.origin:ctx.destination);
  const found=nearby(...place,ctx.accessRadius,ctx.accessLimit);
  // Street access/egress is solved first, as in multimodal routing engines.
  // One bounded Dijkstra handles all candidate stops (not N repeated A*).
  const road=ctx.graph?.distancesToStops
    ?ctx.graph.distancesToStops(place,found.map(([,index])=>({
        index,coords:[stops[index][2],stops[index][3]]
      })),2500)
    :null;
  const hasRoadCosts=Boolean(road&&typeof road.has==='function'&&
    typeof road.get==='function');
  const candidates=hasRoadCosts?found.filter(([,id])=>road.has(id)):found;
  if(hasRoadCosts){
    const field=which==='start'?'streetOriginStops':'streetDestinationStops';
    ctx.accessStats[field]=candidates.length;
    ctx.accessStats.unreachableStops+=found.length-candidates.length;
  }
  if(which==='end'){
    for(const [metres,id] of candidates)
      ctx.ends.set(id,hasRoadCosts?road.get(id):metres);
    return;
  }
  for(const [metres,id] of candidates){
    const access=hasRoadCosts?road.get(id):null;
    const meters=access?access.meters:rounded(metres);
    const ms=(access?access.seconds:walkSeconds(metres))*1000;
    const t=ctx.requested+(ctx.backward?-ms:ms);
    const edge=ctx.backward
      ?{mode:'walk',from:id,to:'destination',departure:t,
        arrival:ctx.requested,metersApprox:meters,pathVerified:false}
      :{mode:'walk',from:'origin',to:id,departure:ctx.requested,
        arrival:t,metersApprox:meters,pathVerified:false};
    insert(ctx.labels,{stop:id,time:t,rides:0,walk:meters,
      prev:null,edge},ctx);
  }
}
async function scanHour(ctx,epoch) {
  const direction=ctx.backward?'in':'out';
  const parts=[];
  for(let dayDiff=-1;dayDiff<=1;dayDiff++){
    const d=addDay(bhDay(ctx.requested),dayDiff);
    const base=midnight(d);
    const hour=Math.floor((epoch-base)/HOUR);
    if(hour<0||hour>=48)continue;
    const active=meta.services.map((_,i)=>serviceActive(i,d));
    if(!active.some(Boolean))continue;
    const groups=meta.schema===2
      ?[...new Set(meta.services.filter((_,i)=>active[i]).map(s=>s.group))]
      :['legacy'];
    for(const group of groups){
      const detail=meta.schema===2
        ?meta.hours[direction]?.[group]?.[String(hour).padStart(2,'0')]
        :meta.hours[direction]?.[String(hour).padStart(2,'0')];
      if(detail)parts.push({day:d,base,hour,group,ptr:0,active});
    }
  }
  const arrays=await Promise.all(parts.map(p=>bucket(direction,p.hour,p.group)));
  for(let i=0;i<parts.length;i++)parts[i].rows=arrays[i];
  // Multiple GTFS service days can overlap the same clock hour due to 24h+ trips.
  // Merge their sorted connections, respecting actual timeline order.
  while(true){
    let chosen=null,best=ctx.backward?-Infinity:Infinity;
    for(const p of parts){
      if(p.ptr>=p.rows.length)continue;
      const value=p.base+p.rows[p.ptr+(ctx.backward?3:2)]*1000;
      if((ctx.backward?value>best:value<best)){
        best=value;chosen=p;
      }
    }
    if(!chosen)break;
    const p=chosen,offset=p.ptr,values=p.rows;
    p.ptr+=5;
    if(best<ctx.lo||best>ctx.hi)continue;
    const packed=values[offset+4],tripIdx=packed&TRIP_MASK;
    const info=trips[tripIdx];
    if(!info||!p.active[info[3]])continue;
    ctx.scanned++;
    if(ctx.scanned>MAX_SCANNED){ctx.partial=true;ctx.partialReasons.scanLimit++;ctx.exceeded=true;return}
    processConnection({from:values[offset],to:values[offset+1],
      dep:p.base+values[offset+2]*1000,arr:p.base+values[offset+3]*1000,
      flags:packed,tripIdx,day:p.day},ctx);
  }
}
async function plan(params,seq) {
  if(!meta)throw Error('Catálogo GTFS ainda não carregado');
  const origin=coord(params.origin),destination=coord(params.destination);
  const mode=params.mode||'departAt';
  if(mode!=='departAt'&&mode!=='arriveBy')throw Error('Modo de viagem inválido');
  const preference=params.preference||'fastest';
  if(!['fastest','leastWalking','leastTransfers','balanced'].includes(preference))
    throw Error('Critério de ordenação inválido');
  const requested=params.at?Date.parse(params.at):Date.now();
  if(!Number.isFinite(requested))throw Error('Data/hora inválida');
  const date=bhDay(requested).replaceAll('-','');
  if(date<meta.validFrom||date>meta.validThrough)
    return {status:'out_of_calendar',message:'Data fora da validade do GTFS',
      validFrom:meta.validFrom,validThrough:meta.validThrough,itineraries:[],metroHints:[]};
  const backward=mode==='arriveBy';
  const expanded=params.searchDepth==='expanded';
  const ctx={origin,destination,mode,backward,requested,preference,expanded,labels:new Map(),
    onboard:new Map(),ends:new Map(),finals:[],pending:new Set(),
    scanned:0,partial:false,exceeded:false,
    maxLabels:expanded?24:MAX_LABELS,maxOnboard:expanded?24:MAX_ONBOARD,
    // Keep multiple viable boarding corridors, not just the first bays.
    // OSM Dijkstra is bounded to 160 nodes per endpoint.
    accessRadius:expanded?1700:1300,accessLimit:expanded?160:120,
    partialReasons:{labels:0,onboard:0,finals:0,scanLimit:0},
    graph:null,
    accessStats:{streetOriginStops:null,streetDestinationStops:null,unreachableStops:0},
    lo:backward?requested-MAX_HOURS*HOUR:requested,
    hi:backward?requested:requested+MAX_HOURS*HOUR};
  // The offline OSM graph is a static file, not a paid routing API.
  // Graph-aware access times are calculated BEFORE timetable scanning.
  const graph=await ensureWalkingGraph();
  ctx.graph=graph;
  seedStops(ctx,'start');seedStops(ctx,'end');
  const first=Math.floor(ctx.lo/HOUR),last=Math.floor(ctx.hi/HOUR);
  const hours=[];
  for(let h=first;h<=last;h++)hours.push(h*HOUR);
  if(backward)hours.reverse();
  for(const [i,epoch] of hours.entries()){
    if(seq!==currentSeq)throw Error('Busca substituída');
    await scanHour(ctx,epoch);
    if(ctx.exceeded)break;
    self.postMessage({kind:'progress',seq,done:i+1,total:hours.length,
      found:ctx.finals.length,scanned:ctx.scanned});
  }
  // P21: verify more than the first 32 timetable candidates on the OSM
  // streets graph. Faster trips can be ranked after a crowd of unwalkable
  // alternatives; pre-cutting them produced false "best route" claims.
  const candidates=ranked(ctx,preference,graph?(expanded?96:56):24);
  let itineraries=candidates;
  let rejectedWalkCandidates=0;
  if(graph){
    itineraries=candidates.filter(t=>{
      const valid=verifyWalking(t,ctx,graph);
      if(!valid)rejectedWalkCandidates++;
      return valid;
    });
    const score=t=>preference==='leastWalking'?t.walkMetersApprox:
      preference==='leastTransfers'?t.transfers:
      preference==='balanced'?journeyQuality(t).costMinutes:
      backward?-Date.parse(t.departure):Date.parse(t.arrival);
    itineraries.sort((a,b)=>score(a)-score(b)||
      a.walkMetersApprox-b.walkMetersApprox||a.transfers-b.transfers);
  }
  const streetVerified=itineraries;
  itineraries=paretoJourneys(streetVerified,backward);
  const paretoRetainedCount=itineraries.length;
  let diagnostics=null;
  if(params.diagnostics===true){
    // Opt-in offline diagnostics: expose WHY a requested combination is
    // absent. Ordinary users never download or render this extra payload.
    const combo=t=>t.legs.filter(x=>x.mode==='bus').map(x=>x.line).join('+');
    const counts=arr=>{
      const map=new Map();
      for(const t of arr)map.set(combo(t),(map.get(combo(t))||0)+1);
      return map;
    };
    const all=ranked(ctx,preference,1000);
    const allCounts=counts(all),shortCounts=counts(candidates);
    const validCounts=counts(streetVerified);
    const paretoCounts=counts(itineraries);
    const requested=Array.isArray(params.focusCombinations)
      ?params.focusCombinations.filter(x=>typeof x==='string'&&
        /^[a-zA-Z0-9+ -]{2,80}$/.test(x)).slice(0,12)
      :[];
    const focus=requested.map(lines=>({
      lines,
      generated:allCounts.get(lines)||0,
      shortlisted:shortCounts.get(lines)||0,
      streetVerified:validCounts.get(lines)||0,
      paretoRetained:paretoCounts.get(lines)||0
    }));
    diagnostics={originalFinalLabels:ctx.finals.length,
      fullUniqueItineraries:all.length,shortlisted:candidates.length,
      passedStreetVerification:streetVerified.length,
      paretoRetained:itineraries.length,
      combinationsGenerated:allCounts.size,
      combinationsShortlisted:shortCounts.size,
      combinationsStreetVerified:validCounts.size,
      focus};
  }
  itineraries=chooseDiverseItineraries(itineraries,6);
  for(const trip of itineraries){
    const summary=summarizeTravelTimes(trip);
    if(summary)trip.timeBreakdown=summary;
    trip.journeyQuality=journeyQuality(trip);
  }
  const hints=await metroHints(origin,destination,requested,mode);
  const noPedestrianAccess=Boolean(graph&&
    (ctx.accessStats.streetOriginStops===0||
     ctx.accessStats.streetDestinationStops===0));
  return {
    status:noPedestrianAccess||
      (graph&&!itineraries.length&&ctx.finals.length)
      ?'walking_unavailable':ctx.partial?'partial':'ok',mode,preference,
    requestedAt:stamp(requested),itineraries,metroHints:hints,
    ...(diagnostics?{diagnostics}:{}),
    stats:{connectionsScanned:ctx.scanned,hoursScanned:hours.length,
      searchDepth:expanded?'expanded':'standard',
      boardingStopRadiusMeters:ctx.accessRadius,
      accessStopLimit:ctx.accessLimit,
      transferWalkRadiusMeters:expanded?450:300,
      pedestrianAccess:graph?'OSM street shortest paths':'estimated distance',
      verifiedStreetOriginStops:ctx.accessStats.streetOriginStops,
      verifiedStreetDestinationStops:ctx.accessStats.streetDestinationStops,
      inaccessibleStreetCandidates:ctx.accessStats.unreachableStops,
      walkCandidatesEvaluated:graph?candidates.length:0,
      walkCandidatesRejected:rejectedWalkCandidates,
      paretoRetainedBeforeResultLimit:paretoRetainedCount,
      labelsPerStopLimit:ctx.maxLabels,onboardLimit:ctx.maxOnboard,
      truncatedLabels:ctx.partial,partialReasons:ctx.partialReasons},
    pedestrianRouting:graph?'osm_walk_graph_with_unverified_access_snap':'approximate',
    walkingNetworkStatus:walkGraphStatus,
    walkingNetworkSource:graph?.meta?.source||null,
    dataSource:'static_gtfs_browser_worker',
    notes:[
      'Horários de ônibus programados no GTFS, não previsões GPS.',
      graph?
        'Caminhadas avaliadas na rede OSM; o acesso do ponto de partida ou parada ao caminho ainda exige validação.':
        'Rede de ruas OSM não instalada: caminhadas em linha reta aproximada, NÃO percursos reais.',
      'Busca limitada a 5 h e no máximo 2 baldeações; resultado parcial quando houver poda.',
      'Metrô apenas informativo até termos grade verificável de partidas.'
    ]
  };
}
async function searchPlaces(query){
  if(!stops)throw Error('Catálogo indisponível');
  const q=norm(query).trim();
  if(q.length<2)return [];
  const candidates=[];
  try{
    if(!metro){
      const response=await fetch(new URL('../metro.json',root).href,{cache:'force-cache'});
      if(response.ok)metro=await response.json();
    }
    for(const s of metro?.stations||[]){
      if(s.active&&norm(s.name).includes(q))
        candidates.push({lat:s.lat,lng:s.lng,label:'Metrô: '+s.name});
    }
  }catch(e){/* The bus stop search still works offline. */}
  for(const s of stops){
    if(norm(s[1]).includes(q)){
      candidates.push({lat:s[2],lng:s[3],label:'Ponto: '+s[1]});
      if(candidates.length>=12)break;
    }
  }
  return candidates.slice(0,12);
}
self.onmessage=async event=>{
  const msg=event.data||{};
  const seq=Number(msg.seq)||++currentSeq;
  currentSeq=seq;
  if(msg.kind==='cancel')return;
  try{
    if(msg.kind==='init'){
      await bootstrap(msg.baseUrl);
    }else if(msg.kind==='places'){
      if(!meta)await bootstrap(msg.baseUrl);
      self.postMessage({kind:'places',seq,which:msg.which,
        items:await searchPlaces(msg.query)});
    }else if(msg.kind==='plan'){
      if(!meta)await bootstrap(msg.baseUrl);
      const data=await plan(msg.params,seq);
      if(seq===currentSeq)self.postMessage({kind:'result',seq,data});
    }
  }catch(err){
    if(seq===currentSeq)self.postMessage({kind:'error',seq,message:String(err?.message||err)});
  }
};
