"""Conservative estimated arrivals from PBH GPS and GTFS geometry.

These are *approximate* arrivals, not live predictions supplied by PBH.  A
confidence gate is preferable to displaying a false precise ETA: if route
variant, vehicle movement, stop order, or fix age is unclear we return None
and the UI falls back to the GTFS timetable.
"""
from __future__ import annotations
import datetime as dt
import math
from collections import defaultdict
from .matcher import ShapeMatcher, distance_m, xy


class GpsArrivalEstimator:
    def __init__(self, matcher: ShapeMatcher, patterns, stops):
        self.matcher = matcher
        self.stops = stops
        self.patterns_by_route_shape = defaultdict(list)
        for p in patterns:
            self.patterns_by_route_shape[(p['route'], p['shape'])].append(p)
        self._stop_cache = {}
        self._match_cache = {}

    def stop_progress(self, shape_id, stop_id):
        """Fraction of shape at a stop; refuse loop/parallel ambiguity."""
        key = (shape_id, stop_id)
        if key in self._stop_cache:
            return self._stop_cache[key]
        stop = self.stops.get(stop_id)
        data = self.matcher.segments(str(shape_id))
        result = None
        if stop and data:
            segs, total = data
            px, py = xy(stop[1], stop[2])
            projections = []
            for ax,ay,dx,dy,len2,cumul,span,_ in segs:
                t = max(0., min(1., ((px-ax)*dx+(py-ay)*dy)/len2))
                dist = math.hypot(px-ax-t*dx,py-ay-t*dy)
                if dist <= 35.0:
                    projections.append((dist,(cumul+t*span)/total))
            if projections:
                projections.sort()
                best = projections[0]
                # Ignore adjacent/nearby segments. Reject a stop occurring at
                # geographically close but temporally distant loop locations.
                near = [frac for d, frac in projections if d <= min(35.,best[0]+18.)]
                if max(near)-min(near) <= 0.035:
                    result = best[1]
        if len(self._stop_cache)>50000:
            self._stop_cache.clear()
        self._stop_cache[key] = result
        return result

    def _match(self, route, vehicle):
        key=(route['id'],vehicle['source'],vehicle['NV'],vehicle['lastGpsFixAt'])
        match=self._match_cache.get(key)
        if match is None:
            match=self.matcher.resolve(route['shapes'],vehicle.get('history',[]))
            if len(self._match_cache)>8000:
                self._match_cache.clear()
            self._match_cache[key]=match
        return match

    def estimate(self, route, stop_id, vehicles, now):
        """Earliest qualifying vehicle. Missing confidence => no GPS ETA."""
        best=None
        route_id=route['id']
        point=self.stops.get(stop_id)
        if not point: return None
        for v in vehicles:
            if route_id not in v.get('routeIds',[]):
                continue
            fix=v.get('lastGpsFixAt')
            try:
                when=dt.datetime.fromisoformat(fix)
                unchanged=dt.datetime.fromisoformat(v['positionUnchangedSinceAt'])
                age=(now-when).total_seconds()
                still=(now-unchanged).total_seconds()
            except (TypeError,KeyError,ValueError):
                continue
            if not 0<=age<=90 or still>150:
                continue
            if distance_m((v['lat'],v['lng']),(point[1],point[2]))>10000:
                continue
            hist=v.get('history',[])
            if len(hist)<3:
                continue
            match=self._match(route,v)
            if match.get('status')!='probable':
                continue
            sid=match['shapeId']
            patterns=self.patterns_by_route_shape.get((route_id,sid),[])
            # Every pattern that shares this shape must serve the stop exactly
            # once. Otherwise shape identification cannot confirm service.
            if not patterns or any(p['stops'].count(stop_id)!=1 for p in patterns):
                continue
            # The same shape may serve distinct trip headsigns. A geometry
            # match alone then cannot tell the passenger which destination the
            # bus is actually displaying; refuse a direction-specific ETA.
            destinations={str(p.get('headsign') or '').strip() for p in patterns}
            if len(destinations)!=1 or not next(iter(destinations)):
                continue
            stop_frac=self.stop_progress(sid,stop_id)
            if stop_frac is None:
                continue
            segs=self.matcher.segments(sid)
            if not segs:continue
            total=segs[1]
            last=self.matcher.project(sid,v['lat'],v['lng'])
            if not last or last[0]>80:
                continue
            ahead=(stop_frac-last[1])*total
            if ahead<45 or ahead>6500:
                continue
            # Estimate road-speed using *movement along the selected shape*
            # over distinct fixes; no imaginary progress from repeated HTTP.
            fixes=[]
            for o in hist[-12:]:
                try:
                    t=dt.datetime.fromisoformat(o['fixAt'])
                except (TypeError,ValueError,KeyError):
                    continue
                if (when-t).total_seconds()>240:continue
                pr=self.matcher.project(sid,o['lat'],o['lng'])
                if pr and pr[0]<=85:
                    fixes.append((t,pr[1]*total))
            fixes.sort()
            if len({t for t, _ in fixes}) < 3:
                continue
            # A fresh fix cannot rescue a velocity derived from a long radio gap.
            if (when - fixes[-1][0]).total_seconds() > 45:
                continue
            start=fixes[0];end=fixes[-1]
            duration=(end[0]-start[0]).total_seconds()
            advance=end[1]-start[1]
            if duration<35 or duration>240 or advance<90:
                continue
            # Reject GPS jumps, backwards travel and discontinuous observations.
            # A distant gap must never be interpreted as a continuous speed.
            inconsistent=False
            for a,b in zip(fixes,fixes[1:]):
                elapsed=(b[0]-a[0]).total_seconds()
                delta=b[1]-a[1]
                if elapsed<=0 or elapsed>100 or delta < -30 or delta>elapsed*22:
                    inconsistent=True
                    break
            if inconsistent:
                continue
            speed=advance/duration
            if not 1.2<=speed<=15:
                continue
            # Route speed may fluctuate around stops; an ETA to the minute is
            # only a coarse estimate. Add a modest dwell buffer.
            seconds=ahead/speed + min(90.,ahead/500.*12.)
            if not 35<=seconds<=1800:
                continue
            minutes=max(1,math.ceil(seconds/60))
            eta=now+dt.timedelta(seconds=seconds)
            result={'type':'gps_estimate','minutes':minutes,
                    'at':eta.isoformat(timespec='seconds'),
                    'destination':patterns[0].get('headsign',''),
                    'gpsAt':when.isoformat(timespec='seconds'),
                    'approximate':True,'vehicleId':v['NV'],'vehicleSource':v['source']}
            if best is None or eta < best[0]:
                best=(eta,result)
        return best[1] if best else None
