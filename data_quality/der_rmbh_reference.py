"""Validate DER-MG RMBH text snapshots without inventing stop times or service dates.

Read-only, standard-library-only. Input snapshots remain local; JSON is aggregates.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import pathlib
import re

SOURCE_URL = "https://www.consultas.der.mg.gov.br/grgx/sgtm/acesso_informacao.xhtml"
MAX_BYTES = 30_000_000
ROW_START = re.compile(r"^\d+;[^;\r\n]+;[^;\r\n]+;")
DEPARTURE = re.compile(r"^(\d{2})(\d{2})([A-Z]*)$")
ITINERARY_HEADER = ("COD_LINHA", "NUM_LINHA", "NOME_LINHA", "TIPO_VIAGEM", "NOME_ITI", "TIPO_ITI", "DESC_ITI", "DESC_PARADA")
SCHEDULE_HEADER = ("COD_LINHA", "TIPO_DIA", "NOME_QUADRO", "HORA_PARTIDA", "NUM_LINHA", "NOME_LINHA")


def _read_records(path, expected_header):
    path = pathlib.Path(path)
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("DER input exceeds byte limit")
    data = path.read_bytes()
    if b"\x00" in data:
        raise ValueError("DER input contains NUL bytes")
    digest = hashlib.sha256(data).hexdigest()
    lines = data.decode("utf-8-sig").splitlines()
    if not lines or tuple(lines[0].split("\t")) != expected_header:
        raise ValueError("unexpected DER tab-separated header: " + path.name)
    current = None
    records = []
    for line_number, line in enumerate(lines[1:], 2):
        if ROW_START.match(line):
            if current is not None:
                records.append(current)
            current = [line_number, line]
        elif current is None:
            if line.strip():
                raise ValueError("unexpected content before first DER record")
        else:
            current[1] += "\n" + line
    if current is not None:
        records.append(current)
    return {"sha256": digest, "bytes": len(data), "records": records}


def _key(code, number):
    code, number = code.strip(), number.strip()
    if not code.isdigit() or not number or any(x in number for x in "\r\n;"):
        raise ValueError("invalid DER line identifiers")
    return (code, number)


def read_itineraries(path):
    doc = _read_records(path, ITINERARY_HEADER)
    parsed = []
    for line_number, raw in doc["records"]:
        fields = raw.split(";", 6)
        if len(fields) != 7 or not fields[6].endswith(";"):
            raise ValueError("invalid DER itinerary at physical line " + str(line_number))
        code, number, name, kind, variant, street_text, stops_text = fields
        key = _key(code, number)
        if not name.strip() or not variant.strip() or not street_text.strip():
            raise ValueError("missing DER itinerary text at line " + str(line_number))
        parsed.append({"key": key, "name": name.strip(), "kindRaw": kind.strip(),
                       "variantRaw": variant.strip(), "streetsRaw": street_text.strip(),
                       "stopDescriptionsRaw": stops_text[:-1].strip(), "line": line_number})
    return {"sha256": doc["sha256"], "bytes": doc["bytes"], "records": parsed}


def read_departures(path):
    doc = _read_records(path, SCHEDULE_HEADER)
    parsed = []
    for line_number, raw in doc["records"]:
        fields = raw.split(";")
        if len(fields) != 7 or fields[-1] != "":
            raise ValueError("invalid DER schedule at physical line " + str(line_number))
        code, day, board, clock, number, name, _ = fields
        key = _key(code, number)
        match = DEPARTURE.fullmatch(clock.strip())
        if not match:
            raise ValueError("invalid DER departure clock at line " + str(line_number))
        hour, minute = int(match[1]), int(match[2])
        if hour > 23 or minute > 59:
            raise ValueError("DER departure clock outside 00:00–23:59 at line " + str(line_number))
        if not day.strip() or not board.strip() or not name.strip():
            raise ValueError("missing DER schedule metadata at line " + str(line_number))
        parsed.append({"key": key, "dayRaw": day.strip(), "boardRaw": board.strip(),
                       "departureRaw": clock.strip(), "clockSeconds": hour * 3600 + minute * 60,
                       "suffixRaw": match[3], "line": line_number})
    return {"sha256": doc["sha256"], "bytes": doc["bytes"], "records": parsed}


def coverage(itineraries, departures):
    """Source-neutral diagnostics; never claims GTFS stop IDs or dated service availability."""
    itineraries_by_line = collections.defaultdict(list)
    departures_by_line = collections.defaultdict(list)
    for row in itineraries["records"]:
        itineraries_by_line[row["key"]].append(row)
    for row in departures["records"]:
        departures_by_line[row["key"]].append(row)
    itinerary_keys, schedule_keys = set(itineraries_by_line), set(departures_by_line)
    days = collections.Counter(r["dayRaw"] for r in departures["records"])
    suffixes = collections.Counter(r["suffixRaw"] for r in departures["records"])
    variants = collections.Counter(r["kindRaw"] for r in itineraries["records"])
    missing_descriptions = sum(not r["stopDescriptionsRaw"] or r["stopDescriptionsRaw"].lower() == "null"
                               for r in itineraries["records"])
    def keys_as_json(keys):
        return [{"codLinha": code, "numLinha": number} for code, number in sorted(keys)[:20]]
    return {
        "source": {"publisher": "DER-MG", "url": SOURCE_URL, "sourceFormat": "DER RMBH text snapshot",
                   "license": "not verified", "sourceEffectiveDate": None, "snapshotDownloadedAt": None,
                   "officialValidity": None, "serviceDayMapping": "not verified"},
        "inputs": {"itinerario_rmbh.txt": {"sha256": itineraries["sha256"], "bytes": itineraries["bytes"]},
                   "quadro_horario_rmbh.txt": {"sha256": departures["sha256"], "bytes": departures["bytes"]}},
        "coverage": {"itineraryRecords": len(itineraries["records"]),
                     "scheduleDepartures": len(departures["records"]),
                     "itineraryLineKeys": len(itinerary_keys), "scheduleLineKeys": len(schedule_keys),
                     "matchedLineKeys": len(itinerary_keys & schedule_keys),
                     "itineraryOnlyLineKeys": len(itinerary_keys - schedule_keys),
                     "scheduleOnlyLineKeys": len(schedule_keys - itinerary_keys),
                     "nullOrAbsentStopDescriptions": missing_descriptions,
                     "dayTypesRaw": dict(sorted(days.items())),
                     "departureSuffixesRaw": dict(sorted(suffixes.items())),
                     "itineraryTypesRaw": dict(sorted(variants.items()))},
        "diagnostics": {"itineraryOnlyExamples": keys_as_json(itinerary_keys - schedule_keys),
                        "scheduleOnlyExamples": keys_as_json(schedule_keys - itinerary_keys),
                        "datedJourneysVerified": 0, "geocodedStopsVerified": 0,
                        "gtfsTripsVerified": 0,
                        "reason": "DER text includes street/stop descriptions and origin departures, not timestamped stop sequences or valid-on dates"},
        "usableFor": ["DER raw line identification", "listed departure clocks and operator day labels", "text itinerary comparison"],
        "notUsableFor": ["stop-level ETA", "GTFS stop_times", "trip durations", "service calendar date matching", "automatic router journeys"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read-only provenance and coverage audit of DER RMBH text")
    parser.add_argument("--itineraries", required=True, type=pathlib.Path)
    parser.add_argument("--departures", required=True, type=pathlib.Path)
    args = parser.parse_args(argv)
    result = coverage(read_itineraries(args.itineraries), read_departures(args.departures))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
