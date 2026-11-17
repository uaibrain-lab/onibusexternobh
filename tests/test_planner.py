"""Roteamento P5: GTFS sintético com viagens concorrentes e conexões reais."""
import csv
import datetime as dt
import io
import json
import pathlib
import tempfile
import unittest
import zipfile

from scripts.build_routing import build
from transit.planner import JourneyPlanner, PlannerError


def table(headers, rows):
    stream=io.StringIO()
    writer=csv.writer(stream)
    writer.writerow(headers)
    writer.writerows(rows)
    return stream.getvalue()


class RoutePlannerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        p=pathlib.Path(cls.temp.name)
        cls.cat=p/'catalog'
        cls.cat.mkdir()
        (cls.cat/'routes.json').write_text(json.dumps([
            {'code':'D','name':'Direta'},
            {'code':'X','name':'Origem / Integração'},
            {'code':'Y','name':'Integração / Destino'},
            {'code':'R','name':'Sentido contrário'},
            {'code':'P','name':'Embarque proibido'},
            {'code':'Q','name':'Desembarque proibido'},
        ]), encoding='utf-8')
        gtfs=p/'fixture.zip'
        with zipfile.ZipFile(gtfs,'w',zipfile.ZIP_DEFLATED) as z:
            z.writestr('routes.txt',table(
                ['route_id','route_short_name'],[['d','D'],['x','X'],['y','Y'],['r','R'],['p','P'],['q','Q']]))
            z.writestr('stops.txt',table(
                ['stop_id','stop_name','stop_lat','stop_lon'],
                [['a','Início',-19.900,-43.900],
                 ['b','Integração',-19.914,-43.900],
                 ['c','Destino',-19.929,-43.900]]))
            z.writestr('trips.txt',table(
                ['trip_id','route_id','service_id','trip_headsign'],
                [['direto','d','daily','Destino'],
                 ['conexao-a','x','daily','Integração'],
                 ['conexao-b','y','daily','Destino'],
                 ['reverso','r','daily','Início'],
                 ['sem-embarque','p','daily','Destino'],
                 ['sem-desembarque','q','daily','Destino']]))
            z.writestr('calendar.txt',table(
                ['service_id','monday','tuesday','wednesday','thursday','friday',
                 'saturday','sunday','start_date','end_date'],
                [['daily',1,1,1,1,1,1,1,20261101,20261231]]))
            z.writestr('calendar_dates.txt',table(
                ['service_id','date','exception_type'],
                [['daily',20261119,2]]))
            rows=[
                ['direto','08:00:00','08:00:00','a',1],
                ['direto','08:40:00','08:40:00','c',2],
                ['conexao-a','08:05:00','08:05:00','a',1],
                ['conexao-a','08:15:00','08:15:00','b',2],
                ['conexao-b','08:20:00','08:20:00','b',1],
                ['conexao-b','08:30:00','08:30:00','c',2],
                ['reverso','08:08:00','08:08:00','c',1],
                ['reverso','08:20:00','08:20:00','a',2],
                ['sem-embarque','07:57:00','07:57:00','a',1],
                ['sem-embarque','08:10:00','08:10:00','c',2],
                ['sem-desembarque','07:58:00','07:58:00','a',1],
                ['sem-desembarque','08:12:00','08:12:00','c',2],
            ]
            rows=[row+(
                 [1,0] if row[0]=='sem-embarque' and row[3]=='a'
                 else [0,1] if row[0]=='sem-desembarque' and row[3]=='c'
                 else [0,0]) for row in rows]
            z.writestr('stop_times.txt',table(
                ['trip_id','arrival_time','departure_time','stop_id',
                 'stop_sequence','pickup_type','drop_off_type'],rows))
        cls.index=build(gtfs,cls.cat)
        cls.planner=JourneyPlanner(cls.cat)
        cls.a={'lat':-19.900,'lng':-43.900}
        cls.c={'lat':-19.929,'lng':-43.900}
        cls.at='2026-11-17T07:50:00-03:00'

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_build_trip_sequences(self):
        self.assertEqual(self.index['schema'],2)
        self.assertEqual(self.index['tripCount'],6)
        self.assertEqual(self.index['stopTimeRows'],12)
        direct=self.planner._trips('D')
        self.assertEqual(direct[0][0],'direto')
        self.assertEqual([row[0] for row in direct[0][3]],['a','c'])

    def test_fastest_can_choose_transfer(self):
        r=self.planner.plan(self.a,self.c,self.at)
        self.assertEqual(r['status'],'ok')
        self.assertTrue(r['itineraries'],r)
        self.assertEqual(r['itineraries'][0]['transfers'],1,r)
        lines=[x['line'] for x in r['itineraries'][0]['legs'] if x['mode']=='bus']
        self.assertEqual(lines,['X','Y'],r)

    def test_fewest_transfers_prefers_direct(self):
        r=self.planner.plan(self.a,self.c,self.at,preference='leastTransfers')
        self.assertTrue(r['itineraries'],r)
        self.assertEqual(r['itineraries'][0]['transfers'],0,r)
        self.assertEqual(
            [x['line'] for x in r['itineraries'][0]['legs'] if x['mode']=='bus'],['D'])

    def test_arrive_by_reverses_search(self):
        r=self.planner.plan(self.a,self.c,'2026-11-17T08:45:00-03:00',mode='arriveBy')
        self.assertTrue(r['itineraries'],r)
        self.assertTrue(all(x['arrival']<='2026-11-17T08:45:00-03:00'
                            for x in r['itineraries']))
        self.assertEqual(
            [x['line'] for x in r['itineraries'][0]['legs'] if x['mode']=='bus'],['X','Y'])
        self.assertTrue(r['itineraries'][0]['arrival'].startswith('2026-11-17T08:3'))

    def test_service_exception_excludes_trip(self):
        r=self.planner.plan(self.a,self.c,'2026-11-19T07:50:00-03:00')
        self.assertEqual(r['itineraries'],[])

    def test_out_of_calendar_refuses_to_invent(self):
        r=self.planner.plan(self.a,self.c,'2027-01-05T07:50:00-03:00')
        self.assertEqual(r['status'],'out_of_calendar')
        self.assertFalse(r['itineraries'])

    def test_reverse_line_not_offered_for_wrong_direction(self):
        r=self.planner.plan(self.a,self.c,self.at)
        lines=[leg['line'] for option in r['itineraries'] for leg in option['legs']
               if leg['mode']=='bus']
        self.assertNotIn('R',lines)

    def test_non_boardable_and_non_alightable_trips_excluded(self):
        result=self.planner.plan(self.a,self.c,self.at)
        for itinerary in result['itineraries']:
            self.assertFalse(any(leg.get('line') in ('P','Q')
                                 for leg in itinerary['legs']),itinerary)
        reverse=self.planner.plan(self.a,self.c,
            '2026-11-17T08:45:00-03:00',mode='arriveBy')
        for itinerary in reverse['itineraries']:
            self.assertFalse(any(leg.get('line') in ('P','Q')
                                 for leg in itinerary['legs']),itinerary)

    def test_bad_coords_rejected(self):
        with self.assertRaises(PlannerError):
            self.planner.plan({'lat':'nan','lng':0},self.c,self.at)

    def test_missing_index_state(self):
        with tempfile.TemporaryDirectory() as p:
            planner=JourneyPlanner(pathlib.Path(p))
            self.assertFalse(planner.ready)
            result=planner.plan(self.a,self.c,self.at)
            self.assertEqual(result['status'],'not_ready')


if __name__=='__main__':
    unittest.main()
