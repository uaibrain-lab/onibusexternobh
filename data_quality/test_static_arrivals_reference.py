"""Fully synthetic gzip-shard fixtures; no official departures are embedded."""
import gzip
import json
from pathlib import Path
import tempfile
import unittest

from data_quality.static_arrivals_reference import audit_arrivals, _bucket_id


class StaticArrivalsReferenceTests(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = Path(t.name)
        self.shards = self.root / 'arrivals'
        self.shards.mkdir()
        self.calendar = {'services': {'W': {'start_date': '20261101', 'end_date': '20261130'}},
                         'exceptions': {}, 'records': 4, 'stops': 2}
        (self.root / 'timetable-calendar.json').write_text(json.dumps(self.calendar))
        (self.shards / 'calendar.json').write_text(json.dumps(self.calendar))
        (self.root / 'routes.json').write_text(json.dumps([{'id': 'R1', 'code': 'TEST'}]))
        (self.root / 'stops.json').write_text(json.dumps({'S1': ['A', -19.9, -43.9], 'S2': ['B', -19.8, -43.8]}))
        self.groups = {'S1': [['TEST','W','Synthetic', [300, 400]]],
                       'S2': [['TEST','W','Synthetic', [600, 700]]]}
        self.write()

    def write(self):
        sizes = {}
        for i in range(256):
            name = f'{i:02x}.json.gz'
            group = {sid: data for sid, data in self.groups.items() if _bucket_id(sid) == f'{i:02x}'}
            blob = gzip.compress(json.dumps(group).encode(), mtime=0)
            (self.shards / name).write_bytes(blob)
            sizes[name] = len(blob)
        self.index = {'schema': 1, 'buckets': 256, 'version': 'synthetic-1',
                      'validThrough': '20261130', 'stopCount': 2, 'sizes': sizes}
        self.save_index()

    def save_index(self):
        (self.shards / 'index.json').write_text(json.dumps(self.index))

    def run_gate(self):
        return audit_arrivals(self.shards/'index.json', self.root, 2, 'synthetic-1', '20261130')

    def test_all_shards_and_stop_schedules(self):
        result = self.run_gate()
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['filesChecked'], 256)
        self.assertEqual(result['stopsChecked'], 2)
        self.assertEqual(result['scheduledGroupsChecked'], 2)

    def test_missing_shard_is_blocked(self):
        (self.shards/'ff.json.gz').unlink()
        self.assertIn('static_arrivals_bucket_unreadable', self.run_gate()['errors'])

    def test_corrupt_shard_is_blocked(self):
        name = _bucket_id('S1') + '.json.gz'
        (self.shards/name).write_bytes(b'broken')
        self.index['sizes'][name] = 6
        self.save_index()
        self.assertIn('static_arrivals_bucket_unreadable', self.run_gate()['errors'])

    def test_mismatched_index_size_is_blocked(self):
        self.index['sizes']['ff.json.gz'] += 1
        self.save_index()
        self.assertIn('static_arrivals_bucket_size_mismatch', self.run_gate()['errors'])

    def test_moved_stop_to_wrong_bucket_is_blocked(self):
        destination = '00'
        self.assertNotEqual(destination, _bucket_id('S1'))
        path = self.shards/'00.json.gz'
        data = {'S1': self.groups['S1']}
        blob = gzip.compress(json.dumps(data).encode(), mtime=0)
        path.write_bytes(blob)
        self.index['sizes'][path.name] = len(blob)
        self.save_index()
        self.assertIn('static_arrivals_stop_invalid', self.run_gate()['errors'])

    def test_unknown_route_is_blocked(self):
        self.groups['S1'][0][0] = 'OTHER'
        self.write()
        self.assertIn('static_arrivals_schedule_invalid', self.run_gate()['errors'])

    def test_unsorted_times_are_blocked(self):
        self.groups['S2'][0][3] = [600, 500]
        self.write()
        self.assertIn('static_arrivals_schedule_invalid', self.run_gate()['errors'])

    def test_calendar_drift_is_blocked(self):
        (self.shards/'calendar.json').write_text(json.dumps({'services': {}}))
        self.assertIn('static_arrivals_calendar_mismatch', self.run_gate()['errors'])

    def test_missing_stop_not_just_metadata_count(self):
        del self.groups['S2']
        self.write()
        self.assertIn('static_arrivals_stop_coverage_mismatch', self.run_gate()['errors'])

    def test_wrong_index_keys_are_blocked(self):
        self.index['sizes']['junk.json.gz'] = 25
        self.save_index()
        self.assertIn('static_arrivals_index_incompatible', self.run_gate()['errors'])

    def test_absent_index_is_blocked(self):
        (self.shards/'index.json').unlink()
        self.assertIn('static_arrivals_index_unreadable', self.run_gate()['errors'])


if __name__ == '__main__':
    unittest.main()
