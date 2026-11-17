"""P8: multi-departure schedule with original safety guarantees."""
import datetime as dt
import pathlib
import unittest
from transit.engine import TransitEngine, BRT
ROOT = pathlib.Path(__file__).resolve().parents[1]

class MobileP8Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine=TransitEngine(ROOT,fetcher=lambda url:[])
        cls.now=dt.datetime(2026,11,17,7,0,tzinfo=BRT)

    def test_multiple_scheduled_departures_are_chronological(self):
        data=self.engine.timetable.next_by_line('14791407',self.now,max_per_line=3)
        self.assertTrue(data)
        self.assertTrue(any(r.get('following') for r in data.values()))
        for code,r in data.items():
            self.assertEqual(r['type'],'scheduled')
            self.assertLessEqual(len(r['following']),2)
            prior=dt.datetime.fromisoformat(r['at'])
            for later in r['following']:
                when=dt.datetime.fromisoformat(later['at'])
                self.assertGreaterEqual(when,prior)
                self.assertGreaterEqual(later['minutes'],0)
                prior=when

    def test_stop_detail_includes_additional_schedule(self):
        detail=self.engine.stop_detail('14791407',self.now)
        self.assertTrue(any(r['nextArrival'] and r['nextArrival']['type']=='scheduled' and 'following' in r['nextArrival'] for r in detail['routes']))

    def test_calendar_expired(self):
        after=dt.datetime(2027,1,3,10,0,tzinfo=BRT)
        self.assertEqual(self.engine.timetable.next_by_line('14791407',after),{})

    def test_last_trip_marker_is_boolean(self):
        data=self.engine.timetable.next_by_line('14791407',self.now)
        self.assertTrue(all(isinstance(r['lastTripToday'],bool) for r in data.values()))

if __name__=='__main__':unittest.main()
