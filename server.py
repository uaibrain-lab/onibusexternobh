#!/usr/bin/env python3
"""Local BH transport demo server (localhost only, no dependencies)."""
import argparse, json, mimetypes, pathlib, threading, urllib.parse, webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from transit.engine import TransitEngine
from transit.metro import MetroCatalog
from transit.planner import JourneyPlanner, PlannerError
from transit.geocode import PlaceSearch

ROOT=pathlib.Path(__file__).resolve().parent

def run(host='127.0.0.1',port=8765,open_browser=False):
    engine=TransitEngine(ROOT)
    metro=MetroCatalog(ROOT/'catalog')
    planner=JourneyPlanner(ROOT/'catalog',metro)
    places=PlaceSearch()
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def respond(self,status,raw,content_type):
            self.send_response(status)
            self.send_header('Content-Type',content_type)
            self.send_header('Content-Length',str(len(raw)))
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Cache-Control','no-store, max-age=0')
            self.send_header('X-Frame-Options','SAMEORIGIN')
            self.send_header('Content-Security-Policy',"frame-ancestors 'self'")
            self.end_headers();self.wfile.write(raw)
        def payload(self,status,obj):
            data=json.dumps(obj,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
            self.respond(status,data,'application/json; charset=utf-8')
        def do_GET(self):
            try:
                u=urllib.parse.urlsplit(self.path)
                qs=urllib.parse.parse_qs(u.query)
                path=u.path
                if path.startswith('/externo/api/'):
                    path=path[len('/externo'):]
                elif path.startswith('/externo/'):
                    path=path[len('/externo'):]
                elif path=='/externo':
                    path='/'
                if path=='/api/plan/status':
                    return self.payload(200,{'ready':planner.ready,'reason':planner.failure,
                                             'source':'GTFS trips / scheduled'})
                if path=='/api/places':
                    try:
                        v=places.search(qs.get('q',[''])[0])
                    except ValueError as exc:
                        return self.payload(400,{'error':str(exc)})
                    except Exception:
                        return self.payload(503,{'error':'Busca de endereços indisponível'})
                    return self.payload(200,v)
                if path=='/api/metro':
                    return self.payload(200,metro.listing())
                if path=='/api/metro/news':
                    return self.payload(200,metro.news())
                if path=='/api/metro/line':
                    v=metro.line(qs.get('id',[''])[0])
                    return self.payload(200,v) if v else self.payload(404,{'error':'Linha de metrô não encontrada'})
                if path=='/api/metro/station':
                    v=metro.station(qs.get('id',[''])[0],engine.stops)
                    return self.payload(200,v) if v else self.payload(404,{'error':'Estação de metrô não encontrada'})
                if path=='/api/metro/nearby':
                    try:
                        v=metro.nearby(qs.get('lat',[''])[0],qs.get('lng',[''])[0])
                    except (ValueError,TypeError,OverflowError):
                        return self.payload(400,{'error':'Coordenadas inválidas'})
                    return self.payload(200,v)
                if path=='/api/status': return self.payload(200,engine.status())
                if path=='/api/routes': return self.payload(200,engine.routes_listing())
                if path=='/api/route':
                    code=qs.get('code',[''])[0];pattern=qs.get('pattern',[None])[0]
                    v=engine.route_geometry(code,pattern)
                    return self.payload(200,v) if v else self.payload(404,{'error':'Linha ou variante não localizada'})
                if path=='/api/stops':
                    q=qs.get('q',[''])[0][:120]
                    return self.payload(200,engine.search_stops(q))
                if path=='/api/nearby-stops':
                    try:
                        v=engine.nearby_stops(qs.get('lat',[''])[0],qs.get('lng',[''])[0])
                    except (ValueError, TypeError):return self.payload(400,{'error':'Coordenadas invalidas'})
                    return self.payload(200,v)
                if path=='/api/map-stops':
                    try:
                        v=engine.map_stops(*(qs.get(n,[''])[0] for n in ('minlat','minlng','maxlat','maxlng')))
                    except (ValueError, TypeError):return self.payload(400,{'error':'Limites invalidos'})
                    return self.payload(200,v)
                if path=='/api/stop':
                    v=engine.stop_detail(qs.get('id',[''])[0])
                    return self.payload(200,v) if v else self.payload(404,{'error':'Ponto nao encontrado'})
                if path=='/api/fleet':
                    code=qs.get('route',[''])[0]
                    v=engine.fleet(code)
                    return self.payload(200,v) if v else self.payload(404,{'error':'Linha não localizada'})
                # Apenas arquivos públicos de catálogo no servidor local.
                # Não há acesso por path traversal, nem hospedagem dinâmica.
                if path.startswith('/catalog/'):
                    rel=urllib.parse.unquote(path[len('/catalog/'):])
                    base=(ROOT/'catalog').resolve()
                    file=(base/rel).resolve()
                    if ('\\' in rel or not rel or '..' in pathlib.PurePosixPath(rel).parts or
                        base not in file.parents or
                        file.suffix not in ('.gz','.json') or
                        not file.is_file()):
                        return self.payload(404,{'error':'Arquivo não encontrado'})
                    kind='application/json; charset=utf-8' if file.suffix=='.json' else 'application/octet-stream'
                    return self.respond(200,file.read_bytes(),kind)
                if path=='/':path='/index.html'
                if path not in ('/index.html','/app.js','/style.css','/route-worker.js'):
                    return self.payload(404,{'error':'Não encontrado'})
                file=ROOT/'static'/path.lstrip('/')
                raw=file.read_bytes()
                mime={'/index.html':'text/html','/app.js':'application/javascript',
                      '/route-worker.js':'application/javascript',
                      '/style.css':'text/css'}[path]
                return self.respond(200,raw,mime+'; charset=utf-8')
            except (BrokenPipeError,ConnectionResetError):pass
            except Exception as exc:
                try:self.payload(500,{'error':'Erro interno','detail':type(exc).__name__})
                except (BrokenPipeError,ConnectionResetError):pass
        def do_POST(self):
            try:
                path=urllib.parse.urlsplit(self.path).path
                if path.startswith('/externo/api/'):
                    path=path[len('/externo'):]
                if path!='/api/plan':
                    return self.payload(404,{'error':'Não encontrado'})
                length=int(self.headers.get('Content-Length','0'))
                if length<2 or length>4096:
                    return self.payload(413,{'error':'Corpo de requisição inválido'})
                payload=json.loads(self.rfile.read(length))
                if not isinstance(payload,dict):
                    return self.payload(400,{'error':'Dados inválidos'})
                try:
                    result=planner.plan(payload.get('origin'),
                                        payload.get('destination'),
                                        payload.get('at'),
                                        payload.get('mode','departAt'),
                                        payload.get('preference','fastest'))
                    return self.payload(200,result)
                except (PlannerError,ValueError) as exc:
                    return self.payload(400,{'error':str(exc)})
            except (BrokenPipeError,ConnectionResetError):pass
            except (ValueError,TypeError,json.JSONDecodeError):
                self.payload(400,{'error':'JSON inválido'})
            except Exception as exc:
                try:self.payload(500,{'error':'Falha ao planejar','detail':type(exc).__name__})
                except (BrokenPipeError,ConnectionResetError):pass
        def log_message(self,fmt,*args):
            # Suppress full request lines: /api/nearby-stops carries user coordinates.
            method=getattr(self,'command','GET')
            path=urllib.parse.urlsplit(getattr(self,'path','/')).path
            print(self.address_string(),method,path)
    httpd=ThreadingHTTPServer((host,port),Handler)
    print('BH Rastreador P2 — desenvolvimento local (não é serviço público)')
    print(f'Abra: http://{host}:{port}')
    print('Coleta PBH sob demanda e cache de pelo menos 35 segundos. CTRL+C para parar.')
    if open_browser:threading.Timer(0.5,lambda:webbrowser.open(f'http://{host}:{port}')).start()
    try:httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:print('\nEncerrado.')
    finally:httpd.server_close()

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--port',type=int,default=8765)
    p.add_argument('--open',action='store_true')
    args=p.parse_args()
    run(port=args.port,open_browser=args.open)
