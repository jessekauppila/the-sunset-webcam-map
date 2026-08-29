---
title: "Sunset model work — current state and how it splits into sessions"
date: 2026-08-29
status: active
---

# Where the sunset model work stands

**Read this first in any new session.** It is the index: what is settled, what is
running, what is open, and which of the three workstreams a given question
belongs to.

Branch: **`feat/kiosk-url-tuning`**, ~31 commits ahead of `main`, all `ml/`- and
`docs/`-scoped and cherry-pickable onto a clean branch. **Do not switch
branches** — parallel sessions share this one checkout. Verify with
`git rev-parse --abbrev-ref HEAD` before any commit and **stage explicit paths,
never `git add -A`.**

Environment: `.venv` (Python 3.11 arm64, rebuilt 2026-08-29, torch 2.2.2).
`ml/run_training.py` reads `DATABASE_URL` from `.env.local` itself.

---

## The design, in one place

The operator rates on **two separate scales**, and the models mirror that.
Collapsing them onto one axis was the root of several earlier mistakes.

| | question | labels | model |
|---|---|---|---|
| **Scale A — detection** | is a sunset happening? | `N` vs yes — all 8,564 | binary head |
| **Scale B — quality** | how good is it? | 1–5, **only when A is yes** — 3,546 | quality head |

At inference they compose: detection decides whether a sunset is happening, the
quality head sizes the map tile. A frame detection rejects never reaches Scale B.

**Product intent:** show every webcam image; the better the sunset, the bigger
the tile. All six categories (`N`, 1–5) must stay addressable. This is *not* a
binary "would I surface this" gate — an earlier version of these docs said it
was, and that was wrong.

Operator rubric: `docs/ml/rating-rubric.md`.
Label provenance (four sets, three scales): `docs/ml/label-provenance.md`.
Full findings: `docs/superpowers/specs/2026-08-28-v5-gold-label-retrain-design.md`.

---

## Settled — do not re-litigate

- **v4 is broken on operator labels.** F1 0.109 overall / 0.089 webcam,
  balanced accuracy 0.477 (below chance). No threshold rescues it. Its positive
  class was 97.5% Flickr with 36 positive webcam training examples. Its
  self-reported F1 of 0.836 is not a valid baseline.
- **Camera generalization is tested and passes.** Splits group by `webcam_id`;
  730 train / 179 val / 146 test cameras, zero intersection.
- **Overfitting is calibration drift, not broken discrimination.** Val loss
  climbs after epoch 2 while val F1 and AUC hold. Matters for threshold
  choice; does not invalidate the metrics. A `medium`-augmentation A/B moved F1
  by +0.005 (single-seed noise) and did not change the curve.
- **The operator's labels are internally consistent.** 8,501 of 8,564 were made
  after the rubric doc was written; only 63 predate it. No re-rating needed.
- **Claude is internally consistent.** One prompt (`v2_extended`) across all
  51,846 ratings, webcam and Flickr, both judge versions.
- **The legacy `webcam_snapshot_ratings` set (4,776 rows) is retired and
  incompatible** — its UI had no "not a sunset" button, so 62% are rated 1,
  absorbing both meanings. It fed v2 only. Never union it with `manual_labels`.
- **Flickr identity is fully intact** — `source_id`, `original_url`, `owner`,
  `license`, Firebase copy; all URLs still resolve.

## Open questions

**Questions 1 and 2 were SETTLED on 2026-08-29** by 200 operator labels on the
random ordinary sample (`random_ordinary_v1`). Measurements below.

1. ~~How much of the ordinary-frame failure is real?~~ **All of it, and the
   proxy label was flattering the model.** Graded against operator truth on the
   200, the v5 `is_sunset` head scores **precision 0.393 / recall 0.830 /
   F1 0.533**, balanced accuracy 0.684 — against `llm_is_sunset` on the same
   distribution it scored precision 0.574 / F1 0.643. This doc previously
   predicted Claude-grading would *understate* the model; for the is_sunset
   head it **overstates** it. 68 false positives against 147 true negatives:
   it fires on 46% of the frames the operator calls not-a-sunset.
   On the actual product question (rating ≥ 4, base rate 8/200) it is
   **precision 0.0625 / recall 0.875 / F1 0.117** — 105 false positives for 7
   true positives. Unusable as a surfacing gate at threshold 0.5.
2. ~~Is Claude's quality scale usable at all?~~ **Yes — far more than the
   hard-case number implied.** Pearson vs operator on the 53 operator-confirmed
   sunsets is **0.560**, against 0.243 on the 1,224 hard-case overlap. And the
   "flat across ratings 1–5" claim was an artifact of hard cases: on ordinary
   frames Claude's mean quality is **monotonic** — N 0.090, 1: 0.257, 2: 0.406,
   3: 0.441, 4: 0.493, 5: 0.600. Claude's detection on ordinary frames is
   precision 0.598 / recall 0.925 / **F1 0.726**, agreement 0.815.
3. **Does the LLM pretrain help?** Not started — and now better motivated.
   **Claude beats v5 on the production distribution** (F1 0.726 vs 0.533,
   precision 0.598 vs 0.393). The ~52k LLM labels are a stronger detector than
   the gold-only model where it counts. Justification remains distribution
   coverage (25,018 ordinary negatives), not volume.

**Caveats on the 200.** Drawn from LLM-rated frames on cameras absent from the
gold train/val splits, so it measures the ordinary distribution on unseen
cameras, not literally every frame. n=53 for the quality Pearson and n=8 for
rating ≥ 4 — the r4 precision figure is directionally right but noisy.
Operator base rates: 26.5% sunsets, 4% rating ≥ 4.

Reports: `ml/artifacts/reports/v5_binary_on_operator_random200.json` and
`..._r4.json`. Manifests: `ml/artifacts/datasets/random_ordinary_v1/`.

---

## The three workstreams

### Workstream 1 — Model training (the ML thread)

**State:** two-scale design implemented; runs in flight.

| run | status | result |
|---|---|---|
| `v5_binary_gold` (is_sunset) | done | F1 0.874 gold / 0.643 vs Claude / **0.533 vs operator** |
| `v5_binary_gold_aug` | done | +0.005, noise |
| `v5_regression_gold` (all rows) | done, superseded | MAE 0.112, Pearson 0.854 |
| `v5_binary_gold_r3` (rating ≥3) | done | F1 0.8354, balacc 0.8862, AUC 0.9559 |
| `v5_binary_gold_r4` (rating ≥4) | **config written, not run** | — |
| `v5_quality_sunsets_only` | done | MAE 0.180, Pearson **0.690** on 514 sunsets |

**Quality-head result (2026-08-29).** Apples to apples on the identical 514
sunset test frames:

| | MAE | RMSE | Pearson |
|---|---|---|---|
| old head (all 8,564 rows) | 0.1828 | 0.2334 | 0.7249 |
| new head (sunsets only) | 0.1799 | 0.2221 | 0.6900 |

**A wash** — better MAE/RMSE, worse Pearson, n=514 on a single seed. The
two-scale design is not a metrics win and must not be sold as one.

**What it corrected:** the old head's headline Pearson of **0.854 was
inflated.** That came from its full 1,212-row test set, 58% of which is
non-sunsets pinned at 0.0 — trivially easy. On actual sunsets the same model
scores 0.725. **Real quality discrimination sits near 0.70, not 0.85.**

The design still stands: it separates two different questions, removes the
N/rating-1 collision, composes at inference, reaches parity on 3.5x less data,
and has the healthiest loss curve so far (val loss bottoms at epoch 10, not
epoch 2). But the lever for improving it is **more quality labels** —
Workstream 2 — not architecture.

**Next steps, in order:**
1. Run `v5_binary_gold_r4`.
2. Export each detection variant to ONNX and score all of them against
   **operator truth** on `ml/artifacts/datasets/random_ordinary_v1/` via
   `ml/score_manifest.py` — that is now the honest bar, and absolute values are
   readable. Use the `..._r4.csv` manifest for the product question. The old
   `holdout_ordinary` manifest is graded by `llm_is_sunset`, which measurably
   **flatters** the is_sunset head (0.643 vs 0.533 real); keep it only as the
   2,000-frame wide check, never as the headline.
3. Only then decide on the LLM pretrain.

**Do not compare F1 across different label definitions.** is_sunset, r3 and r4
produce different test sets. The ordinary-frame holdout is the only common
ground until Workstream 2 delivers.

Detail: `docs/superpowers/plans/2026-08-29-v5-holdout-check-and-pretrain.md`
(note: its Task 0 framing predates the two-scale design — the design above wins).

### Workstream 2 — Operator labeling (Jesse's thread) ⭐ HIGHEST VALUE

**Nothing else can substitute for this.** ~200 randomly sampled ordinary frames,
rated on the normal `N` / 1–5 scale. Roughly one sitting — 195 were labeled in a
single session on 2026-08-07.

It unblocks three things at once:
- an **unbiased** operator-vs-Claude correlation (open question 2)
- the first **unbiased evaluation set** any model has had
- unbiased training data covering the ordinary-frame majority

**DONE (2026-08-29): all 200 rated.** Distribution: N 147, 1: 14, 2: 17,
3: 14, 4: 7, 5: 1. Results are in "Open questions" above. The sampler, queue
UI and `label_samples` table remain in place for the next draw — see the
mechanics below, and `random_ordinary_v2` if more ordinary labels are wanted.

Open the Hard Examples queue and switch the new **Disagreements | Random
sample** toggle to *Random sample*. Progress reads `n / 200` and the sample is
resumable across sittings — labeled frames drop out, order is frozen.

How it works, and why:

- `label_samples` (migration `database/migrations/20260829_label_samples.sql`,
  **already applied**) holds the draw. It has to be written down before rating
  starts: every filter the queue uses is self-erasing, so a sample computed per
  request would drift as it was rated, and afterwards nothing would separate
  its labels from the 8k hard-case labels.
- `ml/load_label_sample.py` froze the draw as `random_ordinary_v1` — **200
  frames, 140 cameras, seed 20260829**, a subset of the existing 2,000-frame
  `holdout_ordinary` manifest. That subset choice is the point: those are the
  exact frames the v5 detection heads were already scored on, so these labels
  re-grade that run against real ground truth with no re-scoring.
  Claude calls 82 of the 200 sunsets (41.0%) — do not look at that while rating.
- `/api/snapshots?mode=verification&sample=<name>` serves it in frozen order.
  Sample mode **replaces** `disagreements_only` rather than stacking with it —
  ANDing them returns nothing, since the sample is drawn from what that filter
  excludes.
- Labels are stamped `origin = 'random_ordinary_v1'` in `manual_labels`, so the
  two populations stay separable in raw SQL as well as by joining
  `label_samples`. **Never pool them** — hard cases are the hardest ~15% of the
  corpus; averaging them with a random draw destroys what the draw is for.
- The queue shows no disagreement text and no judge scores in sample mode
  (blind is on by default). Keep it that way; a primed rating is a wasted one.

Once the 200 are rated, that unblocks all three of the open questions above.

### Workstream 3 — Map display integration (product thread)

Blocked on Workstream 1 producing a model worth shipping. Scope:

- Tile sizing driven by the quality head; six categories addressable.
- **`AI_BINARY_SUNSET_THRESHOLD` must be re-derived** — currently 0.5, tuned for
  v4's quality-threshold head, whose meaning has changed.
- **If the quality head ships as sunsets-only, the output contract changes.**
  `normalizeOnnxOutput` / `ratingFromRaw` in `app/lib/aiScoring.ts` and
  `customBackfill.ts` assume one five-level scale over all frames. Two heads
  composing is a different shape. These are the only two consumers.
- Deploy mechanics: `vercel env add/rm` is classifier-blocked in Claude Code —
  hand to Jesse. Env vars bake in at deploy time; use `vercel redeploy`. Verify
  by smoke `latencyMs` (real ONNX 100–500 ms, baseline 10–20 ms) and near-zero
  `fallbacks`. Bundle is near Vercel's 250 MB limit, so shipping a model means
  `git rm`-ing a retired one.

---

## Suggested session split

- **"Sunset model training"** → Workstream 1. Start from this file plus the
  design spec.
- **"Sunset labeling"** → Workstream 2. Start from this file; first job is
  wiring a fixed sample into the queue UI.
- **"Sunset map display"** → Workstream 3. Open only once Workstream 1 has a
  model that beats the ordinary-frame bar.

Each session should re-read this file first and update it on the way out.
