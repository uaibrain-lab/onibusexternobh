#!/usr/bin/env python3
"""Generate a browser-side, zero-server Connection Scan index from routing v3.

Reads the existing checked GTFS trip shards. Writes hour-bucketed fixed-length
little-endian binary connections, in both travel directions. The browser uses
only the requested hours and performs routing in a Web Worker.

Format of each 20-byte record (5 unsigned 32-bit ints):
  from_stop, to_stop, depart_seconds, arrive_seconds, packed_trip_flags
packed_trip_flags: low 20 bits trip index, bit20 pickup allowed,
bit21 dropoff allowed. Time supports >24:00 GTFS service days.

No API keys, hosted route engine or paid jobs; Python standard library only.
"""
from __future__ import annotations
import array
import datetime as dt
import gzip
import json
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[1]
PACK=struct.Struct('<IIIII')
TRIP_MASK=(1<<20)-1
BOARD=1<<20
ALIGHT=1<<21
MAX_HOUR=48
DAYS=('monday','tuesday','wednesday','thursday','friday','saturday','sunday')


def write_gzip_json(path,obj):
    with gzip.open(path,'wt',encoding='utf-8',compresslevel=6) as f:
        json.dump(obj,f,ensure_ascii=False,separators=(',',':'))


def build(catalog=None):
    catalog=Path(catalog or ROOT/'catalog')
    index=json.loads((catalog/'routing-index.json').read_text(encoding='utf-8'))
    if index.get('schema')!=3:
        raise ValueError('Índice GTFS v3 obrigatório. Gere build_routing.py antes.')
    stops=json.loads((catalog/'routing-stops.json').read_text(encoding='utf-8'))
    stop_ids=sorted(stops)
    stop_pos={sid:i for i,sid in enumerate(stop_ids)}
    service_ids=sorted(set(index['services']) | {
        sid for exceptions in index['exceptions'].values() for sid in exceptions})
    service_pos={sid:i for i,sid in enumerate(service_ids)}
    service_meta=[]
    for sid in service_ids:
        cal=index['services'].get(sid)
        mask=sum(1<<i for i,day in enumerate(DAYS) if cal and str(cal.get(day))=='1')
        service_meta.append({'id':sid,'calendar':cal,'group':str(mask)})
    service_groups={s['id']:s['group'] for s in service_meta}
    work=catalog/'scan'
    tmp=Path(tempfile.mkdtemp(prefix='bh-route-scan-'))
    try:
        temp_out=tmp/'forward'
        temp_in=tmp/'reverse'
        temp_out.mkdir()
        temp_in.mkdir()
        handles={'out':{},'in':{}}
        def put(direction,group,hour,payload):
            key=(group,hour)
            if key not in handles[direction]:
                folder=(temp_out if direction=='out' else temp_in)/group
                folder.mkdir(parents=True,exist_ok=True)
                handles[direction][key]=(folder/f'{hour:02}.bin').open('wb')
            handles[direction][key].write(payload)
        trips=[]
        total=0
        malformed=0
        try:
            for code,name in sorted(index['files'].items()):
                with gzip.open(catalog/name,'rt',encoding='utf-8') as stream:
                    for trip_id,service,headsign,rows in json.load(stream):
                        if not rows or service not in service_pos:
                            continue
                        if len(trips)>=TRIP_MASK:
                            raise ValueError('Mais viagens que o limite do esquema binário')
                        trip_num=len(trips)
                        group=service_groups[service]
                        trips.append([trip_id,code,headsign,service_pos[service]])
                        for a,b in zip(rows,rows[1:]):
                            try:
                                f=stop_pos[a[0]]
                                t=stop_pos[b[0]]
                                depart=int(a[2])
                                arrive=int(b[1])
                                if not (0<=depart<=arrive<MAX_HOUR*3600):
                                    malformed+=1
                                    continue
                                flags=trip_num
                                if len(a)>3 and int(a[3])==0:flags|=BOARD
                                if len(b)>4 and int(b[4])==0:flags|=ALIGHT
                                if len(a)<=3:flags|=BOARD
                                if len(b)<=4:flags|=ALIGHT
                                payload=PACK.pack(f,t,depart,arrive,flags)
                            except (IndexError,KeyError,ValueError,TypeError,OverflowError):
                                malformed+=1
                                continue
                            put('out',group,depart//3600,payload)
                            put('in',group,arrive//3600,payload)
                            total+=1
        finally:
            for files in handles.values():
                for file in files.values():
                    file.close()

        scan_tmp=tmp/'scan'
        (scan_tmp/'out').mkdir(parents=True)
        (scan_tmp/'in').mkdir(parents=True)
        sizes={}
        for direction,source,target,sort_col,reverse in [
            ('out',temp_out,scan_tmp/'out',2,False),
            ('in',temp_in,scan_tmp/'in',3,True)]:
            sizes[direction]={}
            for path in sorted(source.glob('*/*.bin')):
                group=path.parent.name
                hour=path.stem
                raw=path.read_bytes()
                if len(raw)%PACK.size:
                    raise ValueError('Tamanho do registro de conexão inválido')
                rows=list(PACK.iter_unpack(raw))
                del raw
                rows.sort(key=lambda row:(row[sort_col],row[2 if reverse else 3]),reverse=reverse)
                dest_dir=target/group
                dest_dir.mkdir(parents=True,exist_ok=True)
                output=dest_dir/(hour+'.bin.gz')
                with gzip.open(output,'wb',compresslevel=6) as stream:
                    for entry in rows:
                        stream.write(PACK.pack(*entry))
                sizes[direction].setdefault(group,{})[hour]={
                    'connections':len(rows),
                    'bytes':output.stat().st_size
                }
                path.unlink()
                del rows

        write_gzip_json(scan_tmp/'stops.json.gz',[
            [sid,stops[sid][0],round(float(stops[sid][1]),6),
             round(float(stops[sid][2]),6)] for sid in stop_ids])
        write_gzip_json(scan_tmp/'trips.json.gz',trips)
        meta={
            'schema':2,
            'format':'uint32le/5;trip-mask=1048575;pickup-bit=1048576;dropoff-bit=2097152',
            'builtUTC':dt.datetime.now(dt.timezone.utc).isoformat(),
            'source':index['source'],
            'gtfsBuiltUTC':index.get('builtUTC'),
            'timezone':'America/Sao_Paulo',
            'validFrom':index['validFrom'],'validThrough':index['validThrough'],
            'services':service_meta,
            'exceptions':index['exceptions'],
            'hours':sizes,
            'groups':sorted(set(service_groups.values()),key=int),
            'stopCount':len(stop_ids),
            'tripCount':len(trips),
            'connectionCount':total,
            'skippedInvalidConnections':malformed,
            'limits':{'maxTravelHours':5,'maxTransfers':2},
            'notice':'Ônibus por horário GTFS, não ETA GPS; caminhada aproximada; metrô sem partidas validadas',
        }
        (scan_tmp/'index.json').write_text(
            json.dumps(meta,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        # Transactional directory replacement: no partial files if conversion fails.
        if work.exists():shutil.rmtree(work)
        shutil.move(str(scan_tmp),str(work))
        print('STATIC_SCAN_BUILD_OK',
              'stops=',len(stop_ids),'trips=',len(trips),
              'connections=',total,'invalid=',malformed,
              'bytes=',sum(x['bytes'] for cat in sizes.values() for group in cat.values() for x in group.values()),
              flush=True)
        return meta
    finally:
        shutil.rmtree(tmp,ignore_errors=True)


if __name__=='__main__':
    build(sys.argv[1] if len(sys.argv)>1 else None)
