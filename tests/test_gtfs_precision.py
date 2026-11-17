"""Verifies GTFS pickup/dropoff restrictions and overnight service times."""
import csv
import io
import json
import pathlib
import tempfile
import unittest
import zipfile

from scripts.build_routing import build
from transit.planner import JourneyPlanner


def csv_text(headers,rows):
    target=io.StringIO()
    writer=csv.writer(target)
    writer.writerow(headers)
    writer.writerows(rows)
    return target.getvalue()


class PreciseGTFSRulesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        folder=pathlib.Path(cls.temp.name)
        cls.catalog=folder/'catalog'
        cls.catalog.mkdir()
        routes=['OK','NOB','NOD','NIGHT']
        (cls.catalog/'routes.json').write_text(json.dumps(
            [{'code':code,'name':code} for code in routes]),encoding='utf8')
        archive=folder/'rules.zip'
        with zipfile.ZipFile(archive,'w') as z:
            z.writestr('routes.txt',csv_text(
                ['route_id','route_short_name'],[[c,c] for c in routes]))
            z.writestr('trips.txt',csv_text(
                ['trip_id','route_id','service_id','trip_headsign'],
                [[c,c,'day','Destino'] for c in routes]))
            z.writestr('stops.txt',csv_text(
                ['stop_id','stop_name','stop_lat','stop_lon'],
                [['a','Embarque',-19.9000,-43.9000],['b','Desembarque',-19.9190,-43.9000]]))
            z.writestr('calendar.txt',csv_text(
                ['service_id','monday','tuesday','wednesday','thursday','friday',
                 'saturday','sunday','start_date','end_date'],
                [['day',1,1,1,1,1,1,1,20261117,20261117]]))
            times=[]
            schedules=[
                ('OK','08:05:00','08:25:00',0,0),
                ('NOB','08:01:00','08:12:00',1,0),
                ('NOD','08:02:00','08:13:00',0,1),
                ('NIGHT','25:10:00','25:20:00',0,0),
            ]
            for trip,depart,arrive,not_board,not_drop in schedules:
                times.append([trip,'a',1,depart,depart,not_board,0])
                times.append([trip,'b',2,arrive,arrive,0,not_drop])
            z.writestr('stop_times.txt',csv_text(
                ['trip_id','stop_id','stop_sequence','arrival_time','departure_time',
                 'pickup_type','drop_off_type'],times))
        cls.index=build(archive,cls.catalog)
        cls.planner=JourneyPlanner(cls.catalog)
        cls.a={'lat':-19.9000,'lng':-43.9000}
        cls.b={'lat':-19.9190,'lng':-43.9000}

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_catalog_retains_pickup_restrictions(self):
        self.assertEqual(self.index['schema'],2)
        self.assertEqual(self.planner._trips('NOB')[0][3][0][3],1)
        self.assertEqual(self.planner._trips('NOD')[0][3][1][4],1)

    def test_no_pickup_or_dropoff_is_not_offered(self):
        result=self.planner.plan(self.a,self.b,'2026-11-17T07:55:00-03:00')
        trips={leg['line'] for r in result['itineraries']
               for leg in r['legs'] if leg['mode']=='bus'}
        self.assertIn('OK',trips)
        self.assertNotIn('NOB',trips)
        self.assertNotIn('NOD',trips)

    def test_service_after_midnight_uses_previous_calendar_day(self):
        result=self.planner.plan(self.a,self.b,'2026-11-18T01:00:00-03:00')
        self.assertTrue(result['itineraries'],result)
        trips={leg['line'] for r in result['itineraries']
               for leg in r['legs'] if leg['mode']=='bus'}
        self.assertIn('NIGHT',trips)
        self.assertTrue(result['itineraries'][0]['arrival'].startswith('2026-11-18T01:'))

    def test_date_two_days_past_calendar_is_refused(self):
        r=self.planner.plan(self.a,self.b,'2026-11-20T01:00:00-03:00')
        self.assertEqual(r['status'],'out_of_calendar')


if __name__=='__main__':
    unittest.main()
