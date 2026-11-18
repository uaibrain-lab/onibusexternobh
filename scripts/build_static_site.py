#!/usr/bin/env python3
"""Build a genuinely static, no-cost Hosting preview at dist/externo/.

Does NOT deploy or alter any existing Firebase project. The output contains
the free browser journey planner and static Metro catalog; legacy bus-fleet
screens still require a later static/API migration and are hidden here.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import shutil
from build_static_arrivals import build as build_arrivals

ROOT=Path(__file__).resolve().parents[1]
GB=1024**3
MAX_BYTES=350*1024*1024
STAGING_HOST='externo-bh-hml-uaibrain.pages.dev'
STAGING_ENDPOINT='https://externo-bh-gps-free.hubufmg.workers.dev/api/gps'


def build(target=None, gps_staging=False):
    target=Path(target) if target else ROOT/'dist'
    catalog=ROOT/'catalog'
    scan=catalog/'scan'
    info=scan/'index.json'
    if not info.exists():
        raise FileNotFoundError('Catálogo binário ausente; execute build_static_scan.py primeiro.')
    manifest=json.loads(info.read_text(encoding='utf-8'))
    if (manifest.get('schema') not in (1,2) or manifest.get('tripCount',0)<1000 or
        manifest.get('connectionCount',0)<10000):
        raise ValueError('Índice estático incompleto ou de versão incompatível')
    # Route searches and point arrivals MUST share one official GTFS edition.
    # A partial refresh cannot publish mismatched stops or stale stop times.
    source=json.loads((catalog/'manifest.json').read_text(encoding='utf-8'))
    if (str(source.get('feedEndDate'))!=str(manifest.get('validThrough')) or
        int(source.get('stops',0))!=int(manifest.get('stopCount',-1)) or
        int(source.get('trips',0))!=int(manifest.get('tripCount',-1))):
        raise ValueError('GTFS inconsistente entre índices de rotas e horários por parada')
    if not (catalog/'metro.json').is_file():
        raise FileNotFoundError('Catálogo do metrô ausente.')
    if target.exists():
        shutil.rmtree(target)
    public=target/'externo'
    public.mkdir(parents=True)
    static=ROOT/'static'
    for name in ('app.js','style.css','hub-parity.css','route-worker.js','service-worker.js','static-bus.js','static-arrivals.js','live-gps.js','gps-config.json','place-geocoding.js','walk-network.js','metro-timing.js','manifest.webmanifest','icon-192.png','icon-512.png'):
        shutil.copy2(static/name,public/name)
    html=(static/'index.html').read_text(encoding='utf-8')
    anchor='<html lang="pt-BR">'
    if anchor not in html:
        raise ValueError('Marcador de HTML para modo estático não localizado')
    html=html.replace(anchor,'<html lang="pt-BR" data-app-mode="free-static">',1)
    loader='<script src="./app.js" defer></script>'
    if loader not in html:
        raise ValueError('Script principal não localizado')
    html=html.replace(loader,
        '<script src="./static-arrivals.js" defer></script>\n'
        '<script src="./live-gps.js" defer></script>\n'
        '<script src="./static-bus.js" defer></script>\n'+loader,1)
    if gps_staging:
        # Only the explicit *staging build output* enables live telemetry.
        # Never mutate static/gps-config.json or the Firebase Hub.
        raw_config=json.loads((static/'gps-config.json').read_text(encoding='utf-8'))
        if raw_config.get('enabled') is not False:
            raise ValueError('Configuração fonte GPS deve permanecer desativada')
        config_stage={'enabled':True,'provider':'gtfs_rt',
                      'endpoint':STAGING_ENDPOINT,'refreshSeconds':45}
        (public/'gps-config.json').write_text(
            json.dumps(config_stage,ensure_ascii=False,indent=2)+'\n',
            encoding='utf-8')
        html=html.replace('<head>', '<head>\n<meta name="robots" content="noindex,nofollow,noarchive">',1)
        html=html.replace('data-app-mode="free-static"',
                          'data-app-mode="free-static" data-gps-homologacao="true"',1)
        html=html.replace('<title>Externo — Hub UFMG · Protótipo</title>',
                          '<title>Externo BH · Homologação GPS SUMOB</title>',1)
        heading='<div class="sheet-identity"><strong>Externo</strong><span>BELO HORIZONTE</span></div>'
        if heading not in html:
            raise ValueError('Marcador do título do Externo mudou')
        html=html.replace(heading,heading.replace('BELO HORIZONTE','BELO HORIZONTE · GPS EM TESTE'),1)
        pill='<div class="source-pill" aria-live="polite">'
        if pill not in html:
            raise ValueError('Marcador do status GPS não localizado')
        html=html.replace(pill,pill+
                          '<span class="gps-staging-label" aria-label="GPS em homologação">'
                          'TESTE</span>',1)
        notice='<div class="notice-top" role="note">'
        if notice not in html:
            raise ValueError('Marcador do aviso GPS não localizado')
        html=html.replace(notice,notice+'HOMOLOGAÇÃO: GPS experimental SUMOB. Sem ETA validado. ',1)
        # Stage-specific cache-busting: older HTML/CSS from the P17 build
        # must never mask a corrected canvas/map release in an installed PWA.
        stage_version='p23-street-pareto-20261117'
        for name in ('app.js','style.css','hub-parity.css',
                     'live-gps.js','static-bus.js','static-arrivals.js',
                     'place-geocoding.js','route-worker.js'):
            html=html.replace('src="./'+name+'"',
                              'src="./'+name+'?v='+stage_version+'"')
            html=html.replace('href="./'+name+'"',
                              'href="./'+name+'?v='+stage_version+'"')
        # Cloudflare Pages static directives exist ONLY in the isolated build.
        (target/'_redirects').write_text('/ /externo/ 302\n',encoding='utf-8')
        (target/'_headers').write_text(
            '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n'
            '  X-Content-Type-Options: nosniff\n'
            '  Referrer-Policy: strict-origin-when-cross-origin\n'
            '/externo/gps-config.json\n'
            '  Cache-Control: no-store, max-age=0\n'
            '/externo/index.html\n'
            '  Cache-Control: no-cache, max-age=0\n'
            '/externo/app.js\n'
            '  Cache-Control: no-cache, max-age=0\n'
            '/externo/style.css\n'
            '  Cache-Control: no-cache, max-age=0\n'
            '/externo/hub-parity.css\n'
            '  Cache-Control: no-cache, max-age=0\n'
            '/externo/place-geocoding.js\n'
            '  Cache-Control: no-cache, max-age=0\n'
            '/externo/route-worker.js\n'
            '  Cache-Control: no-cache, max-age=0\n',
            encoding='utf-8')
    (public/'index.html').write_text(html,encoding='utf-8')
    (public/'catalog').mkdir(exist_ok=True)
    shutil.copy2(catalog/'metro.json',public/'catalog'/'metro.json')
    for name in ('manifest.json','routes.json','stops.json','patterns.json','shapes.json','routing-stop-routes.json','gps-nl-map.json'):
        shutil.copy2(catalog/name,public/'catalog'/name)
    shutil.copytree(scan,public/'catalog'/'scan')
    # Do not ship the 18 MiB monolithic timetable to mobile visitors.
    # Build small, per-stop shards directly into the static release.
    build_arrivals(catalog,public/'catalog'/'arrivals')
    # The real OSM network is optional until validated. Do NOT fabricate one
    # from straight-line GTFS stop coordinates.
    walking=catalog/'walk'/'graph.json.gz'
    if walking.is_file():
        import gzip
        with gzip.open(walking,'rt',encoding='utf-8') as f:
            graph=json.load(f)
        if (graph.get('schema')!=1 or graph.get('nodeCount',0)<5 or
            graph.get('edgeCount',0)<4):
            raise ValueError('Rede OSM ausente ou corrompida')
        (public/'catalog'/'walk').mkdir(exist_ok=True)
        shutil.copy2(walking,public/'catalog'/'walk'/'graph.json.gz')
    # Firebase CLI may run from dist/; public is that directory ('.').
    # Deploy package at /externo/ on a free Firebase Hosting site.
    config={
        'hosting':{
            'public':'.',
            'ignore':['firebase.json','**/.*','**/node_modules/**'],
            'headers':[
              {'source':'/externo/catalog/scan/**',
               'headers':[{'key':'Cache-Control',
                           'value':'public, max-age=86400'}]},
              {'source':'/externo/catalog/scan/index.json',
               'headers':[{'key':'Cache-Control',
                           'value':'no-cache, max-age=0'}]},
              {'source':'/externo/catalog/arrivals/index.json',
               'headers':[{'key':'Cache-Control','value':'no-cache, max-age=0'}]},
              {'source':'/externo/catalog/arrivals/**',
               'headers':[{'key':'Cache-Control','value':'public, max-age=86400'}]},
              {'source':'/externo/route-worker.js',
               'headers':[{'key':'Cache-Control',
                           'value':'no-cache, max-age=0'}]}
            ]
        }
    }
    (target/'firebase.json').write_text(
        json.dumps(config,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    total=sum(p.stat().st_size for p in public.rglob('*') if p.is_file())
    if total>MAX_BYTES:
        raise ValueError('Pacote excedeu limite conservador de 350 MiB')
    print('FREE_STATIC_PREVIEW_OK','files=',len(list(public.rglob('*'))),
          'bytes=',total,'megabytes=',round(total/1048576,2),
          'validThrough=',manifest['validThrough'])
    print('PREVIEW_FOLDER',public)
    print('GPS_STAGING_BUILD=',str(gps_staging).lower())
    if gps_staging:
        print('STAGING_ONLY_HOST=https://'+STAGING_HOST+'/externo/')
    print('NO_DEPLOY_PERFORMED')
    return target


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--output',default=None)
    p.add_argument('--gps-staging',action='store_true',
                   help='ATENÇÃO: ativa GPS SOMENTE em dist/ para projeto Cloudflare Pages isolado')
    args=p.parse_args()
    build(args.output,gps_staging=args.gps_staging)
