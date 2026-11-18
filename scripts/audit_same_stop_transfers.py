#!/usr/bin/env python3
"""P28: audit feasible SAME-stop timed transfers from the local public GTFS.

This is NOT an end-to-end route planner and never invents a passenger ETA.
It searches scheduled boarding/alighting at the SAME official stop_id,
respecting calendar exceptions, pickup/dropoff, and +24h service times.
No network, user coordinates, GPS or paid APIs.

Example:
  py scripts/audit_same_stop_transfers.py --first 9106 --second 5106 --date 2026-11-17 --time 22:00
  py scripts/audit_same_stop_transfers.py --first 9209 --second 67 --date 2026-11-17 --time 22:00
"""
from __future__ import annotations
import argparse
from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
import datetime as dt
import gzip
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
MAX_JSON_BYTES = 150 * 1024 * 1024
MAX_TRIPS = 200000
WEEKDAYS = ("monday","tuesday","wednesday","thursday","friday","saturday","sunday")
LOCAL = dt.timezone(dt.timedelta(hours=-3))


def read_json(path: Path, compressed=False):
    if not path.is_file() or path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("Arquivo GTFS ausente ou acima do limite")
    if compressed:
        with gzip.open(path, "rb") as source:
            raw = source.read(MAX_JSON_BYTES + 1)
        if len(raw) > MAX_JSON_BYTES:
            raise ValueError("Shard GTFS descompactado excede limite")
        return json.loads(raw)
    return json.loads(path.read_text(encoding="utf-8"))


def active(index, service_id: str, day: dt.date) -> bool:
    compact = day.strftime("%Y%m%d")
    exception = index.get("exceptions", {}).get(compact, {}).get(service_id)
    if exception is not None:
        return int(exception) == 1
    cal = index.get("services", {}).get(service_id)
    if not cal:
        return False
    return (str(cal.get("start_date", "99999999")) <= compact <=
            str(cal.get("end_date", "00000000")) and
            str(cal.get(WEEKDAYS[day.weekday()], "0")) == "1")


def read_line(catalog: Path, index: dict, code: str):
    if not re.fullmatch(r"[A-Z0-9]{1,8}", code):
        raise ValueError("Código de linha inválido")
    rel = index.get("files", {}).get(code)
    if not isinstance(rel, str) or not re.fullmatch(r"routing/[a-f0-9]{16}\.json\.gz", rel):
        return None
    trips = read_json(catalog / rel, compressed=True)
    if not isinstance(trips, list) or len(trips) > MAX_TRIPS:
        raise ValueError("Shard GTFS incompleto ou excessivo")
    return trips


def event_stream(trips, index, date, seconds_start, seconds_end, first):
    """(stop_id, seconds since query-day midnight, trip_id, headsign), local only."""
    events = defaultdict(list)
    active_trips = set()
    for offset in (-1, 0, 1):
        service_day = date + dt.timedelta(days=offset)
        for trip in trips:
            if not isinstance(trip, list) or len(trip) < 4:
                raise ValueError("Viagem GTFS inválida")
            trip_id, service, headsign, stops = trip[:4]
            if not active(index, str(service), service_day):
                continue
            if not isinstance(stops, list) or len(stops) < 2:
                continue
            active_trips.add((str(trip_id), offset))
            # Alighting needs a previous segment; boarding needs a next one.
            positions = range(1, len(stops)) if first else range(len(stops)-1)
            for pos in positions:
                row = stops[pos]
                if not isinstance(row, list) or len(row) < 5:
                    raise ValueError("Parada GTFS inválida")
                stop_id, arrive, depart, pickup, dropoff = row[:5]
                if not (isinstance(arrive, int) and isinstance(depart, int) and
                        0 <= arrive <= depart < 48*3600):
                    continue
                if first and dropoff != 0:
                    continue
                if not first and pickup != 0:
                    continue
                when = offset*86400 + (arrive if first else depart)
                if seconds_start <= when <= seconds_end:
                    events[str(stop_id)].append((when,str(trip_id),str(headsign)))
    return events, len(active_trips)


def hm(date: dt.date, seconds: int) -> str:
    value = dt.datetime.combine(date, dt.time(), tzinfo=LOCAL) + dt.timedelta(seconds=seconds)
    return value.strftime("%d/%m %H:%M")


def audit(catalog: Path, first: str, second: str, date: dt.date,
          time_text: str, hours: int=3, min_wait: int=2, max_wait: int=30):
    if not re.fullmatch(r"\d{2}:\d{2}",time_text):
        raise ValueError("Horário HH:MM inválido")
    hh,mm=map(int,time_text.split(":"))
    if hh > 23 or mm > 59 or hours < 1 or hours > 5 or not 1 <= min_wait <= max_wait <= 90:
        raise ValueError("Janela ou margem de transferência inválida")
    start=hh*3600+mm*60
    end=start+hours*3600
    if first==second:
        raise ValueError("Informe duas linhas distintas")
    catalog=Path(catalog)
    index=read_json(catalog/"routing-index.json")
    a,b=read_line(catalog,index,first),read_line(catalog,index,second)
    result={"audit":"SAME_GTFS_STOP_SCHEDULED_TRANSFERS_ONLY",
        "first":first,"second":second,"serviceDate":date.isoformat(),
        "queryFromLocal":time_text,"windowHours":hours,
        "minimumTransferMinutes":min_wait,"maximumWaitMinutes":max_wait,
        "firstInCatalog":a is not None,"secondInCatalog":b is not None,
        "source":"local municipal GTFS routing shards; no GPS ETA",
        "sharedStops":0,"timedTransferPairs":0,"feasibleStops":0,
        "examples":[],"endToEndJourneyVerified":False,
        "warning":"Conexões somente em parada IDÊNTICA e hora GTFS; não demonstram acesso origem/destino, sentido útil, desempenho real ou previsão de GPS."}
    if a is None or b is None:
        return result
    first_events,first_active=event_stream(a,index,date,start,end,True)
    next_events,second_active=event_stream(b,index,date,start+min_wait*60,
                                         end+max_wait*60,False)
    # Compare stop coverage using FULL shards, not just times within a window.
    stops_a={str(row[0]) for trip in a for row in trip[3] if isinstance(row,list) and len(row)>=5}
    stops_b={str(row[0]) for trip in b for row in trip[3] if isinstance(row,list) and len(row)>=5}
    result["sharedStops"]=len(stops_a & stops_b)
    result["activeFirstTrips"]=first_active
    result["activeSecondTrips"]=second_active
    samples=[]
    for sid in sorted(first_events.keys() & next_events.keys()):
        departures=sorted(next_events[sid])
        departure_times=[x[0] for x in departures]
        possible=0
        for when, _, _ in first_events[sid]:
            lo=bisect_left(departure_times,when+min_wait*60)
            hi=bisect_right(departure_times,when+max_wait*60)
            if hi<=lo:
                continue
            possible+=hi-lo
            wait=departures[lo][0]-when
            # Only aggregate public stop ID and clock times; NEVER trip IDs.
            samples.append((wait,when,departures[lo][0],sid))
        result["timedTransferPairs"]+=possible
        if possible:
            result["feasibleStops"]+=1
    samples.sort()
    # One representative per stop gives corridor diversity.
    seen=set()
    for wait,arrival,departure,sid in samples:
        if sid in seen:
            continue
        seen.add(sid)
        result["examples"].append({"stopId":sid,
           "firstScheduledArrival":hm(date,arrival),
           "secondScheduledDeparture":hm(date,departure),
           "scheduledWaitMinutes":round(wait/60,1)})
        if len(result["examples"])>=8:
            break
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog",type=Path,default=ROOT/"catalog")
    parser.add_argument("--first",required=True)
    parser.add_argument("--second",required=True)
    parser.add_argument("--date",required=True)
    parser.add_argument("--time",required=True)
    parser.add_argument("--hours",type=int,default=3)
    parser.add_argument("--min-wait",type=int,default=2)
    parser.add_argument("--max-wait",type=int,default=30)
    args=parser.parse_args(argv)
    try:
        date=dt.date.fromisoformat(args.date)
        result=audit(args.catalog,args.first.upper(),args.second.upper(),
                     date,args.time,args.hours,args.min_wait,args.max_wait)
        print(json.dumps(result,ensure_ascii=False,indent=2))
        print("P28_SAME_STOP_SCHEDULE_AUDIT_OK")
        return 0
    except (ValueError,OSError,KeyError,TypeError,json.JSONDecodeError) as e:
        print("P28_SAME_STOP_SCHEDULE_AUDIT_FAILED:",type(e).__name__,file=sys.stderr)
        return 2


if __name__=="__main__":
    raise SystemExit(main())
