#!/usr/bin/env python3
"""One-shot GTFS-RT-to-ACTUAL-APP-catalog compatibility diagnostic.

No ETA generation, no writes, no paid APIs or polling. It examines a single
official SUMOB TripUpdates feed against the line shards and scan index that
the Externo BH currently serves. Output contains AGGREGATE COUNTS ONLY.

Usage:
  py scripts/audit_sumob_catalog_match.py
  py scripts/audit_sumob_catalog_match.py --file C:/feed/trip-updates.pb
  py scripts/audit_sumob_catalog_match.py --catalog D:/Externo-GPS-Teste/catalog

By default it reads SUMOB_TRIP_UPDATES_URL from the environment. This
script must not be called directly from the browser or on every user view.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import re
import sys
import time

MAX_FEED = 8 * 1024 * 1024
MAX_GZIP = 32 * 1024 * 1024
MAX_DECOMPRESSED = 140 * 1024 * 1024
MAX_TRIPS = 300000
MAX_ENTITIES = 25000
ROOT = Path(__file__).resolve().parents[1]


def read_json(path: Path, compressed: bool = False):
    if not path.is_file():
        raise ValueError("Arquivo necessário de catálogo ausente")
    if path.stat().st_size > MAX_GZIP:
        raise ValueError("Arquivo de catálogo acima do limite")
    if compressed:
        with gzip.open(path, "rb") as stream:
            raw = stream.read(MAX_DECOMPRESSED + 1)
        if len(raw) > MAX_DECOMPRESSED:
            raise ValueError("Catálogo descompactado excede limite")
        return json.loads(raw)
    return json.loads(path.read_text(encoding="utf-8"))


def service_active(meta: dict, index: int, start_date: str) -> bool | None:
    if not isinstance(start_date, str) or not re.fullmatch(r"\d{8}", start_date):
        return None
    try:
        date = datetime.strptime(start_date, "%Y%m%d").date()
    except ValueError:
        return None
    services = meta.get("services", [])
    if not isinstance(index, int) or index < 0 or index >= len(services):
        return None
    row = services[index]
    sid = str(row.get("id", ""))
    exceptions = meta.get("exceptions", {}).get(start_date, {})
    if sid in exceptions or str(sid) in exceptions:
        try:
            return int(exceptions[sid]) == 1
        except (ValueError, TypeError):
            return None
    cal = row.get("calendar") or {}
    if not cal:
        return False
    if not (cal.get("start_date", "99999999") <= start_date <=
            cal.get("end_date", "00000000")):
        return False
    return str(cal.get(date.strftime("%A").lower(), "0")) == "1"


def seconds(value: str):
    match = re.fullmatch(r"(\d{1,2}):(\d{2}):(\d{2})", value or "")
    if not match:
        return None
    h, m, sec = map(int, match.groups())
    if h >= 48 or m >= 60 or sec >= 60:
        return None
    return h * 3600 + m * 60 + sec


def audit(feed, catalog: Path, now: int | None = None) -> dict:
    now = int(time.time()) if now is None else now
    catalog = Path(catalog).resolve()
    meta = read_json(catalog / "scan/index.json")
    routing = read_json(catalog / "routing-index.json")
    scan_trips = read_json(catalog / "scan/trips.json.gz", compressed=True)
    if not isinstance(scan_trips, list) or len(scan_trips) > MAX_TRIPS:
        raise ValueError("Índice de viagens inválido")
    if len(scan_trips) != meta.get("tripCount"):
        raise ValueError("Índice GTFS com versão incompleta")
    # The browser's scan rows are [trip_id, public_code, headsign, service_idx].
    by_id = defaultdict(list)
    for row in scan_trips:
        if not isinstance(row, list) or len(row) < 4:
            raise ValueError("Formato do índice de viagens incompatível")
        by_id[str(row[0])].append((str(row[1]).strip().upper(), row[3]))
    updates = [e.trip_update for e in feed.entity if e.HasField("trip_update")]
    if len(updates) > MAX_ENTITIES:
        raise ValueError("Feed com entidades em excesso")
    count = Counter()
    needed = defaultdict(set)
    matched = []
    for u in updates:
        trip = u.trip
        tid = str(trip.trip_id or "")
        code = str(trip.route_id or "").strip().upper()
        start_date = str(trip.start_date or "")
        start_time = str(trip.start_time or "")
        count["observedTripUpdates"] += 1
        if trip.HasField("direction_id"):
            count["directionNotStoredInScan"] += 1
        records = by_id.get(tid, [])
        if not records:
            count["tripIdMissingFromApp"] += 1
            continue
        count["tripIdFoundInApp"] += 1
        candidates = [(route, service) for route, service in records if route == code]
        if len(candidates) != 1:
            count["routeMismatchOrAmbiguous"] += 1
            continue
        line, service_idx = candidates[0]
        active = service_active(meta, service_idx, start_date)
        if active is None:
            count["serviceDateUnverifiable"] += 1
            continue
        if not active:
            count["serviceInactiveOnStartDate"] += 1
            continue
        count["activeServiceMatches"] += 1
        if seconds(start_time) is None:
            count["startTimeMissingOrInvalid"] += 1
            continue
        needed[line].add(tid)
        matched.append((u, line, tid, service_idx))
    # The routing shards currently hold [stop_id, arrival_sec, departure_sec,
    # pickup, dropoff]. Next rebuild may add 6th original stop_sequence.
    # Never reconstruct the original sequence as index+1: GTFS may skip IDs.
    shard_trips = {}
    file_map = routing.get("files") or {}
    for line, ids in needed.items():
        filename = file_map.get(line)
        if not isinstance(filename, str) or not filename.startswith("routing/") or ".." in filename:
            count["missingRoutingShardLines"] += 1
            continue
        rows = read_json(catalog / filename, compressed=True)
        if not isinstance(rows, list):
            raise ValueError("Routing shard inválido")
        for trip in rows:
            if not isinstance(trip, list) or len(trip) < 4:
                continue
            tid = str(trip[0])
            if tid in ids:
                shard_trips[(line, tid)] = trip
    for update, line, tid, service_idx in matched:
        row = shard_trips.get((line, tid))
        if row is None:
            count["tripMissingFromRoutingShard"] += 1
            continue
        # A trip ID may appear in mismatched routing and scan versions.
        # Require the per-line shard to refer to the SAME service ID.
        expected_service=str(meta["services"][service_idx]["id"])
        if str(row[1]) != expected_service:
            count["routingShardServiceMismatch"] += 1
            continue
        count["matchedAppTripAndService"] += 1
        departure = row[3][0][2] if row[3] else None
        start = seconds(str(update.trip.start_time))
        if not isinstance(departure, int) or start != departure:
            # This can be different for frequency/shifted services; do NOT
            # treat a matching trip_id alone as a reliable live instance.
            count["startTimeDifferentFromAppSchedule"] += 1
            continue
        count["startTimeMatchesAppSchedule"] += 1
        points = row[3]
        for stop in update.stop_time_update:
            count["updatesWithMatchedAppTrip"] += 1
            sid = str(stop.stop_id or "")
            seq = int(stop.stop_sequence) if stop.HasField("stop_sequence") else None
            if not sid or seq is None:
                count["stopKeyIncomplete"] += 1
                continue
            present = [point for point in points if isinstance(point, list) and
                       point and str(point[0]) == sid]
            if not present:
                count["stopIdMissingFromTrip"] += 1
                continue
            count["stopIdPresentInTrip"] += 1
            if not all(len(p) >= 6 for p in present):
                count["stopSequenceNotPreserved"] += 1
                continue
            matching = [p for p in present if int(p[5]) == seq]
            if len(matching) == 1:
                count["stopIdAndSequenceVerified"] += 1
            else:
                count["stopSequenceMismatch"] += 1
    header_ts = int(getattr(feed.header, "timestamp", 0))
    age = now - header_ts if header_ts else None
    return {
        "audit": "SUMOB_TRIP_UPDATES_VS_APP_CATALOG_READ_ONLY",
        "scanTripCount": len(scan_trips),
        "scanBuiltUTC": meta.get("builtUTC"),
        "scanSourceBuildUTC": meta.get("gtfsBuiltUTC"),
        "routingBuildUTC": routing.get("builtUTC"),
        "routingPreservesStopSequence": bool(routing.get("stopSequencePreserved")),
        "observedTripUpdates": count["observedTripUpdates"],
        "tripIdFoundInApp": count["tripIdFoundInApp"],
        "tripIdMissingFromApp": count["tripIdMissingFromApp"],
        "routeMismatchOrAmbiguous": count["routeMismatchOrAmbiguous"],
        "activeServiceMatches": count["activeServiceMatches"],
        "serviceInactiveOnStartDate": count["serviceInactiveOnStartDate"],
        "serviceDateUnverifiable": count["serviceDateUnverifiable"],
        "matchedAppTripAndService": count["matchedAppTripAndService"],
        "tripMissingFromRoutingShard": count["tripMissingFromRoutingShard"],
        "routingShardServiceMismatch": count["routingShardServiceMismatch"],
        "startTimeMatchesAppSchedule": count["startTimeMatchesAppSchedule"],
        "startTimeDifferentFromAppSchedule": count["startTimeDifferentFromAppSchedule"],
        "stopIdPresentInTrip": count["stopIdPresentInTrip"],
        "stopIdMissingFromTrip": count["stopIdMissingFromTrip"],
        "stopSequenceNotPreserved": count["stopSequenceNotPreserved"],
        "stopIdAndSequenceVerified": count["stopIdAndSequenceVerified"],
        "stopSequenceMismatch": count["stopSequenceMismatch"],
        "missingRoutingShardLines": count["missingRoutingShardLines"],
        "feedHeaderAgeSeconds": age,
        "perTripSampleAgeVerified": False,
        "readyForLiveETA": False,
        "note": "Match entre viagem, hora e parada nao valida atraso atual sem timestamp por viagem; nao propagar ETA ate prova de frescor, sequencia e versao GTFS."
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=ROOT / "catalog")
    parser.add_argument("--file", type=Path, default=None)
    args = parser.parse_args()
    try:
        from google.transit import gtfs_realtime_pb2
        from probe_sumob_trip_updates import get_feed_bytes
        if args.file:
            if not args.file.is_file() or args.file.stat().st_size > MAX_FEED:
                raise ValueError("Feed local ausente ou acima do limite")
            raw = args.file.read_bytes()
        else:
            url = os.environ.get("SUMOB_TRIP_UPDATES_URL")
            if not url:
                raise ValueError("Configure SUMOB_TRIP_UPDATES_URL")
            raw = get_feed_bytes(url)
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(raw)
        if not feed.header.gtfs_realtime_version:
            raise ValueError("Feed sem header GTFS-Realtime válido")
        print(json.dumps(audit(feed, args.catalog), ensure_ascii=False, indent=2))
        print("SUMOB_APP_CATALOG_COMPATIBILITY_AUDIT_OK")
        return 0
    except Exception as exc:
        print("SUMOB_APP_CATALOG_COMPATIBILITY_AUDIT_FAILED:",
              type(exc).__name__, str(exc) if isinstance(exc, ValueError) else
              "dados inconsistentes ou indisponíveis", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
