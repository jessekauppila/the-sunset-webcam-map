# Reconciling #44 (three-judge) onto main after #45 (remove-baseline-fallback)

Status: **pending #45 merge.** This recipe was verified by a trial merge of
`origin/fix/remove-baseline-fallback` into `feat/three-judge-p2` on 2026-06-07
(then aborted). Re-verify if #45 changes materially in review.

## Merge order
Merge **#45 first** (small, independent, safety-critical), then rebase the
`#43 → #44` stack onto the new `main`. Reconcile during that rebase.

## What auto-merges cleanly (no action)
`aiScoring.ts`, `aiScoring.test.ts`, `route.ts`, `route.test.ts`,
`masterConfig.ts`, `cleanup/route.test.ts`.

Note on `aiScoring.ts`: the auto-merge correctly takes #45's
`ScorePath = 'onnx' | 'cache-hit' | 'unscored'` and `rawScore/aiRating:
number | null`, drops every `ratingFromRaw` call (they lived only in the
baseline branches #45 deletes — no dangling references), and keeps #44's
three-judge additions (`computeDisagreementKind`, `DISAGREEMENT_KIND_PRIORITY`,
binary head). Still run `tsc` after the real rebase to confirm.

## The 3 conflicts

1. **`customBackfill.ts`** — modify/delete → **`git rm`**.
   #44 replaced it with `archiveBackfill.ts`. #45's only change was an
   `unscored` null-guard (skip the write when `rawScore === null`), which
   `archiveBackfill` already covers more strongly: it aborts the whole run on
   any non-`onnx` path rather than writing junk.

2. **`customBackfill.test.ts`** — modify/delete → **`git rm`**. Same reason.

3. **`cleanup/route.ts`** — content conflict. **This is review finding #2.**
   Take **#45's** retention clause:
   ```sql
   AND llm_quality IS NULL
   AND (ai_rating IS NULL OR ai_rating < ${AI_SNAPSHOT_MIN_RATING_THRESHOLD})
   ```
   and **drop #44's** competing clause:
   ```sql
   AND (ai_regression_score IS NULL OR ai_regression_score < ${minRegressionScore})
   ```
   Why: #44's `ai_regression_score` version is the *buggy* fix — the leaderboard
   ranks by `llm_quality`, so keying retention on the regression score still
   deletes high-`llm_quality` frames. #45's `llm_quality IS NULL` guard protects
   exactly those leaderboard frames. Remove the now-unused `minRegressionScore`
   local in #44's version.

   Open follow-up (non-blocking): #44 intentionally moved retention off junk
   `ai_rating`; #45 makes `ai_rating` "no longer fabricated," so its check is now
   meaningful. Whether to *also* retain on `ai_regression_score` is a product
   decision for later — #45's `llm_quality` guard is the part that fixes the bug.

## Post-rebase cleanup (non-blocking, no conflict)
#45 removes the `AI_SCORING_MODE` concept. #44-only files still reference it
(compile-safe — no imports — just dead concepts):
- `archiveBackfill.ts` — the non-ONNX abort log message.
- `scripts/backfill-archive-scores.ts` — the `=== 'onnx'` guard + doc comment
  (the runtime now returns `'unscored'` if the model can't load).

## After reconciling
Run `tsc --noEmit` and the full vitest suite; confirm green before continuing.
