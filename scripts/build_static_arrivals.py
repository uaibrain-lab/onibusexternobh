#!/usr/bin/env python3
"""Generate tiny per-stop scheduled arrivals for free static Hosting.

Read the existing official GTFS timetable and write 256 deterministic shards.
No network access, no dependency beyond Python stdlib, no live-GPS claims.
"""
from __future__ import annotations
import gzip
import json
from pathlib import Path
import hashlib
import io

ROOT = Path(__file__).resolve().parents[1]
BUCKETS = 256


def bucket_id(stop_id):
    value = 0
    for character in str(stop_id):
        value = (value * 31 + ord(character)) % BUCKETS
    return format(value, '02x')


def compressed_json(value):
    output = io.BytesIO()
    with gzip.GzipFile(fileobj=output, mode='wb', compresslevel=7, mtime=0, filename='') as stream:
        stream.write(json.dumps(value, ensure_ascii=False,
                                separators=(',', ':'), sort_keys=True).encode('utf-8'))
    return output.getvalue()


def build(catalog=None, output=None):
    catalog = Path(catalog or ROOT / 'catalog')
    output = Path(output or catalog / 'arrivals')
    manifest = json.loads((catalog / 'manifest.json').read_text(encoding='utf-8'))
    calendar = json.loads((catalog / 'timetable-calendar.json').read_text(encoding='utf-8'))
    groups = [{} for _ in range(BUCKETS)]
    total = 0
    with gzip.open(catalog / 'timetable.json.gz', 'rt', encoding='utf-8') as stream:
        for line in stream:
            sid, entries = json.loads(line)
            sid = str(sid)
            if not sid or not isinstance(entries, list):
                raise ValueError('Ponto/horário inválido no GTFS')
            for entry in entries:
                if (not isinstance(entry, list) or len(entry) != 4 or
                        not isinstance(entry[3], list)):
                    raise ValueError('Formato inválido da tabela por ponto')
            groups[int(bucket_id(sid), 16)][sid] = entries
            total += 1
    if total < 1000 or not calendar.get('services'):
        raise ValueError('GTFS incompleto; publicação de chegadas bloqueada')
    output.mkdir(parents=True, exist_ok=True)
    index = {'schema': 1, 'buckets': BUCKETS,
             'version': str(manifest.get('gtfsVersion') or ''),
             'validThrough': str(manifest.get('feedEndDate') or ''),
             'stopCount': total, 'sizes': {}}
    if not index['version'] or len(index['validThrough']) != 8:
        raise ValueError('Manifesto GTFS sem data ou versão')
    for n, group in enumerate(groups):
        name = f'{n:02x}.json.gz'
        blob = compressed_json(group)
        (output / name).write_bytes(blob)
        index['sizes'][name] = len(blob)
    (output / 'calendar.json').write_text(json.dumps(calendar, ensure_ascii=False,
                        separators=(',', ':'), sort_keys=True), encoding='utf-8')
    (output / 'index.json').write_text(json.dumps(index, ensure_ascii=False,
                        separators=(',', ':'), sort_keys=True), encoding='utf-8')
    print('STATIC_ARRIVALS_OK', total, 'stops', sum(index['sizes'].values()), 'compressed_bytes')
    return index


if __name__ == '__main__':
    import sys
    build(*(sys.argv[1:3]))
