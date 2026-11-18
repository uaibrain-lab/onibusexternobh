"""P27: exact on-disk browser-scan/GTFS-RT compatibility checks. No network."""
from __future__ import annotations
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "audit_sumob_gtfs_match_p27", ROOT / "scripts/audit_sumob_gtfs_match.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class Fake:
    def __init__(self, **fields):
        self.__dict__.update(fields)

    def HasField(self, field):
        return field in self.__dict__ and self.__dict__[field] is not None


class Tests(unittest.TestCase):
    def test_overlap_uses_exact_scan_not_different_download(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / "scan").mkdir()
            with gzip.open(directory / "scan/trips.json.gz", "wt",
                           encoding="utf-8") as stream:
                json.dump([["trip-A", "9209", "Centro", 1],
                           ["trip-B", "51", "Destino", 1],
                           ["trip-A", "9209", "Repetido", 1]], stream)
            (directory / "manifest.json").write_text(
                '{"gtfsVersion":"202611161919"}', encoding="utf-8")
            feed = Fake(entity=[
                Fake(trip_update=Fake(trip=Fake(trip_id="trip-A",
                                               route_id="9209"))),
                Fake(trip_update=Fake(trip=Fake(trip_id="trip-A",
                                               route_id="9209"))),
                Fake(trip_update=Fake(trip=Fake(trip_id="trip-B",
                                               route_id="UNKNOWN"))),
                Fake(trip_update=Fake(trip=Fake(trip_id="trip-C",
                                               route_id="5106")))
            ])
            result = audit.app_catalog_overlap(feed, directory)
            self.assertEqual(result["appCatalogRTUpdateCount"], 3)
            self.assertEqual(result["appCatalogRTMissingCount"], 1)
            self.assertEqual(result["appCatalogRTPublicRouteCodeMatchCount"], 2)
            self.assertEqual(result["appCatalogRTRouteCodeMismatchCount"], 1)
            self.assertEqual(result["appCatalogUniqueTripIdsMatched"], 2)
            self.assertEqual(result["appCatalogTripRows"], 3)
            self.assertEqual(result["appCatalogGTFSVersion"], "202611161919")
            self.assertNotIn("trip-A", str(result))
            self.assertNotIn("trip-C", str(result))

    def test_missing_catalog_fails_closed(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                audit.app_catalog_overlap(Fake(entity=[]), Path(root))

    def test_no_predicted_arrival_is_invented(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / "scan").mkdir()
            with gzip.open(directory / "scan/trips.json.gz", "wt",
                           encoding="utf-8") as stream:
                json.dump([["trip-A", "5102", "UFMG", 1]], stream)
            feed = Fake(entity=[Fake(trip_update=Fake(
                trip=Fake(trip_id="trip-A", route_id="5102")))])
            result = audit.app_catalog_overlap(feed, directory)
            self.assertEqual(result["appCatalogRTUpdateCount"], 1)
            self.assertFalse(any("eta" in key.lower() or "arrival" in key.lower()
                                 for key in result))


if __name__ == "__main__":
    unittest.main()
