"""GTFS arrival lookups: distinct destinations are never silently merged.

These are *scheduled* stop passage times, not live vehicle sightings.
"""
import datetime as dt
import gzip
import json
from bisect import bisect_left
from pathlib import Path
from .engine import BRT

WEEKDAYS = ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')

class Timetable:
    def __init__(self, catalog):
        self.catalog = Path(catalog)
        self.calendar = None
        self.stops = None
        self.error = None

    def _load(self):
        if self.calendar is not None or self.error:
            return
        try:
            self.calendar = json.loads((self.catalog/'timetable-calendar.json').read_text('utf8'))
            self.stops = {}
            with gzip.open(self.catalog/'timetable.json.gz','rt',encoding='utf8') as f:
                for line in f:
                    sid, entries = json.loads(line)
                    self.stops[sid] = entries
        except (OSError, ValueError, TypeError) as exc:
            self.error = type(exc).__name__
            self.calendar = None
            self.stops = None

    def active(self, service, day):
        if not self.calendar:
            return False
        d=day.strftime('%Y%m%d')
        override=self.calendar['exceptions'].get(d,{}).get(service)
        if override is not None:
            return override==1
        spec=self.calendar['services'].get(service)
        return bool(spec and spec['start_date']<=d<=spec['end_date'] and spec[WEEKDAYS[day.weekday()]]=='1')

    def next_by_direction(self, stop_id, now=None, horizon_hours=5, max_per_direction=3):
        """Return {(route_code, destination): scheduled ETA} independently.

        A route may serve a stop with opposite headsigns; mixing their next
        passages can send a passenger the wrong way. The route code alone is
        not a unique destination. The timetable's headsign is source-provided.
        """
        self._load()
        if not self.stops:
            return {}
        now = now or dt.datetime.now(BRT)
        if now.tzinfo is None:
            now = now.replace(tzinfo=BRT)
        cap = max(1, min(5, int(max_per_direction)))
        horizon = dt.timedelta(hours=horizon_hours)
        found = {}
        last_today = {}
        for route, service, destination, times in self.stops.get(str(stop_id), []):
            if not times:
                continue
            key = (str(route), str(destination or '').strip())
            for offset in (-1, 0, 1):
                day = now.date() + dt.timedelta(days=offset)
                if not self.active(service, day):
                    continue
                midnight = dt.datetime.combine(day, dt.time(0, 0), BRT)
                if offset == 0:
                    last = midnight + dt.timedelta(seconds=times[-1])
                    if key not in last_today or last > last_today[key]:
                        last_today[key] = last
                threshold = int((now - midnight).total_seconds())
                pos = bisect_left(times, threshold)
                for seconds in times[pos:pos+cap]:
                    when = midnight + dt.timedelta(seconds=seconds)
                    if when < now:
                        continue
                    if when - now > horizon:
                        break
                    found.setdefault(key, []).append(when)
        result = {}
        for key, entries in found.items():
            times = sorted(set(entries))[:cap]
            if not times:
                continue
            when = times[0]
            last = last_today.get(key)
            result[key] = {
                'type':'scheduled',
                'at':when.isoformat(timespec='seconds'),
                'minutes':max(0,int((when-now).total_seconds()//60)),
                'destination':key[1],
                'following':[{'at':t.isoformat(timespec='seconds'),
                              'minutes':max(0,int((t-now).total_seconds()//60)),
                              'destination':key[1]} for t in times[1:]],
                'lastTripToday':bool(last and when.date()==now.date() and when>=last),
            }
        return result

    def next_by_line(self, stop_id, now=None, horizon_hours=5, max_per_line=3):
        """Compatibility route summary: earliest destination wins, no mixing."""
        by_direction = self.next_by_direction(stop_id, now, horizon_hours, max_per_line)
        result = {}
        for (route, _), arrival in by_direction.items():
            if route not in result or arrival['at'] < result[route]['at']:
                result[route] = arrival
        return result
