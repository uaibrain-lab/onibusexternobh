"""Synthetic unit checks for GPS proof logic, not proof of real feed health."""
import unittest
from datetime import datetime,timezone
from scripts.probe_hub_v1_gps import inspect

NOW=datetime(2026,11,22,17,0,0,tzinfo=timezone.utc)
CAP={'service':'Externo BH GPS','supportedSources':['GTFS_RT']}
def record(minutes=1, route='5102', lat=-19.9):
    from datetime import timedelta
    return {'routeId':route,'vehicleId':'vehicle-qa',
            'lastGpsFixAt':(NOW-timedelta(minutes=minutes)).isoformat(),
            'latitude':lat,'longitude':-43.95}
def response(items):
    return {'source':'GTFS_RT','available':True,
            'fetchedAt':NOW.isoformat(),'records':items}

class LiveGpsProofTests(unittest.TestCase):
    def test_recent_official_record_passes(self):
        d=inspect(CAP,[({'5102'},response([record()]))],{'5102'},NOW)
        self.assertTrue(d['probePassed'])
        self.assertEqual(d['recentPositions'],1)
    def test_empty_feed_fails_closed(self):
        with self.assertRaisesRegex(ValueError,'GPS_NO_RECENT'):
            inspect(CAP,[({'5102'},response([]))],{'5102'},NOW)
    def test_stale_telemetry_does_not_approve(self):
        with self.assertRaisesRegex(ValueError,'GPS_NO_RECENT'):
            inspect(CAP,[({'5102'},response([record(minutes=15)]))],{'5102'},NOW)
    def test_wrong_line_does_not_approve(self):
        with self.assertRaisesRegex(ValueError,'GPS_NO_RECENT'):
            inspect(CAP,[({'5102'},response([record(route='9999')]))],{'5102'},NOW)
    def test_invalid_coordinates_do_not_approve(self):
        with self.assertRaisesRegex(ValueError,'GPS_NO_RECENT'):
            inspect(CAP,[({'5102'},response([record(lat=55)]))],{'5102'},NOW)
    def test_worker_unavailable_blocks_release(self):
        with self.assertRaisesRegex(ValueError,'GPS_FEED_NOT_AVAILABLE'):
            inspect(CAP,[({'5102'},{'source':'GTFS_RT','available':False,'records':[]})],{'5102'},NOW)

if __name__=='__main__':unittest.main()
