"""Read-only GTFS schedule integrity and full-trip reference validator.

Stdlib only; no route planning, ETA, network requests, production catalog writes.
Source identities and SHA-256 are retained for traceability.
"""
from __future__ import annotations
import collections
import csv
import datetime as dt
import hashlib
import io
import json
import pathlib
import re
import zipfile

FILES = ("routes.txt", "trips.txt", "stops.txt", "stop_times.txt")
TIME = re.compile(r"^(\d{1,3}):([0-5]\d):([0-5]\d)$")
DAY = re.compile(r"^\d{8}$")
MAX_ARCHIVE = 150_000_000
MAX_TOTAL = 1_800_000_000
MAX_MEMBER = 900_000_000


def parse_time(value):
    m = TIME.fullmatch((value or "").strip())
    if not m:
        raise ValueError("invalid GTFS time: " + repr(value))
    h, minute, second = map(int, m.groups())
    if h > 167:
        raise ValueError("GTFS hour exceeds 167")
    return h * 3600 + minute * 60 + second


def parse_day(value):
    if not DAY.fullmatch(value or ""):
        raise ValueError("invalid GTFS date")
    return dt.datetime.strptime(value, "%Y%m%d").date()


def read_feed(path):
    path = pathlib.Path(path)
    if path.stat().st_size > MAX_ARCHIVE:
        raise ValueError("GTFS archive exceeds size limit")
    with path.open("rb") as f:
        digest = hashlib.file_digest(f, "sha256").hexdigest()
    with zipfile.ZipFile(path) as z:
        members = {}
        total = 0
        for member in z.infolist():
            if member.is_dir():
                continue
            name = member.filename
            if name.startswith("/") or "\\" in name or ".." in pathlib.PurePosixPath(name).parts:
                raise ValueError("unsafe GTFS member path")
            base = name.rsplit("/", 1)[-1]
            if base in members:
                raise ValueError("duplicate GTFS member: " + base)
            if member.file_size > MAX_MEMBER:
                raise ValueError("oversized GTFS member")
            total += member.file_size
            if total > MAX_TOTAL:
                raise ValueError("GTFS inflated size exceeds limit")
            members[base] = member
        if any(name not in members for name in FILES):
            raise ValueError("missing required GTFS tables")
        if not ({"calendar.txt", "calendar_dates.txt"} & members.keys()):
            raise ValueError("missing GTFS service calendar")

        def rows(name, required=()):
            if name not in members:
                return []
            with z.open(members[name]) as raw:
                reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
                if not reader.fieldnames or not set(required).issubset(reader.fieldnames):
                    raise ValueError("invalid GTFS columns: " + name)
                result = []
                for row in reader:
                    if None in row or any(v is None for v in row.values()):
                        raise ValueError("malformed GTFS CSV: " + name)
                    result.append(row)
                return result

        routes = rows("routes.txt", ("route_id", "route_short_name"))
        stops = rows("stops.txt", ("stop_id", "stop_name", "stop_lat", "stop_lon"))
        trips = rows("trips.txt", ("trip_id", "route_id", "service_id"))
        times = rows("stop_times.txt", ("trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"))
        calendar = rows("calendar.txt", ("service_id", "start_date", "end_date", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"))
        exceptions = rows("calendar_dates.txt", ("service_id", "date", "exception_type"))
        info = rows("feed_info.txt")
    return dict(sha256=digest, routes=routes, stops=stops, trips=trips,
                times=times, calendar=calendar, exceptions=exceptions, info=info)


def unique(rows, key):
    result = {}
    for row in rows:
        value = (row[key] or "").strip()
        if not value or value in result:
            raise ValueError("missing or duplicate " + key + ": " + repr(value))
        result[value] = row
    return result


def active_services(feed, day):
    day = parse_day(day) if isinstance(day, str) else day
    weekday = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")[day.weekday()]
    active = set()
    for row in feed["calendar"]:
        if parse_day(row["start_date"]) <= day <= parse_day(row["end_date"]) and row[weekday] == "1":
            active.add(row["service_id"])
    seen = set()
    for row in feed["exceptions"]:
        date = parse_day(row["date"])
        if row["exception_type"] not in ("1", "2"):
            raise ValueError("invalid exception type")
        key = (row["service_id"], date)
        if key in seen:
            raise ValueError("duplicate calendar exception")
        seen.add(key)
        if date == day:
            if row["exception_type"] == "1":
                active.add(row["service_id"])
            else:
                active.discard(row["service_id"])
    return active


def validate(feed, day=None):
    routes = unique(feed["routes"], "route_id")
    stops = unique(feed["stops"], "stop_id")
    trips = unique(feed["trips"], "trip_id")
    service_ids = {r["service_id"] for r in feed["calendar"]} | {r["service_id"] for r in feed["exceptions"]}
    if not service_ids:
        raise ValueError("no service IDs")
    for row in feed["stops"]:
        try:
            lat, lon = float(row["stop_lat"]), float(row["stop_lon"])
        except (TypeError, ValueError):
            raise ValueError("invalid stop coordinates") from None
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("invalid stop coordinates")
    for row in feed["trips"]:
        if row["route_id"] not in routes or row["service_id"] not in service_ids:
            raise ValueError("orphan trip route/service")
    grouped = collections.defaultdict(list)
    for row in feed["times"]:
        if row["trip_id"] not in trips or row["stop_id"] not in stops:
            raise ValueError("orphan stop_time trip/stop")
        try:
            seq = int(row["stop_sequence"])
        except ValueError:
            raise ValueError("invalid stop sequence") from None
        if seq < 0:
            raise ValueError("negative stop sequence")
        arrival, departure = parse_time(row["arrival_time"]), parse_time(row["departure_time"])
        if arrival > departure:
            raise ValueError("departure before arrival")
        grouped[row["trip_id"]].append((seq, row["stop_id"], arrival, departure))
    if set(grouped) != set(trips):
        raise ValueError("trips without stop times")
    for tid, items in grouped.items():
        items.sort()
        if len(items) < 2:
            raise ValueError("trip has fewer than two stops: " + tid)
        if len({item[0] for item in items}) != len(items):
            raise ValueError("duplicate stop sequence: " + tid)
        if any(a[3] > b[2] for a, b in zip(items, items[1:])):
            raise ValueError("nonmonotonic trip schedule: " + tid)
    active = active_services(feed, day) if day is not None else None
    coverage = {
        "sourceSha256": feed["sha256"], "routeCount": len(routes),
        "stopCount": len(stops), "tripCount": len(trips),
        "stopTimeCount": len(feed["times"]),
        "date": day.isoformat() if isinstance(day, dt.date) else day,
        "activeTripCount": sum(t["service_id"] in active for t in trips.values()) if active is not None else None,
        "activeServiceCount": len(active) if active is not None else None,
    }
    return coverage, routes, stops, trips, grouped


def reference_journey(feed, day, trip_id, board_stop, alight_stop):
    """Validate one real scheduled single-vehicle leg, never infer a transfer or ETA."""
    summary, routes, stops, trips, grouped = validate(feed, day)
    if trip_id not in trips:
        return {"status": "missing_trip", "sourceSha256": feed["sha256"]}
    trip = trips[trip_id]
    if trip["service_id"] not in active_services(feed, day):
        return {"status": "inactive_service", "sourceSha256": feed["sha256"]}
    items = grouped[trip_id]
    boards = [i for i, item in enumerate(items) if item[1] == board_stop]
    pairs = [(i, j) for i in boards for j in range(i + 1, len(items)) if items[j][1] == alight_stop]
    if not pairs:
        return {"status": "missing_ordered_stops", "sourceSha256": feed["sha256"]}
    i, j = pairs[0]
    board, alight = items[i], items[j]
    return {"status": "scheduled", "sourceSha256": feed["sha256"],
            "date": day, "tripId": trip_id, "routeId": trip["route_id"],
            "routeShortName": routes[trip["route_id"]]["route_short_name"],
            "boardStopId": board_stop, "boardStopName": stops[board_stop]["stop_name"],
            "alightStopId": alight_stop, "alightStopName": stops[alight_stop]["stop_name"],
            "boardSeconds": board[3], "alightSeconds": alight[2],
            "stopCount": j - i + 1, "scheduledNotRealtime": True}


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("gtfs_zip", help="Official GTFS zip, local only")
    parser.add_argument("--date", help="YYYYMMDD, service date")
    parser.add_argument("--trip-id")
    parser.add_argument("--board-stop")
    parser.add_argument("--alight-stop")
    args = parser.parse_args()
    feed = read_feed(args.gtfs_zip)
    coverage, *_ = validate(feed, args.date)
    result = {"coverage": coverage}
    if any((args.trip_id, args.board_stop, args.alight_stop)):
        if not all((args.date, args.trip_id, args.board_stop, args.alight_stop)):
            parser.error("journey requires --date --trip-id --board-stop --alight-stop")
        result["journey"] = reference_journey(feed, args.date, args.trip_id, args.board_stop, args.alight_stop)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
