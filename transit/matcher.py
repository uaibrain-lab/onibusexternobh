"""Conservative geometry matcher; never infer GTFS trip IDs from PBH GPS trip fields.

The purpose of this module is to rank *shapes*, not to certify that an
individual bus follows a scheduled trip. Ambiguous routes remain ambiguous.
"""
import math
from functools import lru_cache

METERS_PER_DEGREE = 111_320.0
LON_SCALE = METERS_PER_DEGREE * math.cos(math.radians(-19.9))

def xy(lat, lon):
    return (float(lon) * LON_SCALE, float(lat) * METERS_PER_DEGREE)

def distance_m(a, b):
    x1, y1 = xy(a[0], a[1]); x2, y2 = xy(b[0], b[1])
    return math.hypot(x1-x2, y1-y2)

def bearing_delta(a,b):
    return abs((float(a)-float(b)+180)%360-180)

class ShapeMatcher:
    def __init__(self, shapes, patterns):
        self.shapes = shapes
        self.shape_patterns = {}
        for p in patterns:
            self.shape_patterns.setdefault(p['shape'], []).append(p)

    @lru_cache(maxsize=256)
    def segments(self, sid):
        coords = self.shapes.get(str(sid), [])
        if len(coords)<2: return ()
        points = [xy(lat,lon) for lat,lon in coords]
        result=[]; length=0.0
        for i in range(len(points)-1):
            ax, ay = points[i]; bx, by = points[i+1]
            dx,dy = bx-ax, by-ay
            span = math.hypot(dx,dy)
            if span<0.1: continue
            # azimuth from geographic north (bearing 0=North)
            heading = (math.degrees(math.atan2(dx,dy))+360)%360
            result.append((ax,ay,dx,dy,span*span,length,span,heading))
            length+=span
        return (tuple(result),length)

    def project(self, sid, lat, lon):
        data=self.segments(str(sid))
        if not data: return None
        segs,total=data
        px,py=xy(lat,lon)
        nearest=(float('inf'),0.0,0.0)
        for ax,ay,dx,dy,len2,cumul,span,head in segs:
            t=max(0.,min(1.,((px-ax)*dx+(py-ay)*dy)/len2))
            dist=math.hypot(px-(ax+t*dx),py-(ay+t*dy))
            if dist<nearest[0]: nearest=(dist, (cumul+t*span)/total if total else 0.,head)
        return nearest

    def rank(self, shape_ids, observations):
        """observations: chronological list with lat,lng,heading,fixAt."""
        if not shape_ids or not observations: return []
        # Preserve enough trajectory to discriminate two directions, but do not
        # use long histories that could belong to a previous duty or route.
        obs=observations[-10:]
        output=[]
        for sid in shape_ids:
            proj=[]
            for o in obs:
                r=self.project(sid, o['lat'], o['lng'])
                if r is not None: proj.append(r)
            if len(proj)!=len(obs): continue
            errors=[p[0] for p in proj]
            # Penalize non-monotonic progress on the route (GPS noise tolerated).
            backwards=0.
            for a,b in zip(proj,proj[1:]):
                delta=b[1]-a[1]
                # Loop progress can legitimately go from 0.99 to 0.01.
                if delta < -0.025 and not (a[1]>.90 and b[1]<.10):
                    backwards += min(-delta,0.25)
            heading_error=0.
            if obs[-1].get('heading') is not None:
                heading_error=bearing_delta(obs[-1]['heading'],proj[-1][2])
            score=(sum(min(d,400) for d in errors)/len(errors)
                   +0.2*min(errors[-1],400)
                   + min(300,backwards*1400)
                   + min(35,heading_error*0.20))
            output.append({'shapeId':str(sid),'scoreM':round(score,1),
                           'lastDistanceM':round(errors[-1],1),
                           'meanDistanceM':round(sum(errors)/len(errors),1),
                           'routeProgress':round(proj[-1][1],3)})
        return sorted(output,key=lambda r:r['scoreM'])

    def resolve(self, shape_ids, observations):
        ranked=self.rank(shape_ids,observations)
        movement=sum(distance_m((a['lat'],a['lng']),(b['lat'],b['lng']))
                     for a,b in zip(observations,observations[1:]))
        # Require actual independent fixes, at least 50m of movement, good fit,
        # and a material difference to the second candidate.
        enough=len(observations)>=3 and movement>=50.
        if not ranked:
            return {'status':'unavailable','shapeId':None,'confidence':'none','candidates':[]}
        best=ranked[0]
        fit=best['lastDistanceM']<=90 and best['meanDistanceM']<=100 and best['scoreM']<=120
        separated=(len(ranked)==1 or (ranked[1]['scoreM']-best['scoreM']>=35
                   and ranked[1]['scoreM']>=best['scoreM']*1.45))
        if enough and fit and separated:
            return {'status':'probable','shapeId':best['shapeId'],
                    'confidence':'geometric-only', 'candidates':ranked[:6]}
        return {'status':'ambiguous','shapeId':None,'confidence':'none',
                'candidates':ranked[:6]}
