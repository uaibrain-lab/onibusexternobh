"""Read-only validation of the actual 256 scheduled-arrival shards for BH V1.

Does not publish data, infer journeys, depend on a router or claim realtime ETA.
The index alone is NOT proof that the expected gzip files exist or are usable.
"""
from __future__ import annotations

import gzip
import json
from pathlib import Path

BUCKET_COUNT = 256
MAX_BUCKET_BYTES = 24_000_000
MAX_BUCKET_COMPRESSED = 4_000_000
MAX_TOTAL_BYTES = 650_000_000


def _bucket_id(stop_id):
    # Match scripts/build_static_arrivals.py / static/static-arrivals.js.
    value = 0
    for char in str(stop_id):
        value = (value * 31 + ord(char)) % BUCKET_COUNT
    return f"{value:02x}"


def audit_arrivals(index_file, catalog, expected_stop_count, version, valid_through):
    """Verify published blobs and references; report structured failures.

    Every shard is decompressed with a bounded read, and independently checked
    against catalog stop IDs, route public codes and GTFS service IDs. A pass
    means package integrity, NOT operational validation or realtime forecasts.
    """
    index_file, catalog = Path(index_file), Path(catalog)
    errors = []
    result = {"errors": errors, "filesChecked": 0, "stopsChecked": 0,
              "scheduledGroupsChecked": 0, "compressedBytes": 0}

    try:
        index = json.loads(index_file.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        return {**result, "errors": ["static_arrivals_index_unreadable"]}
    expected_files = {f"{i:02x}.json.gz" for i in range(BUCKET_COUNT)}
    sizes = index.get("sizes") if isinstance(index, dict) else None
    if (not isinstance(index, dict) or index.get("schema") != 1 or
            index.get("buckets") != BUCKET_COUNT or
            index.get("version") != version or
            index.get("validThrough") != valid_through or
            index.get("stopCount") != expected_stop_count or
            not isinstance(sizes, dict) or set(sizes) != expected_files or
            any(type(v) is not int or v <= 0 or v > MAX_BUCKET_COMPRESSED for v in sizes.values())):
        return {**result, "errors": ["static_arrivals_index_incompatible"]}

    try:
        calendar = json.loads((catalog / "timetable-calendar.json").read_text(encoding="utf-8"))
        shard_calendar = json.loads((index_file.parent / "calendar.json").read_text(encoding="utf-8"))
        routes = json.loads((catalog / "routes.json").read_text(encoding="utf-8"))
        stops = json.loads((catalog / "stops.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        return {**result, "errors": ["static_arrivals_catalog_unreadable"]}
    if calendar != shard_calendar:
        errors.append("static_arrivals_calendar_mismatch")
    if not isinstance(calendar.get("services"), dict) or not isinstance(stops, dict) or not isinstance(routes, list):
        errors.append("static_arrivals_catalog_invalid")
        return result

    service_ids = set(calendar["services"])
    # GTFS permits service IDs defined only through calendar_dates.txt.
    for overrides in calendar.get("exceptions", {}).values():
        if isinstance(overrides, dict):
            service_ids.update(overrides)
    route_codes = {str(route.get("code", "")) for route in routes if isinstance(route, dict)}
    seen_stops = set()
    raw_total = 0

    for name in sorted(expected_files):
        f = index_file.parent / name
        try:
            actual_size = f.stat().st_size
            if actual_size != sizes[name] or actual_size > MAX_BUCKET_COMPRESSED:
                errors.append("static_arrivals_bucket_size_mismatch")
                break
            with gzip.open(f, "rb") as stream:
                raw = stream.read(MAX_BUCKET_BYTES + 1)
            if len(raw) > MAX_BUCKET_BYTES:
                errors.append("static_arrivals_bucket_inflated_too_large")
                break
            raw_total += len(raw)
            if raw_total > MAX_TOTAL_BYTES:
                errors.append("static_arrivals_total_inflated_too_large")
                break
            group = json.loads(raw.decode("utf-8"))
        except (OSError, EOFError, UnicodeError, ValueError):
            errors.append("static_arrivals_bucket_unreadable")
            break
        if not isinstance(group, dict):
            errors.append("static_arrivals_bucket_invalid")
            break
        for sid, entries in group.items():
            if (sid not in stops or _bucket_id(sid) + ".json.gz" != name or
                    sid in seen_stops or not isinstance(entries, list) or not entries):
                errors.append("static_arrivals_stop_invalid")
                break
            seen_stops.add(sid)
            for item in entries:
                if not isinstance(item, list) or len(item) != 4:
                    errors.append("static_arrivals_schedule_invalid")
                    break
                code, service, destination, times = item
                if (not isinstance(code, str) or code not in route_codes or
                        str(service) not in service_ids or
                        not isinstance(destination, (str, type(None))) or
                        not isinstance(times, list) or not times or
                        any(type(t) is not int or not 0 <= t < 48*3600 for t in times) or
                        any(a >= b for a, b in zip(times, times[1:]))):
                    errors.append("static_arrivals_schedule_invalid")
                    break
                result["scheduledGroupsChecked"] += 1
            if errors:
                break
        if errors:
            break
        result["filesChecked"] += 1
        result["compressedBytes"] += actual_size
    result["stopsChecked"] = len(seen_stops)
    if not errors and len(seen_stops) != expected_stop_count:
        errors.append("static_arrivals_stop_coverage_mismatch")
    return result
