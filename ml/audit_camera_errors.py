#!/usr/bin/env python3
"""Per-camera error audit: which cameras systematically fool the shipping pair?

Scores EVERY operator-labeled webcam frame through the shipping ONNX pair
(the verified score_manifest preprocessing — archived ai_regression_score is
mostly v4-era and says nothing about the current heads) and aggregates errors
by camera. Motivated by webcam 3656741 putting two N frames in the v2
confirmation's top-8 tiles an hour apart.

Error classes, composed exactly as production composes (gate x quality):
  false_show      operator N, p_sunset >= gate            (shown at all)
  big_false_show  operator N, tile >= --big-tile          (shown LARGE)
  miss4           operator rating >= 4, p_sunset < gate   (a showcase frame hidden)

A camera is an OFFENDER only with repeated evidence: >= --min-events errors
across >= --min-days distinct capture days. One bad frame is noise — the
same standard that caught three non-replicating detection "wins."

Population caveat: manual_labels is dominated by hard-example draws (the
v4-era disagreement queue), so rates are NOT production rates; the audit
ranks cameras against each other on the same biased population.

Usage:
  .venv/bin/python ml/audit_camera_errors.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import onnxruntime as ort
import psycopg2

sys.path.insert(0, str(Path(__file__).resolve().parent))
from score_manifest import load_image, softmax_positive  # noqa: E402

BINARY_DEFAULT = "ml/artifacts/models/binary_resnet18/20260829_062437_v5_binary_gold/model.onnx"
QUALITY_DEFAULT = (
    "ml/artifacts/models/regression_resnet18/"
    "20260830_190519_v5_quality_llm_backbone_finetune/model.onnx"
)


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
    p = argparse.ArgumentParser(description="Per-camera error audit vs operator truth")
    p.add_argument("--gate", type=float, default=0.55)
    p.add_argument("--big-tile", type=float, default=0.5)
    p.add_argument("--min-events", type=int, default=3)
    p.add_argument("--min-days", type=int, default=2)
    p.add_argument("--binary-onnx", default=BINARY_DEFAULT)
    p.add_argument("--quality-onnx", default=QUALITY_DEFAULT)
    p.add_argument("--cache-dir", default="ml/artifacts/image_cache")
    p.add_argument("--limit", type=int, default=None, help="frame cap, for smoke runs")
    p.add_argument("--dump-frames", default=None,
                   help="also write per-frame scores to this CSV (the input for "
                        "hard-negative mining — see the 2026-08-31 emphasis plan)")
    args = p.parse_args()

    load_env_local()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(
        """
        SELECT s.id, s.webcam_id, m.is_sunset, m.rating,
               s.captured_at::date, s.firebase_url,
               COALESCE(w.title,''), COALESCE(w.city,''), COALESCE(w.country,'')
        FROM manual_labels m
        JOIN webcam_snapshots s ON s.id = m.image_id
        LEFT JOIN webcams w ON w.id = s.webcam_id
        WHERE m.source = 'webcam' AND s.firebase_url IS NOT NULL
        ORDER BY s.id
        """
    )
    frames = cur.fetchall()
    conn.close()
    if args.limit:
        frames = frames[: args.limit]
    print(f"  scoring {len(frames)} labeled frames through the shipping pair…")

    bsess = ort.InferenceSession(args.binary_onnx)
    qsess = ort.InferenceSession(args.quality_onnx)
    bin_name = bsess.get_inputs()[0].name
    q_name = qsess.get_inputs()[0].name
    cache = Path(args.cache_dir)
    cache.mkdir(parents=True, exist_ok=True)

    cams: dict[int, dict] = defaultdict(lambda: dict(
        n=0, n_N=0, n_ge4=0, false_shows=0, big_false_shows=0, miss4=0,
        fs_days=set(), miss_days=set(), tile_sum_N=0.0,
        meta="", worst=[],  # (tile, snapshot_id, url) for op-N frames shown
    ))
    skipped = 0
    dump_rows = []
    for i, (sid, wid, is_sunset, rating, day, url, title, city, country) in enumerate(frames):
        if i and i % 1000 == 0:
            print(f"  …{i}/{len(frames)} (skipped {skipped})")
        arr = load_image(str(url), cache)
        if arr is None:
            skipped += 1
            continue
        p_sun = softmax_positive(
            np.asarray(bsess.run(None, {bin_name: arr})[0][0], dtype=np.float32))
        q = float(np.asarray(qsess.run(None, {q_name: arr})[0]).squeeze())
        shown = p_sun >= args.gate
        tile = q if shown else 0.0
        if args.dump_frames:
            dump_rows.append((sid, wid, int(bool(is_sunset)),
                              "" if rating is None else rating, str(day),
                              round(p_sun, 4), round(q, 4), int(shown),
                              round(tile, 4), url))

        c = cams[wid]
        c["n"] += 1
        c["meta"] = " · ".join(x for x in (title[:40], city, country) if x)
        if not is_sunset:
            c["n_N"] += 1
            c["tile_sum_N"] += tile
            if shown:
                c["false_shows"] += 1
                c["fs_days"].add(str(day))
                c["worst"].append((round(tile, 3), sid, url))
            if tile >= args.big_tile:
                c["big_false_shows"] += 1
        elif rating is not None and rating >= 4:
            c["n_ge4"] += 1
            if not shown:
                c["miss4"] += 1
                c["miss_days"].add(str(day))

    def offender_rows(kind: str):
        rows = []
        for wid, c in cams.items():
            if kind == "false_show":
                events, days = c["false_shows"], len(c["fs_days"])
                if events >= args.min_events and days >= args.min_days:
                    rows.append(dict(
                        webcam_id=wid, meta=c["meta"], labeled=c["n"], n_N=c["n_N"],
                        false_shows=events, big_false_shows=c["big_false_shows"],
                        distinct_days=days,
                        fs_rate=round(events / max(c["n_N"], 1), 2),
                        mean_tile_on_N=round(c["tile_sum_N"] / max(c["n_N"], 1), 3),
                        sample_frames=[dict(tile=t, snapshot_id=s, url=u)
                                       for t, s, u in sorted(c["worst"], reverse=True)[:3]],
                    ))
            else:
                events, days = c["miss4"], len(c["miss_days"])
                if events >= 2 and days >= args.min_days:
                    rows.append(dict(
                        webcam_id=wid, meta=c["meta"], labeled=c["n"],
                        n_ge4=c["n_ge4"], miss4=events, distinct_days=days,
                    ))
        key = "big_false_shows" if kind == "false_show" else "miss4"
        return sorted(rows, key=lambda r: (r.get(key, 0), r.get("false_shows", 0)),
                      reverse=True)

    show_offenders = offender_rows("false_show")
    miss_offenders = offender_rows("miss")

    total_N = sum(c["n_N"] for c in cams.values())
    total_fs = sum(c["false_shows"] for c in cams.values())
    total_big = sum(c["big_false_shows"] for c in cams.values())
    print(f"\n  frames scored: {len(frames) - skipped} (skipped {skipped}), "
          f"cameras: {len(cams)}")
    print(f"  operator-N frames: {total_N}; shown {total_fs} "
          f"({total_fs / max(total_N,1):.1%}), shown BIG {total_big} "
          f"({total_big / max(total_N,1):.1%})")
    conc = sum(r["false_shows"] for r in show_offenders)
    print(f"  false-shows concentrated in {len(show_offenders)} offender cameras: "
          f"{conc}/{total_fs} ({conc / max(total_fs,1):.0%})")
    print(f"\n  top false-show offenders (>= {args.min_events} events, "
          f">= {args.min_days} days):")
    for r in show_offenders[:15]:
        print(f"    cam {r['webcam_id']:>8}  fs {r['false_shows']:>3} "
              f"(big {r['big_false_shows']:>3}) over {r['distinct_days']:>2}d  "
              f"rate {r['fs_rate']:>5}  meanTileN {r['mean_tile_on_N']:>5}  {r['meta']}")
    print(f"\n  top >=4-miss cameras (silhouette candidates):")
    for r in miss_offenders[:10]:
        print(f"    cam {r['webcam_id']:>8}  miss4 {r['miss4']} / {r['n_ge4']} "
              f"over {r['distinct_days']}d  {r['meta']}")

    if args.dump_frames:
        import csv
        with open(args.dump_frames, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["snapshot_id", "webcam_id", "is_sunset", "rating", "day",
                        "p_sunset", "quality", "shown", "tile", "url"])
            w.writerows(dump_rows)
        print(f"  per-frame dump: {args.dump_frames} ({len(dump_rows)} rows)")

    out = Path("ml/artifacts/reports/camera_error_audit_v1.json")
    out.write_text(json.dumps(dict(
        gate=args.gate, big_tile=args.big_tile,
        min_events=args.min_events, min_days=args.min_days,
        binary_onnx=args.binary_onnx, quality_onnx=args.quality_onnx,
        frames_scored=len(frames) - skipped, skipped=skipped,
        cameras=len(cams), operator_N=total_N,
        false_shows=total_fs, big_false_shows=total_big,
        offenders=show_offenders, miss_offenders=miss_offenders,
    ), indent=2))
    print(f"\n  report: {out}")


if __name__ == "__main__":
    main()
