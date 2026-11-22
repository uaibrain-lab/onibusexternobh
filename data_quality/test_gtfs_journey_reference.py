"""Synthetic-only reference journeys; NEVER represent these as official schedules."""
import pathlib
import tempfile
import unittest
import zipfile

from data_quality.gtfs_journey_reference import (
    active_services, parse_time, read_feed, reference_journey, validate,
)

FILES = {
    "routes.txt": "route_id,route_short_name\nR1,TESTE-1\n",
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nS1,Origem,-19.9,-43.9\nS2,Intermediario,-19.91,-43.91\nS3,Destino,-19.92,-43.92\n",
    "trips.txt": "trip_id,route_id,service_id\nT1,R1,WK\nT2,R1,WK\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,23:50:00,23:50:00,S1,1\nT1,24:05:00,24:06:00,S2,2\nT1,24:20:00,24:20:00,S3,3\nT2,08:00:00,08:00:00,S1,1\nT2,08:20:00,08:20:00,S3,2\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWK,1,1,1,1,1,0,0,20261101,20261231\n",
    "calendar_dates.txt": "service_id,date,exception_type\nWK,20261123,2\nWK,20261128,1\n",
}


class JourneyReferenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = pathlib.Path(self.tmp.name) / "fixture.zip"
        self.write(FILES)
        self.feed = read_feed(self.path)

    def write(self, data):
        with zipfile.ZipFile(self.path, "w", zipfile.ZIP_DEFLATED) as z:
            for name, value in data.items():
                z.writestr(name, value)

    def test_complete_overnight_journey(self):
        coverage, *_ = validate(self.feed, "20261124")
        self.assertEqual(coverage["tripCount"], 2)
        journey = reference_journey(self.feed, "20261124", "T1", "S1", "S3")
        self.assertEqual(journey["status"], "scheduled")
        self.assertEqual(journey["alightSeconds"], 24 * 3600 + 20 * 60)
        self.assertEqual(journey["stopCount"], 3)
        self.assertTrue(journey["scheduledNotRealtime"])
        self.assertEqual(journey["sourceSha256"], coverage["sourceSha256"])

    def test_calendar_exception_removes_service(self):
        self.assertEqual(active_services(self.feed, "20261123"), set())
        self.assertEqual(reference_journey(self.feed, "20261123", "T1", "S1", "S3")["status"], "inactive_service")

    def test_calendar_exception_adds_weekend_service(self):
        self.assertEqual(active_services(self.feed, "20261128"), {"WK"})
        self.assertEqual(reference_journey(self.feed, "20261128", "T1", "S1", "S3")["status"], "scheduled")

    def test_stop_order_and_missing_trip(self):
        self.assertEqual(reference_journey(self.feed, "20261124", "T1", "S3", "S1")["status"], "missing_ordered_stops")
        self.assertEqual(reference_journey(self.feed, "20261124", "UNKNOWN", "S1", "S3")["status"], "missing_trip")

    def test_reject_orphan_trip(self):
        bad = dict(FILES)
        bad["trips.txt"] = bad["trips.txt"].replace("T2,R1,WK", "T2,UNKNOWN,WK")
        self.write(bad)
        with self.assertRaisesRegex(ValueError, "orphan"):
            validate(read_feed(self.path))

    def test_reject_duplicate_sequence(self):
        bad = dict(FILES)
        bad["stop_times.txt"] = bad["stop_times.txt"].replace("S2,2", "S2,1")
        self.write(bad)
        with self.assertRaisesRegex(ValueError, "duplicate stop sequence"):
            validate(read_feed(self.path))

    def test_reject_nonmonotonic_times(self):
        bad = dict(FILES)
        bad["stop_times.txt"] = bad["stop_times.txt"].replace("24:05:00,24:06:00", "23:40:00,23:41:00")
        self.write(bad)
        with self.assertRaisesRegex(ValueError, "nonmonotonic"):
            validate(read_feed(self.path))

    def test_reject_duplicate_archive_member(self):
        with zipfile.ZipFile(self.path, "w") as z:
            z.writestr("routes.txt", FILES["routes.txt"])
            z.writestr("nested/routes.txt", FILES["routes.txt"])
        with self.assertRaisesRegex(ValueError, "duplicate GTFS member"):
            read_feed(self.path)

    def test_reject_path_traversal(self):
        with zipfile.ZipFile(self.path, "w") as z:
            z.writestr("../routes.txt", FILES["routes.txt"])
        with self.assertRaisesRegex(ValueError, "unsafe"):
            read_feed(self.path)

    def test_reject_invalid_time(self):
        for value in ("24:60:00", "abc", "-01:00:00", "168:00:00"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_time(value)


if __name__ == "__main__":
    unittest.main()
