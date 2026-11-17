"""Shortest walking paths on an offline OpenStreetMap pedestrian graph.

An OSM walkable segment is not proof that crossing/entrance is accessible or
safe. We preserve strict connected-component topology: geometrically close
but disconnected ways cannot be bridged by straight-line shortcuts.
"""
from __future__ import annotations
import collections
import functools
import gzip
import heapq
import json
import math
import pathlib

from .matcher import distance_m

CELL_SIZE=1000  # ~110m in latitude at this precision
DEFAULT_MAX_SNAP_M=65


class WalkingGraph:
    def __init__(self, catalog_dir):
        path=pathlib.Path(catalog_dir)/'walk-network.json.gz'
        self.ready=False
        self.reason='Rede de pedestres OSM ainda não gerada'
        if not path.exists():
            return
        try:
            with gzip.open(path,'rt',encoding='utf-8') as file:
                payload=json.load(file)
            if payload.get('schema')!=1:
                raise ValueError('Versão desconhecida da rede de pedestres')
            self.points=[(float(p[0]),float(p[1])) for p in payload['nodes']]
            self.adj=[[] for _ in self.points]
            for a,b,meters,flags in payload['edges']:
                if not (0<=a<len(self.points) and 0<=b<len(self.points)) or a==b:
                    raise ValueError('Conexão OSM inválida')
                d=float(meters)
                if not (0<d<10000):
                    raise ValueError('Comprimento OSM inválido')
                self.adj[a].append((b,d))
                if not (int(flags)&1):
                    self.adj[b].append((a,d))
            self.grid=collections.defaultdict(list)
            for idx,(lat,lng) in enumerate(self.points):
                self.grid[self._cell(lat,lng)].append(idx)
            self.ready=True
            self.reason=None
            self.attribution=payload.get('attribution','© OpenStreetMap contributors')
        except (OSError,ValueError,KeyError,TypeError) as exc:
            self.reason=type(exc).__name__
            self.points=[]
            self.adj=[]

    @staticmethod
    def _cell(lat,lng):
        return int(math.floor(lat*CELL_SIZE)),int(math.floor(lng*CELL_SIZE))

    def snap(self,lat,lng,max_distance=DEFAULT_MAX_SNAP_M):
        if not self.ready:
            return None
        lat=float(lat)
        lng=float(lng)
        if not math.isfinite(lat) or not math.isfinite(lng):
            return None
        x,y=self._cell(lat,lng)
        span=max(1,int(math.ceil(max_distance/75))+1)
        best=None
        for dx in range(-span,span+1):
            for dy in range(-span,span+1):
                for idx in self.grid.get((x+dx,y+dy),()):
                    d=distance_m((lat,lng),self.points[idx])
                    if d<=max_distance and (best is None or d<best[1]):
                        best=(idx,d)
        return best

    def _search(self,start_idx,target_idx,max_cost):
        dest=self.points[target_idx]
        frontier=[(distance_m(self.points[start_idx],dest),0.,start_idx)]
        best={start_idx:0.}
        parents={}
        while frontier:
            _,dist,current=heapq.heappop(frontier)
            if dist!=best.get(current):
                continue
            if dist>max_cost:
                continue
            if current==target_idx:
                chain=[current]
                while current in parents:
                    current=parents[current]
                    chain.append(current)
                return dist,list(reversed(chain))
            for nxt,cost in self.adj[current]:
                nd=dist+cost
                if nd<=max_cost and nd<best.get(nxt,math.inf):
                    best[nxt]=nd
                    parents[nxt]=current
                    h=distance_m(self.points[nxt],dest)
                    if nd+h<=max_cost:
                        heapq.heappush(frontier,(nd+h,nd,nxt))
        return None

    @functools.lru_cache(maxsize=25000)
    def _path_nodes(self,start,end,cap):
        return self._search(start,end,cap)

    def route(self,start,end,max_meters=1800,geometry=False):
        """Return routed pedestrian distance; None when disconnected/unsnappable.

        Access from the specified coordinate to its closest graph node is
        straight-line and MUST be disclosed separately as unverified.
        """
        if not self.ready:
            return None
        a=self.snap(*start)
        b=self.snap(*end)
        if not a or not b or a[1]+b[1]>=max_meters:
            return None
        found=self._path_nodes(a[0],b[0],int(math.ceil(max_meters-a[1]-b[1])))
        if found is None:
            return None
        dist,chain=found
        total=dist+a[1]+b[1]
        if total>max_meters:
            return None
        value={'meters':round(total),'networkMeters':round(dist),
               'unverifiedAccessMeters':round(a[1]+b[1]),
               'walkingSource':'OSM pedestrian graph',
               'routeType':'connected_osm_graph',
               'accessVerified':False}
        if geometry:
            value['geometry']=[[round(start[0],6),round(start[1],6)]]+[
                [round(self.points[n][0],6),round(self.points[n][1],6)]
                for n in chain]+[[round(end[0],6),round(end[1],6)]]
        return value

    def reachable_stops(self,origin,stops,radius=1200,limit=28):
        """Return only foot-reachable GTFS stops, sorted by walked distance."""
        if not self.ready:
            return None
        results=[]
        for sid,entry in stops:
            target=(float(entry[1]),float(entry[2]))
            if distance_m(origin,target)>radius:
                continue
            path=self.route(origin,target,max_meters=int(radius*1.45))
            if path:
                results.append((path['meters'],sid,path))
        results.sort(key=lambda x:x[0])
        return results[:limit]
