# Remove the metadata-heuristic scoring fallback

**Date:** 2026-06-06
**Branch:** `fix/remove-baseline-fallback` (off `main` — standalone production safety fix)
**Status:** Design approved, pending spec review

## Problem

`scoreImage` (`app/api/cron/update-cameras/lib/aiScoring.ts`) has a non-ONNX
fallback that fabricates a sunset score **without looking at the image**.
`baselineRaw` computes a value from webcam popularity and a default manual
rating:

```ts
function baselineRaw(input) {
  const views  = input.fallbackMeta?.viewCount ?? 0;
  const manual = input.fallbackMeta?.manualRating ?? 3;
  const normViews  = clamp(Math.log10(views + 1) / 6, 0, 1);
  const normManual = clamp(manual / 5, 0, 1);
  return clamp(normViews * 0.65 + normManual * 0.35, 0, 1);
}
```

That number is then dressed up as a 1–5 "AI rating" (`ratingFromRaw`) and
written into `ai_regression_score` / `ai_rating` — **the same columns the real
ONNX model writes.** Consumers (the leaderboard) cannot tell a real model score
from a view-count guess.

Two paths produce it:

- `'baseline'` — deliberate: `AI_SCORING_MODE !== 'onnx'`.
- `'baseline-fallback'` — accidental: ONNX was supposed to run but failed to
  load, so it silently falls back to the heuristic.

**Root cause of "we think it's working but it isn't":**
`AI_SCORING_MODE_DEFAULT = 'baseline'` (`app/lib/masterConfig.ts:147`). Anytime
`AI_SCORING_MODE=onnx` is not explicitly set — a missing env var, a
misconfigured preview, a fresh environment — the cron writes fake scores and
every dashboard looks green.

**Where it leaks:** the Phase-2 `archiveBackfill` already refuses to write
non-ONNX results (it `break`s). But the **live cron** (`route.ts`) writes
`baseline` / `baseline-fallback` scores into `webcam_snapshots` + `webcams`
every tick. The provenance is recorded in `scoring_path`, but no consumer filters
on it, so the leaderboard ranks guesses as if they were real.

## Goals

1. The model is the only thing that can produce a score. When ONNX can't run,
   the result is honest **absence** (`NULL`), never a fabricated number.
2. Remove the footgun default so a missing env var can never silently fake data.
3. Clean the fake scores already in the database so they stop being ranked and
   get re-scored by the real model.
4. Record the anti-pattern so it cannot be reintroduced.

## Non-goals / scope boundaries

- **Claude (`llm_*`) scoring is untouched.** This work never reads or writes
  `llm_quality` / `llm_is_sunset` / any `llm_*` column. Claude scoring stays in
  `ml/llm_rater.py`.
- **Human manual ratings are off-limits.** The cleanup touches only
  AI-produced columns. It must **never** modify `webcams.rating`,
  `initial_rating`, or any column of `webcam_snapshot_ratings` (manual ratings +
  operator verdicts). These are preserved for future v5 training. (The heuristic
  *read* `webcams.rating` as an input but only ever read it — we delete the fake
  output, the human labels survive.)
- **No change to the disagreement engine, Phase 2, or Phase 3.** This composes
  with the in-flight backfill; it does not alter `computeDisagreementKind` logic.

## Design

### 1. `scoreImage` stops manufacturing scores

- Delete `baselineRaw`, the `fallbackMeta` field on `ScoreImageInput`, and the
  baseline use of `ratingFromRaw`.
- Collapse `ScorePath` from
  `'onnx' | 'cache-hit' | 'baseline' | 'baseline-fallback'`
  to **`'onnx' | 'cache-hit' | 'unscored'`**.
- Whenever ONNX cannot produce a real number — `getOrt`/preprocess throws, or the
  regression head throws — return a single honest result with
  `pathTaken: 'unscored'` and **null** `rawScore` / `aiRating`. The binary head
  already returns its fields unset on failure; keep them null (no `0`/`false`
  placeholder).

### 2. Remove the `AI_SCORING_MODE` branch (kill the `'baseline'` default)

- `scoreImage` always attempts ONNX. "No model available" naturally becomes
  `'unscored'`.
- Delete `AI_SCORING_MODE` + `AI_SCORING_MODE_DEFAULT` so a missing/incorrect env
  var can never again mean "fabricate." Local dev / tests without the model get
  honest `'unscored'` results (or mock the ONNX session for real-score tests).
- *(Conservative fallback if we decide to keep a local-skip knob: keep the env
  var but default it to `'onnx'` and make non-onnx return `'unscored'` rather
  than baseline. Lean is full delete.)*

### 3. Every score-writer writes nothing on `'unscored'`

On `main` there are **three** `scoreImage` consumers, and two of them write fake
scores today (the third is read-only):

**(a) `route.ts` `scoreOneWindy` (live Windy cron).**
- On `'unscored'`: **skip** the write — do not call `updateWebcamAiFields`, do
  not push to `windyScores`, do not persist a snapshot. The image exists but
  carries no score.
- Increment an `unscored` counter and log. Rename the `baseline-fallback`
  telemetry bucket to `unscored`.

**(b) `customBackfill.ts` (custom-camera backfill).** This is the second leak —
it currently writes `result.rawScore` with no gate (lines 49–58).
- On `'unscored'`: `continue` without calling `updateSnapshotAiRegressionScore`,
  without pushing to `scores`, and without adding the webcam to
  `touchedWebcamIds` (so no `updateWebcamRegressionScoreFromLatestCustomSnapshot`
  sync from a non-score). Count it as `failed` (or a new `unscored` field).
- The finder is `WHERE ai_regression_score IS NULL`, so the row is retried.

**(c) `app/api/debug/scoring-smoke/route.ts` (diagnostic, read-only).** Does not
write — just needs to tolerate a null `rawScore` in its JSON response (a null
`rawScore` + `pathTaken: 'unscored'` is itself the useful "model isn't loading"
signal).

In all cases the row re-enters the scoring queue automatically — the finders are
`WHERE ai_regression_score IS NULL` — so the real model reclaims it next tick.

### 4. Cleanup migration (null the existing junk)

New forward, idempotent migration
`database/migrations/<date>_null_baseline_scores.sql`:

```sql
-- Null AI-produced scores that were fabricated by the metadata heuristic, so the
-- leaderboard stops ranking guesses and the ONNX backfill reclaims these rows
-- (finder = WHERE ai_regression_score IS NULL). Touches ONLY ai_* / scoring_path
-- / disagreement columns. NEVER touches human-rating columns (webcams.rating,
-- initial_rating, webcam_snapshot_ratings.*).
UPDATE webcam_snapshots
SET ai_regression_score     = NULL,
    ai_rating               = NULL,
    scoring_path            = NULL,
    model_disagreement_kind = NULL
WHERE scoring_path IN ('baseline', 'baseline-fallback');

-- Denormalized AI values on webcams (written from the live-cron baseline path).
-- Only the ai_* columns; webcams.rating (human) is untouched.
UPDATE webcams
SET ai_rating            = NULL,
    ai_rating_regression = NULL,
    ai_rating_binary     = NULL
WHERE /* rows whose latest score came from a baseline path — see Open question */;
```

**Open question for the plan:** `webcams` has no per-row `scoring_path`, so the
exact predicate for which denormalized rows to null needs to be pinned in
planning (options: null all `ai_rating*` and let the next scored snapshot re-sync
each webcam; or join to the latest snapshot's `scoring_path`). The
`webcam_snapshots` cleanup is unambiguous and is the source of truth the
leaderboard ranks.

Binary columns (`ai_binary_*`) are **Phase-2-only** and absent on `main`, so
there is no binary junk to clean on this branch.

### 5. Tests (TDD — written first)

Rewrite the three test files that assert baseline behavior to assert the
`'unscored'` contract:

- `aiScoring.test.ts` — ONNX failure / no-model returns `pathTaken: 'unscored'`
  with null scores; no fabricated number.
- `route.test.ts` — an `'unscored'` result writes no score (columns stay null),
  bumps the unscored counter, still inserts the snapshot.
- `archiveBackfill.test.ts` — gate still holds against the renamed path.

## Compound-engineering learning

Write `docs/solutions/<date>-fallbacks-must-not-impersonate-real-signal.md`:

> **A fallback that writes a plausible value into the same column as the real
> signal is worse than no fallback — it is undetectable.** A heuristic that never
> reads the input it claims to score (here: a view-count guess written into the
> model's score column) produces silent, confidently-wrong data and makes broken
> infrastructure look healthy. Fallbacks must be either **absent** (write `NULL`,
> count it, log it) or stored in a **distinct, clearly-labeled channel** — never
> in the column reserved for the real signal. Bonus footgun: defaulting the mode
> selector to the fake path (`AI_SCORING_MODE_DEFAULT = 'baseline'`) means a
> missing env var silently fabricates.

## Dependencies / integration

- **Base:** `main`. This is a standalone production safety fix and ships
  independently of the Phase 1/2/3 stack.
- **Known overlap:** Phase 2 (`feat/three-judge-p2`) also edits `aiScoring.ts`
  (`computeDisagreementKind`). A small merge resolution is expected when both
  land. The two changes are logically disjoint (this removes the baseline path;
  Phase 2 extends the disagreement function), so resolution is mechanical.

## Verification

- A forced ONNX failure yields `pathTaken: 'unscored'` and writes no score.
- With no `AI_SCORING_MODE` set, the cron does not fabricate scores.
- After the cleanup migration, `SELECT count(*) FROM webcam_snapshots WHERE
  scoring_path IN ('baseline','baseline-fallback')` is 0, and those rows have
  `ai_regression_score IS NULL`.
- `webcams.rating`, `initial_rating`, and `webcam_snapshot_ratings` row counts
  and values are unchanged by the migration.
- Leaderboard ranks only real (ONNX / Claude) scores.
