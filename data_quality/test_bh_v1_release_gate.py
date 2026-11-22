"""Small synthetic-only fixtures for V1 release gate; no fictional public departures."""
import json
import gzip

from data_quality.static_arrivals_reference import _bucket_id
from pathlib import Path
import tempfile
import unittest

from data_quality.bh_v1_release_gate import audit


class BhV1GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.docs = {
            'manifest.json': {'gtfsVersion': 'synthetic-1', 'feedStartDate': '20261101',
                              'feedEndDate': '20261130', 'routes': 1, 'stops': 2, 'stopTimeRows': 4},
            'routes.json': [{'id': 'R1', 'code': 'TEST', 'name': 'Synthetic'}],
            'stops.json': {'S1': ['A', -19.9, -43.9], 'S2': ['B', -19.8, -43.8]},
            'timetable-calendar.json': {'services': {'WK': {'start_date': '20261101',
                'end_date': '20261130', 'monday': '1', 'tuesday': '1', 'wednesday': '1',
                'thursday': '1', 'friday': '1', 'saturday': '0', 'sunday': '0'}},
                'exceptions': {}, 'stops': 2, 'records': 4},
            'metro.json': {'lines': [{'id': '1', 'stations': ['A']}],
                           'stations': [{'id': 'A', 'lat': -19.9, 'lng': -43.9, 'lines': ['1']}]},
        }
        (self.root/'source-gtfs.sha256').write_text('a'*64)
        self.save()

    def save(self):
        for name, data in self.docs.items():
            (self.root/name).write_text(json.dumps(data), encoding='utf-8')

    def gate(self, day='20261124', **kwargs):
        self.save()
        return audit(self.root, day, **kwargs)

    def test_compatible_municipal_snapshot(self):
        self.assertEqual(self.gate()['status'], 'pass')

    def test_expired_gtfs_blocks(self):
        self.assertIn('service_date_outside_gtfs_validity', self.gate('20261201')['errors'])

    def test_no_active_service_blocks(self):
        self.assertIn('no_active_services_on_requested_date', self.gate('20261122')['errors'])

    def test_calendar_exception_adds_sunday(self):
        self.docs['timetable-calendar.json']['exceptions'] = {'20261122': {'WK': 1}}
        self.assertEqual(self.gate('20261122')['counts']['activeServices'], 1)

    def test_calendar_dates_only_service_is_valid(self):
        self.docs['timetable-calendar.json']['services'] = {}
        self.docs['timetable-calendar.json']['exceptions'] = {'20261124': {'SPECIAL': 1}}
        result = self.gate('20261124')
        self.assertEqual(result['status'], 'pass')
        self.assertEqual(result['counts']['activeServices'], 1)

    def test_calendar_dates_only_removal_is_invalid(self):
        self.docs['timetable-calendar.json']['services'] = {}
        self.docs['timetable-calendar.json']['exceptions'] = {'20261124': {'SPECIAL': 2}}
        self.assertIn('invalid_service_calendar', self.gate('20261124')['errors'])

    def test_stop_count_mismatch_blocks(self):
        self.docs['manifest.json']['stops'] = 3
        self.assertIn('stop_count_mismatch', self.gate()['errors'])

    def test_timetable_count_mismatch_blocks(self):
        self.docs['timetable-calendar.json']['records'] = 3
        self.assertIn('stop_time_count_mismatch', self.gate()['errors'])

    def test_absent_arrivals_index_blocks_only_for_static_release(self):
        self.assertEqual(self.gate()['status'], 'pass')
        self.assertIn('static_arrivals_index_required', self.gate(require_arrivals=True)['errors'])

    def test_incompatible_arrivals_index_blocks(self):
        path = self.root/'index.json'
        path.write_text(json.dumps({'version': 'wrong', 'validThrough': '20261130',
                                    'stopCount': 2, 'buckets': 256, 'sizes': {str(i): 1 for i in range(256)}}))
        self.assertIn('static_arrivals_index_incompatible', self.gate(arrivals_index=path)['errors'])

    def test_bad_metro_reference_blocks(self):
        self.docs['metro.json']['stations'][0]['lines'] = ['unknown']
        self.assertIn('invalid_metro_station_reference', self.gate()['errors'])

    def test_missing_stop_arrivals_is_diagnostic_not_invented_eta(self):
        self.docs['timetable-calendar.json']['stops'] = 1
        rep = self.gate()
        self.assertEqual(rep['status'], 'pass')
        self.assertIn('stops_without_scheduled_arrivals:1', rep['warnings'])
        self.assertTrue(rep['scheduledNotRealtime'])

    def sample_arrivals(self):
        root = self.root / 'arrivals'
        root.mkdir(exist_ok=True)
        calendar = self.docs['timetable-calendar.json']
        (root / 'calendar.json').write_text(json.dumps(calendar), encoding='utf-8')
        sizes = {}
        for i in range(256):
            key = f'{i:02x}'
            group = {sid: [['TEST', 'WK', 'Synthetic', [600, 900]]]
                     for sid in ('S1','S2') if _bucket_id(sid) == key}
            blob = gzip.compress(json.dumps(group).encode('utf-8'), mtime=0)
            name = key + '.json.gz'
            (root / name).write_bytes(blob)
            sizes[name] = len(blob)
        idx = {'schema': 1, 'buckets': 256, 'version': 'synthetic-1',
               'validThrough': '20261130', 'stopCount': 2, 'sizes': sizes}
        path = root / 'index.json'
        path.write_text(json.dumps(idx), encoding='utf-8')
        with gzip.open(self.root / 'timetable.json.gz', 'wt', encoding='utf-8') as stream:
            for sid in ('S1', 'S2'):
                stream.write(json.dumps([sid, [['TEST','WK','Synthetic',[600,900]]]]) + '\n')
        return path

    def test_package_with_all_shards_passes_release_gate(self):
        path = self.sample_arrivals()
        result = self.gate(arrivals_index=path, require_arrivals=True)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['arrivalsAudit']['filesChecked'], 256)

    def test_package_with_missing_shard_blocks_release_gate(self):
        path = self.sample_arrivals()
        (path.parent / '00.json.gz').unlink()
        result = self.gate(arrivals_index=path, require_arrivals=True)
        self.assertIn('static_arrivals_bucket_unreadable', result['errors'])

    def test_modified_departure_blocks_even_with_valid_shard_index(self):
        path = self.sample_arrivals()
        with gzip.open(self.root / 'timetable.json.gz', 'wt', encoding='utf-8') as stream:
            stream.write(json.dumps(['S1', [['TEST','WK','Synthetic',[600,901]]]]) + '\n')
            stream.write(json.dumps(['S2', [['TEST','WK','Synthetic',[600,900]]]]) + '\n')
        result = self.gate(arrivals_index=path, require_arrivals=True)
        self.assertIn('published_timetable_differs_from_source', result['errors'])
        self.assertEqual(result['timetableAudit']['mismatchedStops'], 1)

    def test_missing_timetable_blocks_static_release(self):
        path = self.sample_arrivals()
        (self.root / 'timetable.json.gz').unlink()
        result = self.gate(arrivals_index=path, require_arrivals=True)
        self.assertIn('source_timetable_unreadable', result['errors'])

    def test_bad_source_checksum_blocks(self):
        (self.root/'source-gtfs.sha256').write_text('bad')
        self.assertIn('missing_or_invalid_source_gtfs_sha256', self.gate()['errors'])


if __name__ == '__main__':
    unittest.main()
