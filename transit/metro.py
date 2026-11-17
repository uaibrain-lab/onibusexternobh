"""Catálogo metroviário verificável e consultas locais, independente do GPS dos ônibus.

Os intervalos divulgados pela concessionária NÃO são chegadas de composições.
Não existe feed de tempo real metroviário público validado neste módulo.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from .matcher import distance_m

BRT = dt.timezone(dt.timedelta(hours=-3))


class MetroCatalog:
    def __init__(self, catalog_dir):
        self.path = Path(catalog_dir) / 'metro.json'
        self.data = json.loads(self.path.read_text(encoding='utf-8'))
        if self.data.get('schema') != 1:
            raise ValueError('Versão desconhecida do catálogo de metrô')
        self.stations = {s['id']: s for s in self.data['stations']}
        self.lines = {line['id']: line for line in self.data['lines']}
        self._news_lock = threading.Lock()
        self._news_data = []
        self._news_fetched = None
        self._news_attempt = 0.
        self._news_error = None
        for line in self.lines.values():
            if any(sid not in self.stations for sid in line['stations']):
                raise ValueError('Estação desconhecida na linha ' + line['id'])

    def _line_summary(self, line):
        return {key: line[key] for key in ('id', 'name', 'color', 'operational',
                                          'hours', 'plannedStations')}

    def _station_summary(self, station):
        out = {key: station[key] for key in ('id', 'name', 'lat', 'lng',
                                             'lines', 'interchange', 'active')}
        if 'officialForecastUrl' in station:
            out['officialForecastUrl'] = station['officialForecastUrl']
        return out

    @staticmethod
    def _moment(at=None):
        if at is None:
            return dt.datetime.now(BRT)
        if isinstance(at, str):
            at = dt.datetime.fromisoformat(at)
        if at.tzinfo is None:
            at = at.replace(tzinfo=BRT)
        return at.astimezone(BRT)

    def service(self, line_id, at=None):
        """Informação de funcionamento e intervalo divulgado, NÃO um ETA."""
        line = self.lines.get(str(line_id))
        if not line:
            return None
        now = self._moment(at)
        hhmm = now.strftime('%H:%M')
        first = line['hours']['start']
        last = line['hours']['end']
        open_now = first <= hhmm < last
        day = now.date().isoformat()
        interval = None
        note = ''
        if line_id == '1':
            if now.weekday() < 5:
                spec = self.data['operations']['headways']['1']['weekdays']
                is_peak = any(start <= hhmm < end for start, end in spec['peakWindows'])
                interval = spec['peakMinutes'] if is_peak else spec['offPeakMinutes']
            elif now.weekday() == 5:
                spec = self.data['operations']['headways']['1']['saturday']
                a, b = spec['morningWindow']
                interval = spec['morningMinutes'] if a <= hhmm < b else spec['otherMinutes']
            else:
                interval = self.data['operations']['headways']['1']['sundayAndHolidays']['minutes']
            note = 'Referência habitual; feriados e operações especiais podem alterar os intervalos.'
        else:
            note = self.data['operations']['headways']['2']['note']
        notices = []
        for rule in self.data['operations']['exceptional']:
            if rule['line'] != str(line_id) or not rule['from'] <= day <= rule['through']:
                continue
            if hhmm >= rule['after']:
                interval = rule['headwayMinutes']
                notices.append({'text': rule['note'], 'url': rule['url'], 'source': 'operator'})
        return {
            'lineId': str(line_id), 'asOf': now.isoformat(timespec='seconds'),
            'stationHours': line['hours'], 'stationOpenAtTime': open_now,
            'typicalHeadwayMinutes': interval if open_now else None,
            'frequencyOnly': True, 'realtimeAvailable': False,
            'predictionType': 'frequency' if interval is not None and open_now else 'unavailable',
            'note': note, 'alerts': notices,
            'source': self.data['sources']['operator']
        }

    def listing(self, at=None):
        now = self._moment(at)
        return {
            'asOf': now.isoformat(timespec='seconds'),
            'updatedAt': self.data['updatedAt'], 'timezone': self.data['timezone'],
            'lines': [{**self._line_summary(line), 'service': self.service(line['id'], now)}
                      for line in self.data['lines']],
            'stations': [self._station_summary(s) for s in self.data['stations']],
            'stationCoordinatesNote': self.data['stationCoordinates'],
            'realtimeAvailable': False,
            'sources': self.data['sources'],
            'fareBRL': self.data['operations']['fareBRL'],
            'fareSource': self.data['operations']['fareSource'],
            'forecastLinkNote': self.data['operations']['forecastLinkNote'],
            'notice': self.data['operations']['notice']
        }

    def station(self, station_id, bus_stops=None, at=None):
        s = self.stations.get(str(station_id))
        if not s:
            return None
        out = self._station_summary(s)
        out['services'] = [self.service(line, at) for line in s['lines']]
        out['busStops'] = []
        if bus_stops:
            choices = []
            for sid, entry in bus_stops.items():
                try:
                    meters = distance_m((s['lat'], s['lng']), (float(entry[1]), float(entry[2])))
                except (TypeError, ValueError, IndexError):
                    continue
                if math.isfinite(meters) and meters <= 650:
                    choices.append((meters, sid, entry))
            choices.sort(key=lambda item: item[0])
            out['busStops'] = [
                {'id': sid, 'name': entry[0], 'lat': entry[1], 'lng': entry[2],
                 'distanceM': round(meters), 'distanceType': 'straight_line'}
                for meters, sid, entry in choices[:12]
            ]
        out['notes'] = [
            'Localização indicativa; verificar a entrada da estação no local.',
            'Distâncias até pontos de ônibus em linha reta; não são percursos a pé.',
            'A frequência divulgada não é previsão de chegada de trem.'
        ]
        return out

    def line(self, line_id, at=None):
        line = self.lines.get(str(line_id))
        if not line:
            return None
        return {
            **self._line_summary(line),
            'stations': [self._station_summary(self.stations[sid]) for sid in line['stations']],
            'service': self.service(line['id'], at),
            'geometryType': 'schematic_station_connections',
            'geometryNote': 'Conexões esquemáticas entre estações; não representam os trilhos georreferenciados.'
        }

    def nearby(self, lat, lng, limit=12, radius_m=4000):
        lat, lng = float(lat), float(lng)
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValueError('Coordenadas inválidas')
        ranked = []
        for s in self.data['stations']:
            m = distance_m((lat, lng), (s['lat'], s['lng']))
            if m <= radius_m:
                ranked.append((m, s))
        ranked.sort(key=lambda t: t[0])
        return {
            'items': [{**self._station_summary(s), 'distanceM': round(m),
                       'distanceType': 'straight_line'}
                      for m, s in ranked[:max(1, min(int(limit), 30))]],
            'count': len(ranked), 'distanceNote': 'Distância em linha reta, não caminhada.'
        }


    def news(self, fetcher=None, ttl=1800):
        """RSS oficial; comunicados informativos, NÃO alertas em tempo real."""
        source = 'https://www.metrobh.com.br/feed/'
        with self._news_lock:
            if not self._news_attempt or time.monotonic() - self._news_attempt >= ttl:
                self._news_attempt = time.monotonic()
                try:
                    if fetcher:
                        body = fetcher(source)
                    else:
                        req = urllib.request.Request(
                            source, headers={'User-Agent': 'HubUFMG-Externo-metro/0.4 (RSS reader)'})
                        with urllib.request.urlopen(req, timeout=8) as response:
                            body = response.read(512 * 1024 + 1)
                    if not isinstance(body, (bytes, bytearray)) or len(body) > 512 * 1024:
                        raise ValueError('RSS excede limite permitido')
                    doc = ET.fromstring(body)
                    posts = []
                    for item in doc.findall('./channel/item'):
                        title = (item.findtext('title') or '').strip()
                        link = (item.findtext('link') or '').strip()
                        host = urllib.parse.urlsplit(link)
                        if host.scheme != 'https' or host.hostname not in ('www.metrobh.com.br', 'metrobh.com.br'):
                            continue
                        if title:
                            posts.append({'title': title[:240], 'url': link,
                                          'published': (item.findtext('pubDate') or '').strip()[:90]})
                        if len(posts) >= 6:
                            break
                    if not posts:
                        raise ValueError('RSS sem comunicados oficiais reconhecidos')
                    self._news_data = posts
                    self._news_fetched = dt.datetime.now(BRT).isoformat(timespec='seconds')
                    self._news_error = None
                except (OSError, ValueError, ET.ParseError, TimeoutError) as exc:
                    self._news_error = type(exc).__name__
        return {
            'items': list(self._news_data), 'fetchedAt': self._news_fetched,
            'source': source, 'status': 'stale' if self._news_error and self._news_data
                                     else 'unavailable' if self._news_error else 'ok',
            'note': 'Comunicados oficiais recentes, não incidências ativas nem previsões de trens.'
        }
