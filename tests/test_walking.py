"""P6 — Valhalla pedestre local, sem chamadas públicas invisíveis."""
import json
import unittest
from transit.walking import PedestrianRouter


class PedestrianTests(unittest.TestCase):
    def test_local_valhalla_network_result(self):
        calls=[]
        def fetch(url,payload):
            calls.append((url,payload))
            return {'trip':{'summary':{'length':0.42,'time':340}}}
        p=PedestrianRouter('http://127.0.0.1:8002',fetcher=fetch)
        a=(-19.9,-43.9)
        b=(-19.901,-43.902)
        first=p.route(a,b)
        self.assertTrue(first['pathVerified'])
        self.assertEqual(first['distanceM'],420)
        self.assertEqual(first['durationSeconds'],340)
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][1]['costing'],'pedestrian')
        self.assertEqual(p.route(a,b),first)
        self.assertEqual(len(calls),1)

    def test_fail_closed_when_no_path(self):
        p=PedestrianRouter('http://localhost:8002',
            fetcher=lambda url,payload:{'error':'No path'})
        self.assertIsNone(p.route((-19.9,-43.9),(-19.901,-43.901)))
        self.assertTrue(p.enabled)

    def test_third_party_hostname_forbidden(self):
        with self.assertRaises(ValueError):
            PedestrianRouter('https://valhalla1.openstreetmap.de')
        with self.assertRaises(ValueError):
            PedestrianRouter('http://example.org:8002')

    def test_disabled_without_config(self):
        p=PedestrianRouter(endpoint='')
        self.assertFalse(p.enabled)
        self.assertIsNone(p.route((-19.9,-43.9),(-19.901,-43.901)))


if __name__=='__main__':
    unittest.main()
