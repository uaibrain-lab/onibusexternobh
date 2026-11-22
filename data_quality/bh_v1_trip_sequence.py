"""Check municipal GTFS trip stop order during a single streaming ZIP scan.

The V1 catalogue builder requires contiguous stop_times rows per trip. Keep
only the last stop_sequence, departure time and count per trip in memory.
No routing, journeys, maps, GPS, RMBH, network calls or file writes.
"""
from __future__ import annotations


class TripSequenceAudit:
    """Detect schedules that can silently produce incorrect V1 stop arrivals."""

    def __init__(self, trip_ids):
        self.trip_ids = set(trip_ids)
        self.last = {}  # trip_id -> (stop_sequence, last_departure, count)
        self.previous_trip = None
        self.errors = set()
        self.rows = 0

    def add(self, trip_id, sequence, arrival, departure):
        """Consume one parsed stop_time row in original source-file order."""
        if trip_id not in self.trip_ids:
            self.errors.add('source_stop_time_orphan_trip')
            return
        if not all(type(n) is int for n in (sequence, arrival, departure)):
            self.errors.add('source_stop_sequence_or_time_invalid')
            return
        if sequence < 0 or arrival < 0 or departure < arrival:
            self.errors.add('source_stop_sequence_or_time_invalid')
            return
        previous = self.last.get(trip_id)
        if previous is not None:
            prev_sequence, prev_departure, count = previous
            if self.previous_trip != trip_id:
                # Mirrors update_gtfs.py's single contiguous trip block contract.
                self.errors.add('source_trip_noncontiguous_stop_times')
            if sequence <= prev_sequence:
                self.errors.add('source_stop_sequence_not_increasing')
            if arrival < prev_departure:
                self.errors.add('source_trip_times_not_monotonic')
        else:
            count = 0
        self.last[trip_id] = (sequence, departure, count + 1)
        self.previous_trip = trip_id
        self.rows += 1

    def report(self):
        missing = len(self.trip_ids - self.last.keys())
        short = sum(item[2] < 2 for item in self.last.values())
        if missing:
            self.errors.add('source_trips_without_stop_times')
        if short:
            self.errors.add('source_trips_with_fewer_than_two_stops')
        return {
            'tripRowsChecked': self.rows,
            'tripsChecked': len(self.last),
            'tripsWithoutStopTimes': missing,
            'tripsWithFewerThanTwoStops': short,
            'errors': sorted(self.errors),
        }
