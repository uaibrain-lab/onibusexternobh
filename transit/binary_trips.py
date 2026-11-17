"""Compact, read-only GTFS trip shards, using only the Python standard library.

Format UBR3: header b'UBR3', then for each trip a fixed metadata header
<uint16 trip_id_bytes, uint16 service_bytes, uint16 headsign_bytes,
 uint16 stop_count>, UTF-8 metadata bytes and stop_count packed records
<uint16 stop_index, uint32 arrival_seconds, uint32 departure_seconds,
 uint8 pickup/dropoff flags>. Each record is 11 bytes. Stops are indexed
by sorted stop_id keys of the matching routing-stops.json and SHA256 checked
at load time by JourneyPlanner. The gzip wrapper is only transport storage.
"""
from __future__ import annotations

import gzip
import struct
from collections.abc import Sequence

MAGIC=b'UBR3'
TRIP_HDR=struct.Struct('<HHHH')
STOP_REC=struct.Struct('<HIIB')
STOP_SIZE=STOP_REC.size
MAX_ROUTE_BYTES=80000000


class StopSequence(Sequence):
    __slots__=('blob','offset','count','ids')

    def __init__(self,blob,offset,count,ids):
        self.blob=blob
        self.offset=offset
        self.count=count
        self.ids=ids

    def __len__(self):
        return self.count

    def __getitem__(self,key):
        if isinstance(key,slice):
            return [self[i] for i in range(*key.indices(self.count))]
        if not isinstance(key,int):
            raise TypeError('Stop index must be an integer')
        if key<0:
            key+=self.count
        if not 0<=key<self.count:
            raise IndexError(key)
        index,arrive,depart,flags=STOP_REC.unpack_from(
            self.blob,self.offset+key*STOP_SIZE)
        return (self.ids[index],arrive,depart,flags&3,(flags>>2)&3)


class BinaryTripTable(Sequence):
    __slots__=('blob','entries','stop_ids')

    def __init__(self,blob,entries,stop_ids):
        self.blob=blob
        self.entries=entries
        self.stop_ids=stop_ids

    def __len__(self):
        return len(self.entries)

    def __getitem__(self,key):
        if isinstance(key,slice):
            return [self[i] for i in range(*key.indices(len(self.entries)))]
        trip,service,headsign,offset,count=self.entries[key]
        return (trip,service,headsign,StopSequence(
            self.blob,offset,count,self.stop_ids))

    @classmethod
    def read(cls,path,stop_ids):
        with gzip.open(path,'rb') as stream:
            blob=stream.read(MAX_ROUTE_BYTES+1)
        if len(blob)>MAX_ROUTE_BYTES:
            raise ValueError('Arquivo de viagens ultrapassa limite de 80 MB')
        if blob[:4]!=MAGIC:
            raise ValueError('Índice binário incompatível')
        entries=[]
        at=4
        n=len(blob)
        while at<n:
            if n-at<TRIP_HDR.size:
                raise ValueError('Cabeçalho de viagem truncado')
            ti,sv,hs,count=TRIP_HDR.unpack_from(blob,at)
            at+=TRIP_HDR.size
            meta_end=at+ti+sv+hs
            stops_end=meta_end+count*STOP_SIZE
            if count<2 or stops_end>n:
                raise ValueError('Viagem binária truncada')
            trip=blob[at:at+ti].decode('utf-8')
            service=blob[at+ti:at+ti+sv].decode('utf-8')
            headsign=blob[at+ti+sv:meta_end].decode('utf-8')
            if not trip or not service:
                raise ValueError('Viagem binária sem ID ou serviço')
            entries.append((trip,service,headsign,meta_end,count))
            at=stops_end
        return cls(blob,entries,stop_ids)


def encode_trip(trip,service,headsign,stops,stop_indices):
    """Validate and encode one trip; never silently modify stop order."""
    headers=[str(trip).encode('utf-8'),str(service).encode('utf-8'),
             str(headsign).encode('utf-8')]
    if any(len(x)>65535 for x in headers) or len(stops)>65535 or len(stops)<2:
        raise ValueError('Identificadores ou quantidade de paradas fora do limite')
    result=bytearray(TRIP_HDR.pack(*(len(x) for x in headers),len(stops)))
    for field in headers:
        result.extend(field)
    for stop,arr,dep,pickup,dropoff in stops:
        index=stop_indices[stop]
        if not (0<=index<=65535 and 0<=arr<=172800 and 0<=dep<=172800
                and 0<=pickup<=3 and 0<=dropoff<=3):
            raise ValueError('Registro GTFS fora do formato UBR3')
        result.extend(STOP_REC.pack(index,arr,dep,pickup|(dropoff<<2)))
    return bytes(result)
