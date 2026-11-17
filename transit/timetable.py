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

    def next_by_line(self, stop_id, now=None, horizon_hours=5):
        """Return next scheduled timestamp per route; never imply live vehicle GPS."""
        self._load()
        if not self.stops:
            return {}
        now = now or dt.datetime.now(BRT)
        if now.tzinfo is None:
            now=now.replace(tzinfo=BRT)
        results={}
        for route,service,destination,times in self.stops.get(str(stop_id),[]):
            for offset in (-1,0,1):
                day=now.date()+dt.timedelta(days=offset)
                if not self.active(service,day):
                    continue
                midnight=dt.datetime.combine(day,dt.time(0,0), BRT)
                threshold=int((now-midnight).total_seconds())
                pos=bisect_left(times,threshold)
                if pos >=len(times):continue
                when=midnight+dt.timedelta(seconds=times[pos])
                if (when-now).total_seconds()>horizon_hours*3600:
                    continue
                prior=results.get(route)
                if prior is None or when<prior['when']:
                    results[route]={'when':when,'destination':destination}
        return {code:{'type':'scheduled','at':item['when'].isoformat(timespec='seconds'),
                      'minutes':max(0,int((item['when']-now).total_seconds()//60)),
                      'destination':item['destination']}
                for code,item in results.items()}
