"""Optional *local* Valhalla pedestrian engine.

No public demo routing APIs are contacted. Configure PEDESTRIAN_ROUTER_URL
only for a local, self-hosted Valhalla service with OSM pedestrian graph.
"""
from __future__ import annotations
import json
import math
import os
import threading
import urllib.parse
import urllib.request


class PedestrianRouter:
    def __init__(self, endpoint=None, fetcher=None):
        self.endpoint=(endpoint if endpoint is not None else
                       os.environ.get('PEDESTRIAN_ROUTER_URL','')).strip().rstrip('/')
        self.fetcher=fetcher or self._request
        self.lock=threading.RLock()
        self.cache={}
        if self.endpoint:
            parsed=urllib.parse.urlparse(self.endpoint)
            # A local server is deliberate: never send users' home/work
            # coordinates to an unapproved third-party routing provider.
            if parsed.scheme!='http' or parsed.hostname not in ('127.0.0.1','localhost','::1'):
                raise ValueError('Serviço pedestre deve ser local (127.0.0.1/localhost)')
            if parsed.path not in ('','/route'):
                raise ValueError('Caminho do serviço Valhalla inválido')

    @property
    def enabled(self):
        return bool(self.endpoint)

    def _request(self,url,payload):
        req=urllib.request.Request(url,data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type':'application/json',
                     'User-Agent':'OnibusExternoBH-P6-local-router/0.6'})
        with urllib.request.urlopen(req,timeout=6) as response:
            blob=response.read(160000+1)
            if len(blob)>160000:
                raise ValueError('Roteiro pedestre excessivamente grande')
            return json.loads(blob.decode('utf-8'))

    @staticmethod
    def _coordinates(point):
        if len(point)!=2 or not all(math.isfinite(float(x)) for x in point):
            raise ValueError('Coordenada pedestre inválida')
        return round(float(point[0]),6),round(float(point[1]),6)

    def route(self,start,end):
        if not self.enabled:
            return None
        a=self._coordinates(start)
        b=self._coordinates(end)
        key=(a,b)
        with self.lock:
            if key in self.cache:
                return self.cache[key]
            payload={'locations':[{'lat':a[0],'lon':a[1]},
                                  {'lat':b[0],'lon':b[1]}],
                     'costing':'pedestrian',
                     'directions_options':{'units':'kilometers'},
                     'directions_type':'none'}
            endpoint=self.endpoint if self.endpoint.endswith('/route') else self.endpoint+'/route'
            try:
                value=self.fetcher(endpoint,payload)
                summary=value['trip']['summary']
                km=float(summary['length'])
                seconds=float(summary['time'])
                if not (0<=km<=20 and 0<=seconds<=4*3600 and
                        math.isfinite(km) and math.isfinite(seconds)):
                    raise ValueError('Dados pedestres implausíveis')
                # Valhalla distance/time come from actual OSM pedestrian graph.
                result={'distanceM':round(km*1000),
                        'durationSeconds':max(20,round(seconds)),
                        'source':'Valhalla OSM pedestrian',
                        'pathVerified':True}
                if len(self.cache)>=8000:self.cache.clear()
                self.cache[key]=result
                return result
            except (KeyError,TypeError,ValueError,OSError,TimeoutError):
                # None means unavailable, not "0 metres" or a walking path.
                return None
