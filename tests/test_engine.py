import datetime as dt, json, pathlib, tempfile, unittest
from transit.engine import TransitEngine, now_brt

BASE=pathlib.Path(__file__).resolve().parents[1]
FILES=['routes.json','stops.json','shapes.json','patterns.json','gps-nl-map.json']

class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=pathlib.Path(self.tmp.name)
        (self.root/'catalog').mkdir();(self.root/'state').mkdir()
        for f in FILES: (self.root/'catalog'/f).write_bytes((BASE/'catalog'/f).read_bytes())
        self.d=now_brt().replace(microsecond=0)
        self.current=[]
        self.engine=TransitEngine(self.root,fetcher=lambda url:list(self.current) if "?param=D" in url else [],ttl=35)

    def tearDown(self):self.tmp.cleanup()

    def record(self,t,lat=-19.95,lng=-43.97,nv='20884',nl='660'):
        return {'HR':t.strftime('%Y%m%d%H%M%S'),'LT':str(lat),'LG':str(lng),
                'NV':nv,'NL':nl,'EV':'105','VL':'0','DG':'90','SV':'1','DT':'0'}

    def test_preserves_unchanged_clock_with_new_fix_and_restart(self):
        a=self.record(self.d-dt.timedelta(seconds=100))
        b=self.record(self.d-dt.timedelta(seconds=60))
        self.current[:]=[a,b]
        self.engine.refresh(force=True)
        v=self.engine.vehicles['CONVENCIONAL|20884']
        first=v['positionUnchangedSinceAt']
        self.assertEqual(first, (self.d-dt.timedelta(seconds=100)).isoformat())
        self.assertEqual(v['lastGpsFixAt'],(self.d-dt.timedelta(seconds=60)).isoformat())
        self.current.append(self.record(self.d-dt.timedelta(seconds=3)))
        self.engine.refresh(force=True)
        v=self.engine.vehicles['CONVENCIONAL|20884']
        self.assertEqual(v['positionUnchangedSinceAt'],first)
        self.assertEqual(v['lastGpsFixAt'],(self.d-dt.timedelta(seconds=3)).isoformat())
        # Restart with the persisted state file.
        next_engine=TransitEngine(self.root,fetcher=lambda url:list(self.current) if "?param=D" in url else [])
        self.assertEqual(next_engine.vehicles['CONVENCIONAL|20884']['positionUnchangedSinceAt'],first)
        next_engine.refresh(force=True)
        self.assertEqual(next_engine.vehicles['CONVENCIONAL|20884']['positionUnchangedSinceAt'],first)

    def test_change_and_jitter(self):
        self.current[:]=[self.record(self.d-dt.timedelta(seconds=40)),
          self.record(self.d-dt.timedelta(seconds=30),lat=-19.95004), # ~4.5m jitter
          self.record(self.d-dt.timedelta(seconds=20),lat=-19.9502)] # ~22m real move
        self.engine.refresh(force=True)
        v=self.engine.vehicles['CONVENCIONAL|20884']
        self.assertEqual(v['positionUnchangedSinceAt'],(self.d-dt.timedelta(seconds=20)).isoformat())

    def test_route_lookup_and_no_guess_from_single_fix(self):
        self.current[:]=[self.record(self.d-dt.timedelta(seconds=6),nl='660')]
        self.engine.refresh(force=True)
        fleet=self.engine.fleet('9250')
        self.assertEqual(fleet['count'],1)
        self.assertEqual(fleet['vehicles'][0]['shapeMatch']['status'],'ambiguous')
        self.assertEqual(fleet['vehicles'][0]['shapeMatch']['shapeId'],None)

    def test_source_failure_does_not_overwrite_fix(self):
        self.current[:]=[self.record(self.d-dt.timedelta(seconds=3))]
        self.engine.refresh(force=True)
        fix=self.engine.vehicles['CONVENCIONAL|20884']['lastGpsFixAt']
        def fail(url):raise TimeoutError('offline')
        self.engine.fetcher=fail
        self.engine.refresh(force=True)
        self.assertEqual(self.engine.vehicles['CONVENCIONAL|20884']['lastGpsFixAt'],fix)
        self.assertIsNotNone(self.engine.sources['CONVENCIONAL']['lastError'])

    def test_search_all_stops_and_limit(self):
        result=self.engine.search_stops('UFMG')
        self.assertGreaterEqual(len(result['items']),1)
        self.assertTrue(all('UFMG' in x['name'].upper() for x in result['items']))
        bounded=self.engine.search_stops('Avenida',limit=4)
        self.assertEqual(len(bounded['items']),4)
        self.assertTrue(bounded['truncated'])

    def test_recent_fixes_not_confused_with_visit_count(self):
        self.current[:]=[self.record(self.d-dt.timedelta(seconds=60)),
                          self.record(self.d-dt.timedelta(seconds=60)),
                          self.record(self.d-dt.timedelta(seconds=30))]
        self.engine.refresh(force=True)
        v=self.engine.vehicles['CONVENCIONAL|20884']
        self.assertEqual(len(v['history']),2)

if __name__=='__main__':unittest.main()
