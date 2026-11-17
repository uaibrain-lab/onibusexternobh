"""P6: não aceitar baldeação geométrica através de barreiras OSM."""
import gzip
import json
import pathlib
import tempfile
import unittest

from transit.walking import WalkingGraph
from scripts.build_walking import allowed,graph_of_waypoints


class WalkingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        root=pathlib.Path(self.temp.name)
        graph={
            'schema':1,
            'attribution':'© OpenStreetMap contributors',
            'nodes':[
                [-19.9000,-43.9000],[-19.9000,-43.8995],
                [-19.9000,-43.8990],[-19.9001,-43.8990],
            ],
            'edges':[[0,1,53,0],[1,2,53,1]],
        }
        with gzip.open(root/'walk-network.json.gz','wt',encoding='utf8') as f:
            json.dump(graph,f)
        self.graph=WalkingGraph(root)

    def tearDown(self):
        self.temp.cleanup()

    def test_pedestrian_path_is_connected(self):
        s=(-19.9000,-43.9000)
        e=(-19.9000,-43.8995)
        route=self.graph.route(s,e,max_meters=400,geometry=True)
        self.assertIsNotNone(route)
        self.assertTrue(route['meters']>=53)
        self.assertEqual(route['routeType'],'connected_osm_graph')
        self.assertFalse(route['accessVerified'])
        self.assertGreaterEqual(len(route['geometry']),4)

    def test_broken_bridge_cannot_be_walked_in_straight_line(self):
        # Node 3 is ~11 metres from node 2, but disconnected.
        route=self.graph.route((-19.9000,-43.8990),(-19.9001,-43.8990),
                               max_meters=300)
        self.assertIsNone(route)

    def test_oneway_on_foot_is_respected(self):
        a=(-19.9000,-43.8995)
        b=(-19.9000,-43.8990)
        self.assertIsNotNone(self.graph.route(a,b,max_meters=300))
        self.assertIsNone(self.graph.route(b,a,max_meters=300))

    def test_nearby_excludes_inaccessible_stop(self):
        start=(-19.9000,-43.9000)
        stops=[
            ('connected',['Walkable',-19.9000,-43.8995]),
            ('barrier',['Separated',-19.9001,-43.8990]),
        ]
        found=self.graph.reachable_stops(start,stops,radius=400)
        self.assertEqual([sid for _,sid,_ in found],['connected'])

    def test_osm_access_restrictions(self):
        self.assertTrue(allowed({'highway':'footway'}))
        self.assertTrue(allowed({'highway':'residential'}))
        self.assertTrue(allowed({'highway':'primary','sidewalk':'both'}))
        self.assertFalse(allowed({'highway':'primary'}))
        self.assertFalse(allowed({'highway':'motorway','foot':'yes'}))
        self.assertFalse(allowed({'highway':'footway','foot':'no'}))
        self.assertFalse(allowed({'highway':'path','access':'private'}))
        self.assertFalse(allowed({'highway':'construction'}))

    def test_builder_keeps_exact_node_connectivity(self):
        a=[(101,-19.9000,-43.9000),(102,-19.9000,-43.8995)]
        b=[(103,-19.9000,-43.8995),(104,-19.9000,-43.8990)]
        nodes,edges=graph_of_waypoints([(a,{'highway':'footway'}),(b,{'highway':'footway'})])
        self.assertEqual(len(nodes),4)
        self.assertEqual(len(edges),2)
        # Same coordinates but distinct OSM node IDs are NOT assumed connected.
        self.assertNotEqual(edges[0][1],edges[1][0])


if __name__=='__main__':
    unittest.main()
