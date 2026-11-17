#!/usr/bin/env python3
"""Create a trip-preserving, line-sharded routing index from the official GTFS.

The P3 stop timetable collapses trips into per-stop/line buckets. That index
must never be used to infer a particular vehicle's downstream stop sequence.
This builder retains exact trip_id, stop_sequence, service_id, arrival and
departure times. SQLite is used as a disk-backed sort for large GTFS files.
"""
from __future__ import annotations
import collections
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import pathlib
import shutil
import sqlite3
import sys
import tempfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]


def seconds(s):
    h, m, sec = (int(x) for x in str(s).split(':'))
    if not (0 <= h < 48 and 0 <= m < 60 and 0 <= sec < 60):
        raise ValueError('Horário GTFS inválido')
    return h * 3600 + m * 60 + sec


def build(archive, output=None):
    output = pathlib.Path(output or ROOT / 'catalog')
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as z, tempfile.TemporaryDirectory() as temp:
        entries = {n.rsplit('/', 1)[-1]: n for n in z.namelist()
                   if n.lower().endswith('.txt')}
        def read(name):
            if name not in entries:
                if name in ('calendar_dates.txt', 'calendar.txt'):
                    return iter(())
                raise ValueError('GTFS sem arquivo obrigatório ' + name)
            def gen():
                with z.open(entries[name]) as stream:
                    yield from csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8-sig', newline=''))
            return gen()

        gtfs_stops = {r['stop_id']: [r.get('stop_name',r['stop_id']),
                                    float(r['stop_lat']), float(r['stop_lon'])]
                      for r in read('stops.txt') if r.get('stop_id') and
                      r.get('stop_lat') and r.get('stop_lon')}
        (output/'routing-stops.json').write_text(
            json.dumps(gtfs_stops,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        route_codes = {r['route_id']: r['route_short_name'].strip()
                       for r in read('routes.txt') if r.get('route_short_name')}
        services = {r['service_id']: {k: r[k] for k in ('monday','tuesday','wednesday',
                    'thursday','friday','saturday','sunday','start_date','end_date')}
                    for r in read('calendar.txt')}
        exceptions = collections.defaultdict(dict)
        for r in read('calendar_dates.txt'):
            exceptions[r['date']][r['service_id']] = int(r['exception_type'])

        db = sqlite3.connect(str(pathlib.Path(temp) / 'routing.sqlite'))
        db.execute('PRAGMA synchronous=OFF')
        db.execute('PRAGMA journal_mode=OFF')
        db.execute('CREATE TABLE trips(id TEXT PRIMARY KEY, code TEXT, service TEXT, destination TEXT)')
        db.execute('CREATE TABLE times(trip TEXT, seq INTEGER, stop TEXT, arrive INTEGER, depart INTEGER, pickup INTEGER, dropoff INTEGER)')
        db.execute('CREATE INDEX trips_code ON trips(code)')
        meta_rows = []
        for trip in read('trips.txt'):
            code = route_codes.get(trip['route_id'])
            if code:
                meta_rows.append((trip['trip_id'], code, trip['service_id'],
                                  trip.get('trip_headsign','')))
                if len(meta_rows) >= 25000:
                    db.executemany('INSERT OR REPLACE INTO trips VALUES (?,?,?,?)',meta_rows)
                    meta_rows.clear()
        if meta_rows:
            db.executemany('INSERT OR REPLACE INTO trips VALUES (?,?,?,?)',meta_rows)
        db.commit()

        batch = []
        total_rows = 0
        for r in read('stop_times.txt'):
            if not r.get('stop_id'):
                continue
            try:
                arr = seconds(r.get('arrival_time') or r.get('departure_time'))
                dep = seconds(r.get('departure_time') or r.get('arrival_time'))
                seq = int(r['stop_sequence'])
                if dep < arr:
                    continue
            except (ValueError, TypeError, KeyError):
                continue
            # GTFS pickup_type/drop_off_type: 1 forbids boarding/alighting.
            # Types 2/3 are conditional services and are conservatively
            # excluded from automatic public itineraries.
            try:
                pickup = int(r.get('pickup_type') or 0)
                dropoff = int(r.get('drop_off_type') or 0)
            except (TypeError, ValueError):
                pickup, dropoff = 1, 1
            batch.append((r['trip_id'], seq, r['stop_id'], arr, dep,
                          pickup, dropoff))
            if len(batch) == 25000:
                db.executemany('INSERT INTO times VALUES (?,?,?,?,?,?,?)', batch)
                total_rows += len(batch)
                batch.clear()
        if batch:
            db.executemany('INSERT INTO times VALUES (?,?,?,?,?,?,?)',batch)
            total_rows += len(batch)
        db.commit()
        db.execute('CREATE INDEX times_trip_seq ON times(trip, seq)')
        db.commit()

        stop_routes = collections.defaultdict(set)
        for code, sid in db.execute('''
            SELECT DISTINCT t.code, s.stop FROM trips t
            JOIN times s ON s.trip=t.id
        '''):
            if sid in gtfs_stops:
                stop_routes[sid].add(code)
        (output/'routing-stop-routes.json').write_text(
            json.dumps({k:sorted(v) for k,v in stop_routes.items()},
                       ensure_ascii=False,separators=(',',':')),encoding='utf-8')

        files = {}
        trip_count = 0
        outdir = output / 'routing'
        if outdir.exists():
            shutil.rmtree(outdir)
        outdir.mkdir(parents=True, exist_ok=True)
        route_list = sorted(set(route_codes.values()))
        for code in route_list:
            filename = hashlib.sha256(code.encode('utf-8')).hexdigest()[:16] + '.json.gz'
            dest = outdir / filename
            count = 0
            with gzip.open(dest, 'wt', encoding='utf-8', compresslevel=6) as out:
                out.write('[')
                first_written=True
                query = '''SELECT t.id, t.service, t.destination,
                                  s.stop, s.arrive, s.depart, s.pickup, s.dropoff
                           FROM trips t JOIN times s ON s.trip=t.id
                           WHERE t.code=?
                           ORDER BY t.id, s.seq'''
                previous_id = None
                stops = []
                meta = None
                invalid_trip = False
                def write_trip():
                    nonlocal count, first_written
                    if not invalid_trip and len(stops) >= 2:
                        if not first_written:
                            out.write(',')
                        out.write(json.dumps([meta[0], meta[1], meta[2], stops],
                                             ensure_ascii=False,separators=(',',':')))
                        first_written=False
                        count += 1
                for trip_id, service, headsign, stop, arr, dep, pickup, dropoff in db.execute(query,(code,)):
                    if trip_id != previous_id:
                        if previous_id is not None:
                            write_trip()
                        previous_id = trip_id
                        meta = (trip_id,service,headsign)
                        stops = []
                        invalid_trip = False
                    if stops and arr < stops[-1][2]:
                        invalid_trip = True
                    if stop not in gtfs_stops:
                        invalid_trip = True
                    if not invalid_trip:
                        stops.append([stop,arr,dep,pickup,dropoff])
                if meta is not None:
                    write_trip()
                out.write(']')
            if count:
                files[code] = 'routing/' + filename
                trip_count += count
            else:
                dest.unlink()

        if not services and not exceptions:
            raise ValueError('GTFS sem calendário: planejamento de datas não é seguro')
        dates = [s['start_date'] for s in services.values()] + list(exceptions.keys())
        ends = [s['end_date'] for s in services.values()] + list(exceptions.keys())
        index = {
            'schema':3, 'builtUTC':dt.datetime.now(dt.timezone.utc).isoformat(),
            'source':'https://s3.amazonaws.com/mobilibus-uploads/gtfs/GTFSBHTRANS.zip',
            'timezone':'America/Sao_Paulo', 'validFrom':min(dates) if dates else None,
            'validThrough':max(ends) if ends else None,
            'services':services, 'exceptions':exceptions, 'files':files,
            'tripCount':trip_count, 'stopTimeRows':total_rows,
            'stops':len(gtfs_stops), 'stopRouteMappings':len(stop_routes),
            'notes':'Horários de tabela; inclui regras de pickup/dropoff; GPS não está vinculado a trip_id.',
        }
        path = output / 'routing-index.json'
        path.write_text(json.dumps(index,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        db.close()
    print('ROUTING_BUILD_OK', 'lines=',len(files),'trips=',trip_count,
          'stop_times=',total_rows,'valid=',index['validFrom'],index['validThrough'])
    if trip_count <= 0:
        raise ValueError('GTFS sem viagens aproveitáveis')
    return index


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('Uso: python scripts/build_routing.py GTFSBHTRANS.zip [pasta catalog]')
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
