"""P28: offline transfer topology validation, with no itinerary/ETA assertions."""
import importlib.util
from pathlib import Path
import unittest

SRC=Path(__file__).resolve().parents[1]/"scripts/audit_transfer_topology.py"
spec=importlib.util.spec_from_file_location("audit_transfer_topology",SRC)
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class TransferTopologyTests(unittest.TestCase):
    def setUp(self):
        self.stops=[
            ["a","Mesmo ponto",-19.90,-43.90],
            ["b","Mesmo ponto novamente",-19.90,-43.90],
            ["c","Perto 100m",-19.901,-43.90],
            ["d","Longe",-19.92,-43.91],
            ["e","Corredor misto",-19.9012,-43.901],
            ["f","Outro ponto no corredor",-19.9014,-43.9012]
        ]
        self.routes={
            "a":["9106","5106"],"b":["9106"],
            "c":["5106","9209"],"d":["51"],
            "e":["9209","51"],"f":["51"]
        }

    def test_shared_stop_is_not_miscounted_as_walking(self):
        x=audit.audit(self.stops,self.routes,[("9106","5106")],450)["pairs"][0]
        self.assertEqual(x["sharedStopIds"],1)
        self.assertEqual(x["lineAStopIds"],2)
        self.assertEqual(x["lineBStopIds"],2)
        self.assertEqual(x["distinctStopPairsWithinRadius"],1)
        self.assertFalse("arrival" in x)

    def test_close_stops_do_not_claim_service_schedule(self):
        x=audit.audit(self.stops,self.routes,[("9209","51")],450)["pairs"][0]
        self.assertEqual(x["sharedStopIds"],1)
        self.assertEqual(x["distinctStopPairsWithinRadius"],1)
        self.assertIn("no direction",x["note"])

    def test_bounds_and_codes(self):
        for x in [-1,0,1001,float("nan")]:
            with self.assertRaises(ValueError):
                audit.audit(self.stops,self.routes,[("9106","5106")],x)
        for x in ["5106","5106+","*+51"]:
            with self.assertRaises(ValueError): audit.parse_pairs(x)
        self.assertEqual(audit.parse_pairs("9106+5106,9209+51"),
                         [("9106","5106"),("9209","51")])


if __name__=="__main__":
    unittest.main()
