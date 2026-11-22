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
  for(const u of decoded.updates){
    if(!u||!Number.isSafeInteger(u.timestamp)||
      Math.abs(nowSeconds-u.timestamp)>120)continue;
    const t=u.trip||{};
    if(!/^[A-Za-z0-9_.:-]{1,90}$/.test(String(t.tripId||''))||
       !/^[A-Za-z0-9_.:-]{1,90}$/.test(String(t.routeId||''))||
       (t.startDate&&!validDate(t.startDate))||
       (t.scheduleRelationship!==undefined&&t.scheduleRelationship!==0))continue;
    for(const st of u.stopTimeUpdate||[]){
      if(String(st.stopId||'')!==String(stopId)||
         !Number.isSafeInteger(st.stopSequence)||st.stopSequence<0||
         (st.scheduleRelationship!==undefined&&st.scheduleRelationship!==0))continue;
      const arrival=st.arrival?.time;
      const departure=st.departure?.time;
      const at=Number.isSafeInteger(arrival)&&arrival>0?arrival:
        Number.isSafeInteger(departure)&&departure>0?departure:null;
      if(at===null||at<nowSeconds-30||at>nowSeconds+2*3600)continue;
      const key=t.tripId+'|'+String(t.startDate||'')+'|'+st.stopSequence;
      if(seen.has(key))continue;
      seen.add(key);
      out.push({routeId:t.routeId,tripId:t.tripId,
        ...(t.startDate?{startDate:t.startDate}:{}),
        stopId:String(stopId),stopSequence:st.stopSequence,
        at:new Date(at*1000).toISOString(),
        lastFeedUpdateAt:new Date(u.timestamp*1000).toISOString(),
        eventType:arrival===at?'arrival':'departure'});
    }
  }
  out.sort((a,b)=>a.at.localeCompare(b.at)||
    a.routeId.localeCompare(b.routeId)||a.tripId.localeCompare(b.tripId));
  return out.slice(0,MAX_ITEMS);
}
