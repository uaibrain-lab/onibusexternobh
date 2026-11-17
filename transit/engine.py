"""GPS ingestion, source cache and persistent immutable fix times.

No dependencies beyond CPython >=3.9. Local prototype only, not public hosting.
"""
from __future__ import annotations
import collections, datetime as dt, json, math, os, pathlib, tempfile, threading, time, urllib.request
from .matcher import ShapeMatcher, distance_m

BRT=dt.timezone(dt.timedelta(hours=-3))
FEEDS={'CONVENCIONAL':'https://temporeal.pbh.gov.br/?param=D',
       'SUPLEMENTAR':'https://temporeal.pbh.gov.br/?param=SD'}


def now_brt(): return dt.datetime.now(BRT)
def iso(t): return t.isoformat(timespec='seconds')
def parse_iso(s):
    if not s: return None
    try: return dt.datetime.fromisoformat(s)
    except (ValueError,TypeError): return None

def parse_hr(s):
    try:
        return dt.datetime.strptime(str(s),'%Y%m%d%H%M%S').replace(tzinfo=BRT)
    except (ValueError, TypeError): return None

class TransitEngine:
    def __init__(self, root, fetcher=None, ttl=35):
        self.root=pathlib.Path(root)
        self.catalog=self.root/'catalog'
        self.state_file=self.root/'state'/'vehicles.json'
        self.routes=json.loads((self.catalog/'routes.json').read_text(encoding='utf8'))
        self.route_by_code={r['code']:r for r in self.routes}
        self.route_by_id={r['id']:r for r in self.routes}
        self.stops=json.loads((self.catalog/'stops.json').read_text(encoding='utf8'))
        self.shapes=json.loads((self.catalog/'shapes.json').read_text(encoding='utf8'))
        self.patterns=json.loads((self.catalog/'patterns.json').read_text(encoding='utf8'))
        self.pattern_by_id={p['id']:p for p in self.patterns}
        self.by_route=collections.defaultdict(list)
        for p in self.patterns:self.by_route[p['route']].append(p)
        self.nl_map=json.loads((self.catalog/'gps-nl-map.json').read_text(encoding='utf8'))
        self.matcher=ShapeMatcher(self.shapes,self.patterns)
        self.ttl=max(20,int(ttl))
        self.fetcher=fetcher or self._download
        self.lock=threading.RLock()
        self.vehicles={}
        self.sources={name:{'lastFetchedAt':None,'lastError':None,'responseRecords':0}
                      for name in FEEDS}
        self.last_attempt_monotonic=0.
        self._restore()

    def _restore(self):
        try:
            saved=json.loads(self.state_file.read_text(encoding='utf8'))
            if saved.get('schema')!=1:return
            self.sources.update(saved.get('sources',{}))
            cutoff=now_brt()-dt.timedelta(minutes=30)
            for key,val in saved.get('vehicles',{}).items():
                fix=parse_iso(val.get('lastGpsFixAt'))
                if fix and fix>=cutoff:self.vehicles[key]=val
        except (OSError,ValueError,TypeError):pass

    def _save(self):
        self.state_file.parent.mkdir(parents=True,exist_ok=True)
        body={'schema':1,'updatedAt':iso(now_brt()),'sources':self.sources,
              'vehicles':self.vehicles}
        # atomic replacement: never leave a truncated JSON on interruption
        temp=self.state_file.with_name(self.state_file.name+'.tmp')
        with temp.open('w',encoding='utf8') as f:
            json.dump(body,f,ensure_ascii=False,separators=(',',':'))
            f.flush();os.fsync(f.fileno())
        os.replace(temp,self.state_file)

    @staticmethod
    def _download(url):
        req=urllib.request.Request(url,headers={'Accept':'application/json',
             'User-Agent':'BH-transporte-local-prototype/0.2 (public PBH feeds)'})
        with urllib.request.urlopen(req,timeout=20) as r:
            blob=r.read(12*1024*1024+1)
            if len(blob)>12*1024*1024: raise ValueError('Resposta excede 12MB')
            obj=json.loads(blob.decode('utf-8-sig'))
        if not isinstance(obj,list):raise ValueError('Feed nao retornou uma lista JSON')
        return obj

    def _parse(self, source, records, fetched):
        by_vehicle=collections.defaultdict(list)
        discarded=collections.Counter()
        for item in records:
            if not isinstance(item,dict):discarded['bad_record']+=1;continue
            nv=str(item.get('NV','')).strip(); nl=str(item.get('NL','')).strip()
            fix=parse_hr(item.get('HR'))
            if not nv or not fix:discarded['bad_id_or_time']+=1;continue
            if fix>fetched+dt.timedelta(seconds=60):discarded['future_clock']+=1;continue
            try:
                lat=float(str(item.get('LT','')).replace(',','.'))
                lon=float(str(item.get('LG','')).replace(',','.'))
                if not (-90<=lat<=90 and -180<=lon<=180) or not (math.isfinite(lat) and math.isfinite(lon)):
                    raise ValueError('bad coordinate')
            except (TypeError,ValueError):discarded['bad_location']+=1;continue
            h=None
            try:
                v=float(item.get('DG'))
                if 0<=v<=360:h=v
            except (ValueError,TypeError):pass
            key=source+'|'+nv
            by_vehicle[key].append({'lat':lat,'lng':lon,'heading':h,
                                    'fixAt':iso(fix),'NL':nl,'SV':str(item.get('SV','')),
                                    'speedRaw':item.get('VL'), 'NV':nv,
                                    'source':source})
        for key, hist in by_vehicle.items():
            hist.sort(key=lambda v:v['fixAt'])
            self._ingest_vehicle(key,hist,fetched)
        return dict(discarded)

    def _ingest_vehicle(self,key,hist,fetched):
        prior=self.vehicles.get(key)
        for o in hist:
            date=o['fixAt']
            if prior and date<=prior['lastGpsFixAt']:
                # The same observation can reappear in repeated downloaded history;
                # fetchedAt is NOT GPS fixAt and cannot reset unchangedSince.
                continue
            mapping=self.nl_map.get(o['source']+'|'+o['NL'],{})
            new_route=mapping.get('routeIds',[])
            if prior and (prior['NL'] != o['NL'] or prior['routeIds']!=new_route):
                # A vehicle may change service: do not mix trajectories.
                prior=None
            if prior is None:
                prior={'NV':o['NV'],'source':o['source'],'NL':o['NL'],
                       'public':mapping.get('public',''),
                       'routeIds':new_route,
                       'lat':o['lat'],'lng':o['lng'],
                       'anchorLat':o['lat'],'anchorLng':o['lng'],
                       'positionUnchangedSinceAt':date,
                       'lastGpsFixAt':date,'lastFetchedAt':iso(fetched),
                       'history':[], 'heading':o['heading'],
                       'SV':o['SV'],'speedRaw':o['speedRaw']}
            elif distance_m((prior['anchorLat'],prior['anchorLng']),
                            (o['lat'],o['lng']))>15.:
                # Repeated coordinates and minor GNSS jitter don't reset the clock.
                prior['positionUnchangedSinceAt']=date
                prior['anchorLat']=o['lat'];prior['anchorLng']=o['lng']
            prior['lastGpsFixAt']=date
            prior['lat']=o['lat'];prior['lng']=o['lng']
            prior['heading']=o['heading'];prior['speedRaw']=o['speedRaw']
            prior['SV']=o['SV']
            prior['lastFetchedAt']=iso(fetched)
            prior['history'].append({k:o[k] for k in ('lat','lng','heading','fixAt')})
            # Clear old trajectory; keep enough for conservative match only.
            cutoff=(parse_iso(date)-dt.timedelta(minutes=8)).isoformat(timespec='seconds')
            prior['history']=[r for r in prior['history'] if r['fixAt']>=cutoff][-12:]
        if prior:
            prior['lastFetchedAt']=iso(fetched)
            self.vehicles[key]=prior

    def refresh(self, force=False):
        with self.lock:
            if not force and self.last_attempt_monotonic and time.monotonic()-self.last_attempt_monotonic<self.ttl:
                return
            self.last_attempt_monotonic=time.monotonic()
            changed=False
            for name,url in FEEDS.items():
                try:
                    records=self.fetcher(url)
                    fetched=now_brt()
                    ignored=self._parse(name,records,fetched)
                    self.sources[name]={'lastFetchedAt':iso(fetched),
                                        'lastError':None,'responseRecords':len(records),
                                        'discarded':ignored}
                    changed=True
                except Exception as exc:
                    self.sources[name]['lastError']=f'{type(exc).__name__}: {str(exc)[:160]}'
            # Prevent persistent storage from indefinitely accumulating old vehicles.
            cutoff=now_brt()-dt.timedelta(minutes=30)
            for key,val in list(self.vehicles.items()):
                if (parse_iso(val['lastGpsFixAt']) or cutoff-dt.timedelta(seconds=1))<cutoff:
                    del self.vehicles[key]
            if changed:
                self._save()

    def status(self):
        self.refresh()
        with self.lock:
            reference=now_brt()
            recent=sum(0<=(reference-parse_iso(v['lastGpsFixAt'])).total_seconds()<=120
                       for v in self.vehicles.values())
            return {'now':iso(reference),'gpsRecent':recent,
                    'vehiclesKnown':len(self.vehicles), 'sources':self.sources,
                    'refreshIntervalSec':self.ttl}

    def routes_listing(self):
        return [{'code':r['code'],'name':r['name'],'id':r['id'],
                 'patternCount':len(r['patterns'])} for r in self.routes]

    def route_geometry(self,code,pattern_id=None):
        route=self.route_by_code.get(str(code))
        if route is None:return None
        patterns=[self.pattern_by_id[x] for x in route['patterns']]
        info={'code':route['code'],'name':route['name'],'patterns':[
            {'id':p['id'],'shapeId':p['shape'],'headsign':p['headsign'],
             'stops':len(p['stops']),'tripCount':p['tripCount']}
            for p in patterns]}
        if pattern_id:
            p=self.pattern_by_id.get(pattern_id)
            if not p or p['route']!=route['id']:return None
            info['selected']={'patternId':p['id'],'shapeId':p['shape'],
                 'headsign':p['headsign'],'coordinates':self.shapes.get(p['shape'],[]),
                 'stops':[{'id':s,'name':self.stops[s][0],
                           'lat':self.stops[s][1],'lng':self.stops[s][2]}
                          for s in p['stops'] if s in self.stops]}
        return info

    def search_stops(self, query='', limit=50):
        """Lookup in the static GTFS stop catalog; no GPS request needed."""
        import unicodedata
        def fold(text):
            return ''.join(ch for ch in unicodedata.normalize('NFKD',str(text).casefold())
                           if not unicodedata.combining(ch))
        q=fold(query).strip()
        n=max(1,min(int(limit),80))
        found=[]
        for sid,entry in self.stops.items():
            if q and q not in fold(entry[0]) and q not in fold(sid):continue
            found.append({'id':sid,'name':entry[0],'lat':entry[1],'lng':entry[2]})
            if len(found)>=n:break
        return {'items':found,'truncated':len(found)>=n,'query':query}

    def fleet(self,code):
        self.refresh()
        with self.lock:
            route=self.route_by_code.get(str(code))
            if route is None:return None
            timestamp=now_brt()
            active=[]
            for v in self.vehicles.values():
                if route['id'] not in v['routeIds']:continue
                age=max(0,(timestamp-parse_iso(v['lastGpsFixAt'])).total_seconds())
                unchanged=max(0,(timestamp-parse_iso(v['positionUnchangedSinceAt'])).total_seconds())
                if age>600:continue
                sample={'vehicleId':v['NV'],'source':v['source'],'NL':v['NL'],
                    'public':v['public'],'latitude':v['lat'],'longitude':v['lng'],
                    'heading':v['heading'],'speedRaw':v['speedRaw'],'SV':v['SV'],
                    'lastGpsFixAt':v['lastGpsFixAt'],
                    'positionUnchangedSinceAt':v['positionUnchangedSinceAt'],
                    'lastFetchedAt':v['lastFetchedAt'],
                    'ageSec':round(age),'unchangedSec':round(unchanged),
                    'gpsStatus':('recent' if age<=120 else 'delayed' if age<=300 else 'stale')}
                # Require multiple independent fix timestamps; repeated HTTP
                # responses do not count as trajectory evidence.
                history=v['history']
                sample['shapeMatch']=self.matcher.resolve(route['shapes'],history)
                active.append(sample)
            active.sort(key=lambda v:(v['ageSec'],v['vehicleId']))
            return {'line':route['code'],'name':route['name'],
                    'asOf':iso(timestamp),'count':len(active),
                    'vehicles':active,'sources':self.sources}
