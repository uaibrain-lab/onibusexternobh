"""Offline, synthetic cross-checks; no live SUMOB requests or extra packages."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

SRC = Path(__file__).resolve().parents[1] / "scripts/audit_sumob_gtfs_match.py"
spec = importlib.util.spec_from_file_location("audit_sumob_gtfs_match", SRC)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class Fake:
    def __init__(self, **fields):
        self.__dict__.update(fields)

    def HasField(self, field):
        return field in self.__dict__ and self.__dict__[field] is not None

    def __getattr__(self, name):
        if name in {"trip_id", "route_id", "start_date", "start_time", "stop_id"}:
            return ""
        raise AttributeError(name)


class AuditTests(unittest.TestCase):
    def make_gtfs(self):
        directory = tempfile.TemporaryDirectory()
        archive = Path(directory.name) / "gtfs.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("routes.txt",
                       "route_id,route_short_name\n562055,5102\n564302,9209\n")
            z.writestr("trips.txt",
                       "route_id,service_id,trip_id,direction_id\n"
                       "562055,S,trip-1,0\n564302,S,trip-2,1\n")
            z.writestr("stop_times.txt",
                       "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
                       "trip-1,08:00,08:00,A,1\n"
                       "trip-1,08:05,08:05,B,2\n"
                       "trip-2,09:00,09:00,C,1\n"
                       "trip-2,09:20,09:20,D,2\n")
        return directory, archive

    def test_matches_public_code_and_internal_route_id(self):
        directory, archive = self.make_gtfs()
        with directory:
            feed = Fake(header=Fake(timestamp=1700000000), entity=[
                Fake(trip_update=Fake(
                    trip=Fake(trip_id="trip-1", route_id="5102", direction_id=0,
                              start_date="20261117", start_time="08:00:00"),
                    stop_time_update=[Fake(
                        stop_sequence=2, stop_id="B", arrival=Fake(delay=300))])),
                Fake(trip_update=Fake(
                    trip=Fake(trip_id="trip-2", route_id="564302", direction_id=0,
                              start_date="20261117"),
                    stop_time_update=[Fake(
                        stop_sequence=1, stop_id="C", arrival=Fake(delay=-120))])),
                Fake(trip_update=Fake(
                    trip=Fake(trip_id="nonexistent", route_id="unknown"),
                    stop_time_update=[]))
            ])
            result = audit.static_match(feed, archive, now=1700000010)
            self.assertEqual(result["rtTripUpdates"], 3)
            self.assertEqual(result["matchedTripId"], 2)
            self.assertEqual(result["unmatchedTripId"], 1)
            self.assertEqual(result["routeMatchesPublicCode"], 1)
            self.assertEqual(result["routeMatchesStaticId"], 1)
            self.assertEqual(result["directionMismatch"], 1)
            self.assertEqual(result["matchedStopKey"], 2)
            self.assertEqual(result["delayMedianSeconds"], 90)
            self.assertEqual(result["feedHeaderAgeSeconds"], 10)

    def test_rejects_stop_id_inconsistent_with_sequence(self):
        directory, archive = self.make_gtfs()
        with directory:
            feed = Fake(header=Fake(timestamp=1700000000), entity=[
                Fake(trip_update=Fake(
                    trip=Fake(trip_id="trip-1", route_id="5102"),
                    stop_time_update=[Fake(
                        stop_sequence=2, stop_id="C", arrival=Fake(delay=2))]))
            ])
            result = audit.static_match(feed, archive, now=1700000010)
            self.assertEqual(result["unmatchedStopKey"], 1)
            self.assertEqual(result["matchedStopKey"], 0)

    def test_no_sensitive_trip_identifiers_in_output(self):
        directory, archive = self.make_gtfs()
        with directory:
            feed = Fake(header=Fake(timestamp=0), entity=[
                Fake(trip_update=Fake(
                    trip=Fake(trip_id="private-trip-value", route_id="private-route"),
                    stop_time_update=[]))
            ])
            result = audit.static_match(feed, archive, now=10)
            self.assertNotIn("private-trip-value", str(result))
            self.assertNotIn("private-route", str(result))


if __name__ == "__main__":
    unittest.main()
