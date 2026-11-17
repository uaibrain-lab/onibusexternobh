/* P9: offline OSM footpath routing with local static tiles. No paid APIs.
 * ODbL: © OpenStreetMap contributors, data from Geofabrik extracts.
 * Never claim a path if there is no connected pedestrian graph.
 */
'use strict';
(function(global){
const RAD=Math.PI/180,MAX_TILES=60;
function dist(a,b){
 const p=(b[0]-a[0])*RAD,q=(b[1]-a[1])*RAD;
 const v=Math.sin(p/2)**2+Math.cos(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.sin(q/2)**2;
 return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.max(0,v))));
}
function key(a,b,scale=100){return Math.floor(a*scale)+'_'+Math.floor(b*scale)}
class Heap {
 constructor(){this.q=[]}
 push(item){let a=this.q,i=a.length;a.push(item);while(i){const p=(i-1)>>1;if(a[p][0]<=item[0])break;a[i]=a[p];i=p}a[i]=item}
 pop(){let a=this.q;if(!a.length)return null;let top=a[0],end=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let l=i*2+1,r=l+1,n=r<a.length&&a[r][0]<a[l][0]?r:l;if(a[n][0]>=end[0])break;a[i]=a[n];i=n}a[i]=end}return top}
 get size(){return this.q.length}
}
class PedestrianNetwork {
 constructor(root,fetcher=fetch){
   this.root=root.endsWith('/')?root:root+'/';this.fetcher=fetcher;
   this.meta=null;this.known=null;this.cache=new Map();this.pending=new Map();
 }
 async init(){
   if(this.known!==null)return this.known;
   try{
     const resp=await this.fetcher(this.root+'index.json',{cache:'force-cache'});
     if(!resp.ok){this.known=false;return false}
     const m=await resp.json();
     if(m.schema!==1||!m.tileNames?.length||m.nodeCount<2)
       throw Error('Grafo de pedestres inválido');
     this.meta=m;this.known=true;this.allowed=new Set(m.tileNames);
     return true;
   }catch(e){this.error=String(e?.message||e);this.known=false;return false}
 }
 async tile(tileName){
   if(!this.allowed.has(tileName))return new Map();
   if(this.cache.has(tileName))return this.cache.get(tileName);
   if(this.pending.has(tileName))return this.pending.get(tileName);
   const p=(async()=>{
     const response=await this.fetcher(this.root+'tiles/'+tileName+'.json.gz',
                                      {cache:'force-cache'});
     if(!response.ok)throw Error('Tile de pedestre indisponível: '+tileName);
     let bytes=await response.arrayBuffer();
     let array=new Uint8Array(bytes);
     if(array.length>2&&array[0]===31&&array[1]===139){
       if(typeof DecompressionStream==='undefined')throw Error('Gzip indisponível');
       bytes=await new Response(new Blob([bytes]).stream()
         .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
     }
     let nodes=JSON.parse(new TextDecoder().decode(bytes));
     const map=new Map(nodes.map(row=>[row[0],row]));
     this.cache.set(tileName,map);
     if(this.cache.size>MAX_TILES)this.cache.delete(this.cache.keys().next().value);
     return map;
   })();
   this.pending.set(tileName,p);
   try{return await p}finally{this.pending.delete(tileName)}
 }
 async snap(point,maxMetres=85){
   if(!await this.init())return null;
   const lat=point[0],lon=point[1],scale=this.meta.tileScale;
   const cx=Math.floor(lat*scale),cy=Math.floor(lon*scale);
   const radius=Math.ceil(maxMetres/900)+1;
   const tiles=[];
   for(let a=cx-radius;a<=cx+radius;a++)for(let b=cy-radius;b<=cy+radius;b++){
     const tileName=a+'_'+b;
     if(this.allowed.has(tileName))tiles.push(tileName)
   }
   let best=null,bestDist=maxMetres;
   const maps=await Promise.all(tiles.map(t=>this.tile(t)));
   for(const map of maps)for(const row of map.values()){
     if(row[3].length===0)continue;
     const coords=[row[1]/1e6,row[2]/1e6],m=dist(point,coords);
     if(m<bestDist){bestDist=m;best={id:row[0],coords,meters:m}}
   }
   return best;
 }
 async route(a,b,{maxMeters=2700,maxVisited=25000}={}){
   if(!await this.init())return null;
   const straight=dist(a,b);
   if(straight>maxMeters||straight<0)return null;
   const [from,to]=await Promise.all([this.snap(a),this.snap(b)]);
   if(!from||!to)return null;
   const maxLength=Math.min(maxMeters,Math.max(250,straight*2.7+150));
   const h=new Heap(),seen=new Map(),parents=new Map(),loc=new Map();
   loc.set(from.id,from.coords);
   h.push([dist(from.coords,to.coords),0,from.id]);
   let count=0,done=false;
   while(h.size&&count++<maxVisited){
     const [_,meters,id]=h.pop();
     if(meters>maxLength)continue;
     if((seen.get(id)??Infinity)<=meters)continue;
     seen.set(id,meters);
     if(id===to.id){done=true;break}
     const point=loc.get(id);
     if(!point)continue;
     const node=(await this.tile(key(point[0],point[1],this.meta.tileScale))).get(id);
     if(!node)continue;
     for(const [next,la,lo,step] of node[3]){
       const nd=meters+Number(step),pos=[la/1e6,lo/1e6];
       if(nd>maxLength||(seen.get(next)??Infinity)<=nd)continue;
       const target=nd+dist(pos,to.coords);
       if(target>maxLength)continue;
       if((parents.get(next)?.cost??Infinity)>nd){
         parents.set(next,{from:id,cost:nd});
         loc.set(next,pos);
         h.push([target,nd,next]);
       }
     }
   }
   if(!done)return null;
   const path=[],ids=[];
   let node=to.id;
   while(node!=null){
     path.push(loc.get(node));
     ids.push(node);
     if(node===from.id)break;
     node=parents.get(node)?.from;
   }
   if(ids.at(-1)!==from.id)return null;
   path.reverse();
   const len=(seen.get(to.id)||0)+from.meters+to.meters;
   // Snap offsets are not traced/verified; signal endpoint uncertainty.
   const endpointVerified=from.meters<=25&&to.meters<=25;
   return {
     meters:Math.round(len),seconds:Math.ceil(len/1.13),
     geometry:[a,...path,b],
     source:'OpenStreetMap foot network',
     pathVerified:endpointVerified,
     graphConnected:true,
     endpointSnapMeters:Math.round(Math.max(from.meters,to.meters)),
     visited:count
   };
 }
}
global.__PedestrianNetwork=PedestrianNetwork;
})(self);
