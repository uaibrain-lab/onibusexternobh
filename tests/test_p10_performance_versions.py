"""P10 regression checks: spatial queries and atomic GTFS activation."""
import datetime as dt
import json
import pathlib
import tempfile
import unittest
from transit.catalog_store import resolve_catalog, atomic_pointer, version_directory, REQUIRED
from scripts.update_gtfs import stage_and_activate, rollback
from transit.engine import TransitEngine
from transit.matcher import distance_m

ROOT=pathlib.Path(__file__).resolve().parents[1]

class SpatialTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine=TransitEngine(ROOT,fetcher=lambda url:[])

    def test_spatial_matches_brute_force_viewport(self):
        e=self.engine
        a,b,c,d=-19.885,-43.98,-19.855,-43.95
        expected={sid for sid,v in e.stops.items() if a<=v[1]<=c and b<=v[2]<=d}
        result=e.map_stops(a,b,c,d,limit=750)
        self.assertEqual(result['total'],len(expected))
        if not result['truncated']:
            self.assertEqual({v['id'] for v in result['items']},expected)

    def test_spatial_matches_nearby_brute_force(self):
        e=self.engine;lat,lng=-19.8695,-43.9675
        expected=sorted((distance_m((lat,lng),(v[1],v[2])),sid)
                        for sid,v in e.stops.items()
                        if distance_m((lat,lng),(v[1],v[2]))<=2500)
        res=e.nearby_stops(lat,lng)
        self.assertEqual(res['count'],len(expected))
        self.assertEqual([v['id'] for v in res['items']], [x[1] for x in expected[:15]])

    def test_map_limit_center_prioritization_is_deterministic(self):
        e=self.engine
        a,b,c,d=-20.1,-44.2,-19.5,-43.5
        one=e.map_stops(a,b,c,d,limit=8)
        two=e.map_stops(a,b,c,d,limit=8)
        self.assertEqual(one,two)
        self.assertEqual(len(one['items']),8)
        self.assertTrue(one['truncated'])
        mid=((a+c)/2,(b+d)/2)
        def sq(s): return (s[1]-mid[0])**2 + ((s[2]-mid[1])*.94)**2
        actual=max(sq((x['id'],x['lat'],x['lng'])) for x in one['items'])
        self.assertLessEqual(actual,min(sorted(sq(v) for v in e.stops.values())[8:9])+0.02)

    def test_reject_large_radius(self):
        with self.assertRaises(ValueError):
            self.engine.nearby_stops(-19.86,-43.9,radius_m=500000)

class VersionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=pathlib.Path(self.temp.name)
        self.catalog=self.root/'catalog';self.catalog.mkdir()
        self.candidate=self.root/'candidate';self.candidate.mkdir()
        self.archive=self.root/'archive.zip';self.archive.write_bytes(b'fake official GTFS archive for version ID test')
        for name in REQUIRED:
            (self.catalog/name).write_bytes(b'legacy')
            (self.candidate/name).write_bytes(b'new')
        (self.candidate/'manifest.json').write_text(json.dumps({'gtfsVersion':'20261117'}))

    def test_atomic_activation_and_legacy_rollback(self):
        self.assertEqual(resolve_catalog(self.catalog),self.catalog)
        result=stage_and_activate(self.candidate,self.catalog,self.archive)
        self.assertTrue(result['changed'])
        self.assertEqual(resolve_catalog(self.catalog).name,result['active'])
        self.assertEqual((self.catalog/'routes.json').read_bytes(),b'legacy')
        again=stage_and_activate(self.candidate,self.catalog,self.archive)
        self.assertFalse(again['changed'])
        rollback(self.catalog)
        self.assertEqual(resolve_catalog(self.catalog),self.catalog)

    def test_incomplete_version_refused_without_pointer_mutation(self):
        (self.candidate/'routes.json').unlink()
        with self.assertRaises(ValueError):
            stage_and_activate(self.candidate,self.catalog,self.archive)
        self.assertFalse((self.catalog/'active.json').exists())

    def test_traversal_rejected(self):
        for bad in ('../..','/tmp/e','',None):
            with self.assertRaises(ValueError):version_directory(self.catalog,bad)

    def test_invalid_pointer_rejected(self):
        (self.catalog/'active.json').write_text(json.dumps({'active':'../etc'}))
        with self.assertRaises(ValueError):resolve_catalog(self.catalog)

if __name__=='__main__':unittest.main()
