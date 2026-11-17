import datetime as dt
import unittest
from transit.eta import GpsArrivalEstimator
from transit.matcher import ShapeMatcher
from transit.engine import BRT, iso


class GpsEtaTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,11,17,9,30,tzinfo=BRT)
        self.route={'id':'r','code':'9202','shapes':['shape']}
        self.stops={'s':['Parada',-19.002,-43.0]}
        self.patterns=[{'id':'p','route':'r','shape':'shape','stops':['a','s','b'],'headsign':'Centro'}]
        self.shapes={'shape': [[-19.01,-43.0],[-19.0,-43.0]]}
        self.matcher=ShapeMatcher(self.shapes,self.patterns)
        self.eta=GpsArrivalEstimator(self.matcher,self.patterns,self.stops)
        self.vehicle=self.make_vehicle()

    def make_vehicle(self):
        history=[]
        for sec,lat in [(-90,-19.0085),(-45,-19.0075),(-5,-19.0065)]:
            history.append({'fixAt':iso(self.now+dt.timedelta(seconds=sec)),
                            'lat':lat,'lng':-43.0,'heading':0})
        return {'NV':'12','source':'CONVENCIONAL','routeIds':['r'],
                'lat':history[-1]['lat'],'lng':history[-1]['lng'],
                'lastGpsFixAt':history[-1]['fixAt'],
                'positionUnchangedSinceAt':history[-1]['fixAt'],
                'history':history}

    def test_moving_bus_with_unique_route_predicts(self):
        result=self.eta.estimate(self.route,'s',[self.vehicle],self.now)
        self.assertIsNotNone(result)
        self.assertEqual(result['type'],'gps_estimate')
        self.assertTrue(1 <= result['minutes'] <= 20)
        self.assertTrue(result['approximate'])
        self.assertEqual(result['vehicleId'],'12')
        self.assertEqual(result['vehicleSource'],'CONVENCIONAL')

    def test_old_fix_is_never_live(self):
        self.vehicle['lastGpsFixAt']=iso(self.now-dt.timedelta(minutes=4))
        self.assertIsNone(self.eta.estimate(self.route,'s',[self.vehicle],self.now))

    def test_still_position_old_is_not_revalidated(self):
        self.vehicle['positionUnchangedSinceAt']=iso(self.now-dt.timedelta(minutes=4))
        self.assertIsNone(self.eta.estimate(self.route,'s',[self.vehicle],self.now))

    def test_ambiguous_pattern_same_shape_not_guessed(self):
        self.patterns.append({'id':'other','route':'r','shape':'shape',
                              'stops':['a','b'],'headsign':'Centro'})
        estimator=GpsArrivalEstimator(ShapeMatcher(self.shapes,self.patterns),self.patterns,self.stops)
        self.assertIsNone(estimator.estimate(self.route,'s',[self.vehicle],self.now))

    def test_same_shape_with_two_destinations_is_not_assigned_to_wrong_direction(self):
        self.patterns.append({'id':'other-direction','route':'r','shape':'shape',
                              'stops':['a','s','b'],'headsign':'Bairro'})
        estimator=GpsArrivalEstimator(ShapeMatcher(self.shapes,self.patterns),self.patterns,self.stops)
        self.assertIsNone(estimator.estimate(self.route,'s',[self.vehicle],self.now))

    def test_stationary_telemetry_not_extrapolated(self):
        for h in self.vehicle['history']:
            h['lat']=-19.0065
        self.assertIsNone(self.eta.estimate(self.route,'s',[self.vehicle],self.now))

    def test_bus_past_stop_not_predicted(self):
        for h in self.vehicle['history']:
            h['lat']+=.005
        self.vehicle['lat']+=.005
        self.assertIsNone(self.eta.estimate(self.route,'s',[self.vehicle],self.now))

    def test_repeated_stop_on_pattern_rejected(self):
        self.patterns[0]['stops']=['s','a','s']
        self.assertIsNone(self.eta.estimate(self.route,'s',[self.vehicle],self.now))

if __name__=='__main__':unittest.main()
