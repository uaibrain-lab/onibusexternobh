/* P9 pedestrian routes on an offline OpenStreetMap walking graph.
 * No API requests for private coordinates. The graph is fetched once as
 * static data; A* runs in the same Web Worker as the transit planner.
 */
'use strict';
const WalkGraph=(()=>{
  const rad=Math.PI/180;
  const dist=(a,b)=>{
    const lat=(b[0]-a[0])*rad,lon=(b[1]-a[1])*rad;
    const v=Math.sin(lat/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(lon/2)**2;
    return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.max(0,v))));
  };
  const key=p=>Math.floor(p[0]*1000)+':'+Math.floor(p[1]*1000);
  class Heap{
    constructor(){this.data=[]}
    push(item){
      const a=this.data;let i=a.length;a.push(item);
      while(i){const p=(i-1)>>1;if(a[p][0]<=item[0])break;a[i]=a[p];i=p}
      a[i]=item;
    }
    pop(){
      const a=this.data;if(!a.length)return null;
      const out=a[0],item=a.pop();if(!a.length)return out;
      let i=0;
      while(i*2+1<a.length){
        let k=i*2+1;if(k+1<a.length&&a[k+1][0]<a[k][0])k++;
        if(a[k][0]>=item[0])break;
        a[i]=a[k];i=k;
      }
      a[i]=item;return out;
    }
    get length(){return this.data.length}
  }
  class Network{
    constructor(obj){
      if(obj.schema!==1||!Array.isArray(obj.nodes)||!Array.isArray(obj.edges)||
         obj.nodes.length!==obj.nodeCount||obj.edges.length!==obj.edgeCount)
        throw Error('Grafo OSM incompatível ou incompleto');
      this.nodes=obj.nodes;this.edges=obj.edges;this.index=new Map();
      this.adj=Array.from({length:this.nodes.length},()=>[]);
      for(const [a,b,meters] of this.edges){
        if(!this.nodes[a]||!this.nodes[b]||!Number.isFinite(meters)||meters<=0)
          throw Error('Aresta inválida no grafo OSM');
        this.adj[a].push([b,meters]);this.adj[b].push([a,meters]);
      }
      for(let n=0;n<this.nodes.length;n++){
        const k=key(this.nodes[n]);
        if(!this.index.has(k))this.index.set(k,[]);
        this.index.get(k).push(n);
      }
      this.cache=new Map();
      this.meta={nodeCount:obj.nodeCount,edgeCount:obj.edgeCount,source:obj.source,
        osmDate:obj.osmDate,bbox:obj.bbox};
    }
    nearest(point,maxSnap=70){
      const lat=Math.floor(point[0]*1000),lon=Math.floor(point[1]*1000);
      let best=null;
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)
        for(const id of this.index.get((lat+x)+':'+(lon+y))||[]){
          const d=dist(this.nodes[id],point);
          if(d<=maxSnap&&(!best||d<best[1]))best=[id,d];
        }
      return best;
    }
    distancesToStops(origin,points,limitMeters=2500){
      // Dijkstra ONCE for all candidate stops near the requested endpoint.
      // Repeated A* per stop would scale poorly on Android. The result
      // contains real street-network walk cost (not crow-flies distance).
      if(!Array.isArray(points)||points.length>160||!Number.isFinite(limitMeters)||
         limitMeters<=0||limitMeters>3500)return new Map();
      const root=this.nearest(origin);
      if(!root)return new Map();
      const targets=new Map();
      let targetCount=0;
      for(const item of points){
        if(!Number.isInteger(item.index)||!Array.isArray(item.coords))continue;
        const snap=this.nearest(item.coords);
        if(!snap||root[1]+snap[1]>limitMeters)continue; // inaccessible within budget
        if(!targets.has(snap[0]))targets.set(snap[0],[]);
        targets.get(snap[0]).push([item.index,snap[1]]);
        targetCount++;
      }
      const results=new Map();
      // No snapped candidates: avoid a needless 30k-node Dijkstra on mobile.
      if(targetCount===0)return results;
      const travelTimes=new Map([[root[0],0]]);
      const heap=new Heap();
      heap.push([0,root[0]]);
      let expanded=0,found=0;
      while(heap.length&&expanded<30000){
        const [meters,node]=heap.pop();
        if(meters>limitMeters-root[1])break;
        if(meters>travelTimes.get(node))continue;
        expanded++;
        for(const [index,stopSnap] of targets.get(node)||[]){
          const distance=meters+root[1]+stopSnap;
          if(distance>limitMeters)continue;
          results.set(index,{
            meters:Math.round(distance),
            seconds:Math.ceil(distance/1.15)+35,
            snapMeters:Math.round(root[1]+stopSnap)
          });
          found++;
        }
        if(found>=targetCount)return results;
        for(const [to,edgeMeters] of this.adj[node]){
          const next=meters+edgeMeters;
          if(next>limitMeters-root[1]||next>= (travelTimes.get(to)??Infinity))
            continue;
          travelTimes.set(to,next);
          heap.push([next,to]);
        }
      }
      return results;
    }
    componentIds(){
      // Compute components only when diagnostics are requested. The normal
      // mobile planner does NOT pay the O(nodes+edges) cost.
      if(this._componentIds)return this._componentIds;
      const ids=new Int32Array(this.nodes.length);
      ids.fill(-1);
      const queue=[];
      let part=0;
      for(let root=0;root<this.nodes.length;root++){
        if(ids[root]>=0)continue;
        queue.length=0;queue.push(root);ids[root]=part;
        for(let cursor=0;cursor<queue.length;cursor++){
          const at=queue[cursor];
          for(const [next] of this.adj[at]){
            if(ids[next]>=0)continue;
            ids[next]=part;queue.push(next);
          }
        }
        part++;
      }
      this._componentIds=ids;
      return ids;
    }
    explainFailure(from,to,limitMeters=2500){
      // Aggregatable explanation of a rejected OSM walk; no coordinates,
      // node IDs or passenger locations escape from the worker.
      const a=this.nearest(from),b=this.nearest(to);
      if(!a||!b)return {
        reason:!a&&!b?'bothEndpointsUnsnapped':!a?'fromUnsnapped':'toUnsnapped',
        fromSnapMeters:a?Math.round(a[1]):null,
        toSnapMeters:b?Math.round(b[1]):null
      };
      const straight=Math.round(dist(from,to));
      if(straight+a[1]+b[1]>limitMeters)return {
        reason:'minimumWalkingDistanceOverBudget',
        straightDistanceMeters:straight,
        fromSnapMeters:Math.round(a[1]),toSnapMeters:Math.round(b[1])
      };
      const ids=this.componentIds();
      return {
        reason:ids[a[0]]!==ids[b[0]]?'disconnectedPedestrianComponents':
          'walkDetourExceedsBudgetOrSearchLimit',
        straightDistanceMeters:straight,
        fromSnapMeters:Math.round(a[1]),toSnapMeters:Math.round(b[1])
      };
    }
    route(from,to,limitMeters=2500){
      const a=this.nearest(from),b=this.nearest(to);
      if(!a||!b||a[1]+b[1]>limitMeters)return null;
      if(a[0]===b[0]){
        const meters=a[1]+b[1];
        return meters<=limitMeters?{
          meters:Math.round(meters),seconds:Math.ceil(meters/1.15)+35,
          geometry:[from,this.nodes[a[0]],to],snapMeters:Math.round(meters),
          pathSource:'OSM walking network (snapped access)'
        }:null;
      }
      const cacheKey=a[0]+':'+b[0]+':'+limitMeters;
      const stored=this.cache.get(cacheKey);
      if(stored){
        const meters=stored.meters+a[1]+b[1];
        if(meters>limitMeters)return null;
        return {...stored,meters:Math.round(meters),
          seconds:Math.ceil(meters/1.15)+35,
          geometry:[from,...stored.geometry,to],snapMeters:Math.round(a[1]+b[1])};
      }
      const n=this.nodes.length;
      const distances=new Map([[a[0],0]]),parents=new Map();
      const heap=new Heap();
      heap.push([dist(this.nodes[a[0]],this.nodes[b[0]]),a[0],0]);
      const goal=b[0];let expanded=0;
      while(heap.length&&expanded<30000){
        const entry=heap.pop(),pos=entry[1],travel=entry[2];
        if(travel>distances.get(pos))continue;
        if(pos===goal){
          const ids=[pos];let back=pos;
          while(back!==a[0]){
            back=parents.get(back);
            if(back==null)return null;
            ids.push(back);
          }
          ids.reverse();
          const coords=ids.map(i=>this.nodes[i]);
          const core={meters:Math.round(travel),geometry:coords,
            pathSource:'OSM walking network (snapped access)'};
          if(this.cache.size>800)this.cache.clear();
          this.cache.set(cacheKey,core);
          const total=travel+a[1]+b[1];
          if(total>limitMeters)return null;
          return {...core,meters:Math.round(total),
            seconds:Math.ceil(total/1.15)+35,
            geometry:[from,...coords,to],snapMeters:Math.round(a[1]+b[1])};
        }
        expanded++;
        for(const [next,length] of this.adj[pos]){
          const ng=travel+length;
          if(ng+a[1]+b[1]>limitMeters)continue;
          if(ng>= (distances.get(next)??Infinity))continue;
          distances.set(next,ng);parents.set(next,pos);
          heap.push([ng+dist(this.nodes[next],this.nodes[goal]),next,ng]);
        }
      }
      return null;
    }
  }
  return {Network};
})();
