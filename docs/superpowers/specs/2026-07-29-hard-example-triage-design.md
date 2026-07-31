---
title: "Hard-example triage — Claude adjudicates the binary-vs-regression backlog"
date: 2026-07-29
status: spec
---

# Hard-example triage pass

## Problem & goal

Since the v4 binary head went live (June 14), the live cron has flagged
~15,000 webcam snapshots as `binary_negative_regression_high` /
`binary_positive_regression_low` that Claude has never rated (`llm_quality IS
NULL`). They sit in the Hard Examples queue alongside the ~790 genuine
model-vs-Claude contests from the June backfill, drowning the frames actually
worth operator labeling. The skew (95% `binary_negative_regression_high`,
concentrated in ~1,300 cameras) suggests most are dark/dusk frames where the
regression head is noisy — not genuinely ambiguous sunsets.

**Goal:** run the designed three-judge funnel to completion on the backlog.
Claude (the third judge) rates every unrated flagged frame; the existing
hourly recompute loop then re-derives each flag; the queue collapses to
genuine model-vs-Claude contests ranked for operator labeling. Every rating is
traceable to the judge that produced it.

## Non-goals

- No new labeling UI — the Hard Examples tab and `manual_labels` flow are
  unchanged.
- No model training — this produces labels for a future v5 export; it does
  not train anything.
- No change to how the live cron provisionally flags new frames (the
  binary-vs-regression rules stay as the Claude-absent path).
- No auto-labels from pixel statistics. An earlier sketch dropped near-black
  frames via pixel stats; that is **out** — a skipped frame would stay flagged
  forever, and a synthetic "dark ⇒ not sunset" label written into `llm_*`
  columns would masquerade as Claude output (violates the no-silent-fallback
  rule). Every flagged frame gets a real Claude verdict.
- No per-camera dedupe. Flags clear per-frame, so rating 2–3 representatives
  per camera would leave the unrated siblings in the queue forever. Cost is
  controlled by the Batch API + `--limit` slicing instead.

## Design

### Component 1 — `ml/llm_rater.py` extensions (the rating pass)

The existing rater already does image download, prompting, JSON parsing,
resume, cost accounting, and the `llm_*` DB write. Four additions:

1. **`--flagged-unrated` selection.** New selection mode for
   `--source webcam`: `WHERE model_disagreement_kind IS NOT NULL AND
   llm_quality IS NULL AND firebase_url IS NOT NULL`. Ordered by per-camera
   round-robin (`ROW_NUMBER() OVER (PARTITION BY webcam_id ORDER BY
   captured_at DESC)` as the primary sort key) so a `--limit N` slice spreads
   across cameras instead of exhausting one camera's backlog first.
2. **`claude-sonnet-5` support.** Add the model to the pricing table
   ($3/$15 sticker; $2/$10 intro through 2026-08-31; Batch API halves either).
   Remove `temperature=0.1` from `rate_with_anthropic` — Sonnet 5 rejects
   non-default sampling parameters with a 400. (Gemini/OpenAI providers keep
   their temperature settings; the change is Anthropic-path only.)
3. **`--use-batch-api` mode (Anthropic provider only).** Chunk the selected
   frames into Message Batches (~500–1,000 requests per batch, staying under
   the 256 MB request cap with base64 images), submit, poll
   `processing_status` until `ended`, then map results back by `custom_id`
   (= `<table>:<row id>`) and write through the existing per-row DB update
   path. Failed/errored/expired entries are logged and left unrated (a rerun
   with `--flagged-unrated` picks them up — the selection predicate is the
   resume mechanism). Sequential mode remains the default for small runs and
   dry runs.
4. **Run manifest (provenance).** Every non-dry run writes
   `ml/artifacts/llm_ratings/run_<timestamp>_manifest.json`: model ID, a
   sha256 of the exact prompt text sent (the rater has no version constant —
   the hash is the version), provider, selection mode + filters, row-count attempted /
   succeeded / failed, token totals, estimated spend, and start/end times.
   This documents each rating campaign alongside the existing per-run ratings
   CSV.

### Component 2 — `computeDisagreementKind` v2 (Claude adjudicates)

Today the binary-vs-regression rules fire even when Claude has already rated
the frame, so Claude ratings never clear a flag — and a dark frame with
regression ≥ 3.5 gets *promoted* to priority-100 `model_high_claude_not_sunset`,
refilling the operator queue with junk. New semantics for the pure function in
`app/api/cron/update-cameras/lib/aiScoring.ts`:

**When Claude data is present** (`llmIsSunset` boolean + `llmQuality` number),
Claude is the adjudicator — only model-vs-Claude contests survive:

- `model_low_claude_sunset` (unchanged): Claude confident it's a good sunset
  (`llmIsSunset && llmQuality >= 0.6`) while the model rated it ≤ 2.0.
- `model_high_claude_not_sunset` (one new guard): model rated it ≥ 3.5,
  Claude says it isn't a sunset, **and** the binary head does not also say
  "not a sunset" (`binaryIsSunset !== false`). When the binary head and
  Claude agree it isn't a sunset, two of three judges concur — the case is
  settled and returns `null`. Rows without a binary verdict (June archive
  backfill) keep today's behavior.
- Anything else → `null` (settled). The frame leaves the queue; its Claude
  label remains banked for training.

**When Claude data is absent**, the binary-vs-regression rules apply exactly
as today (this is how the live cron provisionally flags frames).

Thresholds are unchanged (`masterConfig.ts`: 3.0/2.0 internal, 3.5/2.0/0.6
model-vs-Claude).

### Component 3 — recompute reset (one-time ops step)

The hourly recompute loop's predicate only revisits rows where
`disagreement_computed_at < llm_rated_at`, so:

- **Newly rated rows** (this triage pass) are picked up automatically — no
  work needed.
- **June-rated rows** (the 3,410 Claude-rated frames still flagged
  binary-vs-regression, plus the 592/197 model-vs-Claude rows) were computed
  *after* their ratings landed, so the new rule never reaches them. One-time
  SQL after the rule change deploys:

  ```sql
  UPDATE webcam_snapshots
  SET disagreement_computed_at = NULL
  WHERE model_disagreement_kind IS NOT NULL
    AND llm_quality IS NOT NULL;
  ```

  The cron then re-derives them page by page under the v2 rule.

### Data model & provenance (no schema changes)

Traceability requirement: it must always be possible to reconstruct *which
judge produced which label* and *which source produced which image*, so
future training runs can slice the dataset (e.g. webcam-only, or
sonnet-4-5-labels-only) without archaeology.

Already satisfied by existing columns — this spec makes the contract explicit:

- **Judge:** every `llm_*` write stamps `llm_model` (e.g.
  `claude-sonnet-4-5` for the May/June campaigns, `claude-sonnet-5` for this
  one) and `llm_rated_at`. Training exports that mix campaigns MUST carry
  `llm_model` through to the dataset manifest so labels can be filtered or
  calibrated per judge.
- **Source:** webcam frames live in `webcam_snapshots`, Flickr in
  `external_images` — a webcam-only model is a source filter in
  `export_dataset.py`, no data changes needed.
- **Model heads:** `ai_model_version_regression` / `ai_model_version_binary`
  already stamp which ONNX versions scored each frame (PR #69 closes the gap
  for live-cron rows).
- **Campaign:** the new run manifest (Component 1.4) documents each rating
  run's parameters and counts.

`ml/OPERATING_GUIDE.md` gains a "Rating provenance" section stating the
above, plus the triage runbook.

### Cost & runbook

Estimated full-backlog cost on `claude-sonnet-5` with Batch API + intro
pricing: **~$35–45** (~15k images ≈ ~2k input + ~150 output tokens each).
Hard checkpoints:

1. `--flagged-unrated --dry-run` — selection counts + HTML sample report,
   zero spend.
2. `--flagged-unrated --limit 500 --use-batch-api` — ~$1.50 smoke slice;
   verify `llm_*` rows land, recompute clears/promotes them, queue counts
   move the right way.
3. Full run (no `--limit`), then the Component-3 reset SQL, then eyeball the
   Hard Examples tab.

The operator (Jesse) runs each step; the script never auto-escalates spend.

### Expected end state

- Every flagged frame has a Claude verdict with judge provenance.
- Queue drops from ~22.8k to the genuine contests: ~790 existing
  model-vs-Claude rows plus an estimated ~10% of the backlog (~1–2k),
  ranked by priority tier and disagreement gap.
- The settled ~13k frames keep their Claude labels (cleanup already spares
  `llm_quality IS NOT NULL` rows) as v5 training data.

## Error handling

- Batch entries that error or expire: logged with `custom_id`, row left
  unrated; rerun picks them up via the selection predicate.
- Unparseable Claude JSON: existing rater behavior (log, skip, no DB write).
- Dead Firebase URLs: log and skip; the frame stays flagged — surfaced in the
  manifest's failure count so a stubborn residue is visible rather than
  silent.
- Recompute is idempotent and already batched; the reset SQL only widens its
  work set temporarily.

## Testing

- **TS (vitest, TDD):** `computeDisagreementKind` v2 — table-driven cases:
  Claude-absent paths unchanged; Claude-present clears binary-vs-regression;
  two-judges-agree returns null; missing-binary keeps
  `model_high_claude_not_sunset`; both model-vs-Claude kinds still fire.
  Recompute loop tests already cover the plumbing.
- **Python (pytest, TDD):** selection SQL shape for `--flagged-unrated`
  (predicate + round-robin ordering + limit); batch chunking respects size
  caps; custom_id round-trip mapping; manifest contents; sonnet-5 request
  contains no `temperature`.
- **Manual:** the three-step runbook above is the integration test.

## Open follow-ups (not in this spec)

- Live-cron flag throttling (per-camera cap on new binary-vs-regression
  flags) if the queue re-grows too fast after triage.
- `SUNSET_DISAGREEMENT_HIGH` threshold tuning informed by the triage results.
- v5 training export that joins `manual_labels` + per-judge `llm_*` labels.
