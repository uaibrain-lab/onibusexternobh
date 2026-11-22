"""Offline unit tests for SUMOB TripUpdates one-shot reader. No network/pip needed."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/probe_sumob_trip_updates.py"
spec = importlib.util.spec_from_file_location("probe_sumob_trip_updates", SCRIPT)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Node:
    def __init__(self, **fields):
        self.__dict__.update(fields)

    def HasField(self, key):
        return key in self.__dict__ and self.__dict__[key] is not None


class ProbeTests(unittest.TestCase):
    def test_known_fake_trip_updates(self):
        t1 = Node(
            trip=Node(route_id="5102", trip_id="trip-1"),
            timestamp=1_700_000_000,
            stop_time_update=[
                Node(arrival=Node(delay=75)),
                Node(departure=Node(time=1_700_000_090))
            ])
        t2 = Node(
            trip=Node(route_id="9209", trip_id="trip-2",
                      schedule_relationship=3),
            timestamp=1_700_000_005,
            stop_time_update=[Node(arrival=Node(delay=-30))])
        feed = Node(
            header=Node(gtfs_realtime_version="2.0", timestamp=1_700_000_002),
            entity=[Node(trip_update=t1), Node(trip_update=t2),
                    Node(vehicle=Node(id="bus"))])
        result = probe.summarize(feed, 234, now=1_700_000_010)
        self.assertEqual(result["entities"], 3)
        self.assertEqual(result["tripUpdates"], 2)
        self.assertEqual(result["withTripId"], 2)
        self.assertEqual(result["totalStopTimeUpdates"], 3)
        self.assertEqual(result["stopsPerTripMedian"], 1.5)
        self.assertEqual(result["stopUpdatesWithAbsoluteTime"], 1)
        self.assertEqual(result["stopUpdatesWithDelay"], 2)
        self.assertEqual(result["cancelledTrips"], 1)
        self.assertEqual(result["headerAgeSeconds"], 8)
        self.assertEqual(result["distinctRoutes"], 2)

    def test_rejects_wrong_origin_before_contacting_network(self):
        for url in (
            "https://moovitapp.com/api/route",
            "https://realtime4.mobilibus.com.evil.com/web/4ch6j/trip-updates?accesskey=abc",
            "https://realtime4.mobilibus.com/other/trip-updates?accesskey=abc",
            "file:///etc/passwd",
            "https://realtime4.mobilibus.com/web/4ch6j/trip-updates",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                probe.get_feed_bytes(url)

    def test_zero_predictions_does_not_imply_no_bus(self):
        feed = Node(header=Node(timestamp=0), entity=[
            Node(trip_update=Node(
                trip=Node(route_id="5102", trip_id="t"),
                stop_time_update=[]
            ))
        ])
        result = probe.summarize(feed, 10, now=1_700_000_010)
        self.assertEqual(result["tripUpdates"], 1)
        self.assertEqual(result["totalStopTimeUpdates"], 0)
        self.assertEqual(result["stopUpdatesWithAbsoluteTime"], 0)
        self.assertEqual(result["stopUpdatesWithDelay"], 0)


if __name__ == "__main__":
    unittest.main()
