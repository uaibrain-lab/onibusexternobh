"""P17: stage-only GPS activation must never leak into default static output."""
import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'scripts'
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location(
    'build_static_site_p17', SCRIPTS / 'build_static_site.py'
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StagingBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name) / 'repository'
        static = self.root / 'static'
        catalog = self.root / 'catalog'
        scan = catalog / 'scan'
        static.mkdir(parents=True)
        scan.mkdir(parents=True)
        self.html = (
            '<!doctype html><html lang="pt-BR"><head>'
            '<title>Externo — Hub UFMG · Protótipo</title>'
            '<link rel="stylesheet" href="./style.css">'
            '<link rel="stylesheet" href="./hub-parity.css"></head><body>'
            '<div class="sheet-identity"><strong>Externo</strong>'
            '<span>BELO HORIZONTE</span></div>'
            '<div class="source-pill" aria-live="polite"></div>'
            '<div class="notice-top" role="note">Aviso original</div>'
            '<script src="./app.js" defer></script></body></html>'
        )
        (static / 'index.html').write_text(self.html, encoding='utf-8')
        (static / 'gps-config.json').write_text(
            '{"enabled":false,"endpoint":"","refreshSeconds":45}', encoding='utf-8')
        for name in ('app.js', 'style.css', 'hub-parity.css', 'route-worker.js',
                     'service-worker.js', 'static-bus.js', 'static-arrivals.js',
                     'live-gps.js', 'place-geocoding.js', 'walk-network.js', 'metro-timing.js',
                     'manifest.webmanifest', 'icon-192.png', 'icon-512.png'):
            (static / name).write_text('static test fixture', encoding='utf-8')
        (scan / 'index.json').write_text(json.dumps({
            'schema': 1, 'tripCount': 1200, 'connectionCount': 11000,
            'validThrough': '2026-12-31', 'stopCount': 2
        }), encoding='utf-8')
        (scan / 'sample.bin.gz').write_bytes(b'\x1f\x8b\x08\x00')
        (catalog / 'manifest.json').write_text(json.dumps({
            'feedEndDate': '2026-12-31', 'stops': 2, 'trips': 1200
        }), encoding='utf-8')
        for name in ('metro.json', 'routes.json', 'stops.json', 'patterns.json',
                     'shapes.json', 'routing-stop-routes.json', 'gps-nl-map.json'):
            (catalog / name).write_text('{}' if name.endswith('map.json') else '[]',
                                       encoding='utf-8')
        self.original = (static / 'gps-config.json').read_bytes()
        def fake_arrivals(catalog_root, output):
            output.mkdir(parents=True, exist_ok=True)
            (output / 'index.json').write_text('{"schema":1}', encoding='utf-8')
        self.patch_root = mock.patch.object(module, 'ROOT', self.root)
        self.patch_arrivals = mock.patch.object(module, 'build_arrivals', fake_arrivals)
        self.patch_root.start()
        self.patch_arrivals.start()
        self.addCleanup(self.patch_root.stop)
        self.addCleanup(self.patch_arrivals.stop)

    def test_normal_build_cannot_enable_gps_or_mark_staging(self):
        output = self.root / 'build-normal'
        module.build(output)
        cfg = json.loads((output / 'externo/gps-config.json').read_text(encoding='utf-8'))
        html = (output / 'externo/index.html').read_text(encoding='utf-8')
        self.assertFalse(cfg['enabled'])
        self.assertNotIn('data-gps-homologacao', html)
        self.assertNotIn('GPS EM TESTE', html)
        self.assertFalse((output / '_redirects').exists())
        self.assertFalse((output / '_headers').exists())
        self.assertEqual((self.root / 'static/gps-config.json').read_bytes(), self.original)

    def test_explicit_gps_staging_only_mutates_build_artifacts(self):
        output = self.root / 'build-staging'
        module.build(output, gps_staging=True)
        cfg = json.loads((output / 'externo/gps-config.json').read_text(encoding='utf-8'))
        html = (output / 'externo/index.html').read_text(encoding='utf-8')
        self.assertTrue(cfg['enabled'])
        self.assertEqual(cfg['provider'], 'gtfs_rt')
        self.assertEqual(cfg['endpoint'], module.STAGING_ENDPOINT)
        self.assertIn('data-gps-homologacao="true"', html)
        self.assertIn('noindex,nofollow,noarchive', html)
        self.assertIn('GPS EM TESTE', html)
        self.assertIn('gps-staging-label', html)
        self.assertIn('./app.js?v=p23-street-pareto-20261117', html)
        self.assertIn('./hub-parity.css?v=p23-street-pareto-20261117', html)
        self.assertTrue((output / 'externo/place-geocoding.js').is_file())
        self.assertIn('GPS em homologação', html)
        self.assertIn('HOMOLOGAÇÃO: GPS experimental SUMOB', html)
        self.assertEqual((output / '_redirects').read_text(encoding='utf-8'),
                         '/ /externo/ 302\n')
        self.assertIn('X-Robots-Tag: noindex',
                      (output / '_headers').read_text(encoding='utf-8'))
        self.assertEqual((self.root / 'static/gps-config.json').read_bytes(), self.original)

    def test_staging_refuses_source_configuration_that_is_already_enabled(self):
        (self.root / 'static/gps-config.json').write_text(
            '{"enabled":true}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'desativada'):
            module.build(self.root / 'build-unsafe', gps_staging=True)

    def test_staging_keeps_original_catalog_and_gtfs_version(self):
        output = self.root / 'build-staging'
        module.build(output, gps_staging=True)
        index = json.loads((output / 'externo/catalog/scan/index.json').read_text())
        self.assertEqual(index['validThrough'], '2026-12-31')
        self.assertTrue((output / 'externo/catalog/scan/sample.bin.gz').exists())


if __name__ == '__main__':
    unittest.main()
