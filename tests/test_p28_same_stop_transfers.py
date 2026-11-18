"""P28: synthetic offline same-stop transfer validation; never downloads data."""
from __future__ import annotations
import datetime as dt
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SRC=Path(__file__).resolve().parents[1]/"scripts/audit_same_stop_transfers.py"
spec=importlib.util.spec_from_file_location("audit_same_stop_transfers",SRC)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

ROUTES={"9106":"a"*16,"5106":"b"*16,"9209":"c"*16}
def setup(root, bad_alight=False,bad_board=False):
    root=Path(root)
    (root/"routing").mkdir()
    meta={"services":{"S":{"start_date":"20261101","end_date":"20261231",
                             **{day:"1" for day in module.WEEKDAYS}}},
          "exceptions":{"20261118":{"S":2}},
          "files":{line:"routing/"+token+".json.gz" for line,token in ROUTES.items()}}
    (root/"routing-index.json").write_text(json.dumps(meta),encoding="utf-8")
    first=[["ORIGIN",21*3600+50*60,21*3600+50*60,0,0,1],
           ["SHARED",22*3600+10*60,22*3600+10*60,0,int(bad_alight),9],
           ["LAST",22*3600+20*60,22*3600+20*60,0,0,15]]
    second=[["SHARED",22*3600+14*60,22*3600+14*60,int(bad_board),0,5],
            ["DESTINATION",22*3600+45*60,22*3600+45*60,0,0,7]]
    overnight_first=[["ORIGIN",24*3600+40*60,24*3600+40*60,0,0,1],
                     ["SHARED",25*3600+5*60,25*3600+5*60,0,0,9]]
    overnight_second=[["SHARED",25*3600+12*60,25*3600+12*60,0,0,5],
                      ["DESTINATION",25*3600+35*60,25*3600+35*60,0,0,7]]
    for code,rows in [
        ("9106",[["trip_private_one","S","forward",first],
                 ["trip_private_overnight_first","S","forward",overnight_first]]),
        ("5106",[["trip_private_two","S","forward",second],
                 ["trip_private_overnight_second","S","forward",overnight_second]]),
        ("9209",[["unrelated","S","other",[["A",28800,28800,0,0,1],
                                              ["B",30000,30000,0,0,2]]]])]:
        with gzip.open(root/("routing/"+ROUTES[code]+".json.gz"),"wt",encoding="utf-8") as stream:
            json.dump(rows,stream)

class SameStopTransferAuditTests(unittest.TestCase):
    def test_feasible_scheduled_shared_stop_no_estimated_eta(self):
        with tempfile.TemporaryDirectory() as root:
            setup(root)
            r=module.audit(Path(root),"9106","5106",dt.date(2026,11,17),"22:00",2)
            self.assertEqual(r["sharedStops"],1)
            self.assertEqual(r["feasibleStops"],1)
            self.assertGreaterEqual(r["timedTransferPairs"],1)
            self.assertEqual(r["examples"][0]["scheduledWaitMinutes"],4)
            self.assertFalse(r["endToEndJourneyVerified"])
            self.assertNotIn("trip_private",json.dumps(r))
            self.assertNotIn("GPS calculated",json.dumps(r))

    def test_prohibited_boarding_and_alighting_excluded(self):
        for kwargs in ({"bad_alight":True},{"bad_board":True}):
            with self.subTest(kwargs=kwargs),tempfile.TemporaryDirectory() as root:
                setup(root,**kwargs)
                r=module.audit(Path(root),"9106","5106",dt.date(2026,11,17),"22:00",2)
                self.assertEqual(r["timedTransferPairs"],0)

    def test_24h_plus_times_use_previous_service_day(self):
        with tempfile.TemporaryDirectory() as root:
            setup(root)
            # Nov 18 service canceled, but 25:12 trip from Nov 17
            # survives after midnight, as the official GTFS rule requires.
            r=module.audit(Path(root),"9106","5106",dt.date(2026,11,18),"01:00",1)
            self.assertEqual(r["feasibleStops"],1)
            self.assertEqual(r["examples"][0]["scheduledWaitMinutes"],7)
            self.assertEqual(r["examples"][0]["firstScheduledArrival"],"18/11 01:05")

    def test_exception_removes_day_service(self):
        with tempfile.TemporaryDirectory() as root:
            setup(root)
            r=module.audit(Path(root),"9106","5106",dt.date(2026,11,18),"22:00",2)
            self.assertEqual(r["timedTransferPairs"],0)

    def test_other_line_does_not_assume_proximity_is_same_stop(self):
        with tempfile.TemporaryDirectory() as root:
            setup(root)
            r=module.audit(Path(root),"9106","9209",dt.date(2026,11,17),"22:00")
            self.assertEqual(r["sharedStops"],0)
            self.assertEqual(r["timedTransferPairs"],0)

    def test_absent_line_is_not_invented(self):
        with tempfile.TemporaryDirectory() as root:
            setup(root)
            r=module.audit(Path(root),"9106","411C",dt.date(2026,11,17),"22:00")
            self.assertFalse(r["secondInCatalog"])
            self.assertFalse(r["endToEndJourneyVerified"])

    def test_bad_time_and_line_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            setup(root)
            for params in [("25:00",3,2,30),("22:00",0,2,30),
                           ("22:00",3,0,30),("22:00",3,20,10)]:
                with self.subTest(params=params):
                    with self.assertRaises(ValueError):
                        module.audit(Path(root),"9106","5106",dt.date(2026,11,17),*params)
            with self.assertRaises(ValueError):
                module.audit(Path(root),"9106","9106",dt.date(2026,11,17),"22:00")

if __name__=="__main__":
    unittest.main()
