"""A walking graph must follow real OSM ways, not cross disconnected streets."""
import pathlib
import tempfile
import unittest
from scripts.build_walking_graph import build,can_walk

XML="""<?xml version="1.0"?>
<osm version="0.6">
 <node id="1" lat="-19.9000" lon="-43.9000"/>
 <node id="2" lat="-19.9001" lon="-43.9000"/>
 <node id="3" lat="-19.9002" lon="-43.9000"/>
 <node id="4" lat="-19.9001" lon="-43.9002"/>
 <node id="5" lat="-19.9002" lon="-43.9002"/>
 <node id="6" lat="-19.9001" lon="-43.9003">
  <tag k="barrier" v="wall"/>
 </node>
 <way id="100"><nd ref="1"/><nd ref="2"/><nd ref="3"/>
  <tag k="highway" v="footway"/></way>
 <way id="101"><nd ref="4"/><nd ref="5"/>
  <tag k="highway" v="residential"/></way>
 <way id="102"><nd ref="5"/><nd ref="6"/>
  <tag k="highway" v="footway"/></way>
 <way id="103"><nd ref="2"/><nd ref="4"/>
  <tag k="highway" v="motorway"/></way>
</osm>
"""


class WalkingGraphTest(unittest.TestCase):
    def test_open_street_routes_and_disconnected_motoway(self):
        with tempfile.TemporaryDirectory() as folder:
            p=pathlib.Path(folder)/'sample.osm'
            output=pathlib.Path(folder)/'graph.json.gz'
            p.write_text(XML,encoding='utf-8')
            result=build(p,output,bounds=(-19.91,-43.91,-19.89,-43.89),source='fixture OSM')
            self.assertEqual(result['nodeCount'],5)
            self.assertEqual(result['edgeCount'],3)
            self.assertTrue(output.is_file())
            self.assertEqual(result['source'],'fixture OSM')
            self.assertFalse(any(set(e[:2])=={1,3} for e in result['edges']))

    def test_private_and_motorway_rejected(self):
        self.assertFalse(can_walk({'highway':'motorway'}))
        self.assertFalse(can_walk({'highway':'residential','access':'private'}))
        self.assertFalse(can_walk({'highway':'footway','foot':'no'}))
        self.assertFalse(can_walk({'highway':'cycleway'}))
        self.assertTrue(can_walk({'highway':'footway'}))
        self.assertTrue(can_walk({'highway':'residential'}))
        self.assertTrue(can_walk({'highway':'cycleway','foot':'designated'}))


if __name__=='__main__':
    unittest.main()
