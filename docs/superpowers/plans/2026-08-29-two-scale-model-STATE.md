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

1. **How much of the ordinary-frame failure is real?** The v5 `is_sunset` head
   scored F1 0.643 / precision 0.574 on 2,000 ordinary frames, but graded
   against `llm_is_sunset`, which asks a different question. **Only operator
   labels on ordinary frames can settle this** → Workstream 2.
2. **Is Claude's quality scale usable at all?** On the 1,224 comparable frames,
   Pearson vs operator ratings is **0.243** and Claude's mean quality is flat
   across operator ratings 1–5. But all 1,224 are hard cases, where Claude is
   least reliable by construction. Unmeasurable without → Workstream 2.
3. **Does the LLM pretrain help?** Not started. ~52k images, 2–4 hours.
   Justification is distribution coverage (25,018 ordinary negatives), not
   volume.

---

## The three workstreams

### Workstream 1 — Model training (the ML thread)

**State:** two-scale design implemented; runs in flight.

| run | status | result |
|---|---|---|
| `v5_binary_gold` (is_sunset) | done | F1 0.874 gold / **0.643 ordinary** |
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
2. Export each detection variant to ONNX and score all of them on
   `ml/artifacts/datasets/holdout_ordinary/manifest_test.csv` via
   `ml/score_manifest.py`. **Read the precision trend across is_sunset → r3 →
   r4, not absolute values** — `llm_is_sunset` understates a rating-threshold
   model (see open question 1).
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

The sampler exists — `ml/build_holdout_manifest.py` already excludes hard cases
and gold-set cameras. What is **not** built: a way to feed a fixed sample into
the Hard Examples queue UI, which currently pulls from the disagreement queue.
That is the first task of this workstream.

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
