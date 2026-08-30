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
3. **Does the LLM pretrain help?** Largely **demotivated** by the corrected
   numbers: v5 now BEATS Claude on the production distribution (F1 0.816 vs
   0.726; the earlier "Claude beats v5" was the preprocessing artifact).
   The corrected quality head also beats Claude (Pearson 0.763 vs 0.560 on
   identical frames). The pretrain remains a possible marginal improvement,
   not a repair for a diagnosed defect — do not spend re-rating money on its
   behalf without a pre-registered bar it must clear.

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
camera fools both heads twice. ⚠️ The pre-registered pretrain bar (beat
0.816 detection / 0.820 quality) was set on v1's optimistic numbers —
restate it against v1+v2 pooled before spending re-rating money.

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
