import datetime as dt
import unittest
from transit.eta_quality import summarize
from transit.engine import TransitEngine, BRT
from transit.eta import GpsArrivalEstimator
from transit.matcher import ShapeMatcher
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

class EtaQualityTests(unittest.TestCase):
    def test_unlabelled_predictions_never_count_as_accuracy(self):
        report=summarize([{'predictedAt':'2026-11-17T08:15:00-03:00'}])
        self.assertEqual(report['predictionsEvaluated'],0)
        self.assertIsNone(report['maeMinutes'])
        self.assertFalse(report['fieldAccuracyVerified'])

    def test_real_labelled_error_and_missing(self):
        report=summarize([
            {'actualAt':'2026-11-17T08:10:00-03:00','predictedAt':'2026-11-17T08:08:00-03:00'},
            {'actualAt':'2026-11-17T08:20:00-03:00','predictedAt':'2026-11-17T08:23:00-03:00'},
            {'actualAt':'2026-11-17T08:30:00-03:00','predictedAt':None},
        ])
        self.assertEqual(report['observedArrivals'],3)
        self.assertEqual(report['predictionsEvaluated'],2)
        self.assertEqual(report['maeMinutes'],2.5)
        self.assertEqual(report['signedBiasMinutes'],0.5)
        self.assertEqual(report['coveragePct'],66.7)
        self.assertEqual(report['p90ErrorMinutes'],3.0)

    def test_no_arrivals_denominator_has_no_coverage(self):
        self.assertIsNone(summarize([])['coveragePct'])

    def test_telemetry_gap_over_100s_invalidates_estimate(self):
        now=dt.datetime(2026,11,17,9,30,tzinfo=BRT)
        shape={'S':[[-19.01,-43],[-19.0,-43]]}
        pattern=[{'id':'p','route':'r','shape':'S','stops':['a','s','b'],'headsign':'Centro'}]
        matcher=ShapeMatcher(shape,pattern)
        est=GpsArrivalEstimator(matcher,pattern,{'s':['Stop',-19.002,-43]})
        history=[]
        for seconds,lat in [(-195,-19.0085),(-50,-19.0075),(-5,-19.0065)]:
            history.append({'fixAt':(now+dt.timedelta(seconds=seconds)).isoformat(timespec='seconds'),
                            'lat':lat,'lng':-43,'heading':0})
        vehicle={'NV':'x','source':'CONVENCIONAL','routeIds':['r'],
                 'lat':history[-1]['lat'],'lng':-43,
                 'lastGpsFixAt':history[-1]['fixAt'],
                 'positionUnchangedSinceAt':history[-1]['fixAt'],'history':history}
        self.assertIsNone(est.estimate({'id':'r','shapes':['S']},'s',[vehicle],now))

    def test_diagnostic_counters_no_vehicle_or_stop_id(self):
        engine=TransitEngine(ROOT,fetcher=lambda url:[])
        engine.stop_detail('14791407')
        summary=engine.eta_coverage_summary()
        self.assertGreater(summary['linesChecked'],0)
        self.assertEqual(summary['gpsEstimates'],0)
        self.assertFalse(summary['accuracyVerified'])
        self.assertNotIn('vehicleId',str(summary))
        self.assertNotIn('14791407',str(summary))

if __name__=='__main__':unittest.main()
