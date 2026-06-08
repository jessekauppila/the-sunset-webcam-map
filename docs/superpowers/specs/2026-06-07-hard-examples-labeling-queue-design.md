---
title: "Hard Examples — unified labeling queue (manual gold labels for v5)"
date: 2026-06-07
status: spec
supersedes_ui: "the read-only Verification tab (PR #47) folds into this"
---

# Hard Examples — unified labeling queue

## Problem & goal

The three-judge backfill flagged **~7,286 disagreement frames** (webcam archive +
Flickr) where the v4 model and Claude — or the two model heads — split on
"is this a sunset?". These are the hard / ambiguous cases: the highest-value data
to hand-label for **v5 training** (this is *hard-example mining* / *active
learning* — labeling the samples the model is most uncertain about).

Today there is no way to capture those labels at the needed speed/coverage:
- The **Hard Examples** queue captures verdicts but only for **webcam** frames,
  **blind**, and writes `is_sunset_verdict` into `webcam_snapshot_ratings`
  (the public crowd-ratings table, FK'd to `webcam_snapshots` — Flickr can't go
  there).
- The **Verification** tab (PR #47) shows webcam + Flickr with the judges, but is
  **read-only**.

**Goal:** one fast, keyboard-driven labeling queue over both sources that produces
a clean **operator gold-label set** for v5, while letting the operator confirm the
frames really are hard.

## Non-goals
- Crowd / multi-user ratings (that idea is retired; the only labels are the
  operator's).
- Exact training-set membership (the v4 manifest cross-reference) — v1 uses a
  capture-date approximation for the provenance badge (see Provenance).
- Re-scoring or model changes — the scores already exist from the backfill.

## Design overview

One operator tab, **"Hard Examples"** (kept — the name is the correct ML framing).
It unifies and replaces today's Hard Examples queue *and* the read-only
Verification tab. Data source: the union disagreements read over
`webcam_snapshots` + `external_images` (the `mode=verification` read built in
PR #47), upgraded with provenance and a new exclusion.

### Controls (UI state, not persisted)
1. **Blind toggle** — default ON = *blind-then-reveal*: scores hidden while you
   rate; on submit, the three judges + provenance reveal so you confirm the frame
   was genuinely hard. OFF = scores always visible (inspect mode: look and skip to
   verify hardness without rating). The blind-first default keeps labels unbiased
   (these become v5 training data; rating while seeing the model's guess risks
   self-reinforcing bias).
2. **View toggle** — default = rapid single-card queue (keyboard labeling); flip to
   a grid to eyeball many frames at once.
3. **Source filter** — All / Flickr / Archive·trained / Archive·new.

### Provenance badge (derived, not stored)
Each frame shows where it came from:
- **Flickr** — `external_images` rows.
- **Archive · trained** — webcam frames captured **≤** the v4 training cutoff.
- **Archive · new** — webcam frames captured **after** the cutoff (not yet trained
  on — the highest-value labels).

Cutoff = a `masterConfig` constant `V4_TRAINING_CUTOFF` (≈ `2026-05-13`, the v4
export date). Derived at read time from `source` + `captured_at`; not stored.
**Caveat (document in code):** exact for "new" (definitely post-training),
approximate for "trained" (not every pre-cutoff frame was in the training sample).
Pinpoint membership would require the v4 manifest — deferred.

### Rapid keyboard entry
Reuse the existing `SnapshotQueueCard` hotkey flow **exactly as implemented today**
(no new interaction model) — `1–5` stars, the Yes/No is-sunset keys, `space` = skip,
`z` = undo — extended only so submitting also writes a `manual_labels` row. The
implementation reads `SnapshotQueueCard` and matches its current key mapping rather
than inventing one. Type-and-advance; labeled frame leaves the queue.

### Capture
`is_sunset` (required) + `rating` 1–5 (optional). No free-text note.

## Data model

New table — the operator gold-label set, decoupled from crowd ratings:

```sql
CREATE TABLE IF NOT EXISTS manual_labels (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('webcam', 'flickr')),
  image_id    BIGINT NOT NULL,        -- webcam_snapshots.id or external_images.id
  is_sunset   BOOLEAN NOT NULL,
  rating      INT CHECK (rating BETWEEN 1 AND 5),  -- nullable
  origin      TEXT NOT NULL DEFAULT 'hard_example',
  labeled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, image_id)           -- one label per frame; re-label upserts
);
```

- `source` + `image_id` is the polymorphic key into the two image tables.
- `origin` tags the provenance of the *label activity* (hard-example mining now;
  future label campaigns can use other values).
- Upsert on `(source, image_id)` so re-labeling overwrites.

**Migration also backfills** existing operator verdicts so prior work carries over:
```sql
INSERT INTO manual_labels (source, image_id, is_sunset, rating, origin, labeled_at)
SELECT 'webcam', snapshot_id, is_sunset_verdict, rating, 'hard_example', created_at
FROM webcam_snapshot_ratings
WHERE is_sunset_verdict IS NOT NULL
ON CONFLICT (source, image_id) DO NOTHING;
```

## Components & data flow

1. **Read** — the disagreements union read (existing `mode=verification` in
   `app/api/snapshots/route.ts`) is the queue source, with two changes:
   - add the provenance badge fields (derive trained/new from `captured_at` vs
     `V4_TRAINING_CUTOFF`; Flickr is its own value);
   - **exclusion**: queue = flagged frames **minus** rows already in
     `manual_labels` (was: minus `webcam_snapshot_ratings.is_sunset_verdict`).
     This is the membership invariant — a labeled frame stays out, and a later
     disagreement recompute must not resurrect it.
   - optional `source` filter param.
2. **Write** — new owner-gated route `POST /api/manual-labels`
   `{ source, imageId, isSunset, rating? }` → upsert into `manual_labels`.
   `DELETE` (undo) removes the row.
3. **UI** — the **Hard Examples** tab becomes the unified queue: `SnapshotQueueCard`
   (informed reveal after submit) + the three controls + provenance badge. The
   read-only **Verification** tab is removed (its union read is reused here).

## Testing
- **Migration:** validate idempotency + the backfill in a rolled-back txn (per the
  established pattern); verify `UNIQUE` upsert.
- **`POST /api/manual-labels`:** owner-gated (401/403); upserts; rejects bad
  `source`/`rating`; DELETE removes. (Mock `sql`, mirror `route.test.ts`.)
- **Read:** queue excludes `manual_labels`-present frames; source filter narrows;
  provenance derivation (trained vs new vs flickr) is correct around the cutoff.
- **UI:** unit-test the provenance/derivation + the label→leave reducer; the card
  hotkey flow is reused (already covered).

## Scope boundaries
- One operator; no auth roles beyond `requireOwner`.
- Provenance is display-only and date-approximate; no manifest cross-reference.
- No change to the scoring/backfill pipeline; labels are consumed by v5 training
  out-of-band (export reads `manual_labels`).

## Open follow-ups (not in this spec)
- Exact training-membership via the v4 manifest (upgrade the provenance badge).
- v5 training export that joins `manual_labels` as gold labels.
- Binary-disagreement threshold tuning (`SUNSET_DISAGREEMENT_HIGH/LOW`) if the
  ~18.5% archive flag rate proves noisy in practice.
