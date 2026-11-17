"""Atomic on-disk GTFS catalog version selection. No live mutation of eight files."""
import json
import os
import re
from pathlib import Path

VERSION_RE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$')
REQUIRED = ('routes.json','stops.json','shapes.json','patterns.json',
            'gps-nl-map.json','manifest.json','timetable.json.gz','timetable-calendar.json')


def version_directory(catalog, version):
    catalog=Path(catalog)
    if not isinstance(version,str) or not VERSION_RE.fullmatch(version) or version in ('.','..'):
        raise ValueError('Versão GTFS inválida')
    return catalog/'versions'/version


def resolve_catalog(catalog):
    """Resolve once at process startup; active process continues to use old catalog."""
    catalog=Path(catalog)
    pointer=catalog/'active.json'
    if not pointer.exists():
        return catalog
    data=json.loads(pointer.read_text(encoding='utf-8'))
    chosen=version_directory(catalog,data.get('active'))
    if not all((chosen/name).is_file() for name in REQUIRED):
        raise ValueError('Versão GTFS ativa incompleta; reverter active.json')
    return chosen


def atomic_pointer(catalog, active, previous):
    """Single-file atomic commit. Never switch to a partially created version."""
    catalog=Path(catalog)
    chosen=version_directory(catalog,active)
    if not all((chosen/name).is_file() for name in REQUIRED):
        raise ValueError('Versão GTFS incompleta')
    if previous is not None:
        version_directory(catalog,previous)
    import datetime as dt
    body={'schema':1,'active':active,'previous':previous,
          'activatedAtUTC':dt.datetime.now(dt.timezone.utc).isoformat()}
    temp=catalog/'active.json.tmp'
    with temp.open('w',encoding='utf-8') as stream:
        json.dump(body,stream,ensure_ascii=False,separators=(',',':'))
        stream.flush();os.fsync(stream.fileno())
    os.replace(temp,catalog/'active.json')
    return body
