"""Integration: the static stop timetable is sharded and never treated as GPS."""
import gzip
import json
from pathlib import Path
import tempfile
import unittest

from scripts.build_static_arrivals import build, bucket_id


class IntegrationArrivalTests(unittest.TestCase):
    def test_256_small_shards_preserve_destinations_and_calendar(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            source=root/'catalog'
            source.mkdir()
            (source/'manifest.json').write_text(json.dumps({
                'gtfsVersion':'202611161919','feedEndDate':'20261231'}))
            (source/'timetable-calendar.json').write_text(json.dumps({
                'services':{'weekdays':{'monday':'1','start_date':'20261101',
                                       'end_date':'20261231'}},
                'exceptions':{}}))
            with gzip.open(source/'timetable.json.gz','wt',encoding='utf-8') as stream:
                for n in range(1100):
                    sid=str(1000000+n)
                    stream.write(json.dumps([sid,[
                      ['5102','weekdays','Centro',[25200,26400,28800]],
                      ['5102','weekdays','UFMG',[25800,27000]]]])+'\n')
            dest=root/'arrivals'
            meta=build(source,dest)
            self.assertEqual(meta['stopCount'],1100)
            self.assertEqual(meta['buckets'],256)
            self.assertEqual(len(list(dest.glob('*.json.gz'))),256)
            target='1000009'
            with gzip.open(dest/(bucket_id(target)+'.json.gz'),'rt',encoding='utf-8') as stream:
                content=json.load(stream)
            self.assertEqual([e[2] for e in content[target]],['Centro','UFMG'])
            self.assertLess((dest/(bucket_id(target)+'.json.gz')).stat().st_size,100000)
            self.assertIn('services',json.loads((dest/'calendar.json').read_text()))

    def test_missing_manifest_version_refuses_static_schedule(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/'manifest.json').write_text('{}')
            (root/'timetable-calendar.json').write_text('{"services":{"a":{}}}')
            with gzip.open(root/'timetable.json.gz','wt',encoding='utf8') as stream:
                for n in range(1100):stream.write(json.dumps([str(n),[]])+'\n')
            with self.assertRaises(ValueError):build(root,root/'arrivals')


if __name__=='__main__':
    unittest.main()
