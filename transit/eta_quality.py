"""Offline ETA evaluation against *independently observed* stop arrivals.

This is intentionally separate from the estimator: a prediction is NOT a real
arrival. No quality metric is published without observed arrival timestamps.
"""
from __future__ import annotations
import datetime as dt
import math
import statistics


def _date(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


def summarize(rows):
    """Rows: {actualAt: ISO8601, predictedAt: ISO8601 or null}.

    Never fabricate observed arrival events. A missing predictedAt counts
    against coverage, but has no calculable error.
    """
    eligible = 0
    errors = []
    missing = 0
    invalid = 0
    for row in rows:
        if not isinstance(row, dict):
            invalid += 1
            continue
        actual = _date(row.get('actualAt'))
        if not actual:
            invalid += 1
            continue
        eligible += 1
        if not row.get('predictedAt'):
            missing += 1
            continue
        predicted = _date(row.get('predictedAt'))
        if not predicted:
            invalid += 1
            missing += 1
            continue
        delta = (predicted - actual).total_seconds()/60
        if not math.isfinite(delta) or abs(delta) > 60*24:
            invalid += 1
            missing += 1
            continue
        errors.append(delta)
    abs_errors = sorted(abs(v) for v in errors)
    p90 = (abs_errors[max(0, math.ceil(len(abs_errors)*0.90)-1)] if abs_errors else None)
    return {'observedArrivals': eligible, 'predictionsEvaluated':len(errors),
            'predictionsMissing':missing, 'invalidRows':invalid,
            'coveragePct':round(100*len(errors)/eligible,1) if eligible else None,
            'maeMinutes':round(statistics.mean(abs_errors),2) if abs_errors else None,
            'medianErrorMinutes':round(statistics.median(abs_errors),2) if abs_errors else None,
            'p90ErrorMinutes':round(p90,2) if p90 is not None else None,
            'signedBiasMinutes':round(statistics.mean(errors),2) if errors else None,
            'fieldAccuracyVerified':bool(errors)}
