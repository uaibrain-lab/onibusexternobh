/* Minimal GTFS Realtime VehiclePosition decoder for Workers Free.
 * Standard GTFS-Realtime wire fields only; no npm dependencies or full feed
 * materialization. Unknown protobuf fields are skipped safely.
 * Reference: https://gtfs.org/documentation/realtime/proto/
 */
const decoder=new TextDecoder();
const MAX_ENTITIES=25000;
function invalid(){throw Error('GTFS_RT_PROTO_INVALID')}
function varint(bytes,state,end){
  let value=0,mul=1;
  for(let i=0;i<10;i++){
    if(state.p>=end)invalid();
    const b=bytes[state.p++];
    value+=(b&127)*mul;
    if(!Number.isSafeInteger(value))invalid();
    if((b&128)===0)return value;
    mul*=128;
  }
  invalid();
}
function fields(bytes,start,end,callback){
  const state={p:start};
  while(state.p<end){
    const tag=varint(bytes,state,end);
    const num=Math.floor(tag/8),wire=tag&7;
    if(num<1)invalid();
    let begin=state.p,finish=begin,value=null;
    if(wire===0){value=varint(bytes,state,end);finish=state.p}
    else if(wire===1){finish=begin+8}
    else if(wire===2){const size=varint(bytes,state,end);begin=state.p;finish=begin+size}
    else if(wire===5){finish=begin+4}
    else invalid();
    if(!Number.isSafeInteger(finish)||finish>end)invalid();
    callback(num,wire,begin,finish,value);
    state.p=finish;
  }
}
function string(bytes,s,e){
  if(e-s>160)invalid();
  return decoder.decode(bytes.subarray(s,e));
}
function coordinate(bytes,at){
  return new DataView(bytes.buffer,bytes.byteOffset+at,4).getFloat32(0,true);
}
function trip(bytes,s,e){
  const t={routeId:'',tripId:''};
  fields(bytes,s,e,(f,w,a,b,value)=>{
    if(w===2&&f===1)t.tripId=string(bytes,a,b);
    if(w===2&&f===5)t.routeId=string(bytes,a,b);
    if(w===0&&f===6)t.directionId=value;
  });
  return t;
}
function position(bytes,s,e){
  const p={latitude:NaN,longitude:NaN,heading:null};
  fields(bytes,s,e,(f,w,a)=>{
    if(w!==5)return;
    if(f===1)p.latitude=coordinate(bytes,a);
    if(f===2)p.longitude=coordinate(bytes,a);
    if(f===3)p.heading=coordinate(bytes,a);
  });
  return p;
}
function vehicleDescriptor(bytes,s,e){
  let id='';
  fields(bytes,s,e,(f,w,a,b)=>{if(f===1&&w===2)id=string(bytes,a,b)});
  return id;
}
function vehiclePosition(bytes,s,e){
  let t={},p={},time=null,vehicleId='';
  fields(bytes,s,e,(f,w,a,b,value)=>{
    if(f===1&&w===2)t=trip(bytes,a,b);
    if(f===2&&w===2)p=position(bytes,a,b);
    if(f===5&&w===0)time=value;
    if(f===8&&w===2)vehicleId=vehicleDescriptor(bytes,a,b);
  });
  return {...t,...p,timestamp:time,vehicleId};
}
export function parseVehiclePositions(buffer,requestedRoutes,now=Date.now()){
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  if(bytes.byteLength>8*1024*1024)throw Error('GTFS_RT_TOO_LARGE');
  if(bytes.byteLength<5)invalid();
  const routes=new Set(requestedRoutes.map(String));
  const found=new Map();
  let entities=0,headerPresent=false,vehicleEntities=0,missingRouteIds=0;
  const sampleRouteIds=new Set();
  fields(bytes,0,bytes.length,(f,w,a,b)=>{
    if(f===1&&w===2){
      let version='';
      fields(bytes,a,b,(h,wire,start,end)=>{
        if(h===1&&wire===2)version=string(bytes,start,end);
      });
      if(!/^[12]\.\d{1,3}$/.test(version))invalid();
      headerPresent=true;return;
    }
    if(f!==2||w!==2)return;
    if(++entities>MAX_ENTITIES)throw Error('GTFS_RT_TOO_MANY_ENTITIES');
    fields(bytes,a,b,(num,wire,start,end)=>{
      if(num!==4||wire!==2)return;
      const v=vehiclePosition(bytes,start,end);
      vehicleEntities++;
      if(!v.routeId)missingRouteIds++;
      else if(sampleRouteIds.size<12)sampleRouteIds.add(String(v.routeId));
      if(!routes.has(String(v.routeId||'')))return;
      const when=Number(v.timestamp)*1000;
      if(!Number.isSafeInteger(when)||when>now+60000||when<now-10*60000)return;
      if(!Number.isFinite(v.latitude)||!Number.isFinite(v.longitude)||
         v.latitude< -20.5||v.latitude> -19.4||
         v.longitude< -44.5||v.longitude> -43.4)return;
      if(!v.vehicleId||v.vehicleId.length>80)return;
      const id=String(v.routeId)+'|'+v.vehicleId;
      const previous=found.get(id);
      if(!previous||when>Date.parse(previous.lastGpsFixAt)){
        found.set(id,{
          routeId:String(v.routeId),vehicleId:v.vehicleId,
          tripId:String(v.tripId||''),
          latitude:v.latitude,longitude:v.longitude,
          heading:Number.isFinite(v.heading)&&v.heading>=0&&v.heading<=360?v.heading:null,
          lastGpsFixAt:new Date(when).toISOString(),
          ...(v.directionId===0||v.directionId===1?{directionId:v.directionId}:{})
        });
      }
      if(found.size>1500)throw Error('GPS_TOO_MANY_MATCHES');
    });
  });
  if(!headerPresent)invalid();
  return {records:[...found.values()],sourceEntities:entities,
    vehicleEntities,missingRouteIds,sampleRouteIds:[...sampleRouteIds]};
}
