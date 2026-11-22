/**
 * Read-only production-data compatibility gate: SUMOB TripUpdates (delay)
 * versus the exact GTFS index packaged for the Hub.
 * Prints aggregate counts ONLY. No identities, GPS points or feed bytes.
 */
import {readFile,writeFile,stat} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {parseTripUpdates} from '../gps-worker/src/gtfs-rt-trip-updates.mjs';
import {officialTripDelays} from '../gps-worker/src/arrival-predictions.mjs';
import {SUMOB_FEEDS} from '../gps-worker/src/sumob-feeds.mjs';

const folder=process.argv[2]||'dist/externo/catalog';
const now=Date.now();
function bucketId(id){let n=0;for(const ch of String(id))n=(n*31+ch.charCodeAt(0))%256;return n.toString(16).padStart(2,'0')}
const index=JSON.parse(await readFile(join(folder,'rt-trips/index.json'),'utf-8'));
const manifest=JSON.parse(await readFile(join(folder,'manifest.json'),'utf-8'));
const calendar=JSON.parse(await readFile(join(folder,'arrivals/calendar.json'),'utf-8'));
if(index.schema!==1||index.buckets!==256||index.version!==manifest.gtfsVersion)
  throw Error('ETA_JOIN_CATALOG_INCOMPATIBLE');

const response=await fetch(SUMOB_FEEDS.tripUpdates,{
  headers:{Accept:'application/x-protobuf,application/octet-stream'},
  redirect:'manual',signal:AbortSignal.timeout(10000)});
if(!response.ok||Number(response.headers.get('content-length')||0)>8*1024*1024)
  throw Error('ETA_JOIN_FEED_UNAVAILABLE');
const buffer=await response.arrayBuffer();
const feed=parseTripUpdates(buffer,Math.floor(now/1000));
const ids=[...new Set(feed.updates.map(u=>String(u.trip?.routeId||'')).filter(Boolean))];
const updates=[];
for(let i=0;i<ids.length;i+=25)
  updates.push(...officialTripDelays(feed,ids.slice(i,i+25),Math.floor(now/1000)));
if(!updates.length)throw Error('ETA_JOIN_NO_DELAY_UPDATES');

const cached=new Map();
async function rowsFor(stopId){
  const bucket=bucketId(stopId);
  if(!cached.has(bucket)){
    const name=bucket+'.json.gz';
    const path=join(folder,'rt-trips',name);
    const expected=index.sizes[name];
    if(!Number.isSafeInteger(expected)||expected<10||expected>4000000||
       (await stat(path)).size!==expected)throw Error('ETA_JOIN_BAD_BUCKET');
    cached.set(bucket,JSON.parse(gunzipSync(await readFile(path)).toString('utf8')));
  }
  return cached.get(bucket)[stopId]||[];
}
function active(service,date){
  const exception=calendar.exceptions?.[date]?.[String(service)];
  if(exception!==undefined)return Number(exception)===1;
  const rule=calendar.services?.[String(service)];
  if(!rule||date<rule.start_date||date>rule.end_date)return false;
  const day=new Date(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)+'T12:00:00Z');
  const col=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][day.getUTCDay()];
  return String(rule[col])==='1';
}
function secs(value){
  const p=String(value).split(':').map(Number);
  if(p.length!==3||p.some(n=>!Number.isInteger(n))||p[0]>=48||p[1]>=60||p[2]>=60)return null;
  return p[0]*3600+p[1]*60+p[2];
}
const quality={checkedAt:new Date(now).toISOString(),
  catalogVersion:manifest.gtfsVersion,officialUpdates:updates.length,
  examined:0,stopsWithStaticRows:0,stopWithSameTripId:0,
  stopWithSameRouteId:0,stopWithSameSequence:0,
  stopWithTripAndRoute:0,stopWithTripAndSequence:0,
  stopWithRouteAndSequence:0,
  matchedTripRouteSequence:0,matchedStartTime:0,
  activeService:0,plausibleETAs:0,distinctIndexBuckets:0};
for(const u of updates.slice(0,300)){
  quality.examined++;
  const rows=await rowsFor(u.observedStopId);
  if(rows.length)quality.stopsWithStaticRows++;
  if(rows.some(r=>r[0]===u.tripId))quality.stopWithSameTripId++;
  if(rows.some(r=>r[1]===u.routeId))quality.stopWithSameRouteId++;
  if(rows.some(r=>r[3]===u.observedStopSequence))quality.stopWithSameSequence++;
  if(rows.some(r=>r[0]===u.tripId&&r[1]===u.routeId))quality.stopWithTripAndRoute++;
  if(rows.some(r=>r[0]===u.tripId&&r[3]===u.observedStopSequence))
    quality.stopWithTripAndSequence++;
  if(rows.some(r=>r[1]===u.routeId&&r[3]===u.observedStopSequence))
    quality.stopWithRouteAndSequence++;
  const matches=rows.filter(r=>r[0]===u.tripId&&r[1]===u.routeId&&
    r[3]===u.observedStopSequence);
  if(matches.length!==1)continue;
  quality.matchedTripRouteSequence++;
  const r=matches[0];
  if(secs(u.startTime)!==r[5])continue;
  quality.matchedStartTime++;
  if(!active(r[2],u.startDate))continue;
  quality.activeService++;
  const d=u.startDate,midnight=Date.parse(
    d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6)+'T00:00:00-03:00');
  const eta=midnight+(r[4]+u.delaySeconds)*1000;
  if(Math.abs(eta-now)<=3600000)quality.plausibleETAs++;
}
quality.distinctIndexBuckets=cached.size;
await writeFile('sumob-eta-join-qa.json',JSON.stringify(quality,null,2)+'\n');
console.log('SUMOB_ETA_JOIN_RESULTS',JSON.stringify(quality));
if(quality.activeService<1||quality.plausibleETAs<1){
  if(process.argv.includes('--observe-only'))
    console.warn('SUMOB_ETA_JOIN_INCOMPATIBLE_NO_ETA_RELEASE');
  else throw Error('SUMOB_ETA_JOIN_NOT_VALIDATED');
}
console.log('SUMOB_ETA_JOIN_REAL_OK');
