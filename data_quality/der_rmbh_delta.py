"""Compare two DER RMBH normalized catalogs without claiming dated validity.

Usage: python -m data_quality.der_rmbh_delta old.json new.json
Exit 2 for incompatible schema/source, 0 for valid comparison (even with changes).
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
from pathlib import Path


def load(path):
    raw = Path(path).read_bytes()
    doc = json.loads(raw)
    if doc.get("schemaVersion") != 1 or not isinstance(doc.get("lines"), list):
        raise ValueError("unsupported DER catalog schema")
    if doc.get("source", {}).get("publisher") != "DER-MG":
        raise ValueError("unexpected source publisher")
    keys = set()
    for line in doc["lines"]:
        key = (line["codLinha"], line["numLinha"])
        if key in keys:
            raise ValueError("duplicate DER line key: " + repr(key))
        keys.add(key)
    return doc, hashlib.sha256(raw).hexdigest()


def signature(line):
    """Source line numbers are deliberately ignored: text/order/clock changes count."""
    itineraries = collections.Counter(
        (r["name"], r["typeRaw"], r["variantRaw"], r["streetsRaw"], r["stopDescriptionsRaw"])
        for r in line["itineraries"]
    )
    departures = collections.Counter(
        (b["dayTypeRaw"], b["boardRaw"], d["clock"], d["suffixRaw"])
        for b in line["departureBoards"] for d in b["departures"]
    )
    return itineraries, departures


def compare(old, new):
    a = {(r["codLinha"], r["numLinha"]): r for r in old["lines"]}
    b = {(r["codLinha"], r["numLinha"]): r for r in new["lines"]}
    common = a.keys() & b.keys()
    itinerary_changed = []
    departures_changed = []
    for key in sorted(common):
        x, y = signature(a[key]), signature(b[key])
        if x[0] != y[0]:
            itinerary_changed.append(key)
        if x[1] != y[1]:
            departures_changed.append(key)
    def show(keys):
        return [{"codLinha": c, "numLinha": n} for c, n in sorted(keys)]
    return {
        "addedLineKeys": show(b.keys() - a.keys()),
        "removedLineKeys": show(a.keys() - b.keys()),
        "itineraryChangedLineKeys": show(itinerary_changed),
        "departureChangedLineKeys": show(departures_changed),
        "oldLineCount": len(a), "newLineCount": len(b),
        "oldDepartureCount": sum(len(d["departures"]) for r in a.values() for d in r["departureBoards"]),
        "newDepartureCount": sum(len(d["departures"]) for r in b.values() for d in r["departureBoards"]),
        "validity": "unverified", "license": "unverified",
        "warning": "Catalog comparison is not proof of service-day validity, coordinates, or redistribution rights"
    }


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("old", type=Path)
    p.add_argument("new", type=Path)
    p.add_argument("--output", type=Path)
    args = p.parse_args(argv)
    try:
        old, old_hash = load(args.old)
        new, new_hash = load(args.new)
        result = compare(old, new)
        result["oldCatalogSha256"] = old_hash
        result["newCatalogSha256"] = new_hash
    except (OSError, ValueError, KeyError, TypeError) as exc:
        p.exit(2, "DER delta blocked: " + str(exc) + "\n")
    output = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")


if __name__ == "__main__":
    main()
