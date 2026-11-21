#!/usr/bin/env python3
"""Offline P27 quality audit of the static pedestrian graph used by Externo BH.

No external API, no passenger coordinates, no mutation. Measures if official
GTFS stops can snap to the local OSM graph and how fragmented the graph is.
Results are aggregate numbers, not invented walking connections.
"""
from __future__ import annotations
from collections import Counter, defaultdict
import argparse
import gzip
import json
import math
from pathlib import Path
import statistics
import re

ROOT = Path(__file__).resolve().parents[1]
RAD = math.pi / 180


def haversine(a, b):
    dlat = (b[0] - a[0]) * RAD
    dlon = (b[1] - a[1]) * RAD
    h = math.sin(dlat / 2) ** 2 + math.cos(a[0] * RAD) * math.cos(b[0] * RAD) * math.sin(dlon / 2) ** 2
    return 12742000 * math.asin(min(1, math.sqrt(max(0, h))))


def audit(graph, stops, snap_limit=70, *, focus_routes=(), stop_routes=None,
          focus_stop_ids=()):
    nodes = graph["nodes"]
    edges = graph["edges"]
    if (graph.get("schema") != 1 or len(nodes) != graph.get("nodeCount")
            or len(edges) != graph.get("edgeCount")):
        raise ValueError("Grafo OSM inconsistente")
    if not 1 <= snap_limit <= 100:
        raise ValueError("Distância de snap inválida")
    # Only user-independent, public GTFS stop IDs are accepted here.
    if (not isinstance(focus_stop_ids, (list, tuple))
            or len(focus_stop_ids) > 20
            or any(not isinstance(sid, str) or
                   re.fullmatch(r"[A-Za-z0-9_-]{1,64}", sid) is None
                   for sid in focus_stop_ids)):
        raise ValueError("IDs públicos de parada inválidos")
    focused_stops = {
        sid: {"status": "notFoundInCatalog", "snapMeters": None,
              "componentGroup": None, "componentNodes": None}
        for sid in focus_stop_ids
    }
    focused_coords = {}
    parent = list(range(len(nodes)))
    size = [1] * len(nodes)
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for edge in edges:
        if len(edge) < 3:
            raise ValueError("Aresta OSM inválida")
        a, b, length = edge[:3]
        if not (0 <= a < len(nodes) and 0 <= b < len(nodes)
                and isinstance(length, (int, float)) and math.isfinite(length)
                and length > 0):
            raise ValueError("Aresta OSM inválida")
        a, b = find(a), find(b)
        if a != b:
            if size[a] < size[b]:
                a, b = b, a
            parent[b] = a
            size[a] += size[b]
    component_sizes = Counter(find(i) for i in range(len(nodes)))
    biggest = component_sizes.most_common(1)[0][0] if nodes else None
    # Stable component groups, not fabricated walk links or private positions.
    component_groups = {
        root: rank for rank, (root, _) in enumerate(
            sorted(component_sizes.items(), key=lambda item: (-item[1], item[0])),
            start=1)
    } if focused_stops else {}
    index = defaultdict(list)
    for idx, (lat, lon) in enumerate(nodes):
        index[(math.floor(lat * 1000), math.floor(lon * 1000))].append(idx)
    counts = Counter()
    focus_codes = tuple(dict.fromkeys(str(c).strip().upper() for c in focus_routes
                                     if str(c).strip()))
    focus = {code: Counter() for code in focus_codes}
    route_map = stop_routes or {}
    snap_distances = []
    for stop in stops:
        if not isinstance(stop, list) or len(stop) < 4:
            raise ValueError("Formato inválido de parada GTFS do scan")
        point = (float(stop[2]), float(stop[3]))
        sid = str(stop[0])
        if sid in focused_stops:
            if sid in focused_coords and focused_coords[sid] != point:
                raise ValueError("Parada pública duplicada com coordenadas divergentes")
            focused_coords[sid] = point
        belonging = [code for code in route_map.get(sid, [])
                     if code in focus]
        for code in belonging:
            focus[code]["total"] += 1
        lat, lon = math.floor(point[0] * 1000), math.floor(point[1] * 1000)
        nearest = None
        for x in range(lat - 1, lat + 2):
            for y in range(lon - 1, lon + 2):
                for idx in index.get((x, y), []):
                    distance = haversine(point, nodes[idx])
                    if distance <= snap_limit and (nearest is None or distance < nearest[1]):
                        nearest = (idx, distance)
        if nearest is None:
            if sid in focused_stops:
                focused_stops[sid] = {
                    "status": "unsnapped", "snapMeters": None,
                    "componentGroup": None, "componentNodes": None
                }
            counts["stopsUnsnapped"] += 1
            for code in belonging:
                focus[code]["unsnapped"] += 1
            continue
        counts["stopsSnapped"] += 1
        snap_distances.append(nearest[1])
        nearest_root = find(nearest[0])
        if sid in focused_stops:
            focused_stops[sid] = {
                "status": "largestComponent" if nearest_root == biggest else "otherComponent",
                "snapMeters": round(nearest[1]),
                "componentGroup": component_groups[nearest_root],
                "componentNodes": component_sizes[nearest_root]
            }
        if nearest_root == biggest:
            counts["stopsLargestComponent"] += 1
            for code in belonging:
                focus[code]["largestComponent"] += 1
        else:
            counts["stopsOtherComponents"] += 1
            for code in belonging:
                focus[code]["otherComponents"] += 1
    return {
        "diagnostic": "P27_OSM_PED_GRAPH_COVERAGE_AGGREGATE",
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
        "connectedComponents": len(component_sizes),
        "largestComponentNodes": component_sizes[biggest] if biggest is not None else 0,
        "largestComponentNodeSharePercent": round(100 * component_sizes[biggest] / len(nodes), 2)
            if nodes else 0,
        "gtfsStopsScanned": len(stops),
        "stopsSnapped": counts["stopsSnapped"],
        "stopsUnsnapped": counts["stopsUnsnapped"],
        "stopsLargestComponent": counts["stopsLargestComponent"],
        "stopsOtherComponents": counts["stopsOtherComponents"],
        "snapCoveragePercent": round(100 * counts["stopsSnapped"] / len(stops), 2)
            if stops else 0,
        "snapDistanceMedianMeters": round(statistics.median(snap_distances), 1)
            if snap_distances else None,
        "snapLimitMeters": snap_limit,
        "focusedStops": focused_stops,
        "focusedLines": {
            code: {
                "stops": data["total"],
                "largestComponent": data["largestComponent"],
                "otherComponents": data["otherComponents"],
                "unsnapped": data["unsnapped"],
                "snapCoveragePercent": round(
                    100 * (data["total"] - data["unsnapped"]) / data["total"], 2
                ) if data["total"] else None,
                "inMunicipalCatalog": data["total"] > 0
            } for code, data in focus.items()
        },
        "caution": "Snap por distância não comprova acesso pedonal ao ponto, estação ou plataforma."
    }


def load_json_gz(path: Path, limit=40_000_000):
    if not path.is_file() or path.stat().st_size > limit:
        raise ValueError("Arquivo comprimido OSM/GTFS inexistente ou muito grande")
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph", type=Path, default=ROOT / "catalog/walk/graph.json.gz")
    parser.add_argument("--stops", type=Path, default=ROOT / "catalog/scan/stops.json.gz")
    parser.add_argument("--route-stops", type=Path,
                        default=ROOT / "catalog/routing-stop-routes.json")
    parser.add_argument("--focus", default="9106,5106,9209,51,67,411C,511C",
                        help="Códigos públicos separados por vírgula; somente estatísticas")
    parser.add_argument("--focus-stops", default="",
                        help="Até 20 stop_id públicos GTFS; sem coordenadas de usuários")
    args = parser.parse_args()
    codes = [v.strip().upper() for v in args.focus.split(",") if v.strip()]
    if len(codes) > 20 or any(not v.isalnum() or len(v) > 12 for v in codes):
        raise ValueError("Códigos de linha inválidos")
    routes = json.loads(args.route_stops.read_text(encoding="utf-8"))
    if not isinstance(routes, dict):
        raise ValueError("Relação de paradas e linhas inválida")
    focused = args.focus_stops.split(",") if args.focus_stops else []
    stats = audit(load_json_gz(args.graph), load_json_gz(args.stops),
                  focus_routes=codes, stop_routes=routes,
                  focus_stop_ids=focused)
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print("P27_OSM_GRAPH_COVERAGE_OK")


if __name__ == "__main__":
    main()
