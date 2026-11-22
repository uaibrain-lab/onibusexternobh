"""Read-only structural integrity gate for municipal BH line variants.

Verifies exactly the catalog fields consumed by the V1 browser. No route
planning, GPS, metropolitan transport or network access.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path


def audit_patterns(catalog):
    root = Path(catalog)
    report = {'status': 'blocked', 'errors': [], 'patternCount': 0,
              'tripCount': 0, 'shapeCount': 0, 'routesWithVariants': 0,
              'stopsReferenced': 0, 'scheduledNotRealtime': True}
    errors = report['errors']
    try:
        manifest = json.loads((root / 'manifest.json').read_text(encoding='utf8'))
        routes = json.loads((root / 'routes.json').read_text(encoding='utf8'))
        stops = json.loads((root / 'stops.json').read_text(encoding='utf8'))
        patterns = json.loads((root / 'patterns.json').read_text(encoding='utf8'))
        shapes = json.loads((root / 'shapes.json').read_text(encoding='utf8'))
        if (not isinstance(patterns, list) or not isinstance(routes, list) or
                not isinstance(stops, dict) or not isinstance(shapes, dict)):
            raise ValueError('invalid catalog JSON shape')
        route_map = {str(r['id']): r for r in routes}
        if len(route_map) != len(routes):
            errors.append('duplicate_route_id')
        report['patternCount'] = len(patterns)
        report['shapeCount'] = len(shapes)
        if len(patterns) != manifest.get('uniqueStopPatterns'):
            errors.append('pattern_count_mismatch')
        if len(shapes) != manifest.get('shapes'):
            errors.append('shape_count_mismatch')
        by_route = {}
        seen_ids = set()
        seen_stops = set()
        for p in patterns:
            pid = p['id']; rid = str(p['route']); sid = str(p.get('shape') or '')
            did = str(p.get('direction') or '')
            stop_ids = p['stops']
            if not isinstance(pid, str) or not pid or pid in seen_ids:
                errors.append('duplicate_or_missing_pattern_id')
            seen_ids.add(pid)
            if rid not in route_map:
                errors.append('orphan_pattern_route')
            if sid and sid not in shapes:
                errors.append('orphan_pattern_shape')
            if not isinstance(stop_ids, list) or len(stop_ids) < 2 or any(s not in stops for s in stop_ids):
                errors.append('pattern_missing_or_unknown_stops')
                continue
            seen_stops.update(stop_ids)
            if did not in ('', '0', '1'):
                errors.append('invalid_pattern_direction')
            if type(p.get('tripCount')) is not int or p['tripCount'] < 1:
                errors.append('invalid_pattern_trip_count')
            else:
                report['tripCount'] += p['tripCount']
            # The catalog builder uses the same key for immutable variant IDs.
            expected = hashlib.sha256(repr((rid, sid, did, tuple(stop_ids))).encode()).hexdigest()[:20]
            if pid != expected:
                errors.append('pattern_identity_mismatch')
            by_route.setdefault(rid, []).append(p)
        report['stopsReferenced'] = len(seen_stops)
        report['routesWithVariants'] = len(by_route)
        if report['tripCount'] != manifest.get('trips'):
            errors.append('pattern_trip_total_mismatch')
        for rid, route in route_map.items():
            actual = by_route.get(rid, [])
            expected_ids = [p['id'] for p in actual]
            registered_ids = route.get('patterns')
            if (not isinstance(registered_ids, list) or len(expected_ids) != len(registered_ids)
                    or set(expected_ids) != set(registered_ids)):
                errors.append('route_patterns_inconsistent')
            listed_shapes = route.get('shapes')
            used_shapes = {str(p.get('shape') or '') for p in actual} - {''}
            if not isinstance(listed_shapes, list) or used_shapes != set(listed_shapes) or len(listed_shapes) != len(used_shapes):
                errors.append('route_shapes_inconsistent')
        for sid, points in shapes.items():
            if (not isinstance(points, list) or len(points) < 2 or
                    any(not isinstance(pt, list) or len(pt) < 2 or
                        any(type(c) not in (int, float) or not math.isfinite(c) for c in pt[:2]) or
                        not -90 <= pt[0] <= 90 or not -180 <= pt[1] <= 180 for pt in points)):
                errors.append('shape_geometry_invalid')
                break
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        errors.append('pattern_catalog_unreadable_or_invalid')
    report['errors'] = sorted(set(errors))
    report['status'] = 'pass' if not report['errors'] else 'blocked'
    return report
