"""UBR3 binary GTFS shards must reproduce exact JSON trip semantics."""
import gzip
import hashlib
import os
import pathlib
import tempfile
import unittest

from transit.binary_trips import BinaryTripTable, encode_trip, MAGIC, StopSequence


class BinaryTripTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=pathlib.Path(self.temp.name)
        self.ids=('a','b','c')
        self.trip='000001'
        self.service='WK2026'
        self.headsign='Praça da Estação'
        self.stops=[
            ['a',3660,3661,0,1],
            ['b',3720,3730,1,0],
            ['c',3960,3960,0,0],
        ]
        self.encoded=encode_trip(self.trip,self.service,self.headsign,self.stops,
                                 {'a':0,'b':1,'c':2})
        self.file=self.root/'route.ubr3.gz'
        with gzip.open(self.file,'wb') as out:
            out.write(MAGIC+self.encoded)

    def tearDown(self):
        self.temp.cleanup()

    def test_exact_roundtrip_and_sequence(self):
        table=BinaryTripTable.read(self.file,self.ids)
        self.assertEqual(len(table),1)
        t,s,h,stops=table[0]
        self.assertEqual((t,s,h),(self.trip,self.service,self.headsign))
        self.assertEqual([list(v) for v in stops],self.stops)
        self.assertEqual([x[0] for x in reversed(stops)],['c','b','a'])
        self.assertEqual(stops[-1][0],'c')
        self.assertEqual([list(x) for x in stops[1:]],self.stops[1:])

    def test_compactness(self):
        self.assertEqual(len(self.encoded),
                         8+len(self.trip.encode())+len(self.service.encode())+
                         len(self.headsign.encode())+11*len(self.stops))

    def test_corrupt_and_mismatched_files_are_rejected(self):
        with gzip.open(self.file,'wb') as out:
            out.write(MAGIC+self.encoded[:-1])
        with self.assertRaisesRegex(ValueError,'truncada'):
            BinaryTripTable.read(self.file,self.ids)
        with gzip.open(self.file,'wb') as out:
            out.write(b'NOPE')
        with self.assertRaisesRegex(ValueError,'incompatível'):
            BinaryTripTable.read(self.file,self.ids)

    def test_rejects_invalid_boarding_policy(self):
        bad=[list(x) for x in self.stops]
        bad[0][3]=4
        with self.assertRaises(ValueError):
            encode_trip(self.trip,self.service,self.headsign,bad,
                        {'a':0,'b':1,'c':2})

    def test_multiple_trips_no_metadata_bleed(self):
        with gzip.open(self.file,'wb') as out:
            out.write(MAGIC)
            out.write(self.encoded)
            out.write(encode_trip('002','SUN','Cidade',self.stops,
                                  {'a':0,'b':1,'c':2}))
        rows=BinaryTripTable.read(self.file,self.ids)
        self.assertEqual(len(rows),2)
        self.assertEqual(rows[0][1],'WK2026')
        self.assertEqual(rows[1][1],'SUN')
        self.assertEqual(rows[1][3][2][0],'c')


if __name__=='__main__':
    unittest.main()
