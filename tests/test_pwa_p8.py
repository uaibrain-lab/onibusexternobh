import json
import pathlib
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]

class PWATests(unittest.TestCase):
    def test_manifest_has_standalone_and_valid_icons(self):
        data=json.loads((ROOT/'static/manifest.webmanifest').read_text('utf8'))
        self.assertEqual(data['display'],'standalone')
        self.assertEqual(data['start_url'],'./')
        for icon in data['icons']:
            target=ROOT/'static'/icon['src'].lstrip('./')
            self.assertTrue(target.exists(),str(target))
            self.assertEqual(target.read_bytes()[:8],b'\x89PNG\r\n\x1a\n')
    def test_service_worker_excludes_gps_and_tiles(self):
        source=(ROOT/'static/sw.js').read_text('utf8')
        self.assertIn("u.origin!==self.location.origin",source)
        self.assertIn("u.pathname.includes('/api/')",source)
        self.assertIn("caches.match('./index.html')",source)
    def test_html_links_to_manifest(self):
        source=(ROOT/'static/index.html').read_text('utf8')
        self.assertIn('href="./manifest.webmanifest"',source)

if __name__=='__main__':unittest.main()
