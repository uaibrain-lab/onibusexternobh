"""Prevent Firebase Hosting cleanUrls/trailingSlash=false from unstyling V1."""
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urljoin

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.prepare_hub_v1 import fix_clean_urls_assets

FIXTURE={
    "index.html":'<html><head>\n<link rel="stylesheet" href="./style.css">'
        '\n<link rel="stylesheet" href="./hub-parity.css"></head><body></body></html>',
    "static-bus.js":"const base=new URL('./catalog/',location.href);",
    "static-arrivals.js":"const root=new URL('./catalog/arrivals/',location.href);",
    "live-gps.js":"const ROOT=new URL('./',location.href);",
    "app.js":"""const freeBase=new URL('./catalog/scan/',location.href).href;
const freeWorker=new Worker(new URL('./route-worker.js',location.href));
const install=()=>navigator.serviceWorker.register('./service-worker.js',{scope:'./'})"""
}

def assert_package(directory):
    root=Path(directory)
    html=(root/"index.html").read_text(encoding="utf8")
    assert html.count('<base href="/externo/">')==1
    assert html.index('<base href="/externo/">')<html.index('href="./style.css"')
    # Firebase may serve a clean URL without slash. The HTML base must
    # resolve every relative asset under /externo/, not at the Hub root.
    origin="https://hubufmg--homologacao-exbdd4qe.web.app"
    document=origin+"/externo"
    base=urljoin(document,"/externo/")
    for asset in ("style.css","hub-parity.css","app.js","live-gps.js",
                  "static-bus.js","static-arrivals.js","gps-config.json",
                  "catalog/manifest.json"):
        assert urljoin(base,"./"+asset)==origin+"/externo/"+asset
        assert (root/asset).is_file(), asset
    for name in ("static-bus.js","static-arrivals.js","live-gps.js","app.js"):
        content=(root/name).read_text(encoding="utf8")
        assert "document.baseURI" in content, name
    js=(root/"app.js").read_text(encoding="utf8")
    assert "register('/externo/service-worker.js',{scope:'/externo/'})" in js
    print("HUB_V1_FIREBASE_CLEAN_URL_ASSETS_OK")

class CleanUrlAssetTests(unittest.TestCase):
    def test_fixer_retains_all_resources_after_firebase_strip_slash(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for name,contents in FIXTURE.items():
                (root/name).write_text(contents,encoding="utf8")
            for name in ("style.css","hub-parity.css","gps-config.json"):
                (root/name).write_text("",encoding="utf8")
            catalog=root/"catalog"
            catalog.mkdir()
            (catalog/"manifest.json").write_text("{}",encoding="utf8")
            fix_clean_urls_assets(root)
            assert_package(root)
    def test_rejects_unrecognized_js_build(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for name,contents in FIXTURE.items():
                (root/name).write_text(contents,encoding="utf8")
            (root/"live-gps.js").write_text("const ROOT='bad';",encoding="utf8")
            with self.assertRaisesRegex(ValueError,"Unrecognized V1 relative asset"):
                fix_clean_urls_assets(root)

if __name__=="__main__":
    if len(sys.argv)>1:
        assert_package(sys.argv[1])
    else:
        unittest.main()
