---
title: "Three-judge hard examples — Phase 3 (Flickr), corrected"
date: 2026-06-07
supersedes: "Phase 3 (U5–U8) of docs/plans/2026-06-04-001-feat-three-judge-hard-examples-plan.md"
status: plan
---

# Three-judge Phase 3 (Flickr) — corrected

This revises **Phase 3 only** of the [three-judge plan](2026-06-04-001-feat-three-judge-hard-examples-plan.md).
Phases 1–2 (U1–U4) are **merged** (PRs #43 + #44/#46) on top of the
baseline-fallback removal (#45). U5–U8 below replace the original Phase 3.

## What changed since the original plan

The original Phase 3 assumed Flickr had to be ingested and scored by Claude from
scratch, gated on an Anthropic spend approval (original U6 + the "Claude-over-Flickr
spend" risk). **That work already exists:**

- **On disk (durable):** `ml/artifacts/llm_ratings/ratings_20260512_204416.csv` —
  5,747 Flickr images scored by `claude-sonnet-4-5` (`llm_quality`, `llm_is_sunset`,
  `llm_confidence`, palette, …). Same judge as the webcam archive.
- **In the DB:** `external_images.llm_*` was populated for the 2026-05-13 v4 export
  (`export_dataset.py` pulled `external_images WHERE llm_quality IS NOT NULL` →
  5,767 Flickr rows). **The running v4 model was trained on these exact labels.**
- The v4 training manifests (`…/v4_regression_llm_with_flickr/dataset/…/manifest_*.csv`)
  reference the same scores.

**Consequence:** the Claude judge for Flickr is done. No re-scrape, no Anthropic
spend, no approval gate. Phase 3 is now **pure code + one Vercel flip**:
one migration + one TS model-only backfill (unscored-gated) + one private view +
one env flip.

> **Also folds in:** because #45 merged, the model backfill here must use the
> `'unscored'` discipline (skip write on non-ONNX, no fabrication, no `webcams`
> sync). And the deferred **review finding #10 (central owner-auth)** lands in U7.

## Open question (gates U5)

Is `external_images.llm_*` **still populated in production**, or has it been lost
since the 2026-05-13 export? Treat **CSV re-import as the safe default** until
confirmed. Decision gate (run against prod):

```sql
SELECT count(*) FROM external_images
WHERE source = 'flickr' AND llm_quality IS NOT NULL;
```

- `~5,767` → DB intact; no re-import needed.
- materially lower / `0` → re-import `llm_*` from `ratings_20260512_204416.csv`.

## Implementation units (corrected)

### U5 — Confirm/repair Flickr in `external_images` (was: "ingest Flickr")
The rows + Claude scores already exist. Real work is the **mirror migration** plus
a verification gate; **no Claude run, no scrape.**
- **Migration** `database/migrations/<new>_external_images_model_columns.sql`:
  add the model-score columns that #44 added to `webcam_snapshots` —
  `ai_regression_score`, `ai_binary_score`, `ai_binary_is_sunset`,
  `ai_model_version_regression`, `ai_model_version_binary`,
  `model_disagreement_kind`, `scoring_state`, `disagreement_computed_at`.
  Forward-only, idempotent (`ADD COLUMN IF NOT EXISTS`), nullable/defaultless.
  Add the **recompute-finder partial index** equivalent (see #44's
  `webcam_snapshots_needs_recompute_idx`) for `external_images`.
- **Verification gate:** the SQL above. If lost, re-import `llm_*` from the CSV
  (one-off script keyed on the Flickr id/url already in `external_images`).
- Keep the existing URL/title/owner validation from the original U5 (host-allowlist
  `*.staticflickr.com`, sanitize `title`/`owner`) — still relevant for U7's card label.

### U6 — Score Flickr with the **model only** (was: "all three judges")
Claude judge = reuse existing `llm_*`. Remaining = run the ONNX regression + binary
heads over Flickr via the **TS backfill module #44 shipped** (`archiveBackfill`),
targeting `external_images`. **Zero Anthropic spend.**
- Add an `external_images`-targeted finder/writer to the backfill. The external
  writer **must NOT** call `updateWebcamRegressionScoreFromLatestCustomSnapshot`
  (no `webcams` row exists for a Flickr image) — keep archive and external writers
  distinct.
- **Post-#45 `'unscored'` discipline:** reuse #44's `pathTaken !== 'onnx'` abort +
  the null-score narrow — a Flickr `'unscored'` result must never write a fabricated
  score, and never sync a webcam.
- **SSRF:** fetch `external_images.image_url` (the Flickr CDN URL), validate the host
  against `*.staticflickr.com` immediately before the request.
- Extend `scoreImage`'s source union to include `'flickr'` (or thread a neutral
  source; `webcamId` is only a log/cache key — supply a synthetic id for
  null-webcam rows).
- Then the **disagreement recompute** (#44's `recomputeDisagreements`, run over
  `external_images` too) produces model-vs-Claude for Flickr.

### U7 — Verification view (unchanged) + **central auth fix (review #10)**
One operator tab, `requireOwner` server-side AND owner-only client render;
disagreements-only toggle (defaults OFF = browse all, eyeball judge coverage; ON =
ranked disagreement queue with verdict actions). UNION projection across
`webcam_snapshots` + `external_images` (NULL-pad webcam-only columns; tolerate null
`webcam_id`/location). Flickr card label = source badge + `title`/`owner`.
- **Fold in review finding #10:** instead of gating each owner-only mode inline,
  classify modes as owner-only vs public **once** before the query branches in
  `app/api/snapshots/route.ts`, so a new private mode (this verification view) is
  secure by default rather than relying on remembering to add `requireOwner`.

### U8 — Flip `AI_BINARY_SCORING_ENABLED` in Vercel (unchanged, operational)
Enable the binary head in production; confirm live binary-vs-regression flagging.
Note: the offline backfills (U3/U6) compute model-vs-Claude without binary; U8 is
what lights up the *live* binary dimension.

## Net effect
Phase 3 = **one migration + one TS model-only backfill (unscored-gated) + one
private view + one env flip.** No Anthropic approval, no re-scraping. Detailed TDD
steps for U6 build directly on the now-merged #44 backfill module.

## Deferred (carried from #44 review, not Phase-3-blocking)
- #6 NULL-safe recompute predicate; #7 dead-url match on HTTP status not message;
  #9 generate the priority `CASE` from `DISAGREEMENT_KIND_PRIORITY`;
  the vestigial `AI_SCORING_MODE` guard in `scripts/backfill-archive-scores.ts`
  (runtime ignores it post-#45).
