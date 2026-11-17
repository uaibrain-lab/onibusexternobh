#!/usr/bin/env python3
"""Build compact GTFS timetable for stop arrival forecasts, using only stdlib.

Usage: python scripts/build_timetable.py /path/to/GTFSBHTRANS.zip
It can also read the outer BH-Transporte.zip containing BH-Transporte/GTFS/*.txt.
"""
import collections, csv, datetime, gzip, io, json, pathlib, sys, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[1]


def build(archive, target=None):
    target = pathlib.Path(target or ROOT / 'catalog')
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        names = {p.rsplit('/',1)[-1]:p for p in z.namelist() if p.endswith('.txt')}
        def reader(name):
            with z.open(names[name]) as stream:
                yield from csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8-sig', newline=''))
        route_codes = {r['route_id']: r['route_short_name'] for r in reader('routes.txt')}
        trip_meta = {t['trip_id']: (route_codes.get(t['route_id']),t['service_id'],t['trip_headsign'])
                     for t in reader('trips.txt')}
        calendar = {r['service_id']: {k:r[k] for k in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday','start_date','end_date')}
                    for r in reader('calendar.txt')}
        exceptions = collections.defaultdict(dict)
        for r in reader('calendar_dates.txt'):
            exceptions[r['date']][r['service_id']] = int(r['exception_type'])
        # stop_id -> (route_code, service_id, headsign) -> [arrival seconds]
        schedule = collections.defaultdict(lambda: collections.defaultdict(list))
        rows=0
        for r in reader('stop_times.txt'):
            meta=trip_meta.get(r['trip_id'])
            if not meta or not meta[0]:continue
            try:
                hours,minutes,seconds = (int(n) for n in (r['arrival_time'] or r['departure_time']).split(':'))
                sec=hours*3600+minutes*60+seconds
                if sec<0 or sec>=48*3600:continue
            except (ValueError,TypeError):continue
            schedule[r['stop_id']][meta].append(sec)
            rows+=1
    path = target / 'timetable.json.gz'
    with gzip.open(path, 'wt', encoding='utf-8', compresslevel=5) as out:
        # one JSON per line, fast to load/validate while still compressing well
        for stop_id, groups in sorted(schedule.items()):
            encoded=[[route,service,dest,sorted(set(times))] for (route,service,dest),times in groups.items()]
            out.write(json.dumps([stop_id, encoded], ensure_ascii=False, separators=(',',':'))+'\n')
    (target/'timetable-calendar.json').write_text(json.dumps({
        'services': calendar, 'exceptions':exceptions, 'generatedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'records':rows,'stops':len(schedule), 'schema':1
    },ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f'{rows:,} registros; {len(schedule):,} pontos; arquivo {path.stat().st_size/1048576:.1f} MiB')

if __name__=='__main__':
    if len(sys.argv)<2: raise SystemExit('Usage: python scripts/build_timetable.py arquivo-GTFS.zip')
    build(sys.argv[1])
