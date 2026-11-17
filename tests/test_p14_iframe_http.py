"""P14 — HTTP smoke de iframe same-origin sem alterar o repositório Hub."""
import http.client
import json
import pathlib
import socket
import subprocess
import sys
import time
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]


class HubEmbedP14Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as sock:
            sock.bind(('127.0.0.1',0))
            cls.port=sock.getsockname()[1]
        cls.proc=subprocess.Popen(
            [sys.executable,'-c',
             f'from server import run;run(host="127.0.0.1",port={cls.port},open_browser=False)'],
            cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            if cls.proc.poll() is not None:
                raise RuntimeError('Servidor do Externo encerrou durante o teste.')
            try:
                status,_,_=cls.http('/externo/')
                if status==200:return
            except (OSError,TimeoutError):
                time.sleep(.1)
        cls.proc.terminate()
        raise TimeoutError('Servidor do Externo não ficou pronto em 10 s.')

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls,'proc') and cls.proc.poll() is None:
            cls.proc.terminate()
            try:cls.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:cls.proc.kill()

    @classmethod
    def http(cls,path):
        conn=http.client.HTTPConnection('127.0.0.1',cls.port,timeout=3)
        try:
            conn.request('GET',path)
            response=conn.getresponse()
            return response.status,dict(response.getheaders()),response.read()
        finally:
            conn.close()

    def test_canonical_embedded_path(self):
        status,headers,_=self.http('/externo')
        self.assertEqual(status,308)
        self.assertEqual(headers.get('Location'),'/externo/')

    def test_embedded_page_relative_assets_and_same_origin(self):
        status,headers,body=self.http('/externo/')
        self.assertEqual(status,200)
        self.assertEqual(headers.get('X-Frame-Options'),'SAMEORIGIN')
        self.assertIn(b'href="./hub-parity.css"',body)
        self.assertIn(b'src="./app.js"',body)
        self.assertNotIn(b'id="bandeco-navigation"',body)

    def test_embed_styles_and_script_served_at_nested_scope(self):
        for path,mime in [
            ('/externo/hub-parity.css','text/css'),
            ('/externo/style.css','text/css'),
            ('/externo/app.js','application/javascript'),
            ('/externo/sw.js','application/javascript'),
        ]:
            status,headers,body=self.http(path)
            self.assertEqual(status,200,path)
            self.assertTrue(headers.get('Content-Type','').startswith(mime),path)
            self.assertGreater(len(body),100,path)

    def test_api_prefix_available_without_touching_hub(self):
        status,headers,body=self.http('/externo/api/routes')
        self.assertEqual(status,200)
        data=json.loads(body)
        self.assertIsInstance(data,list)
        self.assertGreater(len(data),100)

if __name__=='__main__':
    unittest.main()
