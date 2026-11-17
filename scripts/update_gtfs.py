#!/usr/bin/env python3
"""Validate and stage a complete official BH GTFS catalog (stdlib only).

Dry-run is the default. --apply replaces local catalog files after validation
and keeps an on-disk backup on failure. Not a production hot-reload mechanism.
No GPS data, user coordinates, map tiles, or third-party reports are copied.
"""
from __future__ import annotations
import argparse
import collections
import csv
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import shutil
import tempfile
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0,str(ROOT))
from transit.catalog_store import atomic_pointer, resolve_catalog, version_directory, REQUIRED as CATALOG_REQUIRED
OFFICIAL='https://s3.amazonaws.com/mobilibus-uploads/gtfs/GTFSBHTRANS.zip'
OUTPUTS=('routes.json','stops.json','shapes.json','patterns.json',
         'gps-nl-map.json','manifest.json','timetable.json.gz','timetable-calendar.json')
REQUIRED=('routes.txt','stops.txt','shapes.txt','trips.txt','stop_times.txt','calendar.txt')


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, obj):
    Path(path).write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':')),encoding='utf-8')


def base_code(public):
    return str(public or '').strip().split('-',1)[0].upper()


def build(archive, output, original, today=None):
    """Regenerate every catalog dependency in one temporary directory."""
    from scripts.build_timetable import build as build_timetable
    output=Path(output)
    output.mkdir(parents=True,exist_ok=True)
    old_map=load_json(Path(original)/'gps-nl-map.json')
    existing=load_json(Path(original)/'manifest.json')
    today=today or dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).date()
    with zipfile.ZipFile(archive) as z:
        entries={name.rsplit('/',1)[-1]:name for name in z.namelist() if name.endswith('.txt')}
        missing=[name for name in REQUIRED if name not in entries]
        if missing:
            raise ValueError('GTFS faltando: '+', '.join(missing))
        raw_total=sum(info.file_size for info in z.infolist())
        if raw_total>1_800_000_000:
            raise ValueError('GTFS descompactado excede limite de segurança')
        def records(name):
            if name not in entries:
                return
            with z.open(entries[name]) as f:
                yield from csv.DictReader(io.TextIOWrapper(f,encoding='utf-8-sig',newline=''))
        info=next(iter(records('feed_info.txt') or ()),{})
        route_index={}
        route_by_code={}
        for r in records('routes.txt'):
            rid=r['route_id'];code=r['route_short_name'].strip()
            if not code or rid in route_index or code.upper() in route_by_code:
                raise ValueError('Linha com código vazio ou duplicado')
            route_by_code[code.upper()]=rid
            route_index[rid]={'id':rid,'code':code,'name':r.get('route_long_name',''),
                  'agency':r.get('agency_id',''),'color':r.get('route_color',''),
                  'textColor':r.get('route_text_color',''), 'patterns':[],'shapes':[]}
        stops={}
        for r in records('stops.txt'):
            sid=r['stop_id'];lat=float(r['stop_lat']);lon=float(r['stop_lon'])
            if not (-90<=lat<=90 and -180<=lon<=180):
                raise ValueError('Coordenada GTFS inválida')
            stops[sid]=[r.get('stop_name',''),lat,lon]
        shapes=collections.defaultdict(list)
        for r in records('shapes.txt'):
            lat=float(r['shape_pt_lat']);lon=float(r['shape_pt_lon'])
            if not (-90<=lat<=90 and -180<=lon<=180):
                raise ValueError('Geometria GTFS inválida')
            shapes[r['shape_id']].append([round(lat,6),round(lon,6)])
        trips={}
        for r in records('trips.txt'):
            tid=r['trip_id'];rid=r['route_id'];sid=r.get('shape_id','')
            if rid not in route_index or (sid and sid not in shapes):
                raise ValueError('Viagem referencia linha ou geometria ausente')
            trips[tid]=(rid,sid,r.get('direction_id',''),r.get('trip_headsign',''))
        patterns={}; seen=set(); n_times=0; prev_tid=None; seq=[]
        def finish(tid,stop_ids):
            if tid is None:return
            if tid in seen:
                raise ValueError('stop_times não está agrupado por viagem')
            seen.add(tid)
            if tid not in trips:raise ValueError('Horário de viagem inexistente')
            rid,sid,did,head=trips[tid]
            key=(rid,sid,did,tuple(stop_ids))
            if key not in patterns:
                digest=hashlib.sha256(repr(key).encode()).hexdigest()[:20]
                patterns[key]={'id':digest,'route':rid,'shape':sid,'direction':did,
                               'headsign':head,'stops':list(stop_ids),'tripCount':0}
            patterns[key]['tripCount']+=1
        for r in records('stop_times.txt'):
            tid=r['trip_id'];sid=r['stop_id']
            if sid not in stops:raise ValueError('Horário referencia ponto inexistente')
            if tid!=prev_tid:
                finish(prev_tid,seq)
                prev_tid=tid;seq=[]
            seq.append(sid);n_times+=1
        finish(prev_tid,seq)
        if seen!=set(trips):
            raise ValueError('Viagens sem sequências de paradas')
        for p in patterns.values():
            route=route_index[p['route']];route['patterns'].append(p['id'])
            if p['shape'] and p['shape'] not in route['shapes']:
                route['shapes'].append(p['shape'])
        mappings={}
        for key,entry in old_map.items():
            code=base_code(entry.get('public',''))
            rid=route_by_code.get(code)
            mappings[key]={**entry,'routeIds':[rid] if rid else []}
        count_routes=len(route_index);count_stops=len(stops)
        overlap=len({r['code'].upper() for r in route_index.values()} &
                    {r['code'].upper() for r in load_json(Path(original)/'routes.json')})
        old_routes=max(1,int(existing.get('routes') or len(load_json(Path(original)/'routes.json'))))
        old_stops=max(1,int(existing.get('stops') or len(load_json(Path(original)/'stops.json'))))
        if not (count_routes>=max(1,int(old_routes*.8)) and
                count_stops>=max(1,int(old_stops*.8)) and
                overlap>=max(1,int(old_routes*.8))):
            raise ValueError('Queda grande de linhas/paradas; requer revisão manual')
        for name,entity in [('routes.json',sorted(route_index.values(),key=lambda r:r['code'])),
                            ('stops.json',stops),('shapes.json',dict(shapes)),
                            ('patterns.json',list(patterns.values())),('gps-nl-map.json',mappings)]:
            write_json(output/name,entity)
        build_timetable(archive,output)
        calendar=load_json(output/'timetable-calendar.json')
        endpoints=[v['end_date'] for v in calendar['services'].values()]
        if not endpoints or max(endpoints)<(today+dt.timedelta(days=7)).strftime('%Y%m%d'):
            raise ValueError('Calendário não cobre os próximos 7 dias')
        if not calendar.get('records') or calendar.get('stops',0)<old_stops*.6:
            raise ValueError('Horários insuficientes: feed suspeito')
        meta={'source':'PBH/SUMOB GTFS via Mobilibus','gtfsVersion':info.get('feed_version',''),
              'feedStartDate':info.get('feed_start_date',''),
              'feedEndDate':info.get('feed_end_date',''),
              'createdAtUtc':dt.datetime.now(dt.timezone.utc).isoformat(),
              'routes':count_routes,'stops':count_stops,'trips':len(trips),
              'stopTimeRows':n_times,'shapes':len(shapes),'uniqueStopPatterns':len(patterns),
              'nlMappings':len(mappings),'files':list(OUTPUTS),
              'cautions':['Horários programados não confirmam circulação de ônibus',
                          'Relacionamento NL-TRIP não confirma variante de itinerário']}
        write_json(output/'manifest.json',meta)
        return meta


def download(url,target,max_bytes=250_000_000):
    if not url.startswith('https://'):
        raise ValueError('Fonte remota exige HTTPS')
    req=urllib.request.Request(url,headers={'User-Agent':'BH-Externo-GTFS-updater/1.0'})
    with urllib.request.urlopen(req,timeout=80) as response, open(target,'wb') as dst:
        total=0
        while True:
            block=response.read(1024*1024)
            if not block:break
            total+=len(block)
            if total>max_bytes:raise ValueError('Download GTFS excede limite de segurança')
            dst.write(block)


def apply_staging(staging, catalog):
    """Replace only after checks, restoring file versions if installation fails.

    Requires no live readers during a local update; production should switch
    versioned catalog directories atomically instead.
    """
    catalog=Path(catalog)
    with tempfile.TemporaryDirectory(prefix='gtfs-backup-',dir=catalog.parent) as tmp:
        backup=Path(tmp)
        for name in OUTPUTS:
            if (catalog/name).exists():shutil.copy2(catalog/name,backup/name)
        written=[]
        try:
            for name in OUTPUTS:
                os.replace(Path(staging)/name,catalog/name)
                written.append(name)
        except Exception:
            for name in written:
                if (backup/name).exists():shutil.copy2(backup/name,catalog/name)
                elif (catalog/name).exists():(catalog/name).unlink()
            raise


def _digest(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()


def stage_and_activate(staging, catalog, archive):
    """Install an immutable complete snapshot, then atomically change one pointer.

    All eight files are copied to a private directory before publication.
    A running server keeps its original resolved directory until restart.
    Legacy root/catalog files remain valid for rollback without another backup.
    """
    catalog=Path(catalog)
    staging=Path(staging)
    if not all((staging/name).is_file() for name in OUTPUTS):
        raise ValueError('Candidato GTFS incompleto')
    meta=load_json(staging/'manifest.json')
    ver=re.sub(r'[^a-zA-Z0-9_.-]','-',str(meta.get('gtfsVersion') or 'gtfs'))[:35].strip('.-') or 'gtfs'
    version=f'{ver}-{_digest(archive)[:12]}'
    dest=version_directory(catalog,version)
    root=dest.parent
    root.mkdir(parents=True,exist_ok=True)
    if not dest.exists():
        temp=Path(tempfile.mkdtemp(prefix='.candidate-',dir=root))
        try:
            for name in OUTPUTS:
                shutil.copy2(staging/name,temp/name)
            if not all((temp/name).is_file() and (temp/name).stat().st_size>0 for name in CATALOG_REQUIRED):
                raise ValueError('Snapshot incompleto após cópia')
            # One directory rename publishes only the fully validated snapshot.
            os.replace(temp,dest)
        finally:
            if temp.exists(): shutil.rmtree(temp)
    else:
        # Same original archive digest: a previously installed snapshot is immutable.
        # gzip timestamps and generatedAtUTC are not byte-stable across builds.
        if not all((dest/name).is_file() and (dest/name).stat().st_size>0 for name in OUTPUTS):
            raise ValueError('Versão anterior com mesmo hash está incompleta')
    pointer=catalog/'active.json'
    previous=json.loads(pointer.read_text('utf8')).get('active') if pointer.exists() else None
    if previous == version:
        return {'active':version,'previous':json.loads(pointer.read_text('utf8')).get('previous'),'changed':False}
    state=atomic_pointer(catalog,version,previous)
    return {**state,'changed':True}


def rollback(catalog):
    catalog=Path(catalog)
    pointer=catalog/'active.json'
    if not pointer.exists():
        raise ValueError('Nenhuma versão ativada para reverter')
    current=json.loads(pointer.read_text('utf8'))
    previous=current.get('previous')
    if previous is None:
        # Existing root/catalog (the original installation) is preserved.
        pointer.unlink()
        return {'active':'legacy','previous':current['active']}
    state=atomic_pointer(catalog,previous,current['active'])
    return state


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive',help='Arquivo GTFS local; omitir para baixar fonte oficial')
    p.add_argument('--catalog',type=Path,default=ROOT/'catalog')
    p.add_argument('--apply',action='store_true',help='Ativar snapshot completo em nova versão, sem alterar catálogo em uso')
    p.add_argument('--rollback',action='store_true',help='Restaurar versão anterior (reiniciar servidor)')
    args=p.parse_args(argv)
    if not args.catalog.is_dir():raise SystemExit('Catálogo original não encontrado')
    if args.rollback:
        print(json.dumps({'rollback':rollback(args.catalog),'restartRequired':True},ensure_ascii=False))
        return
    with tempfile.TemporaryDirectory(prefix='gtfs-candidate-') as tmp:
        temp=Path(tmp);archive=Path(args.archive) if args.archive else temp/'gtfs.zip'
        if not args.archive:download(OFFICIAL,archive)
        meta=build(archive,temp/'candidate',resolve_catalog(args.catalog))
        print(json.dumps({'validated':True,'applyRequested':args.apply,
                          'gtfsVersion':meta['gtfsVersion'],'routes':meta['routes'],
                          'stops':meta['stops'],'trips':meta['trips']},ensure_ascii=False))
        if args.apply:
            changed=stage_and_activate(temp/'candidate',args.catalog,archive)
            print(json.dumps({'activation':changed,'restartRequired':True},ensure_ascii=False))

if __name__=='__main__':main()
