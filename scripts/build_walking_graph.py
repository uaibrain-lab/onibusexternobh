#!/usr/bin/env python3
"""Compile a REAL pedestrian graph from OSM ways, never haversine-only hops.

Supports small OSM XML fixtures with the stdlib and geofabrik/BBBike .osm.pbf
via optional 'osmium' Python package. The compiled graph is static gzip JSON:
  {schema:1,area,source,osmDate,nodes:[[lat,lng],...],
   edges:[[from,to,distance_m],...]}
Geographic point-to-road snapping is performed by the Web Worker and kept
explicit (snap alone is NOT proof of an accessible station/doorway).
"""
from __future__ import annotations
import argparse
import datetime as dt
import gzip
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

BOUNDS=(-20.17,-44.19,-19.71,-43.72)
HIGHWAYS={
 'footway','pedestrian','path','living_street','residential',
 'unclassified','tertiary','secondary','primary','service','steps',
 'track','cycleway','bridleway'
}
SKIP={'motorway','motorway_link','trunk','trunk_link','raceway',
      'construction','proposed','platform','abandoned'}
PRIVATE={'private','no','restricted','customers','delivery','destination'}


def can_walk(tags):
    highway=tags.get('highway')
    if not highway or highway in SKIP or highway not in HIGHWAYS:
        return False
    if tags.get('area')=='yes' or tags.get('access') in PRIVATE:
        return False
    if tags.get('foot') in ('no','private','restricted'):
        return False
    if tags.get('highway') in ('cycleway','bridleway','track'):
        return tags.get('foot') in ('yes','designated','permissive')
    if tags.get('highway') in ('primary','secondary') and tags.get('sidewalk')=='no':
        return False
    if tags.get('ford')=='yes' and tags.get('foot')!='yes':
        return False
    return True


def haversine(a,b):
    rad=math.pi/180
    lat=(b[0]-a[0])*rad
    lon=(b[1]-a[1])*rad
    q=math.sin(lat/2)**2+math.cos(a[0]*rad)*math.cos(b[0]*rad)*math.sin(lon/2)**2
    return round(12742000*math.asin(min(1,math.sqrt(q))),1)


class GraphBuilder:
    def __init__(self,bounds=BOUNDS):
        self.bounds=tuple(bounds)
        self.osm_nodes={}
        self.barriers=set()
        self.ways=[]
        self.way_count=0

    def in_bbox(self,lat,lon):
        south,west,north,east=self.bounds
        return south<=lat<=north and west<=lon<=east

    def add_node(self,node_id,lat,lon,tags=None):
        if self.in_bbox(lat,lon):
            self.osm_nodes[int(node_id)]=(round(lat,7),round(lon,7))
            tags=tags or {}
            if tags.get('barrier') in ('wall','fence','bollard','block','cycle_barrier') and tags.get('foot') not in ('yes','designated'):
                self.barriers.add(int(node_id))
            if tags.get('access') in ('private','no') and tags.get('foot')!='yes':
                self.barriers.add(int(node_id))

    def add_way(self,node_ids,tags):
        if not can_walk(tags):
            return
        ids=[int(n) for n in node_ids]
        if len(ids)<2:
            return
        self.ways.append(ids)
        self.way_count+=1

    def compile(self,source):
        vertices=set()
        edge_map={}
        for way in self.ways:
            for a,b in zip(way,way[1:]):
                if a==b or a in self.barriers or b in self.barriers:
                    continue
                ca=self.osm_nodes.get(a)
                cb=self.osm_nodes.get(b)
                if ca is None or cb is None:
                    continue
                meters=haversine(ca,cb)
                if not 0<meters<1500:
                    continue
                vertices.update((a,b))
                key=(min(a,b),max(a,b))
                edge_map[key]=min(meters,edge_map.get(key,float('inf')))
        ids=sorted(vertices)
        positions={osm:i for i,osm in enumerate(ids)}
        nodes=[list(self.osm_nodes[n]) for n in ids]
        edges=[[positions[a],positions[b],d] for (a,b),d in sorted(edge_map.items())]
        if not edges:
            raise ValueError('Sem rede caminhável OSM dentro da área selecionada')
        return {
            'schema':1,
            'source':source,
            'license':'© OpenStreetMap contributors, ODbL',
            'osmDate':dt.datetime.now(dt.timezone.utc).isoformat(),
            'bbox':list(self.bounds),
            'nodes':nodes,'edges':edges,
            'nodeCount':len(nodes),'edgeCount':len(edges),
            'warnings':[
             'OSM não garante que a passagem seja acessível, segura ou aberta.',
             'Pontos GTFS e coordenadas das estações não são entradas pedonais verificadas.',
             'Caminhos rodoviários não são permitidos sem acesso pedestre explícito quando aplicável.'
            ]
        }


def from_xml(path,graph):
    # XML fixture reader and fallback for prepared small extracts only.
    if Path(path).stat().st_size>70*1024*1024:
        raise ValueError('OSM XML grande: extraia PBF e utilize pyosmium')
    root=ET.parse(path).getroot()
    for entry in root.findall('node'):
        tags={x.get('k'):x.get('v') for x in entry.findall('tag')}
        graph.add_node(int(entry.get('id')),float(entry.get('lat')),
                       float(entry.get('lon')),tags)
    for entry in root.findall('way'):
        tags={x.get('k'):x.get('v') for x in entry.findall('tag')}
        graph.add_way([int(x.get('ref')) for x in entry.findall('nd')],tags)


def from_pbf(path,graph):
    try:
        import osmium
    except ImportError as exc:
        raise RuntimeError('PBF exige pacote Python gratuito osmium: pip install osmium') from exc
    class Collector(osmium.SimpleHandler):
        def node(self,n):
            if n.location.valid():
                graph.add_node(n.id,n.location.lat,n.location.lon,
                               dict(n.tags))
        def way(self,w):
            tags=dict(w.tags)
            if can_walk(tags):
                graph.add_way([n.ref for n in w.nodes],tags)
    Collector().apply_file(str(path),locations=False)


def build(path,target,bounds=BOUNDS,source=None):
    graph=GraphBuilder(bounds)
    if str(path).endswith('.osm') or str(path).endswith('.xml'):
        from_xml(path,graph)
    else:
        from_pbf(path,graph)
    model=graph.compile(source or str(path))
    target=Path(target)
    target.parent.mkdir(parents=True,exist_ok=True)
    with gzip.open(target,'wt',encoding='utf-8',compresslevel=7) as output:
        json.dump(model,output,separators=(',',':'),ensure_ascii=False)
    print('PEDESTRIAN_OSM_GRAPH_OK',model['nodeCount'],'nodes',
          model['edgeCount'],'edges',target.stat().st_size,'compressed bytes',
          flush=True)
    return model


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('input',help='.osm.pbf, .osm or .xml')
    p.add_argument('output',help='catalog/walk/graph.json.gz')
    p.add_argument('--bbox',nargs=4,type=float,default=BOUNDS,
                   metavar=('SOUTH','WEST','NORTH','EAST'))
    p.add_argument('--source',default=None)
    a=p.parse_args()
    build(a.input,a.output,a.bbox,a.source)
