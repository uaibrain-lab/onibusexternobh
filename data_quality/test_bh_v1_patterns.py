"""Synthetic municipal variant catalog, no fabricated public departure claims."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from data_quality.bh_v1_patterns import audit_patterns


class PatternGateTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.route = {'id': 'R1', 'code': 'TEST', 'patterns': [], 'shapes': ['SH1']}
        self.pattern = {'id': '', 'route': 'R1', 'shape': 'SH1', 'direction': '0',
                        'headsign': 'Centro', 'stops': ['S1', 'S2'], 'tripCount': 3}
        self.pattern['id'] = self.identifier(self.pattern)
        self.route['patterns'] = [self.pattern['id']]
        self.payload = {
            'manifest.json': {'uniqueStopPatterns': 1, 'trips': 3, 'shapes': 1},
            'routes.json': [self.route], 'patterns.json': [self.pattern],
            'stops.json': {'S1': ['A', -19.9, -43.9], 'S2': ['B', -19.91, -43.91]},
            'shapes.json': {'SH1': [[-19.9, -43.9], [-19.91, -43.91]]},
        }
        self.save()

    @staticmethod
    def identifier(p):
        key = (p['route'], p['shape'], p['direction'], tuple(p['stops']))
        return hashlib.sha256(repr(key).encode()).hexdigest()[:20]

    def save(self):
        for filename, obj in self.payload.items():
            (self.root / filename).write_text(json.dumps(obj), encoding='utf8')

    def check(self):
        self.save()
        return audit_patterns(self.root)

    def test_valid(self):
        r = self.check()
        self.assertEqual(r['errors'], [])
        self.assertEqual(r['routesWithVariants'], 1)
        self.assertEqual(r['tripCount'], 3)

    def test_broken_pattern_id(self):
        self.pattern['id'] = 'wrong'
        self.route['patterns'] = ['wrong']
        self.assertIn('pattern_identity_mismatch', self.check()['errors'])

    def test_broken_line_reference(self):
        self.pattern['route'] = 'OTHER'
        self.assertIn('orphan_pattern_route', self.check()['errors'])

    def test_missing_stop(self):
        self.pattern['stops'][1] = 'BAD'
        self.assertIn('pattern_missing_or_unknown_stops', self.check()['errors'])

    def test_mismatch_trip_count(self):
        self.pattern['tripCount'] = 4
        self.assertIn('pattern_trip_total_mismatch', self.check()['errors'])

    def test_invalid_direction(self):
        self.pattern['direction'] = '4'
        self.assertIn('invalid_pattern_direction', self.check()['errors'])

    def test_route_pattern_links_mismatch(self):
        self.route['patterns'] = []
        self.assertIn('route_patterns_inconsistent', self.check()['errors'])

    def test_route_shapes_mismatch(self):
        self.route['shapes'] = []
        self.assertIn('route_shapes_inconsistent', self.check()['errors'])

    def test_invalid_polyline(self):
        self.payload['shapes.json']['SH1'][1] = [float('nan'), -43.91]
        self.assertIn('shape_geometry_invalid', self.check()['errors'])

    def test_missing_shape(self):
        self.payload['shapes.json'] = {}
        self.assertIn('orphan_pattern_shape', self.check()['errors'])

    def test_duplicate_pattern(self):
        self.payload['patterns.json'].append(copy.deepcopy(self.pattern))
        self.assertIn('duplicate_or_missing_pattern_id', self.check()['errors'])

    def test_missing_patterns_file(self):
        self.save()
        (self.root / 'patterns.json').unlink()
        self.assertIn('pattern_catalog_unreadable_or_invalid', audit_patterns(self.root)['errors'])


if __name__ == '__main__':
    unittest.main()
