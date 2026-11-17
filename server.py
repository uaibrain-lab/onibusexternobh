#!/usr/bin/env python3
"""Local BH transport demo server (localhost only, no dependencies)."""
import argparse, json, mimetypes, pathlib, threading, urllib.parse, webbrowser
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from transit.engine import TransitEngine

ROOT=pathlib.Path(__file__).resolve().parent

def run(host='127.0.0.1',port=8765,open_browser=False):
    engine=TransitEngine(ROOT)
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
                if path=='/api/status':
                    engine.refresh_in_background()
                    return self.payload(200,engine.status(poll=False))
                if path=='/api/eta-diagnostics': return self.payload(200,engine.eta_coverage_summary())
                if path=='/api/routes': return self.payload(200,engine.routes_listing())
                if path=='/api/route':
                    code=qs.get('code',[''])[0];pattern=qs.get('pattern',[None])[0]
                    stop=qs.get('stop',[None])[0]
                    v=engine.route_geometry(code,pattern,stop)
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
                    engine.refresh_in_background()
                    v=engine.stop_detail(qs.get('id',[''])[0],poll=False)
                    return self.payload(200,v) if v else self.payload(404,{'error':'Ponto nao encontrado'})
                if path=='/api/fleet':
                    code=qs.get('route',[''])[0]
                    engine.refresh_in_background()
                    v=engine.fleet(code,poll=False)
                    return self.payload(200,v) if v else self.payload(404,{'error':'Linha não localizada'})
                if path=='/':path='/index.html'
                if path not in ('/index.html','/app.js','/style.css','/sw.js','/manifest.webmanifest','/icon-192.png','/icon-512.png'):
                    return self.payload(404,{'error':'Não encontrado'})
                file=ROOT/'static'/path.lstrip('/')
                raw=file.read_bytes()
                mime={'/index.html':'text/html','/app.js':'application/javascript','/style.css':'text/css', '/sw.js':'application/javascript','/manifest.webmanifest':'application/manifest+json','/icon-192.png':'image/png','/icon-512.png':'image/png'}[path]
                return self.respond(200,raw,mime if mime=='image/png' else mime+'; charset=utf-8')
            except (BrokenPipeError,ConnectionResetError):pass
            except Exception as exc:
                try:self.payload(500,{'error':'Erro interno','detail':type(exc).__name__})
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
