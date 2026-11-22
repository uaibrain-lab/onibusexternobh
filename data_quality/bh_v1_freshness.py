"""Read-only 14-day BH municipal GTFS freshness and service-coverage monitor."""
from __future__ import annotations
import argparse
import datetime as dt
import json
from pathlib import Path

WEEK = ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')

def parse_day(s):
    if not isinstance(s,str) or len(s)!=8 or not s.isascii() or not s.isdigit():
        raise ValueError('invalid YYYYMMDD date')
    return dt.datetime.strptime(s,'%Y%m%d').date()

def monitor(catalog, day, horizon=14, warn_days=14, stale_days=10):
    root=Path(catalog)
    if not 1<=horizon<=60: raise ValueError('invalid horizon')
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    calendar=json.loads((root/'timetable-calendar.json').read_text(encoding='utf-8'))
    start=parse_day(manifest['feedStartDate']); end=parse_day(manifest['feedEndDate'])
    services=calendar['services']; exceptions=calendar.get('exceptions',{})
    errors=[]; warnings=[]; empty=[]
    if not isinstance(services, dict) or not isinstance(exceptions, dict) or not (services or exceptions):
        errors.append('calendar_structure_invalid')
        services = services if isinstance(services, dict) else {}
        exceptions = exceptions if isinstance(exceptions, dict) else {}
    for offset in range(horizon):
        d=day+dt.timedelta(days=offset)
        if d<start or d>end:
            errors.append('horizon_outside_feed_validity')
            continue
        key=d.strftime('%Y%m%d')
        active=set()
        for sid,row in services.items():
            try:
                if parse_day(row['start_date'])<=d<=parse_day(row['end_date']) and str(row[WEEK[d.weekday()]])=='1':
                    active.add(sid)
            except (ValueError,KeyError,TypeError):
                errors.append('invalid_service_calendar')
        for sid,operation in exceptions.get(key,{}).items():
            if operation not in (1,2) or (operation == 2 and sid not in services):
                errors.append('invalid_calendar_exception')
            elif operation==1: active.add(sid)
            else: active.discard(sid)
        if not active: empty.append(key)
    if empty: errors.append('days_without_scheduled_service')
    remaining=(end-day).days
    if remaining<=warn_days: warnings.append('feed_expires_soon')
    created=manifest.get('createdAtUtc')
    age=None
    if created:
        try:
            ts=dt.datetime.fromisoformat(created.replace('Z','+00:00'))
            if ts.tzinfo is None: raise ValueError('timezone required')
            age=(dt.datetime.combine(day,dt.time(23,59),dt.timezone(dt.timedelta(hours=-3)))-ts).days
            if age>stale_days: warnings.append('snapshot_not_refreshed_recently')
            if age< -1: errors.append('snapshot_created_in_future')
        except (ValueError,TypeError): errors.append('invalid_snapshot_timestamp')
    else: warnings.append('snapshot_timestamp_missing')
    return {'status':'blocked' if errors else 'pass','asOf':day.strftime('%Y%m%d'),
            'horizonDays':horizon,'daysUntilExpiry':remaining,'snapshotAgeDays':age,
            'emptyServiceDays':empty,'errors':sorted(set(errors)),'warnings':sorted(set(warnings)),
            'note':'Scheduled service only; not realtime operations'}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('catalog',type=Path)
    parser.add_argument('--date',default=dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).strftime('%Y%m%d'))
    parser.add_argument('--horizon',type=int,default=14)
    args=parser.parse_args()
    report=monitor(args.catalog,parse_day(args.date),args.horizon)
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 2 if report['status']=='blocked' else 0

if __name__=='__main__': raise SystemExit(main())
