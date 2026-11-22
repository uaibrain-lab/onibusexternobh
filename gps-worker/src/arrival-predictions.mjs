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
  const out=[],seen=new Set();
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
         !Number.isSafeInteger(stop.stopSequence)||stop.stopSequence<0||
         (stop.scheduleRelationship!==undefined&&stop.scheduleRelationship!==0))
         continue;
      const delay=Number.isSafeInteger(stop.arrival?.delay)?stop.arrival.delay:
        Number.isSafeInteger(stop.departure?.delay)?stop.departure.delay:null;
      if(delay===null||delay< -7200||delay>7200)continue;
      const key=trip.tripId+'|'+trip.startDate+'|'+stop.stopSequence;
      if(seen.has(key))continue;
      seen.add(key);
      out.push({routeId:String(trip.routeId),tripId:String(trip.tripId),
        startDate:String(trip.startDate),startTime:String(trip.startTime),
        observedStopId:String(stop.stopId),observedStopSequence:stop.stopSequence,
        delaySeconds:delay,lastFeedUpdateAt:new Date(time*1000).toISOString()});
      if(out.length>=250)return out;
    }
  }
  return out;
}
