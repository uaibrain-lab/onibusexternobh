// Strict identity guard for matching a realtime trip to an exact scheduled instance.
// No inference from GPS position, route alone or nearby departure times.
const DATE = /^\d{8}$/;
const TIME = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;
function validDate(s) {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const y=Number(s.slice(0,4)),m=Number(s.slice(4,6)),d=Number(s.slice(6));
  if(y<2000||y>2100)return false;
  const x=new Date(Date.UTC(y,m-1,d));
  return x.getUTCFullYear()===y&&x.getUTCMonth()===m-1&&x.getUTCDate()===d;
}
function validTime(s) {
  if(typeof s!=='string')return false;
  const m=TIME.exec(s);
  return !!m && Number(m[1])<=47;
}
export function sameTripInstance(scheduled, realtime) {
  if (!scheduled || !realtime) return false;
  for (const key of ['tripId','routeId','startDate','startTime']) {
    if(typeof scheduled[key]!=='string'||!scheduled[key]||scheduled[key]!==realtime[key])return false;
  }
  if(!validDate(scheduled.startDate)||!validTime(scheduled.startTime))return false;
  const a=scheduled.stopSequence,b=realtime.currentStopSequence;
  return Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=0&&a===b;
}

/**
 * Select an exact, fresh GTFS-RT TripUpdate for a scheduled stop.
 * This is a fail-closed adapter for already decoded TripUpdates, not a GPS ETA.
 * No inferred times: the caller must supply an official scheduled descriptor.
 * Returns the matching StopTimeUpdate, or null on ambiguity/staleness.
 */
export function findExactStopUpdate(scheduled, updates, nowSeconds) {
  if (!scheduled || !Array.isArray(updates) || updates.length > 25000 ||
      !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) return null;
  let selected = null;
  for (const update of updates) {
    if (!update || typeof update !== 'object') continue;
    const ts = update.timestamp;
    if (!Number.isSafeInteger(ts) || ts > nowSeconds + 60 ||
        ts < nowSeconds - 120) continue;
    const trip = update.trip;
    if (!trip || typeof trip !== 'object') continue;
    // Match only scheduled service; canceled/added/replaced trips are not the same instance.
    if (trip.scheduleRelationship !== undefined && trip.scheduleRelationship !== 0) continue;
    const stopUpdates = update.stopTimeUpdate;
    if (!Array.isArray(stopUpdates) || stopUpdates.length > 1000) continue;
    for (const stop of stopUpdates) {
      if (!stop || !Number.isSafeInteger(stop.stopSequence) ||
          stop.stopSequence < 0 ||
          // SKIPPED/NO_DATA/UNSCHEDULED cannot yield a scheduled-stop event.
          (stop.scheduleRelationship !== undefined && stop.scheduleRelationship !== 0)) continue;
      if (!sameTripInstance(scheduled, {
        tripId: trip.tripId, routeId: trip.routeId,
        startDate: trip.startDate, startTime: trip.startTime,
        currentStopSequence: stop.stopSequence
      })) continue;
      // A sequence alone is insufficient when both sources identify the stop.
      // A conflicting stop_id must never be silently treated as this stop.
      if (typeof scheduled.stopId === 'string' && scheduled.stopId &&
          typeof stop.stopId === 'string' && stop.stopId &&
          scheduled.stopId !== stop.stopId) continue;
      // More than one candidate is ambiguous, even when timestamps match.
      if (selected !== null) return null;
      selected = {trip, stop, timestamp: ts};
    }
  }
  return selected;
}
