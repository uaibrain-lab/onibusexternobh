"""GPS ingestion, source cache and persistent immutable fix times.

No dependencies beyond CPython >=3.9. Local prototype only, not public hosting.
"""
from __future__ import annotations
import collections, datetime as dt, json, math, os, pathlib, tempfile, threading, time, urllib.request
from .matcher import ShapeMatcher, distance_m
from .eta import GpsArrivalEstimator

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
        self.eta=GpsArrivalEstimator(self.matcher,self.patterns,self.stops)
        self.stop_routes=collections.defaultdict(set)
        self.stop_directions=collections.defaultdict(set)
        for p in self.patterns:
            route=self.route_by_id.get(p['route'])
            if route:
                for stop in p['stops']:
                    self.stop_routes[stop].add(route['code'])
                    if p.get('headsign'):
                        self.stop_directions[stop].add((route['code'],p['headsign']))
        # Lazy import to avoid circular dependency with shared BRT helpers.
        from .timetable import Timetable
        self.timetable=Timetable(self.catalog)
        self.ttl=max(20,int(ttl))
        self.fetcher=fetcher or self._download
        self.lock=threading.RLock()
        self.vehicles={}
        self.sources={name:{'lastFetchedAt':None,'lastError':None,'responseRecords':0}
                      for name in FEEDS}
        self.last_attempt_monotonic=0.
        # Aggregate coverage only: no passenger identifiers or exact user coordinates.
        self.eta_coverage=collections.Counter()
        self.eta_coverage_started=now_brt()
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

    def nearby_stops(self,lat,lng,limit=15,radius_m=2500):
        """Return nearest stops; never request or store user's coordinates upstream."""
        lat=float(lat);lng=float(lng)
        if not (-90<=lat<=90 and -180<=lng<=180):raise ValueError('invalid coordinate')
        ranked=[]
        for sid,entry in self.stops.items():
            dist=distance_m((lat,lng),(entry[1],entry[2]))
            if dist<=radius_m:
                ranked.append((dist,sid,entry))
        ranked.sort(key=lambda x:x[0])
        return {'items':[{'id':sid,'name':e[0],'lat':e[1],'lng':e[2],
                          'distanceM':round(dist)} for dist,sid,e in ranked[:max(1,min(50,int(limit)))]],
                'count':len(ranked)}

    def map_stops(self, minlat,minlng,maxlat,maxlng,limit=550):
        """Stops in viewport, with cap for efficient rendering in canvas."""
        a,b,c,d=map(float,(minlat,minlng,maxlat,maxlng))
        if not (-90<=a<=c<=90 and -180<=b<=d<=180):raise ValueError('invalid bounds')
        limit=max(1,min(750,int(limit)))
        visible=[{'id':sid,'name':e[0],'lat':e[1],'lng':e[2]}
                 for sid,e in self.stops.items() if a<=e[1]<=c and b<=e[2]<=d]
        return {'items':visible[:limit],'total':len(visible),'truncated':len(visible)>limit}

    def alternative_stops(self, stop_id, radius_m=100, limit=3):
        """Nearby stops with different advertised headsigns for shared lines.

        Geographic proximity does NOT prove the platform or side of the road.
        Passenger receives candidate stops to inspect, never an invented side.
        """
        stop_id=str(stop_id)
        point=self.stops.get(stop_id)
        if point is None:return []
        directions=self.stop_directions.get(stop_id,set())
        if not directions:return []
        scored=[]
        for sid,other in self.stops.items():
            if sid==stop_id:continue
            shared=self.stop_routes.get(sid,set()) & self.stop_routes.get(stop_id,set())
            if not shared:continue
            alt_dir=self.stop_directions.get(sid,set())
            distinct=any(code in shared and not any(code==cc and head==hh for cc,hh in directions)
                         for code,head in alt_dir)
            if not distinct:continue
            distance=distance_m((point[1],point[2]),(other[1],other[2]))
            if distance>radius_m:continue
            scored.append((distance,sid,other))
        scored.sort(key=lambda x:x[0])
        return [{'id':sid,'name':other[0], 'lat':other[1], 'lng':other[2],
                 'distanceM':round(distance)} for distance,sid,other in scored[:limit]]

    def stop_detail(self,stop_id,at=None):
        item=self.stops.get(str(stop_id))
        if not item:return None
        # Never hold the state lock while requesting external feed URLs.
        # The normal TTL shares the response across all stop lookups.
        self.refresh()
        now=at or now_brt()
        forecasts=self.timetable.next_by_direction(str(stop_id),now)
        routes=[]
        with self.lock:
            # Aggregate without retaining which stop a user opened.
            if (now-self.eta_coverage_started).total_seconds()>3600:
                self.eta_coverage.clear()
                self.eta_coverage_started=now
            self.eta_coverage['stopQueries']+=1
            by_route=collections.defaultdict(list)
            for vehicle in self.vehicles.values():
                for rid in vehicle.get('routeIds',[]):
                    by_route[rid].append(vehicle)
            for code in sorted(self.stop_routes.get(str(stop_id),()),key=lambda c:(not c.isdigit(),c)):
                route=self.route_by_code.get(code)
                if not route:continue
                gps=self.eta.estimate(route,str(stop_id),by_route.get(route['id'],()),now)
                # Each GTFS headsign is a distinct passenger-facing direction.
                # A GPS estimate may replace only the matching headsign, never
                # the earliest timetable entry for a different destination.
                directions={dest:forecast for (line,dest),forecast in forecasts.items() if line==code}
                if gps:
                    direction=str(gps.get('destination') or '').strip()
                    if direction:
                        directions[direction]=gps
                    else:
                        gps=None
                if not directions:
                    directions={'':None}
                for direction,arrival in directions.items():
                    self.eta_coverage['linesChecked']+=1
                    self.eta_coverage['gpsEstimates' if arrival and arrival.get('type')=='gps_estimate' else 'timetableFallbacks' if arrival else 'unavailable']+=1
                    routes.append({'code':code,'name':route['name'],
                                   'destination':direction,
                                   'nextArrival':arrival})
        routes.sort(key=lambda x:(x['nextArrival'] is None,
                                 x['nextArrival']['minutes'] if x['nextArrival'] else 10**10,
                                 x['code']))
        return {'id':str(stop_id),'name':item[0],'lat':item[1],'lng':item[2],
                'routes':routes,'asOf':iso(now),
                'forecastSource':('GPS + GTFS scheduled' if any(r['nextArrival'] and r['nextArrival']['type']=='gps_estimate' for r in routes) else 'GTFS scheduled (not GPS)'),
                'alternatives':self.alternative_stops(stop_id),
                'timetableAvailable':self.timetable.error is None and self.timetable.calendar is not None}

    def eta_coverage_summary(self):
        """Diagnostic counters only, not a measure of real-world ETA error."""
        with self.lock:
            counts=dict(self.eta_coverage)
            lines=counts.get('linesChecked',0)
            return {'periodStartedAt':iso(self.eta_coverage_started),
                    'queries':counts.get('stopQueries',0),
                    'linesChecked':lines,
                    'gpsEstimates':counts.get('gpsEstimates',0),
                    'timetableFallbacks':counts.get('timetableFallbacks',0),
                    'unavailable':counts.get('unavailable',0),
                    'gpsCoverage':round(counts.get('gpsEstimates',0)/lines,4) if lines else None,
                    'accuracyVerified':False}

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
