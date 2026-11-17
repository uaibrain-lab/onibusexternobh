#!/usr/bin/env python3
"""Audit static Externo package size and shared Firebase Spark transfer risk.

No external dependencies, account access, deployment or paid services.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

MIB = 1024 * 1024
HOSTING_TRANSFER_MIB = 10 * 1024  # theoretical Spark monthly ceiling, shared Hub
MAX_BUILD_MIB = 350
MAX_HOURLY_MIB = 5
MAX_ARRIVAL_MIB = 0.5

def audit(root, allow_live=False):
    root = Path(root)
    if not (root / 'index.html').is_file():
        raise ValueError('Build ausente em ' + str(root))
    files = [(p, p.stat().st_size) for p in root.rglob('*') if p.is_file()]
    def group(prefix):
        return [(p, size) for p, size in files
                if p.relative_to(root).as_posix().startswith(prefix)]
    scan = group('catalog/scan/')
    arrivals = group('catalog/arrivals/')
    walking = group('catalog/walk/')
    top = [(p, size) for p, size in files if len(p.relative_to(root).parts) == 1]
    cfg = root / 'gps-config.json'
    if not cfg.is_file():
        raise ValueError('Contrato de GPS opcional ausente')
    gps = json.loads(cfg.read_text('utf8'))
    if gps.get('enabled') is not False and not allow_live:
        raise ValueError('GPS habilitado sem --allow-live após homologação externa')
    required = ['app.js', 'route-worker.js', 'static-bus.js',
                'static-arrivals.js', 'live-gps.js',
                'catalog/manifest.json', 'catalog/gps-nl-map.json',
                'catalog/scan/index.json', 'catalog/arrivals/index.json']
    for filename in required:
        if not (root / filename).is_file():
            raise ValueError('Arquivo obrigatório ausente: ' + filename)
    source = json.loads((root / 'catalog/manifest.json').read_text('utf8'))
    departures = json.loads((root / 'catalog/scan/index.json').read_text('utf8'))
    schedules = json.loads((root / 'catalog/arrivals/index.json').read_text('utf8'))
    if (str(source.get('feedEndDate')) != str(departures.get('validThrough')) or
        str(source.get('feedEndDate')) != str(schedules.get('validThrough')) or
        str(source.get('gtfsVersion')) != str(schedules.get('version'))):
        raise ValueError('Horários, rotas e manifesto não são da mesma versão GTFS')
    size = sum(s for _, s in files)
    hourly = [(p, s) for p, s in scan if p.name.endswith('.bin.gz')]
    schedule = [(p, s) for p, s in arrivals if p.name.endswith('.json.gz')]
    warnings = []
    if size > MAX_BUILD_MIB * MIB:
        warnings.append('Pacote de hospedagem acima de 350 MiB')
    if max((s for _, s in hourly), default=0) > MAX_HOURLY_MIB * MIB:
        warnings.append('Bloco de rotas individual muito pesado para celular')
    if max((s for _, s in schedule), default=0) > MAX_ARRIVAL_MIB * MIB:
        warnings.append('Bloco de horários por parada muito pesado')
    if len(schedule) != 256:
        warnings.append('Tabela de chegadas incompleta (requer 256 buckets)')
    if gps.get('enabled'):
        warnings.append('GPS habilitado: requer verificação pública de PBH, CORS e Worker Free')
    result = {
        'status':'PASS' if not warnings else 'REVIEW',
        'gtfsVersion':source['gtfsVersion'],
        'validThrough':source['feedEndDate'],
        'files':len(files),
        'packageMiB':round(size / MIB, 2),
        'scanMiB':round(sum(s for _, s in scan) / MIB, 2),
        'walkMiB':round(sum(s for _, s in walking) / MIB, 2),
        'arrivalsMiB':round(sum(s for _, s in arrivals) / MIB, 2),
        'shellMiB':round(sum(s for _, s in top) / MIB, 2),
        'largestHourlyMiB':round(max((s for _, s in hourly), default=0) / MIB, 2),
        'largestArrivalKiB':round(max((s for _, s in schedule), default=0) / 1024, 1),
        'arrivalBuckets':len(schedule),
        'gpsEnabled':bool(gps.get('enabled')),
        'hypotheticalSessionsBeforeShared10GiBQuota':{
            str(session_mib)+'MiBPerSession':HOSTING_TRANSFER_MIB // session_mib
            for session_mib in (5, 10, 18, 25)
        },
        'quotaNote':'São limites teóricos; Cardápio/Interno também utilizam a franquia. Não existe capacidade gratuita ilimitada.',
        'warnings':warnings
    }
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='dist/externo')
    parser.add_argument('--allow-live', action='store_true',
                        help='Somente após verificar Worker público; não executa deploy.')
    args = parser.parse_args()
    try:
        result = audit(args.root, args.allow_live)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if result['warnings']:
            raise SystemExit(2)
    except (OSError, ValueError, KeyError) as exc:
        print('STATIC_BUDGET_FAILED:', exc)
        raise SystemExit(2) from exc
