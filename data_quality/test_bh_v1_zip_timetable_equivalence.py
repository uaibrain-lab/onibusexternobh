"""Synthetic source-versus-derived GTFS timetable comparison tests."""
from __future__ import annotations
import csv
import gzip
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from data_quality.bh_v1_zip_timetable_equivalence import audit_zip_timetable


class ZipTimetableEquivalenceTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.zip_path = self.root / 'gtfs.zip'
        self.routes = [{'route_id': 'R1', 'route_short_name': '9106'}]
        self.trips = [
            {'trip_id': 'T1', 'route_id': 'R1', 'service_id': 'WK', 'trip_headsign': 'Centro'},
            {'trip_id': 'T2', 'route_id': 'R1', 'service_id': 'WK', 'trip_headsign': 'Centro'},
        ]
        self.times = [
            {'trip_id': 'T1', 'stop_id': 'S1', 'arrival_time': '23:50:00', 'departure_time': '23:50:00'},
            {'trip_id': 'T1', 'stop_id': 'S2', 'arrival_time': '24:10:00', 'departure_time': '24:10:00'},
            {'trip_id': 'T2', 'stop_id': 'S1', 'arrival_time': '23:50:00', 'departure_time': '23:50:00'},
            {'trip_id': 'T2', 'stop_id': 'S2', 'arrival_time': '24:12:00', 'departure_time': '24:12:00'},
        ]
        self.compiled = [
            ['S1', [['9106', 'WK', 'Centro', [85800]]]],
            ['S2', [['9106', 'WK', 'Centro', [87000, 87120]]]],
        ]
        self.write_zip()
        self.write_timetable()

    def write_zip(self):
        with zipfile.ZipFile(self.zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
            for filename, rows in [('routes.txt', self.routes), ('trips.txt', self.trips), ('stop_times.txt', self.times)]:
                stream = io.StringIO(newline='')
                keys = list(rows[0])
                w = csv.DictWriter(stream, fieldnames=keys)
                w.writeheader()
                w.writerows(rows)
                z.writestr(filename, stream.getvalue())

    def write_timetable(self):
        with gzip.open(self.root / 'timetable.json.gz', 'wt', encoding='utf-8') as f:
            for row in self.compiled:
                f.write(json.dumps(row, ensure_ascii=False) + '\n')

    def audit(self):
        return audit_zip_timetable(self.root, self.zip_path)

    def test_exact_schedule_including_overnight_and_deduplicated_trips(self):
        output = self.audit()
        self.assertEqual(output['status'], 'pass', output)
        self.assertEqual(output['sourceStopTimeRows'], 4)
        self.assertEqual(output['distinctScheduledTimes'], 3)
        self.assertEqual(output['sourceStops'], 2)

    def test_mutated_departure_same_counts_blocks(self):
        self.compiled[1][1][0][3][1] = 87121
        self.write_timetable()
        output = self.audit()
        self.assertEqual(output['mismatchedStops'], 1)
        self.assertIn('zip_stop_times_differ_from_compiled_timetable', output['errors'])

    def test_missing_stop_blocks(self):
        self.compiled.pop()
        self.write_timetable()
        self.assertEqual(self.audit()['missingStops'], 1)

    def test_extra_stop_blocks(self):
        self.compiled.append(['S3', [['9106', 'WK', 'Centro', [100]]]])
        self.write_timetable()
        self.assertEqual(self.audit()['unexpectedStops'], 1)

    def test_different_trip_service_id_blocks(self):
        self.trips[0]['service_id'] = 'SAT'
        self.write_zip()
        self.assertEqual(self.audit()['mismatchedStops'], 2)

    def test_corrupt_compiled_gzip_blocks(self):
        (self.root / 'timetable.json.gz').write_bytes(b'bad gzip')
        self.assertIn('zip_timetable_source_or_compiled_invalid', self.audit()['errors'])

    def test_missing_compiled_file_blocks(self):
        (self.root / 'timetable.json.gz').unlink()
        self.assertIn('zip_timetable_input_unreadable', self.audit()['errors'])

    def test_duplicate_compiled_stop_blocks(self):
        self.compiled.insert(1, self.compiled[0])
        self.write_timetable()
        self.assertIn('zip_timetable_source_or_compiled_invalid', self.audit()['errors'])

    def test_invalid_time_source_blocks(self):
        self.times[0]['arrival_time'] = '48:01:00'
        self.write_zip()
        self.assertIn('zip_timetable_source_or_compiled_invalid', self.audit()['errors'])

    def test_reordered_schedule_groups_do_not_trigger_false_block(self):
        self.trips[1]['trip_headsign'] = 'Estacao'
        self.write_zip()
        self.compiled[0][1] = [['9106', 'WK', 'Estacao', [85800]], ['9106', 'WK', 'Centro', [85800]]]
        self.compiled[1][1] = [['9106', 'WK', 'Estacao', [87120]], ['9106', 'WK', 'Centro', [87000]]]
        self.write_timetable()
        result = self.audit()
        self.assertEqual(result['status'], 'pass', result)

    def test_invalid_duplicate_seconds_in_compiled_blocks(self):
        self.compiled[1][1][0][3].append(87120)
        self.write_timetable()
        self.assertIn('zip_timetable_source_or_compiled_invalid', self.audit()['errors'])

    def test_missing_gtfs_zip_blocks(self):
        self.zip_path.unlink()
        self.assertIn('zip_timetable_input_unreadable', self.audit()['errors'])


if __name__ == '__main__':
    unittest.main()
