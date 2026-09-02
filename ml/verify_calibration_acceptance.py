#!/usr/bin/env python3
"""Pre-registered acceptance test for per-camera calibration leg 1.

Clauses 1-3 and 7 of the spec's 8-clause bar. Clauses 4-6 and 8 are covered by
the TypeScript unit tests. Exits 1 if any clause fails.

If the multipliers differ from the recorded baseline, STOP and report — do not
adjust constants to make this pass. That would be tuning on the acceptance set,
the one forbidden move in this program.

Usage:
  .venv/bin/python ml/verify_calibration_acceptance.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg2

MODEL = "20260829_062437_v5_binary_gold"
PRIOR_K, MAX_TEMPER, MIN_MULT = 2.0, 0.5, 0.5
MIN_EVENTS, MIN_DAYS = 3, 2
WINDOW_DAYS, HALF_LIFE = 365, 90

GROUND_TRUTH = {4057187, 2947112, 29095214, 29275205}
OFFENDERS = {
    4057187, 2947112, 29095214, 29275205, 97, 3914190, 5961510, 160,
    28894257, 2051, 3236, 404, 3309592, 2972357, 29048102, 27660488, 29182812,
}


def load_env_local() -> None:
    env = Path(__file__).resolve().parent.parent / ".env.local"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def main() -> None:
    load_env_local()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(
        """
        SELECT webcam_id,
               SUM(CASE WHEN is_negative AND fired
                        THEN power(0.5, (current_date - captured_on)::numeric / %s)
                        ELSE 0 END),
               SUM(CASE WHEN is_negative
                        THEN power(0.5, (current_date - captured_on)::numeric / %s)
                        ELSE 0 END),
               COUNT(DISTINCT CASE WHEN is_negative AND fired THEN captured_on END),
               COUNT(*) FILTER (WHERE is_negative AND fired)
        FROM camera_calibration_evidence
        WHERE model_version = %s AND captured_on > current_date - %s
        GROUP BY webcam_id
        """,
        (HALF_LIFE, HALF_LIFE, MODEL, WINDOW_DAYS),
    )
    rows = cur.fetchall()

    def mult(fs, nn, days, raw):
        if raw < MIN_EVENTS or days < MIN_DAYS:
            return 1.0
        return max(
            MIN_MULT,
            min(1.0, 1.0 - MAX_TEMPER * (float(fs) / (float(nn) + PRIOR_K))),
        )

    tempered = {}
    for wid, fs, nn, days, raw in rows:
        m = mult(fs, nn, days, raw)
        if m < 1.0:
            tempered[wid] = m

    failures = []

    missing = GROUND_TRUTH - set(tempered)
    print(f"clause 1  ground truth tempers: {len(GROUND_TRUTH - missing)}/4")
    for g in sorted(GROUND_TRUTH):
        print(f"            {g}: {tempered.get(g, 1.0):.3f}")
    if missing:
        failures.append(f"clause 1 FAILED - not tempered: {sorted(missing)}")

    extra = set(tempered) - OFFENDERS
    print(f"clause 2  non-offenders tempered: {len(extra)} (must be 0)")
    if extra:
        failures.append(f"clause 2 FAILED - unexpected: {sorted(extra)}")

    print(f"clause 3  fleet bound: {len(tempered)} tempered (must be <= 25)")
    if len(tempered) > 25:
        failures.append(f"clause 3 FAILED - {len(tempered)} tempered")

    cur.execute(
        "SELECT count(*), count(DISTINCT snapshot_id) "
        "FROM camera_calibration_evidence WHERE model_version = %s",
        (MODEL,),
    )
    total, distinct = cur.fetchone()
    print(f"clause 7  retention: {total} rows, {distinct} distinct snapshots")
    if total != distinct:
        failures.append(
            f"clause 7 FAILED - {total} rows for {distinct} snapshots (duplicates)"
        )

    conn.close()

    print()
    if failures:
        for f in failures:
            print(f"  {f}")
        sys.exit(1)
    print("  ALL CHECKED CLAUSES PASS (1, 2, 3, 7)")


if __name__ == "__main__":
    main()
