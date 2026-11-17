import datetime as dt
import pathlib
import tempfile
import unittest
from transit.engine import TransitEngine, BRT
from transit.timetable import Timetable

ROOT = pathlib.Path(__file__).resolve().parents[1]

class P3StopTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine=TransitEngine(ROOT,fetcher=lambda url:[])
        cls.t=dt.datetime(2026,11,17,7,0,0,tzinfo=BRT)

    def test_map_stops_campus_contains_nearby(self):
        result=self.engine.map_stops(-19.88,-43.98,-19.86,-43.95)
        self.assertGreater(result['total'],40)
        self.assertTrue(all(-19.88<=r['lat']<=-19.86 for r in result['items']))

    def test_nearby_stops_order_and_distance(self):
        items=self.engine.nearby_stops(-19.8695,-43.9675)['items']
        self.assertTrue(items)
        self.assertEqual([s['distanceM'] for s in items],sorted(s['distanceM'] for s in items))
        self.assertLess(items[0]['distanceM'],250)

    def test_nearby_rejects_bad_geo(self):
        with self.assertRaises(ValueError): self.engine.nearby_stops(150,-43)
        with self.assertRaises(ValueError): self.engine.map_stops(-20,100,-19,99)

    def test_stop_detail_lists_relevant_lines(self):
        detail=self.engine.stop_detail('14791407', self.t)
        codes={r['code'] for r in detail['routes']}
        self.assertIn('5102',codes)
        self.assertIn('9502',codes)
        self.assertEqual(detail['forecastSource'],'GTFS scheduled (not GPS)')
        self.assertIsNotNone(detail['routes'][0]['nextArrival'])
        self.assertEqual(detail['routes'][0]['nextArrival']['type'],'scheduled')
        self.assertTrue(detail['routes'][0]['nextArrival']['minutes']>=0)

    def test_schedule_expires_and_does_not_invent_bus(self):
        detail=self.engine.stop_detail('14791407',dt.datetime(2027,1,1,7,0,tzinfo=BRT))
        self.assertTrue(all(v['nextArrival'] is None for v in detail['routes']))

    def test_unknown_stop_does_not_make_up_lines(self):
        self.assertIsNone(self.engine.stop_detail('UNKNOWN',self.t))

    def test_no_timetable_falls_back_to_no_forecast(self):
        with tempfile.TemporaryDirectory() as td:
            t=Timetable(td)
            self.assertEqual(t.next_by_line('14791407',self.t),{})
            self.assertIsNotNone(t.error)

if __name__=='__main__':unittest.main()
