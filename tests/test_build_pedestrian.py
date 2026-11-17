"""P9 OSM graph builder: OSM connectivity and walking access rules."""
import unittest
from scripts.build_pedestrian import allowed,build_graph,tile


class PedestrianBuildTests(unittest.TestCase):
    def test_connected_footway(self):
        nodes,edges,count=build_graph([
          ({'highway':'footway'},[
              (100,-19.9,-43.9),(101,-19.9002,-43.9),(102,-19.9002,-43.9002)])
        ])
        self.assertEqual(count,1)
        self.assertIn(101,edges[100])
        self.assertIn(100,edges[101])
        self.assertIn(102,edges[101])
        self.assertEqual(len(nodes),3)

    def test_bridge_does_not_connect_without_shared_osm_node(self):
        n,e,_=build_graph([
          ({'highway':'residential','bridge':'yes'},[
              (1,-19.9,-43.9),(2,-19.9001,-43.9001)]),
          ({'highway':'footway','tunnel':'yes'},[
              (3,-19.9,-43.9001),(4,-19.9001,-43.9)])
        ])
        self.assertEqual(set(e[1]),{2})
        self.assertNotIn(3,e[1])
        self.assertNotIn(4,e[1])

    def test_private_or_forbidden_footway_rejected(self):
        self.assertFalse(allowed({'highway':'footway','foot':'no'}))
        self.assertFalse(allowed({'highway':'service','access':'private'}))
        self.assertFalse(allowed({'highway':'motorway'}))
        self.assertTrue(allowed({'highway':'steps','foot':'yes'}))

    def test_oneway_foot_is_directional(self):
        n,e,_=build_graph([(
         {'highway':'steps','oneway:foot':'yes'},
         [(1,-19.9,-43.9),(2,-19.9002,-43.9)]
        )])
        self.assertIn(2,e[1])
        self.assertNotIn(1,e.get(2,{}))

    def test_tiles_on_negative_latitude_longitude(self):
        self.assertEqual(tile(-19.9,-43.9),'-1990_-4390')


if __name__=='__main__':
    unittest.main()
