"""GTFS validation refuses partial or expired feeds; staging is non-destructive."""
import csv
import datetime as dt
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from scripts.update_gtfs import build, apply_staging, OUTPUTS


def table(headers, rows):
    stream=io.StringIO();writer=csv.writer(stream);writer.writerow(headers);writer.writerows(rows)
    return stream.getvalue()


class UpdaterP9Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.catalog=self.root/'catalog';self.catalog.mkdir()
        (self.catalog/'manifest.json').write_text(json.dumps({'routes':1,'stops':2}))
        (self.catalog/'routes.json').write_text(json.dumps([{'id':'OLD','code':'51'}]))
        (self.catalog/'stops.json').write_text(json.dumps({'A':['A',-19.8,-43.9],
                                                        'B':['B',-19.81,-43.9]}))
        (self.catalog/'gps-nl-map.json').write_text(json.dumps({
            'CONVENCIONAL|99':{'public':'51-01','routeIds':['OLD'],'status':'NOME_BASE_APENAS'}}))
        self.archive=self.root/'data.zip'
        self.data={
            'routes.txt':table(['route_id','route_short_name','route_long_name','agency_id'],[['NEW','51','Centro/Bairro','X']]),
            'stops.txt':table(['stop_id','stop_name','stop_lat','stop_lon'],[['A','Parada A',-19.8,-43.9],['B','Parada B',-19.81,-43.9]]),
            'shapes.txt':table(['shape_id','shape_pt_lat','shape_pt_lon','shape_pt_sequence'],[['1',-19.8,-43.9,1],['1',-19.81,-43.9,2]]),
            'trips.txt':table(['trip_id','route_id','service_id','shape_id','direction_id','trip_headsign'],[['T','NEW','S','1','0','Centro']]),
            'stop_times.txt':table(['trip_id','arrival_time','departure_time','stop_id','stop_sequence'],[['T','07:00:00','07:00:00','A',1],['T','07:05:00','07:05:00','B',2]]),
            'calendar.txt':table(['service_id','monday','tuesday','wednesday','thursday','friday','saturday','sunday','start_date','end_date'],[['S',1,1,1,1,1,1,1,'20260101','20261231']]),
            'calendar_dates.txt':table(['service_id','date','exception_type'],[]),
            'feed_info.txt':table(['feed_version','feed_start_date','feed_end_date'],[['test','20260101','20261231']])}
        self.write_archive()

    def write_archive(self):
        with zipfile.ZipFile(self.archive,'w') as z:
            for name,body in self.data.items():z.writestr(name,body)

    def test_candidate_is_complete_without_mutating_live_catalog(self):
        candidate=self.root/'candidate'
        result=build(self.archive,candidate,self.catalog,today=dt.date(2026,11,17))
        self.assertEqual(result['routes'],1)
        self.assertEqual(result['stops'],2)
        self.assertTrue(all((candidate/name).exists() for name in OUTPUTS))
        remap=json.loads((candidate/'gps-nl-map.json').read_text())
        self.assertEqual(remap['CONVENCIONAL|99']['routeIds'],['NEW'])
        self.assertEqual(json.loads((self.catalog/'routes.json').read_text())[0]['id'],'OLD')

    def test_missing_required_gtfs_file_rejected_without_change(self):
        del self.data['stops.txt'];self.write_archive()
        with self.assertRaisesRegex(ValueError,'faltando'):
            build(self.archive,self.root/'candidate',self.catalog,today=dt.date(2026,11,17))
        self.assertEqual(json.loads((self.catalog/'routes.json').read_text())[0]['id'],'OLD')

    def test_expired_calendar_rejected(self):
        self.data['calendar.txt']=self.data['calendar.txt'].replace('20261231','20261119')
        self.write_archive()
        with self.assertRaisesRegex(ValueError,'Calendário'):
            build(self.archive,self.root/'candidate',self.catalog,today=dt.date(2026,11,17))

    def test_apply_after_validation(self):
        candidate=self.root/'candidate'
        build(self.archive,candidate,self.catalog,today=dt.date(2026,11,17))
        apply_staging(candidate,self.catalog)
        self.assertEqual(json.loads((self.catalog/'routes.json').read_text())[0]['id'],'NEW')

if __name__=='__main__':unittest.main()
