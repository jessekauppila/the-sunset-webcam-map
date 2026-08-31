#!/usr/bin/env python3
"""Apply hard-negative emphasis to a training manifest, by row duplication.

The standing technique (pre-registered:
docs/superpowers/plans/2026-08-31-hard-negative-emphasis-experiment.md):
operator-N frames the current shipping detection head false-shows are
duplicated x(factor-1) extra times in the TRAIN manifest only. Duplication —
not a sampler or a weight column — so train.py stays byte-identical and the
candidate run differs from its baseline by exactly one thing.

The emphasis set comes from the per-frame dump of the audit:
  .venv/bin/python ml/audit_camera_errors.py --dump-frames frames.csv
i.e. it is mined by the model itself from operator labels — evidence, not
hand-curated camera lists — and re-derivable as labels accumulate.

Frames in the dump that are NOT in the train manifest are reported as the
held-out class set: that is where the class-effect half of the bar is
measured, so it must never be emphasized or trained on.

Usage:
  .venv/bin/python ml/apply_hard_negative_emphasis.py \
    --train-manifest <dataset>/manifest_train.csv \
    --frames frames.csv --factor 8 --out <dataset>/manifest_train_hne8.csv \
    --holdout-out <reports>/hne_holdout_frames.csv
"""

from __future__ import annotations

import argparse

import pandas as pd


def main() -> None:
    p = argparse.ArgumentParser(description="Duplicate mined hard negatives in a train manifest")
    p.add_argument("--train-manifest", required=True)
    p.add_argument("--frames", required=True,
                   help="per-frame CSV from audit_camera_errors.py --dump-frames")
    p.add_argument("--factor", type=int, default=8,
                   help="total copies of each emphasized row (1 original + factor-1 dupes)")
    p.add_argument("--out", required=True)
    p.add_argument("--holdout-out", default=None,
                   help="write the mined frames NOT in the train manifest here "
                        "(the held-out class-effect eval set)")
    args = p.parse_args()

    train = pd.read_csv(args.train_manifest)
    frames = pd.read_csv(args.frames)
    mined = frames[(frames.is_sunset == 0) & (frames.shown == 1)]
    print(f"  mined hard negatives (operator-N, shown by shipping head): {len(mined)}")

    train_ids = set(train.snapshot_id)
    in_train = mined[mined.snapshot_id.isin(train_ids)]
    holdout = mined[~mined.snapshot_id.isin(train_ids)]
    print(f"  in train manifest: {len(in_train)}  |  held out (class eval): {len(holdout)}")

    dupes = train[train.snapshot_id.isin(set(in_train.snapshot_id))]
    emphasized = pd.concat([train] + [dupes] * (args.factor - 1), ignore_index=True)
    # Deterministic shuffle so duplicates are not adjacent; train.py shuffles
    # per epoch anyway, but a sorted manifest makes eyeballing misleading.
    emphasized = emphasized.sample(frac=1.0, random_state=20260831).reset_index(drop=True)
    emphasized.to_csv(args.out, index=False)
    share = (len(dupes) * args.factor) / len(emphasized)
    print(f"  wrote {args.out}: {len(train)} -> {len(emphasized)} rows "
          f"(emphasized effective share {share:.1%})")

    if args.holdout_out:
        holdout.to_csv(args.holdout_out, index=False)
        print(f"  wrote {args.holdout_out}: {len(holdout)} held-out class frames")


if __name__ == "__main__":
    main()
