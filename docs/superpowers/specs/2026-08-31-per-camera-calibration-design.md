---
title: "Automatic per-camera calibration — design"
date: 2026-08-31
status: DRAFT — awaiting Jesse's sign-off before implementation
---

# Automatic per-camera calibration (tempering prior)

Committed direction from the hard-negative emphasis decision rule
(`docs/superpowers/plans/2026-08-31-hard-negative-emphasis-experiment.md`):
the emphasis run missed its pre-registered bar — the **fourth** detection
change to do so — so the residual false-show class gets an evidence-derived
**display-side tempering prior** instead of another model change.

Evidence base: `docs/ml/2026-08-31-camera-error-audit.md`.

**Not re-litigated here:** whether to fix this in the model. That question is
closed. Detection stays frozen.

---

## Requirements (settled with Jesse, 2026-08-31)

1. Nightly job, pattern-matching the existing `recompute-disagreements` cron.
2. Per-camera rolling evidence from accumulated error history.
3. Output is a **bounded multiplier on the tile/quality signal only** — it must
   never move the detection verdict.
4. Stored on the `webcams` row, visible in the Ops tab.
5. New cameras start neutral; evidence decays so a cleaned-up view heals.
6. **No hand-curated lists anywhere.** Must scale to 1000s of cameras.
7. Known ground truth: `4057187` (Broome), `2947112` (Coober Pedy),
   `29095214` (Mount Gambier), `29275205` (Wagga Wagga) must temper;
   almost everything else must not.

---

## Measurement first: one settled requirement turned out to be false

The requirement list named **model-vs-Claude disagreement as the wide signal**.
Measured against production on 2026-08-31, it cannot work — for two independent
reasons.

**No supply.** Claude rating stopped **2026-07-31** (46,079 ratings total, none
since). Of snapshots captured in the last 60 days, **zero** carry both a model
score and a Claude score.

**Wrong model, wrong cameras.** The stored `model_disagreement_kind` compares
*v2/v4-era* model scores against Claude — 29,711 rows are
`20260314_070706_v2_mild_crop_balanced`, only 486 are the shipping
`20260829_062437_v5_binary_gold` (all written today). It therefore measures a
retired model's mistakes:

| check | result |
|---|---|
| Broome `4057187` — worst camera in the fleet (11/11 false-shows, 9 days) | **0** disagreement events across 86 Claude-scored frames; ranks **111 / 366** |
| Other three ground-truth cameras | 2, 0, 0 Claude-scored frames — no evidence at all |
| Top 15 cameras by this signal | **disjoint** from the audit's 17 offenders |

Shipping it would temper ~15 cameras the audit clears and leave Broome at full
size — worse than doing nothing.

### Three label-free replacements were tested. None has coverage.

| candidate | result | verdict |
|---|---|---|
| Daylight false-fire (sun > +5°) | 174 of 9,118 labeled frames qualify; capture is window-scoped by design | dead |
| Deep-twilight fire (sun < −12°, no sunset color physically possible) | sharp at the top (Broome ranks 5/49) but only **291 / 1,299** cameras reach ≥5 such frames in 30 days, and **two of the four** ground-truth cameras get zero | not viable for 2026-09-13; **best leg-2 candidate** |
| Raw per-camera fire rate | 30+ cameras fire on 100% of labeled frames; median offender rank 87/284 | dead (hard-example population is biased toward frames the model liked) |

**Conclusion:** exactly one evidence leg is viable today — operator false-show
labels, scored through the shipping pair. The design ships that leg and gives
the second leg a real socket, a written plan and a revival trigger (below),
rather than an implementation against data that does not exist.

**Requirement 6 still holds.** The offender set is *derived by a rule*, never
curated. A new camera that starts fooling the model tempers automatically as
soon as its frames are labeled. The scaling limit becomes label supply, not
human curation.

---

## The statistic

Per camera, over its **operator-N frames only**:

```
deceptiveness = false_shows / (n_negative_frames + PRIOR_K)
multiplier    = clamp(1 − MAX_TEMPER × deceptiveness, MIN_MULT, 1.0)
```

gated by a recurrence bar: **≥3 false-shows across ≥2 distinct capture days**,
the same standard that caught three non-replicating detection "wins".

Conditioning on N frames is the load-bearing choice. Two alternatives were
simulated and both **rank Broome 8th–9th**, because its 21 genuinely correct
fires dilute a whole-population rate:

| formula | Broome rank | why it fails |
|---|---|---|
| count rate `fs/(fs+tp+k)` | 8 / 17 | real sunsets dilute the error rate |
| harm-weighted `badTile/(badTile+goodTile+k)` | 9 / 17 | Broome earns large *genuine* tiles too |
| **`fs/(n_N+k)` — deceptiveness** | **1 / 17** | measures "given a boring frame, does this camera fool the model?" |

### Validation against the ground truth

Simulated on the audit's current-model scores for all 9,118 operator-labeled
frames (`ml/artifacts/reports/audit_frames_v1.csv`):

| multiplier | camera | fs / n_N | days |
|---|---|---|---|
| **0.577** | `4057187` Broome Intl Airport | 11 / 11 | 9 |
| **0.714** | `2947112` Coober Pedy opal mine | 4 / 5 | 4 |
| **0.833** | `29275205` Wagga Wagga Airport | 3 / 7 | 2 |
| **0.882** | `29095214` Mount Gambier Airport | 4 / 15 | 4 |

- **17 cameras temper** — of 1,071 with any operator-N frame (1.6%); 1,382 have labeled frames at all.
- **All four ground-truth cameras temper.**
- **All 17 audit offenders temper.**
- **Zero non-offenders temper.**

Wagga and Mount Gambier temper gently, correctly — they fool the model on only
3/7 and 4/15 of their boring frames. The audit's own `fs_rate` agrees (0.43 and
0.27).

---

## The one real trade-off, and how it was resolved

Broome is not uniformly deceptive. It produces genuine 4s and 5s (tile
0.89–1.02) **and** sodium-floodlight false-shows (tile 0.39–0.64). Tempering it
shrinks both. Across the fleet, 65 of 1,237 operator-≥4 frames sit on cameras
that would temper.

`MAX_TEMPER` is a pure harm/benefit dial — it does **not** change *which*
cameras temper (that is the recurrence bar's job), only how hard:

| MAX_TEMPER | MIN_MULT | Broome mult | big false-shows fixed | genuine ≥4 demoted |
|---|---|---|---|---|
| 0.80 | 0.20 | 0.323 | 9 | 30 |
| 0.65 | 0.35 | 0.450 | 8 | 25 |
| **0.50** | **0.50** | **0.577** | **8** | **10** |
| 0.35 | 0.65 | 0.704 | 7 | 9 |

**MAX_TEMPER = 0.50 dominates 0.65**: identical benefit (8 big false-shows
fixed), 60% less harm (10 demoted vs 25). At that setting, for Broome:

- false-shows 0.39–0.64 → 0.22–0.37 — **0 of 11 remain above the 0.5 showcase line**
- genuine ≥4 0.00–1.02 → 0.00–0.59 — **9 of 13 keep showcase size**

**Decision: `MAX_TEMPER = 0.50`, `MIN_MULT = 0.50`.** Chosen because it
dominates, not fitted to taste.

Note this is a genuine, accepted cost: some real showcase frames on offender
cameras render smaller. It is bounded, it never hides anything (the gate is
untouched), and it reverses per-camera as labels accumulate.

---

## Constants

Land in `app/lib/masterConfig.ts`:

| constant | value | rationale |
|---|---|---|
| `CALIBRATION_MIN_EVENTS` | 3 | recurrence bar — one bad frame is noise |
| `CALIBRATION_MIN_DAYS` | 2 | must recur across capture days |
| `CALIBRATION_PRIOR_K` | 2 | smoothing; a camera with 3/3 doesn't slam to the floor |
| `CALIBRATION_MAX_TEMPER` | 0.50 | dominant setting, table above |
| `CALIBRATION_MIN_MULTIPLIER` | 0.50 | hard floor — bounded output |
| `CALIBRATION_HALF_LIFE_DAYS` | 90 | a cleaned-up view heals over ~a quarter |
| `CALIBRATION_WINDOW_DAYS` | 365 | eligibility window; enables full healing |

**Half-life is chosen on principle, not fitted.** A sweep (none / 365 / 180 /
120 / 90 / 60 / 30 days) moves Broome only 0.450 → 0.503 and changes neither
the tempered set (17) nor the false-positive count (0) — because 74% of labeled
frames are from the last 30 days. It is insensitive today and would be wrong to
tune on.

### Healing requires both decay and a window

A draft of this rule applied the recurrence bar to *undecayed* counts, which
means a camera's raw count stays ≥3 forever and **it can never fully heal** —
violating requirement 5. Resolved by scoping evidence to a rolling
`CALIBRATION_WINDOW_DAYS` window:

- **Window** governs eligibility and the recurrence bar → a camera with no
  false-show in 365 days drops out entirely, multiplier returns to 1.0.
- **Decay** (half-life, on the frame's `captured_at`) governs magnitude → the
  multiplier relaxes smoothly long before it drops out.

Decay keys on `captured_at`, not `labeled_at` — the evidence is about what the
camera looked like *then*, so a trimmed tree or a removed floodlight heals.

---

## Architecture

Four units, each independently testable.

### 1. `camera_calibration_evidence` (new table) — the socket

One row per labeled frame per model version. Small (~9k rows today).

```sql
CREATE TABLE IF NOT EXISTS camera_calibration_evidence (
  id             BIGSERIAL PRIMARY KEY,
  webcam_id      BIGINT NOT NULL,
  snapshot_id    BIGINT NOT NULL,
  model_version  TEXT NOT NULL,     -- scoped: a head swap re-derives, never mixes
  evidence_source TEXT NOT NULL,    -- 'operator_label' | future leg-2 sources
  is_negative    BOOLEAN NOT NULL,  -- operator said N
  fired          BOOLEAN NOT NULL,  -- model p_sunset >= gate
  captured_on    DATE NOT NULL,     -- decay + recurrence basis
  UNIQUE (snapshot_id, model_version, evidence_source)
);
```

`model_version` scoping is the fix for the exact defect that killed the wide
signal: evidence from a retired head must never drive a live multiplier.

`evidence_source` is the leg-2 socket — a second writer appends rows and the
aggregation needs no change.

### 2. Evidence writer — `ml/audit_camera_errors.py --emit-evidence`

Extends the existing, already-proven audit script to upsert its per-frame
results into the table instead of only writing CSV/JSON. Offline, run when
labels accumulate or the shipping head changes. Not on the nightly path —
it needs ONNX, and operator labels only change when Jesse labels.

### 3. Nightly job — `/api/cron/recompute-camera-calibration`

Pure SQL. Directly mirrors `recompute-disagreements`:

- `app/api/cron/recompute-camera-calibration/route.ts` — `verifyCronAuth`,
  `force-dynamic`, `maxDuration`, GET+POST, error envelope.
- `app/api/cron/update-cameras/lib/recomputeCameraCalibration.ts` — the
  orchestration, batched UPDATE.
- `vercel.json` cron entry, nightly (`15 4 * * *`), off the live-scoring tick
  budget.

No image download, no ONNX — so it does **not** need the `ml/artifacts` bundle
and cannot push the 250 MB function limit.

### 4. Multiplier math — `app/lib/cameraCalibration.ts`

Pure function, no DB, no I/O. Where the rule actually lives, and where the
tests point.

```ts
export interface CalibrationEvidence {
  falseShows: number;      // decayed weight, within window
  negativeFrames: number;  // decayed weight, within window
  falseShowDays: number;   // distinct capture days, within window
  rawFalseShows: number;   // undecayed count, within window
}

export function computeTemperingMultiplier(e: CalibrationEvidence): number;
```

### Storage on `webcams`

```sql
ALTER TABLE webcams
  ADD COLUMN IF NOT EXISTS calibration_multiplier  NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS calibration_evidence    JSONB,
  ADD COLUMN IF NOT EXISTS calibration_computed_at TIMESTAMPTZ;
```

**NULL = neutral** — new cameras start at 1.0 with no backfill (requirement 5).

⚠️ `NUMERIC` serialises through the Neon driver as a **string**
(`"0.577"`, not `0.577`). Cast on read and coerce in TS — this has bitten the
project before.

### Application point

`app/components/mosaic/v1/qualitySignal.ts` — `getQualityScore` only:

```ts
const raw = webcam.aiRatingRegression ?? null;
if (raw == null) return null;
// Temper the above-floor part only: preserves the "rejected frames floor to 1,
// never hidden" contract, and cannot move the gate.
return 1 + (raw - 1) * (webcam.calibrationMultiplier ?? 1);
```

`passesGate` is **not touched**. This is requirement 3, and it gets an explicit
test asserting the gate verdict is bit-identical with and without a multiplier.

`calibrationMultiplier` joins `WindyWebcam` and the webcam-serving API.

### Ops surface

A "Camera calibration" panel in the Ops tab: tempered cameras, multiplier,
`fs / n_N`, distinct days, `calibration_computed_at`, and a fleet-level count.
Follows the existing `OpsPanels.tsx` patterns.

---

## Pre-registered acceptance test

Locked **before** implementation, per the standing discipline in this program.
The job is not allowed to ship unless, run against the frozen
`audit_frames_v1` evidence, ALL of:

1. **Ground truth tempers:** all four of `4057187`, `2947112`, `29095214`,
   `29275205` receive multiplier < 1.0.
2. **Precision:** zero cameras outside the audit's 17-offender list temper.
3. **Fleet bound:** ≤25 cameras temper, against 1,071 with operator-N evidence (≤2.3%).
4. **Detection untouched:** `passesGate` output is bit-identical for every
   webcam with and without a multiplier applied. Unit-tested.
5. **Bounded output:** multiplier ∈ [0.50, 1.0] for all inputs, including
   adversarial ones (zero frames, all-false-shows, missing fields).
6. **Neutral by default:** a camera with no evidence row gets exactly 1.0.

Measured baseline to beat, from the simulation: 17 tempered, 0 false positives,
all 4 ground-truth cameras caught.

---

## Leg 2 — the plan, not a promise

Leg 2 exists to remove the label-supply ceiling: leg 1 can only temper cameras
whose frames Jesse has labeled. Two candidate writers, in priority order.

### Writer A — `production_deep_twilight` (recommended)

**What it is.** Frames captured with solar elevation < −12° (nautical/
astronomical twilight) have no sunset colour physically available. A shipping
head that fires there is reacting to artificial light or warm terrain — exactly
the Broome/Coober Pedy failure class. Such a frame is written as
`is_negative = true, fired = (p >= gate)` with no operator label required.

**Why it is the right leg 2.** It needs no Claude spend, no operator time, and
it strengthens automatically as production accrues. Measured discrimination on
current-model scores: Broome ranks **5 / 49** on this signal, and 2 of the 3
eligible audit offenders land in the top 20.

**Why it cannot ship now.** Coverage. Only **291 / 1,299** cameras reach ≥5
deep-twilight frames in 30 days; Broome gets 4; two of the four ground-truth
cameras get **zero**. And v5-era production scoring only began 2026-08-31 (486
snapshots, 141 cameras).

**Revival trigger (pre-registered):** enable when a coverage query shows
**≥300 cameras with ≥5 deep-twilight frames scored by the current head across
≥2 distinct days**. Re-check monthly; it is a single SQL query.

**Bar it must clear before it may move any multiplier:** the same six-clause
acceptance test above, re-run with writer A's rows included. If adding leg 2
tempers cameras outside the then-current audit offender list, leg 2 is wrong,
not the audit.

`suncalc` is already a dependency and `app/lib/cameraHealth.ts` already
computes window geometry — reuse it rather than re-deriving solar position.

### Writer B — `model_vs_claude` (parked)

The originally specified wide signal. **Revival trigger:** Claude rating
resumes *and* ≥30 days of rows exist where `llm_is_sunset` and
`ai_model_version_binary = <current head>` are both present. Until both hold it
stays unimplemented — the measurements above show why implementing it early
would actively mislead.

If it is ever revived, `model_disagreement_kind` must be **recomputed against
the current head**, never read from the archive.

### What leg 1 must do now to make leg 2 cheap

Nothing beyond the design above: `evidence_source` + `model_version` on the
evidence table, and aggregation that is agnostic to which writer produced a
row. Leg 2 is then a writer plus a config flag — no change to the multiplier
math, the cron, the storage, or the display path.

---

## Implementation phases

| phase | content | gate |
|---|---|---|
| 1 | `cameraCalibration.ts` + unit tests (pure math, clauses 4–6 of the acceptance test) | tests green |
| 2 | Migration + `--emit-evidence` writer; populate from existing labels | clauses 1–3 reproduce the simulation |
| 3 | Nightly cron route + lib + `vercel.json`, mirroring `recompute-disagreements` | tests green, dry-run locally |
| 4 | `qualitySignal.ts` application + `WindyWebcam` plumbing | gate-identity test green |
| 5 | Ops panel | visual check |
| 6 | Deploy + verify via `calibration_computed_at` stamps | stamps present post-deploy |

Phases 1 and 2 carry the risk; 3–5 are pattern-matching existing code.

---

## Dependencies and risks

- **Blocked on PRs #104 / #105.** `ml/audit_camera_errors.py` and
  `audit_frames_v1.csv` live on `measure/camera-error-audit` and
  `measure/hard-negative-emphasis`. Leg 1's evidence writer extends that
  script — those must merge (or this branch must build on them) first.
- **Migration is a production DB change.** Not applied unsupervised. Additive
  and idempotent (`ADD COLUMN IF NOT EXISTS`), NULL-default, so it is inert
  until the cron writes.
- **Accepted cost:** ~10 genuine ≥4 frames across the fleet render smaller.
  Bounded, never hidden, reverses as labels accumulate.
- **Label-supply ceiling** is the real limit on leg 1's reach. That is what
  leg 2 exists to remove.

---

## Open question for sign-off

Everything above is settled by measurement except one judgement call:

**Is demoting ~10 genuine operator-≥4 frames (most of them Broome's real
sunsets, from ~0.95 tile to ~0.55) an acceptable price for removing 8 big
false-shows before the 2026-09-13 showing?**

Recommendation: **yes.** Nothing is hidden (the gate is untouched), the harm is
bounded by `MIN_MULT`, and it reverses per-camera as labels accumulate. If the
answer is no, lower `CALIBRATION_MAX_TEMPER` to 0.35 — 7 fixed, 9 demoted — a
one-constant change requiring no redesign.
