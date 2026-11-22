import gzip
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from scripts.build_trip_stop_eta_index import build, bucket_id, seconds


class ExactTripIndexTests(unittest.TestCase):
    def fixture(self, root, *, missing=False):
        archive = root / "official.zip"
        catalog = root / "catalog"
        catalog.mkdir()
        (catalog / "manifest.json").write_text(json.dumps({
            "gtfsVersion": "202611221922", "feedEndDate": "20261231"
        }), encoding="utf-8")
        trips = "trip_id,route_id,service_id\nT-A,562134,307680\nT-B,562165,307680\n"
        times = """trip_id,stop_id,stop_sequence,arrival_time,departure_time
T-A,14780000,1,23:10:00,23:10:00
T-A,14791950,7,23:25:00,23:26:00
T-A,14791950,12,23:45:00,23:46:00
T-B,14791950,1,24:02:00,24:02:00
T-B,14782000,3,24:15:00,24:15:00
"""
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("trips.txt", trips)
            if not missing:
                z.writestr("stop_times.txt", times)
        return archive, catalog

    def test_trip_and_sequence_join_never_collapses_loops(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive, catalog = self.fixture(root)
            target = root / "output"
            meta = build(archive, catalog, target, min_rows=1)
            self.assertEqual(meta["rows"], 5)
            self.assertEqual(meta["trips"], 2)
            self.assertEqual(meta["schema"], 1)
            self.assertEqual(meta["version"], "202611221922")
            shard = target / (bucket_id("14791950") + ".json.gz")
            with gzip.open(shard, "rt", encoding="utf8") as stream:
                points = json.load(stream)
            self.assertEqual(points["14791950"], [
                ["T-A", "562134", "307680", 7, 23*3600+25*60, 23*3600+10*60],
                ["T-A", "562134", "307680", 12, 23*3600+45*60, 23*3600+10*60],
                ["T-B", "562165", "307680", 1, 24*3600+2*60, 24*3600+2*60],
            ])
            first = shard.read_bytes()
            build(archive, catalog, target, min_rows=1)
            self.assertEqual(shard.read_bytes(), first)

    def test_invalid_clock_and_missing_gtfs_rejected(self):
        self.assertIsNone(seconds("25:60:00"))
        self.assertIsNone(seconds("48:00:00"))
        self.assertEqual(seconds("25:03:02"), 25*3600+3*60+2)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive, catalog = self.fixture(root, missing=True)
            with self.assertRaises(ValueError):
                build(archive, catalog, root/"output", min_rows=1)


if __name__ == "__main__":
    unittest.main()
