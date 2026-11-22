/**
 * SUMOB GTFS-Realtime: event times explicitly supplied for a stop.
 * These are upstream TripUpdates, NOT geometric distance/velocity estimates.
 * Reject stale, ambiguous, canceled, skipped and unscheduled records.
 */
const STOP=/^[0-9]{1,20}$/;
const MAX_ITEMS=36;
function validDate(v){
  if(typeof v!=='string'||!/^\d{8}$/.test(v))return false;
  const y=Number(v.slice(0,4)),m=Number(v.slice(4,6)),d=Number(v.slice(6));
  const dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
}
export function officialStopPredictions(decoded,stopId,nowSeconds=Math.floor(Date.now()/1000)){
  if(!STOP.test(String(stopId))||!decoded||!Array.isArray(decoded.updates)||
     !Number.isSafeInteger(nowSeconds))throw Error('ETA_INVALID_INPUT');
  const seen=new Set(),out=[];
  const feedTime=decoded.feedTimestamp;
  for(const u of decoded.updates){
    if(!u)continue;
    // In GTFS-RT TripUpdate.timestamp is optional: a recent feed header is
    // an acceptable freshness fallback, but NEVER fallback for a stale
    // explicitly supplied per-trip timestamp.
    const tripTime=u.timestamp;
    const timeSource=tripTime===undefined?'feed':'trip';
    const timestamp=timeSource==='trip'?tripTime:feedTime;
    if(!Number.isSafeInteger(timestamp)||
       timestamp<nowSeconds-120||timestamp>nowSeconds+60)continue;
    const t=u.trip||{};
    if(!/^[A-Za-z0-9_.:-]{1,90}$/.test(String(t.tripId||''))||
       !/^[A-Za-z0-9_.:-]{1,90}$/.test(String(t.routeId||''))||
       (t.startDate&&!validDate(t.startDate))||
       (t.scheduleRelationship!==undefined&&t.scheduleRelationship!==0))continue;
    const matched=(u.stopTimeUpdate||[]).filter(st=>
      String(st?.stopId||'')===String(stopId));
    // A loop may visit the same stop more than once. If the official
    // record does not identify the sequence, there is no safe disambiguation.
    if(matched.length>1&&matched.some(st=>!Number.isSafeInteger(st.stopSequence)))
      continue;
    for(const st of matched){
      if((st.stopSequence!==undefined&&
          (!Number.isSafeInteger(st.stopSequence)||st.stopSequence<0))||
         (st.scheduleRelationship!==undefined&&st.scheduleRelationship!==0))continue;
      const arrival=st.arrival?.time;
      const departure=st.departure?.time;
      const at=Number.isSafeInteger(arrival)&&arrival>0?arrival:
        Number.isSafeInteger(departure)&&departure>0?departure:null;
      if(at===null||at<nowSeconds-30||at>nowSeconds+2*3600)continue;
      const key=t.tripId+'|'+String(t.startDate||'')+'|'+
        (st.stopSequence??'stop:'+String(stopId));
      if(seen.has(key))continue;
      seen.add(key);
      out.push({routeId:t.routeId,tripId:t.tripId,
        ...(t.startDate?{startDate:t.startDate}:{}),
        stopId:String(stopId),
        ...(Number.isSafeInteger(st.stopSequence)?{stopSequence:st.stopSequence}:{}),
        at:new Date(at*1000).toISOString(),
        lastFeedUpdateAt:new Date(timestamp*1000).toISOString(),
        freshnessSource:timeSource,
        eventType:arrival===at?'arrival':'departure'});
    }
  }
  out.sort((a,b)=>a.at.localeCompare(b.at)||
    a.routeId.localeCompare(b.routeId)||a.tripId.localeCompare(b.tripId));
  return out.slice(0,MAX_ITEMS);
}

/**
 * Raw official trip delays, NOT yet passenger arrival times.
 * The browser must match trip_id + route_id + service date + start_time
 * and stop_sequence against the EXACT static GTFS trip before projecting.
 */
export function officialTripDelays(decoded,requestedRoutes,nowSeconds=Math.floor(Date.now()/1000)){
  if(!decoded||!Array.isArray(decoded.updates)||!Array.isArray(requestedRoutes)||
     requestedRoutes.length>25||!Number.isSafeInteger(nowSeconds)||
     requestedRoutes.some(x=>!/^[A-Za-z0-9_.:-]{1,70}$/.test(String(x))))
     throw Error('ETA_INVALID_INPUT');
  const wanted=new Set(requestedRoutes.map(String));
  if(!wanted.size)return [];
  // A map also detects contradictory GTFS-RT entries instead of silently
  // taking the first record and producing a possibly false ETA.
  const seen=new Map();
  // Avoid starvation when a stop is served by many routes: the first
  // 250 updates in a feed may all belong to one busy route. Collect valid
  // observations by requested route and distribute the response fairly.
  const groups=new Map([...wanted].sort().map(route=>[route,new Map()]));
  for(const update of decoded.updates){
    const trip=update.trip||{};
    if(!wanted.has(String(trip.routeId||''))||
       !/^[A-Za-z0-9_.:-]{1,90}$/.test(String(trip.tripId||''))||
       !validDate(String(trip.startDate||''))||
       !/^\d{1,3}:[0-5]\d:[0-5]\d$/.test(String(trip.startTime||''))||
       (trip.scheduleRelationship!==undefined&&trip.scheduleRelationship!==0))continue;
    const time=update.timestamp===undefined?decoded.feedTimestamp:update.timestamp;
    if(!Number.isSafeInteger(time)||time<nowSeconds-120||time>nowSeconds+60)continue;
    for(const stop of update.stopTimeUpdate||[]){
      if(!/^[0-9]{1,20}$/.test(String(stop.stopId||''))||
         !Number.isSafeInteger(stop.stopSequence)||stop.stopSequence<0)continue;
      const relationship=stop.scheduleRelationship??0;
      if(relationship!==0&&relationship!==1&&relationship!==2)continue;
      // GTFS-RT SKIPPED is local to the skipped stop. NO_DATA terminates
      // propagation until another stop provides a new prediction.
      // If an absolute event is provided, time overrides delay. The browser
      // already handles that time directly at the affected stop; without the
      // scheduled time of this upstream stop we must not propagate its
      // conflicting relative delay to downstream stops.
      const absolute=Number.isSafeInteger(stop.arrival?.time)||
        Number.isSafeInteger(stop.departure?.time);
      const delay=Number.isSafeInteger(stop.arrival?.delay)?stop.arrival.delay:
        Number.isSafeInteger(stop.departure?.delay)?stop.departure.delay:null;
      const kind=relationship===1?'SKIPPED':
        relationship===2||absolute?'NO_DATA':'DELAY';
      if(kind==='DELAY'&&(delay===null||delay< -7200||delay>7200))
        continue;
      const key=trip.tripId+'|'+trip.routeId+'|'+trip.startDate+'|'+
        trip.startTime+'|'+stop.stopSequence;
      const record={
        routeId:String(trip.routeId),tripId:String(trip.tripId),
        startDate:String(trip.startDate),startTime:String(trip.startTime),
        observedStopId:String(stop.stopId),observedStopSequence:stop.stopSequence,
        ...(kind==='DELAY'?{delaySeconds:delay}:{kind}),
        lastFeedUpdateAt:new Date(time*1000).toISOString()
      };
      if(seen.has(key)){
        const previous=seen.get(key);
        if(previous.kind==='NO_DATA')continue;
        if(previous.observedStopId!==record.observedStopId||
           previous.kind!==record.kind||
           previous.delaySeconds!==record.delaySeconds){
          // Conflicting source records: terminate propagation, never guess.
          const blocked={...record,kind:'NO_DATA'};
          delete blocked.delaySeconds;
          groups.get(String(trip.routeId)).set(key,blocked);
          seen.set(key,blocked);
        }
        continue;
      }
      seen.set(key,record);
      groups.get(String(trip.routeId)).set(key,record);
    }
  }
  // Critical: the API cap must not split a single trip, because dropping
  // the NO_DATA/SKIPPED marker after a preceding delay could fabricate
  // an arrival. Emit a COMPLETE trip or none of its observations.
  const limit=250,queues=[...groups.values()].map(group=>{
    const byInstance=new Map();
    for(const record of group.values()){
      const instance=record.tripId+'|'+record.startDate+'|'+record.startTime;
      if(!byInstance.has(instance))byInstance.set(instance,[]);
      byInstance.get(instance).push(record);
    }
    return [...byInstance.values()];
  });
  const out=[],positions=queues.map(()=>0);
  while(out.length<limit){
    let visited=false;
    for(let index=0;index<queues.length;index++){
      const queue=queues[index];
      if(positions[index]>=queue.length)continue;
      visited=true;
      const tripRecords=queue[positions[index]++];
      if(out.length+tripRecords.length>limit)continue;
      out.push(...tripRecords);
      if(out.length>=limit)break;
    }
    if(!visited)break;
  }
  return out;
}
