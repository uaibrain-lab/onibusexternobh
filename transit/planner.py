"""Time-dependent GTFS journey planner for BH buses; rail hints are not ranked ETAs.

Trip-level data from build_routing.py. This is a conservative bounded search
with Pareto labels, two transfers at most, nearby stop interchange estimates,
a forward (departAt) and a backward (arriveBy) search.

Walking connectors use a conservative crow-flight multiplier, not an OSM
pedestrian graph. Always label durations/distances approximate. Never
interpret per-line GPS as a GTFS trip update.
"""
from __future__ import annotations

import collections
import datetime as dt
import functools
import gzip
import json
import math
import pathlib
from dataclasses import dataclass
from typing import Optional

from .matcher import distance_m
from .metro import BRT
from .walking import PedestrianRouter

WEEKDAYS = ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
WALK_SPEED_M_S = 1.15
WALK_FACTOR = 1.35
MAX_RIDES = 3
MAX_ROUTE_SCANS = 500
MAX_STOP_SCANS = 3000000
HORIZON_SECONDS = 5 * 3600
TRANSFER_BUFFER_SECONDS = 45


@dataclass
class Label:
    stop: str
    time: float
    walked: float
    rides: int
    parent: Optional['Label']
    edge: dict


class PlannerError(ValueError):
    pass


class JourneyPlanner:
    def __init__(self, catalog_dir, metro=None, pedestrian=None):
        self.pedestrian=pedestrian if pedestrian is not None else PedestrianRouter()
        self.catalog = pathlib.Path(catalog_dir)
        self.metro = metro
        self.ready = False
        self.failure = 'Índice de viagens não encontrado'
        index_path = self.catalog / 'routing-index.json'
        if not index_path.exists():
            return
        try:
            self.index = json.loads(index_path.read_text('utf-8'))
            if self.index['schema'] != 2:
                raise ValueError('Versão de índice não suportada')
            self.stops = json.loads((self.catalog/'routing-stops.json').read_text('utf-8'))
            self.stop_routes = json.loads((self.catalog/'routing-stop-routes.json').read_text('utf-8'))
            self.files = self.index['files']
            self.routes = {r['code']:r['name'] for r in json.loads(
                (self.catalog/'routes.json').read_text('utf-8'))}
            self.cells = collections.defaultdict(list)
            for sid, (name,lat,lng) in self.stops.items():
                self.cells[self._cell(float(lat),float(lng))].append(sid)
            self.ready = True
            self.failure = None
        except (OSError, KeyError, ValueError, TypeError) as exc:
            self.failure = type(exc).__name__

    @staticmethod
    def _cell(lat,lng):
        return int(math.floor(lat*200)), int(math.floor(lng*200))

    @staticmethod
    def _geo(point):
        if not isinstance(point,dict):
            raise PlannerError('Origem e destino devem conter lat e lng')
        try:
            a = float(point['lat'])
            b = float(point['lng'])
        except (ValueError,TypeError,KeyError):
            raise PlannerError('Coordenadas inválidas')
        if not math.isfinite(a) or not math.isfinite(b) or not (-90<=a<=90 and -180<=b<=180):
            raise PlannerError('Coordenadas inválidas')
        return (a,b)

    def nearby(self,lat,lng,radius=1050,limit=20):
        # Cell spacing ~550 m latitude in BH. Bound longitude conservatively.
        i,j=self._cell(lat,lng)
        span=max(1,int(math.ceil(radius/400))+1)
        found=[]
        for di in range(-span,span+1):
            for dj in range(-span,span+1):
                for sid in self.cells.get((i+di,j+dj),()):
                    s=self.stops[sid]
                    m=distance_m((lat,lng),(float(s[1]),float(s[2])))
                    if m<=radius:
                        found.append((m,sid))
        found.sort(key=lambda a:a[0])
        return found[:limit]

    def _walk_time(self,dist):
        return max(20.,dist * WALK_FACTOR / WALK_SPEED_M_S + 25.)

    @staticmethod
    def _iso(stamp):
        return dt.datetime.fromtimestamp(stamp,BRT).isoformat(timespec='seconds')

    @staticmethod
    def _moment(value):
        if not value:
            return dt.datetime.now(BRT)
        try:
            t=dt.datetime.fromisoformat(value)
            if t.tzinfo is None:
                t=t.replace(tzinfo=BRT)
            return t.astimezone(BRT)
        except (ValueError, TypeError):
            raise PlannerError('Data e horário inválidos')

    @functools.lru_cache(maxsize=8192)
    def _valid(self,service,date):
        d=date.strftime('%Y%m%d')
        override=self.index['exceptions'].get(d,{}).get(service)
        if override is not None:
            return override==1
        entry=self.index['services'].get(service)
        return bool(entry and entry['start_date']<=d<=entry['end_date']
                    and entry[WEEKDAYS[date.weekday()]]=='1')

    @functools.lru_cache(maxsize=96)
    def _trips(self,code):
        name=self.files.get(code)
        if not name:
            return ()
        try:
            with gzip.open(self.catalog/name,'rt',encoding='utf-8') as file:
                return tuple(json.loads(line) for line in file)
        except (OSError,ValueError):
            return ()

    def _insert(self,labels,label,backward=False,stats=None):
        current=labels.setdefault(label.stop,[])
        for other in current:
            if (other.time>=label.time if backward else other.time<=label.time) and other.walked<=label.walked+1:
                return False
        current[:]=[other for other in current if not (
            (label.time>=other.time if backward else label.time<=other.time)
            and label.walked<=other.walked+1)]
        current.append(label)
        if len(current)>5:
            if stats is not None: stats['truncatedLabels']=True
            best_time=lambda l:-l.time if backward else l.time
            current.sort(key=lambda l:(best_time(l)+l.walked*.15,l.walked))
            del current[5:]
        return any(x is label for x in current)

    @staticmethod
    def _dominates(a,b,backward):
        """True only if a is no worse in time, walking AND vehicle count."""
        return (a.time>=b.time if backward else a.time<=b.time) and (
            a.walked<=b.walked+0.01 and a.rides<=b.rides)

    def _insert_global(self,history,label,backward,stats=None):
        prior=history.setdefault(label.stop,[])
        if any(self._dominates(old,label,backward) for old in prior):
            return False
        prior[:]=[old for old in prior if not self._dominates(label,old,backward)]
        prior.append(label)
        # Keep representative Pareto labels. Huge fan-out in terminal areas
        # otherwise produces exponential combinations of redundant options.
        if len(prior)>12:
            if stats is not None: stats['truncatedLabels']=True
            prior.sort(key=lambda x:(((-x.time if backward else x.time)-
                                      (0 if backward else 0)) / 60+
                                      x.walked/60+x.rides*25,
                                      x.walked,x.rides))
            del prior[12:]
        return any(x is label for x in prior)

    def _edge_walk(self,source,dest,meters,depart,arrive):
        return {'mode':'walk','from':source,'to':dest,
                'metersApprox':round(meters * WALK_FACTOR),
                'departure':self._iso(depart),'arrival':self._iso(arrive),
                'pathVerified':False}

    def _edge_bus(self,code,trip,headsign,a,b,depart,arrive):
        return {'mode':'bus','line':code,'lineName':self.routes.get(code,code),
                'tripId':trip,'headsign':headsign,
                'from':a,'to':b,
                'fromName':self.stops[a][0],'toName':self.stops[b][0],
                'fromCoords':[float(self.stops[a][1]),float(self.stops[a][2])],
                'toCoords':[float(self.stops[b][1]),float(self.stops[b][2])],
                'departure':self._iso(depart),'arrival':self._iso(arrive),
                'prediction':'GTFS scheduled'}

    @functools.lru_cache(maxsize=20000)
    def _transfer_neighbors(self,stop_id):
        stop=self.stops.get(stop_id)
        if not stop:
            return ()
        return tuple((meters,sid) for meters,sid in
                     self.nearby(float(stop[1]),float(stop[2]),radius=165,limit=9)
                     if sid!=stop_id and meters>=2)

    @staticmethod
    def _dominated_scalar(labels,stop,time,walked,rides,backward):
        for old in labels.get(stop,()):
            if ((old.time>=time if backward else old.time<=time) and
                old.walked<=walked+0.01 and old.rides<=rides):
                return True
        return False

    def _transfer(self,labels,backward,history,stats):
        # Transfer only between very nearby stop coordinates; not a street route.
        seed=[x for values in labels.values() for x in values]
        # Avoid explosive footpath expansion in busy terminals.
        for old in seed[:18000]:
            for meters,sid in self._transfer_neighbors(old.stop):
                seconds=self._walk_time(meters)+TRANSFER_BUFFER_SECONDS
                t=old.time-seconds if backward else old.time+seconds
                walked=old.walked+meters*WALK_FACTOR
                if self._dominated_scalar(history,sid,t,walked,old.rides,backward):
                    continue
                if self._dominated_scalar(labels,sid,t,walked,old.rides,backward):
                    continue
                edge=(self._edge_walk(sid,old.stop,meters,t,old.time) if backward
                      else self._edge_walk(old.stop,sid,meters,old.time,t))
                node=Label(sid,t,walked,old.rides,old,edge)
                if self._insert(labels,node,backward,stats):
                    self._insert_global(history,node,backward,stats)

    def _scan_round(self,prior,search_ts,backward,stats,history):
        next_labels={}
        counts=collections.Counter(code for sid in prior for code in self.stop_routes.get(sid,())
                                    if code in self.files)
        routes=[code for code,count in counts.most_common(MAX_ROUTE_SCANS)]
        if len(counts)>len(routes):
            stats['limited']=True
        q_day=dt.datetime.fromtimestamp(search_ts,BRT).date()
        days=[q_day-dt.timedelta(days=1),q_day,q_day+dt.timedelta(days=1)]
        for code in routes:
            rows=self._trips(code)
            for trip_id,service,headsign,stops in rows:
                eligible_days=[day for day in days if self._valid(service,day)]
                if not eligible_days:
                    continue
                # Check the GTFS time window before scanning thousands of stops
                # for candidate boarding. This avoids processing out-of-window trips.
                for day in eligible_days:
                    midnight=dt.datetime.combine(day,dt.time.min,BRT).timestamp()
                    earliest=midnight+stops[0][2]
                    latest=midnight+stops[-1][1]
                    if backward:
                        if earliest>search_ts or latest<search_ts-HORIZON_SECONDS:
                            continue
                    else:
                        if latest<search_ts or earliest>search_ts+HORIZON_SECONDS:
                            continue
                    if not any(s[0] in prior for s in stops):
                        continue
                    candidates=[]
                    entries=reversed(stops) if backward else iter(stops)
                    for row in entries:
                        sid,arr,dep,pickup,dropoff = row
                        stats['stopScans']+=1
                        if stats['stopScans']>MAX_STOP_SCANS:
                            stats['limited']=True
                            return next_labels
                        epoch=midnight+(dep if backward else arr)
                        # Alight only at a stop where GTFS permits alighting.
                        # In reverse, this position is the BOARDING stop.
                        may_exit = pickup==0 if backward else dropoff==0
                        if may_exit:
                          for earlier,board_sid,board_epoch in candidates:
                            if sid==board_sid:
                                continue
                            if backward and epoch<search_ts-HORIZON_SECONDS:
                                continue
                            if not backward and epoch>search_ts+HORIZON_SECONDS:
                                continue
                            walked=earlier.walked
                            rides=earlier.rides+1
                            if self._dominated_scalar(history,sid,epoch,walked,rides,backward):
                                continue
                            if self._dominated_scalar(next_labels,sid,epoch,walked,rides,backward):
                                continue
                            if backward:
                                edge=self._edge_bus(code,trip_id,headsign,sid,board_sid,
                                                    midnight+dep,board_epoch)
                            else:
                                edge=self._edge_bus(code,trip_id,headsign,board_sid,sid,
                                                    board_epoch,midnight+arr)
                            node=Label(sid,epoch,walked,rides,earlier,edge)
                            if self._insert(next_labels,node,backward,stats):
                                self._insert_global(history,node,backward,stats)
                        # Add board possibilities after dropping at this stop.
                        # A trip cannot be entered where boarding is forbidden.
                        # In backward search, the reachable stop is an ALIGHTING stop.
                        may_enter = dropoff==0 if backward else pickup==0
                        if may_enter and sid in prior:
                            for label in prior[sid]:
                                departure=midnight+dep
                                arrival=midnight+arr
                                feasible=(label.time>=arrival+TRANSFER_BUFFER_SECONDS
                                          if backward else departure>=label.time+TRANSFER_BUFFER_SECONDS)
                                valid_horizon=(departure>=search_ts-HORIZON_SECONDS if backward
                                               else departure<=search_ts+HORIZON_SECONDS)
                                if feasible and valid_horizon:
                                    # keep a few labels to retain walking/time tradeoffs
                                    candidates.append((label,sid,arrival if backward else departure))
                                    candidates.sort(key=lambda e:(e[0].walked,
                                                   -e[0].time if backward else e[0].time))
                                    if len(candidates)>4:
                                        candidates=candidates[:4]
        return next_labels

    def _path(self,label,backward):
        legs=[]
        while label:
            if label.edge:
                legs.append(label.edge)
            label=label.parent
        if not backward:
            legs.reverse()
        return legs

    def _collect(self,labels,origin,dest,search_ts,backward):
        endings=self.nearby(*(origin if backward else dest),radius=1050,limit=22)
        results=[]
        for meters,sid in endings:
            for label in labels.get(sid,()):
                delay=self._walk_time(meters)
                if backward:
                    # Reserve a boarding buffer at the initial stop too.
                    walk_arrival=label.time-TRANSFER_BUFFER_SECONDS
                    departure=walk_arrival-delay
                    legs=[self._edge_walk('origin',sid,meters,departure,walk_arrival)]+self._path(label,True)
                    # Actual arrival is usually earlier than the requested deadline.
                    # Never inflate the itinerary duration with artificial idle time.
                    finish=search_ts
                    if len(legs)>=2 and legs[-1]['mode']=='walk':
                        last_bus=next((leg for leg in reversed(legs[:-1]) if leg['mode']=='bus'),None)
                        if last_bus:
                            last_arrival=dt.datetime.fromisoformat(last_bus['arrival']).timestamp()
                            trailing=legs[-1]
                            extra_walk=trailing['metersApprox']/WALK_FACTOR
                            finish=min(search_ts,last_arrival+self._walk_time(extra_walk))
                            trailing['departure']=self._iso(last_arrival)
                            trailing['arrival']=self._iso(finish)
                    if departure>search_ts or search_ts-departure>HORIZON_SECONDS:
                        continue
                else:
                    departure=search_ts
                    finish=label.time+delay
                    legs=self._path(label,False)+[self._edge_walk(sid,'destination',meters,label.time,finish)]
                    if finish<search_ts or finish-search_ts>HORIZON_SECONDS:
                        continue
                if not any(leg['mode']=='bus' for leg in legs):
                    continue
                results.append({'departure':self._iso(departure),
                                'arrival':self._iso(finish),
                                'durationMinutes':round((finish-departure)/60),
                                'walkMetersApprox':round(label.walked+meters*WALK_FACTOR),
                                'transfers':max(0,label.rides-1),
                                'rides':label.rides,'legs':legs,
                                'confidence':'scheduled_gtfs_with_unverified_walks'})
        return results

    def _stop_coordinates(self,key,origin,dest):
        if key=='origin':
            return origin
        if key=='destination':
            return dest
        stop=self.stops.get(key)
        return (float(stop[1]),float(stop[2])) if stop else None

    def _verify_walks(self,itinerary,origin,dest,backward,deadline):
        """Validate pedestrian connectivity and *actual* boarding feasibility.

        Without a configured local OSM router this method is not called, and
        output remains explicitly approximate. When configured, inaccessible
        connections or missed buses are excluded, never guessed.
        """
        legs=itinerary['legs']
        walked=0
        for idx,leg in enumerate(legs):
            if leg['mode']!='walk':
                continue
            a=self._stop_coordinates(leg['from'],origin,dest)
            b=self._stop_coordinates(leg['to'],origin,dest)
            if a is None or b is None:
                return False
            route=self.pedestrian.route(a,b)
            if not route:
                return False
            leg['metersApprox']=route['distanceM']
            leg['durationSeconds']=route['durationSeconds']
            leg['pathVerified']=True
            leg['walkSource']=route['source']
            walked+=route['distanceM']
            prev=legs[idx-1] if idx else None
            next_leg=legs[idx+1] if idx+1<len(legs) else None
            if prev:
                when=dt.datetime.fromisoformat(prev['arrival']).timestamp()
            elif backward and next_leg and next_leg['mode']=='bus':
                when=(dt.datetime.fromisoformat(next_leg['departure']).timestamp()
                      -TRANSFER_BUFFER_SECONDS-route['durationSeconds'])
            else:
                when=dt.datetime.fromisoformat(itinerary['departure']).timestamp()
            finish=when+route['durationSeconds']
            if next_leg and next_leg['mode']=='bus':
                boarding=dt.datetime.fromisoformat(next_leg['departure']).timestamp()
                if finish+TRANSFER_BUFFER_SECONDS>boarding:
                    return False
            leg['departure']=self._iso(when)
            leg['arrival']=self._iso(finish)
        if not legs:
            return False
        itinerary['walkMetersApprox']=walked
        itinerary['departure']=legs[0]['departure']
        itinerary['arrival']=legs[-1]['arrival']
        first=dt.datetime.fromisoformat(itinerary['departure']).timestamp()
        last=dt.datetime.fromisoformat(itinerary['arrival']).timestamp()
        if first>=last or last-first>HORIZON_SECONDS:
            return False
        if backward and last>deadline:
            return False
        itinerary['durationMinutes']=round((last-first)/60)
        itinerary['confidence']='scheduled_gtfs_with_osm_pedestrian_paths'
        return True

    def _metro_hints(self,origin,dest,at):
        if not self.metro:
            return []
        try:
            starts=self.metro.nearby(*origin,radius_m=1050)['items']
            ends=self.metro.nearby(*dest,radius_m=1050)['items']
            hints=[]
            for a in starts[:3]:
                for b in ends[:3]:
                    if a['id']==b['id']:
                        continue
                    for line in self.metro.data['lines']:
                        stops=line['stations']
                        if a['id'] not in stops or b['id'] not in stops:
                            continue
                        service=self.metro.service(line['id'],at)
                        if not service['stationOpenAtTime']:
                            continue
                        i,j=stops.index(a['id']),stops.index(b['id'])
                        hints.append({'mode':'metro','line':line['id'],
                                      'fromStation':a['name'],'toStation':b['name'],
                                      'fromStationId':a['id'],'toStationId':b['id'],
                                      'stationCount':abs(j-i),
                                      'originDistanceMApprox':a['distanceM'],
                                      'destinationDistanceMApprox':b['distanceM'],
                                      'status':'requires_timetable',
                                      'note':'Possibilidade de metrô; sem viagens/horários verificados, não classificada com os ônibus.'})
            hints.sort(key=lambda h:h['originDistanceMApprox']+h['destinationDistanceMApprox'])
            return hints[:4]
        except (KeyError,ValueError,TypeError):
            return []

    def plan(self,origin,destination,at=None,mode='departAt',preference='fastest'):
        origin=self._geo(origin)
        destination=self._geo(destination)
        if mode not in ('departAt','arriveBy'):
            raise PlannerError('Modo deve ser departAt ou arriveBy')
        if preference not in ('fastest','leastWalking','leastTransfers'):
            raise PlannerError('Preferência inválida')
        at_dt=self._moment(at)
        if not self.ready:
            return {'status':'not_ready','reason':self.failure,
                    'message':'Índice GTFS de viagens ainda não gerado.',
                    'itineraries':[],'metroHints':self._metro_hints(origin,destination,at_dt)}
        day=at_dt.strftime('%Y%m%d')
        if (self.index['validFrom'] and day<self.index['validFrom'] or
            self.index['validThrough'] and day>self.index['validThrough']):
            return {'status':'out_of_calendar',
                    'message':'Data fora da validade do GTFS de viagens. Não extrapolamos horários.',
                    'validFrom':self.index['validFrom'],'validThrough':self.index['validThrough'],
                    'itineraries':[],'metroHints':[]}
        backward=(mode=='arriveBy')
        search_ts=at_dt.timestamp()
        starts=self.nearby(*(destination if backward else origin),radius=1050,limit=22)
        prior={}
        stats={'stopScans':0,'limited':False,'truncatedLabels':False,'rounds':0}
        for meters,sid in starts:
            delay=self._walk_time(meters)
            t=search_ts-delay if backward else search_ts+delay
            edge=(self._edge_walk(sid,'destination',meters,t,search_ts) if backward
                  else self._edge_walk('origin',sid,meters,search_ts,t))
            self._insert(prior,Label(sid,t,meters*WALK_FACTOR,0,None,edge),backward,stats)
        candidates=[]
        history={sid:list(labels) for sid,labels in prior.items()}
        for rides in range(MAX_RIDES):
            if not prior:
                break
            gained=self._scan_round(prior,search_ts,backward,stats,history)
            stats['rounds']=rides+1
            if gained:
                candidates.extend(self._collect(gained,origin,destination,search_ts,backward))
            if stats['limited']:
                break
            self._transfer(gained,backward,history,stats)
            prior=gained
        if preference=='leastWalking':
            key=lambda x:(x['walkMetersApprox'],x['durationMinutes'],x['transfers'])
        elif preference=='leastTransfers':
            key=lambda x:(x['transfers'],x['durationMinutes'],x['walkMetersApprox'])
        else:
            key=lambda x:(x['arrival'] if not backward else
                          -dt.datetime.fromisoformat(x['departure']).timestamp(),
                          x['walkMetersApprox'],x['transfers'])
        # Validate walks against the actual pedestrian OSM network if a
        # locally configured Valhalla router exists. Re-rank afterwards
        # because real distances can change fastest/least-walking choices.
        if self.pedestrian.enabled:
            verified=[]
            for option in candidates:
                if self._verify_walks(option,origin,destination,backward,search_ts):
                    verified.append(option)
            walk_unavailable=bool(candidates) and not verified
            candidates=verified
        else:
            walk_unavailable=False
        unique={}
        for option in sorted(candidates,key=key):
            sig=tuple((leg.get('tripId'),leg.get('from'),leg.get('to'))
                      for leg in option['legs'] if leg['mode']=='bus')
            if sig not in unique:
                unique[sig]=option
            if len(unique)>=12:
                break
        return {'status': 'walking_unavailable' if walk_unavailable else
                          'partial' if stats['limited'] or stats['truncatedLabels'] else 'ok',
                'mode':mode,'preference':preference,'requestedAt':at_dt.isoformat(),
                'itineraries':list(unique.values())[:6],
                'metroHints':self._metro_hints(origin,destination,at_dt),
                'stats':stats,
                'pedestrianRouting': 'local_osm' if self.pedestrian.enabled else 'approximate',
                'notes':[
                    'Horários de ônibus são da tabela GTFS, NÃO ETA ajustado ao GPS.',
                    'Caminhadas e transferências usam distância geográfica estimada; ainda não há roteamento de pedestres pelas ruas.',
                    'Metrô é apenas sugestão informativa até existir grade de horários ou feed validado.',
                ]}
