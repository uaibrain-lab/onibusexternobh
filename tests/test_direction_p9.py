"""Direction-safe timetables and nearby alternatives; no fake side-of-road."""
import datetime as dt
from pathlib import Path
import unittest
from transit.engine import TransitEngine,BRT
from transit.timetable import Timetable

ROOT=Path(__file__).resolve().parents[1]

class DirectionP9Tests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,11,17,7,0,tzinfo=BRT)

    def test_same_line_opposite_destinations_are_separate(self):
        tt=Timetable(ROOT/'catalog')
        tt.calendar={'services':{'S':{'start_date':'20260101','end_date':'20261231',
            'monday':'1','tuesday':'1','wednesday':'1','thursday':'1','friday':'1',
            'saturday':'1','sunday':'1'}},'exceptions':{}}
        tt.stops={'stop':[['51','S','Centro',[7*3600+10*60,7*3600+30*60]],
                          ['51','S','Bairro',[7*3600+15*60,7*3600+40*60]]]}
        result=tt.next_by_direction('stop',self.now)
        self.assertEqual(set(result),{('51','Centro'),('51','Bairro')})
        self.assertEqual(result[('51','Centro')]['minutes'],10)
        self.assertEqual(result[('51','Bairro')]['minutes'],15)
        self.assertEqual(result[('51','Centro')]['following'][0]['minutes'],30)
        self.assertEqual(tt.next_by_line('stop',self.now)['51']['destination'],'Centro')

    def test_stop_detail_renders_two_directions_separately(self):
        engine=TransitEngine(ROOT,fetcher=lambda _:[])
        code='5102'
        sample=lambda name,minutes:{'type':'scheduled','destination':name,
             'at':(self.now+dt.timedelta(minutes=minutes)).isoformat(),
             'minutes':minutes,'following':[]}
        engine.timetable.next_by_direction=lambda *_:{(code,'Centro'):sample('Centro',5),
                                                      (code,'Bairro'):sample('Bairro',11)}
        detail=engine.stop_detail('14791407',self.now)
        relevant=[r for r in detail['routes'] if r['code']==code]
        self.assertEqual({r['destination'] for r in relevant},{'Centro','Bairro'})
        self.assertEqual([r['nextArrival']['minutes'] for r in relevant],[5,11])

    def test_alternative_stop_is_nearby_candidate_not_claimed_platform(self):
        engine=TransitEngine(ROOT,fetcher=lambda _:[])
        sid='14791407';original=engine.stops[sid]
        fake='P9_OTHER';engine.stops[fake]=['Outro ponto',original[1]+.00012,original[2]]
        engine.stop_routes[fake].add('5102')
        engine.stop_directions[fake].add(('5102','Destino oposto'))
        found=engine.alternative_stops(sid,radius_m=100,limit=20)
        self.assertTrue(any(x['id']==fake for x in found))
        self.assertTrue(all('side' not in x and 'platform' not in x for x in found))

if __name__=='__main__':unittest.main()
