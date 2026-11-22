"""Verify that the municipal GTFS ZIP actually produces the V1 point timetable.

Source stop_times are staged in a temporary, indexed SQLite database, not RAM.
No routing, ETA, network access, publishing, GPS or RMBH dependencies.

The ZIP's SHA-256 and other source identities must be checked independently by
bh_v1_source_provenance.audit_source_zip before this expensive audit is trusted.
"""
from __future__ import annotations

import csv
import gzip
import io
import itertools
import json
from pathlib import Path, PurePosixPath
import sqlite3
import tempfile
import zipfile

from data_quality.bh_v1_source_provenance import _parse_gtfs_clock

MAX_COMPRESSED_ZIP = 150_000_000
MAX_TIMETABLE_COMPRESSED = 100_000_000
MAX_TIMETABLE_INFLATED = 900_000_000
MAX_TIMETABLE_LINE = 16_000_000
MAX_STOP_TIMES = 15_000_000
BATCH = 10_000


def _rows(z, member, required):
    with z.open(member) as raw:
        records = csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8-sig', newline=''))
        if not records.fieldnames or not set(required).issubset(records.fieldnames):
            raise ValueError('missing required source GTFS columns')
        for row in records:
            if None in row or any(value is None for value in row.values()):
                raise ValueError('malformed source GTFS CSV')
            yield row


def _members(z):
    result = {}
    for member in z.infolist():
        if member.is_dir():
            continue
        p = PurePosixPath(member.filename)
        if p.is_absolute() or '..' in p.parts or '\\' in member.filename:
            raise ValueError('unsafe GTFS ZIP member')
        name = p.name.lower()
        if name in result:
            raise ValueError('duplicate GTFS ZIP member')
        result[name] = member
    for required in ('routes.txt', 'trips.txt', 'stop_times.txt'):
        if required not in result:
            raise ValueError('missing GTFS ZIP member')
    return result


def _normalized_stop_entries(entries):
    """Normalize groups without relying on their insertion order in the build."""
    if not isinstance(entries, list) or not entries:
        raise ValueError('missing timetable schedule groups')
    items = []
    groups = set()
    for item in entries:
        if not isinstance(item, list) or len(item) != 4:
            raise ValueError('invalid timetable group')
        code, service, destination, seconds = item
        if (not isinstance(code, str) or not isinstance(service, str) or
                not isinstance(destination, str) or
                not isinstance(seconds, list) or not seconds):
            raise ValueError('invalid timetable group fields')
        key = (code, service, destination)
        if key in groups:
            raise ValueError('duplicate timetable group')
        groups.add(key)
        if any(type(x) is not int or x < 0 or x >= 172800 for x in seconds):
            raise ValueError('invalid timetable seconds')
        if seconds != sorted(set(seconds)):
            raise ValueError('unsorted or duplicate timetable seconds')
        for second in seconds:
            items.append((code, service, destination, second))
    return sorted(items)


def audit_zip_timetable(catalog, archive):
    """Return a bounded, JSON-compatible proof of source-vs-compiled equality.

    Values come from precisely the exporter semantics in build_timetable.py:
    route_short_name, service_id, trip_headsign, unique arrival times per stop.
    Duplicate times collapse; different trip IDs are not fabricated as ETAs.
    """
    catalog, archive = Path(catalog), Path(archive)
    result = {'status': 'blocked', 'errors': [], 'sourceStopTimeRows': 0,
              'distinctScheduledTimes': 0, 'sourceStops': 0,
              'compiledStops': 0, 'mismatchedStops': 0, 'missingStops': 0,
              'unexpectedStops': 0, 'samples': [], 'scheduledNotRealtime': True}
    errors = result['errors']
    try:
        if not 0 < archive.stat().st_size <= MAX_COMPRESSED_ZIP:
            raise ValueError('oversized GTFS ZIP')
        target = catalog / 'timetable.json.gz'
        if not 0 < target.stat().st_size <= MAX_TIMETABLE_COMPRESSED:
            raise ValueError('oversized compiled timetable')
    except (OSError, ValueError):
        errors.append('zip_timetable_input_unreadable')
        return result

    try:
        with tempfile.TemporaryDirectory(prefix='bh-gtfs-qa-') as dirname:
            db = sqlite3.connect(str(Path(dirname) / 'stoptimes.sqlite3'))
            try:
                db.execute('PRAGMA journal_mode=OFF')
                db.execute('PRAGMA synchronous=OFF')
                db.execute('PRAGMA cache_size=-32768')
                db.execute('CREATE TABLE times (stop TEXT NOT NULL, code TEXT NOT NULL, service TEXT NOT NULL, destination TEXT NOT NULL, sec INTEGER NOT NULL)')
                with zipfile.ZipFile(archive) as z:
                    members = _members(z)
                    route_codes = {}
                    for row in _rows(z, members['routes.txt'], ('route_id', 'route_short_name')):
                        rid = row['route_id']
                        if not rid or rid in route_codes:
                            raise ValueError('duplicate route_id')
                        route_codes[rid] = row['route_short_name']
                    trip_meta = {}
                    for row in _rows(z, members['trips.txt'], ('trip_id', 'route_id', 'service_id', 'trip_headsign')):
                        tid = row['trip_id']
                        if not tid or tid in trip_meta or row['route_id'] not in route_codes:
                            raise ValueError('invalid trip identity')
                        trip_meta[tid] = (route_codes[row['route_id']], row['service_id'], row['trip_headsign'])
                    batch = []
                    for row in _rows(z, members['stop_times.txt'], ('trip_id', 'stop_id', 'arrival_time', 'departure_time')):
                        tid = row['trip_id']
                        if tid not in trip_meta or not row['stop_id']:
                            raise ValueError('orphan trip or empty stop ID')
                        code, service, destination = trip_meta[tid]
                        arrival = _parse_gtfs_clock(row['arrival_time'] or row['departure_time'])
                        batch.append((row['stop_id'], code, service, destination, arrival))
                        result['sourceStopTimeRows'] += 1
                        if result['sourceStopTimeRows'] > MAX_STOP_TIMES:
                            raise ValueError('too many source stop_times')
                        if len(batch) >= BATCH:
                            db.executemany('INSERT INTO times VALUES (?,?,?,?,?)', batch)
                            batch.clear()
                    if batch:
                        db.executemany('INSERT INTO times VALUES (?,?,?,?,?)', batch)
                db.commit()
                db.execute('CREATE INDEX stop_times_qa ON times (stop, code, service, destination, sec)')
                db.commit()
                cur = db.execute('SELECT DISTINCT stop, code, service, destination, sec FROM times ORDER BY stop, code, service, destination, sec')
                source_groups = itertools.groupby(cur, lambda x: x[0])
                source_iter = iter(source_groups)

                def advance():
                    try:
                        sid, rows = next(source_iter)
                        return sid, [tuple(row[1:]) for row in rows]
                    except StopIteration:
                        return None, None

                source_sid, source_values = advance()
                inflated = 0
                previous_sid = None
                with gzip.open(target, 'rb') as stream:
                    while True:
                        line = stream.readline(MAX_TIMETABLE_LINE + 1)
                        if not line:
                            break
                        inflated += len(line)
                        if len(line) > MAX_TIMETABLE_LINE or inflated > MAX_TIMETABLE_INFLATED:
                            raise ValueError('compiled timetable exceeds safety limit')
                        decoded = json.loads(line.decode('utf-8'))
                        if (not isinstance(decoded, list) or len(decoded) != 2 or
                                not isinstance(decoded[0], str) or not decoded[0]):
                            raise ValueError('invalid compiled timetable row')
                        compiled_sid, entries = decoded
                        if previous_sid is not None and compiled_sid <= previous_sid:
                            raise ValueError('duplicate or unsorted compiled stop ID')
                        previous_sid = compiled_sid
                        compiled_values = _normalized_stop_entries(entries)
                        result['compiledStops'] += 1
                        while source_sid is not None and source_sid < compiled_sid:
                            result['missingStops'] += 1
                            result['sourceStops'] += 1
                            if len(result['samples']) < 10:
                                result['samples'].append(source_sid)
                            source_sid, source_values = advance()
                        if source_sid is None or source_sid > compiled_sid:
                            result['unexpectedStops'] += 1
                            if len(result['samples']) < 10:
                                result['samples'].append(compiled_sid)
                        else:
                            result['sourceStops'] += 1
                            result['distinctScheduledTimes'] += len(source_values)
                            if compiled_values != source_values:
                                result['mismatchedStops'] += 1
                                if len(result['samples']) < 10:
                                    result['samples'].append(compiled_sid)
                            source_sid, source_values = advance()
                while source_sid is not None:
                    result['missingStops'] += 1
                    result['sourceStops'] += 1
                    if len(result['samples']) < 10:
                        result['samples'].append(source_sid)
                    source_sid, source_values = advance()
                if result['mismatchedStops'] or result['missingStops'] or result['unexpectedStops']:
                    errors.append('zip_stop_times_differ_from_compiled_timetable')
            finally:
                db.close()
    except (OSError, EOFError, UnicodeError, ValueError, TypeError, zipfile.BadZipFile, sqlite3.Error):
        errors.append('zip_timetable_source_or_compiled_invalid')
    result['errors'] = sorted(set(errors))
    result['status'] = 'pass' if not errors else 'blocked'
    return result
