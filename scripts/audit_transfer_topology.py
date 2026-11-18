#!/usr/bin/env python3
"""Read-only transfer topology audit of Externo BH's exact GTFS catalog.

No route feasibility claims: no timetable, direction, OSM street or ETA.
No user coordinates, no network, no paid service and no data persistence.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import gzip
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MAX_STOPS = 50000
MAX_ROUTES_BYTES = 25 * 1024 * 1024
MAX_GZIP_BYTES = 25 * 1024 * 1024
MAX_STOPS_RAW = 25 * 1024 * 1024


def read_catalog(catalog: Path):
    route_file = catalog / "routing-stop-routes.json"
    stop_file = catalog / "scan/stops.json.gz"
    if not route_file.is_file() or not stop_file.is_file():
        raise ValueError("Catálogo completo ausente")
    if (route_file.stat().st_size > MAX_ROUTES_BYTES or
            stop_file.stat().st_size > MAX_GZIP_BYTES):
        raise ValueError("Catálogo excedeu o limite")
    routes = json.loads(route_file.read_text(encoding="utf-8"))
    with gzip.open(stop_file, "rb") as stream:
        data = stream.read(MAX_STOPS_RAW + 1)
    if len(data) > MAX_STOPS_RAW:
        raise ValueError("Lista de pontos descompactada excedeu o limite")
    stops = json.loads(data)
    if (not isinstance(routes, dict) or not isinstance(stops, list)
            or len(stops) > MAX_STOPS):
        raise ValueError("Formato do catálogo inválido")
    return stops, routes


def distance_m(a, b):
    lat1, lon1 = a
    lat2, lon2 = b
    dy = (lat2 - lat1) * 111195
    dx = (lon2 - lon1) * 111195 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def audit(stops, routes, pairs, radius=450):
    if (not isinstance(radius, (int, float)) or not math.isfinite(radius)
            or not 1 <= radius <= 1000):
        raise ValueError("Raio fora do limite de 1 a 1000 m")
    if (not isinstance(pairs, (list, tuple)) or not 1 <= len(pairs) <= 20):
        raise ValueError("Forneça entre 1 e 20 combinações")
    if any(not isinstance(pair, (list, tuple)) or len(pair) != 2 or
           any(not isinstance(code, str) or
               not re.fullmatch(r"[A-Z0-9]{1,12}", code) for code in pair)
           for pair in pairs):
        raise ValueError("Códigos de linha inválidos")
    targets = {code for pair in pairs for code in pair}
    if not isinstance(routes, dict) or not isinstance(stops, list):
        raise ValueError("Formato do catálogo inválido")
    by_code = defaultdict(dict)
    for stop in stops:
        if not isinstance(stop, list) or len(stop) < 4:
            raise ValueError("Parada do scan inválida")
        sid = str(stop[0])
        try:
            lat, lon = float(stop[2]), float(stop[3])
        except (TypeError, ValueError) as exc:
            raise ValueError("Coordenadas de parada inválidas") from exc
        if not (math.isfinite(lat) and math.isfinite(lon)):
            raise ValueError("Coordenadas de parada não finitas")
        if not (-21 <= lat <= -18 and -46 <= lon <= -42):
            continue
        codes = routes.get(sid, [])
        if not isinstance(codes, list) or any(not isinstance(code, str) for code in codes):
            raise ValueError("Linhas associadas à parada inválidas")
        for code in codes:
            if code in targets:
                previous = by_code[code].get(sid)
                if previous is not None and previous != (lat, lon):
                    raise ValueError("Parada duplicada com coordenadas conflitantes")
                by_code[code][sid] = (lat, lon)
    result = []
    for code_a, code_b in pairs:
        aa, bb = by_code[code_a], by_code[code_b]
        shared = set(aa).intersection(bb)
        cell_deg = .004
        index = defaultdict(list)
        for sid, pos in bb.items():
            if sid in shared:
                continue
            index[(math.floor(pos[0] / cell_deg),
                   math.floor(pos[1] / cell_deg))].append((sid, pos))
        nearby = 0
        closest = None
        reach = int(math.ceil(radius / 390)) + 1
        for sid, point in aa.items():
            if sid in shared:
                continue
            ix, iy = math.floor(point[0] / cell_deg), math.floor(point[1] / cell_deg)
            for dx in range(-reach, reach + 1):
                for dy in range(-reach, reach + 1):
                    for other, coord in index.get((ix + dx, iy + dy), ()):
                        d = distance_m(point, coord)
                        if d <= radius:
                            nearby += 1
                            if closest is None or d < closest:
                                closest = d
        result.append({
            "lines": f"{code_a}+{code_b}",
            "lineAStopIds": len(aa), "lineBStopIds": len(bb),
            "sharedStopIds": len(shared),
            "distinctStopPairsWithinRadius": nearby,
            "shortestDistinctStopDistanceMeters": (
                round(closest) if closest is not None else None),
            "radiusMeters": radius,
            "note": "Topology only: no direction, GTFS service times, OSM street crossing or boarding feasibility verified."
        })
    return {"audit": "TRANSFER_TOPOLOGY_ONLY_NO_ETA", "pairs": result}


def parse_pairs(raw):
    result = []
    for token in raw.split(","):
        parts = token.strip().upper().split("+")
        if (len(parts) != 2 or
                any(not re.fullmatch(r"[A-Z0-9]{1,12}", x) for x in parts)):
            raise ValueError("Use --pairs=9106+5106,9209+51")
        result.append(tuple(parts))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=ROOT / "catalog")
    parser.add_argument("--pairs", default="9106+5106,9209+51,9209+67")
    parser.add_argument("--radius", type=float, default=450)
    args = parser.parse_args()
    try:
        print(json.dumps(
            audit(*read_catalog(args.catalog), parse_pairs(args.pairs), args.radius),
            ensure_ascii=False, indent=2))
        print("TRANSFER_TOPOLOGY_AUDIT_OK")
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        parser.exit(2, "TRANSFER_TOPOLOGY_AUDIT_FAILED: " + str(exc) + "\n")


if __name__ == "__main__":
    main()
