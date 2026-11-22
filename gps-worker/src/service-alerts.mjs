/**
 * GTFS-Realtime SUMOB Service Alerts: bounded protobuf decoder.
 * Entity and field numbers follow GTFS-RT reference / PBH dictionary.
 * Emits only active, explicit stop/route alerts (no agency-wide guessing).
 */
const utf8=new TextDecoder('utf-8',{fatal:true});
const invalid=()=>{throw Error('GTFS_RT_ALERTS_INVALID')};
const routeAllowed=/^[A-Za-z0-9_.:-]{1,70}$/;
function varint(b,s,end){
  let n=0n;
  for(let i=0;i<10;i++){
    if(s.p>=end)invalid();
    const x=b[s.p++];
    if(i===9&&x>1)invalid();
    n|=BigInt(x&127)<<BigInt(i*7);
    if(!(x&128))return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null;
  }
  invalid();
}
function fields(b,start,end,fn){
  const state={p:start};
  while(state.p<end){
    const key=varint(b,state,end);
    if(!Number.isSafeInteger(key)||key<8)invalid();
    const field=Math.floor(key/8),wire=key&7;
    let a=state.p,z=a,value=null;
    if(wire===0){value=varint(b,state,end);z=state.p}
    else if(wire===2){const size=varint(b,state,end);
      if(!Number.isSafeInteger(size)||size<0)invalid();
      a=state.p;z=a+size}
    else if(wire===1)z+=8;
    else if(wire===5)z+=4;
    else invalid();
    if(!Number.isSafeInteger(z)||z>end)invalid();
    fn(field,wire,a,z,value);
    state.p=z;
  }
}
function string(b,a,z,max=480){
  if(z-a>max||z<a)invalid();
  try{return utf8.decode(b.subarray(a,z))}catch{invalid()}
}
function header(b,a,z){
  let version='',timestamp=null;
  fields(b,a,z,(f,w,x,y,v)=>{
    if(f===1&&w===2)version=string(b,x,y,12);
    else if(f===3&&w===0)timestamp=v;
  });
  if(!/^[12]\.\d{1,3}$/.test(version)||!Number.isSafeInteger(timestamp))invalid();
  return timestamp;
}
function translation(b,a,z){
  let text='',lang='';
  fields(b,a,z,(f,w,x,y)=>{
    if(w!==2)return;
    if(f===1)text=string(b,x,y,450);
    if(f===2)lang=string(b,x,y,20);
  });
  return {text,lang};
}
function textValue(b,a,z){
  const versions=[];
  fields(b,a,z,(f,w,x,y)=>{
    if(f===1&&w===2){
      if(versions.length>=8)invalid();
      versions.push(translation(b,x,y));
    }
  });
  const pt=versions.find(v=>/^pt(-|$)/i.test(v.lang)&&v.text.trim());
  return (pt||versions.find(v=>!v.lang&&v.text.trim())||
    versions.find(v=>v.text.trim()))?.text.trim().slice(0,450)||'';
}
function range(b,a,z){
  let start=null,end=null;
  fields(b,a,z,(f,w,x,y,v)=>{
    if(w!==0)return;
    if(f===1)start=v;
    if(f===2)end=v;
  });
  return {start,end};
}
function selector(b,a,z){
  const value={};
  fields(b,a,z,(f,w,x,y)=>{
    if(w!==2)return;
    if(f===2)value.routeId=string(b,x,y,100);
    if(f===5)value.stopId=string(b,x,y,70);
    // Trip descriptor is present for some alerts but not needed for scope.
  });
  return value;
}
function alert(b,a,z){
  const result={periods:[],entities:[],header:'',description:'',cause:0,effect:0};
  fields(b,a,z,(f,w,x,y,v)=>{
    if(f===1&&w===2){if(result.periods.length>=24)invalid();result.periods.push(range(b,x,y));}
    if(f===5&&w===2){if(result.entities.length>=120)invalid();result.entities.push(selector(b,x,y));}
    if(f===6&&w===0)result.cause=v;
    if(f===7&&w===0)result.effect=v;
    if(f===10&&w===2)result.header=textValue(b,x,y);
    if(f===11&&w===2)result.description=textValue(b,x,y);
  });
  return result;
}
function entity(b,a,z){
  let id='',removed=false,found=null;
  fields(b,a,z,(f,w,x,y,v)=>{
    if(f===1&&w===2)id=string(b,x,y,160);
    if(f===2&&w===0)removed=v===1;
    if(f===5&&w===2){if(found!==null)invalid();found=alert(b,x,y)}
  });
  return removed||!found?null:{id,...found};
}
export function parseServiceAlerts(buffer,{routes=[],stopId=null,nowSeconds=Math.floor(Date.now()/1000)}={}){
  const b=buffer instanceof Uint8Array?buffer:
    buffer instanceof ArrayBuffer?new Uint8Array(buffer):null;
  if(!b||b.length<5)invalid();
  if(b.length>8*1024*1024)throw Error('GTFS_RT_ALERTS_TOO_LARGE');
  if(!Number.isSafeInteger(nowSeconds)||nowSeconds<0)invalid();
  if(!Array.isArray(routes)||routes.length>30||
     routes.some(x=>!routeAllowed.test(String(x)))||
     (stopId!==null&&!/^[0-9]{1,20}$/.test(String(stopId))))invalid();
  const wanted=new Set(routes.map(String));
  let feedTime=null,count=0;
  const found=[];
  fields(b,0,b.length,(f,w,x,y)=>{
    if(f===1&&w===2){if(feedTime!==null)invalid();feedTime=header(b,x,y)}
    if(f===2&&w===2){
      if(++count>20000)invalid();
      const e=entity(b,x,y);
      if(e)found.push(e);
      if(found.length>1000)invalid();
    }
  });
  if(!Number.isSafeInteger(feedTime)||
     feedTime<nowSeconds-600||feedTime>nowSeconds+60)invalid();
  const result=[],seen=new Set();
  for(const item of found){
    if(!item.header||!item.entities.length)continue;
    if(item.periods.length&&!item.periods.some(p=>
      (p.start===null||p.start<=nowSeconds)&&
      (p.end===null||p.end>=nowSeconds)))continue;
    const affected=item.entities.filter(e=>
      (e.routeId&&wanted.has(e.routeId))||
      (e.stopId&&stopId!==null&&e.stopId===String(stopId)));
    if(!affected.length)continue;
    const id=String(item.id||'');
    if(id&&seen.has(id))continue;
    if(id)seen.add(id);
    result.push({id:id.slice(0,100),title:item.header,
      description:item.description,effect:Number(item.effect)||0,
      cause:Number(item.cause)||0,
      matchedRoutes:[...new Set(affected.map(x=>x.routeId).filter(Boolean))].slice(0,20),
      matchedStops:[...new Set(affected.map(x=>x.stopId).filter(Boolean))].slice(0,20)});
    if(result.length>=15)break;
  }
  return {feedTimestamp:feedTime,sourceEntities:count,alerts:result};
}
