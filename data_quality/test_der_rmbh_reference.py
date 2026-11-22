"""Synthetic DER fixtures, never official schedules."""
import pathlib
import tempfile
import unittest

from data_quality.der_rmbh_reference import (coverage, read_departures, read_itineraries)

ITIN_HEADER = 'COD_LINHA\tNUM_LINHA\tNOME_LINHA\tTIPO_VIAGEM\tNOME_ITI\tTIPO_ITI\tDESC_ITI\tDESC_PARADA\n'
TIMES_HEADER = 'COD_LINHA\tTIPO_DIA\tNOME_QUADRO\tHORA_PARTIDA\tNUM_LINHA\tNOME_LINHA\n'


class DerRmbhTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.itin = pathlib.Path(self.directory.name) / 'itinerario_rmbh.txt'
        self.times = pathlib.Path(self.directory.name) / 'quadro_horario_rmbh.txt'

    def inputs(self, itin=None, times=None):
        self.itin.write_text(ITIN_HEADER + (itin if itin is not None else '1;1000;Teste;PADRAO;Teste ida;RUA A, RUA B;RUA A Nº 1; Nº 2\nRUA B Nº 9;\n'), encoding='utf-8')
        self.times.write_text(TIMES_HEADER + (times if times is not None else '1;DIA ÚTIL;Teste PC1;0425RI;1000;Teste;\n1;SÁBADO;Teste PC2;2359NT;1000;Teste;\n'), encoding='utf-8')

    def test_multiline_and_inner_semicolons(self):
        self.inputs()
        rows = read_itineraries(self.itin)['records']
        self.assertEqual(len(rows), 1)
        self.assertIn('Nº 2\nRUA B', rows[0]['stopDescriptionsRaw'])
        self.assertEqual(rows[0]['key'], ('1', '1000'))

    def test_suffix_not_mistaken_for_stop_schedule(self):
        self.inputs()
        rows = read_departures(self.times)['records']
        self.assertEqual([(r['departureRaw'], r['suffixRaw']) for r in rows], [('0425RI', 'RI'), ('2359NT', 'NT')])
        self.assertEqual(rows[0]['clockSeconds'], 4 * 3600 + 25 * 60)

    def test_unmatched_lines_and_no_claim_of_trips(self):
        self.inputs(times='2;DIA ÚTIL;Teste PC1;0600;1001;Outra;\n')
        result = coverage(read_itineraries(self.itin), read_departures(self.times))
        self.assertEqual(result['coverage']['matchedLineKeys'], 0)
        self.assertEqual(result['coverage']['itineraryOnlyLineKeys'], 1)
        self.assertEqual(result['coverage']['scheduleOnlyLineKeys'], 1)
        self.assertEqual(result['diagnostics']['datedJourneysVerified'], 0)

    def test_reject_bad_clock(self):
        for value in ('2560', '0800X1', '8:00', '2400'):
            with self.subTest(value=value):
                self.inputs(times=f'1;DIA ÚTIL;PC;{value};1000;Teste;\n')
                with self.assertRaisesRegex(ValueError, 'departure clock'):
                    read_departures(self.times)

    def test_reject_incompatible_header(self):
        self.inputs()
        self.itin.write_text('different\n1;1000;foo;', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'header'):
            read_itineraries(self.itin)

    def test_reject_broken_itinerary(self):
        self.inputs(itin='1;1000;Teste;PADRAO;Teste ida;RUA A\n')
        with self.assertRaisesRegex(ValueError, 'invalid DER itinerary'):
            read_itineraries(self.itin)

    def test_reject_schedule_extra_delimiter(self):
        self.inputs(times='1;DIA ÚTIL;PC;0800;1000;Teste;extra;\n')
        with self.assertRaisesRegex(ValueError, 'invalid DER schedule'):
            read_departures(self.times)


if __name__ == '__main__':
    unittest.main()
