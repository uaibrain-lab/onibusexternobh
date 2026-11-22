"""Synthetic regression tests for BH municipal freshness monitor."""
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from data_quality.bh_v1_freshness import monitor

class FreshnessTests(unittest.TestCase):
    def setUp(self):
        t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.root=Path(t.name)
        self.manifest={'feedStartDate':'20261101','feedEndDate':'20261231','createdAtUtc':'2026-11-20T12:00:00+00:00'}
        self.calendar={'services':{'A':{'start_date':'20261101','end_date':'20261231',**{x:'1' for x in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')}}},'exceptions':{}}
        self.save()
    def save(self):
        (self.root/'manifest.json').write_text(json.dumps(self.manifest))
        (self.root/'timetable-calendar.json').write_text(json.dumps(self.calendar))
    def audit(self,day='20261122',horizon=14):
        self.save();return monitor(self.root,dt.datetime.strptime(day,'%Y%m%d').date(),horizon)
    def test_pass(self):self.assertEqual(self.audit()['status'],'pass')
    def test_expiry(self):self.assertIn('horizon_outside_feed_validity',self.audit('20261228')['errors'])
    def test_expiry_warning(self):self.assertIn('feed_expires_soon',self.audit('20261220',2)['warnings'])
    def test_missing_weekend(self):
        self.calendar['services']['A']['sunday']='0'
        self.assertIn('days_without_scheduled_service',self.audit()['errors'])
    def test_exception_adds_service(self):
        self.calendar['services']['A']['sunday']='0'
        self.calendar['exceptions']={d:{'A':1} for d in ('20261122','20261129','20261206')}
        self.assertEqual(self.audit()['status'],'pass')
    def test_bad_exception(self):
        self.calendar['exceptions']={'20261122':{'BAD':1}}
        self.assertIn('invalid_calendar_exception',self.audit()['errors'])
    def test_stale_warning(self):self.assertIn('snapshot_not_refreshed_recently',self.audit('20261210',1)['warnings'])
    def test_future_timestamp(self):
        self.manifest['createdAtUtc']='2026-12-30T12:00:00+00:00'
        self.assertIn('snapshot_created_in_future',self.audit()['errors'])
    def test_invalid_horizon(self):
        with self.assertRaises(ValueError):self.audit(horizon=61)

if __name__=='__main__':unittest.main()
