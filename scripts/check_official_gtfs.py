#!/usr/bin/env python3
"""Validate the official BH GTFS before any automated replacement of cached data.

Usage:
  python scripts/check_official_gtfs.py /tmp/GTFSBHTRANS.zip catalog/source-gtfs.sha256
This script is read-only: it NEVER changes the live/catalog data itself.
"""
from __future__ import annotations
import csv
import datetime as dt
import hashlib
import io
import pathlib
import sys
import zipfile

REQUIRED=('routes.txt','trips.txt','stop_times.txt','stops.txt')
MAX_COMPRESSED=100*1024*1024
MAX_UNCOMPRESSED=1400*1024*1024


def check(archive, digest_file=None, today=None):
    archive=pathlib.Path(archive)
    if not archive.exists() or archive.stat().st_size > MAX_COMPRESSED:
        raise ValueError('Arquivo oficial ausente ou grande demais (>100 MiB)')
    digest=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()
    with zipfile.ZipFile(archive) as z:
        names={p.filename.rsplit('/',1)[-1]:p for p in z.infolist()
               if p.filename.lower().endswith('.txt')}
        missing=[name for name in REQUIRED if name not in names]
        if missing or not ('calendar.txt' in names or 'calendar_dates.txt' in names):
            raise ValueError('GTFS incompleto: '+str(missing))
        if sum(p.file_size for p in names.values())>MAX_UNCOMPRESSED:
            raise ValueError('GTFS excedeu limite de descompactação segura')
        if any(p.file_size>MAX_UNCOMPRESSED or p.compress_size>MAX_COMPRESSED for p in names.values()):
            raise ValueError('Parte do GTFS excede tamanho permitido')
        if names['stop_times.txt'].file_size<1000 or names['trips.txt'].file_size<500:
            raise ValueError('GTFS suspeitamente pequeno')
        until=[]
        for filename,field in [('calendar.txt','end_date'),('calendar_dates.txt','date')]:
            if filename not in names:
                continue
            with z.open(names[filename]) as f:
                rows=csv.DictReader(io.TextIOWrapper(f,encoding='utf-8-sig'))
                for row in rows:
                    value=(row.get(field) or '').strip()
                    if len(value)==8 and value.isdigit():
                        until.append(value)
        if not until:
            raise ValueError('GTFS sem data final de validade')
        valid_through=max(until)
        checkday=(today or dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).date()).strftime('%Y%m%d')
        if valid_through<checkday:
            raise ValueError('GTFS oficial está vencido (%s): não substituir dados válidos'%valid_through)
    last=pathlib.Path(digest_file).read_text(encoding='utf-8').strip() if digest_file and pathlib.Path(digest_file).exists() else None
    changed=last!=digest
    return {'sha256':digest,'changed':changed,'validThrough':valid_through,
            'sourceBytes':archive.stat().st_size}


def main(argv):
    if len(argv)<2:
        raise SystemExit('Uso: check_official_gtfs.py /tmp/gtfs.zip [digest_file]')
    result=check(argv[1],argv[2] if len(argv)>2 else None)
    print('OFFICIAL_GTFS_CHECK_OK','changed=',str(result['changed']).lower(),
          'valid_through=',result['validThrough'],
          'source_bytes=',result['sourceBytes'],'sha256=',result['sha256'],flush=True)
    # Expose just the checksum and changed state to subsequent GitHub Actions steps.
    import os
    output=os.environ.get('GITHUB_OUTPUT')
    if output:
        with open(output,'a',encoding='utf-8') as out:
            for key in ('sha256','changed','validThrough'):
                out.write('%s=%s\n'%(key,str(result[key]).lower() if key=='changed' else result[key]))
    return result


if __name__=='__main__':
    main(sys.argv)
