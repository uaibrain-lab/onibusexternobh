#!/usr/bin/env python3
"""One-shot and read-only quality probe for PBH/SUMOB official GTFS-Realtime TripUpdates.

Required free dependency:
  py -m pip install gtfs-realtime-bindings

Usage (PowerShell):
  $env:SUMOB_TRIP_UPDATES_URL = '<copy the official TripUpdates URL from dados.pbh.gov.br>'
  py scripts/probe_sumob_trip_updates.py

Or decode a previously downloaded protobuf, without any network:
  py scripts/probe_sumob_trip_updates.py --file C:\path\to\trip-updates.pb

No polling, GPS collection, persistence or user information. URL/token are
never printed or saved. Does not modify the live Externo BH.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
from statistics import median
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

MAX_BYTES = 8 * 1024 * 1024
OFFICIAL_HOST = "realtime4.mobilibus.com"
OFFICIAL_PATH = "/web/4ch6j/trip-updates"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def get_feed_bytes(url: str) -> bytes:
    p = urlsplit(url)
    if (p.scheme not in ("http", "https") or p.hostname != OFFICIAL_HOST
            or p.path != OFFICIAL_PATH or not p.query or p.username or p.password
            or p.port not in (None, 80, 443)):
        raise ValueError("Use somente a URL oficial TripUpdates da SUMOB")
    req = Request(url, headers={
        "Accept": "application/x-protobuf,application/octet-stream"
    })
    try:
        with build_opener(NoRedirect()).open(req, timeout=15) as response:
            declared = response.headers.get("Content-Length")
            if declared and int(declared) > MAX_BYTES:
                raise ValueError("Resposta excedeu 8 MiB")
            body = response.read(MAX_BYTES + 1)
    except HTTPError as err:
        raise RuntimeError("Fonte SUMOB respondeu HTTP %d" % err.code) from None
    except URLError:
        raise RuntimeError("Fonte SUMOB inacessível nesta rede") from None
    if len(body) > MAX_BYTES or len(body) < 5:
        raise ValueError("Protobuf ausente ou maior que 8 MiB")
    if body.lstrip()[:1] in (b"<", b"{", b"["):
        raise ValueError("Fonte devolveu HTML/JSON, não GTFS-Realtime")
    return body


def summarize(feed, byte_count: int, now: int | None = None) -> dict:
    now = now or int(time.time())
    age = int(getattr(feed.header, "timestamp", 0))
    timestamps = []
    stops_per_trip = []
    with_absolute_time = 0
    with_delay = 0
    stop_updates = 0
    cancelled = 0
    with_trip_id = 0
    with_route_id = 0
    route_ids = Counter()
    for entity in feed.entity:
        if not entity.HasField("trip_update"):
            continue
        update = entity.trip_update
        trip = update.trip
        if trip.trip_id:
            with_trip_id += 1
        if trip.route_id:
            with_route_id += 1
            route_ids[str(trip.route_id)] += 1
        if trip.HasField("schedule_relationship") and int(trip.schedule_relationship) == 3:
            cancelled += 1  # CANCELED in current GTFS-RT enum
        ts = int(getattr(update, "timestamp", 0))
        if ts:
            timestamps.append(ts)
        stops_per_trip.append(len(update.stop_time_update))
        for stop in update.stop_time_update:
            stop_updates += 1
            arrival = stop.arrival if stop.HasField("arrival") else None
            departure = stop.departure if stop.HasField("departure") else None
            if any(evt and evt.HasField("time") for evt in (arrival, departure)):
                with_absolute_time += 1
            if any(evt and evt.HasField("delay") for evt in (arrival, departure)):
                with_delay += 1
    trip_updates = len(stops_per_trip)
    return {
        "source": "SUMOB_GTFS_RT_TRIP_UPDATES_OFFICIAL",
        "bytes": byte_count,
        "entities": len(feed.entity),
        "tripUpdates": trip_updates,
        "withTripId": with_trip_id,
        "withRouteId": with_route_id,
        "distinctRoutes": len(route_ids),
        "topRouteCodes": [code for code, _ in route_ids.most_common(8)],
        "totalStopTimeUpdates": stop_updates,
        "stopsPerTripMedian": median(stops_per_trip) if trip_updates else 0,
        "stopsPerTripMax": max(stops_per_trip, default=0),
        "stopUpdatesWithAbsoluteTime": with_absolute_time,
        "stopUpdatesWithDelay": with_delay,
        "cancelledTrips": cancelled,
        "headerAgeSeconds": now - age if age else None,
        "tripTimestampAgeMedianSeconds": round(median(now - t for t in timestamps))
            if timestamps else None,
        "note": "Atraso do próximo ponto não prova ETA para todas as paradas; "
                "verifique correspondência trip_id/route_id/stop_sequence com GTFS estático."
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--file", type=Path, help="Protobuf salvo localmente")
    group.add_argument("--url", help="URL pública oficial (evite em logs)")
    args = parser.parse_args()
    try:
        from google.transit import gtfs_realtime_pb2
    except ImportError:
        print("DEPENDENCIA_AUSENTE: py -m pip install gtfs-realtime-bindings",
              file=sys.stderr)
        return 2
    try:
        if args.file:
            if not args.file.is_file() or args.file.stat().st_size > MAX_BYTES:
                raise ValueError("Arquivo não encontrado ou maior que 8 MiB")
            raw = args.file.read_bytes()
        else:
            url = args.url or os.environ.get("SUMOB_TRIP_UPDATES_URL", "")
            if not url:
                raise ValueError("Configure SUMOB_TRIP_UPDATES_URL ou use --file")
            raw = get_feed_bytes(url)
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(raw)
        if not feed.header.gtfs_realtime_version:
            raise ValueError("Feed não possui versão GTFS-Realtime")
        print(json.dumps(summarize(feed, len(raw)), indent=2, ensure_ascii=False))
        print("SUMOB_TRIP_UPDATES_PROBE_OK")
        return 0
    except (ValueError, RuntimeError) as err:
        print("SUMOB_TRIP_UPDATES_PROBE_FAILED:", str(err), file=sys.stderr)
    except Exception:
        print("SUMOB_TRIP_UPDATES_PROBE_FAILED: resposta protobuf inválida",
              file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
