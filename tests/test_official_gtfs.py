"""Reject expired, incomplete or unchanged GTFS archives before daily refresh."""
import datetime as dt
import pathlib
import tempfile
import unittest
import zipfile
from scripts.check_official_gtfs import check


class OfficialGtfsTests(unittest.TestCase):
    def create_zip(self,path,until='20261231',calendar=True):
        with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('routes.txt','route_id,route_short_name\n1,1\n')
            archive.writestr('stops.txt','stop_id,stop_name,stop_lat,stop_lon\n1,Stop,-19.9,-43.9\n')
            archive.writestr('trips.txt','route_id,service_id,trip_id\n'+
                             ''.join('1,WK,T%d\n'%i for i in range(60)))
            archive.writestr('stop_times.txt',
                             'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'+
                             ('T1,08:00:00,08:00:00,1,1\n')*80)
            if calendar:
                archive.writestr('calendar.txt','service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n'
                                 'WK,1,1,1,1,1,0,0,20261101,'+until+'\n')

    def test_digest_and_no_change(self):
        with tempfile.TemporaryDirectory() as folder:
            base=pathlib.Path(folder)
            source=base/'source.zip'
            self.create_zip(source)
            first=check(source,base/'digest.sha256',dt.date(2026,11,17))
            self.assertTrue(first['changed'])
            self.assertEqual(first['validThrough'],'20261231')
            (base/'digest.sha256').write_text(first['sha256'])
            second=check(source,base/'digest.sha256',dt.date(2026,11,17))
            self.assertFalse(second['changed'])

    def test_reject_expired_without_mutating_archive(self):
        with tempfile.TemporaryDirectory() as folder:
            source=pathlib.Path(folder)/'source.zip'
            self.create_zip(source,until='20261001')
            with self.assertRaisesRegex(ValueError,'vencido'):
                check(source,None,dt.date(2026,11,17))

    def test_reject_missing_calendar(self):
        with tempfile.TemporaryDirectory() as folder:
            source=pathlib.Path(folder)/'source.zip'
            self.create_zip(source,calendar=False)
            with self.assertRaisesRegex(ValueError,'incompleto'):
                check(source)

    def test_reject_missing_files(self):
        with tempfile.TemporaryDirectory() as folder:
            source=pathlib.Path(folder)/'source.zip'
            with zipfile.ZipFile(source,'w') as z:
                z.writestr('calendar.txt','start_date,end_date\n20260101,20261231\n')
            with self.assertRaisesRegex(ValueError,'incompleto'):
                check(source)


if __name__=='__main__':
    unittest.main()
