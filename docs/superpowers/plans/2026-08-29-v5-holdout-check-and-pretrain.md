# v5 Holdout Check + LLM Pretrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is self-contained.** It is written for a fresh session with no
> prior context. Everything needed is below or in the two linked documents.


> **RESULT IN — Task 1 is DONE. Verdict: YELLOW (narrowly). Start at Task 2.**
>
> | | gold test (hard) | ordinary holdout |
> |---|---|---|
> | precision | 0.913 | **0.574** |
> | F1 | 0.874 | **0.643** |
> | balanced accuracy | 0.890 | **0.661** (RED line is 0.65) |
> | predicted positive rate | 0.424 | **0.547** (GREEN band 0.33–0.53) |
>
> Task 1b was run and **v5 is wrong, not Claude**: on the 466 false positives
> Claude's quality is median 0.000 / max 0.100, and three inspected by eye were
> flat blue-hour twilight over snow scored 1.000. No upward revision.
>
> v5 over-fires on ordinary non-sunsets because the gold set's negatives are all
> *hard* negatives — it never saw a boring frame. Broad, not camera-specific
> (236 of 625 cameras affected; top-10 = 23% of errors).
>
> **Do not ship v5 gold-only at any threshold** (precision 0.574 in production
> conditions). Task 2's pretrain is now a repair for a diagnosed defect, and
> Step 5 — re-running the ordinary-frame check — is the number that decides it.
> Report: `ml/artifacts/reports/v5_binary_on_ordinary_holdout.json`. Detail in
> design spec §10.

> **UPDATE 2026-08-29 (later): root cause found — START AT TASK 0, NOT TASK 2.**
>
> §10's "distribution gap" reading was incomplete. v5's score on the gold test
> split rises monotonically with the operator rating (N 0.437 → 1: 0.658 →
> 2: 0.812 → 3: 0.936 → 4: 0.974 → 5: 0.983). **The model learned the rubric.**
>
> The defect is the *target*. Operator rating **1** means "a sunset is happening
> and there is nothing to see" (dusk over a field) and it writes
> `is_sunset = true`. Training the binary head on `is_sunset` teaches that dim,
> colourless scenes are positives — which it then applies to ordinary blue-hour
> frames. `docs/ml/rating-rubric.md` already said the product question is
> "would I want this surfaced" = **rating ≥ 4**, not `is_sunset`.
>
> **Task 0 below is a 40-minute config change that may resolve this without the
> multi-hour pretrain. Do it first.** Detail: design spec §11.

**Goal:** Find out whether the gold-trained v5 is-sunset head behaves sanely on *ordinary* frames (not just the hard cases it was trained on), then decide — against criteria fixed in advance — whether to run the 52k LLM-pretrain variant.

**Architecture:** No new training code. Task 1 scores the existing v5 ONNX against a random sample of ordinary frames using `ml/score_manifest.py` + `ml/build_holdout_manifest.py`, both already built. Tasks 2–4 branch on that result. The pretrain reuses `--llm-label-source db` + `--binary-label-from is_sunset` and `train.py --init-checkpoint`, all already shipped.

**Tech Stack:** Python 3.11 arm64 venv at `.venv` (already built), PyTorch 2.2.2, ONNX Runtime, Postgres (Neon) via `DATABASE_URL` in `.env.local`.

**Spec:** `docs/superpowers/specs/2026-08-28-v5-gold-label-retrain-design.md`
**Prior plan (Tasks 1–8 complete):** `docs/superpowers/plans/2026-08-28-v5-gold-label-retrain.md`

---

## Where things stand (read this first)

Branch: **`feat/kiosk-url-tuning`**, ~22 commits ahead of `main`, all `ml/`-scoped
and cherry-pickable onto a clean branch. **Do not switch branches** — Jesse runs
parallel sessions in this one checkout. Verify with
`git rev-parse --abbrev-ref HEAD` before every commit and **stage explicit paths,
never `git add -A`.**

Already done and committed:

| Thing | Where |
|---|---|
| `--label-source gold` (reads `manual_labels`) | `ml/export_dataset.py` |
| `--binary-label-from is_sunset` | `ml/export_dataset.py`, `ml/common/labels.py` |
| `--llm-label-source db` (46k frames + `llm_is_sunset`) | `ml/export_dataset.py` |
| `--init-checkpoint` warm start | `ml/train.py` |
| Score any manifest with any ONNX | `ml/score_manifest.py` |
| Sample ordinary (non-hard) frames | `ml/build_holdout_manifest.py` |
| v5 gold-only binary run | `ml/artifacts/experiments/20260829_062437_v5_binary_gold` |
| v5 gold-only quality run | `ml/artifacts/experiments/20260829_070702_v5_regression_gold` |
| v5 binary ONNX | `ml/artifacts/models/binary_resnet18/20260829_062437_v5_binary_gold/model.onnx` |

**Measured so far**, on a byte-identical 1,212-row gold test split:

| | v4 | v5 gold-only |
|---|---|---|
| F1 | 0.109 | **0.874** |
| precision | 0.304 | 0.913 |
| recall | 0.066 | 0.839 |
| balanced acc | 0.477 | 0.890 |

**The open question this plan answers.** 8,162 of 8,220 webcam gold labels
(99.3%) came from the Hard Examples disagreement queue, and only 8,281 of
55,414 imaged frames have ever been flagged hard. So v5 was trained and tested
on roughly the hardest 15% of the corpus and has **never been measured on the
other 85%** — which is what production actually sees.

Two things that are already settled, so nobody re-litigates them:

- **Camera generalization is tested and passed.** Splits group by `webcam_id`;
  the gold export has 730 train / 179 val / 146 test cameras with **zero
  intersection**. v5's 0.874 is on cameras it never trained on.
- **The overfitting is calibration drift, not broken discrimination.**
  Validation loss climbs after epoch 2, but validation F1 and AUC (0.963) hold.
  It matters for choosing a decision threshold; it does not mean 0.874 is fake.
  A `medium`-augmentation A/B moved F1 by +0.005 — inside single-seed noise —
  and did not change the curve.

---

## Environment setup (every task assumes this)

```bash
cd /Users/jessekauppila/GitHub/the-sunset-webcam-map
.venv/bin/python --version   # expect Python 3.11.15
```

Scripts that hit the database take `--database-url`. Extract it without
tripping up on quoting:

```bash
DBURL=$(.venv/bin/python -c "
import re
for l in open('.env.local'):
    m = re.match(r'^DATABASE_URL=(.*)', l.strip())
    if m: print(m.group(1).strip().strip('\"').strip(\"'\")); break
")
```

`ml/run_training.py` reads `DATABASE_URL` from `.env.local` itself — no flag needed.

Run Python tests with `unittest` from the repo root:
`.venv/bin/python -m unittest ml.test_export_dataset ml.test_score_manifest -v`

## Global Constraints

- **`binary_threshold` compares against normalized [0,1] labels, not raw 1–5 ratings.** 0.75 ≈ "rating ≥ 4".
- **Splits group by `webcam_id`**, never by frame.
- **`llm_is_sunset` is not ground truth.** On the 1,224 gold/LLM overlap frames Claude disagreed with the operator 211 times (141 Claude-yes/operator-no, 70 the reverse, 13 of those rated 4–5 and scored ~0.0). Use it for gross-failure detection only.
- **Never let an ML fallback masquerade as real model output.** Verify deploys by smoke `latencyMs` (real ONNX 100–500 ms, baseline 10–20 ms) and a near-zero `fallbacks` count.
- **`vercel env add/rm` is classifier-blocked in Claude Code** — hand those to Jesse. Env vars bake in at deploy time; use `vercel redeploy`, not `vercel --prod`.
- Long training runs: use `.venv/bin/python -u` so epoch lines reach the log unbuffered.

---

## Task 0: Retrain the binary head on a rating threshold (DO THIS FIRST)

~40 minutes. No relabeling, no Claude re-run — the 1–5 ratings already encode
the distinction, so only the label derivation changes.

**Files:**
- Modify: `ml/export_dataset.py` (`--binary-label-from`, `build_gold_manifest`)
- Modify: `ml/common/labels.py` (`resolve_binary_label`)
- Modify: `ml/test_export_dataset.py`
- Create: `ml/configs/v5_binary_gold_r3.yaml`, `ml/configs/v5_binary_gold_r4.yaml`

Verified gold-set class counts:

| positive class | positives | negatives |
|---|---|---|
| `is_sunset` (rating ≥ 1) — current | 3,546 | 5,018 |
| rating ≥ 2 | 3,020 | 5,544 |
| **rating ≥ 3** | **2,370** | **6,194** |
| rating ≥ 4 | 1,375 | 7,189 |

- [ ] **Step 1: Write the failing test**

Add to `ml/test_export_dataset.py`:

```python
class TestMinRatingBinaryLabel(unittest.TestCase):
    """rating>=N mode: a sunset only counts if it cleared the bar.

    Operator rating 1 means "a sunset is happening and there is nothing to
    see", so is_sunset=true is too permissive a positive class for the
    product. See docs/ml/rating-rubric.md.
    """

    def policy(self, n):
        return LabelPolicy(target_type="binary", binary_label_from="min_rating",
                           min_positive_rating=n)

    def test_rating_below_the_bar_is_negative(self):
        self.assertEqual(
            resolve_binary_label(None, True, self.policy(3), rating=1), 0)
        self.assertEqual(
            resolve_binary_label(None, True, self.policy(3), rating=2), 0)

    def test_rating_at_or_above_the_bar_is_positive(self):
        self.assertEqual(
            resolve_binary_label(None, True, self.policy(3), rating=3), 1)
        self.assertEqual(
            resolve_binary_label(None, True, self.policy(3), rating=5), 1)

    def test_not_a_sunset_is_negative_regardless(self):
        self.assertEqual(
            resolve_binary_label(None, False, self.policy(3), rating=None), 0)

    def test_a_sunset_with_no_rating_raises(self):
        # Never silently treat a missing rating as below the bar.
        with self.assertRaises(ValueError):
            resolve_binary_label(None, True, self.policy(3), rating=None)
```

- [ ] **Step 2: Run it, confirm it fails**

`.venv/bin/python -m unittest ml.test_export_dataset -v`

- [ ] **Step 3: Implement**

Add `min_positive_rating: int = 4` to `LabelPolicy`; add `"min_rating"` to the
`--binary-label-from` choices and a `--min-positive-rating` int flag (default 4);
give `resolve_binary_label` a `rating: int | None = None` keyword and this branch:

```python
    if policy.binary_label_from == "min_rating":
        if not is_sunset:
            return 0
        if rating is None:
            raise ValueError(
                "binary_label_from=min_rating requires a rating for a sunset; "
                "refusing to treat a missing rating as below the bar"
            )
        return 1 if int(rating) >= policy.min_positive_rating else 0
```

In `build_gold_manifest`, pass `rating=row["rating"]` through. Add the
passthrough in `ml/run_experiment.py` for `data.min_positive_rating`.

- [ ] **Step 4: Train both variants**

Copy `ml/configs/v5_binary_gold.yaml` twice, changing only `run.name`,
`data.binary_label_from: min_rating`, and `data.min_positive_rating` (3, then 4).
Consider `imbalance.class_weighting: balanced` for the r4 variant — 1,375 vs
7,189 is a 5:1 imbalance, unlike the near-balanced `is_sunset` split.

```bash
.venv/bin/python -u ml/run_training.py --config ml/configs/v5_binary_gold_r3.yaml --no-progress
.venv/bin/python -u ml/run_training.py --config ml/configs/v5_binary_gold_r4.yaml --no-progress
```

- [ ] **Step 5: Export each to ONNX and re-run the ordinary-frame check**

This is the decisive number. **Caveat: `llm_is_sunset` is a different question
than a rating threshold** (spec §11), so it will understate an r3/r4 model even
more than it understated the `is_sunset` one. Read `precision` and the
predicted-positive-rate trend across the three models rather than any absolute
value — if precision climbs from 0.574 as the bar rises, the diagnosis is
confirmed.

- [ ] **Step 6: If precision improves, go to Task 5 (operator spot-check) to get
      an unconfounded number. If it does not, the distribution reading was right
      after all — go to Task 2.**

---

## Task 5: Operator spot-check — the only unconfounded measurement

~10 minutes of Jesse's time; nothing else resolves the definitional confound.

- [ ] **Step 1: Sample 50 frames the model calls sunset and Claude calls not**

```bash
.venv/bin/python -c "
import csv, sys, json
import numpy as np, onnxruntime as ort
from pathlib import Path
sys.path.insert(0,'ml')
from score_manifest import load_image, softmax_positive
sess = ort.InferenceSession('<MODEL>.onnx'); name = sess.get_inputs()[0].name
rows = list(csv.DictReader(open('ml/artifacts/datasets/holdout_ordinary/manifest_test.csv')))
out = []
for r in rows:
    a = load_image(r['image_path_or_url'], Path('ml/artifacts/image_cache'))
    if a is None: continue
    s = softmax_positive(np.asarray(sess.run(None, {name: a})[0][0], dtype=np.float32))
    if int(r['target_label']) == 0 and s >= 0.5:
        out.append({'url': r['image_path_or_url'], 'model': round(s,3)})
print(json.dumps(out[:50], indent=2))
" > ml/artifacts/reports/spot_check_frames.json
```

- [ ] **Step 2: Have Jesse rate those 50 on the same N/1–5 scale.**

- [ ] **Step 3: Recompute precision against HIS labels, not Claude's.**
      If most are 1s → definitional mismatch, and a rating threshold fixes it.
      If most are N → genuine error, and the pretrain (Task 2) is the fix.
      Record the answer in spec §11; it decides everything downstream.

---

## Task 1: Score v5 on ordinary frames

**Files:**
- Read: `ml/artifacts/datasets/holdout_ordinary/manifest_test.csv` (2,000 frames, 625 unseen cameras, 43.0% positive per Claude — already built)
- Create: `ml/artifacts/reports/v5_binary_on_ordinary_holdout.json`

The manifest excludes anything in `manual_labels`, anything with a
`model_disagreement_kind`, and every camera in the gold train/val splits. So a
good score cannot come from memorized cameras or from re-seeing hard cases.

- [x] **Step 1: Run the scoring** (may already be done — check for the report first)

```bash
.venv/bin/python -u ml/score_manifest.py \
  --manifest ml/artifacts/datasets/holdout_ordinary/manifest_test.csv \
  --onnx ml/artifacts/models/binary_resnet18/20260829_062437_v5_binary_gold/model.onnx \
  --output ml/artifacts/reports/v5_binary_on_ordinary_holdout.json \
  --no-progress
```

2,000 images, most uncached — expect 20–40 minutes. Run it with
`run_in_background: true`.

- [x] **Step 2: Read the result against the criteria in the next section**

```bash
.venv/bin/python -c "
import json
r = json.load(open('ml/artifacts/reports/v5_binary_on_ordinary_holdout.json'))
m = r['overall']
print('n=%d  P=%.3f R=%.3f F1=%.3f balacc=%.3f' % (
    m['count'], m['precision'], m['recall'], m['f1'], m['balanced_accuracy']))
print('confusion', m['confusion'])
c = m['confusion']
pred_pos = (c['tp'] + c['fp']) / m['count']
print('predicted positive rate %.3f vs Claude base rate 0.430' % pred_pos)
"
```

- [x] **Step 3: Commit the report**

```bash
git rev-parse --abbrev-ref HEAD
git add ml/artifacts/reports/v5_binary_on_ordinary_holdout.json \
        ml/artifacts/datasets/holdout_ordinary ml/build_holdout_manifest.py
git commit -m "test(ml): score v5 gold head on 2,000 ordinary frames"
```

---

## Decision criteria — FIXED IN ADVANCE, do not renegotiate after seeing numbers

Read against `overall` at threshold 0.5. **`ppr`** = predicted positive rate;
Claude's base rate on this sample is **0.430**.

### GREEN — v5 behaves sanely on ordinary frames

**balanced accuracy ≥ 0.80 AND `ppr` within 0.33–0.53** (base rate ±0.10).

Means: no distribution shock. The hard-case training did not distort behavior
on the common case. → **Go to Task 2** (pretrain as an upside play), and v5
becomes a plausible ship candidate after threshold tuning.

### YELLOW — usable but skewed

**balanced accuracy 0.65–0.80, OR `ppr` outside 0.33–0.53 but within 0.25–0.65.**

Means: it works but its operating point is off, most likely because the gold
set's difficulty mix taught it a bad prior. → **Task 2 first**, then Task 3.
Do not ship gold-only.

### RED — training only on hard cases broke the common case

**balanced accuracy < 0.65, OR `ppr` outside 0.25–0.65.**

Means: the model is not fit for production regardless of its 0.874. → **Skip
Task 2's pure pretrain→finetune and go to Task 4** (mixed training set), which
attacks the distribution problem directly. **Do not ship v5 gold-only under any
threshold.**

### Before acting on YELLOW or RED — Task 1b, mandatory

A low score against Claude is **ambiguous**: v5 may be wrong, or Claude may be.
Claude's known silhouette blind spot means disagreement is not automatically
the model's fault. Eyeball before concluding.

- [ ] **Dump the 40 largest disagreements for human review**

```bash
.venv/bin/python -c "
import csv, json
import numpy as np, onnxruntime as ort
from pathlib import Path
import sys; sys.path.insert(0, 'ml')
from score_manifest import load_image, softmax_positive
sess = ort.InferenceSession('ml/artifacts/models/binary_resnet18/20260829_062437_v5_binary_gold/model.onnx')
name = sess.get_inputs()[0].name
rows = list(csv.DictReader(open('ml/artifacts/datasets/holdout_ordinary/manifest_test.csv')))
out = []
for r in rows:
    a = load_image(r['image_path_or_url'], Path('ml/artifacts/image_cache'))
    if a is None: continue
    s = softmax_positive(np.asarray(sess.run(None, {name: a})[0][0], dtype=np.float32))
    t = int(r['target_label'])
    out.append((abs(s - t), s, t, r['image_path_or_url'], r['llm_quality']))
out.sort(reverse=True)
for d, s, t, u, q in out[:40]:
    print(f'model={s:.3f} claude_is_sunset={t} claude_quality={q}  {u}')
" | tee ml/artifacts/reports/v5_holdout_disagreements.txt
```

Open a dozen of those URLs. Ask: **is the model wrong, or is Claude?** If the
model is clearly right on most of them, the balanced-accuracy number understates
v5 and the tier should be revised upward — record that judgment and the frames
that justified it in the spec before proceeding.

---

## Task 2: LLM pretrain → gold fine-tune (GREEN or YELLOW only)

Two stages. Stage 1 learns from ~52k broadly-sampled LLM labels — the first
time the model sees the easy majority. Stage 2 fine-tunes on the gold set,
which wins every conflict because it is the adjudicated label.

**Files:**
- Create: `ml/configs/v5_binary_llm_pretrain.yaml`
- Create: `ml/configs/v5_binary_gold_finetune.yaml`

- [ ] **Step 1: Write the pretrain config**

`ml/configs/v5_binary_llm_pretrain.yaml` — copy `ml/configs/v5_binary_gold.yaml`
and change exactly these keys:

```yaml
run:
  name: v5_binary_llm_pretrain
  notes: >
    Stage 1 of the mixed variant: pretrain the is-sunset head on Claude's
    llm_is_sunset labels (46,079 webcam + 5,767 Flickr) read from the DB,
    not the frozen 29,605-row CSV. This is the first time the model sees
    the ordinary-frame majority; the gold set is 99.3% hard cases.
    Stage 2 (v5_binary_gold_finetune) then fine-tunes on the operator gold
    labels, which win every conflict.
  tags: [v5, binary, is_sunset, llm_labels, pretrain]

data:
  label_source: manual_only
  label_merge_strategy: llm_only
  llm_label_source: db
  target_type: binary
  binary_label_from: is_sunset
  include_external: true
  external_categories: [sunset]

model:
  epochs: 25
  early_stopping_patience: 8
```

- [ ] **Step 2: Run stage 1**

```bash
.venv/bin/python -u ml/run_training.py \
  --config ml/configs/v5_binary_llm_pretrain.yaml --no-progress
```

**Before letting it train past the export step, confirm the export prints
~51,846 rows / ~25,689 positives.** If positives are in the thousands rather
than ~25k, `binary_label_from` is not reaching the export — stop and fix.

~52k images; budget 2–4 hours on CPU plus a large first-run image download.
Use `run_in_background: true` and a Monitor with a filter covering failures:
`grep -E "epoch|Traceback|Error|Killed|OOM"`.

- [ ] **Step 3: Write the fine-tune config**

Copy `ml/configs/v5_binary_gold.yaml` and change only:

```yaml
run:
  name: v5_binary_gold_finetune
  tags: [v5, binary, is_sunset, gold_labels, finetune]

model:
  learning_rate: 0.00002
  epochs: 30
  early_stopping_patience: 10
  init_checkpoint: ml/artifacts/experiments/<STAGE1_RUN_DIR>/train/best.pt
```

Fill `<STAGE1_RUN_DIR>` from Step 2's actual output directory. The head must
match — same `model.name`, `data.target_type` and `model.head_dropout` (0.3) —
or the load raises `Missing/Unexpected key(s)`, by design.

- [ ] **Step 4: Run stage 2 and compare**

```bash
.venv/bin/python -u ml/run_training.py \
  --config ml/configs/v5_binary_gold_finetune.yaml --no-progress

.venv/bin/python ml/compare_experiments.py --run-dirs \
  $(ls -dt ml/artifacts/experiments/*_v5_binary_gold | grep -v aug | head -1) \
  $(ls -dt ml/artifacts/experiments/*_v5_binary_gold_finetune | head -1)
```

Both export from `--label-source gold` with seed 20260212, so the test splits
are identical and the F1s compare directly.

- [ ] **Step 5: Re-run the ordinary-frame check on the fine-tuned model**

Export its ONNX, then repeat Task 1 Step 1 against it. **This is the number
that matters** — the whole point of the pretrain is ordinary-frame behavior.

```bash
.venv/bin/python ml/export_onnx_versioned.py \
  --run-dir <FINETUNE_RUN_DIR> --target-type binary --model-name resnet18
```

### What counts as success for Task 2

- **Clear win:** gold-test F1 ≥ 0.874 **and** ordinary-frame balanced accuracy
  improves over Task 1's. Ship candidate.
- **Partial:** ordinary-frame improves but gold-test F1 drops slightly. Usually
  the better production model — production is mostly ordinary frames. Say so
  explicitly rather than defaulting to the higher F1.
- **No gain:** neither improves. **Gold-only wins; that is a legitimate result,
  not a failure.** The design spec's D6 anticipated it. Ship gold-only and stop
  spending on the mixed variant.

---

## Task 3: Threshold selection (before any deploy)

`AI_BINARY_SUNSET_THRESHOLD` is currently 0.5, tuned for v4's
quality-threshold head. **The head's meaning changed**, so the value must be
re-derived — and because of the calibration drift, the default is unlikely to
be right.

- [ ] **Step 1: Read the sweep from BOTH the gold and ordinary reports**

Weight the **ordinary-frame** sweep more heavily: production is ~85% ordinary
frames. Pick for the product, not for F1 — a false "Sunset detected" popup is
more visible to a user than a miss.

- [ ] **Step 2: Record the choice, its sweep row, and the reasoning** in the
      design spec. A threshold with no recorded justification gets silently
      "fixed" later.

---

## Task 4: Mixed training set (RED path only)

Only if Task 1 came back RED. Pretrain→finetune can still leave the model tuned
to whatever it saw last; a genuinely mixed set attacks the distribution problem
head-on.

- [ ] **Step 1: Extend `ml/export_dataset.py` with `--label-source gold_plus_llm`**

Union the gold rows with an LLM-labeled sample of ordinary frames, gold winning
on any `snapshot_id` present in both. Add a `--llm-sample-size` flag (start at
20,000). Follow the existing `build_gold_manifest` structure, and add unit tests
to `ml/test_export_dataset.py` covering: gold wins conflicts, the sample
excludes gold ids, and split assignment still groups by camera.

- [ ] **Step 2: Train, then evaluate on BOTH** the gold test split and the
      ordinary holdout. Report both. A model that wins one and loses the other
      is a product decision, not a metrics decision — bring it to Jesse.

---

## Not in scope — needs Jesse

- **Deploy.** `vercel env add/rm` is classifier-blocked. Ship only after Task 3,
  and hand over the env var list plus `vercel redeploy`.
- **Retiring old ONNX artifacts.** The bundle sits near Vercel's 250 MB limit,
  so shipping a new model means `git rm`-ing a dead one — Jesse chooses which.
- **Calibrating `llm_quality` against gold ratings** so the ~46k LLM quality
  labels become usable for the regression head. Separate experiment; needs the
  gold-only quality baseline (MAE 0.112, Pearson 0.854) as its reference.
- **The 141 Claude-yes/operator-no frames** (avg quality 0.68). Worth eyeballing
  as a batch — a shared visual signature there is a rubric fix, not a model fix.
