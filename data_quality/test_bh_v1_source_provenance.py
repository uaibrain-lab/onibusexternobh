"""Synthetic GTFS ZIP tests only. No real departures, license or URLs asserted."""
import csv
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from data_quality.bh_v1_source_provenance import audit_source_zip
from data_quality.bh_v1_release_gate import audit


class SourceProvenanceTests(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = Path(t.name)
        self.zip = self.root / 'municipal.zip'
        self.rows = {
            'routes.txt': [{'route_id':'R1','route_short_name':'TEST'}],
            'stops.txt': [
                {'stop_id':'S1','stop_name':'Origem','stop_lat':'-19.9','stop_lon':'-43.9'},
                {'stop_id':'S2','stop_name':'Destino','stop_lat':'-19.91','stop_lon':'-43.91'}],
            'trips.txt': [{'trip_id':'T1','route_id':'R1','service_id':'W','trip_headsign':'Destino'}],
            'stop_times.txt': [
                {'trip_id':'T1','stop_id':'S1','stop_sequence':'1','arrival_time':'23:50:00','departure_time':'23:50:00'},
                {'trip_id':'T1','stop_id':'S2','stop_sequence':'2','arrival_time':'24:10:00','departure_time':'24:10:00'}],
            'calendar.txt': [{'service_id':'W','monday':'1','tuesday':'1','wednesday':'1','thursday':'1',
                              'friday':'1','saturday':'0','sunday':'0','start_date':'20261101','end_date':'20261231'}],
            'calendar_dates.txt': [{'service_id':'W','date':'20261128','exception_type':'1'}],
            'feed_info.txt': [{'feed_version':'synthetic-1','feed_start_date':'20261101','feed_end_date':'20261231'}],
        }
        self.manifest = {'gtfsVersion':'synthetic-1','feedStartDate':'20261101','feedEndDate':'20261231',
                         'routes':1,'stops':2,'trips':1,'stopTimeRows':2}
        self.catalog_routes = [{'id':'R1','code':'TEST'}]
        self.catalog_stops = {'S1':['Origem',-19.9,-43.9], 'S2':['Destino',-19.91,-43.91]}
        self.make()

    def make(self):
        with zipfile.ZipFile(self.zip, 'w', zipfile.ZIP_DEFLATED) as z:
            for name, rows in self.rows.items():
                if not rows:
                    continue
                content = io.StringIO(newline='')
                writer = csv.DictWriter(content, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
                z.writestr(name, content.getvalue())
        (self.root/'source-gtfs.sha256').write_text(hashlib.sha256(self.zip.read_bytes()).hexdigest())
        (self.root/'manifest.json').write_text(json.dumps(self.manifest))
        (self.root/'routes.json').write_text(json.dumps(self.catalog_routes))
        (self.root/'stops.json').write_text(json.dumps(self.catalog_stops))
        c = {r['service_id']:{k:v for k,v in r.items() if k!='service_id'} for r in self.rows['calendar.txt']}
        ex = {row['date']:{row['service_id']:int(row['exception_type'])} for row in self.rows['calendar_dates.txt']}
        (self.root/'timetable-calendar.json').write_text(json.dumps({'services':c,'exceptions':ex,'records':2,'stops':2}))
        (self.root/'metro.json').write_text(json.dumps({'lines':[{'id':'1','stations':['station-1']}],
            'stations':[{'id':'station-1','lat':-19.9,'lng':-43.9,'lines':['1']}] }))

    def audit(self):
        return audit_source_zip(self.root,self.zip)

    def test_release_gate_optional_source_zip(self):
        result = audit(self.root, "20261124", source_archive=self.zip, require_source_archive=True)
        self.assertEqual(result["status"], "pass", result)
        self.assertEqual(result["sourceAudit"]["status"], "pass")

    def test_release_gate_blocks_missing_required_zip(self):
        result = audit(self.root, "20261124", require_source_archive=True)
        self.assertIn("source_zip_required_for_release", result["errors"])

    def test_release_gate_checks_digest(self):
        (self.root/"source-gtfs.sha256").write_text("0"*64)
        result = audit(self.root, "20261124", source_archive=self.zip, require_source_archive=True)
        self.assertIn("source_zip_checksum_mismatch", result["errors"])

    def test_exact_source_passes(self):
        result=self.audit()
        self.assertEqual(result['status'],'pass',result)
        self.assertEqual(result['stopTimeRows'],2)
        self.assertEqual(result['licensedForRedistribution'],'unverified')

    def test_checksum_mismatch_blocks_even_valid_zip(self):
        (self.root/'source-gtfs.sha256').write_text('0'*64)
        self.assertIn('source_zip_checksum_mismatch',self.audit()['errors'])

    def test_routes_changed_after_source_blocks(self):
        self.catalog_routes[0]['code']='WRONG'
        (self.root/'routes.json').write_text(json.dumps(self.catalog_routes))
        self.assertIn('source_routes_do_not_match_catalog',self.audit()['errors'])

    def test_stop_coordinates_mismatch_blocks(self):
        self.catalog_stops['S2'][1]=-18.0
        (self.root/'stops.json').write_text(json.dumps(self.catalog_stops))
        self.assertIn('source_stop_details_do_not_match_catalog',self.audit()['errors'])

    def test_calendar_exception_mismatch_blocks(self):
        (self.root/'timetable-calendar.json').write_text(json.dumps({'services':{},'exceptions':{},'records':2}))
        self.assertIn('source_calendar_does_not_match_catalog',self.audit()['errors'])
        self.assertIn('source_exceptions_do_not_match_catalog',self.audit()['errors'])

    def test_orphan_stop_time_blocks(self):
        self.rows['stop_times.txt'][0]['stop_id']='BAD'
        self.make()
        self.assertIn('source_stop_time_orphan_reference',self.audit()['errors'])

    def test_overnight_time_supported(self):
        self.rows['stop_times.txt'][0]['arrival_time']='25:30:00'
        self.rows['stop_times.txt'][0]['departure_time']='25:30:00'
        self.make()
        self.assertEqual(self.audit()['status'],'pass')

    def test_unexportable_48_hour_stop_time_blocks(self):
        self.rows['stop_times.txt'][1]['arrival_time']='48:05:00'
        self.rows['stop_times.txt'][1]['departure_time']='48:05:00'
        self.make()
        self.assertIn('source_stop_time_invalid',self.audit()['errors'])

    def test_trip_count_mismatch_blocks(self):
        self.manifest['trips']=2
        self.make()
        self.assertIn('source_trip_count_mismatch',self.audit()['errors'])

    def test_calendar_dates_only_service_supported(self):
        self.rows['calendar.txt']=[]
        self.rows['calendar_dates.txt']=[{'service_id':'W','date':'20261124','exception_type':'1'}]
        self.make()
        self.assertEqual(self.audit()['status'],'pass',self.audit())

    def test_duplicate_zip_member_blocks(self):
        with zipfile.ZipFile(self.zip, 'a') as z:
            z.writestr('nested/routes.txt','junk')
        (self.root/'source-gtfs.sha256').write_text(hashlib.sha256(self.zip.read_bytes()).hexdigest())
        self.assertIn('source_zip_unreadable_or_invalid',self.audit()['errors'])

    def test_manifest_version_mismatch_blocks(self):
        self.manifest['gtfsVersion']='wrong'
        self.make()
        self.assertIn('source_feed_info_mismatch',self.audit()['errors'])


if __name__=='__main__':
    unittest.main()
