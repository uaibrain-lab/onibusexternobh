#!/usr/bin/env python3
"""Create a pedestrian-only graph from a clipped OSM PBF (offline build).

Run with a regional .osm.pbf extracted using osmium complete_ways. Requires
pyosmium only when building; the runtime depends on Python standard library.
Graph edges follow OSM ways, not geographic proximity, preserving barriers.
Data remains ODbL, © OpenStreetMap contributors.
"""
from __future__ import annotations
import datetime as dt
import gzip
import io
import json
import math
import pathlib
import sys

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from transit.matcher import distance_m

# Exclude roads where walking access cannot safely be assumed.
PUBLIC_WALKABLE = {
    'footway','pedestrian','path','steps','living_street','residential',
    'service','unclassified','tertiary','tertiary_link','secondary',
    'secondary_link','primary','primary_link','track'
}
NOT_WALKABLE = {'motorway','motorway_link','trunk','trunk_link','construction',
                'proposed','raceway','bus_guideway','corridor'}
NO_ACCESS={'no','private'}
MAX_SEGMENT_M=700


def allowed(tags):
    highway=tags.get('highway','')
    if highway not in PUBLIC_WALKABLE or highway in NOT_WALKABLE:
        return False
    if tags.get('foot') in NO_ACCESS or tags.get('access') in NO_ACCESS:
        return False
    if tags.get('area')=='yes' or tags.get('highway')=='construction':
        return False
    if tags.get('foot')=='use_sidepath':
        return False
    if highway in {'primary','primary_link','secondary','secondary_link'}:
        # Main roads are included only when foot passage or sidewalk is
        # positively tagged. Missing metadata is not proof of a footpath.
        return tags.get('foot') in {'yes','designated','permissive'} or (
            tags.get('sidewalk') in {'both','left','right','yes','separate'})
    return True


def graph_of_waypoints(ways):
    """Pure helper for independent tests; ways are (node tuples, tags)."""
    points={}
    edges=[]
    for nodes,tags in ways:
        if not allowed(tags):
            continue
        oneway=str(tags.get('oneway:foot','')).lower() in ('yes','1','true')
        reverse=str(tags.get('oneway:foot','')).lower()=='-1'
        for a,b in zip(nodes,nodes[1:]):
            ia,la,loa=a
            ib,lb,lob=b
            if ia==ib:
                continue
            meters=distance_m((la,loa),(lb,lob))
            if not (0<meters<MAX_SEGMENT_M):
                continue
            points[ia]=(round(la,6),round(loa,6))
            points[ib]=(round(lb,6),round(lob,6))
            if reverse:
                edges.append((ib,ia,round(meters,2),1))
            else:
                edges.append((ia,ib,round(meters,2),1 if oneway else 0))
    return points,edges


def build(pbf, output):
    try:
        import osmium
    except ImportError as exc:
        raise RuntimeError('Instale pyosmium: pip install osmium') from exc
    class Collector(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.points={}
            self.edges=[]
            self.ways=0
            self.excluded=0

        def way(self,w):
            tags=dict(w.tags)
            if not allowed(tags):
                self.excluded+=1
                return
            refs=[]
            for n in w.nodes:
                if not n.location.valid():
                    refs.append(None)
                    continue
                lat,lon=n.location.lat,n.location.lon
                if not (-20.27<=lat<=-19.65 and -44.35<=lon<=-43.60):
                    refs.append(None)
                else:
                    refs.append((int(n.ref),float(lat),float(lon)))
            self.ways+=1
            # No connectivity is inferred across gaps or unsupported tags.
            for a,b in zip(refs,refs[1:]):
                if a is None or b is None:
                    continue
                p,e=graph_of_waypoints([([a,b],tags)])
                self.points.update(p)
                self.edges.extend(e)

    h=Collector()
    h.apply_file(str(pbf),locations=True,idx='flex_mem')
    if len(h.points)<5000 or len(h.edges)<5000:
        raise ValueError('Extrato OSM pequeno/incompleto para BH')
    ids=sorted(h.points)
    remap={nid:i for i,nid in enumerate(ids)}
    edges=[[remap[a],remap[b],dist,flags] for a,b,dist,flags in h.edges
           if a in remap and b in remap]
    # A deterministic node order permits reproducible compact artifacts.
    graph={
        'schema':1,'attribution':'© OpenStreetMap contributors (ODbL)',
        'source':'Geofabrik Sudeste OSM; cropped to Belo Horizonte',
        'generatedUTC':dt.datetime.now(dt.timezone.utc).isoformat(),
        'bbox':[-44.35,-20.27,-43.60,-19.65],
        'nodes':[h.points[nid] for nid in ids],'edges':edges,
        'notes':'Connected pedestrian OSM ways; station entrances/sidewalk continuity and safety require field validation.'
    }
    output=pathlib.Path(output)
    output.parent.mkdir(parents=True,exist_ok=True)
    with gzip.open(output,'wt',encoding='utf-8',compresslevel=6) as stream:
        json.dump(graph,stream,separators=(',',':'),ensure_ascii=False)
    print('WALK_NETWORK_OK',len(ids),'nodes',len(edges),'edges',
          h.ways,'eligible ways',output.stat().st_size,'bytes')


if __name__=='__main__':
    if len(sys.argv)!=3:
        raise SystemExit('Uso: python scripts/build_walking.py recorte.osm.pbf catalog/walk-network.json.gz')
    build(sys.argv[1],sys.argv[2])
