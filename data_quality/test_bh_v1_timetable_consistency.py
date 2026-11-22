"""Only synthetic timetables; never claim official departures."""
import gzip
import json
from pathlib import Path
import tempfile
import unittest

from data_quality.bh_v1_timetable_consistency import audit_timetable_equivalence


class TimetableConsistencyTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.arrivals = self.root / 'arrivals'
        self.arrivals.mkdir()
        self.expected = {
            'S1': [['100', 'WK', 'TESTE', [300, 500]]],
            'S2': [['100', 'WK', 'TESTE', [600, 900]]],
        }
        self.make_source()
        self.make_shards()

    def make_source(self, lines=None):
        if lines is None:
            lines = [[sid, entries] for sid, entries in self.expected.items()]
        with gzip.open(self.root / 'timetable.json.gz', 'wt', encoding='utf-8') as f:
            for row in lines:
                f.write(json.dumps(row, ensure_ascii=False) + '\n')

    def make_shards(self, changes=None):
        changes = changes if changes is not None else self.expected
        from data_quality.static_arrivals_reference import _bucket_id
        for n in range(256):
            code = f'{n:02x}'
            group = {sid: entries for sid, entries in changes.items() if _bucket_id(sid) == code}
            (self.arrivals / f'{code}.json.gz').write_bytes(gzip.compress(json.dumps(group).encode(), mtime=0))

    def audit(self):
        return audit_timetable_equivalence(self.root, self.arrivals / 'index.json')

    def test_equal_snapshot(self):
        result = self.audit()
        self.assertEqual(result['status'], 'pass')
        self.assertEqual(result['sourceStops'], 2)
        self.assertEqual(result['publishedStops'], 2)
        self.assertEqual(len(result['sourceSha256']), 64)

    def test_same_stop_count_but_modified_times(self):
        changes = json.loads(json.dumps(self.expected))
        changes['S1'][0][3][1] = 501
        self.make_shards(changes)
        result = self.audit()
        self.assertEqual(result['mismatchedStops'], 1)
        self.assertIn('published_timetable_differs_from_source', result['errors'])

    def test_missing_stop(self):
        changes = dict(self.expected)
        changes.pop('S1')
        self.make_shards(changes)
        self.assertEqual(self.audit()['missingStops'], 1)

    def test_unexpected_stop(self):
        changes = dict(self.expected)
        changes['S3'] = self.expected['S1']
        self.make_shards(changes)
        self.assertEqual(self.audit()['unexpectedStops'], 1)

    def test_missing_source_is_blocked(self):
        (self.root/'timetable.json.gz').unlink()
        self.assertIn('source_timetable_unreadable', self.audit()['errors'])

    def test_truncated_source_is_blocked(self):
        source = self.root/'timetable.json.gz'
        source.write_bytes(source.read_bytes()[:-8])
        self.assertIn('source_timetable_invalid', self.audit()['errors'])

    def test_duplicate_source_stop_is_blocked(self):
        self.make_source([['S1', self.expected['S1']], ['S1', self.expected['S1']]])
        self.assertIn('source_timetable_invalid', self.audit()['errors'])

    def test_bad_source_format_is_blocked(self):
        self.make_source([{'S1': []}])
        self.assertIn('source_timetable_invalid', self.audit()['errors'])

    def test_corrupt_shard_is_blocked(self):
        (self.arrivals / 'ff.json.gz').write_bytes(b'x')
        self.assertIn('published_timetable_shard_unreadable', self.audit()['errors'])

    def test_source_hash_changes_after_new_schedule(self):
        before = self.audit()['sourceSha256']
        self.expected['S1'][0][3][1] = 501
        self.make_source()
        self.make_shards()
        after = self.audit()
        self.assertNotEqual(before, after['sourceSha256'])
        self.assertEqual(after['status'], 'pass')


if __name__ == '__main__':
    unittest.main()
