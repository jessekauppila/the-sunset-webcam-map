# Per-Camera Calibration (Leg 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a nightly job that derives a bounded, evidence-based tempering multiplier per camera and applies it to the mosaic tile signal only — never the detection verdict — with every contributing frame and every multiplier change retained for later review.

**Architecture:** An offline ONNX writer (`ml/audit_camera_errors.py --emit-evidence`) persists one append-only row per operator-labeled frame into `camera_calibration_evidence`, including the scores that made it count. A pure-SQL nightly cron aggregates that evidence with time decay, computes the multiplier via a pure TS function, writes it to `webcams`, and records changes to `camera_calibration_history`. `getQualityScore` multiplies the above-floor part of the tile signal; `passesGate` is untouched.

**Tech Stack:** Next.js App Router (route handlers), Neon Postgres via `@/app/lib/db` `sql` tagged template, Vitest, Python 3.11 + psycopg2 + onnxruntime in `.venv`.

**Spec:** `docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md`

## Global Constants

Copy verbatim into `app/lib/masterConfig.ts`. Every task's requirements implicitly include these.

| constant | value |
|---|---|
| `CALIBRATION_MIN_EVENTS` | `3` |
| `CALIBRATION_MIN_DAYS` | `2` |
| `CALIBRATION_PRIOR_K` | `2` |
| `CALIBRATION_MAX_TEMPER` | `0.5` |
| `CALIBRATION_MIN_MULTIPLIER` | `0.5` |
| `CALIBRATION_HALF_LIFE_DAYS` | `90` |
| `CALIBRATION_WINDOW_DAYS` | `365` |

## Global Constraints

- **Branch is `feat/per-camera-calibration`** (stacked on `origin/measure/hard-negative-emphasis` for `ml/audit_camera_errors.py`). Verify with `git rev-parse --abbrev-ref HEAD` before EVERY commit — Jesse merges PRs in parallel and the shared checkout can shift mid-task.
- **Stage explicit paths only.** Never `git add -A` / `git add .` — parallel sessions share this checkout and there are unrelated untracked `ml/artifacts/` paths sitting in it.
- **Detection is frozen.** No task may change `passesGate`, `AI_BINARY_DECISION_THRESHOLD`, or any model file.
- **Postgres `NUMERIC` arrives as a STRING** through the Neon driver (`"0.577"`, not `0.577`). Every read of a numeric column must go through `Number(...)`.
- **The evidence table is append-only.** No task may write `DELETE` against `camera_calibration_evidence` or `camera_calibration_history`.
- **Do NOT apply migrations to production.** Migrations are written and committed; Jesse applies them. `vercel env add/rm` is likewise classifier-blocked — hand those to Jesse.
- Test runner is `npm run test` (vitest). Python is `.venv/bin/python`.

## Pre-Registered Acceptance Test (all 8 clauses)

Locked before implementation. Task 8 verifies the whole set.

1. All four of `4057187`, `2947112`, `29095214`, `29275205` get multiplier < 1.0.
2. Zero cameras outside the audit's 17-offender list temper.
3. ≤25 cameras temper (measured baseline: exactly 17).
4. `passesGate` output is bit-identical with and without a multiplier.
5. Multiplier ∈ [0.5, 1.0] for all inputs including adversarial ones.
6. A camera with no evidence gets exactly 1.0.
7. Re-running the writer leaves row count unchanged and deletes nothing; a second `model_version` generation leaves the first intact.
8. A multiplier change writes exactly one history row carrying the previous value; no change writes none.

**Measured baseline (re-verified against current labels 2026-09-01):** 17 tempered, 0 non-offenders, Broome 0.577 / Coober Pedy 0.714 / Wagga 0.833 / Mt Gambier 0.882.

---

## File Structure

| file | responsibility |
|---|---|
| `app/lib/cameraCalibration.ts` | **Create.** Pure multiplier math + decay. No I/O. |
| `app/lib/cameraCalibration.test.ts` | **Create.** Clauses 4–6 + decay behavior. |
| `app/lib/masterConfig.ts` | **Modify.** Append the 7 constants. |
| `database/migrations/20260901_camera_calibration.sql` | **Create.** Both tables + 3 `webcams` columns. |
| `ml/audit_camera_errors.py` | **Modify.** Add `--emit-evidence`. |
| `app/api/cron/update-cameras/lib/dbOperations.ts` | **Modify.** Add 3 query functions. |
| `app/api/cron/update-cameras/lib/recomputeCameraCalibration.ts` | **Create.** Orchestration. |
| `app/api/cron/update-cameras/lib/recomputeCameraCalibration.test.ts` | **Create.** Clause 8. |
| `app/api/cron/recompute-camera-calibration/route.ts` | **Create.** Cron entrypoint. |
| `vercel.json` | **Modify.** Nightly cron entry. |
| `app/components/mosaic/v1/qualitySignal.ts` | **Modify.** Apply multiplier in `getQualityScore`. |
| `app/components/mosaic/v1/qualitySignal.test.ts` | **Modify.** Clause 4 + tempering tests. |
| `app/lib/types.ts` | **Modify.** `calibrationMultiplier?: number` on `WindyWebcam`. |
| `app/api/db-all-webcams/route.ts` | **Modify.** Select + map the column. |
| `app/lib/opsTypes.ts` | **Modify.** Calibration row types. |
| `app/api/admin/ops-stats/route.ts` | **Modify.** Serve calibration rows. |
| `app/api/admin/calibration-frames/route.ts` | **Create.** Per-camera evidence frames, fetched on expand. |
| `app/components/Ops/OpsPanels.tsx` | **Modify.** Calibration panel. |
| `ml/verify_calibration_acceptance.py` | **Create.** Clauses 1–3, 7. |

---

### Task 1: Multiplier math (pure function)

**Files:**
- Create: `app/lib/cameraCalibration.ts`
- Create: `app/lib/cameraCalibration.test.ts`
- Modify: `app/lib/masterConfig.ts` (append constants)

**Interfaces:**
- Consumes: nothing.
- Produces: `CalibrationEvidence` interface, `computeTemperingMultiplier(e: CalibrationEvidence): number`, `decayWeight(ageDays: number, halfLifeDays: number): number`, `applyTempering(score: number, multiplier: number | undefined): number`.

- [ ] **Step 1: Append constants to masterConfig**

Add at the end of `app/lib/masterConfig.ts`:

```ts
/* -------------------------------------------------------------------------- */
/* Per-camera calibration (tempering prior)                                    */
/* Spec: docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md    */
/*                                                                            */
/* A bounded multiplier on the TILE/QUALITY signal only. It must never move    */
/* the detection verdict — passesGate does not read any of these.              */
/* -------------------------------------------------------------------------- */

// Recurrence bar: one bad frame is noise. Same standard that caught three
// non-replicating detection "wins".
export const CALIBRATION_MIN_EVENTS = 3;
export const CALIBRATION_MIN_DAYS = 2;

// Smoothing prior, so a camera with 3 false-shows out of 3 N frames does not
// slam straight to the floor.
export const CALIBRATION_PRIOR_K = 2;

// MAX_TEMPER 0.5 was chosen because it DOMINATES 0.65: identical benefit
// (8 big false-shows fixed) at 60% less harm (10 genuine >=4 frames demoted
// vs 25). Lower to 0.35 to back off; that needs no other change.
export const CALIBRATION_MAX_TEMPER = 0.5;
export const CALIBRATION_MIN_MULTIPLIER = 0.5;

// Decay shapes MAGNITUDE; the window governs ELIGIBILITY. Both are needed:
// with an undecayed recurrence bar a camera could never fully heal.
export const CALIBRATION_HALF_LIFE_DAYS = 90;
export const CALIBRATION_WINDOW_DAYS = 365;
```

- [ ] **Step 2: Write the failing tests**

Create `app/lib/cameraCalibration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeTemperingMultiplier,
  decayWeight,
  applyTempering,
  type CalibrationEvidence,
} from './cameraCalibration';

const neutral: CalibrationEvidence = {
  falseShows: 0,
  negativeFrames: 0,
  falseShowDays: 0,
  rawFalseShows: 0,
};

describe('computeTemperingMultiplier', () => {
  it('returns exactly 1.0 for a camera with no evidence (clause 6)', () => {
    expect(computeTemperingMultiplier(neutral)).toBe(1);
  });

  it('returns 1.0 below the event bar even with many negative frames', () => {
    expect(
      computeTemperingMultiplier({
        falseShows: 2,
        negativeFrames: 40,
        falseShowDays: 2,
        rawFalseShows: 2,
      })
    ).toBe(1);
  });

  it('returns 1.0 when false-shows do not recur across days', () => {
    expect(
      computeTemperingMultiplier({
        falseShows: 5,
        negativeFrames: 5,
        falseShowDays: 1,
        rawFalseShows: 5,
      })
    ).toBe(1);
  });

  it('reproduces the Broome baseline: 11/11 over 9 days -> 0.577', () => {
    const m = computeTemperingMultiplier({
      falseShows: 11,
      negativeFrames: 11,
      falseShowDays: 9,
      rawFalseShows: 11,
    });
    expect(m).toBeCloseTo(0.577, 3);
  });

  it('reproduces Mount Gambier: 4/15 over 4 days -> 0.882', () => {
    const m = computeTemperingMultiplier({
      falseShows: 4,
      negativeFrames: 15,
      falseShowDays: 4,
      rawFalseShows: 4,
    });
    expect(m).toBeCloseTo(0.882, 3);
  });

  it('never returns below MIN_MULTIPLIER even at a 100% false-show rate (clause 5)', () => {
    const m = computeTemperingMultiplier({
      falseShows: 1000,
      negativeFrames: 1000,
      falseShowDays: 50,
      rawFalseShows: 1000,
    });
    expect(m).toBeGreaterThanOrEqual(0.5);
  });

  it('never returns above 1.0 (clause 5)', () => {
    const m = computeTemperingMultiplier({
      falseShows: 0,
      negativeFrames: 100,
      falseShowDays: 5,
      rawFalseShows: 3,
    });
    expect(m).toBeLessThanOrEqual(1);
  });

  it('is bounded for adversarial input (negative, NaN, missing) (clause 5)', () => {
    for (const e of [
      { falseShows: -5, negativeFrames: -5, falseShowDays: 9, rawFalseShows: 9 },
      { falseShows: NaN, negativeFrames: NaN, falseShowDays: 9, rawFalseShows: 9 },
      { falseShows: 5, negativeFrames: 0, falseShowDays: 9, rawFalseShows: 5 },
    ] as CalibrationEvidence[]) {
      const m = computeTemperingMultiplier(e);
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBeGreaterThanOrEqual(0.5);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
});

describe('decayWeight', () => {
  it('is 1 for a frame captured today', () => {
    expect(decayWeight(0, 90)).toBe(1);
  });

  it('is 0.5 at exactly one half-life', () => {
    expect(decayWeight(90, 90)).toBeCloseTo(0.5, 10);
  });

  it('is 0.25 at two half-lives', () => {
    expect(decayWeight(180, 90)).toBeCloseTo(0.25, 10);
  });

  it('treats a negative age as today rather than amplifying', () => {
    expect(decayWeight(-10, 90)).toBe(1);
  });
});

describe('applyTempering', () => {
  it('scales only the above-floor part, so the 1.0 floor is preserved', () => {
    expect(applyTempering(1, 0.5)).toBe(1);
  });

  it('halves the distance above the floor at multiplier 0.5', () => {
    expect(applyTempering(5, 0.5)).toBe(3);
  });

  it('is a no-op when the multiplier is undefined', () => {
    expect(applyTempering(4.2, undefined)).toBe(4.2);
  });

  it('is a no-op at multiplier 1', () => {
    expect(applyTempering(4.2, 1)).toBe(4.2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- app/lib/cameraCalibration.test.ts`
Expected: FAIL — cannot resolve `./cameraCalibration`.

- [ ] **Step 4: Write the implementation**

Create `app/lib/cameraCalibration.ts`:

```ts
import {
  CALIBRATION_MIN_EVENTS,
  CALIBRATION_MIN_DAYS,
  CALIBRATION_PRIOR_K,
  CALIBRATION_MAX_TEMPER,
  CALIBRATION_MIN_MULTIPLIER,
} from './masterConfig';

/**
 * Per-camera tempering evidence, already windowed and decayed by the caller.
 *
 * The rate is conditioned on the camera's NEGATIVE frames only — "given a
 * boring frame, does this camera fool the model?". That conditioning is
 * load-bearing: whole-population rates rank Broome 8th-9th because its 21
 * genuinely correct fires dilute the error rate. See the spec.
 */
export interface CalibrationEvidence {
  /** Decayed weight of false-shows inside the window. */
  falseShows: number;
  /** Decayed weight of operator-negative frames inside the window. */
  negativeFrames: number;
  /** Distinct capture days with a false-show, inside the window. */
  falseShowDays: number;
  /** Undecayed false-show count inside the window — the recurrence bar. */
  rawFalseShows: number;
}

const finiteOrZero = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, n) : 0;

/**
 * Exponential decay weight for a frame captured `ageDays` ago.
 * A future-dated frame (clock skew) weighs the same as today's, never more.
 */
export function decayWeight(ageDays: number, halfLifeDays: number): number {
  const age = Math.max(0, finiteOrZero(ageDays));
  if (!(halfLifeDays > 0)) return 1;
  return Math.pow(0.5, age / halfLifeDays);
}

/**
 * The tempering multiplier. Bounded to [MIN_MULTIPLIER, 1] by construction.
 *
 * Returns exactly 1 (neutral) unless the recurrence bar is cleared, so new
 * cameras and one-off mistakes are never tempered.
 */
export function computeTemperingMultiplier(e: CalibrationEvidence): number {
  const rawFalseShows = finiteOrZero(e.rawFalseShows);
  const falseShowDays = finiteOrZero(e.falseShowDays);

  if (rawFalseShows < CALIBRATION_MIN_EVENTS) return 1;
  if (falseShowDays < CALIBRATION_MIN_DAYS) return 1;

  const falseShows = finiteOrZero(e.falseShows);
  const negativeFrames = finiteOrZero(e.negativeFrames);

  const rate = falseShows / (negativeFrames + CALIBRATION_PRIOR_K);
  const raw = 1 - CALIBRATION_MAX_TEMPER * rate;

  return Math.min(1, Math.max(CALIBRATION_MIN_MULTIPLIER, raw));
}

/**
 * Apply a multiplier to a 1-5 tile score, scaling only the part ABOVE the
 * floor of 1. Product intent is "show every image, just small" — a tempered
 * frame gets smaller, never hidden, and 1 stays 1.
 */
export function applyTempering(
  score: number,
  multiplier: number | undefined
): number {
  if (multiplier == null || !Number.isFinite(multiplier)) return score;
  return 1 + (score - 1) * multiplier;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- app/lib/cameraCalibration.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Verify branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/lib/cameraCalibration.ts app/lib/cameraCalibration.test.ts app/lib/masterConfig.ts
git commit -m "feat(calibration): bounded per-camera tempering multiplier math"
```

---

### Task 2: Migration — evidence table, history table, webcams columns

**Files:**
- Create: `database/migrations/20260901_camera_calibration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `camera_calibration_evidence`, `camera_calibration_history`; columns `webcams.calibration_multiplier`, `webcams.calibration_evidence`, `webcams.calibration_computed_at`.

- [ ] **Step 1: Write the migration**

Create `database/migrations/20260901_camera_calibration.sql`:

```sql
-- Per-camera calibration (tempering prior).
-- Spec: docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md
--
-- Three things:
--   camera_calibration_evidence  one APPEND-ONLY row per labeled frame per
--                                model version, carrying the scores that made
--                                it count so a tempering decision can be
--                                re-examined later without rescoring through
--                                ONNX. Nothing in this system deletes from it.
--   camera_calibration_history   multiplier CHANGE events, so healing and
--                                drift are observable rather than asserted.
--   webcams.calibration_*        the live value the display reads.
--                                NULL = neutral; new cameras need no backfill.
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260901_camera_calibration.sql

CREATE TABLE IF NOT EXISTS camera_calibration_evidence (
  id              BIGSERIAL PRIMARY KEY,
  webcam_id       BIGINT NOT NULL,
  snapshot_id     BIGINT NOT NULL,
  -- Scoping by model version is the fix for the exact defect that killed the
  -- model-vs-Claude wide signal: evidence from a retired head must never
  -- drive a live multiplier.
  model_version   TEXT NOT NULL,
  -- The leg-2 socket. A second writer appends rows; aggregation is unchanged.
  evidence_source TEXT NOT NULL,
  is_negative     BOOLEAN NOT NULL,
  fired           BOOLEAN NOT NULL,
  captured_on     DATE NOT NULL,
  -- Frame record. firebase_url is denormalised ON PURPOSE: this table must
  -- stay reviewable years from now, independent of webcam_snapshots.
  p_sunset        NUMERIC(6,4) NOT NULL,
  quality         NUMERIC(6,4),
  tile            NUMERIC(6,4),
  firebase_url    TEXT NOT NULL,
  scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, model_version, evidence_source)
);

-- Hot path: the nightly aggregation scans one model generation per camera.
CREATE INDEX IF NOT EXISTS camera_calibration_evidence_cam_idx
  ON camera_calibration_evidence (webcam_id, model_version, captured_on DESC);

CREATE TABLE IF NOT EXISTS camera_calibration_history (
  id                  BIGSERIAL PRIMARY KEY,
  webcam_id           BIGINT NOT NULL,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  multiplier          NUMERIC(4,3) NOT NULL,
  previous_multiplier NUMERIC(4,3),
  false_shows         NUMERIC(8,3) NOT NULL,
  negative_frames     NUMERIC(8,3) NOT NULL,
  raw_false_shows     INT NOT NULL,
  false_show_days     INT NOT NULL,
  model_version       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS camera_calibration_history_cam_idx
  ON camera_calibration_history (webcam_id, computed_at DESC);

ALTER TABLE webcams
  ADD COLUMN IF NOT EXISTS calibration_multiplier  NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS calibration_evidence    JSONB,
  ADD COLUMN IF NOT EXISTS calibration_computed_at TIMESTAMPTZ;
```

- [ ] **Step 2: Verify the SQL parses without applying it to production**

Run: `.venv/bin/python -c "import sqlite3" 2>/dev/null; grep -c 'CREATE TABLE IF NOT EXISTS' database/migrations/20260901_camera_calibration.sql`
Expected: `2`.

Do NOT run this against `DATABASE_URL`. Applying migrations is Jesse's step.

- [ ] **Step 3: Verify branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add database/migrations/20260901_camera_calibration.sql
git commit -m "feat(calibration): migration for evidence, history, webcams columns"
```

---

### Task 3: Evidence writer — `--emit-evidence`

**Files:**
- Modify: `ml/audit_camera_errors.py`

**Interfaces:**
- Consumes: the migration's `camera_calibration_evidence` schema.
- Produces: rows in `camera_calibration_evidence` with `evidence_source = 'operator_label'` and `model_version` = the binary ONNX directory name.

- [ ] **Step 1: Add the CLI flag**

In the `argparse` block of `ml/audit_camera_errors.py`, after `--dump-frames`, add:

```python
    p.add_argument("--emit-evidence", action="store_true",
                   help="upsert per-frame rows into camera_calibration_evidence "
                        "(the calibration job's input; see the 2026-08-31 "
                        "per-camera calibration spec). Append-only: re-running "
                        "refreshes scores for the same model generation and "
                        "never deletes.")
```

- [ ] **Step 2: Derive the model version from the ONNX path**

Add near the top-level helpers:

```python
def model_version_from_path(onnx_path: str) -> str:
    """The run directory name is the model version stamped on webcams rows."""
    return Path(onnx_path).parent.name
```

- [ ] **Step 3: Collect evidence rows in the scoring loop**

Inside the per-frame loop, immediately after `tile` is computed and alongside the existing `dump_rows.append(...)`, add:

```python
        if args.emit_evidence:
            evidence_rows.append((
                int(wid), int(sid), model_version, "operator_label",
                not bool(is_sunset), bool(shown), day,
                round(float(p_sun), 4),
                round(float(q), 4),
                round(float(tile), 4),
                str(url),
            ))
```

Initialise `evidence_rows: list = []` and `model_version = model_version_from_path(args.binary_onnx)` next to the existing `dump_rows = []`.

- [ ] **Step 4: Write the upsert after the loop**

After scoring completes, before the report is written:

```python
    if args.emit_evidence:
        conn2 = psycopg2.connect(os.environ["DATABASE_URL"])
        cur2 = conn2.cursor()
        # ON CONFLICT DO UPDATE, never DELETE: re-running refreshes scores for
        # this model generation; a different model_version inserts a NEW
        # generation beside the old so both stay answerable.
        cur2.executemany(
            """
            INSERT INTO camera_calibration_evidence
              (webcam_id, snapshot_id, model_version, evidence_source,
               is_negative, fired, captured_on, p_sunset, quality, tile,
               firebase_url)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (snapshot_id, model_version, evidence_source)
            DO UPDATE SET
              is_negative = EXCLUDED.is_negative,
              fired       = EXCLUDED.fired,
              p_sunset    = EXCLUDED.p_sunset,
              quality     = EXCLUDED.quality,
              tile        = EXCLUDED.tile,
              scored_at   = now()
            """,
            evidence_rows,
        )
        conn2.commit()
        cur2.execute(
            "SELECT count(*) FROM camera_calibration_evidence WHERE model_version = %s",
            (model_version,),
        )
        total = cur2.fetchone()[0]
        conn2.close()
        print(f"  emitted {len(evidence_rows)} evidence rows; "
              f"{total} total for model_version={model_version}")
```

- [ ] **Step 5: Smoke-test the flag on a small slice**

Run: `.venv/bin/python ml/audit_camera_errors.py --limit 50 --emit-evidence`
Expected: prints `emitted 50 evidence rows; 50 total for model_version=20260829_062437_v5_binary_gold`.

Run it a SECOND time. Expected: `emitted 50 evidence rows; 50 total` — the total does NOT grow. That is clause 7.

- [ ] **Step 6: Populate the full evidence set**

Run: `.venv/bin/python ml/audit_camera_errors.py --emit-evidence`
Expected: `emitted 9118 evidence rows; 9118 total`.

- [ ] **Step 7: Verify branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add ml/audit_camera_errors.py
git commit -m "feat(calibration): --emit-evidence writes append-only frame records"
```

---

### Task 4: Nightly aggregation — DB layer

**Files:**
- Modify: `app/api/cron/update-cameras/lib/dbOperations.ts` (append to end)

**Interfaces:**
- Consumes: `CalibrationEvidence` from `app/lib/cameraCalibration.ts`.
- Produces: `CameraCalibrationRow` interface; `findCalibrationEvidenceByCamera(modelVersion, windowDays, halfLifeDays)`, `updateCameraCalibrationBatch(updates)`, `insertCalibrationHistoryBatch(rows)`.

- [ ] **Step 1: Write the aggregation query function**

Append to `app/api/cron/update-cameras/lib/dbOperations.ts`:

```ts
/* -------------------------------------------------------------------------- */
/* Per-camera calibration (tempering prior)                                    */
/* Spec: docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md    */
/* -------------------------------------------------------------------------- */

export interface CameraCalibrationRow {
  webcamId: number;
  falseShows: number;
  negativeFrames: number;
  falseShowDays: number;
  rawFalseShows: number;
  previousMultiplier: number | null;
}

/**
 * Aggregate calibration evidence per camera, scoped to ONE model generation
 * and a rolling window, with exponential decay applied in SQL.
 *
 * The window governs eligibility (so a camera with no recent false-show heals
 * completely); the decay governs magnitude (so it relaxes smoothly first).
 */
export async function findCalibrationEvidenceByCamera(
  modelVersion: string,
  windowDays: number,
  halfLifeDays: number,
): Promise<CameraCalibrationRow[]> {
  const rows = (await sql`
    select e.webcam_id                                             as webcam_id,
           sum(case when e.is_negative and e.fired
                    then power(0.5, (current_date - e.captured_on)::numeric
                                    / ${halfLifeDays}::numeric)
                    else 0 end)                                    as false_shows,
           sum(case when e.is_negative
                    then power(0.5, (current_date - e.captured_on)::numeric
                                    / ${halfLifeDays}::numeric)
                    else 0 end)                                    as negative_frames,
           count(distinct case when e.is_negative and e.fired
                               then e.captured_on end)             as false_show_days,
           count(*) filter (where e.is_negative and e.fired)        as raw_false_shows,
           max(w.calibration_multiplier)                            as previous_multiplier
    from camera_calibration_evidence e
    join webcams w on w.id = e.webcam_id
    where e.model_version = ${modelVersion}
      and e.captured_on > current_date - ${windowDays}::int
    group by e.webcam_id
  `) as {
    webcam_id: number;
    false_shows: number | string;
    negative_frames: number | string;
    false_show_days: number | string;
    raw_false_shows: number | string;
    previous_multiplier: number | string | null;
  }[];

  // NUMERIC comes back as a STRING through the Neon driver — coerce every one.
  return rows.map((r) => ({
    webcamId: Number(r.webcam_id),
    falseShows: Number(r.false_shows),
    negativeFrames: Number(r.negative_frames),
    falseShowDays: Number(r.false_show_days),
    rawFalseShows: Number(r.raw_false_shows),
    previousMultiplier:
      r.previous_multiplier == null ? null : Number(r.previous_multiplier),
  }));
}

/** One batched UPDATE for the whole fleet rather than a round-trip per camera. */
export async function updateCameraCalibrationBatch(
  updates: { webcamId: number; multiplier: number; evidence: unknown }[],
): Promise<void> {
  if (updates.length === 0) return;
  const ids = updates.map((u) => u.webcamId);
  const mults = updates.map((u) => u.multiplier);
  const evidence = updates.map((u) => JSON.stringify(u.evidence));
  await sql`
    update webcams w
    set calibration_multiplier = v.mult,
        calibration_evidence = v.evidence::jsonb,
        calibration_computed_at = now()
    from unnest(${ids}::bigint[], ${mults}::numeric[], ${evidence}::text[])
      as v(id, mult, evidence)
    where w.id = v.id
  `;
}

/** Append-only. Called only for cameras whose multiplier actually changed. */
export async function insertCalibrationHistoryBatch(
  rows: {
    webcamId: number;
    multiplier: number;
    previousMultiplier: number | null;
    falseShows: number;
    negativeFrames: number;
    rawFalseShows: number;
    falseShowDays: number;
    modelVersion: string;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  await sql`
    insert into camera_calibration_history
      (webcam_id, multiplier, previous_multiplier, false_shows,
       negative_frames, raw_false_shows, false_show_days, model_version)
    select * from unnest(
      ${rows.map((r) => r.webcamId)}::bigint[],
      ${rows.map((r) => r.multiplier)}::numeric[],
      ${rows.map((r) => r.previousMultiplier)}::numeric[],
      ${rows.map((r) => r.falseShows)}::numeric[],
      ${rows.map((r) => r.negativeFrames)}::numeric[],
      ${rows.map((r) => r.rawFalseShows)}::int[],
      ${rows.map((r) => r.falseShowDays)}::int[],
      ${rows.map((r) => r.modelVersion)}::text[]
    )
  `;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `dbOperations.ts`.

- [ ] **Step 3: Verify branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/api/cron/update-cameras/lib/dbOperations.ts
git commit -m "feat(calibration): per-camera evidence aggregation and batch writers"
```

---

### Task 5: Nightly aggregation — orchestration + history (clause 8)

**Files:**
- Create: `app/api/cron/update-cameras/lib/recomputeCameraCalibration.ts`
- Create: `app/api/cron/update-cameras/lib/recomputeCameraCalibration.test.ts`

**Interfaces:**
- Consumes: `findCalibrationEvidenceByCamera`, `updateCameraCalibrationBatch`, `insertCalibrationHistoryBatch` from Task 4; `computeTemperingMultiplier` from Task 1.
- Produces: `recomputeCameraCalibration(opts: { modelVersion: string }): Promise<CalibrationResult>` where `CalibrationResult = { camerasEvaluated: number; tempered: number; changed: number }`.

- [ ] **Step 1: Write the failing test**

Create `app/api/cron/update-cameras/lib/recomputeCameraCalibration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findCalibrationEvidenceByCamera: vi.fn(),
  updateCameraCalibrationBatch: vi.fn(),
  insertCalibrationHistoryBatch: vi.fn(),
}));

vi.mock('./dbOperations', () => mocks);

import { recomputeCameraCalibration } from './recomputeCameraCalibration';

const MODEL = '20260829_062437_v5_binary_gold';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateCameraCalibrationBatch.mockResolvedValue(undefined);
  mocks.insertCalibrationHistoryBatch.mockResolvedValue(undefined);
});

describe('recomputeCameraCalibration', () => {
  it('tempers a camera clearing the recurrence bar and records history', async () => {
    mocks.findCalibrationEvidenceByCamera.mockResolvedValue([
      {
        webcamId: 4057187,
        falseShows: 11,
        negativeFrames: 11,
        falseShowDays: 9,
        rawFalseShows: 11,
        previousMultiplier: null,
      },
    ]);

    const result = await recomputeCameraCalibration({ modelVersion: MODEL });

    expect(result).toEqual({ camerasEvaluated: 1, tempered: 1, changed: 1 });

    const [updates] = mocks.updateCameraCalibrationBatch.mock.calls[0];
    expect(updates[0].webcamId).toBe(4057187);
    expect(updates[0].multiplier).toBeCloseTo(0.577, 3);

    const [history] = mocks.insertCalibrationHistoryBatch.mock.calls[0];
    expect(history).toHaveLength(1);
    expect(history[0].previousMultiplier).toBeNull();
    expect(history[0].modelVersion).toBe(MODEL);
  });

  it('writes NO history row when the multiplier is unchanged (clause 8)', async () => {
    mocks.findCalibrationEvidenceByCamera.mockResolvedValue([
      {
        webcamId: 4057187,
        falseShows: 11,
        negativeFrames: 11,
        falseShowDays: 9,
        rawFalseShows: 11,
        previousMultiplier: 0.577,
      },
    ]);

    const result = await recomputeCameraCalibration({ modelVersion: MODEL });

    expect(result.changed).toBe(0);
    const [history] = mocks.insertCalibrationHistoryBatch.mock.calls[0];
    expect(history).toHaveLength(0);
  });

  it('writes a history row carrying the previous value when it changes', async () => {
    mocks.findCalibrationEvidenceByCamera.mockResolvedValue([
      {
        webcamId: 4057187,
        falseShows: 4,
        negativeFrames: 15,
        falseShowDays: 4,
        rawFalseShows: 4,
        previousMultiplier: 0.577,
      },
    ]);

    await recomputeCameraCalibration({ modelVersion: MODEL });

    const [history] = mocks.insertCalibrationHistoryBatch.mock.calls[0];
    expect(history).toHaveLength(1);
    expect(history[0].previousMultiplier).toBe(0.577);
    expect(history[0].multiplier).toBeCloseTo(0.882, 3);
  });

  it('heals a camera back to 1.0 and records that as a change', async () => {
    mocks.findCalibrationEvidenceByCamera.mockResolvedValue([
      {
        webcamId: 4057187,
        falseShows: 0,
        negativeFrames: 0,
        falseShowDays: 0,
        rawFalseShows: 0,
        previousMultiplier: 0.577,
      },
    ]);

    const result = await recomputeCameraCalibration({ modelVersion: MODEL });

    expect(result.tempered).toBe(0);
    const [updates] = mocks.updateCameraCalibrationBatch.mock.calls[0];
    expect(updates[0].multiplier).toBe(1);
    const [history] = mocks.insertCalibrationHistoryBatch.mock.calls[0];
    expect(history[0].multiplier).toBe(1);
  });

  it('handles an empty fleet without writing anything', async () => {
    mocks.findCalibrationEvidenceByCamera.mockResolvedValue([]);

    const result = await recomputeCameraCalibration({ modelVersion: MODEL });

    expect(result).toEqual({ camerasEvaluated: 0, tempered: 0, changed: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- app/api/cron/update-cameras/lib/recomputeCameraCalibration.test.ts`
Expected: FAIL — cannot resolve `./recomputeCameraCalibration`.

- [ ] **Step 3: Write the implementation**

Create `app/api/cron/update-cameras/lib/recomputeCameraCalibration.ts`:

```ts
import { computeTemperingMultiplier } from '@/app/lib/cameraCalibration';
import {
  CALIBRATION_WINDOW_DAYS,
  CALIBRATION_HALF_LIFE_DAYS,
} from '@/app/lib/masterConfig';
import {
  findCalibrationEvidenceByCamera,
  updateCameraCalibrationBatch,
  insertCalibrationHistoryBatch,
} from './dbOperations';

export interface CalibrationResult {
  camerasEvaluated: number;
  tempered: number;
  changed: number;
}

/** Multipliers are stored NUMERIC(4,3); anything smaller is not a real change. */
const CHANGE_EPSILON = 0.001;

/**
 * Recompute every camera's tempering multiplier from accumulated evidence.
 *
 * Pure SQL + arithmetic: no image download, no ONNX. That is why this runs on
 * its own nightly cron without the ml/artifacts bundle.
 *
 * History is written for CHANGES ONLY — writing every camera every night would
 * add ~1,000 near-identical rows nightly, and webcams.calibration_computed_at
 * already answers "did the job run".
 */
export async function recomputeCameraCalibration(opts: {
  modelVersion: string;
}): Promise<CalibrationResult> {
  const rows = await findCalibrationEvidenceByCamera(
    opts.modelVersion,
    CALIBRATION_WINDOW_DAYS,
    CALIBRATION_HALF_LIFE_DAYS,
  );

  const updates = rows.map((r) => {
    const multiplier = computeTemperingMultiplier({
      falseShows: r.falseShows,
      negativeFrames: r.negativeFrames,
      falseShowDays: r.falseShowDays,
      rawFalseShows: r.rawFalseShows,
    });
    return { row: r, multiplier };
  });

  await updateCameraCalibrationBatch(
    updates.map(({ row, multiplier }) => ({
      webcamId: row.webcamId,
      multiplier,
      evidence: {
        falseShows: row.falseShows,
        negativeFrames: row.negativeFrames,
        falseShowDays: row.falseShowDays,
        rawFalseShows: row.rawFalseShows,
        modelVersion: opts.modelVersion,
      },
    })),
  );

  const changed = updates.filter(
    ({ row, multiplier }) =>
      row.previousMultiplier == null ||
      Math.abs(row.previousMultiplier - multiplier) > CHANGE_EPSILON,
  );

  await insertCalibrationHistoryBatch(
    changed.map(({ row, multiplier }) => ({
      webcamId: row.webcamId,
      multiplier,
      previousMultiplier: row.previousMultiplier,
      falseShows: row.falseShows,
      negativeFrames: row.negativeFrames,
      rawFalseShows: row.rawFalseShows,
      falseShowDays: row.falseShowDays,
      modelVersion: opts.modelVersion,
    })),
  );

  return {
    camerasEvaluated: rows.length,
    tempered: updates.filter((u) => u.multiplier < 1).length,
    changed: changed.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- app/api/cron/update-cameras/lib/recomputeCameraCalibration.test.ts`
Expected: PASS, all five cases.

- [ ] **Step 5: Verify branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/api/cron/update-cameras/lib/recomputeCameraCalibration.ts app/api/cron/update-cameras/lib/recomputeCameraCalibration.test.ts
git commit -m "feat(calibration): nightly recompute with change-only history"
```

---

### Task 6: Cron route + schedule

**Files:**
- Create: `app/api/cron/recompute-camera-calibration/route.ts`
- Modify: `app/api/cron/update-cameras/lib/aiScoring.ts` (export one existing function)
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `recomputeCameraCalibration` from Task 5.
- Produces: `GET|POST /api/cron/recompute-camera-calibration`; `resolveBinaryModelVersion()` becomes exported.

- [ ] **Step 1: Export the effective model-version resolver**

The cron must read the SAME model generation the scoring path stamps. The
default constant is not enough — `AI_BINARY_MODEL_VERSION` can override it in
env, and querying the wrong generation would silently aggregate zero evidence.

In `app/api/cron/update-cameras/lib/aiScoring.ts` (~line 106), add `export`:

```ts
export function resolveBinaryModelVersion(): string {
```

Change nothing else in that file.

- [ ] **Step 2: Write the route**

Create `app/api/cron/recompute-camera-calibration/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { verifyCronAuth } from '../update-cameras/lib/auth';
import { recomputeCameraCalibration } from '../update-cameras/lib/recomputeCameraCalibration';
import { resolveBinaryModelVersion } from '../update-cameras/lib/aiScoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Per-camera calibration recompute.
// Spec: docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md
//
// Derives a bounded per-camera tempering multiplier from accumulated error
// evidence and writes it to the webcams row. Pure SQL recompute (no image
// download, no ONNX), so it does NOT need the ml/artifacts bundle and runs on
// its own nightly schedule, isolated from the live-scoring tick budget.
//
// It NEVER touches the detection verdict — only the tile/quality signal.

async function handle(request: Request) {
  if (!verifyCronAuth(request) && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await recomputeCameraCalibration({
      // The EFFECTIVE version, not the default constant — env can override it,
      // and the evidence rows are scoped by the version actually in use.
      modelVersion: resolveBinaryModelVersion(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[recompute-camera-calibration] failed:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
```

- [ ] **Step 3: Add the nightly cron entry**

In `vercel.json`, add to the `crons` array:

```json
    {
      "path": "/api/cron/recompute-camera-calibration",
      "schedule": "15 4 * * *"
    }
```

- [ ] **Step 4: Verify the route compiles and the config is valid JSON**

Run: `npx tsc --noEmit && node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('vercel.json OK')"`
Expected: no TS errors, then `vercel.json OK`.

- [ ] **Step 5: Verify branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/api/cron/recompute-camera-calibration/route.ts app/api/cron/update-cameras/lib/aiScoring.ts vercel.json
git commit -m "feat(calibration): nightly cron route and schedule"
```

---

### Task 7: Apply the multiplier to the tile signal (clause 4)

**Files:**
- Modify: `app/components/mosaic/v1/qualitySignal.ts`
- Modify: `app/components/mosaic/v1/qualitySignal.test.ts`
- Modify: `app/lib/types.ts`
- Modify: `app/api/db-all-webcams/route.ts`

**Interfaces:**
- Consumes: `applyTempering` from Task 1.
- Produces: `WindyWebcam.calibrationMultiplier?: number`; `getQualityScore` returns a tempered score.

**⚠️ `qualitySignal.ts` is a shared helper.** CLAUDE.md requires a heads-up to the display lane when it changes. That message has already been sent for this change; if this task is executed later than 2026-09-01, re-send before committing.

- [ ] **Step 1: Add the field to `WindyWebcam`**

In `app/lib/types.ts`, next to the other ai rating fields (~line 95):

```ts
  /**
   * Per-camera tempering multiplier in [0.5, 1]. Undefined = neutral.
   * Applies to the TILE signal only — never the detection verdict.
   * Spec: docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md
   */
  calibrationMultiplier?: number;
```

- [ ] **Step 2: Write the failing tests**

Append to `app/components/mosaic/v1/qualitySignal.test.ts`:

```ts
describe('per-camera tempering', () => {
  it('shrinks the tile score for a tempered camera', () => {
    const score = getQualityScore({
      ...base,
      aiRatingBinary: SHOWN,
      aiRatingRegression: 5,
      calibrationMultiplier: 0.5,
    } as WindyWebcam);
    expect(score).toBe(3);
  });

  it('is a no-op for an untempered camera', () => {
    expect(
      getQualityScore({
        ...base,
        aiRatingBinary: SHOWN,
        aiRatingRegression: 3.7,
      })
    ).toBe(3.7);
  });

  it('keeps the floor at 1 for a rejected frame regardless of multiplier', () => {
    expect(
      getQualityScore({
        ...base,
        aiRatingBinary: REJECTED,
        aiRatingRegression: 4.2,
        calibrationMultiplier: 0.5,
      } as WindyWebcam)
    ).toBe(1);
  });

  it('leaves passesGate bit-identical with and without a multiplier (clause 4)', () => {
    const atGate = 1 + 0.55 * 4; // 3.2
    for (const binary of [REJECTED, atGate, SHOWN]) {
      const without = passesGate({ ...base, aiRatingBinary: binary });
      const with05 = passesGate({
        ...base,
        aiRatingBinary: binary,
        calibrationMultiplier: 0.5,
      } as WindyWebcam);
      expect(with05).toBe(without);
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- app/components/mosaic/v1/qualitySignal.test.ts`
Expected: FAIL — the tempering test gets 5 instead of 3.

- [ ] **Step 4: Apply the multiplier**

In `app/components/mosaic/v1/qualitySignal.ts`, add the import and change ONLY `getQualityScore`:

```ts
import { applyTempering } from '@/app/lib/cameraCalibration';
```

```ts
export function getQualityScore(webcam: WindyWebcam): number | null {
  const detection = webcam.aiRatingBinary;
  if (typeof detection === 'number' && detection < GATE_AS_RATING) {
    return 1;
  }
  const raw = webcam.aiRatingRegression ?? null;
  if (raw == null) return null;
  // Per-camera tempering scales only the part ABOVE the floor, so a tempered
  // frame gets smaller but is never hidden. passesGate is deliberately NOT
  // tempered — the detection verdict is frozen.
  return applyTempering(raw, webcam.calibrationMultiplier);
}
```

Do NOT modify `passesGate`.

- [ ] **Step 5: Run the full mosaic test file**

Run: `npm run test -- app/components/mosaic/v1/qualitySignal.test.ts`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 6: Plumb the column through the API**

In `app/api/db-all-webcams/route.ts`: add `w.calibration_multiplier` to the select list after `w.ai_model_version_regression`; add `calibration_multiplier: number | string | null;` to the row type; and add to the mapped object:

```ts
    calibrationMultiplier: toMaybeNumber(row.calibration_multiplier),
```

`toMaybeNumber` already handles the NUMERIC-as-string coercion.

- [ ] **Step 7: Run the full suite**

Run: `npm run test`
Expected: all tests pass, no regressions.

- [ ] **Step 8: Verify branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/v1/qualitySignal.ts app/components/mosaic/v1/qualitySignal.test.ts app/lib/types.ts app/api/db-all-webcams/route.ts
git commit -m "feat(calibration): temper the tile signal, never the gate"
```

---

### Task 8: Acceptance verification (clauses 1-3, 7)

**Files:**
- Create: `ml/verify_calibration_acceptance.py`

**Interfaces:**
- Consumes: populated `camera_calibration_evidence` (Task 3), the constants (Task 1).
- Produces: a pass/fail report; exit code 1 on any failed clause.

- [ ] **Step 1: Write the verifier**

Create `ml/verify_calibration_acceptance.py`:

```python
#!/usr/bin/env python3
"""Pre-registered acceptance test for per-camera calibration leg 1.

Clauses 1-3 and 7 of the spec's 8-clause bar. Clauses 4-6 and 8 are covered by
the TypeScript unit tests. Exits 1 if any clause fails.

Usage:
  .venv/bin/python ml/verify_calibration_acceptance.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg2

MODEL = "20260829_062437_v5_binary_gold"
PRIOR_K, MAX_TEMPER, MIN_MULT = 2.0, 0.5, 0.5
MIN_EVENTS, MIN_DAYS = 3, 2
WINDOW_DAYS, HALF_LIFE = 365, 90

GROUND_TRUTH = {4057187, 2947112, 29095214, 29275205}
OFFENDERS = {
    4057187, 2947112, 29095214, 29275205, 97, 3914190, 5961510, 160,
    28894257, 2051, 3236, 404, 3309592, 2972357, 29048102, 27660488, 29182812,
}


def load_env_local() -> None:
    env = Path(__file__).resolve().parent.parent / ".env.local"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def main() -> None:
    load_env_local()
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(
        """
        SELECT webcam_id,
               SUM(CASE WHEN is_negative AND fired
                        THEN power(0.5, (current_date - captured_on)::numeric / %s)
                        ELSE 0 END),
               SUM(CASE WHEN is_negative
                        THEN power(0.5, (current_date - captured_on)::numeric / %s)
                        ELSE 0 END),
               COUNT(DISTINCT CASE WHEN is_negative AND fired THEN captured_on END),
               COUNT(*) FILTER (WHERE is_negative AND fired)
        FROM camera_calibration_evidence
        WHERE model_version = %s AND captured_on > current_date - %s
        GROUP BY webcam_id
        """,
        (HALF_LIFE, HALF_LIFE, MODEL, WINDOW_DAYS),
    )
    rows = cur.fetchall()

    def mult(fs, nn, days, raw):
        if raw < MIN_EVENTS or days < MIN_DAYS:
            return 1.0
        return max(MIN_MULT, min(1.0, 1.0 - MAX_TEMPER * (float(fs) / (float(nn) + PRIOR_K))))

    tempered = {}
    for wid, fs, nn, days, raw in rows:
        m = mult(fs, nn, days, raw)
        if m < 1.0:
            tempered[wid] = m

    failures = []

    missing = GROUND_TRUTH - set(tempered)
    print(f"clause 1  ground truth tempers: {len(GROUND_TRUTH - missing)}/4")
    for g in sorted(GROUND_TRUTH):
        print(f"            {g}: {tempered.get(g, 1.0):.3f}")
    if missing:
        failures.append(f"clause 1 FAILED — not tempered: {sorted(missing)}")

    extra = set(tempered) - OFFENDERS
    print(f"clause 2  non-offenders tempered: {len(extra)} (must be 0)")
    if extra:
        failures.append(f"clause 2 FAILED — unexpected: {sorted(extra)}")

    print(f"clause 3  fleet bound: {len(tempered)} tempered (must be <= 25)")
    if len(tempered) > 25:
        failures.append(f"clause 3 FAILED — {len(tempered)} tempered")

    cur.execute(
        "SELECT count(*), count(DISTINCT snapshot_id) FROM camera_calibration_evidence "
        "WHERE model_version = %s",
        (MODEL,),
    )
    total, distinct = cur.fetchone()
    print(f"clause 7  retention: {total} rows, {distinct} distinct snapshots")
    if total != distinct:
        failures.append(f"clause 7 FAILED — {total} rows for {distinct} snapshots (duplicates)")

    conn.close()

    print()
    if failures:
        for f in failures:
            print(f"  {f}")
        sys.exit(1)
    print("  ALL CHECKED CLAUSES PASS (1, 2, 3, 7)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the verifier**

Run: `.venv/bin/python ml/verify_calibration_acceptance.py`
Expected:
```
clause 1  ground truth tempers: 4/4
            2947112: 0.714
            4057187: 0.577
            29095214: 0.882
            29275205: 0.833
clause 2  non-offenders tempered: 0 (must be 0)
clause 3  fleet bound: 17 tempered (must be <= 25)
clause 7  retention: 9118 rows, 9118 distinct snapshots
  ALL CHECKED CLAUSES PASS (1, 2, 3, 7)
```

If the multipliers differ from the baseline, STOP and report — do not adjust constants to make the test pass. That would be tuning on the acceptance set, the one forbidden move in this program.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: all pass.

- [ ] **Step 4: Verify branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add ml/verify_calibration_acceptance.py
git commit -m "test(calibration): pre-registered acceptance verifier"
```

---

### Task 9: Ops panel — current state, frames, history

**Files:**
- Modify: `app/lib/opsTypes.ts`
- Modify: `app/api/admin/ops-stats/route.ts`
- Create: `app/api/admin/calibration-frames/route.ts`
- Modify: `app/components/Ops/OpsPanels.tsx`

**Interfaces:**
- Consumes: the two tables and `webcams.calibration_*`.
- Produces: `CalibrationCameraRow`, `CalibrationHistoryRow`, `CalibrationFrameRow`; `GET /api/admin/calibration-frames?webcamId=<id>`.

- [ ] **Step 1: Add the types**

Append to `app/lib/opsTypes.ts`:

```ts
/** A tempered camera and the evidence behind it. */
export interface CalibrationCameraRow {
  webcam_id: number;
  title: string | null;
  multiplier: number;
  false_shows: number;
  negative_frames: number;
  false_show_days: number;
  computed_at: string | null;
}

/** One multiplier change, for the over-time view. */
export interface CalibrationHistoryRow {
  webcam_id: number;
  computed_at: string;
  multiplier: number;
  previous_multiplier: number | null;
}

/**
 * One false-show frame behind a camera's tempering — the "was this camera
 * fairly tempered?" check. Fetched per-camera on expand, never bulk-loaded:
 * the evidence table holds ~9k rows and grows.
 */
export interface CalibrationFrameRow {
  snapshot_id: number;
  captured_on: string;
  p_sunset: number;
  tile: number | null;
  firebase_url: string;
}
```

Add to `OpsStatsResponse`:

```ts
  calibrationCameras: CalibrationCameraRow[];
  calibrationHistory: CalibrationHistoryRow[];
```

- [ ] **Step 2: Serve the rows**

In `app/api/admin/ops-stats/route.ts`, add before the response is assembled:

```ts
  const calibrationCameras = (await sql`
    select w.id as webcam_id, w.title,
           w.calibration_multiplier::float as multiplier,
           (w.calibration_evidence->>'falseShows')::float     as false_shows,
           (w.calibration_evidence->>'negativeFrames')::float as negative_frames,
           (w.calibration_evidence->>'falseShowDays')::int    as false_show_days,
           w.calibration_computed_at::text as computed_at
    from webcams w
    where w.calibration_multiplier is not null
      and w.calibration_multiplier < 1
    order by w.calibration_multiplier asc
    limit 100
  `) as unknown as CalibrationCameraRow[];

  const calibrationHistory = (await sql`
    select webcam_id, computed_at::text as computed_at,
           multiplier::float as multiplier,
           previous_multiplier::float as previous_multiplier
    from camera_calibration_history
    order by computed_at desc
    limit 200
  `) as unknown as CalibrationHistoryRow[];
```

Add both to the `body` object, and import the two new types.

**Note:** the `::float` casts are deliberate — `NUMERIC` otherwise arrives as a string.

- [ ] **Step 3: Add the per-camera frames endpoint**

Create `app/api/admin/calibration-frames/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { sql } from '@/app/lib/db';
import type { CalibrationFrameRow } from '@/app/lib/opsTypes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The frames behind one camera's tempering multiplier. Fetched on expand
// rather than bundled into ops-stats: the evidence table holds ~9k rows today
// and only grows as labels accumulate.
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const webcamId = Number(
    new URL(request.url).searchParams.get('webcamId') ?? '',
  );
  if (!Number.isFinite(webcamId)) {
    return NextResponse.json({ error: 'webcamId required' }, { status: 400 });
  }

  const frames = (await sql`
    select snapshot_id, captured_on::text as captured_on,
           p_sunset::float as p_sunset,
           tile::float as tile,
           firebase_url
    from camera_calibration_evidence
    where webcam_id = ${webcamId}
      and is_negative = true
      and fired = true
    order by tile desc nulls last
    limit 50
  `) as unknown as CalibrationFrameRow[];

  return NextResponse.json({ frames });
}
```

- [ ] **Step 4: Add the panel**

In `app/components/Ops/OpsPanels.tsx`, following the existing panel structure, add a "Camera calibration" panel with three parts:

1. `calibrationCameras` as a table: camera (title + id), multiplier, `false_shows / negative_frames`, days, computed_at.
2. Clicking a row fetches `/api/admin/calibration-frames?webcamId=<id>` and renders the returned frames as thumbnails (`firebase_url`) labelled with `p_sunset` and `tile`. This is the audit surface — it is what makes the retained frames reachable.
3. The most recent `calibrationHistory` entries as `webcam_id: previous → multiplier (computed_at)`, showing "—" when `previous_multiplier` is null.

Match the existing panels' class names and container markup rather than inventing new styling.

- [ ] **Step 5: Run the ops tests and the suite**

Run: `npm run test -- app/components/Ops app/api/admin/ops-stats`
Expected: PASS.

Run: `npm run test`
Expected: all pass.

- [ ] **Step 6: Verify branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/lib/opsTypes.ts app/api/admin/ops-stats/route.ts app/api/admin/calibration-frames/route.ts app/components/Ops/OpsPanels.tsx
git commit -m "feat(calibration): Ops panel with evidence frames and history"
```

---

### Task 10: Build, push, PR

**Files:** none created.

- [ ] **Step 1: Full verification**

Run: `npm run test && npm run lint && npm run build`
Expected: all green. The build must NOT grow the function bundle — this cron carries no ONNX.

- [ ] **Step 2: Verify branch and push**

```bash
git rev-parse --abbrev-ref HEAD
git push -u origin feat/per-camera-calibration
```

- [ ] **Step 3: Open the PR**

Base it on `measure/hard-negative-emphasis` (this branch is stacked on PR #105), and state in the body:
- The 8 acceptance clauses and their measured results.
- **Jesse must apply `database/migrations/20260901_camera_calibration.sql`** before the cron can write. Until then the cron 500s and the multiplier stays NULL (neutral) — the display is unaffected.
- The cron entry is inert until deploy.

---

## Post-Merge Checklist (Jesse's steps — do not attempt these)

- [ ] Apply `database/migrations/20260901_camera_calibration.sql`.
- [ ] Run `.venv/bin/python ml/audit_camera_errors.py --emit-evidence` to populate evidence.
- [ ] Deploy, then confirm `calibration_computed_at` is stamped after the first nightly tick.
- [ ] Re-run `ml/verify_calibration_acceptance.py` against production.
- [ ] Update `docs/superpowers/plans/2026-08-29-two-scale-model-STATE.md` with the calibration outcome.
