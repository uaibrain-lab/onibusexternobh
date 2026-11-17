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
        # Check the security behavior, not the spelling of a local variable.
        self.assertRegex(source,r'(?:u|url)\\.origin!==self\\.location\\.origin')
        self.assertRegex(source,r'(?:u|url)\\.pathname\\.includes\\(\\'\\/api\\/\\'\\)')
        self.assertIn("const fallback=new URL('./index.html',self.registration.scope).href",source)
        self.assertIn("cache.match(cacheKey)",source)
        self.assertIn("network-first",source)
        self.assertNotIn("tile.openstreetmap.org/",source)
    def test_html_links_to_manifest(self):
        source=(ROOT/'static/index.html').read_text('utf8')
        self.assertIn('href="./manifest.webmanifest"',source)

if __name__=='__main__':unittest.main()
