# Claude-rated gallery — Design

**Date:** 2026-08-07
**Status:** Approved direction (brainstormed with Jesse)
**Depends on:** GeoMosaic engine (PR #76) — `app/lib/qualitySignal.ts` is the insertion point
**Related:** `docs/ml/rating-rubric.md`, `ml/llm_rater.py`, `memory/project_manual_labels_v4_error_profile.md`

## Goal

Let the gallery exhibit be driven by Claude's quality judgment instead of the
homegrown v4 ONNX model, behind a config toggle, and keep every rated frame as
v5 training data.

Three things this buys, in priority order:

1. **The exhibit stops depending on v4 being good enough.** The show is a month
   out. This decouples "does the wall look good" from "did we finish the model."
2. **It removes a variable.** With a trusted quality signal, every other
   exhibit question — composition, tile sizing, hardware, the physical install —
   can be evaluated without the model as a confound.
3. **Rating builds the training set.** Every frame Claude scores is a labeled
   frame, persisted, and mergeable with the existing ~22.8k `llm_quality` rows.

## What the measurement says (scope honesty)

From 258 operator gold labels (`manual_labels`, 2026-08-07):

| Finding | Number |
|---|---|
| Operator agreed with Claude | 231/258 (90%) |
| Operator overruled v4 | 230/258 (89%) |
| v4 false positives (`model_high_claude_not_sunset` called "not a sunset") | 137/147 |
| Rating 5 → Claude avg quality | **0.83** (n=37) |
| Rating 4 → Claude avg quality | **0.10** (n=9, 8 below 0.30) |

**Claude fixes the failure that matters most for a wall.** v4's dominant error
is false positives — scoring non-sunsets high. On a mosaic that is the worst
possible failure: junk frames rendered *large*, at eye level. Claude eliminates
those.

**Claude does not fix the silhouette blind spot.** Frames rated 4 — vivid skies
seen through power lines, terrain, or a smeared lens — score ~0.10. Those will
render small. That is a sizing miss, not junk-on-the-wall, and is acceptable for
the exhibit window. It is mitigated, not solved, by the rubric patch below.

**Do not blend v4 back in to compensate.** v4's error profile is strictly worse
on this pool.

### Probable cause of the blind spot

`RATING_PROMPT` (`ml/llm_rater.py:70`) asks Claude to report:

- `obstruction` — `"rain on lens"`, `"fog"`, `"building"`, or null
- `sky_coverage` — `"how much of the frame is sky vs blocked by terrain/buildings/trees"`

…but never states that obstruction and low sky coverage must **not** reduce the
quality score. The prompt draws attention to exactly the features that define a
silhouette sunset, with no instruction to discount them. Meanwhile
`docs/ml/rating-rubric.md` habit #1 — *"Judge the sky, not the framing. A great
sky behind a power line or through a smeared lens is still a great sky"* —
exists only as an operator instruction and was never ported into the prompt.

This is a hypothesis with a coherent mechanism, not a proven cause. Phase 0
tests it.

## Phase 0 — Validate before flipping anything

Before any toggle ships, re-run the patched prompt against the 258 gold labels
and measure.

- **Cost:** 258 × ~$0.0034 ≈ **$0.88**, one-time.
- **Method:** score all 258, compare against `manual_labels.rating`, using the
  normalization from `ml/export_dataset.py:62` — `(rating - 1) / 4`, so
  rating ≥ 4 ⇒ normalized ≥ 0.75. **Not** `rating / 5.0`; see the known
  inconsistency in `ml/validate_llm_ratings.py:78`.
- **Report:** binary precision/recall at the 0.75 boundary, plus the
  before/after mean score on the 9 frames rated ≥ 4 where Claude said "not a
  sunset."

**Gate:** ship the toggle if the patched prompt holds binary precision on the
negatives (i.e. it did not start calling junk frames sunsets in order to rescue
the 4s). Moving the 4s is the goal; keeping the false-positive fix is the
constraint. If the patch trades one for the other, ship the *unpatched* prompt —
the false-positive fix is the load-bearing win.

## Architecture

### 1. The toggle — `app/lib/qualitySignal.ts`

Per GeoMosaic directive #7 ("one module decides which model's score drives
sizing"), this is the only file that changes for the switch. Both kiosk pages,
both main-page mosaic view modes, and the `?setup=1` overlay follow
automatically.

```ts
// masterConfig.ts
export const QUALITY_SIGNAL_SOURCE: 'model' | 'claude' = 'model';
```

**Score precedence ladder** in `claude` mode:

1. `manual_labels.rating` — operator gold, normalized `(rating - 1) / 4`
2. `llm_quality` — Claude, already 0–1
3. `ai_regression_score` — v4 fallback

The operator ladder means a frame Jesse personally rated a 4 renders at a 4
regardless of what either judge thinks. 258 such frames exist today.

In `model` mode the ladder is unchanged from PR #76 (`aiRatingRegression`
only), so the toggle is a true revert.

### 2. Mixed-scale ranking

The engine sizes by **percentile**, not absolute score, so clustering is already
handled. But Claude scores and v4 scores must not be ranked in one ladder — they
are different scales.

Rule: rank Claude-rated tiles among themselves; tiles with no Claude score are
placed by their **own model percentile** mapped onto the same [0,1] scale. This
is an approximation, not a correct joint ranking. Two consequences:

- Coverage of the displayed pool should be high enough that it rarely matters —
  which is what the budget below is sized for.
- `?setup=1` must show, per tile, which rung of the ladder produced its score,
  and a pool-level Claude-coverage percentage.

Do **not** fall back to the median-0.5 default for unscored tiles in `claude`
mode; that erases real ordering information the model score still carries.

### 3. The rating pump — a separate cron route

`/api/cron/llm-rate`, on its own Vercel schedule. **Not** folded into
`update-cameras`.

Two reasons, both real:

- The `update-cameras` bundle already hovers ~264 MB against the 250 MB limit
  with the ONNX models included via `outputFileTracingIncludes`. Adding
  `@anthropic-ai/sdk` there risks breaking the deploy weeks before the exhibit.
- A rating failure must not be able to take down snapshot scoring.

Per-run flow:

1. Select candidates: webcams in the current terminator pool (the same source
   `/api/db-terminator-webcams` feeds the kiosks), ordered by staleness.
2. Filter: image hash changed since last rating **and** `llm_rated_at` older
   than `LLM_RATE_FRESHNESS_MINUTES`. The cron already computes a SHA-256 per
   frame (`aiScoring.ts` / `imageHash.ts`); reuse it. Most Windy frames do not
   change tick-to-tick, which is what makes near-full coverage affordable.
3. Enforce budget caps (below) with a count query — not an assumption.
4. Call Claude with the patched rubric and a structured-output schema.
5. Write `llm_quality`, `llm_is_sunset`, `llm_model`, `llm_provider`,
   `llm_rated_at`, `llm_explanation`. All columns already exist and are indexed.
6. Persist the image (see §5).

### 4. Budget caps and provenance

```ts
export const LLM_RATE_ENABLED = false;          // kill-switch
export const LLM_RATE_MAX_PER_RUN = 10;
export const LLM_RATE_MAX_PER_DAY = 1200;       // hard ceiling, ~$4/day
export const LLM_RATE_FRESHNESS_MINUTES = 20;
export const LLM_RATE_MODEL = 'claude-sonnet-5';
```

`LLM_RATE_MAX_PER_DAY` is enforced against a `COUNT(*) WHERE llm_rated_at >=
date_trunc('day', now())` check at the top of each run. The cap is the safety
net, not the freshness window.

**Provenance is mandatory, per the silent-ML-fallback lesson.** If the API key
is missing or the call fails, the outcome must be *visibly zero ratings* — never
a mosaic silently sized by v4 while it appears to be Claude-driven. Concretely:

- `llm_model` stamped on every write; never write a score without it.
- The route returns a per-run summary: `{ considered, rated, skipped, failed,
  budgetRemaining }`.
- An Ops tab tile shows ratings today, failures today, estimated spend today,
  and current Claude coverage of the kiosk pool.

### 5. Persistence

A Claude-rated frame gets its image kept, mirroring `SAVE_HIGH_RATED_SNAPSHOTS`.
This is the training-data half of the feature and the quiet cost driver
(Firebase storage + Neon rows on top of the API spend). It gets its own line in
the Ops tile.

`/api/snapshots/cleanup` already excludes frames with `llm_quality` set, so no
change is needed there — but the exclusion should gain a regression test, since
it is now load-bearing for the training set rather than incidental.

## Cost model

Per frame: ~800 image tokens + ~400 rubric + ~100 output.

| | per frame | 10/run × 96 runs/day |
|---|---|---|
| Sonnet 5 (intro, through 2026-08-31) | ~$0.0034 | ~$3.30/day |
| Sonnet 5 (standard, from 2026-09-01) | ~$0.0051 | ~$4.90/day |

**Approved budget: $3–5/day.** Note the intro-pricing cliff on 2026-08-31 — the
same cap costs ~50% more from September, which lands inside the exhibit window.
Either accept ~$4.90/day or lower `LLM_RATE_MAX_PER_DAY` to ~800 on that date.

Prompt-caching the rubric reduces the input side further, but only if the cached
prefix clears 512 tokens on Sonnet 5. The rubric alone is near that line;
measure before assuming a cache hit, and verify with
`usage.cache_read_input_tokens` rather than trusting the marker.

**Model choice: stay on `claude-sonnet-5`.** Haiku 4.5 is ~2× cheaper and likely
adequate at "is this a good sunset," but it is a *different judge* than the one
behind the existing 22.8k labels and the 258-label measurement. Continuity of
the training set is worth more than the saving; affordability comes from the
budget cap instead.

## Error handling

- **API failure / missing key** → no write, increment `failed`, leave the prior
  score intact. Never write a fallback score.
- **Malformed response** → structured outputs make this unlikely; on schema
  failure, treat as `failed`. Do not regex-scrape the text.
- **Rate limit (429)** → stop the run early, report `budgetRemaining`; the next
  tick picks up.
- **Budget exhausted** → run returns immediately with `rated: 0`; this is a
  normal state, not an error, and must be visually distinct from a failure in
  the Ops tile.
- **Empty candidate pool** → normal; report and exit.

## Testing

- `qualitySignal` precedence ladder: unit tests per rung, including the
  `(rating - 1) / 4` normalization and the `model`-mode revert.
- Mixed-scale ranking: a pool with partial Claude coverage produces no
  scale-crossing comparisons.
- Budget enforcement: per-run and per-day caps, including the boundary where a
  run is partially consumed.
- Failure paths: missing key, 429, and schema failure each leave scores
  untouched and increment `failed`.
- Cleanup exclusion regression test for `llm_quality`-bearing rows.
- Phase 0 is a measurement script, not a test — it lives in `ml/` alongside
  `validate_llm_ratings.py` and reuses the training normalization.

## Non-goals

- Fixing the silhouette blind spot properly. That is v5's job, trained on the
  growing `manual_labels` gold set (3,489 flagged frames remain unlabeled).
- Replacing v4 anywhere other than gallery composition. Hard Examples mining,
  the disagreement queue, and the popup verdict continue to read the model
  heads.
- Real-time rating on kiosk render. The kiosk reads the DB; the pump runs on
  its own cadence.

## Open questions

- Actual terminator-pool size per tick is unmeasured. It sets real Claude
  coverage at a given cap. One count query against the kiosk pool query answers
  it and should run before Phase 0.
- Whether the rubric patch survives the Phase 0 precision gate is unknown by
  construction — that is what Phase 0 is for.
