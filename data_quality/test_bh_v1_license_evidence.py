import json
import tempfile
import unittest
from pathlib import Path
from bh_v1_license_evidence import audit, main

class LicenseEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.catalog = self.root / 'catalog'
        self.catalog.mkdir()
        self.sha = 'a' * 64
        (self.catalog / 'source-gtfs.sha256').write_text(self.sha)
        self.evidence = self.root / 'evidence.json'
        self.payload = {'sourceSha256': self.sha, 'redistributionPermitted': True,
                        'sourceUrl': 'https://example.org/gtfs.zip',
                        'licenseUrl': 'https://example.org/terms',
                        'reviewedOn': '2026-11-22', 'reviewer': 'independent reviewer'}
        self.save()
    def save(self):
        self.evidence.write_text(json.dumps(self.payload))
    def check(self, code):
        self.assertIn(code, audit(self.catalog, self.evidence)['errors'])
    def test_complete(self):
        self.assertEqual('pass', audit(self.catalog, self.evidence)['status'])
        self.assertEqual(0, main([str(self.catalog), '--evidence', str(self.evidence)]))
    def test_no_evidence(self):
        self.evidence.unlink()
        self.check('evidence_missing_or_invalid')
    def test_mismatch(self):
        self.payload['sourceSha256'] = 'b' * 64
        self.save()
        self.check('evidence_snapshot_hash_mismatch')
    def test_not_permitted(self):
        self.payload['redistributionPermitted'] = 'true'
        self.save()
        self.check('redistribution_permission_not_confirmed')
    def test_insecure_link(self):
        self.payload['licenseUrl'] = 'http://example.org'
        self.save()
        self.check('licenseUrl_missing_or_invalid')
    def test_missing_reviewer(self):
        self.payload['reviewer'] = ''
        self.save()
        self.check('reviewer_missing')
    def test_bad_date(self):
        self.payload['reviewedOn'] = '2026-02-30'
        self.save()
        self.check('review_date_missing_or_invalid')
    def test_bad_sha(self):
        (self.catalog / 'source-gtfs.sha256').write_text('bad')
        self.check('source_sha256_missing_or_invalid')
    def test_future_date(self):
        self.payload['reviewedOn'] = '2999-01-01'
        self.save()
        self.check('review_date_in_future')

if __name__ == '__main__':
    unittest.main()
