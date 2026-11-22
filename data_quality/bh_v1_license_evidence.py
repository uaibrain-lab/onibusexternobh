"""Offline, fail-closed evidence gate for municipal GTFS redistribution rights."""
from __future__ import annotations
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

SHA = re.compile(r'[0-9a-f]{64}\Z')

def audit(catalog: Path, evidence: Path):
    """Evidence is an independently reviewed assertion, never a license inference."""
    errors = []
    root = Path(catalog)
    try:
        digest = (root / 'source-gtfs.sha256').read_text(encoding='utf-8').strip()
    except OSError:
        digest = None
    if not isinstance(digest, str) or not SHA.fullmatch(digest):
        errors.append('source_sha256_missing_or_invalid')
    try:
        data = json.loads(Path(evidence).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        data = None
        errors.append('evidence_missing_or_invalid')
    if not isinstance(data, dict):
        data = {}
        if 'evidence_missing_or_invalid' not in errors:
            errors.append('evidence_missing_or_invalid')
    if data.get('sourceSha256') != digest or not isinstance(data.get('sourceSha256'), str):
        errors.append('evidence_snapshot_hash_mismatch')
    if data.get('redistributionPermitted') is not True:
        errors.append('redistribution_permission_not_confirmed')
    for field in ('sourceUrl', 'licenseUrl'):
        value = data.get(field)
        try:
            parts = urlsplit(value) if isinstance(value, str) else None
            valid = bool(parts and parts.scheme == 'https' and parts.netloc and not parts.username and not parts.password)
        except ValueError:
            valid = False
        if not valid:
            errors.append(field + '_missing_or_invalid')
    if not isinstance(data.get('reviewedOn'), str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', data['reviewedOn']):
        errors.append('review_date_missing_or_invalid')
    else:
        import datetime as dt
        try:
            review_date = dt.date.fromisoformat(data['reviewedOn'])
            if review_date > dt.date.today():
                errors.append('review_date_in_future')
        except ValueError:
            errors.append('review_date_missing_or_invalid')
    if not isinstance(data.get('reviewer'), str) or not data['reviewer'].strip():
        errors.append('reviewer_missing')
    return {'status': 'blocked' if errors else 'pass', 'sourceSha256': digest,
            'licenseEvidenceComplete': not errors, 'errors': sorted(set(errors)),
            'note': 'Evidence assertion only; links and legal terms require independent human verification.'}

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('catalog', type=Path)
    p.add_argument('--evidence', type=Path, required=True)
    args = p.parse_args(argv)
    report = audit(args.catalog, args.evidence)
    print(json.dumps(report, sort_keys=True, ensure_ascii=False))
    return 2 if report['status'] == 'blocked' else 0

if __name__ == '__main__':
    raise SystemExit(main())
