"""P11: non-blocking GPS fetches and stop-aware geometry selection."""
import pathlib
import threading
import unittest

from transit.engine import TransitEngine

ROOT = pathlib.Path(__file__).resolve().parents[1]


class ResilienceP11Tests(unittest.TestCase):
    def test_slow_pbh_does_not_block_another_passenger(self):
        started=threading.Event()
        release=threading.Event()
        failures=[]

        def slow_fetch(url):
            if url.endswith('param=D'):
                started.set()
                if not release.wait(4):
                    failures.append('collector timed out waiting in test')
            return []

        engine=TransitEngine(ROOT,fetcher=slow_fetch)
        polling=threading.Thread(target=lambda:engine.refresh(force=True),daemon=True)
        polling.start()
        try:
            self.assertTrue(started.wait(2), 'the simulated remote request did not start')
            returned=threading.Event()
            query=threading.Thread(target=lambda:(engine.fleet('5102'),returned.set()),daemon=True)
            query.start()
            self.assertTrue(returned.wait(1), 'a second user was blocked by PBH download')
            query.join(1)
            self.assertFalse(query.is_alive())
            self.assertTrue(engine.refresh_in_progress)
        finally:
            release.set()
            polling.join(3)
        self.assertFalse(polling.is_alive())
        self.assertFalse(engine.refresh_in_progress)
        self.assertEqual(failures,[])

    def test_parallel_refresh_cannot_start_duplicate_download(self):
        started=threading.Event()
        release=threading.Event()
        calls=[]

        def fetch(url):
            calls.append(url)
            if url.endswith('param=D'):
                started.set()
                release.wait(3)
            return []

        engine=TransitEngine(ROOT,fetcher=fetch)
        worker=threading.Thread(target=lambda:engine.refresh(force=True),daemon=True)
        worker.start()
        try:
            self.assertTrue(started.wait(2))
            second=threading.Thread(target=lambda:engine.refresh(force=True),daemon=True)
            second.start()
            second.join(1)
            self.assertFalse(second.is_alive(), 'duplicate refresh waited on HTTP')
            self.assertEqual(calls.count('https://temporeal.pbh.gov.br/?param=D'),1)
        finally:
            release.set()
            worker.join(3)
        self.assertFalse(worker.is_alive())

    def test_geometry_can_mark_patterns_at_a_specific_stop(self):
        engine=TransitEngine(ROOT,fetcher=lambda _:[])
        stop='14791407'
        result=engine.route_geometry('5102',stop_id=stop)
        self.assertTrue(result and result['patterns'])
        self.assertTrue(any(p['servesStop'] for p in result['patterns']))
        self.assertTrue(all(p['servesStop']==(stop in engine.pattern_by_id[p['id']]['stops'])
                            for p in result['patterns']))
        self.assertTrue(all('direction' in p for p in result['patterns']))
        general=engine.route_geometry('5102')
        self.assertTrue(all('servesStop' not in p for p in general['patterns']))

    def test_unknown_stop_never_claimed_as_served(self):
        engine=TransitEngine(ROOT,fetcher=lambda _:[])
        result=engine.route_geometry('5102',stop_id='NOT_A_GTFS_STOP')
        self.assertTrue(all(p['servesStop'] is False for p in result['patterns']))


if __name__ == '__main__':
    unittest.main()
