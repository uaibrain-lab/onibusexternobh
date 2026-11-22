#!/usr/bin/env python3
"""Build bounded, per-stop exact GTFS trip/sequence times for SUMOB ETA delays.

This is a *new* optional static index. It does not replace existing timetables.
One stream through 6M+ GTFS stop_times rows; 256 temporary bucket files keep
peak memory bounded. Output shards are gzip JSON used only when a passenger
selects a municipal stop. No GPS coordinates or realtime data are persisted.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
from pathlib import Path
import tempfile
import zipfile

from scripts.build_static_arrivals import BUCKETS, bucket_id, compressed_json

MAX_ROWS = 9_000_000
MAX_TRIPS = 300_000
MAX_UNCOMPRESSED = 2_000_000_000
MAX_SHARD_BYTES = 4_000_000


def seconds(value):
    if not isinstance(value, str):
        return None
    parts = value.strip().split(":")
    if len(parts) != 3 or not all(part.isdecimal() for part in parts):
        return None
    h, m, s = map(int, parts)
    return h * 3600 + m * 60 + s if h < 48 and m < 60 and s < 60 else None


def build(archive, catalog, output, *, min_rows=1000):
    archive, catalog, output = Path(archive), Path(catalog), Path(output)
    manifest = json.loads((catalog / "manifest.json").read_text("utf-8"))
    with zipfile.ZipFile(archive) as z:
        files = [i for i in z.infolist() if not i.is_dir()]
        if sum(info.file_size for info in files) > MAX_UNCOMPRESSED:
            raise ValueError("Official GTFS uncompressed size exceeded limit")
        names = {}
        for info in files:
            base = info.filename.rsplit("/", 1)[-1]
            if base in ("trips.txt", "stop_times.txt"):
                if base in names:
                    raise ValueError("GTFS has duplicate required tables")
                names[base] = info.filename
        if set(names) != {"trips.txt", "stop_times.txt"}:
            raise ValueError("GTFS missing trips or stop_times")

        def rows(name):
            with z.open(names[name]) as binary:
                yield from csv.DictReader(io.TextIOWrapper(binary,
                    encoding="utf-8-sig", newline=""))

        trips = {}
        for row in rows("trips.txt"):
            tid, rid, service = (
                str(row.get(key) or "").strip()
                for key in ("trip_id", "route_id", "service_id")
            )
            if not tid or not rid or not service or tid in trips:
                raise ValueError("Missing or duplicate trip descriptor")
            trips[tid] = (rid, service)
            if len(trips) > MAX_TRIPS:
                raise ValueError("Too many GTFS trips")

        first = {}
        counts = 0
        with tempfile.TemporaryDirectory(prefix="sumob-rt-trips-") as tmp:
            root = Path(tmp)
            handles = [(root / f"{n:02x}.jsonl").open("w", encoding="utf-8")
                       for n in range(BUCKETS)]
            try:
                for row in rows("stop_times.txt"):
                    tid = str(row.get("trip_id") or "").strip()
                    sid = str(row.get("stop_id") or "").strip()
                    meta = trips.get(tid)
                    arr = seconds(row.get("arrival_time") or row.get("departure_time"))
                    dep = seconds(row.get("departure_time") or row.get("arrival_time"))
                    try:
                        seq = int(row.get("stop_sequence") or "")
                    except (TypeError, ValueError):
                        continue
                    if not sid or not meta or arr is None or dep is None or seq < 0:
                        continue
                    if dep < arr:
                        continue
                    prev = first.get(tid)
                    if prev is None or seq < prev[0]:
                        first[tid] = (seq, dep)
                    # [stop_id,trip_id,route_id,service_id,sequence,arrival_sec]
                    record = [sid, tid, meta[0], meta[1], seq, arr]
                    handles[int(bucket_id(sid), 16)].write(
                        json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n")
                    counts += 1
                    if counts > MAX_ROWS:
                        raise ValueError("Too many stop-times")
            finally:
                for handle in handles:
                    handle.close()

            if counts < min_rows:
                raise ValueError("GTFS lacks enough stop time rows")
            output.mkdir(parents=True, exist_ok=True)
            sizes = {}
            distinct = 0
            for n in range(BUCKETS):
                file = root / f"{n:02x}.jsonl"
                grouped = {}
                with file.open("r", encoding="utf-8") as stream:
                    for line in stream:
                        stop, trip, route, service, seq, arr = json.loads(line)
                        start = first.get(trip)
                        if start is None:
                            raise ValueError("Missing GTFS trip start")
                        grouped.setdefault(stop, []).append(
                            [trip, route, service, seq, arr, start[1]])
                distinct += len(grouped)
                for entries in grouped.values():
                    entries.sort(key=lambda e: (e[0], e[3]))
                name = f"{n:02x}.json.gz"
                payload = compressed_json(grouped)
                if len(payload) > MAX_SHARD_BYTES:
                    raise ValueError("Trip-ETA shard too large: " + name)
                (output / name).write_bytes(payload)
                sizes[name] = len(payload)
                file.unlink()
    index = {
        "schema": 1,
        "buckets": BUCKETS,
        "version": str(manifest["gtfsVersion"]),
        "validThrough": str(manifest["feedEndDate"]),
        "rows": counts,
        "trips": len(trips),
        "stops": distinct,
        "sizes": sizes,
        "source": "Official GTFS trip_id and stop_sequence; delay is never baked in",
    }
    (output / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, sort_keys=True,
                   separators=(",", ":")), encoding="utf-8")
    print("SUMOB_RT_TRIP_INDEX_OK", counts, "rows", distinct, "stops",
          sum(sizes.values()), "compressed_bytes", flush=True)
    return index


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 4:
        raise SystemExit(
            "usage: python -m scripts.build_trip_stop_eta_index OFFICIAL_GTFS_ZIP CATALOG OUTPUT")
    build(*sys.argv[1:4])
