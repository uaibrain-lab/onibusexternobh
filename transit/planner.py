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

WEEKDAYS = ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
WALK_SPEED_M_S = 1.15
WALK_FACTOR = 1.35
MAX_RIDES = 3
MAX_STOP_SCANS = 4000000
MAX_TRANSFER_LABELS = 22000
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
    def __init__(self, catalog_dir, metro=None):
        self.catalog = pathlib.Path(catalog_dir)
        self.metro = metro
        self.ready = False
        self.failure = 'Índice de viagens não encontrado'
        index_path = self.catalog / 'routing-index.json'
        if not index_path.exists():
            return
        try:
            self.index = json.loads(index_path.read_text('utf-8'))
            if self.index['schema'] not in (1, 2):
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

    def _valid(self,service,date):
        d=date.strftime('%Y%m%d')
        override=self.index['exceptions'].get(d,{}).get(service)
        if override is not None:
            return override==1
        entry=self.index['services'].get(service)
        return bool(entry and entry['start_date']<=d<=entry['end_date']
                    and entry[WEEKDAYS[date.weekday()]]=='1')

    @functools.lru_cache(maxsize=32)
    def _trips(self,code):
        name=self.files.get(code)
        if not name:
            return ()
        try:
            with gzip.open(self.catalog/name,'rt',encoding='utf-8') as file:
                return tuple(json.loads(line) for line in file)
        except (OSError,ValueError) as exc:
            raise PlannerError('Falha ao ler o índice da linha '+str(code)) from exc

    @functools.lru_cache(maxsize=24)
    def _trip_stop_index(self, code):
        """Inverted stop->trip offsets for this route.

        Prevents scanning the full city's stop_times in each search round.
        The immutable route shard stays the source of truth for trips,
        service dates, and the exact stop sequence.
        """
        by_stop = collections.defaultdict(list)
        for i, (_, _, _, stops) in enumerate(self._trips(code)):
            # Preserve each trip only once per stop, even on loop services.
            for sid in {row[0] for row in stops}:
                by_stop[sid].append(i)
        return {sid: tuple(indices) for sid, indices in by_stop.items()}

    def _insert(self,labels,label,backward=False):
        current=labels.setdefault(label.stop,[])
        for other in current:
            if (other.time>=label.time if backward else other.time<=label.time) and other.walked<=label.walked+1:
                return False
        current[:]=[other for other in current if not (
            (label.time>=other.time if backward else label.time<=other.time)
            and label.walked<=other.walked+1)]
        current.append(label)
        if len(current)>5:
            best_time=lambda l:-l.time if backward else l.time
            current.sort(key=lambda l:(best_time(l)+l.walked*.15,l.walked))
            del current[5:]
        return any(x is label for x in current)

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

    def _transfer(self,labels,backward,stats=None):
        # Transfers are still geometric approximations, not validated walking paths.
        seed=[x for values in labels.values() for x in values]
        if len(seed)>MAX_TRANSFER_LABELS:
            if stats is not None:
                stats['limited']=True
                stats['transferLabelsPruned']=len(seed)-MAX_TRANSFER_LABELS
            # Retain earliest arrival/latest departure and low-walking labels.
            best=lambda l: (-l.time if backward else l.time)+l.walked*0.25
            seed.sort(key=best)
            seed=seed[:MAX_TRANSFER_LABELS]
        for old in seed:
            stop=self.stops.get(old.stop)
            if not stop:
                continue
            for meters,sid in self.nearby(float(stop[1]),float(stop[2]),radius=165,limit=40):
                if sid==old.stop or meters<2:
                    continue
                seconds=self._walk_time(meters)+TRANSFER_BUFFER_SECONDS
                t=old.time-seconds if backward else old.time+seconds
                edge=(self._edge_walk(sid,old.stop,meters,t,old.time) if backward
                      else self._edge_walk(old.stop,sid,meters,old.time,t))
                self._insert(labels,Label(sid,t,old.walked+meters*WALK_FACTOR,
                                          old.rides,old,edge),backward)

    def _scan_round(self,prior,search_ts,backward,stats):
        next_labels={}
        counts=collections.Counter(code for sid in prior for code in self.stop_routes.get(sid,())
                                    if code in self.files)
        # Explore EVERY candidate line. No arbitrary top-135 truncation.
        # The inverted stop->trip index makes this tractable.
        routes=sorted(counts,key=lambda code:(-counts[code],code))
        stats['candidateRoutes']=len(routes)
        q_day=dt.datetime.fromtimestamp(search_ts,BRT).date()
        days=[q_day-dt.timedelta(days=1),q_day,q_day+dt.timedelta(days=1)]
        for code in routes:
            rows=self._trips(code)
            by_stop=self._trip_stop_index(code)
            indices=set()
            for sid in prior:
                indices.update(by_stop.get(sid,()))
            stats['candidateTrips']=stats.get('candidateTrips',0)+len(indices)
            for idx in sorted(indices):
                trip_id,service,headsign,stops=rows[idx]
                eligible_days=[day for day in days if self._valid(service,day)]
                if not eligible_days:
                    continue
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
                    # A single trip reaches each downstream stop at a fixed
                    # time, regardless of where it was boarded. Of all feasible
                    # boardings, the least-walking prefix dominates the others.
                    # This preserves earliest arrival + walking Pareto quality
                    # while avoiding repeated candidate expansion.
                    best_board = None
                    entries=reversed(stops) if backward else iter(stops)
                    for row in entries:
                        sid,arr,dep=row[:3]
                        pickup = int(row[3]) if len(row)>3 else 0
                        dropoff = int(row[4]) if len(row)>4 else 0
                        stats['stopScans']+=1
                        if stats['stopScans']>MAX_STOP_SCANS:
                            stats['limited']=True
                            return next_labels
                        epoch=midnight+(dep if backward else arr)
                        if best_board is not None and (pickup if backward else dropoff)==0:
                            earlier,board_sid,board_epoch=best_board
                            if sid!=board_sid:
                                if backward:
                                    edge=self._edge_bus(code,trip_id,headsign,sid,board_sid,
                                                        midnight+dep,board_epoch)
                                else:
                                    edge=self._edge_bus(code,trip_id,headsign,board_sid,sid,
                                                        board_epoch,midnight+arr)
                                self._insert(next_labels,
                                             Label(sid,epoch,earlier.walked,earlier.rides+1,earlier,edge),
                                             backward)
                        if sid in prior and (dropoff if backward else pickup)==0:
                            for label in prior[sid]:
                                departure=midnight+dep
                                arrival=midnight+arr
                                feasible=(label.time>=arrival+TRANSFER_BUFFER_SECONDS
                                          if backward else departure>=label.time+TRANSFER_BUFFER_SECONDS)
                                valid_horizon=(departure>=search_ts-HORIZON_SECONDS if backward
                                               else departure<=search_ts+HORIZON_SECONDS)
                                if feasible and valid_horizon:
                                    candidate=(label,sid,arrival if backward else departure)
                                    if best_board is None or label.walked<best_board[0].walked:
                                        best_board=candidate
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
        for meters,sid in starts:
            delay=self._walk_time(meters)
            t=search_ts-delay if backward else search_ts+delay
            edge=(self._edge_walk(sid,'destination',meters,t,search_ts) if backward
                  else self._edge_walk('origin',sid,meters,search_ts,t))
            self._insert(prior,Label(sid,t,meters*WALK_FACTOR,0,None,edge),backward)
        candidates=[]
        stats={'stopScans':0,'limited':False,'rounds':0,'candidateRoutes':0,'candidateTrips':0}
        for rides in range(MAX_RIDES):
            if not prior:
                break
            gained=self._scan_round(prior,search_ts,backward,stats)
            stats['rounds']=rides+1
            if gained:
                candidates.extend(self._collect(gained,origin,destination,search_ts,backward))
            if stats['limited']:
                break
            self._transfer(gained,backward,stats)
            prior=gained
        if preference=='leastWalking':
            key=lambda x:(x['walkMetersApprox'],x['durationMinutes'],x['transfers'])
        elif preference=='leastTransfers':
            key=lambda x:(x['transfers'],x['durationMinutes'],x['walkMetersApprox'])
        else:
            key=lambda x:(x['arrival'] if not backward else
                          -dt.datetime.fromisoformat(x['departure']).timestamp(),
                          x['walkMetersApprox'],x['transfers'])
        unique={}
        for option in sorted(candidates,key=key):
            sig=tuple((leg.get('tripId'),leg.get('from'),leg.get('to'))
                      for leg in option['legs'] if leg['mode']=='bus')
            if sig not in unique:
                unique[sig]=option
            if len(unique)>=12:
                break
        return {'status':'partial' if stats['limited'] else 'ok',
                'mode':mode,'preference':preference,'requestedAt':at_dt.isoformat(),
                'itineraries':list(unique.values())[:6],
                'metroHints':self._metro_hints(origin,destination,at_dt),
                'stats':stats,
                'notes':[
                    'Horários de ônibus são da tabela GTFS, NÃO ETA ajustado ao GPS.',
                    'Caminhadas e transferências usam distância geográfica estimada; ainda não há roteamento de pedestres pelas ruas.',
                    'Metrô é apenas sugestão informativa até existir grade de horários ou feed validado.',
                ]}
