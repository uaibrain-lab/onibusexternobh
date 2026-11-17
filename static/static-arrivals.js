/* Scheduled GTFS arrivals by stop; never presented as real-time GPS.
 * Sparse, versioned timetable shards avoid loading all 18 MiB on a phone.
 * Python build_static_arrivals.py generates each 256-way shard at build time.
 */
'use strict';
const StaticArrivals=(()=>{
  const root=new URL('./catalog/arrivals/',location.href);
  let metadata=null,calendar=null;
  const shards=new Map();
  const CACHE_LIMIT=12;
  const HOUR=3600000,DAY=86400000;
  const week=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
  });
  function bhDay(epoch){
    const vals=Object.fromEntries(parts.formatToParts(new Date(epoch)).map(x=>[x.type,x.value]));
    return vals.year+'-'+vals.month+'-'+vals.day;
  }
  function addDay(day,delta){
    return new Date(Date.parse(day+'T12:00:00Z')+delta*DAY).toISOString().slice(0,10);
  }
  function hashStop(id){
    let value=0;
    for(const ch of String(id))value=(value*31+ch.charCodeAt(0))%256;
    return value.toString(16).padStart(2,'0');
  }
  async function loadGzip(url){
    const r=await fetch(url,{cache:'force-cache'});
    if(!r.ok)throw Error('GTFS não disponível ('+r.status+')');
    const bytes=await r.arrayBuffer();
    const raw=new Uint8Array(bytes);
    const isGzip=raw.length>2&&raw[0]===31&&raw[1]===139;
    if(isGzip){
      if(typeof DecompressionStream==='undefined')throw Error('Navegador sem suporte ao catálogo comprimido');
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(raw));
  }
  async function init(){
    if(metadata&&calendar)return;
    const [i,c]=await Promise.all([
      fetch(new URL('index.json',root),{cache:'no-store'}).then(r=>{
        if(!r.ok)throw Error('Índice de horários indisponível');
        return r.json();
      }),
      fetch(new URL('calendar.json',root),{cache:'force-cache'}).then(r=>{
        if(!r.ok)throw Error('Calendário de horários indisponível');
        return r.json();
      })
    ]);
    if(i.schema!==1||i.buckets!==256||!i.version||!c.services||!c.exceptions)
      throw Error('Versão de horários incompatível');
    metadata=i;calendar=c;
  }
  function active(service,day){
    const key=day.replaceAll('-','');
    const overridden=calendar.exceptions?.[key]?.[String(service)];
    if(overridden!==undefined)return Number(overridden)===1;
    const c=calendar.services?.[String(service)];
    if(!c||key<c.start_date||key>c.end_date)return false;
    const dayName=week[new Date(day+'T12:00:00Z').getUTCDay()];
    return String(c[dayName])==='1';
  }
  async function bucket(stop){
    const key=hashStop(stop);
    if(shards.has(key))return shards.get(key);
    const promise=loadGzip(new URL(key+'.json.gz?v='+encodeURIComponent(metadata.version),root))
      .catch(e=>{shards.delete(key);throw e});
    shards.set(key,promise);
    if(shards.size>CACHE_LIMIT)shards.delete(shards.keys().next().value);
    return promise;
  }
  function nextIndex(times,threshold){
    let low=0,high=times.length;
    while(low<high){
      const mid=(low+high)>>1;
      if(times[mid]<threshold)low=mid+1;else high=mid;
    }
    return low;
  }
  async function lookup(stopId,now=Date.now(),horizonHours=5){
    await init();
    if(bhDay(now).replaceAll('-','')>metadata.validThrough)
      return {available:false,expired:true,byDirection:new Map()};
    const data=await bucket(stopId);
    const entries=data[String(stopId)]||[];
    const found=new Map();
    const lastToday=new Map();
    for(const [code,service,destination,times] of entries){
      if(!Array.isArray(times)||!times.length)continue;
      const key=String(code)+'\u0000'+String(destination||'').trim();
      for(const delta of [-1,0,1]){
        const day=addDay(bhDay(now),delta);
        if(!active(service,day))continue;
        const midnight=Date.parse(day+'T00:00:00-03:00');
        if(delta===0){
          const latest=midnight+times[times.length-1]*1000;
          lastToday.set(key,Math.max(lastToday.get(key)||0,latest));
        }
        const threshold=Math.ceil((now-midnight)/1000);
        const pos=nextIndex(times,threshold);
        for(const second of times.slice(pos,pos+3)){
          const epoch=midnight+second*1000;
          if(epoch<now||epoch-now>horizonHours*HOUR)continue;
          if(!found.has(key))found.set(key,[]);
          found.get(key).push(epoch);
        }
      }
    }
    const results=new Map();
    for(const [key,all] of found){
      const epochs=[...new Set(all)].sort((a,b)=>a-b).slice(0,3);
      if(!epochs.length)continue;
      const at=epochs[0], destination=key.split('\u0000')[1];
      const iso=time=>new Date(time).toISOString();
      const minutes=time=>Math.max(0,Math.floor((time-now)/60000));
      results.set(key,{
        type:'scheduled',at:iso(at),minutes:minutes(at),destination,
        following:epochs.slice(1).map(time=>({
          at:iso(time),minutes:minutes(time),destination
        })),
        lastTripToday:!!(lastToday.get(key)&&bhDay(at)===bhDay(now)&&at>=lastToday.get(key))
      });
    }
    return {available:true,expired:false,version:metadata.version,byDirection:results};
  }
  return {lookup,hashStop};
})();
