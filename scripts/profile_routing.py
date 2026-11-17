"""One-time diagnostic of planner's real performance; no external network."""
from __future__ import annotations
import cProfile
import io
import pathlib
import pstats
import time

from transit.planner import JourneyPlanner

planner=JourneyPlanner(pathlib.Path('catalog'))
assert planner.ready,planner.failure
print('PROFILE_WALK_READY',planner.walking.ready,flush=True)
origin={'lat':-19.8695,'lng':-43.9675}
dest={'lat':-19.918,'lng':-43.938}
for mode,preference in [('departAt','fastest'),('arriveBy','leastTransfers')]:
    pr=cProfile.Profile()
    start=time.monotonic()
    pr.enable()
    result=planner.plan(origin,dest,'2026-11-18T08:00:00-03:00',mode,preference)
    pr.disable()
    print('PROFILE_RESULT',mode,preference,round(time.monotonic()-start,2),result['status'],
          len(result['itineraries']),result.get('stats'),flush=True)
    out=io.StringIO()
    pstats.Stats(pr,stream=out).strip_dirs().sort_stats('cumulative').print_stats(32)
    print(out.getvalue(),flush=True)
