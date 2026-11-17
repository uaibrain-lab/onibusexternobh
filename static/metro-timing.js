/* P9: NON-SCHEDULED rail travel windows. Does not generate train trips.
 * Historical published operator benchmarks for L1:
 *   Vilarinho–Central: 25m30s; Eldorado–Central: 18m54s (2023).
 * This is a historical length calibration, NOT station-specific travel times,
 * an exact arrival guarantee, nor a verified train timetable.
 * See Metrô BH: /metro-bh-diminui-tempo-de-viagem/
 */
'use strict';
const RailWindows=(()=>{
  const rad=Math.PI/180;
  const distance=(a,b)=>{
    const da=(a.lat-b.lat)*rad,db=(a.lng-b.lng)*rad;
    const t=Math.sin(da/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(db/2)**2;
    return 12742000*Math.asin(Math.min(1,Math.sqrt(t)));
  };
  const minutes=s=>Number(s.split(':')[0])*60+Number(s.split(':')[1]);
  const clock=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',
    hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
  const dateDay=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
  function headway(catalog,line,at) {
    if(line.id!=='1')return null;
    const day=dateDay(at),time=clock(at);
    const spec=catalog.operations?.headways?.['1'];
    if(!spec)return null;
    let week=(new Date(day+'T12:00:00Z').getUTCDay()+6)%7;
    let freq;
    if(week<5){
      const peak=spec.weekdays.peakWindows.some(([a,b])=>a<=time&&time<b);
      freq=peak?spec.weekdays.peakMinutes:spec.weekdays.offPeakMinutes;
    }else if(week===5){
      const [a,b]=spec.saturday.morningWindow;
      freq=a<=time&&time<b?spec.saturday.morningMinutes:spec.saturday.otherMinutes;
    }else freq=spec.sundayAndHolidays.minutes;
    for(const notice of catalog.operations.exceptional||[])
      if(notice.line===line.id&&notice.from<=day&&day<=notice.through&&
         time>=notice.after)freq=notice.headwayMinutes;
    return freq;
  }
  function rideMinutes(line,catalog,a,b) {
    if(line.id!=='1')return null;
    const ids=line.stations,central=ids.indexOf('central'),
      eldorado=ids.indexOf('eldorado');
    if(central<0||eldorado<0||a.id==='novo-eldorado'||b.id==='novo-eldorado')
      return null;
    const ia=ids.indexOf(a.id),ib=ids.indexOf(b.id);
    if(ia<0||ib<0||ia===ib)return null;
    const stations=new Map(catalog.stations.map(s=>[s.id,s]));
    const length=(from,to)=>{
      let value=0;
      for(let i=from;i<to;i++){
        if(!stations.has(ids[i])||!stations.has(ids[i+1]))return null;
        value+=distance(stations.get(ids[i]),stations.get(ids[i+1]));
      }
      return value;
    };
    const section=(from,to,benchmark)=>{
      const total=length(from,to);
      if(!total)return null;
      return benchmark/total;
    };
    const rates=[
      {a:central,b:eldorado,rate:section(central,eldorado,18.9)},
      {a:eldorado,b:central,rate:section(central,eldorado,18.9)},
      {a:central,b:ids.length-1,rate:section(central,ids.length-1,25.5)},
    ];
    if(rates.some(x=>!Number.isFinite(x.rate)))return null;
    let total=0;
    for(let i=Math.min(ia,ib);i<Math.max(ia,ib);i++){
      const meters=length(i,i+1);
      const rate=i<central?null:i<eldorado?rates[0].rate:rates[2].rate;
      // The extra Novo Eldorado segment has no verified time benchmark.
      if(!meters||rate===null)return null;
      total+=meters*rate;
    }
    return Math.max(2,total);
  }
  function window(catalog,line,from,to,requestedAt,mode='departAt',
                  walkToM=0,walkFromM=0) {
    const ride=rideMinutes(line,catalog,from,to);
    const freq=headway(catalog,line,requestedAt);
    if(!ride||!freq)return null;
    const day=dateDay(requestedAt);
    let end=line.hours.end;
    for(const ex of catalog.operations.hoursExceptions||[])
      if(ex.line===line.id&&ex.from<=day&&day<=ex.through)end=ex.end;
    if(clock(requestedAt)<line.hours.start||clock(requestedAt)>=end)return null;
    const entrance=3,exit=2;
    const walkMin=Math.ceil((walkToM+walkFromM)*1.35/1.15/60);
    const earliest=Math.ceil(entrance+exit+walkMin+ride*0.8);
    const latest=Math.ceil(entrance+exit+walkMin+ride*1.35+freq);
    const epoch=Date.parse(requestedAt);
    if(!Number.isFinite(epoch))return null;
    return {
      model:'historical_operator_average_plus_current_frequency',
      confidence:'LOW, NOT A TRAIN SCHEDULE',
      reference:'https://www.metrobh.com.br/metro-bh-diminui-tempo-de-viagem/',
      headwayMinutes:freq,rideBenchmarkMinutes:Number(ride.toFixed(1)),
      travelWindowMinutes:[earliest,latest],
      firstPossibleAt:new Date(epoch+(mode==='arriveBy'?-latest:earliest)*60000).toISOString(),
      lastPossibleAt:new Date(epoch+(mode==='arriveBy'?-earliest:latest)*60000).toISOString(),
      note:mode==='arriveBy'
        ?'Faixa ilustrativa de saída para chegada planejada; não confirma partida de trem.'
        :'Faixa ilustrativa de chegada; consulte os horários reais no Metrô BH antes de viajar.'
    };
  }
  return {window,headway,rideMinutes};
})();
