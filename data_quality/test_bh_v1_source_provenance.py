"""Synthetic GTFS ZIP tests only. No real departures, license or URLs asserted."""
import csv
import gzip
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

    def make_full_static_release(self, changed=False):
        """Synthetic ZIP, timetable and all 256 shards as a complete V1 package."""
        from data_quality.static_arrivals_reference import _bucket_id
        sharded = self.root / 'arrivals'
        sharded.mkdir(exist_ok=True)
        schedule = {
            'S1': [['TEST','W','Destino',[85800]]],
            'S2': [['TEST','W','Destino',[87000 + (60 if changed else 0)]]],
        }
        with gzip.open(self.root / 'timetable.json.gz', 'wt', encoding='utf-8') as f:
            for sid in ('S1', 'S2'):
                f.write(json.dumps([sid, schedule[sid]]) + '\n')
        cal = json.loads((self.root / 'timetable-calendar.json').read_text())
        (sharded / 'calendar.json').write_text(json.dumps(cal))
        sizes = {}
        for n in range(256):
            key = f'{n:02x}'
            group = {sid: value for sid, value in schedule.items() if _bucket_id(sid)==key}
            blob = gzip.compress(json.dumps(group).encode('utf-8'), mtime=0)
            name = key + '.json.gz'
            (sharded / name).write_bytes(blob)
            sizes[name] = len(blob)
        idx = {'schema': 1, 'buckets': 256, 'version': 'synthetic-1',
               'validThrough': '20261231', 'stopCount': 2, 'sizes': sizes}
        (sharded / 'index.json').write_text(json.dumps(idx))
        return sharded / 'index.json'

    def test_full_strict_release_source_equals_compiled_and_shards(self):
        idx = self.make_full_static_release()
        result = audit(self.root, '20261124', arrivals_index=idx, require_arrivals=True,
                       source_archive=self.zip, require_source_archive=True)
        self.assertEqual(result['status'], 'pass', result)
        self.assertEqual(result['zipTimetableAudit']['sourceStopTimeRows'], 2)
        self.assertEqual(result['zipTimetableAudit']['status'], 'pass')

    def test_full_strict_release_blocks_changed_times_even_if_shards_match(self):
        idx = self.make_full_static_release(changed=True)
        result = audit(self.root, '20261124', arrivals_index=idx, require_arrivals=True,
                       source_archive=self.zip, require_source_archive=True)
        self.assertEqual(result['sourceAudit']['status'], 'pass', result)
        self.assertEqual(result['arrivalsAudit']['errors'], [], result)
        self.assertEqual(result['timetableAudit']['errors'], [], result)
        self.assertIn('zip_stop_times_differ_from_compiled_timetable', result['errors'])
        self.assertEqual(result['status'], 'blocked')


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

    def test_trip_without_stop_times_blocks(self):
        self.rows["trips.txt"].append({"trip_id":"T2","route_id":"R1","service_id":"W","trip_headsign":"Destino"})
        self.manifest["trips"] = 2
        self.make()
        self.assertIn("source_trips_without_stop_times", self.audit()["errors"])

    def test_calendar_service_without_departures_blocks_release(self):
        self.rows["calendar.txt"][0]["tuesday"]="0"
        self.rows["calendar_dates.txt"].append({"service_id":"SPECIAL","date":"20261124","exception_type":"1"})
        self.make()
        source = self.audit()
        self.assertEqual(source["status"], "pass", source)
        report = audit(self.root, "20261124", source_archive=self.zip, require_source_archive=True)
        self.assertIn("active_service_without_scheduled_trips",report["errors"])

    def test_trip_stop_sequence_duplicate_blocks(self):
        self.rows['stop_times.txt'][1]['stop_sequence'] = '1'
        self.make()
        self.assertIn('source_stop_sequence_not_increasing', self.audit()['errors'])

    def test_trip_time_moves_backward_blocks(self):
        self.rows['stop_times.txt'][1]['arrival_time'] = '23:30:00'
        self.rows['stop_times.txt'][1]['departure_time'] = '23:30:00'
        self.make()
        self.assertIn('source_trip_times_not_monotonic', self.audit()['errors'])

    def test_trip_with_only_one_stop_blocks(self):
        self.rows['stop_times.txt'] = self.rows['stop_times.txt'][:1]
        self.make()
        self.assertIn('source_trips_with_fewer_than_two_stops', self.audit()['errors'])

    def test_trip_disjoint_blocks_blocks(self):
        self.rows['trips.txt'].append({
            'trip_id':'T2', 'route_id':'R1', 'service_id':'W', 'trip_headsign':'Destino'
        })
        self.rows['stop_times.txt'].insert(1, {
            'trip_id':'T2', 'stop_id':'S1', 'stop_sequence':'1',
            'arrival_time':'23:55:00', 'departure_time':'23:55:00'
        })
        self.rows['stop_times.txt'].append({
            'trip_id':'T2', 'stop_id':'S2', 'stop_sequence':'2',
            'arrival_time':'24:20:00', 'departure_time':'24:20:00'
        })
        self.manifest['trips'] = 2
        self.make()
        self.assertIn('source_trip_noncontiguous_stop_times', self.audit()['errors'])

    def test_manifest_version_mismatch_blocks(self):
        self.manifest['gtfsVersion']='wrong'
        self.make()
        self.assertIn('source_feed_info_mismatch',self.audit()['errors'])


if __name__=='__main__':
    unittest.main()
