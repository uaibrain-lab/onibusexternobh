"""Regression: GPS ETAs require recent reliable movement, never repeated HTTP polls."""
import datetime as dt
import unittest
from transit.eta import GpsArrivalEstimator
from transit.matcher import ShapeMatcher
from transit.engine import BRT, iso


class GpsEtaTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 11, 17, 9, 30, tzinfo=BRT)
        self.route = {'id': 'r', 'code': '9202', 'shapes': ['shape']}
        self.stops = {'s': ['Parada', -19.002, -43.0]}
        self.patterns = [{'id': 'p', 'route': 'r', 'shape': 'shape',
                          'stops': ['a', 's', 'b'], 'headsign': 'Centro'}]
        self.shapes = {'shape': [[-19.01, -43.0], [-19.0, -43.0]]}
        self.matcher = ShapeMatcher(self.shapes, self.patterns)
        self.eta = GpsArrivalEstimator(self.matcher, self.patterns, self.stops)
        history = [
            {'fixAt': iso(self.now + dt.timedelta(seconds=t)),
             'lat': lat, 'lng': -43.0, 'heading': 0}
            for t, lat in [(-90, -19.0085), (-45, -19.0075), (-5, -19.0065)]
        ]
        self.vehicle = {'NV': '12', 'source': 'CONVENCIONAL', 'routeIds': ['r'],
                        'lat': history[-1]['lat'], 'lng': history[-1]['lng'],
                        'lastGpsFixAt': history[-1]['fixAt'],
                        'positionUnchangedSinceAt': history[-1]['fixAt'],
                        'history': history}

    def test_reliable_moving_bus_predicts_and_identifies_vehicle(self):
        eta = self.eta.estimate(self.route, 's', [self.vehicle], self.now)
        self.assertIsNotNone(eta)
        self.assertEqual(eta['type'], 'gps_estimate')
        self.assertEqual(eta['vehicleId'], '12')
        self.assertEqual(eta['vehicleSource'], 'CONVENCIONAL')
        self.assertTrue(1 <= eta['minutes'] <= 20)
        self.assertTrue(eta['approximate'])

    def test_stale_gps_is_not_revalidated_by_new_http(self):
        self.vehicle['lastGpsFixAt'] = iso(self.now - dt.timedelta(minutes=4))
        self.assertIsNone(self.eta.estimate(self.route, 's', [self.vehicle], self.now))

    def test_unchanged_position_never_becomes_fresh_again(self):
        self.vehicle['positionUnchangedSinceAt'] = iso(self.now - dt.timedelta(minutes=4))
        self.assertIsNone(self.eta.estimate(self.route, 's', [self.vehicle], self.now))

    def test_stationary_vehicle_has_no_speed_based_eta(self):
        for sample in self.vehicle['history']:
            sample['lat'] = -19.0065
        self.assertIsNone(self.eta.estimate(self.route, 's', [self.vehicle], self.now))

    def test_unconfirmed_route_variant_is_rejected(self):
        self.patterns.append({'id':'other','route':'r','shape':'shape',
                              'stops':['a','b'],'headsign':'Centro'})
        other = GpsArrivalEstimator(ShapeMatcher(self.shapes,self.patterns),
                                    self.patterns,self.stops)
        self.assertIsNone(other.estimate(self.route, 's', [self.vehicle], self.now))

    def test_bus_after_stop_is_not_next_bus(self):
        for sample in self.vehicle['history']:
            sample['lat'] += .005
        self.vehicle['lat'] += .005
        self.assertIsNone(self.eta.estimate(self.route, 's', [self.vehicle], self.now))

    def test_stop_visited_twice_is_ambiguous(self):
        self.patterns[0]['stops'] = ['s','a','s']
        self.assertIsNone(self.eta.estimate(self.route, 's', [self.vehicle], self.now))


if __name__ == '__main__':
    unittest.main()
