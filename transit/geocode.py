"""On-demand, rate-limited address lookup for local development only.

Nominatim public service: maximum one request per second per application,
no autocomplete, identify application, cache results, prominent OSM credit.
Production must use an appropriately provisioned geocoder or OSM extract.
"""
from __future__ import annotations
import json
import threading
import time
import urllib.parse
import urllib.request


class PlaceSearch:
    def __init__(self, fetcher=None):
        self.fetcher = fetcher or self._fetch
        self.lock = threading.Lock()
        self.last_request = 0.
        self.cache = {}

    @staticmethod
    def _fetch(url):
        req = urllib.request.Request(url, headers={
            'User-Agent':'OnibusExternoBH/0.5 (https://github.com/uaibrain-lab/onibusexternobh)',
            'Accept':'application/json'
        })
        with urllib.request.urlopen(req, timeout=8) as resp:
            blob = resp.read(180000 + 1)
            if len(blob) > 180000:
                raise ValueError('Resposta muito grande')
            return json.loads(blob.decode('utf-8'))

    def search(self, query):
        q = ' '.join(str(query or '').strip().split())
        if not 3 <= len(q) <= 100 or any(ord(ch) < 32 for ch in q):
            raise ValueError('Informe um endereço ou local de 3 a 100 caracteres')
        normalized=q.casefold()
        with self.lock:
            now=time.monotonic()
            hit=self.cache.get(normalized)
            if hit and now-hit[0]<86400:
                return {'items':hit[1],'source':'OpenStreetMap/Nominatim','cached':True}
            # Rate limit shared between all requests in this local server.
            delay=max(0.,1.15-(now-self.last_request))
            if delay:
                time.sleep(delay)
            self.last_request=time.monotonic()
            params=urllib.parse.urlencode({
                'q':q, 'format':'jsonv2','limit':5,
                'viewbox':'-44.30,-19.65,-43.65,-20.35',
                'bounded':1, 'countrycodes':'br',
                'addressdetails':0,
            })
            response=self.fetcher('https://nominatim.openstreetmap.org/search?'+params)
            if not isinstance(response,list):
                raise ValueError('Serviço de endereços retornou dados inválidos')
            items=[]
            for obj in response[:5]:
                try:
                    lat=float(obj['lat'])
                    lng=float(obj['lon'])
                    label=str(obj['display_name'])[:220]
                    if not (-20.35<=lat<=-19.65 and -44.3<=lng<=-43.65):
                        continue
                except (ValueError,TypeError,KeyError):
                    continue
                items.append({'lat':lat,'lng':lng,'label':label})
            if len(self.cache)>500:
                self.cache.clear()
            self.cache[normalized]=(time.monotonic(),items)
            return {'items':items,'source':'OpenStreetMap/Nominatim',
                    'cached':False,'note':'Busca sob demanda; sem autocomplete.'}
