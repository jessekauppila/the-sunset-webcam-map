---
title: "Sunset model work — current state and how it splits into sessions"
date: 2026-08-29
status: active
---

# Where the sunset model work stands

**Read this first in any new session.** It is the index: what is settled, what is
running, what is open, and which of the three workstreams a given question
belongs to.

Branch: the `feat/kiosk-url-tuning` work merged via PRs #81–#85; `main` is
current. The pretrain experiment lives on `measure/llm-pretrain-detection`.
Parallel sessions share this one checkout: verify with
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
- **Claude's PROMPT is consistent; Claude's OUTPUT is not.** One prompt
  (`v2_extended`) across all 51,846 ratings — but two judge models behind it,
  and they are not the same instrument (measured 2026-08-29):

  | judge | frames | mean quality | % called sunset |
  |---|---|---|---|
  | `claude-sonnet-4-5` | 29,705 (64%) | 0.166 | **35.9%** |
  | `claude-sonnet-5` | 16,374 (36%) | 0.230 | **63.6%** |

  On the 200-frame operator eval set, `sonnet-5` scores precision 0.737 /
  Pearson 0.717 against `sonnet-4-5`'s 0.477 / 0.478. **Treat `llm_model` as a
  covariate** — record it, stratify by it, never pool the two blindly. (This
  does not overturn the ordinary-vs-hard-case finding: the hard-case overlap is
  70% `sonnet-5`, the *better* judge, and still scored 0.243.)
- **`llm_is_sunset` asks a different question than the operator rubric.**
  Claude: "is a sunset OR sunrise **visible**"; operator `N`: "not a sunset
  **event** at all", with rating 1 = "sunset is happening, frame has nothing".
  They disagree by construction on ratings 1–2. Measured effect (CORRECTED
  2026-08-30, fixed pipeline): Claude-grading **understates** the detection
  head — F1 0.647 vs Claude on the holdout against its real 0.816 vs the
  operator, because Claude calls ~2x as many frames sunsets (82 vs 53 on the
  200) and punishes the model's correct negatives as misses. (The one-day-old
  "flatters" claim was itself a broken-pipeline artifact.)
- **Claude's quality scale is monotonic but compressed.** Rubric anchors say
  1≈0.05, 3≈0.50, 5≈0.95; measured means are 1: 0.257, 3: 0.441, 5: 0.600 —
  squeezed into ~[0.09, 0.60]. Never threshold raw `llm_quality` against a
  rubric-derived number; that is the mechanism behind the v4 bug (`≥ 0.75`
  fired on 90 of 46,079 webcam rows).
- **The legacy `webcam_snapshot_ratings` set (4,776 rows) is retired and
  incompatible** — its UI had no "not a sunset" button, so 62% are rated 1,
  absorbing both meanings. It fed v2 only. Never union it with `manual_labels`.
- **Flickr identity is fully intact** — `source_id`, `original_url`, `owner`,
  `license`, Firebase copy; all URLs still resolve.

## Open questions

**Questions 1 and 2 were SETTLED on 2026-08-29** by 200 operator labels on the
random ordinary sample (`random_ordinary_v1`). Measurements below.

0. **⚠️ SCORING-PIPELINE BUG, found and fixed 2026-08-30.** Every number
   `ml/score_manifest.py` ever produced (v5 "0.643 ordinary", v4 "0.109",
   the first operator-truth pass "0.533/0.393") fed the model inputs with
   **ImageNet mean/std normalization that training never applies**
   (train.py:360 is Resize+ToTensor only). Fixed; verified to reproduce
   `evaluate.py` predictions to 5 decimals. **Production
   (`imagePreprocess.ts`) still has the same bug** — every deployed model
   has always run on shifted inputs. Fixing prod is now a top Workstream 3
   item (redeploy + re-derive threshold).
1. ~~How much of the ordinary-frame failure is real?~~ **Mostly none of it —
   the "does not transfer / over-fires" blocker was the preprocessing
   artifact above.** Corrected, against operator truth on the 200:
   v5 `is_sunset` head **precision 0.840 / recall 0.792 / F1 0.816**,
   firing on 50 frames where the operator says 53. Against `llm_is_sunset`
   on the 2,000-frame holdout (corrected): precision 0.952 / recall 0.490 /
   F1 0.647 — the low recall is largely Claude over-calling sunsets (82 vs
   the operator's 53 on the 200), not the model missing them.
   v4 re-scored with correct inputs: **F1 0.081** — still broken; that
   verdict survives (36 positive webcam training examples is the disease).
   A detector is not a ≥4 classifier: vs rating ≥ 4 truth v5 is precision
   0.160 (all 8 caught inside its 50 fires) — sizing is the quality head's
   job, which it now does well (see below).
2. ~~Is Claude's quality scale usable at all?~~ **Yes — far more than the
   hard-case number implied.** Pearson vs operator on the 53 operator-confirmed
   sunsets is **0.560**, against 0.243 on the 1,224 hard-case overlap. And the
   "flat across ratings 1–5" claim was an artifact of hard cases: on ordinary
   frames Claude's mean quality is **monotonic** — N 0.090, 1: 0.257, 2: 0.406,
   3: 0.441, 4: 0.493, 5: 0.600. Claude's detection on ordinary frames is
   precision 0.598 / recall 0.925 / **F1 0.726**, agreement 0.815.
3. ~~Does the LLM pretrain help?~~ **ANSWERED 2026-08-30: YES — the
   pretrained candidate clears the pre-registered bar. See the PRETRAIN
   VERDICT block below.** (Original framing kept for the record:)
   Largely **demotivated** by the corrected
   numbers: v5 now BEATS Claude on the production distribution (F1 0.816 vs
   0.726; the earlier "Claude beats v5" was the preprocessing artifact).
   The corrected quality head also beats Claude (Pearson 0.763 vs 0.560 on
   identical frames). The pretrain remains a possible marginal improvement,
   not a repair for a diagnosed defect — do not spend re-rating money on its
   behalf without a pre-registered bar it must clear. **The bar is now set
   (2026-08-30, on v1+v2 pooled): detection F1 > 0.797 AND quality Pearson
   > 0.697, gains under +0.02 counting as a wash — see the PRETRAIN BAR
   RESTATED block below.**

**Corrected quality-head result (the real headline).** On the 53
operator-rated ordinary sunsets: **MAE 0.170, Pearson 0.763** — better than
its own hard-case number (0.690), beating Claude on the same frames, and
calibrated almost linearly (rating 1→0.24, 2→0.42, 3→0.55, 4→0.69 against
anchors 0/.25/.50/.75; rating 5 is n=1).

**🚢 SHIPPING PAIR (decided 2026-08-30, retrain pass complete).** Both heads
were retrained on the quarantined export (+151 newest hard-case labels).
Verdict was split, so the pair is mixed:

- **Detection: KEEP `20260829_062437_v5_binary_gold`** — the retrain scored
  worse on the 200 (best F1 0.785 vs 0.828; single-seed noise or the extra
  hard negatives shifting the boundary — either way the old head wins).
- **Quality: TAKE the retrain `20260830_003808_v5_quality_sunsets_only`** —
  Pearson **0.820** vs 0.763, MAE 0.167 vs 0.170 on the 53 ordinary sunsets.

Composed (gate 0.55): Spearman **0.835**, still 5/147 false-shows and 8/8 of
the operator's ≥4 frames shown, rating-5 tile rises 0.57→0.65, and the top-8
tiles no longer contain an N frame — four operator-4s, four 3s.

**✅ v2 CONFIRMATION (2026-08-30, all 300 rated: N 218, 1:25, 2:18, 3:19,
4:16, 5:4).** The pair and the 0.55 gate HOLD — no decision reverses — but
every v1 headline was optimistic, as expected when moving from the data a
choice was made on to fresh confirmation data. Honest production estimates
are the v2 numbers:

| metric | v1 (decision data) | v2 (confirmation) |
|---|---|---|
| detection @0.55 prec / rec / F1 | 0.891 / 0.774 / ~0.83 | **0.843 / 0.720 / 0.776** |
| F1 plateau | 0.45–0.70 | 0.30–0.65 (max 0.797 @0.60 — noise-level gap) |
| quality Pearson / MAE (sunsets) | 0.820 / 0.167 (n=53) | **0.632 / 0.207** (n=82) |
| Claude Pearson, same frames | 0.560 | 0.488 (model still clearly ahead) |
| composed Spearman | 0.835 | **0.759** |
| false-shows | 5/147 (3.4%) | 11/218 (5.0%) |
| operator-≥4 shown | 8/8 | **19/20** |
| rating-1 hidden | 10/14 | 15/25 (design note still stands) |

Pick-confirmation on the rejected variants (checking the v1 decisions, not
re-deciding): the binary retrain scores F1 0.784 @0.55 vs the shipped
0.776, and the OLD quality head scores Pearson 0.649 vs the shipped 0.632 —
both within noise. The v1 "retrain quality wins 0.820 vs 0.763" gap does
not replicate; the two quality heads are equivalent, and no swap is
warranted (re-picking on confirmation data would just re-tune on it). Real
quality discrimination on ordinary sunsets sits near **0.63–0.70**, not 0.82.

Eyeball item: top-8 composed tiles contain two N frames, both webcam
**3656741** an hour apart (snapshots 85541 / 85789, tile 0.853) — one
camera fools both heads twice.

**📊 PRETRAIN BAR RESTATED (2026-08-30, v1+v2 pooled — supersedes the
0.816/0.820 bar, which was set on v1's optimistic numbers).** The shipping
pair on the full pooled 500-frame operator corpus (135 sunsets, 28 ≥4;
manifests in `ml/artifacts/datasets/random_ordinary_pooled_v1v2/`, reports
`ml/artifacts/reports/*_pooled500.json`):

- detection @0.55: prec 0.862 / rec 0.741 / **F1 0.797** (sweep flat
  0.789–0.805 across 0.30–0.70)
- quality: **Pearson 0.697** / MAE 0.191 (n=135; Claude 0.514 on the same
  frames)
- composed @0.55: Spearman 0.788, false-shows 16/365 (4.4%), 27/28 ≥4 shown

**Decision rule for the LLM pretrain (pre-registered):** rate-money is
spent only if a pretrained candidate, scored on these exact pooled
manifests through the same verified pipeline, exceeds **detection F1 0.797
AND quality Pearson 0.697**. Gains under **+0.02** are within single-seed
noise on this n and do not justify shipping (or the spend) on their own —
a candidate inside that band is a wash, not a win.

**🏁 PRETRAIN VERDICT (2026-08-30): the candidate CLEARS the bar — open
question 3 closes as "pretrain pays, with existing labels and zero API
spend."** Two-stage run: `20260830_061333_v5_binary_llm_pretrain` (51,346
LLM-labeled rows — 45,579 webcam + 5,767 Flickr, judge mix 68%
sonnet-4-5 / 32% sonnet-5 recorded per-row via the new `llm_model` manifest
column; best val F1 0.857 vs Claude's own labels) →
`20260830_082004_v5_binary_gold_llm_finetune` (identical gold export,
splits and seed as the shipping head — only the initialization differs;
gold-test F1 0.8855). ONNX parity vs evaluate.py verified to 1.6e-6 on 20
frames. Scored through the verified pipeline only, on the pooled 500:

| pooled 500, gate 0.55 | shipping head (the bar) | pretrain→finetune candidate |
|---|---|---|
| precision / recall | 0.862 / 0.741 | **0.910 / 0.748** |
| detection F1 | 0.797 | **0.821 (+0.024 — above the +0.02 wash band)** |
| sweep plateau | 0.789–0.805 (0.30–0.70) | **0.802–0.823 (0.25–0.60)** — plateau, not a lucky point |
| composed Spearman | 0.788 | **0.820** |
| false-shows | 16/365 (4.4%) | **10/365 (2.7%)** |
| operator-≥4 shown | 27/28 | 27/28 |
| top-8 N frames | 2 (both webcam 3656741) | **0** (seven 4s, one 2) |
| quality Pearson | 0.697 | 0.697 (same shipping quality head — untouched by design) |

The win is narrow on the registered metric (+0.024 against a ±0.02 noise
band) but corroborated by everything the bar did not require: the sweep sits
above the shipping head's across the whole plateau, false-shows nearly
halve, and the one named failure camera (3656741, both N frames at tile
0.853 under the shipping pair) is now rejected at p=0.001. The eyeball item
above is resolved by the candidate.

**What this does and does not authorize.** The candidate detection head is
the new ship candidate (Workstream 3 mechanics apply: bundle a new ONNX
dir, masterConfig + next.config.ts + `.vercelignore` in one change, retire
an old model dir, `vercel redeploy`, verify by DB version stamps). The gate
stays **0.55** — the candidate's sweep peaks at lower thresholds (0.850 at
0.10) but re-picking a threshold on the eval corpus would be tuning on
confirmation data. Re-rating spend stays PARKED: the rate-money rule
required detection AND quality to improve, and the quality head is
unchanged at 0.697 — the detection win came from labels we already owned.

**⚠️ V3 CONFIRMATION REVERSES THE DETECTION VERDICT (2026-08-30 evening,
all 200 `random_ordinary_v3` frames rated: N 155, 1:16, 2:9, 3:7, 4:9,
5:4).** On fresh data neither warm-started head had been selected on:

| v3 fresh, gate 0.55 | v6 warm-started pair | OLD detection + new quality (SHIPS) |
|---|---|---|
| detection F1 | **0.727** (from 0.821 on decision data) | **0.800** |
| quality Pearson (n=45) | 0.680 | 0.680 (same head) |
| composed Spearman | 0.710 | **0.800** |
| false-shows | 11/155 (7.1%) | **6/155 (3.9%)** |
| operator-≥4 shown | 12/13 | **13/13** |

The old detection head is *stable* across four independent eval sets
(0.816 → 0.776 → 0.797 → 0.800); the warm-started one cratered the moment
it left the pooled 500 it was selected on — its +0.024 "win" was
selection noise. Head-to-head on the 13 frames where they disagree, the
old head is right on 10 (sign test p≈0.09; every composed metric agrees).
The v3 sweep is FLAT (0.70–0.73 everywhere), so the pooled sweep's
lower-threshold hint also does not replicate — **the gate stays 0.55.**

**DECISION: detection ROLLS BACK to `20260829_062437_v5_binary_gold`;
quality KEEPS the warm-started `20260830_190519_v5_quality_llm_backbone_finetune`**
(its fresh-data edge held: Pearson 0.680 vs the old quality head's 0.653,
same sign as its pooled win). Open question 3's honest final answer:
**the pretrain pays for the QUALITY head only; for detection it was a
wash-at-best that pre-registration + fresh confirmation caught before it
cost anything.** This is the THIRD detection-head change that failed to
replicate (retrain 2026-08-30, warm start 2026-08-30 v3) — treat any
future detection "win" not confirmed on a fresh operator draw as noise.
Reports: `ml/artifacts/reports/*_random200_v3.json` (v6pair / oldpair /
mixedpair prefixes + `v6_binary_...` / `v5old_binary_...`).

**🏁 QUALITY HEAD TOO (2026-08-30, same day — but see the v3 REVERSAL
above: only the quality half survived confirmation): the backbone warm start
clears the quality bar as well — the full pair is now warm-started.**
Run `20260830_190519_v5_quality_llm_backbone_finetune`: identical recipe/
data/seed as the shipping quality head, backbone warm-started from the
same stage-1 pretrain via the new `--init-backbone-checkpoint` (loads
backbone only, head fresh, fail-loud on any other mismatch; tested).
Pre-registered bar: beat Pearson 0.697 on the pooled 500 sunsets, <+0.02
wash. Result: **Pearson 0.739 (+0.042), MAE 0.178 (vs 0.191)**, monotonic
mean-by-rating (1: 0.28 → 4: 0.69; the 5-dip is n=7). Composed with the
candidate detection head: Spearman 0.809, false-shows 10/365, 27/28 ≥4
shown, top-8 = six ≥4s + two 3s, zero N. (Composed Spearman 0.809 vs
0.820 with the old quality head is inside noise; the quality head's own
+0.042 is not.) **New ship candidate = BOTH warm-started heads.** Also
fixed en route: `ml/evaluate.py` had no image cache and no retry — one
network flap killed a whole eval; it now shares the sha256 cache with
train.py/score_manifest.py (byte-source only; decode/resize untouched,
ONNX parity re-verified 5e-7 on 20 frames).

Candidate reports: `ml/artifacts/reports/v5_llm_finetune_on_operator_pooled500.json`,
`..._reports/composed_on_operator_llm_finetune_pooled500.json`,
`..._reports/quality_head_on_operator_quality_warmstart_pooled500.json`,
`..._reports/composed_on_operator_quality_warmstart_pooled500.json`. A
quarantine hole was found and fixed on the way: the llm_only export leg
did NOT exclude `label_samples` (all 500 eval frames are LLM-rated and
would have entered the pretrain); `export_dataset.py` now applies the same
NOT EXISTS guard as the gold leg, verified 0/500 present in the export.

Reports: `ml/artifacts/reports/*_random300_v2.json`. Tooling now committed:
`ml/build_operator_manifest.py` (sample → manifest CSVs, refuses partial
exports) and `ml/eval_composed_operator.py` (quality + composed eval, reuses
the verified score_manifest preprocessing).

**Composed two-scale system, first pair, end-to-end on the 200 (2026-08-30).** Detection
gate 0.55 + quality head sizing: **5/147 operator-N frames wrongly shown
(3.4%)**; every operator ≥4 frame shown; mean tile quality escalates with the
operator rating (1→0.21, 2→0.42, 3→0.55, 4→0.69); **Spearman 0.829** between
composed tile size and the operator's own N/1–5 ordering. Top-8 tiles: four
operator-4s, three 3s, one N. Design note for Workstream 3: the gate hides
10/14 of the operator's rating-1 frames — if product intent is "show every
image, just small", below-gate frames should render minimal rather than
hidden. Detection threshold recommendation from the corrected sweep: **0.55**
(prec 0.891 / rec 0.774; F1 plateau 0.45–0.70, so not fragile).

**Additional trained variant, corrected:** r3 head (≥3 positives) vs its own
question: precision 0.621 / recall 0.818 / F1 0.706, 29 fires vs 22 true.
r4 head: training in flight (first run with the eval-quarantined export).

**Caveats on the 200.** Drawn from LLM-rated frames on cameras absent from the
gold train/val splits, so it measures the ordinary distribution on unseen
cameras, not literally every frame. n=53 for the quality Pearson and n=8 for
rating ≥ 4 — the r4 precision figure is directionally right but noisy.
Operator base rates: 26.5% sunsets, 4% rating ≥ 4.

Reports: `ml/artifacts/reports/v5_binary_on_operator_random200.json` and
`..._r4.json`. Manifests: `ml/artifacts/datasets/random_ordinary_v1/`.

---

## What's next (2026-08-31: Phase 0 RUN — ceiling reached, ceiling decomposed)

`2026-08-30-quality-ceiling-and-labeling-roadmap.md` is the follow-on plan.
Phase 0 has now been sat and analysed. Read that doc for the plan; this block
is the verdict.

**🏁 PHASE 0 VERDICT (retest_v1, 146 of 150 re-rated, 2026-08-31).**
`ml/artifacts/reports/retest_v1_ceiling.json`:

| | operator vs himself | shipping model |
|---|---|---|
| quality Pearson (n=73 sunset pairs) | **0.673** | 0.697 |
| quality MAE | 0.216 | 0.191 |
| detection self-F1 | **0.807** | ~0.80 |
| detection agreement / kappa | 0.760 / 0.515 | — |

Pre-registered rule: `gap = self-Pearson − model-Pearson ≤ 0.10` → **CEILING
REACHED** (gap −0.024). **Both heads are at or above the operator's own
reproducibility. The big labeling push (Phase 1) is cancelled and chasing
global metrics is over** — that decision is now measured, not felt.

**📐 THE CEILING IS NOT DIFFUSE — it decomposes into two named causes
(2026-08-31).** Every one of the 35 detection disagreements is either a 1↔N
call (21) or a frame from the 2026-08-08 labeling session (14). **Zero
residual**: on the 39 retest frames that are neither, agreement is 39/39.
The same two causes carry the quality churn. Corpus-reweighted, the label
noise the models actually see is `is_sunset` **13.6%** and `rating ≥ 4`
**12.6%** — and 4↔5 / 2↔3 wobble costs nothing, since neither crosses a
training threshold.

1. **Rating 4 is the noisiest label in the set** — 80% of frames rated 4
   come back with the opposite `rating ≥ 4` label; within the current rubric
   regime still 4 of 7, always drifting **down to a 3**, never to N.
   *Addressed 2026-08-31:* anchor frames chosen from the retest itself and
   written into `docs/ml/rating-rubric.md` ("Boundary sharpening"), with the
   two boundary tests now rendering on-glass in the queue legend. The
   sharpest anchor is a same-camera pair four days apart (webcam 28999873:
   snapshot **124555** = a 4, snapshot **123667** = a 3) — identical framing,
   so the only variable is the light.
2. **The 1/N line is a coin flip (45%)** but feeds only the frozen detection
   head, so it is worth ~2.8% corpus label noise. **Tested and rejected:
   showing solar elevation in the queue.** It does not separate the calls
   (1→1 median −7.6° vs 1→N −6.9°; a twilight-window rule agrees with the
   operator's own second call on 25/47 = chance) because the queue is
   *already* drawn from the sunset window, so "is a sunset occurring" is true
   of nearly every frame and carries no information. **Do not build it.** The
   fix is a definition change to something visible (usable sky vs not),
   already made in the rubric.

**⚠️ OPEN ACTION — the 2026-08-08 cohort is contaminated gold.** Of the 24
frames from that session originally rated 2/3/4/5, **zero came back at the
same rating and all 24 moved down**; 7 of 8 "4"s came back **N**. The N
labels from the same day are 94% stable, so the positive scale specifically
was shifted. Three independent signals say the *originals* are wrong: Claude
scores all seven 4→N frames at `llm_quality` 0.00–0.05; the frames are not
borderline (snapshot 115440 has **no sky in frame at all**; 83222 is flat
gray sea); and the moves are unanimously downward.

**⚠️ Correction to a first pass at this number (2026-08-31): the cohort is
much smaller than a naive count suggests, because the session was mostly
Flickr.** Its 592 labels split as webcam 452 `N` + **24 positives**, and
Flickr 36 `N` + 80 positives (76 rated 5). The retest draws webcam frames
only, so it covered all 24 webcam positives (every one overturned) and 33 of
the 452 webcam `N` (94% stable). The 80 Flickr positives are **untested**,
and a curated Flickr sunset rated 5 is most likely correct.

Evidenced contamination is therefore **24 labels, of which 10 cross
`rating ≥ 4`** and 12 flip `is_sunset` — **0.8%** of the 1,237 webcam `≥ 4`
gold labels, not the 6.1% that counting the whole cohort implies. Excluding
the cohort raises quality self-Pearson 0.673 → **0.751** and detection
self-F1 0.807 → **0.853**, but that describes the retest sample, not a
forecast of model gain (CEILING REACHED survives either way — 0.751 still
sits inside the 0.10 gap).

**DONE 2026-08-31 — no sitting was needed.** The retest had already re-rated
exactly those 24 frames blind, so the corrections were already paid for.
`ml/apply_label_corrections.py` (dry-run by default, `--apply` to write)
copies the retest ratings onto the gold rows and archives each original into
`manual_label_supersessions` in the same transaction — migration
`database/migrations/20260831_manual_label_supersessions.sql`. The script
refuses to touch any frame without a second-pass rating, so it can never
invent a correction; running it over the whole 476-row webcam cohort aborts
on the 419 unrated rows rather than correcting a subset.

**Expect no measurable metric change** — 24 labels in 9,118. This was worth
doing because the labels are demonstrably wrong (seven of the 4s have no sky
in frame), not because it buys accuracy. Do not use it to explain a future
number.

*Adjacent, deliberately not acted on:* Flickr supplies **194 of the 1,431
`rating ≥ 4` gold labels (13.6% of the positive class)**. Given the settled
"Flickr is fine-tune poison" finding from v4 (97.5%-Flickr positives → F1
0.08), whether hand-labeled Flickr gold belongs in the fine-tune export is
worth its own decision — the current gold export knowingly includes 344
Flickr rows.

**Gate on the next retrain (item 4 of the 2026-08-31 queue).** A
pre-registered quality retrain is *not* yet justified: item 1 sharpened the
rubric but has produced no new labels, and item 2 is blocked (below). The
precondition stands — a body of labels made under the sharpened 3/4 rule,
of which the 104-frame correction campaign would be the first tranche —
before proposing a warm-start recipe with `random_ordinary_v4` as the ship
gate.

**⛔ ITEM 2 (silhouette blind spot via custom cams) IS BLOCKED UPSTREAM —
there is no corpus to label.** Measured 2026-08-31:

- `cameras` holds two rows. Only **one** is paired (`webcam_id` 28800228);
  camera 2 still has `webcam_id = NULL` (the known tier0-seed pairing gap).
- That camera has **1,719 frames, all from a single ~2-hour burst on
  2026-06-13 evening** at ~3.7 s intervals, and nothing since 2026-06-14.
- **Zero** `manual_labels` rows exist on any custom-cam frame.
- The frames are **bring-up test shots, not sunsets**: the camera is on its
  side pointed up into a tree with half the frame occluded (see snapshots
  103343 / 104641). The model scoring them 0.005–0.081 is **correct**, not a
  blind-spot failure — so they are not even a valid exhibit of the problem.

The May-2026 memory note for this work is also stale in three of its five
steps: `manual_labels` already exists (no `manual_rating` column needed),
nothing is ever deleted (the retention exemption is moot), and the Hard
Examples queue already is the rating UI. **The only real remaining work is a
`label_samples` draw over custom-cam frames — which needs custom cams that
produce sunset frames.** That is the hardware thread
(`docs/hardware/`, edge-cam image path), not an ML-side wiring job. Revisit
when a custom camera has banked golden-hour frames across multiple evenings.

### Prior note (2026-08-30, superseded by the verdict above)

`2026-08-30-quality-ceiling-and-labeling-roadmap.md` is the follow-on plan:
Phase 0 measures the operator's own test–retest ceiling, which gates whether
a big detection-gated quality labeling push (Phase 1) is worth anything.
Detection stays frozen; Flickr stays out of fine-tune; images are not the
constraint, labels are.

**Phase 0 is built** (branch `feat/retest-draw`): the Hard Examples queue has
a third **Retest** toggle serving `retest_v1` — 150 already-rated frames,
blind, stratified (15 per rating 1–5, 40 N, 35 rating-1, stale-first, seed
20260830). Re-ratings go to the new `manual_label_retests` table, physically
separate from gold (`manual_labels` is UNIQUE(source,image_id) with an
ON CONFLICT DO UPDATE upsert — a retest through it would overwrite gold).
`label_samples.kind` distinguishes eval draws from retests, and the export
quarantine is scoped to `kind='draw'` so the retest frames' original labels
stay in training (counts verified unchanged). Next action is the operator's:
one blind sitting, then
`.venv/bin/python ml/analyze_retest.py --sample-name retest_v1` prints the
pre-registered ceiling verdict.

---

## The three workstreams

### Workstream 1 — Model training (the ML thread)

**State:** two-scale design implemented; runs in flight.

| run | status | result |
|---|---|---|
| `v5_binary_gold` (is_sunset) | done | F1 0.874 gold / **0.816 vs operator** (corrected pipeline) |
| `v5_binary_gold_aug` | done | +0.005, noise |
| `v5_regression_gold` (all rows) | done, superseded | MAE 0.112, Pearson 0.854 |
| `v5_binary_gold_r3` (rating ≥3) | done | F1 0.8354, balacc 0.8862, AUC 0.9559 |
| `v5_binary_gold_r4` (rating ≥4) | done 2026-08-30 (first quarantined export) | vs its own ≥4 question: prec 0.421 rec 1.000 @0.5, prec 0.571 @0.70 (n=8); vs ≥3: **F1 0.780** — beats the r3 head on r3's own question; fires 19/200 |
| `v5_quality_sunsets_only` | done | Pearson 0.690 gold / 0.763 vs operator on ordinary |
| `v5_binary_gold` retrain (quarantined export) | done 2026-08-30 | worse on the 200 (best F1 0.785) — not shipped |
| `v5_quality_sunsets_only` retrain (quarantined export) | done 2026-08-30 | **Pearson 0.820 vs operator — SHIPS** |
| `v5_binary_llm_pretrain` (stage 1, 51,346 LLM labels) | done 2026-08-30 | F1 0.878 vs Claude's held-out labels; feeder for the finetune |
| `v5_binary_gold_llm_finetune` (stage 2, warm start) | done 2026-08-30 | **F1 0.821 on pooled 500 — CLEARS the 0.797 bar; new ship candidate** |
| `v5_quality_llm_backbone_finetune` (backbone warm start) | done 2026-08-30 | **Pearson 0.739 on pooled 500 — CLEARS the 0.697 bar; pairs with the above** |

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

**DEPLOYED & VERIFIED in production, 2026-08-30 (~05:00 UTC).** The shipping
pair is live: within 3 minutes of the deploy going Ready, one cron tick
stamped 43 webcams with `20260829_062437_v5_binary_gold` +
`20260830_003808_v5_quality_sunsets_only` on the `webcams` table — and since
the unscored path writes no version strings, those stamps are proof of real
ONNX output. Build bundled `ml/artifacts/models: 85.26 MB` (functions
163.5 MB).

**The deploy failed once first — the `.vercelignore` trap.** PR #81's bundle
shipped model-less (78 MB functions): `.vercelignore` re-includes model dirs
by explicit version (`!ml/artifacts/models/.../<version>`), and those lines
still named the v4 dirs, so the v5 ONNX never reached the builder and
tracing had nothing to include. Every tick logged `Load model ... File
doesn't exist` and left frames unscored (fail-visible, as designed). Fixed
by PR #83, which also extends `next.config.test.ts` to check the
`.vercelignore` whitelist against masterConfig — a version bump now touches
masterConfig + next.config.ts + .vercelignore or fails tests. Full story:
`docs/ml-deploy-runbook.md` Trap 6.

Two loose ends:
- **Smoke-endpoint latency check still pending.** `CRON_SECRET` is Sensitive
  in Vercel (unpullable — `env pull` writes `""`); the only recoverable copy
  is in the kiosk Pi's launch script and the Pi was unreachable over
  Tailscale on 2026-08-30. Not blocking — the DB stamps are stronger
  evidence (runbook: "Verify without the secret").
- ~~Confirm the 0.55 gate on `random_ordinary_v2`~~ **Done 2026-08-30** —
  gate and pair hold on the 300-frame confirmation sample; see the v2
  CONFIRMATION block above for the (softer, honest) numbers.

What the branch changed (context for the above):
`imagePreprocess.ts` now matches training exactly (no ImageNet normalize —
AND `fit:'fill'` squash instead of `'cover'` center-crop, a second silent
mismatch found during the fix); masterConfig defaults pin the shipping pair
and `AI_BINARY_DECISION_THRESHOLD = 0.55`; `next.config.ts` traces the pair
into the three ONNX routes, with `next.config.test.ts` now deriving its
guard from masterConfig so bundling and runtime cannot drift. Parity proven
through the real `scoreImage` path on two eval frames (negative:
p=0.0000/quality 0.26; operator-4: p=1.0000/quality 0.73 → aiRating 3.91),
against the Python reference. 777 tests + production build pass.

Ship steps all done 2026-08-30: v4 env overrides removed before the deploy
(`AI_BINARY_SUNSET_THRESHOLD` was never set; `AI_BINARY_SCORING_ENABLED=true`
kept), PR #81 merged, PR #83 fixed the `.vercelignore` gap, verification via
DB stamps as described above.

Remaining scope (the model itself is now live):

- Tile sizing driven by the quality head; six categories addressable.
- ~~`AI_BINARY_SUNSET_THRESHOLD` must be re-derived~~ **Done** — shipped as
  `AI_BINARY_DECISION_THRESHOLD = 0.55` in masterConfig defaults (corrected
  sweep: prec 0.891 / rec 0.774, F1 plateau 0.45–0.70). Confirm on the v2
  sample.
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


---

## Reference pages (Notion, 2026-08-29)

- **Training Data & Raters** — the four label sets, and a prompt-integrity audit
  of both raters: https://app.notion.com/p/3cbe8008221281bab70bc026d7830b6e
- **What Each Model Was Trained On** — every model, its label source and target
  definition, plus what the LLM pretrain is:
  https://app.notion.com/p/3cbe800822128131b633ef9fab216e69
