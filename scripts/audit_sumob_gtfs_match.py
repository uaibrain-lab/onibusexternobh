#!/usr/bin/env python3
"""One-shot SUMOB TripUpdates-to-static-GTFS compatibility audit.

Reads one official TripUpdates response and a local official static GTFS ZIP.
Reports aggregate compatibility only. No individual IDs, positions or feeds
are written to disk. Never deploys or updates Externo BH.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import statistics
import sys
import time
import zipfile

MAX_GTFS_ZIP_BYTES = 200 * 1024 * 1024
MAX_GTFS_RAW_BYTES = 2 * 1024 * 1024 * 1024
MAX_TRIP_UPDATES = 25000


def rows(z, name, names):
    with z.open(names[name]) as stream:
        yield from csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig", newline=""))


def static_match(feed, archive: Path, *, now: int | None = None):
    now = int(time.time()) if now is None else now
    archive = Path(archive)
    if not archive.is_file() or archive.stat().st_size > MAX_GTFS_ZIP_BYTES:
        raise ValueError("GTFS ausente ou arquivo acima de 200 MiB")
    updates = [entity.trip_update for entity in feed.entity if entity.HasField("trip_update")]
    if len(updates) > MAX_TRIP_UPDATES:
        raise ValueError("Mais atualizações do que o limite de auditoria")
    ids = {u.trip.trip_id for u in updates if u.trip.trip_id}
    with archive.open("rb") as stream:
        archive_sha = hashlib.file_digest(stream, "sha256").hexdigest()
    catalog_source = Path(__file__).resolve().parents[1] / "catalog/source-gtfs.sha256"
    expected_sha = catalog_source.read_text(encoding="utf-8").strip().split()[0] if catalog_source.is_file() else None
    same_catalog = archive_sha == expected_sha if expected_sha else None
    with zipfile.ZipFile(archive) as z:
        infos = [x for x in z.infolist() if not x.is_dir()]
        if sum(x.file_size for x in infos) > MAX_GTFS_RAW_BYTES:
            raise ValueError("GTFS descompactado excede limite seguro")
        names = {}
        for info in infos:
            base = info.filename.rsplit("/", 1)[-1]
            if base in ("routes.txt", "trips.txt", "stop_times.txt"):
                if base in names:
                    raise ValueError("Arquivo GTFS duplicado")
                names[base] = info.filename
        if set(names) != {"routes.txt", "trips.txt", "stop_times.txt"}:
            raise ValueError("GTFS sem routes.txt, trips.txt ou stop_times.txt")
        routes = {r["route_id"]: (r.get("route_short_name") or "").strip().upper()
                  for r in rows(z, "routes.txt", names)}
        static = {}
        for trip in rows(z, "trips.txt", names):
            tid = trip.get("trip_id", "")
            if tid in ids:
                static[tid] = (trip.get("route_id", ""),
                               trip.get("direction_id", ""),
                               trip.get("service_id", ""))
        # Streaming scan: keep only stop keys on trips referenced in the RT feed.
        matched_seqs = {}
        matched_ids = {}
        stop_counts = Counter()
        for stop in rows(z, "stop_times.txt", names):
            tid = stop.get("trip_id", "")
            if tid not in static:
                continue
            seq = (stop.get("stop_sequence") or "").strip()
            sid = (stop.get("stop_id") or "").strip()
            if seq:
                matched_seqs[(tid, seq)] = sid
            if sid:
                matched_ids[(tid, sid)] = True
                stop_counts[(tid, sid)] += 1
        counts = Counter()
        delays = []
        for update in updates:
            trip = update.trip
            tid = trip.trip_id
            if trip.start_date:
                counts["withStartDate"] += 1
            if trip.start_time:
                counts["withStartTime"] += 1
            if not tid or tid not in static:
                counts["unmatchedTripId"] += 1
                continue
            counts["matchedTripId"] += 1
            rid, did, _ = static[tid]
            public = routes.get(rid, "")
            rtid = (trip.route_id or "").strip().upper()
            if rtid and rtid == rid.upper():
                counts["routeMatchesStaticId"] += 1
            elif rtid and public and rtid == public:
                counts["routeMatchesPublicCode"] += 1
            elif rtid:
                counts["routeMismatch"] += 1
            else:
                counts["missingRouteId"] += 1
            if trip.HasField("direction_id") and did and str(trip.direction_id) != did:
                counts["directionMismatch"] += 1
            elif trip.HasField("direction_id") and did:
                counts["directionMatches"] += 1
            for stop in update.stop_time_update:
                counts["examinedStopTimeUpdates"] += 1
                has_seq = stop.HasField("stop_sequence")
                sid = (stop.stop_id or "").strip()
                if has_seq:
                    counts["withStopSequence"] += 1
                if sid:
                    counts["withStopId"] += 1
                if not has_seq and not sid:
                    counts["stopMissingKey"] += 1
                    continue
                found = True
                if has_seq:
                    found = (tid, str(stop.stop_sequence)) in matched_seqs
                    if found and sid:
                        found = matched_seqs[(tid, str(stop.stop_sequence))] == sid
                elif sid:
                    found = (tid, sid) in matched_ids and stop_counts[(tid, sid)] == 1
                if found:
                    counts["matchedStopKey"] += 1
                else:
                    counts["unmatchedStopKey"] += 1
                events = [e for e in (
                    stop.arrival if stop.HasField("arrival") else None,
                    stop.departure if stop.HasField("departure") else None
                ) if e is not None]
                values = [e.delay for e in events if e.HasField("delay")]
                if values:
                    delays.append(values[0])
                    counts["updatesWithDelayOnMatchedTrip"] += 1
        head_ts = int(getattr(feed.header, "timestamp", 0))
        return {
            "audit": "SUMOB_REALTIME_STATIC_GTFS_ID_COMPATIBILITY_ONLY",
            "matchesAppCatalogSourceGTFS": same_catalog,
            "rtTripUpdates": len(updates),
            "staticTripsMatching": len(static),
            "matchedTripId": counts["matchedTripId"],
            "unmatchedTripId": counts["unmatchedTripId"],
            "routeMatchesStaticId": counts["routeMatchesStaticId"],
            "routeMatchesPublicCode": counts["routeMatchesPublicCode"],
            "routeMismatch": counts["routeMismatch"],
            "missingRouteId": counts["missingRouteId"],
            "directionMatches": counts["directionMatches"],
            "directionMismatch": counts["directionMismatch"],
            "withStartDate": counts["withStartDate"],
            "withStartTime": counts["withStartTime"],
            "examinedStopTimeUpdates": counts["examinedStopTimeUpdates"],
            "withStopSequence": counts["withStopSequence"],
            "withStopId": counts["withStopId"],
            "matchedStopKey": counts["matchedStopKey"],
            "unmatchedStopKey": counts["unmatchedStopKey"],
            "stopMissingKey": counts["stopMissingKey"],
            "delayMedianSeconds": statistics.median(delays) if delays else None,
            "delayMinSeconds": min(delays) if delays else None,
            "delayMaxSeconds": max(delays) if delays else None,
            "feedHeaderAgeSeconds": now - head_ts if head_ts else None,
            "warnings": [
                "Correspondência de IDs não confirma instância, calendário ou serviço ativo.",
                "Se matchesAppCatalogSourceGTFS=false, o ZIP oficial não é a mesma versão do catálogo atual.",
                "Na ausência de timestamp por viagem, o timestamp global não prova atualização individual.",
                "Uma parada com atraso não equivale a ETA garantido para todas as próximas.",
                "Nenhum identificador individual nem posição foi armazenado ou divulgado."
            ]
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gtfs", required=True, type=Path,
                        help="Arquivo ZIP GTFS estático oficial já baixado")
    parser.add_argument("--file", type=Path,
                        help="Arquivo GTFS-RT protobuf local, se houver")
    args = parser.parse_args()
    try:
        from google.transit import gtfs_realtime_pb2
        from probe_sumob_trip_updates import get_feed_bytes, MAX_BYTES
        if args.file:
            if not args.file.is_file() or args.file.stat().st_size > MAX_BYTES:
                raise ValueError("Arquivo GTFS-RT ausente ou maior que 8 MiB")
            body = args.file.read_bytes()
        else:
            url = os.environ.get("SUMOB_TRIP_UPDATES_URL")
            if not url:
                raise ValueError("Configure SUMOB_TRIP_UPDATES_URL")
            body = get_feed_bytes(url)
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(body)
        if not feed.header.gtfs_realtime_version:
            raise ValueError("Versão inválida do feed")
        print(json.dumps(static_match(feed, args.gtfs), indent=2, ensure_ascii=False))
        print("SUMOB_STATIC_GTFS_MATCH_AUDIT_OK")
        return 0
    except (ValueError, OSError, zipfile.BadZipFile, KeyError) as exc:
        print("SUMOB_STATIC_GTFS_MATCH_AUDIT_FAILED:", type(exc).__name__, file=sys.stderr)
    except ImportError:
        print("DEPENDENCIA_AUSENTE: py -m pip install gtfs-realtime-bindings", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
