---
title: "v5 retrain on the operator gold-label set — design"
date: 2026-08-28
status: design
implements_after: docs/superpowers/plans/2026-06-07-hard-examples-labeling-queue.md
plan: docs/superpowers/plans/2026-08-28-v5-gold-label-retrain.md
---

# v5 retrain on the operator gold-label set

The Hard Examples labeling queue (PRs from the 2026-06-07 plan) is **done**:
8,564 operator gold labels, hard-example backlog down to 5. This spec is the
argument for what to do with them, and why a straight "retrain on more data"
would waste them.

All numbers below were measured against production on **2026-08-28**. Queries
are included so they can be re-run rather than trusted.

---

## 1. What the gold set actually contains

```sql
SELECT source, count(*) n, count(rating) n_rated, sum(is_sunset::int) n_sunset
FROM manual_labels GROUP BY 1;
```

| | webcam | flickr | total |
|---|---|---|---|
| `is_sunset = true` (always carries a 1–5 rating) | 3,327 | 219 | **3,546** |
| `is_sunset = false` (rating is NULL) | 4,893 | 125 | **5,018** |
| total | 8,220 | 344 | **8,564** |

Webcam rating histogram: `1→526, 2→646, 3→974, 4→917, 5→264`.
Spread across **1,055 distinct webcams**. Labeled between 2026-06-07 and
2026-08-29.

The UI enforces a clean two-part shape: a frame is either not a sunset (no
rating), or a sunset with a 1–5 quality rating. **This is the first data in the
project that separates "is it a sunset" from "is it a good sunset."**

**Coverage, not correction.** 6,996 of the 8,220 webcam gold labels sit on
frames Claude never rated at all; only 1,224 overlap the LLM set. The gold
labels mostly *add* frames rather than overrule existing ones.

---

## 2. The structural change

**Before (v2–v4):** one continuous `llm_quality` in [0,1]. "Is it a sunset" was
derived by thresholding that score at 0.75 (`(rating-1)/4` where rating = 4).

**Now:** two independent questions — `is_sunset`, and *given* a sunset, quality
1–5.

### The LLM labels already have both

`llm_is_sunset` is populated on **100%** of rated rows — 46,079 webcam and
5,767 external — across both campaigns (`claude-sonnet-4-5`: 29,705,
`claude-sonnet-5`: 16,374).

```sql
SELECT (llm_quality IS NOT NULL) AS has_quality,
       (llm_is_sunset IS NOT NULL) AS has_is_sunset, count(*)
FROM webcam_snapshots WHERE firebase_url IS NOT NULL GROUP BY 1,2;
--  true/true: 46079   false/false: 9221
```

`ml/export_dataset.py` **never reads `llm_is_sunset`.** It reads only
`llm_quality` and thresholds it. ~52k is-sunset labels have been sitting unused
in the database.

---

## 3. Why the v4 binary head is broken

Claude's quality scale is **compressed on webcam frames** — max 0.88, mean 0.405
even among frames it labels as sunsets. So the 0.75 threshold almost never
fires on webcam data:

```sql
SELECT llm_is_sunset, (llm_quality >= 0.75) AS quality_positive, count(*)
FROM webcam_snapshots WHERE llm_quality IS NOT NULL GROUP BY 1,2;
--  false / false : 25018
--  true  / false : 20971
--  true  / true  :    90     <-- the entire webcam positive class
```

90 positives out of 46,079 webcam rows. On Flickr the same threshold fires on
2,038 of 5,767.

The actual v4 binary training manifests
(`ml/artifacts/experiments/20260601_063518_v4_binary_llm_with_flickr/dataset/*/`):

| split | webcam pos | flickr pos | webcam neg | flickr neg |
|---|---|---|---|---|
| train | **36** | 1,418 | 20,083 | 2,605 |
| val | 8 | 317 | 4,792 | 534 |
| test | **4** | 303 | 4,682 | 590 |

The positive class is 97.5% Flickr. The model saw **36 positive webcam
examples**, and its reported F1 0.836 / balanced-acc 0.933 / AUC 0.995 was
measured on a test set whose positives are 303 Flickr photos and 4 webcam
frames.

**That metric is not evidence about production behavior.** It largely measures
"can you distinguish a Flickr photograph from a webcam frame" — the exact
domain-shift failure `ml/OPERATING_GUIDE.md` §12 warns about. It is consistent
with the operator-overrule rate and false-positive-dominant failure mode
recorded in the 2026-08-07 error-profile notes.

---

## 4. Where the operator and Claude disagree

On the 1,224 overlapping webcam frames:

| operator | Claude | n | avg `llm_quality` |
|---|---|---|---|
| not sunset | sunset | **141** | 0.680 |
| sunset | not sunset | **70** | 0.000–0.113 |
| agree (both not sunset) | | 955 | 0.037 |
| agree (both sunset) | | 58 | ~0.68 |

Within those 70 false negatives, broken out by the operator's rating:
`1→4, 2→26, 3→27, 4→11, 5→2`.

**13 frames the operator rated 4 or 5, Claude scored at avg 0.018 and 0.000.**
That is the silhouette-sunset blind spot, quantified. These are precisely the
frames the product exists to surface, and the current pipeline scores them at
zero.

---

## 5. Decisions

### D1 — `manual_labels` becomes a first-class label source

`export_dataset.py`'s existing `--label-source manual_only` is a misnomer: it
reads `webcam_snapshots.calculated_rating` joined to `webcam_snapshot_ratings`
(the retired crowd-vote path). Add a genuine `gold` source that joins
`manual_labels` to `webcam_snapshots` / `external_images`.

### D2 — `is_sunset` is an export-level label choice, not a new target type

The binary head is structurally identical either way: two classes, same loss,
same `[1,2]` ONNX output. Only the *derivation of the label* changes. So do
**not** add a new `target_type` — that would ripple through `train.py`,
`evaluate.py`, `export_onnx.py` and the production scorer for no benefit.

Instead add one export-level flag:

```
--binary-label-from {quality_threshold, is_sunset}   # default: quality_threshold
```

- `quality_threshold` — today's behavior (`llm_quality >= binary_threshold`).
  Keeps v4 exactly reproducible.
- `is_sunset` — take the boolean directly.
  - gold supply: `manual_labels.is_sunset`
  - LLM supply: `webcam_snapshots.llm_is_sunset` / `external_images.llm_is_sunset`

Everything downstream of the manifest is untouched, and the deploy is a model
version bump plus a threshold review rather than a scorer change.

### D3 — LLM labels come from the database, not the frozen CSV

v4 was bound to `ml/artifacts/llm_ratings/initial_ratings.csv` (29,605 rows).
The DB now holds 46,079 rated webcam frames. Read from the DB.

### D4 — the two heads get different recipes

| head | v5 training data | rationale |
|---|---|---|
| **is_sunset** | LLM `llm_is_sunset` (~52k) pretrain → gold fine-tune, gold wins all conflicts | Claude's is-sunset judgement is usable and plentiful; gold corrects it. Positive webcam examples go 36 → 3,327. |
| **quality** | gold ratings **only** | Claude's quality scale is not calibrated to the operator's — compressed to ≤0.88, and it zeroes out the frames the operator rates 5. Blending the two scales would bake the miscalibration into the target. |

Calibrating `llm_quality` against gold ratings so the LLM quality data becomes
usable is **deliberately out of scope for v5** — it is its own experiment, and
it needs the gold-only baseline to measure against.

### D5 — measure v4 on gold before training anything

Given §3, v4's published metrics say nothing about webcam performance. Score
the gold test split with the shipped v4 ONNX and record it. Without that
number there is no honest before/after for v5.

### D6 — gold-only runs first, mixed runs second

Every gold row came out of a disagreement queue, so the set is deliberately
hard-case biased. Dropping 8,564 hard labels into 52k LLM labels lets the easy
majority drown out the signal the labeling effort bought. Establish the
gold-only number, then let `compare_experiments.py` decide whether mixing helps.

---

## 6. Constraints carried from the existing pipeline

- **`binary_threshold` is compared against normalized [0,1] labels, not raw
  1–5 ratings.** 0.75 ≈ "rating ≥ 4". Setting it to 4.0 yields zero positives
  and a trivial always-0 model. (`ml/common/labels.py`)
- **Splits are grouped by `webcam_id`** (`assign_split`), so no frame-level
  leakage between splits. Gold labels span 1,055 cameras, so 70/15/15 holds.
- **BUG to fix first — external splits are not reproducible.**
  `export_dataset.py` assigns external rows with
  `assign_split(hash(f"ext_{id}") % 10_000_000, ...)`. Python salts `hash()`
  on `str` per process unless `PYTHONHASHSEED` is set, and it is set nowhere
  in `ml/`. Verified: three runs of `hash('ext_12345') % 10000000` returned
  7908036 / 2176055 / 1345506. Every export reshuffles Flickr images between
  train/val/test. There is no leakage *within* a run, but no experiment that
  includes Flickr is comparable to another — which D6 depends on. Fix with the
  same sha256 `stable_bucket` the webcam path already uses.
- **Normalization contract:** `(rating-1)/4`, so 0.0 ↔ rating 1 and 1.0 ↔
  rating 5. Changing it means updating `normalizeOnnxOutput` + `ratingFromRaw`
  in `app/lib/aiScoring.ts` and `customBackfill.ts` — the only two consumers.
- **Never let an ML fallback masquerade as real output.** Persist `pathTaken`;
  confirm a deploy by smoke `latencyMs` (real ONNX 100–500 ms, baseline
  10–20 ms) and a near-zero `fallbacks` count.
- **Vercel bundling:** `vercel.json` `includeFiles` is silently ignored; use
  `outputFileTracingIncludes` with route-path keys. Bundle sits near the 250 MB
  limit — retire old ONNX artifacts rather than accumulating them.

---

## 7. Flickr image provenance — what is and isn't recoverable

**The images are fully identified.** `external_images` holds 5,872 Flickr rows,
all from a single scrape on **2026-05-12**, category `sunset` (no `negative`
rows were ever scraped, despite the scraper supporting them). Every row carries:

| field | coverage |
|---|---|
| `source_id` (Flickr photo ID) | 5,872 / 5,872, all distinct |
| `original_url` (`live.staticflickr.com/...`) | 5,872 |
| `image_url` (Firebase copy) | 5,872 |
| `firebase_path` | 5,872 |
| `owner`, `license`, `title` | populated |

Spot-checked 2026-08-28: both the Firebase and the live Flickr URLs return
`200 image/jpeg`. Nothing has rotted. Any rating can be traced to a specific,
viewable, attributable photograph.

5,767 of the 5,872 carry `llm_quality` (105 unrated — failures from the
2026-05-12 rating run).

**What past training runs used is recoverable — but only from the saved
manifests, not by recomputation.** Each run's
`ml/artifacts/experiments/<run>/dataset/<ts>/manifest_*.csv` records the exact
`snapshot_id` → split assignment, and those files are committed. Flickr appears
only in the v4 runs (5,767 rows each); the v2 manifests predate the `source`
column and contain no external rows at all.

**Consequence of the `hash()` bug (§6):** comparing the two v4 runs'
manifests, **2,718 of 5,767 Flickr images (47.1%) landed in a different split**
between `20260513_113243_v4_regression_llm_with_flickr` and
`20260601_063518_v4_binary_llm_with_flickr`. That is what a full reshuffle
looks like — under 70/15/15, random reassignment predicts 46.5% moved.

So the v4 regression and v4 binary models were trained and tested on materially
different Flickr splits. Their metrics are **not comparable to each other** on
the external portion, and an image in one run's test set was very likely in the
other run's training set. Nothing is corrupt and no run leaked internally, but
any cross-run comparison involving Flickr made before the Task 2 fix should be
treated as unreliable.

---

## 8. Measured v4 baseline on gold (2026-08-28)

`ml/score_manifest.py` scoring the shipped v4 binary ONNX
(`20260601_063518_v4_binary_llm_with_flickr`) against the gold test split
(1,212 frames, 0 unreadable). Report:
`ml/artifacts/reports/v4_binary_on_gold_test.json`.

At the production threshold (0.5):

| slice | n | precision | recall | F1 | balanced acc | tp | fp | fn |
|---|---|---|---|---|---|---|---|---|
| overall | 1,212 | 0.304 | 0.066 | **0.109** | 0.477 | 34 | 78 | 480 |
| webcam | 1,165 | 0.250 | 0.054 | **0.089** | 0.470 | 26 | 78 | 457 |
| flickr | 47 | 1.000 | 0.258 | 0.410 | 0.629 | 8 | 0 | 23 |

**v4 finds 26 of 483 operator-confirmed webcam sunsets — it misses 94.6% of
them.** Its balanced accuracy on webcam frames is 0.470: below chance.

**This is not miscalibration.** Across the full 0.10–0.90 threshold sweep,
balanced accuracy never leaves the 0.466–0.509 band and best F1 is 0.234 at
the most permissive threshold. There is no operating point at which the
model is useful on operator-defined sunsets; the signal isn't there to
recalibrate.

The per-source split is the tell: precision 1.000 on Flickr versus 0.250 on
webcam. The model learned to recognize Flickr photographs, exactly as §3
predicted from its 36 positive webcam training examples.

**This is the number v5 must beat.** v4's self-reported F1 of 0.836 is not
a valid baseline — it was measured against LLM labels on a test set with 4
positive webcam frames.

---

## 9. v5 results (2026-08-29)

All three runs export from `--label-source gold` with seed 20260212, so they
share a byte-identical test split (1,212 rows; verified symmetric difference
0 against the v4 baseline manifest). Every number below is therefore directly
comparable to §8.

### is-sunset head

| | v4 | v5 gold-only | v5 + medium aug |
|---|---|---|---|
| precision | 0.304 | 0.913 | 0.934 |
| recall | 0.066 | 0.839 | 0.831 |
| **F1** | **0.109** | **0.874** | **0.880** |
| balanced acc | 0.477 | 0.890 | 0.894 |
| AUC | — | 0.963 | 0.966 |
| sunsets found | 34 / 514 | 431 / 514 | 427 / 514 |

v4 found 34 of 514 operator-confirmed sunsets; v5 finds 431. Runs:
`20260829_062437_v5_binary_gold`, `20260829_073754_v5_binary_gold_aug`.

### quality head

`20260829_070702_v5_regression_gold` — MAE 0.112 (≈ ±0.45 rating points),
RMSE 0.174, Pearson 0.854, Spearman 0.780, R² 0.724.

Not comparable to v4 regression's Pearson: that was measured against LLM
labels, this against operator labels.

**Two heads beat one.** The regression head's derived binary sweep peaks at
F1 0.840 (threshold 0.30), below the dedicated is-sunset head's 0.874. The
v2–v4 approach of thresholding a single quality score is measurably worse
than predicting the two things separately.

### The overfitting is real and augmentation did not fix it

The +0.005 F1 from `medium` augmentation is 4 true positives and 11 false
positives on 1,212 rows from a single seed — inside run-to-run noise, not a
result.

The diagnostic worth keeping: **validation loss bottoms at epoch 2 in both
runs**, then climbs (0.325 → 0.630 light, 0.317 → 0.674 medium) while train
loss falls to ~0.014. Everything after epoch 2 is memorization. Early
stopping watches val F1, which keeps improving to ~epoch 11, so it never
catches this.

Doubling ColorJitter was never likely to help, and colour is the signal for
sunset detection. The binding constraint is 5,897 training images against a
ResNet-18 fine-tune. **This argues for Task 9 (LLM pretrain → gold
fine-tune) — more data — rather than further augmentation tuning.** Other
untried knobs: freezing more backbone layers, weight decay, or widening
`cropping.scale_min` from its current 0.95 (near-zero crop).

**Recommendation: do not ship v5 on these runs alone.** 0.874 with a clear
memorization signature may not hold up on cameras outside the gold set.
Run Task 9 first, and compare on this same split.

---

## 10. Ordinary-frame holdout — v5 does NOT transfer (2026-08-29)

**Verdict: YELLOW, narrowly.** Criteria were fixed before the run in
`docs/superpowers/plans/2026-08-29-v5-holdout-check-and-pretrain.md`.

The gold set is **99.3% hard cases** (8,162 of 8,220 webcam labels came from
the disagreement queue), and only 8,281 of 55,414 imaged frames have ever been
flagged hard. So §9's numbers describe the hardest ~15% of the corpus. This
measures the other 85%.

Sample: 2,000 ordinary frames (`ml/build_holdout_manifest.py`) — excluding
`manual_labels`, anything with a `model_disagreement_kind`, and every camera in
the gold train/val splits. 625 unseen cameras, 43.0% positive per Claude
(vs the gold set's 41.4%, so base rates are comparable).

| | gold test (hard) | ordinary holdout |
|---|---|---|
| precision | 0.913 | **0.574** |
| recall | 0.839 | 0.731 |
| F1 | 0.874 | **0.643** |
| balanced accuracy | 0.890 | **0.661** |
| predicted positive rate | 0.424 (actual 0.424) | **0.547** (actual 0.430) |

**F1 0.874 does not transfer. On ordinary frames it is 0.643**, and when v5
says "sunset" it is right 57% of the time rather than 91%.

### The failure is real, not a Claude artifact

The mandatory eyeball step (plan Task 1b) was run. On the **466 false
positives**, Claude's quality is median **0.000**, mean 0.004, max 0.100 — 443
of 466 sit at exactly zero. Claude is not hedging on these; it is emphatically
certain, and confident negatives are where it is most reliable (its known blind
spot is *under-rating real sunsets*, not over-rejecting non-sunsets).

Three of the most confident false positives were opened and inspected. All were
**flat blue-hour twilight over snow** (two from the same camera on consecutive
days at ~08:30). Model score 1.000; not sunsets. **v5 is wrong, Claude is
right** — no upward revision of the tier is warranted.

### Why, and what it implies

The gold set's negatives are *hard* negatives — frames that looked sunset-ish
enough to trip the disagreement queue. An ordinary boring blue-hour frame never
enters that queue, so **v5 never learned what "clearly nothing happening" looks
like.** It appears to have learned "low-light coloured sky ⇒ sunset" without
learning to separate sunset colour from blue hour.

The failure is broad, not camera-specific: 236 of 625 sampled cameras produce
at least one false positive and the top-10 account for only 23% of them. So the
fix is training-data coverage, not per-camera handling.

**This is the strongest argument yet for Task 9 / the pretrain** — and for the
right reason. The 46,079 LLM-labeled frames include 25,018 negatives, mostly
ordinary ones. The pretrain's value is *distribution coverage*, not volume, and
not overfitting repair.

**Do not ship v5 gold-only at any threshold.** Its precision on the frames
production actually sees is 0.574.

---

## 11. Environment state

`.venv/bin/python3.11` symlinks to `/usr/local/opt/python@3.11/bin/python3.11`,
which no longer exists — the Intel Homebrew prefix is gone (there is a
`.venv.intel.bak` alongside it). `/opt/homebrew/bin/python3.11` is available.
The venv must be rebuilt on arm64, and `torch==2.2.2` / `torchvision==0.17.2`
pinned in `ml/requirements.txt` need an arm64 cp311 wheel check.

**Image cache:** 7,956 of the 8,564 gold image URLs are not in
`ml/artifacts/image_cache/` (30,751 files, 1.2 GB). Budget a download warm-up
before the first gold run.

**Runtime reference:** the v4 binary run took 2h13m on CPU for 24,142 training
images over 45 epochs (~176 s/epoch). A gold-only run (~6k train images) should
land near 35–45 minutes once cached.
