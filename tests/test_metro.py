"""P4: cobertura offline do metrô, sem depender de GPS externo."""
import datetime as dt
import pathlib
import unittest

from transit.metro import MetroCatalog

ROOT = pathlib.Path(__file__).resolve().parents[1]


class MetroTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.metro = MetroCatalog(ROOT / 'catalog')

    def test_lines_and_stations_current(self):
        data = self.metro.listing('2026-11-17T12:00:00-03:00')
        self.assertEqual(len(data['stations']), 22)
        self.assertEqual(len(data['lines']), 2)
        self.assertEqual(len(self.metro.line('1')['stations']), 21)
        self.assertEqual([s['id'] for s in self.metro.line('2')['stations']], ['nova-suica', 'amazonas'])
        self.assertTrue(self.metro.stations['nova-suica']['interchange'])
        self.assertEqual(self.metro.stations['nova-suica']['lines'], ['1', '2'])
        self.assertNotIn('Barreiro', [s['name'] for s in data['stations']])
        self.assertIn('Barreiro', self.metro.line('2')['plannedStations'])
        self.assertFalse(data['realtimeAvailable'])

    def test_coordinates_are_plausible(self):
        for s in self.metro.data['stations']:
            self.assertTrue(-20.1 < s['lat'] < -19.7, s)
            self.assertTrue(-44.2 < s['lng'] < -43.7, s)

    def test_frequency_weekday_peak(self):
        at = '2026-11-17T07:00:00-03:00'
        s = self.metro.service('1', at)
        self.assertEqual(s['typicalHeadwayMinutes'], 7.5)
        self.assertTrue(s['frequencyOnly'])
        self.assertFalse(s['realtimeAvailable'])

    def test_frequency_weekday_offpeak(self):
        self.assertEqual(self.metro.service('1','2026-11-17T10:00:00-03:00')['typicalHeadwayMinutes'], 15)

    def test_exception_after_20_16_to_20_nov(self):
        s = self.metro.service('1','2026-11-17T20:15:00-03:00')
        self.assertEqual(s['typicalHeadwayMinutes'], 24)
        self.assertEqual(len(s['alerts']), 1)
        before = self.metro.service('1','2026-11-17T19:59:59-03:00')
        self.assertNotEqual(before['typicalHeadwayMinutes'], 24)
        after = self.metro.service('1','2026-11-21T20:15:00-03:00')
        self.assertEqual(after['typicalHeadwayMinutes'], 15)
        self.assertFalse(after['alerts'])

    def test_outside_station_hours(self):
        s=self.metro.service('1','2026-11-17T04:00:00-03:00')
        self.assertFalse(s['stationOpenAtTime'])
        self.assertIsNone(s['typicalHeadwayMinutes'])

    def test_line2_closes_early_on_signalling_dates(self):
        s=self.metro.service('2','2026-11-17T22:15:00-03:00')
        self.assertEqual(s['stationHours']['end'],'22:00')
        self.assertFalse(s['stationOpenAtTime'])
        self.assertTrue(s['alerts'])
        normal=self.metro.service('2','2026-11-21T22:15:00-03:00')
        self.assertEqual(normal['stationHours']['end'],'23:00')
        self.assertTrue(normal['stationOpenAtTime'])

    def test_line2_no_fake_eta(self):
        s=self.metro.service('2','2026-11-17T12:00:00-03:00')
        self.assertIsNone(s['typicalHeadwayMinutes'])
        self.assertEqual(s['predictionType'],'unavailable')
        self.assertFalse(s['realtimeAvailable'])

    def test_station_bus_links_are_proximity_only(self):
        s=self.metro.stations['amazonas']
        stops={
            'near':['Rua de teste', s['lat']+0.0001, s['lng']+0.0001],
            'far':['Fora de alcance',-19.8,-43.9]
        }
        detail=self.metro.station('amazonas',stops,'2026-11-17T12:00:00-03:00')
        self.assertEqual(len(detail['busStops']),1)
        self.assertEqual(detail['busStops'][0]['id'],'near')
        self.assertEqual(detail['busStops'][0]['distanceType'],'straight_line')
        self.assertFalse(detail['services'][0]['realtimeAvailable'])
        self.assertEqual(detail['services'][0]['predictionType'],'unavailable')
        self.assertNotIn('nextTrainAt',detail)
        self.assertNotIn('etaMinutes',detail)

    def test_nearest_and_invalid_coordinates(self):
        s=self.metro.stations['amazonas']
        res=self.metro.nearby(s['lat'],s['lng'])
        self.assertEqual(res['items'][0]['id'],'amazonas')
        self.assertEqual(res['items'][0]['distanceM'],0)
        with self.assertRaises(ValueError):
            self.metro.nearby(999,0)
        with self.assertRaises(ValueError):
            self.metro.nearby('nan','0')

    def test_unknown_station_or_line(self):
        self.assertIsNone(self.metro.station('futura-nao-inaugurada'))
        self.assertIsNone(self.metro.line('3'))


    def test_operator_station_links(self):
        links=[s['officialForecastUrl'] for s in self.metro.data['stations']
               if s.get('officialForecastUrl')]
        self.assertEqual(len(links),21)
        self.assertTrue(all(u.startswith('https://da.gd/') for u in links))
        self.assertNotIn('officialForecastUrl',self.metro.stations['amazonas'])

    def test_rss_official_news_and_failure_fallback(self):
        metro=MetroCatalog(ROOT/'catalog')
        rss=b'''<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel>
          <item><title>Aviso oficial</title>
          <link>https://www.metrobh.com.br/aviso-de-teste/</link>
          <pubDate>Tue, 17 Nov 2026 10:00:00 GMT</pubDate></item>
          <item><title>URL externa proibida</title><link>https://fake.example/</link></item>
        </channel></rss>'''
        fetched=metro.news(fetcher=lambda url:rss,ttl=0)
        self.assertEqual(fetched['status'],'ok')
        self.assertEqual(len(fetched['items']),1)
        self.assertEqual(fetched['items'][0]['title'],'Aviso oficial')
        down=metro.news(fetcher=lambda url:b'<invalid',ttl=0)
        self.assertEqual(down['status'],'stale')
        self.assertEqual(down['items'],fetched['items'])


if __name__ == '__main__':
    unittest.main()
