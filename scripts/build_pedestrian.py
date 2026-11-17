#!/usr/bin/env python3
"""Build a walkable OSM graph in small static tiles; no online routing service.

Input is a *cropped* .osm.pbf of Belo Horizonte/Contagem (e.g. extracted with
osmium extract --strategy complete_ways from a Geofabrik Sudeste PBF). Uses
pyosmium only at build time, not in users' browsers. The graph contains OSM
way geometry and actual node connectivity, so bridges do not create phantom
intersections with roads crossing underneath. Attribution ODbL required.

Tile format: JSON gzip, array of [osmNodeId,latE6,lonE6,neighbors].
Neighbors are [osmNodeId,latE6,lonE6,edgeMeters]. Nodes may connect across
tiles by osmNodeId; the browser loads the neighbor's own tile on demand.
"""
from __future__ import annotations
import datetime as dt
import gzip
import json
import math
from pathlib import Path
import shutil
import sys
import tempfile

# Includes the transit-oriented part of Belo Horizonte, Contagem, Betim,
# and nearby northern connections. It is not all of metropolitan BH.
BBOX=(-44.25,-20.17,-43.64,-19.63)  # min_lon,min_lat,max_lon,max_lat
TILE_SCALE=100
WALKWAYS=frozenset((
    'footway','pedestrian','path','steps','living_street','residential',
    'service','unclassified','tertiary','secondary','primary','cycleway',
    'track','corridor','platform','road'
))
EXCLUDE_ACCESS=frozenset(('no','private','delivery','agricultural','forestry'))
MAX_NODES=2000000
MAX_EDGES=6000000


def allowed(tags):
    tags=dict(tags)
    highway=tags.get('highway')
    if highway not in WALKWAYS:
        return False
    if tags.get('foot') in EXCLUDE_ACCESS or tags.get('access') in EXCLUDE_ACCESS:
        return False
    if tags.get('motorroad')=='yes':
        return False
    if highway in ('primary','secondary') and tags.get('sidewalk') in ('no','none'):
        return False
    return True


def meters(a,b):
    lat1,lon1=a;lat2,lon2=b
    rad=math.pi/180
    dlat=(lat2-lat1)*rad
    dlon=(lon2-lon1)*rad
    aa=math.sin(dlat/2)**2+math.cos(lat1*rad)*math.cos(lat2*rad)*math.sin(dlon/2)**2
    return round(12742000*math.asin(min(1,math.sqrt(max(0,aa)))),1)


def tile(lat,lon):
    return f'{math.floor(lat*TILE_SCALE)}_{math.floor(lon*TILE_SCALE)}'


def build_graph(ways):
    """Pure helper: (tags, nodes[(osm_id,lat,lng)]) -> connected graph."""
    nodes={}
    edges={}
    accepted=0
    edge_count=0
    for tags,points in ways:
        if not allowed(tags):
            continue
        accepted+=1
        tags=dict(tags)
        onefoot=tags.get('oneway:foot') or (
            tags.get('oneway') if tags.get('highway') in ('steps','footway','path') else '')
        reverse_only=onefoot=='-1'
        oneway=onefoot in ('yes','1','true','-1')
        for first,second in zip(points,points[1:]):
            a,lat1,lon1=first;b,lat2,lon2=second
            if not all(map(math.isfinite,[lat1,lon1,lat2,lon2])):
                continue
            if not (BBOX[1]<=lat1<=BBOX[3] and BBOX[0]<=lon1<=BBOX[2] and
                    BBOX[1]<=lat2<=BBOX[3] and BBOX[0]<=lon2<=BBOX[2]):
                continue
            length=meters((lat1,lon1),(lat2,lon2))
            if not 0<length<1500:
                continue
            nodes[a]=(round(lat1*1e6),round(lon1*1e6))
            nodes[b]=(round(lat2*1e6),round(lon2*1e6))
            if not reverse_only:
                if b not in edges.setdefault(a,{}):edge_count+=1
                edges[a][b]=length
            if not oneway or reverse_only:
                if a not in edges.setdefault(b,{}):edge_count+=1
                edges[b][a]=length
            if len(nodes)>MAX_NODES or edge_count>MAX_EDGES:
                raise ValueError('Grafo OSM excedeu limites de memória predefinidos')
    return nodes,edges,accepted


def make_catalog(osm_path,target):
    try:
        import osmium
    except ImportError as exc:
        raise RuntimeError('Instale pyosmium apenas no gerador: pip install osmium') from exc
    class Collector(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.ways=[]
        def way(self,way):
            tags={t.k:t.v for t in way.tags}
            if not allowed(tags):return
            points=[]
            for n in way.nodes:
                if n.location.valid():
                    points.append((int(n.ref),float(n.location.lat),float(n.location.lon)))
                else:
                    points.append(None)
            # Keep disconnected chunks disconnected; an invalid/missing
            # coordinate must not introduce an artificial bridge.
            segment=[]
            for p in points+[None]:
                if p is None:
                    if len(segment)>1:self.ways.append((tags,segment))
                    segment=[]
                else:segment.append(p)
    handler=Collector()
    handler.apply_file(str(osm_path),locations=True,idx='sparse_mem_array')
    nodes,edges,accepted=build_graph(handler.ways)
    del handler
    if len(nodes)<5000 or accepted<1000:
        raise ValueError('Extração OSM pequena demais para ser a rede real de BH')
    target=Path(target)
    stage=Path(tempfile.mkdtemp(prefix='pedestrian-',dir=str(target.parent)))
    try:
        tiles={}
        for node,(lat,lon) in nodes.items():
            key=tile(lat/1e6,lon/1e6)
            adjacent=[]
            for nxt,length in edges.get(node,{}).items():
                pos=nodes.get(nxt)
                if pos is None:continue
                adjacent.append([nxt,pos[0],pos[1],length])
            tiles.setdefault(key,[]).append([node,lat,lon,adjacent])
        total_bytes=0
        for name,items in tiles.items():
            dest=stage/'tiles'/(name+'.json.gz')
            dest.parent.mkdir(parents=True,exist_ok=True)
            with gzip.open(dest,'wt',encoding='utf-8',compresslevel=6) as f:
                json.dump(items,f,separators=(',',':'))
            total_bytes+=dest.stat().st_size
        manifest={
            'schema':1,'source':'OpenStreetMap / Geofabrik Sudeste',
            'sourceUrl':'https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf',
            'license':'ODbL 1.0; © OpenStreetMap contributors',
            'builtUTC':dt.datetime.now(dt.timezone.utc).isoformat(),
            'bounds':BBOX,'tileScale':TILE_SCALE,
            'nodeCount':len(nodes),'edgeCount':sum(map(len,edges.values())),
            'tileCount':len(tiles),'tileNames':sorted(tiles),
            'compressedBytes':total_bytes,
            'footProfile':'OSM highway, access/foot/oneway:foot; no guaranteed accessibility',
            'notes':'Real OSM path geometry; connectivity may be missing. Coordinates snapped only within strict distance, no invented walkways.'
        }
        (stage/'index.json').write_text(json.dumps(manifest,separators=(',',':')),encoding='utf-8')
        if target.exists():shutil.rmtree(target)
        shutil.move(str(stage),str(target))
    finally:shutil.rmtree(stage,ignore_errors=True)
    print('PEDESTRIAN_GRAPH_OK',len(nodes),'nodes',manifest['edgeCount'],'edges',
          len(tiles),'tiles',round(total_bytes/1048576,2),'MiB',flush=True)
    return manifest


if __name__=='__main__':
    if len(sys.argv)<3:raise SystemExit('Uso: build_pedestrian.py bairro.osm.pbf catalog/pedestrian')
    make_catalog(sys.argv[1],sys.argv[2])
