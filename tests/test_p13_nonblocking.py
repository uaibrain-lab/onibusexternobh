"""P13: responsive first request and one-time timetable publication."""
import datetime as dt
import gzip
import json
import pathlib
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from transit.engine import TransitEngine
from transit.timetable import Timetable

ROOT=pathlib.Path(__file__).resolve().parents[1]


class BackgroundP13Tests(unittest.TestCase):
    def test_first_passenger_can_read_snapshot_during_slow_gps(self):
        started=threading.Event()
        release=threading.Event()

        def slow(url):
            if url.endswith('param=D'):
                started.set()
                release.wait(3)
            return []

        engine=TransitEngine(ROOT,fetcher=slow)
        try:
            self.assertTrue(engine.refresh_in_background())
            self.assertTrue(started.wait(2))
            self.assertFalse(engine.refresh_in_background())
            before=time.monotonic()
            fleet=engine.fleet('5102',poll=False)
            status=engine.status(poll=False)
            elapsed=time.monotonic()-before
            self.assertLess(elapsed,0.7)
            self.assertEqual(fleet['count'],0)
            self.assertEqual(status['vehiclesKnown'],0)
        finally:
            release.set()
        end=time.monotonic()+3
        while engine._background_refresh_queued and time.monotonic()<end:
            time.sleep(.02)
        self.assertFalse(engine._background_refresh_queued)
        self.assertFalse(engine.refresh_in_progress)

    def test_timetable_loaded_once_with_many_parallel_requests(self):
        with tempfile.TemporaryDirectory() as td:
            folder=pathlib.Path(td)
            (folder/'timetable-calendar.json').write_text(json.dumps({
              'services':{},'exceptions':{}}),encoding='utf8')
            with gzip.open(folder/'timetable.json.gz','wt',encoding='utf8') as f:
                f.write(json.dumps(['point',[['51','S','Centro',[3600]]]])+'\n')
            timetable=Timetable(folder)
            counter=[0]
            guard=threading.Lock()
            real_open=gzip.open

            def counted(*args,**kwargs):
                with guard:counter[0]+=1
                return real_open(*args,**kwargs)

            with patch('transit.timetable.gzip.open',side_effect=counted):
                with ThreadPoolExecutor(max_workers=12) as executor:
                    list(executor.map(lambda _:timetable._load(),range(24)))
            self.assertEqual(counter[0],1)
            self.assertIsNone(timetable.error)
            self.assertEqual(timetable.stops['point'][0][0],'51')


if __name__=='__main__':
    unittest.main()
