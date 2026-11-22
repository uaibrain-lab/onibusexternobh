"""Read-only BH municipal V1 release gate (no routing, GPS or RMBH dependencies).

Stdlib only. Verifies an *existing* local catalog; never downloads or publishes.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path
import re

DATE = re.compile(r"\d{8}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def _day(value):
    if not isinstance(value, str) or not DATE.fullmatch(value):
        raise ValueError("invalid GTFS service date")
    return dt.datetime.strptime(value, "%Y%m%d").date()


def _json(root, name):
    return json.loads((root / name).read_text(encoding="utf-8"))


def _active(services, exceptions, day):
    key = day.strftime("%Y%m%d")
    active = set()
    for sid, row in services.items():
        if _day(row["start_date"]) <= day <= _day(row["end_date"]) and row["start_date"] <= row["end_date"] and row[DAYS[day.weekday()]] == "1":
            active.add(sid)
    for sid, op in exceptions.get(key, {}).items():
        if sid not in services or op not in (1, 2):
            raise ValueError("invalid calendar exception reference/type")
        if op == 1:
            active.add(sid)
        else:
            active.discard(sid)
    return active


def audit(catalog, service_date, arrivals_index=None, require_arrivals=False):
    """Return JSON-safe report with errors; no success for incomplete or expired data."""
    root = Path(catalog)
    day = _day(service_date)
    errors, warnings = [], []
    manifest = _json(root, "manifest.json")
    routes = _json(root, "routes.json")
    stops = _json(root, "stops.json")
    calendar = _json(root, "timetable-calendar.json")
    metro = _json(root, "metro.json")
    version = str(manifest.get("gtfsVersion") or "")
    if not version:
        errors.append("missing_gtfs_version")
    start, end = _day(manifest.get("feedStartDate")), _day(manifest.get("feedEndDate"))
    if not start <= day <= end:
        errors.append("service_date_outside_gtfs_validity")
    if len(routes) != manifest.get("routes") or not routes:
        errors.append("route_count_mismatch")
    if len(stops) != manifest.get("stops") or not stops:
        errors.append("stop_count_mismatch")
    codes, route_ids = set(), set()
    for route in routes:
        rid, code = str(route.get("id", "")).strip(), str(route.get("code", "")).strip()
        if not rid or not code or rid in route_ids or code.upper() in codes:
            errors.append("duplicate_or_missing_route_id_or_code")
            break
        route_ids.add(rid)
        codes.add(code.upper())
    for sid, value in stops.items():
        if (not str(sid).strip() or not isinstance(value, list) or len(value) < 3 or
                not isinstance(value[0], str) or not value[0].strip() or
                any(not isinstance(v, (int, float)) or isinstance(v, bool) or not math.isfinite(v) for v in value[1:3]) or
                not (-90 <= value[1] <= 90 and -180 <= value[2] <= 180)):
            errors.append("invalid_stop_id_name_or_coordinate")
            break
    services = calendar.get("services", {})
    if not isinstance(services, dict) or not services:
        errors.append("missing_service_calendar")
        active = set()
    else:
        try:
            active = _active(services, calendar.get("exceptions", {}), day)
        except (ValueError, KeyError, TypeError):
            errors.append("invalid_service_calendar")
            active = set()
    if start <= day <= end and not active:
        errors.append("no_active_services_on_requested_date")
    if calendar.get("records") != manifest.get("stopTimeRows"):
        errors.append("stop_time_count_mismatch")
    timed_stops = calendar.get("stops")
    if not isinstance(timed_stops, int) or isinstance(timed_stops, bool) or timed_stops < 1 or timed_stops > len(stops):
        errors.append("invalid_timed_stop_count")
        timed_stops = None
    elif timed_stops < len(stops):
        warnings.append("stops_without_scheduled_arrivals:" + str(len(stops) - timed_stops))
    digest_path = root / "source-gtfs.sha256"
    if not digest_path.is_file() or not SHA.fullmatch(digest_path.read_text(encoding="utf-8").strip()):
        errors.append("missing_or_invalid_source_gtfs_sha256")
    # A checksum of the original ZIP is not a cryptographic signature of every derived file.
    warnings.append("source_checksum_does_not_prove_derived_file_identity")
    if require_arrivals and arrivals_index is None:
        errors.append("static_arrivals_index_required")
    arrival_report = None
    timetable_report = None
    if arrivals_index is not None:
        from data_quality.static_arrivals_reference import audit_arrivals
        arrival_report = audit_arrivals(arrivals_index, root, timed_stops, version,
                                        manifest.get("feedEndDate"))
        errors.extend(arrival_report["errors"])
        if not arrival_report["errors"]:
            from data_quality.bh_v1_timetable_consistency import audit_timetable_equivalence
            timetable_report = audit_timetable_equivalence(root, arrivals_index)
            errors.extend(timetable_report["errors"])
    line_ids = set()
    station_ids = set()
    for line in metro.get("lines", []):
        lid = str(line.get("id") or "")
        if not lid or lid in line_ids:
            errors.append("invalid_metro_line_id")
        line_ids.add(lid)
    for station in metro.get("stations", []):
        sid = str(station.get("id") or "")
        lat, lng = station.get("lat"), station.get("lng")
        if (not sid or sid in station_ids or not isinstance(lat, (int, float)) or
                not isinstance(lng, (int, float)) or not math.isfinite(lat) or not math.isfinite(lng) or
                not (-90 <= lat <= 90 and -180 <= lng <= 180) or
                not set(station.get("lines", [])).issubset(line_ids)):
            errors.append("invalid_metro_station_reference")
            break
        station_ids.add(sid)
    for line in metro.get("lines", []):
        if not set(line.get("stations", [])).issubset(station_ids):
            errors.append("metro_line_references_missing_station")
            break
    if not metro.get("lines") or not metro.get("stations"):
        errors.append("empty_metro_catalog")
    return {"status": "pass" if not errors else "blocked", "serviceDate": service_date,
            "gtfsVersion": version, "gtfsValidThrough": manifest.get("feedEndDate"),
            "counts": {"routes": len(routes), "stops": len(stops), "scheduledStops": timed_stops,
                       "activeServices": len(active), "metroLines": len(line_ids), "metroStations": len(station_ids)},
            "errors": sorted(set(errors)), "warnings": sorted(set(warnings)),
            "scheduledNotRealtime": True, "routesAndRmbhInScope": False,
            "arrivalsAudit": arrival_report, "timetableAudit": timetable_report,
            "sourceSha256": digest_path.read_text(encoding="utf-8").strip() if digest_path.is_file() else None}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Validate municipal BH GTFS catalog for V1 release")
    parser.add_argument("catalog", type=Path)
    parser.add_argument("--date", default=dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).strftime("%Y%m%d"))
    parser.add_argument("--arrivals-index", type=Path)
    parser.add_argument("--require-arrivals", action="store_true")
    args = parser.parse_args(argv)
    report = audit(args.catalog, args.date, args.arrivals_index, args.require_arrivals)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["status"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
