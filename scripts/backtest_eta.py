#!/usr/bin/env python3
"""Audit labelled arrivals in JSONL; NEVER equate GPS position with arrival."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from transit.eta_quality import summarize


def main():
    parser=argparse.ArgumentParser(description='Medir erros usando chegadas observadas independentemente')
    parser.add_argument('observacoes', type=Path, help='JSONL: {actualAt, predictedAt ou null}')
    args=parser.parse_args()
    with args.observacoes.open(encoding='utf-8') as fp:
        rows=(json.loads(line) for line in fp if line.strip())
        report=summarize(rows)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if report['predictionsEvaluated']==0:
        print('Sem pares reais de previsão e chegada: precisão não validada.',file=sys.stderr)
        return 2
    return 0

if __name__=='__main__':sys.exit(main())
