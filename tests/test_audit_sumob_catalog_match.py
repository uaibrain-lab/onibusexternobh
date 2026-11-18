"""Offline fixture tests: SUMOB feed vs exact app scan, no network or real GPS."""
from __future__ import annotations
import gzip
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SRC=Path(__file__).resolve().parents[1] / "scripts/audit_sumob_catalog_match.py"
spec=importlib.util.spec_from_file_location("audit_sumob_catalog_match",SRC)
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class Fake:
    def __init__(self,**kwargs):
        self.__dict__.update(kwargs)
    def HasField(self,key):
        return key in self.__dict__ and self.__dict__[key] is not None
    def __getattr__(self,key):
        if key in ("trip_id","route_id","start_date","start_time","stop_id"):
            return ""
        raise AttributeError(key)


def fixture(root, sequence=True):
    root=Path(root)
    (root/"scan").mkdir()
    (root/"routing").mkdir()
    meta={"schema":2,"tripCount":2,"builtUTC":"fake-build",
          "gtfsBuiltUTC":"fake-routing-build",
          "services":[{"id":"weekday","calendar":{
              "start_date":"20260101","end_date":"20261231",
              "monday":"1","tuesday":"1","wednesday":"1",
              "thursday":"1","friday":"1","saturday":"0","sunday":"0"}}],
          "exceptions":{"20261118":{"weekday":2}}}
    (root/"scan/index.json").write_text(json.dumps(meta),encoding="utf-8")
    with gzip.open(root/"scan/trips.json.gz","wt",encoding="utf-8") as stream:
        json.dump([["trip-one","5102","Local",0],["trip-two","9209","Centro",0]],stream)
    (root/"routing-index.json").write_text(json.dumps({
        "builtUTC":"fake-routing-build","stopSequencePreserved":sequence,
        "files":{"5102":"routing/5102.json.gz","9209":"routing/9209.json.gz"}
    }),encoding="utf-8")
    one=[["A",8*3600,8*3600,0,0,2],
         ["B",8*3600+300,8*3600+300,0,0,8]]
    two=[["C",9*3600,9*3600,0,0,1],
         ["D",9*3600+300,9*3600+300,0,0,3]]
    if not sequence:
        one=[x[:5] for x in one]
        two=[x[:5] for x in two]
    for code,trip,stops in [("5102","trip-one",one),("9209","trip-two",two)]:
        with gzip.open(root/("routing/"+code+".json.gz"),"wt",encoding="utf-8") as stream:
            json.dump([[trip,"weekday","Local",stops]],stream)


def feed(trip_id="trip-one",code="5102",date="20261117",
         depart="08:00:00",sid="B",seq=8):
    return Fake(header=Fake(timestamp=1700000000),entity=[
        Fake(trip_update=Fake(
            trip=Fake(trip_id=trip_id,route_id=code,
                      start_date=date,start_time=depart,direction_id=0),
            stop_time_update=[Fake(stop_id=sid,stop_sequence=seq,
                                   arrival=Fake(delay=139))]))
    ])


class AppCatalogTests(unittest.TestCase):
    def test_exact_trip_service_start_stop_id_and_original_sequence(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture(folder,True)
            result=audit.audit(feed(),Path(folder),now=1700000003)
            self.assertEqual(result["tripIdFoundInApp"],1)
            self.assertEqual(result["activeServiceMatches"],1)
            self.assertEqual(result["startTimeMatchesAppSchedule"],1)
            self.assertEqual(result["stopIdAndSequenceVerified"],1)
            self.assertEqual(result["stopSequenceMismatch"],0)
            self.assertEqual(result["feedHeaderAgeSeconds"],3)
            self.assertFalse(result["readyForLiveETA"])
            self.assertFalse(result["perTripSampleAgeVerified"])

    def test_old_catalog_has_no_safe_sequence_join(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture(folder,False)
            result=audit.audit(feed(),Path(folder))
            self.assertEqual(result["stopIdPresentInTrip"],1)
            self.assertEqual(result["stopSequenceNotPreserved"],1)
            self.assertEqual(result["stopIdAndSequenceVerified"],0)
            self.assertFalse(result["readyForLiveETA"])

    def test_original_sequence_must_not_be_guessed_from_stop_index(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture(folder,True)
            good=audit.audit(feed(seq=8),Path(folder))
            bad=audit.audit(feed(seq=2),Path(folder))
            self.assertEqual(good["stopIdAndSequenceVerified"],1)
            self.assertEqual(bad["stopSequenceMismatch"],1)

    def test_service_day_stop_id_route_and_start_time_must_match(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture(folder,True)
            result=audit.audit(feed(date="20261118"),Path(folder))
            self.assertEqual(result["serviceInactiveOnStartDate"],1)
            result=audit.audit(feed(code="9209"),Path(folder))
            self.assertEqual(result["routeMismatchOrAmbiguous"],1)
            result=audit.audit(feed(depart="09:00:00"),Path(folder))
            self.assertEqual(result["startTimeDifferentFromAppSchedule"],1)
            result=audit.audit(feed(sid="unrelated"),Path(folder))
            self.assertEqual(result["stopIdMissingFromTrip"],1)

    def test_private_ids_never_appear_in_report(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture(folder,True)
            result=audit.audit(feed(trip_id="PRIVATE-LONG-ID"),Path(folder))
            self.assertNotIn("PRIVATE-LONG-ID",json.dumps(result))
            self.assertEqual(result["tripIdMissingFromApp"],1)

    def test_outdated_or_corrupt_scan_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            fixture(folder,True)
            (Path(folder)/"scan/trips.json.gz").unlink()
            with self.assertRaises(ValueError):
                audit.audit(feed(),Path(folder))
            self.assertIsNone(audit.service_active(
                {"services":[{"id":"x","calendar":{}}]} ,0,"invalid"))
            self.assertEqual(audit.seconds("24:50:00"),89400)
            self.assertIsNone(audit.seconds("48:00:00"))


if __name__=="__main__":
    unittest.main()
