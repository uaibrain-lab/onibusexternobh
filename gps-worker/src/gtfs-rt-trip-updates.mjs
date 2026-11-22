/* Strict, offline GTFS-Realtime TripUpdates protobuf reader.
 * Only official FeedMessage/TripUpdate wire fields are decoded. No GPS ETA.
 * Input must be bounded; malformed, missing or stale timestamps fail closed.
 */
import {findExactStopUpdate} from './trip-instance.mjs';

const MAX_FEED_BYTES = 8 * 1024 * 1024;
const MAX_ENTITIES = 25000;
const MAX_STOPS_PER_TRIP = 1000;
const utf8 = new TextDecoder('utf-8', {fatal: true});
const invalid = () => { throw Error('GTFS_RT_TRIP_UPDATES_INVALID'); };

function varint(bytes, state, end) {
  let value = 0n;
  for (let i = 0; i < 10; i++) {
    if (state.pos >= end) invalid();
    const octet = bytes[state.pos++];
    if (i === 9 && octet > 1) invalid();
    value |= BigInt(octet & 127) << BigInt(i * 7);
    if ((octet & 128) === 0)
      return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  invalid();
}
function fields(bytes, start, end, callback) {
  const state = {pos: start};
  while (state.pos < end) {
    const tag = varint(bytes, state, end);
    if (!Number.isSafeInteger(tag) || tag < 8) invalid();
    const field = Math.floor(tag / 8), wire = tag & 7;
    let begin = state.pos, finish = begin, value = null;
    if (wire === 0) {
      value = varint(bytes, state, end);
      finish = state.pos;
    } else if (wire === 1) finish = begin + 8;
    else if (wire === 2) {
      const length = varint(bytes, state, end);
      if (!Number.isSafeInteger(length)) invalid();
      begin = state.pos;
      finish = begin + length;
    } else if (wire === 5) finish = begin + 4;
    else invalid();
    if (!Number.isSafeInteger(finish) || finish > end) invalid();
    callback(field, wire, begin, finish, value);
    state.pos = finish;
  }
}
function readString(bytes, start, end) {
  if (end - start > 160) invalid();
  try { return utf8.decode(bytes.subarray(start, end)); }
  catch { invalid(); }
}
function tripDescriptor(bytes, start, end) {
  const trip = {};
  fields(bytes, start, end, (field, wire, a, b, value) => {
    if (field === 4 && wire === 0) trip.scheduleRelationship = value;
    if (wire !== 2) return;
    const key = {1: 'tripId', 2: 'startTime', 3: 'startDate', 5: 'routeId'}[field];
    if (key) trip[key] = readString(bytes, a, b);
  });
  return trip;
}
function signedInt32(bytes, start, end) {
  if(end<=start||end-start>10)invalid();
  let raw=0n;
  for(let i=start;i<end;i++)
    raw|=BigInt(bytes[i]&127)<<BigInt((i-start)*7);
  const signed=BigInt.asIntN(32,raw);
  // Canonical protobuf int32 may be encoded as 5 bytes (uint32) or,
  // when negative, sign-extended as a 10-byte 64-bit varint.
  if(raw!==BigInt.asUintN(32,signed)&&raw!==BigInt.asUintN(64,signed))invalid();
  return Number(signed);
}
function stopEvent(bytes, start, end) {
  const event = {};
  fields(bytes, start, end, (field, wire, a, b, value) => {
    if(field===1&&wire===0)event.delay=signedInt32(bytes,a,b);
    if (field === 2 && wire === 0 && Number.isSafeInteger(value) && value >= 0)
      event.time = value;
  });
  return event;
}
function stopUpdate(bytes, start, end) {
  const stop = {};
  fields(bytes, start, end, (field, wire, a, b, value) => {
    if (field === 1 && wire === 0 && Number.isSafeInteger(value)) stop.stopSequence = value;
    if (field === 2 && wire === 2) stop.arrival = stopEvent(bytes, a, b);
    if (field === 3 && wire === 2) stop.departure = stopEvent(bytes, a, b);
    if (field === 4 && wire === 2) stop.stopId = readString(bytes, a, b);
    if (field === 5 && wire === 0) stop.scheduleRelationship = value;
  });
  return stop;
}
function tripUpdate(bytes, start, end) {
  const update = {trip: {}, stopTimeUpdate: []};
  fields(bytes, start, end, (field, wire, a, b, value) => {
    if (field === 1 && wire === 2) update.trip = tripDescriptor(bytes, a, b);
    if (field === 2 && wire === 2) {
      if (update.stopTimeUpdate.length >= MAX_STOPS_PER_TRIP) invalid();
      update.stopTimeUpdate.push(stopUpdate(bytes, a, b));
    }
    if (field === 4 && wire === 0) update.timestamp = value;
    if (field === 5 && wire === 0) update.delay = signedInt32(bytes,a,b);
  });
  return update;
}
function feedEntity(bytes, start, end) {
  let deleted = false, update = null;
  fields(bytes, start, end, (field, wire, a, b, value) => {
    if (field === 2 && wire === 0) deleted = value === 1;
    if (field === 3 && wire === 2) {
      if (update !== null) invalid();
      update = tripUpdate(bytes, a, b);
    }
  });
  return deleted ? null : update;
}
function feedHeader(bytes, start, end) {
  let version = '', timestamp = null;
  fields(bytes, start, end, (field, wire, a, b, value) => {
    if (field === 1 && wire === 2) version = readString(bytes, a, b);
    if (field === 3 && wire === 0) timestamp = value;
  });
  if (!/^[12]\.\d{1,3}$/.test(version)) invalid();
  return {timestamp};
}
function fresh(ts, now) {
  return Number.isSafeInteger(ts) && ts >= now - 120 && ts <= now + 60;
}

export function parseTripUpdates(buffer, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) invalid();
  const bytes = buffer instanceof Uint8Array ? buffer :
    buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : null;
  if (!bytes || bytes.byteLength < 5) invalid();
  if (bytes.byteLength > MAX_FEED_BYTES) throw Error('GTFS_RT_TRIP_UPDATES_TOO_LARGE');
  let header = null, entities = 0;
  const updates = [];
  fields(bytes, 0, bytes.length, (field, wire, a, b) => {
    if (field === 1 && wire === 2) {
      if (header !== null) invalid();
      header = feedHeader(bytes, a, b);
    }
    if (field === 2 && wire === 2) {
      if (++entities > MAX_ENTITIES) invalid();
      const update = feedEntity(bytes, a, b);
      // TripUpdate.timestamp is optional in GTFS-RT. Keep timestamp-less
      // updates only under the fresh header; exact-trip matching still
      // rejects them unless a consumer opts into feed-level freshness.
      if (update && (update.timestamp === undefined ||
          fresh(update.timestamp, nowSeconds))) updates.push(update);
    }
  });
  if (header === null || !fresh(header.timestamp, nowSeconds)) invalid();
  return {feedTimestamp: header.timestamp, sourceEntities: entities, updates};
}

// One guarded entry point from an official protobuf feed to an exact GTFS stop.
// Returning the source event is NOT an ETA; consumer must independently validate
// provenance, calendar, service availability and displayed time semantics.
export function matchTripUpdate(buffer, scheduled, nowSeconds = Math.floor(Date.now() / 1000)) {
  const decoded = parseTripUpdates(buffer, nowSeconds);
  return findExactStopUpdate(scheduled, decoded.updates, nowSeconds);
}
