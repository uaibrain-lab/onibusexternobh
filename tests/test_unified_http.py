"""HTTP integration smoke: one local server hosts all four pages and GPS ETA."""
import http.client
import json
import pathlib
import socket
import subprocess
import sys
import time
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]


class UnifiedHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as s:
            s.bind(('127.0.0.1',0))
            cls.port=s.getsockname()[1]
        cls.process=subprocess.Popen(
            [sys.executable,'-c',
             f'from server import run; run(host="127.0.0.1",port={cls.port},open_browser=False)'],
            cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL
        )
        for _ in range(120):
            if cls.process.poll() is not None:
                raise AssertionError('Servidor Python encerrou antes da primeira resposta')
            try:
                if cls.get('/externo/')[0]==200:
                    return
            except (OSError,TimeoutError):
                time.sleep(.1)
        cls.process.terminate()
        raise AssertionError('Servidor Python não respondeu')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:cls.process.wait(timeout=3)
        except subprocess.TimeoutExpired:cls.process.kill()

    @classmethod
    def get(cls,path):
        connection=http.client.HTTPConnection('127.0.0.1',cls.port,timeout=5)
        try:
            connection.request('GET',path)
            response=connection.getresponse()
            return response.status,dict(response.getheaders()),response.read()
        finally:
            connection.close()

    def test_one_page_has_all_tabs_and_usable_assets(self):
        status,headers,html=self.get('/externo/')
        self.assertEqual(status,200)
        for text in (b'quick-pontos',b'quick-linhas',b'quick-metro',b'quick-rotas',
                     b'hub-parity.css',b'patternHint'):
            self.assertIn(text,html)
        for path in ('app.js','hub-parity.css','route-worker.js','manifest.webmanifest'):
            result,_,body=self.get('/externo/'+path)
            self.assertEqual(result,200,path)
            self.assertGreater(len(body),100,path)

    def test_legacy_path_redirected_for_iframe(self):
        status,headers,_=self.get('/externo')
        self.assertEqual(status,308)
        self.assertEqual(headers.get('Location'),'/externo/')

    def test_bus_and_metro_endpoints_work_together(self):
        for endpoint in ('/externo/api/routes','/externo/api/metro',
                         '/externo/api/plan/status'):
            status,headers,data=self.get(endpoint)
            self.assertEqual(status,200,endpoint)
            self.assertIn('application/json',headers.get('Content-Type',''))
            json.loads(data)

    def test_stop_has_scheduled_arrivals_without_waiting_for_gps(self):
        status,_,raw=self.get('/externo/api/stop?id=14791407')
        self.assertEqual(status,200)
        result=json.loads(raw)
        self.assertEqual(result['id'],'14791407')
        self.assertIn('routes',result)
        self.assertIn('timetableAvailable',result)
        self.assertTrue(all('destination' in r for r in result['routes']))


if __name__=='__main__':
    unittest.main()
