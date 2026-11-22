"""Export source-faithful DER RMBH catalogs; no geocoding, dates, or stop times.

Usage: python -m data_quality.der_rmbh_catalog --itineraries ... --departures ... --output ...
"""
from __future__ import annotations
import argparse
import collections
import hashlib
import json
from pathlib import Path
from .der_rmbh_reference import read_itineraries, read_departures, coverage


def build(itineraries, departures):
    audit = coverage(itineraries, departures)
    by_line = collections.defaultdict(lambda: {"itineraries": [], "departureBoards": {}})
    for row in itineraries["records"]:
        key = row["key"]
        by_line[key]["itineraries"].append({"name": row["name"], "typeRaw": row["kindRaw"],
            "variantRaw": row["variantRaw"], "streetsRaw": row["streetsRaw"],
            "stopDescriptionsRaw": row["stopDescriptionsRaw"], "sourceLine": row["line"]})
    for row in departures["records"]:
        group = by_line[row["key"]]["departureBoards"]
        key = (row["dayRaw"], row["boardRaw"])
        group.setdefault(key, []).append({"clock": row["departureRaw"], "secondsSinceMidnight": row["clockSeconds"],
                                            "suffixRaw": row["suffixRaw"], "sourceLine": row["line"]})
    lines = []
    for (code, number), data in sorted(by_line.items()):
        boards = [{"dayTypeRaw": day, "boardRaw": board, "departures": entries}
                  for (day, board), entries in sorted(data["departureBoards"].items())]
        lines.append({"codLinha": code, "numLinha": number,
                      "itineraries": data["itineraries"], "departureBoards": boards,
                      "hasItinerary": bool(data["itineraries"]), "hasDepartures": bool(boards)})
    return {"schemaVersion": 1, "source": audit["source"], "inputs": audit["inputs"],
            "coverage": audit["coverage"], "lines": lines,
            "constraints": {"datesVerified": False, "stopCoordinatesVerified": False,
                            "stopTimesVerified": False, "redistributionLicenseVerified": False}}


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument('--itineraries', type=Path, required=True)
    p.add_argument('--departures', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--expect-itineraries-sha256')
    p.add_argument('--expect-departures-sha256')
    args = p.parse_args(argv)
    it, dep = read_itineraries(args.itineraries), read_departures(args.departures)
    for label, actual, expected in [('itineraries', it['sha256'], args.expect_itineraries_sha256),
                                     ('departures', dep['sha256'], args.expect_departures_sha256)]:
        if expected and actual != expected.lower():
            p.error(label + ' SHA-256 mismatch: ' + actual)
    result = build(it, dep)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
                      'lineKeys': len(result['lines']), 'departures': result['coverage']['scheduleDepartures'],
                      'unmatchedScheduleKeys': result['coverage']['scheduleOnlyLineKeys']}))


if __name__ == '__main__':
    main()
