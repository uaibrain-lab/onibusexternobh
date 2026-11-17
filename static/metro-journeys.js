/* P9 metro timetable-free, bounded *interval* travel estimates.
 * No exact rail departure or GPS is claimed. Validates operator hours and
 * published headways; line 2 without confirmed frequency stays unbounded.
 * Historical travel-time references are in catalog/metro.json operations.
 */
'use strict';
(function(global){
const RAD=Math.PI/180,MIN=60000;
function dist(a,b){
 const dp=(b[0]-a[0])*RAD,dl=(b[1]-a[1])*RAD;
 return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.max(0,
  Math.sin(dp/2)**2+Math.cos(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.sin(dl/2)**2))));
}
const walkMs=meters=>Math.ceil(Math.max(20,meters*1.35/1.13+25)*1000);
function local(moment){
 const p=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
  hour12:false}).formatToParts(new Date(moment));
 const v=x=>p.find(y=>y.type===x).value;
 const date=v('year')+'-'+v('month')+'-'+v('day');
 return {date,time:v('hour')+':'+v('minute'),
  day:(new Date(date+'T12:00:00Z').getUTCDay()+6)%7};
}
function lineState(metro,line,at){
 const now=local(at);
 let hours={...line.hours},headway=null;
 for(const item of metro.operations.hoursExceptions||[])
  if(item.line===line.id&&item.from<=now.date&&now.date<=item.through)
   hours.end=item.end;
 if(line.id==='1'){
   const period=metro.operations.headways['1'];
   if(now.day<=4){
     const peak=period.weekdays.peakWindows.some(([a,b])=>now.time>=a&&now.time<b);
     headway=peak?period.weekdays.peakMinutes:period.weekdays.offPeakMinutes;
   }else if(now.day===5){
     const [a,b]=period.saturday.morningWindow;
     headway=now.time>=a&&now.time<b?period.saturday.morningMinutes:period.saturday.otherMinutes;
   }else headway=period.sundayAndHolidays.minutes;
 }
 for(const item of metro.operations.exceptional||[])
  if(item.line===line.id&&item.from<=now.date&&now.date<=item.through&&now.time>=item.after)
   headway=item.headwayMinutes;
 return {open:now.time>=hours.start&&now.time<hours.end,
  hours,headway,reference:metro.operations.travelModel?.[line.id],
  date:now.date};
}
function routeMinutes(metro,line,a,b){
 const model=metro.operations.travelModel?.[line.id];
 if(!model)return null;
 const stations=new Map(metro.stations.map(s=>[s.id,s]));
 const length=(x,y)=>{
  const ix=line.stations.indexOf(x),iy=line.stations.indexOf(y);
  if(ix<0||iy<0||ix===iy)return 0;
  let sum=0;
  for(let i=Math.min(ix,iy);i<Math.max(ix,iy);i++){
   const st=stations.get(line.stations[i]),next=stations.get(line.stations[i+1]);
   if(!st||!next)return 0;
   sum+=dist([st.lat,st.lng],[next.lat,next.lng]);
  }
  return sum;
 };
 const base=length(model.referenceFrom,model.referenceTo);
 const segment=length(a,b);
 if(!base||!segment)return null;
 const guess=segment/base*model.referenceMinutes;
 const percent=Number(model.uncertaintyPercent||30)/100;
 return {estimated:guess,min:Math.max(1,guess*(1-percent)),
  max:Math.max(1.5,guess*(1+percent)),
  source:model.source,referenceDate:model.referenceDate};
}
function suggest(metro,origin,destination,epoch,mode='departAt'){
 if(!metro?.stations?.length)return [];
 const from=metro.stations.filter(s=>s.active&&dist(origin,[s.lat,s.lng])<=1300)
   .sort((a,b)=>dist(origin,[a.lat,a.lng])-dist(origin,[b.lat,b.lng])).slice(0,5);
 const to=metro.stations.filter(s=>s.active&&dist(destination,[s.lat,s.lng])<=1300)
   .sort((a,b)=>dist(destination,[a.lat,a.lng])-dist(destination,[b.lat,b.lng])).slice(0,5);
 const hints=[];
 for(const a of from)for(const b of to)for(const line of metro.lines){
  const ix=line.stations.indexOf(a.id),iy=line.stations.indexOf(b.id);
  if(!line.operational||ix<0||iy<0||ix===iy)continue;
  const ride=routeMinutes(metro,line,a.id,b.id);
  if(!ride)continue;
  const access=walkMs(dist(origin,[a.lat,a.lng])),
        egress=walkMs(dist(destination,[b.lat,b.lng]));
  // Validate metro operating hours at estimated *boarding time*,
  // rather than when the passenger leaves home (possibly before a long walk).
  const checkAt=mode==='departAt'
    ?epoch+access
    :epoch-egress-Math.ceil(ride.max*MIN);
  const state=lineState(metro,line,checkAt);
  if(!state.open)continue;
  const wait=state.headway==null?null:Math.ceil(state.headway*MIN);
  if(wait!=null&&mode==='departAt'){
    const latestBoard=local(checkAt+wait);
    if(latestBoard.date!==state.date||latestBoard.time>=state.hours.end)continue;
  }
  const effectiveLow=access+Math.ceil(ride.min*MIN)+egress;
  const effectiveHigh=wait==null?null:access+wait+Math.ceil(ride.max*MIN)+egress;
  let timeWindow=null;
  if(mode==='departAt'){
   timeWindow={
    earliestArrival:new Date(epoch+effectiveLow).toISOString(),
    latestArrival:effectiveHigh==null?null:new Date(epoch+effectiveHigh).toISOString()
   };
  }else{
   timeWindow={
    latestDeparture:new Date(epoch-effectiveLow).toISOString(),
    conservativeDeparture:effectiveHigh==null?null:new Date(epoch-effectiveHigh).toISOString()
   };
  }
  hints.push({mode:'metro',line:line.id,
   fromStation:a.name,toStation:b.name,
   fromStationId:a.id,toStationId:b.id,
   stationCount:Math.abs(ix-iy),status:'estimated_range_not_timetable',
   estimatedRideMinutes:Math.round(ride.estimated*10)/10,
   rideRangeMinutes:[Math.ceil(ride.min),Math.ceil(ride.max)],
   waitRangeMinutes:wait==null?null:[0,state.headway],
   timeWindow,estimatedWalkMeters:Math.round((access+egress)/1000*1.13),
   confidence:'low: published frequencies and historical travel time, NOT scheduled departures',
   source:ride.source,
   note:wait==null?'Sem intervalo publicado validado: chegada máxima desconhecida.':
        'Faixa aproximada baseada em frequência, NÃO na partida exata de um trem.'
  });
 }
 return hints.sort((a,b)=>{
  const aa=a.timeWindow.latestArrival||a.timeWindow.conservativeDeparture||'~';
  const bb=b.timeWindow.latestArrival||b.timeWindow.conservativeDeparture||'~';
  return aa.localeCompare(bb)
 }).slice(0,8);
}
function multimodal(metro,busItineraries,origin,destination,requested,mode='departAt'){
  // Combining a scheduled bus with an estimated rail trip must never
  // make an unverified transfer look like a confirmed boarding.
  if(mode!=='departAt')return [];
  const result=[],seen=new Set();
  function save(hint,bus,order){
    const fingerprint=order+':'+bus.tripId+':'+hint.line+':'+hint.fromStationId+':'+hint.toStationId;
    if(seen.has(fingerprint))return;
    seen.add(fingerprint);
    result.push({...hint,mode:order,status:'conditional_bus_metro',
      busLine:bus.line,busTripId:bus.tripId,
      busDeparture:bus.departure,busArrival:bus.arrival,
      confidence:'scheduled bus + uncertain metro boarding window; no guarantee',
      note:'Conexão CONDICIONAL: ônibus programado GTFS; espera/viagem de metrô estimadas; distância entre estação e ponto não verificada por ruas.'});
  }
  for(const trip of busItineraries.slice(0,6)){
    const buses=trip.legs.filter(x=>x.mode==='bus');
    if(!buses.length)continue;
    const first=buses[0],last=buses.at(-1);
    // Metro first: only include a feeder transfer if even the worst-case
    // published interval estimate reaches the verified bus boarding stop.
    const early=suggest(metro,origin,first.fromCoords,requested,'departAt');
    for(const hint of early){
      if(!hint.timeWindow.latestArrival)continue;
      const station=metro.stations.find(x=>x.id===hint.toStationId);
      if(!station||dist([station.lat,station.lng],first.fromCoords)>500)continue;
      const walk=walkMs(dist([station.lat,station.lng],first.fromCoords));
      if(Date.parse(hint.timeWindow.latestArrival)+walk+45000 <=
         Date.parse(first.departure)){
        save(hint,first,'metro+bus');
      }
    }
    // Bus first: arrive at a station from the final scheduled bus,
    // then train to a station near the destination; no precise train ETA.
    const late=suggest(metro,last.toCoords,destination,
      Date.parse(last.arrival),'departAt');
    for(const hint of late){
      const station=metro.stations.find(x=>x.id===hint.fromStationId);
      if(!station||dist([station.lat,station.lng],last.toCoords)>500)continue;
      save(hint,last,'bus+metro');
    }
  }
  return result.slice(0,8);
}
global.__MetroJourney={suggest,lineState,routeMinutes,multimodal};
})(self);
