#!/usr/bin/env python3
"""Create a BH municipal V1 artifact with optional *real* GPS, never deploy.

GPS is enabled in output only; CI will deny QA approval unless a fresh
SUMOB GTFS-RT Worker response is observed. No invented ETA.
"""
import argparse
import json
import shutil
from pathlib import Path

LIMIT=50*1024*1024

def fix_clean_urls_assets(root):
    """Keep /externo assets working when Firebase cleanUrls removes trailing /.

    A document at /externo (no slash) normally resolves ./style.css to
    /style.css, while its HTML/CSS/JS live under /externo/. An explicit base
    fixes HTML references; JS that resolves via location.href must use the
    document base as well. Only generated V1 artifacts are edited.
    """
    root=Path(root)
    htmlfile=root/'index.html'
    html=htmlfile.read_text(encoding='utf8')
    marker='<base href="/externo/">'
    if html.count('<head>')!=1 or marker in html:
        raise ValueError('Unexpected Hub V1 index head/base')
    if html.count('href="./style.css"')!=1 or html.count('href="./hub-parity.css"')!=1:
        raise ValueError('Hub V1 CSS source schema changed')
    htmlfile.write_text(html.replace('<head>','<head>\n'+marker,1),encoding='utf8')

    replacements={
      'static-bus.js':[
        ("new URL('./catalog/',location.href)",
         "new URL('./catalog/',document.baseURI)")],
      'static-arrivals.js':[
        ("new URL('./catalog/arrivals/',location.href)",
         "new URL('./catalog/arrivals/',document.baseURI)")],
      'live-gps.js':[
        ("new URL('./',location.href)",
         "new URL('./',document.baseURI)")],
      'app.js':[
        ("new URL('./catalog/scan/',location.href)",
         "new URL('./catalog/scan/',document.baseURI)"),
        ("new URL('./route-worker.js',location.href)",
         "new URL('./route-worker.js',document.baseURI)"),
        ("navigator.serviceWorker.register('./service-worker.js',{scope:'./'})",
         "navigator.serviceWorker.register('/externo/service-worker.js',{scope:'/externo/'})")]
    }
    for filename,pairs in replacements.items():
        file=root/filename
        content=file.read_text(encoding='utf8')
        for before,after in pairs:
            if content.count(before)!=1:
                raise ValueError(f'Unrecognized V1 relative asset in {filename}: {before}')
            content=content.replace(before,after,1)
        file.write_text(content,encoding='utf8')

def prepare(directory):
    root=Path(directory)
    cat=root/'catalog'
    index=json.loads((cat/'arrivals/index.json').read_text(encoding='utf8'))
    manifest=json.loads((cat/'manifest.json').read_text(encoding='utf8'))
    html=(root/'index.html').read_text(encoding='utf8')
    gps=json.loads((root/'gps-config.json').read_text(encoding='utf8'))
    if ('data-app-mode="free-static"' not in html or
            'id="quick-rotas" aria-pressed="false" hidden disabled' not in html):
        raise ValueError('Hub V1 requires static HTML with routing hidden and disabled')
    # V1 preserves free real-time bus positioning; only journey routing and
    # RMBH are deferred. The source file stays OFF; this output opts in only
    # with a verified SUMOB Worker feed and a later fail-closed CI probe.
    if gps.get('enabled') is not False:
        raise ValueError('Original GPS source configuration must remain disabled')
    if (gps.get('provider') != 'gtfs_rt' or
            gps.get('endpoint') !=
            'https://externo-bh-gps-free.hubufmg.workers.dev/api/gps'):
        raise ValueError('Unexpected GPS provider/endpoint for Hub V1')
    gps['enabled'] = True
    gps['refreshSeconds'] = 45
    (root/'gps-config.json').write_text(
        json.dumps(gps,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    if (index.get('schema')!=1 or index.get('buckets')!=256 or
            index.get('version')!=manifest.get('gtfsVersion') or
            index.get('validThrough')!=manifest.get('feedEndDate') or
            not 1000<=index.get('stopCount',0)<=manifest.get('stops',0)):
        raise ValueError('Municipal stop arrivals mismatch GTFS')
    sizes=index.get('sizes')
    if not isinstance(sizes,dict) or len(sizes)!=256:
        raise ValueError('Missing 256 bucket sizes')
    for i in range(256):
        name=f'{i:02x}.json.gz'
        f=cat/'arrivals'/name
        if (not f.is_file() or not isinstance(sizes.get(name),int) or
                f.stat().st_size!=sizes[name]):
            raise ValueError('Arrival bucket missing or wrong size: '+name)
    fix_clean_urls_assets(root)
    # Scan indexes are REQUIRED to build the existing static bundle.
    # Remove their 116 MB only AFTER generation, since routes are V2.
    for path in (cat/'scan',cat/'walk'):
        shutil.rmtree(path,ignore_errors=True)
    (cat/'der-rmbh-411c-511c.json').unlink(missing_ok=True)
    for name in ('metropolitan.html','metropolitan.js'):
        (root/name).unlink(missing_ok=True)
    swpath=root/'service-worker.js'
    sw=swpath.read_text(encoding='utf8')
    froms=(
        ("  base+'metropolitan.html',base+'metropolitan.js',base+'catalog/der-rmbh-411c-511c.json',\n", ''),
        ("  base+'catalog/metro.json',base+'catalog/scan/index.json',\n", "  base+'catalog/metro.json',\n"),
    )
    for old,new in froms:
        if sw.count(old)!=1:
            raise ValueError('Unexpected external service-worker source schema')
        sw=sw.replace(old,new)
    sw=sw.replace('externo-unificado-shell-v8','externo-unificado-shell-hub-v1')
    swpath.write_text(sw,encoding='utf8')
    for name in ('routes.json','stops.json','patterns.json','shapes.json',
                 'metro.json','arrivals/calendar.json'):
        if not (cat/name).is_file():
            raise ValueError('Missing municipal V1 data: '+name)
    files=[x for x in root.rglob('*') if x.is_file()]
    size=sum(x.stat().st_size for x in files)
    if size>LIMIT:
        raise ValueError(f'Static V1 is over 50 MiB: {size}')
    report={'status':'staged-not-approved','gtfsVersion':manifest['gtfsVersion'],
            'validThrough':manifest['feedEndDate'],'municipalLines':manifest['routes'],
            'scheduledStops':index['stopCount'],'shards':256,'bytes':size,
            'files':len(files),'routingEnabled':False,'metropolitanEnabled':False,
            'gpsEnabled':True,'gpsProvider':'gtfs_rt',
            'gpsRefreshSeconds':45,'scheduledNotRealtime':True}
    (root/'hub-v1-build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print('HUB_V1_STATIC_STAGED',json.dumps(report))
    print('NO_PRODUCTION_DEPLOY')
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('directory',type=Path)
    prepare(parser.parse_args().directory)
