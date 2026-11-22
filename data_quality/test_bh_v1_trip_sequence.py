"""Synthetic regression tests of stop ordering and service-time integrity."""
import unittest
from data_quality.bh_v1_trip_sequence import TripSequenceAudit


class TripSequenceTests(unittest.TestCase):
    def audit(self, ids, rows):
        a = TripSequenceAudit(ids)
        for row in rows:
            a.add(*row)
        return a.report()

    def test_overnight_increasing_sequence(self):
        result = self.audit({'T1'}, [('T1', 1, 85800, 85800), ('T1', 2, 87000, 87100)])
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['tripRowsChecked'], 2)

    def test_two_valid_trip_blocks(self):
        rows = [('T1', 0, 0, 0), ('T1', 5, 5, 6),
                ('T2', 1, 20, 20), ('T2', 2, 20, 20)]
        self.assertEqual(self.audit({'T1', 'T2'}, rows)['errors'], [])

    def test_duplicate_sequence_rejected(self):
        rows = [('T1', 1, 600, 600), ('T1', 1, 700, 700)]
        self.assertIn('source_stop_sequence_not_increasing', self.audit({'T1'}, rows)['errors'])

    def test_reversed_sequence_rejected(self):
        rows = [('T1', 2, 600, 600), ('T1', 1, 700, 700)]
        self.assertIn('source_stop_sequence_not_increasing', self.audit({'T1'}, rows)['errors'])

    def test_departure_cannot_follow_next_arrival(self):
        rows = [('T1', 1, 600, 700), ('T1', 2, 699, 750)]
        self.assertIn('source_trip_times_not_monotonic', self.audit({'T1'}, rows)['errors'])

    def test_equal_departure_and_next_arrival_allowed(self):
        rows = [('T1', 1, 600, 700), ('T1', 2, 700, 700)]
        self.assertEqual(self.audit({'T1'}, rows)['errors'], [])

    def test_noncontiguous_trip_block_rejected(self):
        rows = [('T1', 1, 0, 0), ('T2', 1, 0, 0),
                ('T1', 2, 10, 10), ('T2', 2, 10, 10)]
        self.assertIn('source_trip_noncontiguous_stop_times', self.audit({'T1', 'T2'}, rows)['errors'])

    def test_orphan_trip_rejected(self):
        r = self.audit({'T1'}, [('OTHER', 1, 600, 600)])
        self.assertIn('source_stop_time_orphan_trip', r['errors'])

    def test_trip_without_stop_times_rejected(self):
        r = self.audit({'T1', 'T2'}, [('T1', 1, 600, 600), ('T1', 2, 700, 700)])
        self.assertIn('source_trips_without_stop_times', r['errors'])
        self.assertEqual(r['tripsWithoutStopTimes'], 1)

    def test_single_stop_trip_rejected(self):
        r = self.audit({'T1'}, [('T1', 1, 600, 600)])
        self.assertIn('source_trips_with_fewer_than_two_stops', r['errors'])
        self.assertEqual(r['tripsWithFewerThanTwoStops'], 1)

    def test_negative_or_bool_values_rejected(self):
        for row in [('T1', -1, 10, 10), ('T1', True, 10, 10),
                    ('T1', 1, -1, 10), ('T1', 1, 20, 10)]:
            with self.subTest(row=row):
                r = self.audit({'T1'}, [row])
                self.assertIn('source_stop_sequence_or_time_invalid', r['errors'])


if __name__ == '__main__':
    unittest.main()
