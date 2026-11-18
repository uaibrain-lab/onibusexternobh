"""Synthetic offline audit of OSM components and GTFS stop coverage."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import unittest

src = Path(__file__).resolve().parents[1] / "scripts/audit_walk_graph.py"
spec = importlib.util.spec_from_file_location("audit_walk_graph_p27", src)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class WalkAuditTests(unittest.TestCase):
    def setUp(self):
        self.graph = {
            "schema": 1, "nodeCount": 5, "edgeCount": 3,
            "nodes": [[-19.9, -43.9], [-19.9001, -43.9],
                      [-19.9002, -43.9], [-19.9, -43.9004],
                      [-19.9001, -43.9004]],
            "edges": [[0, 1, 11], [1, 2, 11], [3, 4, 11]]
        }
        self.stops = [
            ["a", "Ponto conectado", -19.9, -43.9],
            ["b", "Ponto ilha", -19.9, -43.9004],
            ["c", "Ponto fora da rede", -19.905, -43.905]
        ]

    def test_count_connected_and_disconnected_without_invented_crossings(self):
        actual = mod.audit(self.graph, self.stops)
        self.assertEqual(actual["connectedComponents"], 2)
        self.assertEqual(actual["largestComponentNodes"], 3)
        self.assertEqual(actual["stopsSnapped"], 2)
        self.assertEqual(actual["stopsUnsnapped"], 1)
        self.assertEqual(actual["stopsLargestComponent"], 1)
        self.assertEqual(actual["stopsOtherComponents"], 1)
        self.assertEqual(actual["snapDistanceMedianMeters"], 0)
        self.assertEqual(actual["snapCoveragePercent"], 66.67)

    def test_target_line_audit_is_aggregate_and_marks_absent_metropolitan(self):
        routes = {"a": ["9106", "9209"], "b": ["5106", "51"]}
        got = mod.audit(self.graph, self.stops,
                        focus_routes=("9106", "5106", "9209", "411C"),
                        stop_routes=routes)
        line = got["focusedLines"]
        self.assertEqual(line["9106"]["stops"], 1)
        self.assertEqual(line["9106"]["largestComponent"], 1)
        self.assertEqual(line["5106"]["otherComponents"], 1)
        self.assertFalse(line["411C"]["inMunicipalCatalog"])
        self.assertIsNone(line["411C"]["snapCoveragePercent"])
        self.assertNotIn("-19.9", str(line))

    def test_rejects_invalid_graph_edge(self):
        self.graph["edges"][0][2] = 0
        with self.assertRaisesRegex(ValueError, "Aresta"):
            mod.audit(self.graph, self.stops)

    def test_never_exports_exact_bus_stop_coordinates(self):
        stats = mod.audit(self.graph, self.stops)
        self.assertNotIn("-19.9", str(stats))
        self.assertNotIn("-43.9", str(stats))

if __name__ == "__main__":
    unittest.main()
