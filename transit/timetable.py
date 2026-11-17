"""Safe GTFS scheduled-arrival lookups (not live predictions).

The generated gzip contains stop, route, service, destination, arrival seconds.
Service dates are evaluated in America/Sao_Paulo (currently UTC-3 in BH).
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

    def next_by_line(self, stop_id, now=None, horizon_hours=5, max_per_line=3):
        """Next GTFS scheduled services by route, never a live vehicle claim."""
        self._load()
        if not self.stops:
            return {}
        now = now or dt.datetime.now(BRT)
        if now.tzinfo is None:
            now = now.replace(tzinfo=BRT)
        cap = max(1, min(5, int(max_per_line)))
        horizon = dt.timedelta(hours=horizon_hours)
        found = {}
        last_today = {}
        for route, service, destination, times in self.stops.get(str(stop_id), []):
            if not times:
                continue
            for offset in (-1, 0, 1):
                day = now.date() + dt.timedelta(days=offset)
                if not self.active(service, day):
                    continue
                midnight = dt.datetime.combine(day, dt.time(0, 0), BRT)
                if offset == 0:
                    key = (route, destination)
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
                    found.setdefault(route, []).append((when, destination))
        result = {}
        for route, entries in found.items():
            ordered = sorted(set(entries), key=lambda x:(x[0],x[1]))
            if not ordered:
                continue
            when, dest = ordered[0]
            later = [{'at': t.isoformat(timespec='seconds'),
                      'minutes':max(0,int((t-now).total_seconds()//60)),
                      'destination': direction} for t,direction in ordered[1:] if direction == dest][:cap-1]
            last = last_today.get((route,dest))
            result[route] = {
                'type':'scheduled','at':when.isoformat(timespec='seconds'),
                'minutes':max(0,int((when-now).total_seconds()//60)),
                'destination':dest,'following':later,
                'lastTripToday':bool(last and when.date()==now.date() and when>=last),
            }
        return result
