"""Read-only municipal GTFS validity alerts; stdlib only, no network."""
from __future__ import annotations
import argparse
import datetime as dt
import json
import re
from pathlib import Path

DATE = re.compile(r"[0-9]{8}\Z")

def parse_date(value):
    if not isinstance(value, str) or not DATE.fullmatch(value):
        raise ValueError("invalid YYYYMMDD")
    return dt.datetime.strptime(value, "%Y%m%d").date()

def audit(catalog, today, warning_days=14):
    """Fail closed on expired/invalid feed, warn near expiry; no invented update ETA."""
    if not isinstance(warning_days, int) or isinstance(warning_days, bool) or warning_days < 0:
        raise ValueError("warning_days must be a nonnegative integer")
    day = parse_date(today)
    root = Path(catalog)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    errors, warnings = [], []
    start_raw, end_raw = manifest.get("feedStartDate"), manifest.get("feedEndDate")
    try:
        start, end = parse_date(start_raw), parse_date(end_raw)
        if start > end:
            errors.append("invalid_feed_date_range")
        remaining = (end - day).days
        if day < start:
            errors.append("feed_not_yet_valid")
        if remaining < 0:
            errors.append("feed_expired")
        elif remaining <= warning_days:
            warnings.append("feed_expiring_within_warning_window")
    except (ValueError, TypeError):
        errors.append("invalid_feed_date_range")
        remaining = None
    digest = root / "source-gtfs.sha256"
    sha = digest.read_text(encoding="utf-8").strip() if digest.is_file() else None
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
        errors.append("source_hash_missing_or_invalid")
    return {"status": "blocked" if errors else "warning" if warnings else "pass",
            "date": today, "feedStartDate": start_raw, "feedEndDate": end_raw,
            "daysUntilExpiry": remaining, "sourceSha256": sha,
            "errors": sorted(errors), "warnings": sorted(warnings),
            "updateDetected": None, "licenseVerified": False,
            "note": "Offline validity only; update detection requires comparing official snapshots; license must be verified independently."}

def main(argv=None):
    p = argparse.ArgumentParser(description="Offline BH municipal GTFS validity alert")
    p.add_argument("catalog", type=Path)
    p.add_argument("--date", required=True)
    p.add_argument("--warning-days", type=int, default=14)
    args = p.parse_args(argv)
    result = audit(args.catalog, args.date, args.warning_days)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 2 if result["status"] == "blocked" else 0

if __name__ == "__main__":
    raise SystemExit(main())
