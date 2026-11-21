#!/usr/bin/env python3
"""Build a strictly informational DER/MG departure catalog from official TXT files.

No GTFS trips, stop locations, per-stop times, holiday interpretation, or ETA
are inferred. Source text files are NOT published by this script.
"""
import argparse
from collections import OrderedDict
import hashlib
import json
from pathlib import Path
import re

SOURCE_URL = 'https://www.consultas.der.mg.gov.br/grgx/sgtm/acesso_informacao.xhtml'
SCHEDULE_HEADER = 'COD_LINHA\tTIPO_DIA\tNOME_QUADRO\tHORA_PARTIDA\tNUM_LINHA\tNOME_LINHA'
ITINERARY_HEADER = 'COD_LINHA\tNUM_LINHA\tNOME_LINHA\tTIPO_VIAGEM\tNOME_ITI\tTIPO_ITI\tDESC_ITI\tDESC_PARADA'
TIME = re.compile(r'^([0-2][0-9])([0-5][0-9])([A-Z]{0,3})$')
RECORD_START = re.compile(r'^\d+;[^;]+;')


def read_records(path, header):
    raw = Path(path).read_bytes()
    text = raw.decode('utf-8-sig')
    rows = text.splitlines()
    if not rows or rows[0].strip() != header:
        raise ValueError('DER_HEADER_UNEXPECTED: ' + Path(path).name)
    records = []
    for line_no, line in enumerate(rows[1:], 2):
        if RECORD_START.match(line):
            records.append([line_no, line])
        elif line.strip():
            if not records:
                raise ValueError(f'DER_ORPHAN_CONTINUATION:{line_no}')
            # The DER TXT can split the terminal semicolon onto another line.
            # Do not insert an invented delimiter between physical lines.
            records[-1][1] += line
    return hashlib.sha256(raw).hexdigest(), records


def build(schedule_path, itinerary_path, requested=('411C', '511C')):
    schedule_hash, schedule = read_records(schedule_path, SCHEDULE_HEADER)
    itinerary_hash, itineraries = read_records(itinerary_path, ITINERARY_HEADER)
    codes = tuple(dict.fromkeys(x.upper().strip() for x in requested))
    if not codes or any(not re.fullmatch(r'[A-Z0-9]{1,8}', x) for x in codes):
        raise ValueError('DER_INVALID_LINE_FILTER')
    found = {code: OrderedDict() for code in codes}
    names, internal_ids = {}, {}
    for line_no, raw in schedule:
        columns = raw.split(';')
        if len(columns) != 7 or columns[-1].strip():
            raise ValueError(f'DER_SCHEDULE_FIELDS:{line_no}')
        internal, day, board, departure, code, name, _ = (c.strip() for c in columns)
        if code not in found:
            continue
        if not internal.isdecimal() or not day or not board or not name:
            raise ValueError(f'DER_INVALID_SCHEDULE_ROW:{line_no}')
        m = TIME.fullmatch(departure)
        if not m or int(m[1]) > 23:
            raise ValueError(f'DER_INVALID_DEPARTURE:{line_no}')
        if code in names and (names[code] != name or internal_ids[code] != internal):
            raise ValueError(f'DER_LINE_IDENTITY_CONFLICT:{line_no}')
        names[code], internal_ids[code] = name, internal
        key = (day, board)
        found[code].setdefault(key, []).append(departure)
    itinerary_counts = dict.fromkeys(codes, 0)
    for line_no, raw in itineraries:
        columns = raw.split(';', 2)
        if len(columns) < 3:
            raise ValueError(f'DER_ITINERARY_FIELDS:{line_no}')
        if columns[1].strip() in itinerary_counts:
            itinerary_counts[columns[1].strip()] += 1
    lines = {}
    for code in codes:
        if code not in names:
            raise ValueError('DER_MISSING_LINE:' + code)
        frames = [{'dayType': day, 'board': board, 'departures': times}
                  for (day, board), times in found[code].items()]
        lines[code] = {
            'code': code, 'internalCode': internal_ids[code], 'name': names[code],
            'departuresCount': sum(len(frame['departures']) for frame in frames),
            'itineraryRecords': itinerary_counts[code], 'frames': frames
        }
    return {
        'schema': 1, 'operator': 'DER/MG — transporte metropolitano RMBH',
        'sourceUrl': SOURCE_URL,
        'sourceSha256': {'quadro_horario_rmbh.txt': schedule_hash,
                         'itinerario_rmbh.txt': itinerary_hash},
        'dataStatus': 'published-departures-only',
        'calendarVerified': False, 'georeferencedStops': False,
        'perStopScheduleAvailable': False, 'routePlanningEnabled': False,
        'lines': lines
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--schedule', required=True)
    ap.add_argument('--itinerary', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--lines', default='411C,511C')
    args = ap.parse_args()
    result = build(args.schedule, args.itinerary, args.lines.split(','))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False,
                                 separators=(',', ':')) + '\n', encoding='utf-8')
    print('DER_METRO_INFORMATIONAL_OK',
          {code: (row['departuresCount'], row['itineraryRecords'])
           for code, row in result['lines'].items()})


if __name__ == '__main__':
    main()
