#!/usr/bin/env python3
"""Rebuild one fully consistent municipal GTFS catalog in a CI-only workspace.

No git commit, no branch updates, no source ZIP upload, no production deploy.
"""
from __future__ import annotations
import hashlib
import json
import shutil
from pathlib import Path
import sys
import tempfile
from scripts.update_gtfs import OUTPUTS,build

def run(archive,catalog):
    archive,catalog=Path(archive),Path(catalog)
    h=hashlib.sha256()
    with archive.open('rb') as src:
        for chunk in iter(lambda:src.read(1024*1024),b''):h.update(chunk)
    digest=h.hexdigest()
    previous=(catalog/'source-gtfs.sha256').read_text(encoding='utf8').strip()
    with tempfile.TemporaryDirectory(prefix='hub-v1-official-') as tmp:
        generated=Path(tmp)/'catalog'
        meta=build(archive,generated,catalog)
        for name in OUTPUTS:
            if not (generated/name).is_file() or not (generated/name).stat().st_size:
                raise ValueError('Incomplete official GTFS catalog: '+name)
        routes=json.loads((generated/'routes.json').read_text(encoding='utf8'))
        patterns=json.loads((generated/'patterns.json').read_text(encoding='utf8'))
        codes={str(r['id']):r['code'] for r in routes}
        stop_codes={}
        for item in patterns:
            code=codes.get(str(item['route']))
            if not code:raise ValueError('Unknown municipal route ID')
            for stop in item['stops']:
                stop_codes.setdefault(stop,set()).add(code)
        mapping={stop:sorted(values) for stop,values in stop_codes.items()}
        (generated/'routing-stop-routes.json').write_text(
            json.dumps(mapping,ensure_ascii=False,separators=(',',':')),encoding='utf8')
        for name in (*OUTPUTS,'routing-stop-routes.json'):
            shutil.copy2(generated/name,catalog/name)
        (catalog/'source-gtfs.sha256').write_text(digest+'\n',encoding='ascii')
    print('HUB_V1_OFFICIAL_REBUILT',json.dumps({
        'sourceSha256':digest,'changed':digest!=previous,
        'gtfsVersion':meta['gtfsVersion'],'routes':meta['routes'],
        'stops':meta['stops'],'trips':meta['trips'],
        'stopTimeRows':meta['stopTimeRows'],'validThrough':meta['feedEndDate'],
        'stopCodeMappings':len(mapping)}),flush=True)
    print('EPHEMERAL_WORKSPACE_ONLY_NO_DEPLOY')

if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('usage: python -m scripts.rebuild_hub_v1_catalog ZIP catalog')
    run(sys.argv[1],sys.argv[2])
