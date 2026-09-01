#!/usr/bin/env python3
"""Overwrite gold labels that a blind second pass overturned, with an audit trail.

Why this exists
---------------
`retest_v1` (Phase 0 of the quality-ceiling roadmap) re-served already-rated
frames blind to measure the operator's test-retest ceiling. It also surfaced a
contaminated cohort: of the 24 WEBCAM frames the 2026-08-08 session rated as
sunsets, **all 24 came back lower on the second pass and none held**, while
that same session's 452 webcam N labels are ~94% stable. Seven of the eight
frames it rated `4` came back `N`, and they are not borderline — one has no
sky in frame at all. Claude, a wholly independent instrument, calls 23 of the
24 not-a-sunset.

So the first pass is the wrong one, and the second pass already contains the
right answer. No new labeling sitting is needed: this script copies the retest
ratings onto the gold rows.

Scope discipline
----------------
This is small on purpose. It corrects **24 labels of 9,118**, 10 of which
cross the `rating >= 4` line that training actually sees (0.8% of the 1,237
webcam `>= 4` gold labels). Do NOT expect a metric to move, and do not claim
one did — the standing rule is that a change this size is invisible against
single-seed noise. It is worth doing because the labels are demonstrably
wrong and the corrections are already paid for, not because it buys accuracy.

Deliberately NOT corrected: the same session's 80 **Flickr** positives (76 of
them rated 5). The retest drew webcam frames only, so there is zero evidence
about those, and a curated Flickr sunset photo rated 5 is most likely correct.
Never extend this to frames no second pass has actually seen.

Safety
------
`manual_labels` is UNIQUE(source, image_id) with an ON CONFLICT DO UPDATE
write path, so a correction destroys the prior row. Every overwrite is
archived into `manual_label_supersessions` FIRST, in the same transaction
(migration 20260831_manual_label_supersessions.sql). Dry-run is the default;
`--apply` is required to write. The script refuses to touch any frame that
does not have a second-pass rating, so it can never invent a correction.

Usage:
  .venv/bin/python ml/apply_label_corrections.py --from-retest retest_v1 \
      --cohort-day 2026-08-08 --positives-only          # dry run, prints the diff
  .venv/bin/python ml/apply_label_corrections.py --from-retest retest_v1 \
      --cohort-day 2026-08-08 --positives-only --apply
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg2
import psycopg2.extras


def load_env_local() -> None:
    """Match run_training.py: DATABASE_URL lives in .env.local, not the shell."""
    env = Path(__file__).resolve().parent.parent / ".env.local"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("\"").strip("'"))


def cat(is_sunset: bool, rating) -> str:
    """Collapse a label to one of N,1..5 — the operator's actual vocabulary."""
    if not is_sunset:
        return "N"
    return str(rating) if rating is not None else "?"


def crosses_positive_threshold(before: str, after: str) -> bool:
    """Did the label the BINARY head trains on (rating >= 4) change?

    The other transitions are real but free: 4<->5 and 2<->3 never cross a
    training threshold, so they cost the model nothing.
    """
    return (before in ("4", "5")) != (after in ("4", "5"))


def crosses_detection(before: str, after: str) -> bool:
    """Did the label the DETECTION head trains on (is_sunset) change?"""
    return (before == "N") != (after == "N")


SELECT_TARGETS = """
    SELECT m.source,
           m.image_id,
           m.is_sunset      AS old_is_sunset,
           m.rating         AS old_rating,
           m.origin         AS old_origin,
           m.labeled_at     AS old_labeled_at,
           r.is_sunset      AS new_is_sunset,
           r.rating         AS new_rating
    FROM manual_labels m
    LEFT JOIN manual_label_retests r
      ON r.source = m.source AND r.image_id = m.image_id AND r.origin = %(retest)s
    WHERE m.labeled_at >= %(day)s::date
      AND m.labeled_at <  %(day)s::date + 1
      AND m.source = %(source)s
      {positives_clause}
    ORDER BY m.rating NULLS FIRST, m.image_id
"""


def main() -> None:
    p = argparse.ArgumentParser(description="Apply second-pass corrections to gold labels")
    p.add_argument("--from-retest", required=True,
                   help="retest campaign holding the corrected ratings, e.g. retest_v1")
    p.add_argument("--cohort-day", required=True,
                   help="label a whole labeling session by its date, e.g. 2026-08-08")
    p.add_argument("--source", default="webcam", choices=["webcam", "flickr"])
    p.add_argument("--positives-only", action="store_true",
                   help="only correct rows the cohort marked as sunsets (the "
                        "evidenced failure); N labels from the same session are "
                        "~94%% stable and are left alone")
    p.add_argument("--reason", default=None,
                   help="stored on every archive row; defaults to a description "
                        "of the retest evidence")
    p.add_argument("--apply", action="store_true",
                   help="actually write. Without it this is a dry run.")
    args = p.parse_args()

    load_env_local()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        sys.exit("DATABASE_URL not set (looked in the environment and .env.local)")

    new_origin = f"correction_{args.from_retest}"
    reason = args.reason or (
        f"{args.cohort_day} session positives overturned by {args.from_retest}: "
        "every retested positive from that session came back lower, while the "
        "same session's N labels held ~94%"
    )

    query = SELECT_TARGETS.format(
        positives_clause="AND m.is_sunset" if args.positives_only else ""
    )

    conn = psycopg2.connect(database_url)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(query, {"retest": args.from_retest,
                                "day": args.cohort_day,
                                "source": args.source})
            rows = cur.fetchall()

        if not rows:
            sys.exit(f"  no {args.source} rows in the {args.cohort_day} cohort — nothing to do")

        missing = [r for r in rows if r["new_is_sunset"] is None]
        targets = [r for r in rows if r["new_is_sunset"] is not None]

        print(f"  cohort {args.cohort_day} / source {args.source}"
              f"{' / positives only' if args.positives_only else ''}: {len(rows)} rows")
        print(f"  with a '{args.from_retest}' second-pass rating: {len(targets)}")
        if missing:
            # Refuse rather than silently correcting a subset: a partial cohort
            # rewrite is the kind of thing nobody notices until an export is
            # already trained on it.
            sys.exit(
                f"  ABORT: {len(missing)} of {len(rows)} rows have no "
                f"'{args.from_retest}' rating (e.g. image_id "
                f"{missing[0]['image_id']}). This script never invents a "
                f"correction — narrow the cohort, or run the sitting first."
            )

        unchanged = [r for r in targets
                     if cat(r["old_is_sunset"], r["old_rating"])
                     == cat(r["new_is_sunset"], r["new_rating"])]
        changed = [r for r in targets if r not in unchanged]

        print(f"\n  {'snapshot':>9}  {'was':>4} -> {'now':>4}   effect on training labels")
        n_pos = n_det = 0
        for r in targets:
            before = cat(r["old_is_sunset"], r["old_rating"])
            after = cat(r["new_is_sunset"], r["new_rating"])
            effects = []
            if crosses_detection(before, after):
                effects.append("is_sunset FLIPS")
                n_det += 1
            if crosses_positive_threshold(before, after):
                effects.append("rating>=4 FLIPS")
                n_pos += 1
            mark = "" if effects else ("(no change)" if before == after else "(within class)")
            print(f"  {r['image_id']:>9}  {before:>4} -> {after:>4}   "
                  f"{', '.join(effects) or mark}")

        print(f"\n  {len(changed)} labels change, {len(unchanged)} identical")
        print(f"  crossing is_sunset: {n_det}    crossing rating>=4: {n_pos}")
        print(f"  new origin stamp: {new_origin}")

        if not args.apply:
            print("\n  DRY RUN — nothing written. Re-run with --apply to commit.")
            return

        # Archive-then-update in ONE transaction: if the update fails, the
        # archive row must not survive claiming a supersession that never
        # happened, and vice versa.
        with conn:
            with conn.cursor() as cur:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO manual_label_supersessions
                      (source, image_id, old_is_sunset, old_rating, old_origin,
                       old_labeled_at, new_is_sunset, new_rating, new_origin, reason)
                    VALUES %s
                    """,
                    [(r["source"], r["image_id"], r["old_is_sunset"], r["old_rating"],
                      r["old_origin"], r["old_labeled_at"], r["new_is_sunset"],
                      r["new_rating"], new_origin, reason) for r in targets],
                )
                archived = cur.rowcount
                for r in targets:
                    cur.execute(
                        """
                        UPDATE manual_labels
                        SET is_sunset = %s, rating = %s, origin = %s, labeled_at = now()
                        WHERE source = %s AND image_id = %s
                        """,
                        (r["new_is_sunset"], r["new_rating"], new_origin,
                         r["source"], r["image_id"]),
                    )

        # Read back rather than trusting rowcount — the point of the exercise is
        # that gold now says something different, so prove it does.
        with conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM manual_labels WHERE origin = %s", (new_origin,)
            )
            stamped = cur.fetchone()[0]
            cur.execute(
                "SELECT count(*) FROM manual_label_supersessions WHERE new_origin = %s",
                (new_origin,),
            )
            in_archive = cur.fetchone()[0]

        print(f"\n  APPLIED: {len(targets)} rows corrected")
        print(f"  manual_labels stamped '{new_origin}': {stamped}")
        print(f"  archive rows in manual_label_supersessions: {in_archive}")
        if stamped < len(targets) or in_archive < len(targets):
            sys.exit("  WARNING: read-back count is short — inspect before trusting this run")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
