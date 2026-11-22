"""DER/MG text parsing: no fabricated stop times, routes, or calendars."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('der', ROOT / 'scripts/build_der_metropolitan.py')
der = importlib.util.module_from_spec(spec)
spec.loader.exec_module(der)


class DerMetropolitanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.schedule = Path(self.temp.name) / 'schedule.txt'
        self.itinerary = Path(self.temp.name) / 'itinerary.txt'
        self.itinerary.write_text(
            der.ITINERARY_HEADER + '\n1;411C;Linha;PADRAO;Quadro;ruas;null;\n',
            encoding='utf-8')

    def write(self, *rows):
        self.schedule.write_text(der.SCHEDULE_HEADER + '\n' +
                                 '\n'.join(rows) + '\n', encoding='utf-8')

    def test_raw_suffix_and_day_label_unchanged(self):
        self.write('3757;DIA ÚTIL;411C DIA ÚTIL PC1;0506RI;411C;Linha;')
        result = der.build(self.schedule, self.itinerary, ('411C',))
        entry = result['lines']['411C']
        self.assertEqual(entry['frames'][0]['departures'], ['0506RI'])
        self.assertEqual(entry['frames'][0]['dayType'], 'DIA ÚTIL')
        self.assertEqual(entry['itineraryRecords'], 1)
        self.assertFalse(result['routePlanningEnabled'])
        self.assertFalse(result['perStopScheduleAvailable'])

    def test_split_final_semicolon_concatenated(self):
        self.write('3757;SÁBADO;411C SÁBADO PC1;0400;411C;Linha', ';')
        result = der.build(self.schedule, self.itinerary, ('411C',))
        self.assertEqual(result['lines']['411C']['departuresCount'], 1)

    def test_unexpected_header_rejected(self):
        self.schedule.write_text('a;b;c\n1;2;3;\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'DER_HEADER_UNEXPECTED'):
            der.build(self.schedule, self.itinerary, ('411C',))

    def test_invalid_departure_rejected(self):
        self.write('3757;DIA ÚTIL;411C PC1;2960;411C;Linha;')
        with self.assertRaisesRegex(ValueError, 'DER_INVALID_DEPARTURE'):
            der.build(self.schedule, self.itinerary, ('411C',))

    def test_identifier_collision_rejected(self):
        self.write('3757;DIA ÚTIL;411C PC1;0400;411C;Linha;',
                   '0001;SÁBADO;411C PC1;0500;411C;Linha;')
        with self.assertRaisesRegex(ValueError, 'DER_LINE_IDENTITY_CONFLICT'):
            der.build(self.schedule, self.itinerary, ('411C',))

    def test_missing_line_rejected(self):
        self.write('3757;DIA ÚTIL;411C PC1;0400;411C;Linha;')
        with self.assertRaisesRegex(ValueError, 'DER_MISSING_LINE'):
            der.build(self.schedule, self.itinerary, ('511C',))

    def test_only_target_line_extracted(self):
        self.write('3757;DIA ÚTIL;411C PC1;0400;411C;Linha;',
                   '1234;DIA ÚTIL;OTH PC1;0401;OTHER;Other;')
        result = der.build(self.schedule, self.itinerary, ('411C',))
        self.assertEqual(list(result['lines']), ['411C'])
        self.assertEqual(result['lines']['411C']['departuresCount'], 1)

    def test_committed_catalog_source_and_limitations(self):
        data = json.loads((ROOT / 'catalog/der-rmbh-411c-511c.json').read_text(encoding='utf-8'))
        self.assertEqual(data['schema'], 1)
        self.assertEqual(data['dataStatus'], 'published-departures-only')
        self.assertFalse(data['routePlanningEnabled'])
        self.assertFalse(data['calendarVerified'])
        self.assertFalse(data['georeferencedStops'])
        self.assertFalse(data['perStopScheduleAvailable'])
        self.assertEqual(data['sourceSha256']['quadro_horario_rmbh.txt'],
                         'b36f38c830c93db04d7c6c0fa6e6e9331b34553868407880a8fc2257199544b0')
        self.assertEqual(data['sourceSha256']['itinerario_rmbh.txt'],
                         'cf90c84e7093c5480d6118311d62bb37f8118028f2fc10346a90e0a4e6b70343')
        for code, count in [('411C', 729), ('511C', 497)]:
            line = data['lines'][code]
            self.assertEqual(line['departuresCount'], count)
            self.assertEqual(line['itineraryRecords'], 0)
            self.assertEqual(len(line['frames']), 9)
            self.assertEqual(sum(len(frame['departures']) for frame in line['frames']), count)
            self.assertTrue(all(frame['dayType'] and frame['board'] for frame in line['frames']))
            self.assertTrue(all(der.TIME.fullmatch(time) and
                                int(time[:2]) < 24
                                for frame in line['frames'] for time in frame['departures']))


if __name__ == '__main__':
    unittest.main()
