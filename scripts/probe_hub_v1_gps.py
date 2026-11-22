#!/usr/bin/env python3
"""Fail-closed independent real GPS proof for Externo BH Hub V1.

Reads only a fixed, allowlisted Cloudflare Worker backed by SUMOB GTFS-RT.
Never emits vehicle identifiers or coordinates, never requests user position.
Requires genuinely fresh fixes, not merely HTTP 200 or synthetic unit tests.
"""
from __future__ import annotations
from datetime import datetime,timezone
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlencode
from urllib.request import Request,urlopen

BASE='https://externo-bh-gps-free.hubufmg.workers.dev'
ORIGIN='https://hubufmg.web.app'

def get_json(url):
    req=Request(url,headers={'Accept':'application/json','Origin':ORIGIN,'User-Agent':'ExternoBH-HubV1-QA/1'})
    with urlopen(req,timeout=15) as response:
        if response.status!=200:
            raise ValueError('GPS_WORKER_HTTP_UNAVAILABLE')
        if response.headers.get('Access-Control-Allow-Origin') != ORIGIN:
            raise ValueError('GPS_WORKER_CORS_NOT_ALLOWED')
        data=response.read(250000)
        if len(data)>=250000:
            raise ValueError('GPS_WORKER_RESPONSE_TOO_LARGE')
    return json.loads(data)

def inspect(capabilities, replies, expected, now=None):
    now=now or datetime.now(timezone.utc)
    if (capabilities.get('service')!='Externo BH GPS' or
        'GTFS_RT' not in capabilities.get('supportedSources',[])):
        raise ValueError('GPS_WORKER_CAPABILITIES_INVALID')
    checked=0;recent=0;active_routes=set()
    for requested,response in replies:
        if response.get('source')!='GTFS_RT' or response.get('available') is not True:
            raise ValueError('GPS_FEED_NOT_AVAILABLE')
        fetched=response.get('fetchedAt')
        try: ts=datetime.fromisoformat(str(fetched).replace('Z','+00:00'))
        except ValueError: raise ValueError('GPS_FETCH_TIME_INVALID')
        if ts.tzinfo is None or abs((now-ts).total_seconds())>120:
            raise ValueError('GPS_FETCH_TIME_STALE')
        rows=response.get('records')
        if not isinstance(rows,list):raise ValueError('GPS_RECORDS_INVALID')
        checked+=len(rows)
        for item in rows:
            if not isinstance(item,dict):continue
            route=str(item.get('routeId') or '')
            if route not in requested or route not in expected:continue
            try:
                seen=datetime.fromisoformat(str(item['lastGpsFixAt']).replace('Z','+00:00'))
                lat=float(item['latitude']);lon=float(item['longitude'])
            except (KeyError,TypeError,ValueError):continue
            if seen.tzinfo is None:continue
            age=(now-seen).total_seconds()
            if (0<=age<=120 and -20.5<=lat<=-19.4 and
                -44.5<=lon<=-43.4 and str(item.get('vehicleId') or '')):
                recent+=1;active_routes.add(route)
    if recent==0:
        raise ValueError('GPS_NO_RECENT_OFFICIAL_VEHICLE_POSITION')
    return {'source':'GTFS_RT','probePassed':True,
            'checkedRecords':checked,'recentPositions':recent,
            'routesWithRecentPositions':len(active_routes),
            'checkedAtUtc':now.isoformat().replace('+00:00','Z')}

def probe(catalog,destination):
    routes=json.loads((Path(catalog)/'routes.json').read_text(encoding='utf8'))
    valid=sorted({r.get('code','') for r in routes if
                  isinstance(r,dict) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,70}',str(r.get('code','')))},key=str)
    if len(valid)<100:raise ValueError('GPS_ROUTE_CATALOG_INCOMPLETE')
    # 5 bounded calls, sampling routes across the whole current GTFS edition.
    sampled=valid[::max(1,len(valid)//100)][:100]
    capabilities=get_json(BASE+'/api/gps/capabilities')
    replies=[]
    for i in range(0,len(sampled),20):
        group=sampled[i:i+20]
        url=BASE+'/api/gps?'+urlencode({'source':'GTFS_RT','routes':','.join(group)})
        replies.append((set(group),get_json(url)))
    result=inspect(capabilities,replies,set(sampled))
    result['routeCodesChecked']=len(sampled)
    Path(destination).write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print('HUB_V1_LIVE_SUMOB_GPS_VERIFIED',json.dumps(result),flush=True)
    return result

if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('Usage: python -m scripts.probe_hub_v1_gps catalog gps-proof.json')
    probe(sys.argv[1],sys.argv[2])
