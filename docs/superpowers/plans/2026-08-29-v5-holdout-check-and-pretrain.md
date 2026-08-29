# v5 Holdout Check + LLM Pretrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan is self-contained.** It is written for a fresh session with no
> prior context. Everything needed is below or in the two linked documents.

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

## Task 1: Score v5 on ordinary frames

**Files:**
- Read: `ml/artifacts/datasets/holdout_ordinary/manifest_test.csv` (2,000 frames, 625 unseen cameras, 43.0% positive per Claude — already built)
- Create: `ml/artifacts/reports/v5_binary_on_ordinary_holdout.json`

The manifest excludes anything in `manual_labels`, anything with a
`model_disagreement_kind`, and every camera in the gold train/val splits. So a
good score cannot come from memorized cameras or from re-seeing hard cases.

- [ ] **Step 1: Run the scoring** (may already be done — check for the report first)

```bash
.venv/bin/python -u ml/score_manifest.py \
  --manifest ml/artifacts/datasets/holdout_ordinary/manifest_test.csv \
  --onnx ml/artifacts/models/binary_resnet18/20260829_062437_v5_binary_gold/model.onnx \
  --output ml/artifacts/reports/v5_binary_on_ordinary_holdout.json \
  --no-progress
```

2,000 images, most uncached — expect 20–40 minutes. Run it with
`run_in_background: true`.

- [ ] **Step 2: Read the result against the criteria in the next section**

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

- [ ] **Step 3: Commit the report**

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
