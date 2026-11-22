import json
import tempfile
import unittest
from pathlib import Path
from bh_v1_validity_alerts import audit, parse_date

class ValidityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'manifest.json').write_text(json.dumps({'feedStartDate':'20261101','feedEndDate':'20261231'}))
        (self.root / 'source-gtfs.sha256').write_text('a'*64)
    def test_pass(self):
        self.assertEqual(audit(self.root,'20261122')['status'],'pass')
    def test_warning(self):
        self.assertEqual(audit(self.root,'20261220')['daysUntilExpiry'],11)
        self.assertEqual(audit(self.root,'20261220')['status'],'warning')
    def test_expired(self):
        self.assertIn('feed_expired',audit(self.root,'20270101')['errors'])
    def test_not_yet_valid(self):
        self.assertIn('feed_not_yet_valid',audit(self.root,'20261001')['errors'])
    def test_missing_hash(self):
        (self.root / 'source-gtfs.sha256').unlink()
        self.assertEqual(audit(self.root,'20261122')['status'],'blocked')
    def test_bad_range(self):
        (self.root / 'manifest.json').write_text(json.dumps({'feedStartDate':'20261231','feedEndDate':'20261101'}))
        self.assertIn('invalid_feed_date_range',audit(self.root,'20261122')['errors'])
    def test_invalid_date(self):
        with self.assertRaises(ValueError): parse_date('20261301')
    def test_negative_warning(self):
        with self.assertRaises(ValueError): audit(self.root,'20261122',-1)
    def test_no_update_claim(self):
        self.assertIsNone(audit(self.root,'20261122')['updateDetected'])

if __name__ == '__main__': unittest.main()
