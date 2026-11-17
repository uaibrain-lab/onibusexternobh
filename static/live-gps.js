/* Optional free GPS adapter for the static Externo app.
 * Never reports GPS or an ETA unless the official PBH feed responds with
 * fresh fixes. Does not send passenger coordinates to the Worker.
 */
'use strict';
const StaticLive=(()=>{
  const ROOT=new URL('./',location.href);
  let cfgPromise=null, mappingPromise=null, currentCfg=null, lastStatus=null;
  const fleets=new Map();
  const TTL=30000;
  const unavailable=(line,name,reason)=>({
    line,name,available:false,count:null,vehicles:[],sources:{},
    note:reason||'GPS público ainda não habilitado; horários são de tabela.'
  });
  const isoFromHr=hr=>{
    const s=String(hr||'');
    if(!/^\d{14}$/.test(s))return null;
    const y=Number(s.slice(0,4)),m=Number(s.slice(4,6)),d=Number(s.slice(6,8));
    const h=Number(s.slice(8,10)),mi=Number(s.slice(10,12)),sec=Number(s.slice(12,14));
    if(m<1||m>12||d<1||d>31||h>23||mi>59||sec>59)return null;
    const time=Date.UTC(y,m-1,d,h+3,mi,sec);
    if(new Date(time-10800000).getUTCDate()!==d)return null;
    return new Date(time).toISOString();
  };
  function config(){
    if(cfgPromise)return cfgPromise;
    cfgPromise=fetch(new URL('gps-config.json',ROOT),{cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw Error('Configuração GPS indisponível');
        return response.json();
      }).then(value=>{
        if(value?.enabled!==true)return currentCfg={enabled:false};
        const url=new URL(String(value.endpoint||''));
        if(url.protocol!=='https:'||url.pathname!=='/api/gps'||url.search||url.hash)
          throw Error('Endpoint GPS inválido');
        return currentCfg={enabled:true,endpoint:url.href};
      }).catch(()=>currentCfg={enabled:false});
    return cfgPromise;
  }
  function enabled(){return currentCfg?.enabled===true}
  async function mapping(version){
    if(!mappingPromise){
      const url=new URL('catalog/gps-nl-map.json',ROOT);
      url.searchParams.set('v',version);
      mappingPromise=fetch(url,{cache:'force-cache'}).then(response=>{
        if(!response.ok)throw Error('Correspondência GPS-GTFS indisponível');
        return response.json();
      }).catch(error=>{mappingPromise=null;throw error});
    }
    return mappingPromise;
  }
  function recentFix(r,source,publicCode,now,fetchedAt){
    const fix=isoFromHr(r.HR),time=Date.parse(fix||'');
    const lat=Number(r.LT),lng=Number(r.LG);
    const ageSec=(now-time)/1000;
    if(!Number.isFinite(time)||ageSec< -60||ageSec>600||
       lat<-20.5||lat>-19.4||lng<-44.5||lng>-43.4)return null;
    return {vehicleId:String(r.NV),source,NL:String(r.NL),public:publicCode,
      latitude:lat,longitude:lng,heading:Number.isFinite(r.DG)?r.DG:null,
      speedRaw:null,SV:'',lastGpsFixAt:fix,
      positionUnchangedSinceAt:fix,lastFetchedAt:fetchedAt,
      ageSec:Math.max(0,Math.round(ageSec)),unchangedSec:null,
      gpsStatus:ageSec<=120?'recent':ageSec<=300?'delayed':'stale',
      shapeMatch:{status:'unknown'},
      note:'Posição GPS; variante do itinerário não confirmada'};
  }
  function status(){
    return lastStatus||{available:false,gpsRecent:0,sources:{},
      note:'GPS gratuito desativado; horários programados disponíveis.'};
  }
  async function poll(routeId,line,name,version){
    const cfg=await config();
    if(!cfg.enabled||typeof navigator!=='undefined'&&!navigator.onLine)
      return unavailable(line,name);
    let gpsMap;
    try{gpsMap=await mapping(version)}
    catch(_){return unavailable(line,name,'Correspondência de linhas não disponível')}
    const options={CONVENCIONAL:[],SUPLEMENTAR:[]};
    for(const [key,value] of Object.entries(gpsMap)){
      if(!value?.routeIds?.some(id=>String(id)===String(routeId)))continue;
      const [source,nl]=key.split('|');
      if(options[source]&&/^\d{1,8}$/.test(nl))options[source].push(nl);
    }
    const tasks=Object.entries(options).filter(([,values])=>values.length>0)
      .map(async ([source,values])=>{
        const request=new URL(cfg.endpoint);
        request.searchParams.set('source',source);
        request.searchParams.set('nls',values.join(','));
        const response=await fetch(request,{cache:'no-store',mode:'cors'});
        if(!response.ok)throw Error(source+' HTTP '+response.status);
        const result=await response.json();
        if(result.available!==true||result.source!==source||
           !Array.isArray(result.records))throw Error(source+' inválido');
        return result;
      });
    if(!tasks.length)return unavailable(line,name,'Linha sem mapeamento GPS confirmado');
    const settled=await Promise.allSettled(tasks);
    const sources={},vehicles=new Map(),now=Date.now();
    let ok=0;
    for(const item of settled){
      if(item.status==='rejected')continue;
      ok++;
      const batch=item.value;
      sources[batch.source]={lastFetchedAt:batch.fetchedAt,
        lastError:null,responseRecords:batch.records.length};
      for(const record of batch.records){
        const itemMap=gpsMap[batch.source+'|'+record.NL];
        if(!itemMap?.routeIds?.some(id=>String(id)===String(routeId)))continue;
        const v=recentFix(record,batch.source,itemMap.public,now,batch.fetchedAt);
        if(!v)continue;
        const key=v.source+'|'+v.vehicleId;
        if(!vehicles.has(key)||Date.parse(v.lastGpsFixAt)>Date.parse(vehicles.get(key).lastGpsFixAt))
          vehicles.set(key,v);
      }
    }
    const list=[...vehicles.values()].sort((a,b)=>a.ageSec-b.ageSec);
    const recent=list.filter(v=>v.ageSec<=120).length;
    lastStatus={available:ok>0,gpsRecent:recent,vehiclesKnown:list.length,
      gpsUpdating:false,sources,
      note:ok>0?(ok<tasks.length?'GPS parcial':'Posições oficiais PBH'):
        'Fonte GPS indisponível; use horários programados'};
    if(!ok)return unavailable(line,name,'Serviço GPS indisponível; horários programados disponíveis.');
    return {line,name,available:true,asOf:new Date(now).toISOString(),
      count:list.length,vehicles:list,sources,partial:ok<tasks.length,
      note:ok<tasks.length?'Fonte GPS parcialmente disponível':'Localização GPS oficial, sem ETA garantido'};
  }
  async function fleet(routeId,line,name,version){
    const key=String(routeId);
    const old=fleets.get(key),now=Date.now();
    if(old&&now-old.time<TTL)return old.promise;
    const promise=poll(routeId,line,name,version);
    fleets.set(key,{time:now,promise});
    if(fleets.size>30)fleets.delete(fleets.keys().next().value);
    return promise;
  }
  return {fleet,status,enabled,config,isoFromHr};
})();
