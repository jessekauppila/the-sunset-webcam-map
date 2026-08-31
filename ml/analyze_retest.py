#!/usr/bin/env python3
"""Compute the operator's test–retest ceiling from a retest sample.

Joins manual_label_retests (second pass) to manual_labels (first pass) and
reports, with the pre-registered verdict from the quality-ceiling roadmap
(docs/superpowers/plans/2026-08-30-quality-ceiling-and-labeling-roadmap.md):

  detection — percent agreement, Cohen's kappa, and F1 of pass 2 read as
              predictions against pass 1
  quality   — Pearson + MAE on frames BOTH passes call a sunset, on the
              normalized (rating-1)/4 scale the model reports use
  6x6 confusion matrix over {N,1..5}, plus splits by original-label age and
  by the original label's origin

Verdict rule (pre-registered 2026-08-30 — do not re-tune after seeing data):
  gap = self_pearson - model_pearson (model = shipping quality head, 0.697
  on the pooled 500). gap <= 0.10 with n >= 40 pairs -> CEILING REACHED;
  gap > 0.10 -> HEADROOM, Phase 1 justified; n < 40 -> UNDERPOWERED.

Runs cleanly at any completion level of the sitting.

Usage:
  .venv/bin/python ml/analyze_retest.py --sample-name retest_v1
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import psycopg2


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


def cat(is_sunset: bool, rating) -> str:
    """Collapse a label to one of N,1..5 (a sunset with no rating -> '?')."""
    if not is_sunset:
        return "N"
    return str(rating) if rating is not None else "?"


def cohens_kappa(a: np.ndarray, b: np.ndarray) -> float:
    """Binary kappa; a, b are bool arrays."""
    po = float(np.mean(a == b))
    pe = float(np.mean(a) * np.mean(b) + np.mean(~a) * np.mean(~b))
    return (po - pe) / (1 - pe) if pe < 1 else 1.0


def f1(truth: np.ndarray, pred: np.ndarray) -> float:
    tp = int(np.sum(truth & pred))
    fp = int(np.sum(~truth & pred))
    fn = int(np.sum(truth & ~pred))
    return 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else 0.0


def quality_stats(pairs: list[tuple[int, int]]) -> dict:
    """pairs = (original rating, retest rating), 1..5 each."""
    if len(pairs) < 2:
        return {"n": len(pairs), "pearson": None, "mae": None}
    o = (np.array([p[0] for p in pairs], dtype=float) - 1) / 4
    t = (np.array([p[1] for p in pairs], dtype=float) - 1) / 4
    pearson = None
    if np.std(o) > 0 and np.std(t) > 0:
        pearson = float(np.corrcoef(o, t)[0, 1])
    return {"n": len(pairs), "pearson": pearson,
            "mae": float(np.mean(np.abs(o - t)))}


def main() -> None:
    p = argparse.ArgumentParser(description="Test–retest ceiling analysis")
    p.add_argument("--sample-name", required=True)
    p.add_argument("--model-pearson", type=float, default=0.697,
                   help="shipping quality head on the pooled 500 (the bar)")
    p.add_argument("--gap-threshold", type=float, default=0.10)
    p.add_argument("--stale-days", type=int, default=14)
    p.add_argument("--out", default=None,
                   help="JSON report path (default: ml/artifacts/reports/<sample>_ceiling.json)")
    args = p.parse_args()

    load_env_local()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        sys.exit("DATABASE_URL not set (looked in the environment and .env.local)")

    with psycopg2.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT m.is_sunset, m.rating, m.origin,
                       (m.labeled_at < r.labeled_at - %s * interval '1 day') AS stale,
                       r.is_sunset, r.rating
                FROM manual_label_retests r
                JOIN manual_labels m
                  ON m.source = r.source AND m.image_id = r.image_id
                WHERE r.origin = %s
                """,
                (args.stale_days, args.sample_name),
            )
            rows = cur.fetchall()
            cur.execute(
                "SELECT count(*) FROM label_samples WHERE sample_name = %s",
                (args.sample_name,),
            )
            sample_size = cur.fetchone()[0]

    n = len(rows)
    print(f"  {args.sample_name}: {n} / {sample_size} re-rated")
    if n == 0:
        sys.exit("  nothing to analyze yet")

    o_sun = np.array([r[0] for r in rows], dtype=bool)
    t_sun = np.array([r[4] for r in rows], dtype=bool)

    agreement = float(np.mean(o_sun == t_sun))
    kappa = cohens_kappa(o_sun, t_sun)
    det_f1 = f1(o_sun, t_sun)

    both_rated = [(r[1], r[5]) for r in rows
                  if r[0] and r[4] and r[1] is not None and r[5] is not None]
    q_all = quality_stats(both_rated)

    # Splits: original-label age relative to the retest, and original origin.
    q_stale = quality_stats([(r[1], r[5]) for r in rows
                             if r[3] and r[0] and r[4]
                             and r[1] is not None and r[5] is not None])
    q_fresh = quality_stats([(r[1], r[5]) for r in rows
                             if not r[3] and r[0] and r[4]
                             and r[1] is not None and r[5] is not None])
    by_origin: dict[str, int] = {}
    for r in rows:
        by_origin[r[2]] = by_origin.get(r[2], 0) + 1

    cats = ["N", "1", "2", "3", "4", "5"]
    confusion = {oc: {tc: 0 for tc in cats} for oc in cats}
    for r in rows:
        oc, tc = cat(r[0], r[1]), cat(r[4], r[5])
        if oc in confusion and tc in confusion[oc]:
            confusion[oc][tc] += 1

    print(f"  detection: agreement {agreement:.3f}, kappa {kappa:.3f}, "
          f"self-F1 {det_f1:.3f}  (n={n})")
    pearson_txt = "n/a" if q_all["pearson"] is None else f"{q_all['pearson']:.3f}"
    mae_txt = "n/a" if q_all["mae"] is None else f"{q_all['mae']:.3f}"
    print(f"  quality:   self-Pearson {pearson_txt}, MAE {mae_txt}  (n={q_all['n']})")
    for name, q in (("stale originals", q_stale), ("fresh originals", q_fresh)):
        ptxt = "n/a" if q["pearson"] is None else f"{q['pearson']:.3f}"
        print(f"             {name}: Pearson {ptxt} (n={q['n']})")
    print(f"  originals by origin: {by_origin}")
    print("  confusion (rows = pass 1, cols = pass 2):")
    print("      " + "  ".join(f"{c:>3}" for c in cats))
    for oc in cats:
        print(f"   {oc:>2} " + "  ".join(f"{confusion[oc][tc]:>3}" for tc in cats))

    verdict = "UNDERPOWERED — finish the sitting (need n >= 40 quality pairs)"
    gap = None
    if q_all["pearson"] is not None and q_all["n"] >= 40:
        gap = q_all["pearson"] - args.model_pearson
        verdict = (
            f"CEILING REACHED (gap {gap:+.3f} <= {args.gap_threshold}) — failure-mode track"
            if gap <= args.gap_threshold
            else f"HEADROOM (gap {gap:+.3f} > {args.gap_threshold}) — Phase 1 justified"
        )
    print(f"  VERDICT: {verdict}")

    out = Path(args.out) if args.out else (
        Path(__file__).resolve().parent / "artifacts" / "reports"
        / f"{args.sample_name}_ceiling.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "sample": args.sample_name, "rated": n, "sample_size": sample_size,
        "detection": {"agreement": agreement, "kappa": kappa, "self_f1": det_f1},
        "quality": q_all,
        "quality_stale_originals": q_stale,
        "quality_fresh_originals": q_fresh,
        "originals_by_origin": by_origin,
        "confusion": confusion,
        "model_pearson": args.model_pearson,
        "gap": gap,
        "verdict": verdict,
    }, indent=2))
    print(f"  report: {out.relative_to(Path.cwd()) if out.is_relative_to(Path.cwd()) else out}")


if __name__ == "__main__":
    main()
