"""Read-only provenance audit between a local municipal GTFS ZIP and V1 catalog.

The recorded SHA-256 is only evidence if recomputed over the exact ZIP. This
module verifies reference IDs, calendars, coordinate mappings and raw trip/stop
rows in bounded memory. It does NOT assert operational punctuality, source
licensing, or byte-for-byte stop-level timetable equivalence (see separate gate).
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
from data_quality.bh_v1_trip_sequence import TripSequenceAudit
import re
import zipfile

MAX_ARCHIVE_BYTES = 150_000_000
MAX_UNCOMPRESSED_BYTES = 1_800_000_000
MAX_MEMBER_BYTES = 950_000_000
REQUIRED = {"routes.txt", "stops.txt", "trips.txt", "stop_times.txt"}
WEEK = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
DATE = re.compile(r"[0-9]{8}\Z")
GTFS_CLOCK = re.compile(r"([0-9]{1,3}):([0-5][0-9]):([0-5][0-9])\Z")


def _load_json(root, name):
    return json.loads((root / name).read_text(encoding="utf-8"))


def _read_rows(z, member, required=()):
    if member is None:
        return
    with z.open(member) as stream:
        reader = csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig", newline=""))
        if (not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames)
                or not set(required).issubset(reader.fieldnames)):
            raise ValueError("invalid source GTFS columns")
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("malformed source GTFS CSV")
            yield row


def _unique(rows, key):
    found = {}
    for item in rows:
        value = item[key].strip()
        if not value or value in found:
            raise ValueError("duplicate or absent GTFS ID: " + key)
        found[value] = item
    return found


def _parse_gtfs_clock(value):
    match = GTFS_CLOCK.fullmatch(value.strip())
    if not match:
        raise ValueError("unusable stop time in source GTFS")
    hour = int(match.group(1))
    if hour >= 48:
        # The current municipal timetable exporter only supports <48h.
        raise ValueError("stop time exceeds V1 timetable exporter range")
    return hour * 3600 + int(match.group(2)) * 60 + int(match.group(3))


def audit_source_zip(catalog, archive):
    """Compare official ZIP bytes with derived catalog metadata, fail closed.

    Streams the largest stop_times table, keeping only trip/stop IDs and counts.
    The SHA-256 proves *this specific local ZIP* matches the recorded hash. The
    source URL, age and redistribution rights must be checked independently.
    """
    root, archive = Path(catalog), Path(archive)
    result = {"status": "blocked", "errors": [], "warnings": [],
              "archiveSha256": None, "registeredSha256": None, "archiveBytes": None,
              "routeCount": 0, "stopCount": 0, "tripCount": 0, "stopTimeRows": 0,
              "servicesWithScheduledTrips": [], "tripsWithoutStopTimes": 0,
              "tripSequenceAudit": None,
              "licensedForRedistribution": "unverified", "scheduledNotRealtime": True}
    errors = result["errors"]
    try:
        size = archive.stat().st_size
        if not 0 < size <= MAX_ARCHIVE_BYTES:
            raise ValueError("ZIP archive exceeds safety limit")
        result["archiveBytes"] = size
        h = hashlib.sha256()
        with archive.open("rb") as fh:
            for block in iter(lambda: fh.read(1024 * 1024), b""):
                h.update(block)
        result["archiveSha256"] = h.hexdigest()
        stored = (root / "source-gtfs.sha256").read_text(encoding="utf-8").strip()
        result["registeredSha256"] = stored
        if not re.fullmatch(r"[0-9a-f]{64}", stored) or stored != h.hexdigest():
            errors.append("source_zip_checksum_mismatch")
            return result
        manifest = _load_json(root, "manifest.json")
        compiled_routes = _load_json(root, "routes.json")
        compiled_stops = _load_json(root, "stops.json")
        compiled_calendar = _load_json(root, "timetable-calendar.json")
        with zipfile.ZipFile(archive) as z:
            members, total = {}, 0
            for member in z.infolist():
                if member.is_dir():
                    continue
                path = PurePosixPath(member.filename)
                if (path.is_absolute() or "\\" in member.filename or ".." in path.parts
                        or member.file_size > MAX_MEMBER_BYTES):
                    raise ValueError("unsafe GTFS ZIP entry")
                total += member.file_size
                if total > MAX_UNCOMPRESSED_BYTES:
                    raise ValueError("GTFS archive exceeds inflated safety limit")
                base = path.name.lower()
                if base in members:
                    raise ValueError("duplicate GTFS ZIP member")
                members[base] = member
            if not REQUIRED.issubset(members) or not ({"calendar.txt", "calendar_dates.txt"} & members.keys()):
                raise ValueError("missing required GTFS source tables")

            routes = _unique(_read_rows(z, members["routes.txt"], ("route_id", "route_short_name")), "route_id")
            stops = _unique(_read_rows(z, members["stops.txt"], ("stop_id", "stop_name", "stop_lat", "stop_lon")), "stop_id")
            trips = _unique(_read_rows(z, members["trips.txt"], ("trip_id", "route_id", "service_id")), "trip_id")
            result.update(routeCount=len(routes), stopCount=len(stops), tripCount=len(trips))

            route_map = {str(row.get("id")): str(row.get("code")) for row in compiled_routes}
            if (len(route_map) != len(compiled_routes) or len(route_map) != len(routes)
                    or any(route_map.get(rid) != row["route_short_name"] for rid, row in routes.items())
                    or len(routes) != manifest.get("routes")):
                errors.append("source_routes_do_not_match_catalog")
            if (not isinstance(compiled_stops, dict) or set(stops) != set(compiled_stops)
                    or len(stops) != manifest.get("stops")):
                errors.append("source_stops_do_not_match_catalog")
            else:
                for sid, row in stops.items():
                    compiled = compiled_stops[sid]
                    try:
                        if (not isinstance(compiled, list) or len(compiled) < 3
                                or compiled[0] != row["stop_name"]
                                or not math.isclose(float(row["stop_lat"]), float(compiled[1]), abs_tol=0.000001, rel_tol=0)
                                or not math.isclose(float(row["stop_lon"]), float(compiled[2]), abs_tol=0.000001, rel_tol=0)):
                            errors.append("source_stop_details_do_not_match_catalog")
                            break
                    except (ValueError, TypeError, OverflowError):
                        errors.append("source_stop_details_do_not_match_catalog")
                        break
            if len(trips) != manifest.get("trips"):
                errors.append("source_trip_count_mismatch")

            services = _unique(_read_rows(z, members.get("calendar.txt"), ("service_id", *WEEK, "start_date", "end_date")), "service_id")
            expected_services = {sid: {field: row[field] for field in (*WEEK, "start_date", "end_date")}
                                 for sid, row in services.items()}
            if expected_services != compiled_calendar.get("services", {}):
                errors.append("source_calendar_does_not_match_catalog")
            exceptions = {}
            for row in _read_rows(z, members.get("calendar_dates.txt"), ("service_id", "date", "exception_type")):
                date, sid = row["date"], row["service_id"]
                if not DATE.fullmatch(date) or row["exception_type"] not in ("1", "2"):
                    raise ValueError("invalid source GTFS service exception")
                day = exceptions.setdefault(date, {})
                if sid in day:
                    raise ValueError("duplicate source GTFS service exception")
                day[sid] = int(row["exception_type"])
            if exceptions != compiled_calendar.get("exceptions", {}):
                errors.append("source_exceptions_do_not_match_catalog")
            known_services = set(services) | {sid for date in exceptions.values() for sid in date}
            if any(row["route_id"] not in routes or row["service_id"] not in known_services for row in trips.values()):
                errors.append("source_trip_missing_route_or_service")

            trip_ids_with_times = set()
            sequence_audit = TripSequenceAudit(trips)
            for row in _read_rows(z, members["stop_times.txt"],
                                  ("trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time")):
                result["stopTimeRows"] += 1
                if row["trip_id"] not in trips or row["stop_id"] not in stops:
                    errors.append("source_stop_time_orphan_reference")
                    break
                trip_ids_with_times.add(row["trip_id"])
                try:
                    sequence = int(row["stop_sequence"])
                    if sequence < 0:
                        raise ValueError("invalid stop sequence")
                    arrival = _parse_gtfs_clock(row["arrival_time"] or row["departure_time"])
                    departure = _parse_gtfs_clock(row["departure_time"] or row["arrival_time"])
                    if departure < arrival:
                        raise ValueError("departure before arrival")
                    sequence_audit.add(row["trip_id"], sequence, arrival, departure)
                except (ValueError, TypeError):
                    errors.append("source_stop_time_invalid")
                    break
            result["tripSequenceAudit"] = sequence_audit.report()
            errors.extend(result["tripSequenceAudit"]["errors"])
            result["tripsWithoutStopTimes"] = len(trips) - len(trip_ids_with_times)
            result["servicesWithScheduledTrips"] = sorted({trips[tid]["service_id"] for tid in trip_ids_with_times})
            if result["tripsWithoutStopTimes"]:
                errors.append("source_trips_without_stop_times")
            if (result["stopTimeRows"] != manifest.get("stopTimeRows")
                    or result["stopTimeRows"] != compiled_calendar.get("records")):
                errors.append("source_stop_times_do_not_match_counts")

            info_rows = list(_read_rows(z, members.get("feed_info.txt")))
            if info_rows:
                if len(info_rows) != 1:
                    errors.append("source_feed_info_multiple_rows")
                else:
                    info = info_rows[0]
                    for field, key in (("feed_version", "gtfsVersion"),
                                       ("feed_start_date", "feedStartDate"),
                                       ("feed_end_date", "feedEndDate")):
                        if info.get(field) and info[field] != str(manifest.get(key) or ""):
                            errors.append("source_feed_info_mismatch")
                            break
            else:
                result["warnings"].append("source_feed_info_absent")
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, zipfile.BadZipFile, EOFError, json.JSONDecodeError):
        errors.append("source_zip_unreadable_or_invalid")
    result["errors"] = sorted(set(errors))
    result["status"] = "pass" if not errors else "blocked"
    return result
