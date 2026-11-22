"""Compare a municipal GTFS stop timetable with *published* arrival shards.

Stdlib/read-only. This verifies derived data identity, NOT the signature of the
upstream GTFS ZIP, service punctuality, ETA, trip routing, or live vehicle data.
"""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path

SHARDS = 256
MAX_TIMETABLE_COMPRESSED = 100_000_000
MAX_SOURCE_LINE = 16_000_000
MAX_SOURCE_INFLATED = 900_000_000
MAX_SHARD_INFLATED = 24_000_000
MAX_STOPS = 100_000


def _fingerprint(entries):
    return hashlib.sha256(json.dumps(entries, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode('utf-8')).hexdigest()


def audit_timetable_equivalence(catalog, arrivals_index):
    """Fail closed on changed/missing stops, stop arrays, or unreadable source.

    The source is a JSONL gzip of [stop_id, [schedule groups]] as emitted by
    scripts/build_timetable.py; each shard maps stop_id to exactly that array.
    Only per-stop hashes are kept, so a 6M+ stop_time catalog can be audited
    without materializing all its entries in memory.
    """
    catalog = Path(catalog)
    shard_root = Path(arrivals_index).parent
    source = catalog / 'timetable.json.gz'
    result = {'status': 'blocked', 'errors': [], 'sourceStops': 0,
              'publishedStops': 0, 'mismatchedStops': 0, 'missingStops': 0,
              'unexpectedStops': 0, 'sourceCompressedBytes': None,
              'sourceSha256': None, 'scheduledNotRealtime': True}
    try:
        size = source.stat().st_size
        if size <= 0 or size > MAX_TIMETABLE_COMPRESSED:
            raise ValueError('source timetable compressed size invalid')
        result['sourceCompressedBytes'] = size
        source_hash = hashlib.sha256()
        with source.open('rb') as fh:
            for block in iter(lambda: fh.read(1024*1024), b''):
                source_hash.update(block)
        result['sourceSha256'] = source_hash.hexdigest()
    except (OSError, ValueError):
        result['errors'].append('source_timetable_unreadable')
        return result

    fingerprints = {}
    decoded_bytes = 0
    try:
        with gzip.open(source, 'rb') as stream:
            while True:
                line = stream.readline(MAX_SOURCE_LINE + 1)
                if not line:
                    break
                decoded_bytes += len(line)
                if len(line) > MAX_SOURCE_LINE or decoded_bytes > MAX_SOURCE_INFLATED:
                    raise ValueError('source timetable exceeds decompression/row limit')
                row = json.loads(line.decode('utf-8'))
                if not isinstance(row, list) or len(row) != 2:
                    raise ValueError('invalid source timetable row')
                sid, entries = row
                if (not isinstance(sid, str) or not sid or sid in fingerprints or
                        not isinstance(entries, list) or not entries or
                        len(fingerprints) >= MAX_STOPS):
                    raise ValueError('duplicate, empty or invalid source timetable stop')
                fingerprints[sid] = _fingerprint(entries)
    except (OSError, EOFError, UnicodeError, ValueError, TypeError):
        result['errors'].append('source_timetable_invalid')
        return result
    result['sourceStops'] = len(fingerprints)

    seen = set()
    for number in range(SHARDS):
        shard = shard_root / f'{number:02x}.json.gz'
        try:
            with gzip.open(shard, 'rb') as f:
                payload = f.read(MAX_SHARD_INFLATED + 1)
            if len(payload) > MAX_SHARD_INFLATED:
                raise ValueError('published shard exceeds decompression limit')
            rows = json.loads(payload.decode('utf-8'))
            if not isinstance(rows, dict):
                raise ValueError('invalid shard structure')
        except (OSError, EOFError, UnicodeError, ValueError):
            result['errors'].append('published_timetable_shard_unreadable')
            return result
        for sid, entries in rows.items():
            if sid in seen:
                result['errors'].append('published_timetable_duplicate_stop')
                return result
            seen.add(sid)
            expected = fingerprints.get(sid)
            if expected is None:
                result['unexpectedStops'] += 1
            elif _fingerprint(entries) != expected:
                result['mismatchedStops'] += 1
    result['publishedStops'] = len(seen)
    result['missingStops'] = len(fingerprints.keys() - seen)
    if result['mismatchedStops'] or result['missingStops'] or result['unexpectedStops']:
        result['errors'].append('published_timetable_differs_from_source')
    result['status'] = 'pass' if not result['errors'] else 'blocked'
    return result
