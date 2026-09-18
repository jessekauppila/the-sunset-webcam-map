# Hard Example Mining + Private Labeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-flag model disagreements during the cron tick, route them into a private "Hard Examples" drawer tab where the operator labels them via Yes/No verdict + star rating, persist verdicts as gold-standard training labels, and gate the existing snapshot-cleanup endpoint behind a `CLEANUP_ENABLED` flag + retention rules so labeled data never gets deleted.

**Architecture:** Three schema additions on existing tables; cron writes the auto-flag at score-time; cleanup endpoint reads the flag and human-rating join when deciding what to delete; popup `RatingCard` gets a `readOnly` prop (true for the public map popup, false for operator drawer surfaces); a new "Hard Examples" tab uses the existing `SnapshotConsole` batch-loading pattern with a new `mode="hard-examples"`. Forward-compatible migration — all new columns nullable, old code paths unaffected.

**Tech Stack:** Next.js 15 (TypeScript, App Router), Postgres via Neon, vitest, Zustand store, MUI tabs.

**Reference spec:** `docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md`

---

## File Structure

**Create:**
- `database/migrations/20260602_hard_example_mining.sql` — 3 columns + partial index
- `app/components/console/VerdictButtons.tsx` — Yes/No button pair, phase-aware copy

**Modify (config + cron):**
- `app/lib/masterConfig.ts` — `CLEANUP_ENABLED`, `SUNSET_DISAGREEMENT_HIGH`, `SUNSET_DISAGREEMENT_LOW`
- `app/api/cron/update-cameras/lib/aiScoring.ts` — `computeDisagreementKind()` helper + export
- `app/api/cron/update-cameras/lib/dbOperations.ts` — extend `updateSnapshotAiRegressionScore` signature
- `app/api/cron/update-cameras/lib/customBackfill.ts` — pass disagreement kind through

**Modify (API):**
- `app/api/snapshots/cleanup/route.ts` — gate + retention exclusions + danger comment
- `app/api/snapshots/[id]/rate/route.ts` — accept `isSunsetVerdict`, recompute majority column
- `app/api/snapshots/route.ts` — add `mode === 'hard-examples'` branch

**Modify (UI):**
- `app/store/useSnapshotStore.ts` — extend mode union to include `'hard-examples'`
- `app/components/SnapshotConsole.tsx` — mode union expansion + queries
- `app/components/SnapshotQueueCard.tsx` — render `VerdictButtons` + verdict-gates-stars behavior
- `app/components/Webcam/RatingCard.tsx` — add `readOnly?: boolean` prop
- `app/components/Map/hooks/useSetWebcamMarkers.tsx` — pass `readOnly={true}`
- `app/HomeClient.tsx` — insert "Hard Examples" tab at index 1

**Modify (tests):**
- `app/api/cron/update-cameras/lib/aiScoring.test.ts` — disagreement-kind cases
- `app/api/snapshots/[id]/rate/route.test.ts` — NEW; verdict acceptance + majority recompute
- `app/api/snapshots/cleanup/route.test.ts` — NEW; gate + retention behavior

**Modify (docs):**
- `ml/OPERATING_GUIDE.md` — append "Retention rules" section

Each task below corresponds to one focused change with a commit at the end.

---

## Branch Setup

- [ ] **Step 1: Create the feature branch off main**

Run:
```bash
git fetch origin main
git checkout -b feat/hard-example-mining origin/main
```

Expected: switched to new branch, clean working tree.

---

## Task 1: Schema migration

**Files:**
- Create: `database/migrations/20260602_hard_example_mining.sql`

- [ ] **Step 1: Write the migration**

Create `database/migrations/20260602_hard_example_mining.sql` with:

```sql
-- Hard-example mining + private labeling. See
-- docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md
--
-- Forward-only, idempotent. Apply via:
--   psql "$DATABASE_URL" -f database/migrations/20260602_hard_example_mining.sql

-- Per-user verdict on whether a snapshot shows a sunrise/sunset. NULL =
-- no opinion. The existing rating column stays unchanged; both can be
-- written in one upsert from the rate endpoint.
ALTER TABLE webcam_snapshot_ratings
  ADD COLUMN IF NOT EXISTS is_sunset_verdict BOOLEAN;

-- Denormalized columns on webcam_snapshots. The rate endpoint recomputes
-- both at submit time from the per-user rows. The cleanup endpoint and
-- the cron read from these for speed.
ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS human_sunset_majority BOOLEAN;

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS model_disagreement_kind TEXT;

-- Partial index — fast queue reads for the Hard Examples tab.
CREATE INDEX IF NOT EXISTS webcam_snapshots_disagreement_idx
  ON webcam_snapshots (captured_at DESC)
  WHERE model_disagreement_kind IS NOT NULL;
```

- [ ] **Step 2: Apply against Neon**

Set `$DATABASE_URL` if not already set, then:
```bash
psql "$DATABASE_URL" -f database/migrations/20260602_hard_example_mining.sql
```

Expected: four `ALTER TABLE` / `CREATE INDEX` notices, no errors. Idempotent — running twice is safe (`IF NOT EXISTS` everywhere).

- [ ] **Step 3: Verify columns exist**

Run:
```bash
psql "$DATABASE_URL" -c "\d webcam_snapshots" | grep -E "human_sunset_majority|model_disagreement_kind"
psql "$DATABASE_URL" -c "\d webcam_snapshot_ratings" | grep is_sunset_verdict
```

Expected: three lines, one per column, all `boolean`/`text` respectively.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/20260602_hard_example_mining.sql
git commit -m "feat(db): add hard-example mining columns (verdict, majority, disagreement_kind)"
```

---

## Task 2: masterConfig — disagreement thresholds + cleanup gate

**Files:**
- Modify: `app/lib/masterConfig.ts`

- [ ] **Step 1: Add the three new constants**

Open `app/lib/masterConfig.ts`. Find the existing block of AI threshold constants (around line 67-77). Append these new constants AFTER `AI_SNAPSHOT_RECENT_WINDOW_MINUTES`:

```typescript
// ---------------------------------------------------------------------------
// Hard-example mining — model-disagreement thresholds
// ---------------------------------------------------------------------------
// When the binary classifier and regression head point in opposite directions,
// the cron flags the snapshot for the Hard Examples drawer tab. These
// thresholds (on the 1-5 aiRating scale) govern when the disagreement is
// extreme enough to flag. Tightening them yields a smaller queue; loosening
// yields more triage signal. See ml/OPERATING_GUIDE.md "Retention rules".
export const SUNSET_DISAGREEMENT_HIGH = 3.0;
export const SUNSET_DISAGREEMENT_LOW = 2.0;

// ---------------------------------------------------------------------------
// Snapshot cleanup gate
// ---------------------------------------------------------------------------
// Hard kill-switch for /api/snapshots/cleanup. Default OFF — even though no
// cron currently schedules cleanup (vercel.json only schedules
// /api/cron/update-cameras), this flag guarantees that a future schedule or
// a manual POST cannot delete snapshots without an explicit code change.
//
// Even when CLEANUP_ENABLED = true, the endpoint still excludes:
//   1. Snapshots with any webcam_snapshot_ratings row (rating OR verdict)
//   2. Snapshots flagged by the cron as model_disagreement_kind != NULL
//   3. (Future) is_window_winner = true once Phase 2 winner-selection ships
//
// History: this flag was added on 2026-06-02 after the audit discovered the
// cleanup endpoint would delete star-rated snapshots indiscriminately. We
// had ~33k snapshots in the archive at the time; nothing had been auto-
// deleted because no cron was scheduled. Flipping CLEANUP_ENABLED = true
// does NOT make cleanup start happening — it only stops returning early.
export const CLEANUP_ENABLED = false;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit -p .
```

Expected: no errors. (You may have unrelated test-file errors that pre-existed; only this file matters.)

- [ ] **Step 3: Commit**

```bash
git add app/lib/masterConfig.ts
git commit -m "feat(config): add SUNSET_DISAGREEMENT_{HIGH,LOW} + CLEANUP_ENABLED constants"
```

---

## Task 3: Cron — `computeDisagreementKind()` helper

**Files:**
- Modify: `app/api/cron/update-cameras/lib/aiScoring.ts`
- Modify: `app/api/cron/update-cameras/lib/aiScoring.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `app/api/cron/update-cameras/lib/aiScoring.test.ts`. Find the bottom of the file (after the `describe('softmaxBinaryClassOne', ...)` block) and append:

```typescript
import { computeDisagreementKind } from './aiScoring';

describe('computeDisagreementKind', () => {
  it('returns null when there is no extreme disagreement', () => {
    // binary says yes + regression mid → agreement-ish
    expect(computeDisagreementKind({ binaryIsSunset: true, aiRating: 3.5 })).toBeNull();
    // binary says no + regression mid → not extreme enough
    expect(computeDisagreementKind({ binaryIsSunset: false, aiRating: 2.5 })).toBeNull();
  });

  it('returns "binary_negative_regression_high" when binary says no but regression rating crosses the HIGH threshold', () => {
    expect(
      computeDisagreementKind({ binaryIsSunset: false, aiRating: 3.21 }),
    ).toBe('binary_negative_regression_high');
    // boundary — 3.0 is inclusive
    expect(
      computeDisagreementKind({ binaryIsSunset: false, aiRating: 3.0 }),
    ).toBe('binary_negative_regression_high');
  });

  it('returns "binary_positive_regression_low" when binary says yes but regression rating crosses the LOW threshold', () => {
    expect(
      computeDisagreementKind({ binaryIsSunset: true, aiRating: 1.5 }),
    ).toBe('binary_positive_regression_low');
    // boundary — 2.0 is inclusive
    expect(
      computeDisagreementKind({ binaryIsSunset: true, aiRating: 2.0 }),
    ).toBe('binary_positive_regression_low');
  });

  it('returns null when binaryIsSunset is undefined (binary head did not score)', () => {
    expect(
      computeDisagreementKind({ binaryIsSunset: undefined, aiRating: 4.5 }),
    ).toBeNull();
  });

  it('returns null when aiRating is undefined', () => {
    expect(
      computeDisagreementKind({ binaryIsSunset: true, aiRating: undefined }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npx vitest run app/api/cron/update-cameras/lib/aiScoring.test.ts -t "computeDisagreementKind" --reporter=basic
```

Expected: 5 tests fail with `ReferenceError` or import error (function not yet exported).

- [ ] **Step 3: Implement `computeDisagreementKind`**

Open `app/api/cron/update-cameras/lib/aiScoring.ts`. Near the top with the other imports add:

```typescript
import {
  SUNSET_DISAGREEMENT_HIGH,
  SUNSET_DISAGREEMENT_LOW,
} from '@/app/lib/masterConfig';
```

Just before the `softmaxBinaryClassOne` export at the bottom of the file, add:

```typescript
/**
 * Decide whether the two heads disagree extremely enough to flag the
 * snapshot for the Hard Examples queue. Pure function — no DB writes here,
 * the caller persists the return value on the snapshot row.
 *
 * Returns a kind string OR null:
 *   'binary_negative_regression_high' — false negative (the Taltson case)
 *   'binary_positive_regression_low'  — false positive (model called sunset on something boring)
 *   null                              — agreement, or one head didn't score
 */
export function computeDisagreementKind(input: {
  binaryIsSunset: boolean | undefined;
  aiRating: number | undefined;
}): string | null {
  if (typeof input.binaryIsSunset !== 'boolean') return null;
  if (typeof input.aiRating !== 'number') return null;
  if (!input.binaryIsSunset && input.aiRating >= SUNSET_DISAGREEMENT_HIGH) {
    return 'binary_negative_regression_high';
  }
  if (input.binaryIsSunset && input.aiRating <= SUNSET_DISAGREEMENT_LOW) {
    return 'binary_positive_regression_low';
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx vitest run app/api/cron/update-cameras/lib/aiScoring.test.ts -t "computeDisagreementKind" --reporter=basic
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/aiScoring.ts app/api/cron/update-cameras/lib/aiScoring.test.ts
git commit -m "feat(cron): add computeDisagreementKind helper for hard-example triage"
```

---

## Task 4: Cron — write `model_disagreement_kind` on every scored snapshot

**Files:**
- Modify: `app/api/cron/update-cameras/lib/dbOperations.ts`
- Modify: `app/api/cron/update-cameras/lib/customBackfill.ts`
- Modify: `app/api/cron/update-cameras/lib/customBackfill.test.ts`
- Modify: `app/api/cron/update-cameras/lib/dbOperations.backfill.test.ts`

- [ ] **Step 1: Extend the `updateSnapshotAiRegressionScore` signature in dbOperations**

Open `app/api/cron/update-cameras/lib/dbOperations.ts`. Find the function `updateSnapshotAiRegressionScore` (around line 337). Replace it with:

```typescript
export async function updateSnapshotAiRegressionScore(
  snapshotId: number,
  score: number,
  modelVersion: string,
  scoringPath: string,
  disagreementKind: string | null,
): Promise<void> {
  await sql`
    update webcam_snapshots
    set ai_regression_score = ${score},
        ai_model_version_regression = ${modelVersion},
        scoring_path = ${scoringPath},
        model_disagreement_kind = ${disagreementKind}
    where id = ${snapshotId}
  `;
}
```

- [ ] **Step 2: Update the failing test in dbOperations.backfill.test.ts**

Open `app/api/cron/update-cameras/lib/dbOperations.backfill.test.ts`. Find the two `updateSnapshotAiRegressionScore` test calls and update them to pass the new arg. Specifically:

Replace the body of the first `it('writes ai_regression_score + ai_model_version_regression for a snapshot id', ...)` test with:

```typescript
    sqlMock.mockResolvedValue([]);
    await updateSnapshotAiRegressionScore(7, 0.812, 'v4', 'onnx', null);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+webcam_snapshots/i);
    expect(q).toMatch(/ai_regression_score/);
    expect(q).toMatch(/ai_model_version_regression/);
    expect(q).toMatch(/model_disagreement_kind/);
    expect(values).toContain(7);
    expect(values).toContain(0.812);
    expect(values).toContain('v4');
```

Replace the body of `it('also writes scoring_path so contaminated rows are queryable later', ...)`:

```typescript
    sqlMock.mockResolvedValue([]);
    await updateSnapshotAiRegressionScore(7, 0.812, 'v4', 'onnx', null);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/scoring_path/);
    expect(values).toContain('onnx');
```

Replace the body of `it('persists baseline-fallback when the scoring path was a fallback', ...)`:

```typescript
    sqlMock.mockResolvedValue([]);
    await updateSnapshotAiRegressionScore(7, 0.5, 'v4', 'baseline-fallback', null);
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain('baseline-fallback');
```

Add this new test at the end of the `describe('updateSnapshotAiRegressionScore', ...)` block (before the closing `});`):

```typescript
  it('writes the disagreement kind when one is provided', async () => {
    sqlMock.mockResolvedValue([]);
    await updateSnapshotAiRegressionScore(
      7,
      0.812,
      'v4',
      'onnx',
      'binary_negative_regression_high',
    );
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain('binary_negative_regression_high');
  });
```

- [ ] **Step 3: Update customBackfill.ts to compute + pass disagreement kind**

Open `app/api/cron/update-cameras/lib/customBackfill.ts`. Add to the top imports:

```typescript
import { computeDisagreementKind } from './aiScoring';
```

Find the call to `updateSnapshotAiRegressionScore` (around line 45-50). Replace it with:

```typescript
      const disagreementKind = computeDisagreementKind({
        binaryIsSunset: result.binaryIsSunset,
        aiRating: result.aiRating,
      });
      await updateSnapshotAiRegressionScore(
        row.snapshotId,
        result.rawScore,
        result.modelVersion,
        result.pathTaken,
        disagreementKind,
      );
```

- [ ] **Step 4: Update customBackfill.test.ts to match the new signature**

Open `app/api/cron/update-cameras/lib/customBackfill.test.ts`. Find the assertions on `updateSnapMock`:

```typescript
    expect(updateSnapMock).toHaveBeenCalledWith(11, 0.82, 'v4', 'onnx');
    expect(updateSnapMock).toHaveBeenCalledWith(12, 0.82, 'v4', 'onnx');
```

Replace with:

```typescript
    expect(updateSnapMock).toHaveBeenCalledWith(11, 0.82, 'v4', 'onnx', null);
    expect(updateSnapMock).toHaveBeenCalledWith(12, 0.82, 'v4', 'onnx', null);
```

The `null` is because the existing test mocks `scoreImage` to return `aiRating: 4` and `binaryIsSunset: true` — that's agreement (not a disagreement).

- [ ] **Step 5: Run cron-side tests to verify everything passes**

Run:
```bash
npx vitest run app/api/cron/update-cameras --reporter=basic
```

Expected: all tests pass (existing + new). If anything fails, check the signature changes line up across all three files.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/update-cameras/lib/dbOperations.ts \
        app/api/cron/update-cameras/lib/dbOperations.backfill.test.ts \
        app/api/cron/update-cameras/lib/customBackfill.ts \
        app/api/cron/update-cameras/lib/customBackfill.test.ts
git commit -m "feat(cron): write model_disagreement_kind on every scored snapshot"
```

---

## Task 5: Cleanup endpoint — `CLEANUP_ENABLED` gate

**Files:**
- Modify: `app/api/snapshots/cleanup/route.ts`
- Create: `app/api/snapshots/cleanup/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/snapshots/cleanup/route.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const deleteFromFirebaseMock = vi.fn();
const cleanupEnabledMock = { value: false };

vi.mock('@/app/lib/db', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
}));
vi.mock('@/app/lib/webcamSnapshot', () => ({
  deleteFromFirebase: (...a: unknown[]) => deleteFromFirebaseMock(...a),
}));
vi.mock('@/app/lib/masterConfig', () => ({
  get CLEANUP_ENABLED() {
    return cleanupEnabledMock.value;
  },
}));

import { GET } from './route';

beforeEach(() => {
  sqlMock.mockReset();
  deleteFromFirebaseMock.mockReset().mockResolvedValue(undefined);
  cleanupEnabledMock.value = false;
  process.env.NODE_ENV = 'development'; // bypass the auth gate
});

function makeReq(): Request {
  return new Request('http://test/api/snapshots/cleanup', { method: 'GET' });
}

describe('GET /api/snapshots/cleanup', () => {
  it('refuses to delete anything when CLEANUP_ENABLED is false', async () => {
    cleanupEnabledMock.value = false;
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.deleted).toBe(0);
    expect(body.skipped_reason).toContain('CLEANUP_ENABLED');
    expect(sqlMock).not.toHaveBeenCalled();
    expect(deleteFromFirebaseMock).not.toHaveBeenCalled();
  });

  it('queries the snapshot table when CLEANUP_ENABLED is true', async () => {
    cleanupEnabledMock.value = true;
    sqlMock.mockResolvedValueOnce([]); // SELECT returns nothing
    await GET(makeReq());
    expect(sqlMock).toHaveBeenCalled();
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/captured_at < NOW\(\) - INTERVAL '7 days'/i);
  });

  it('excludes snapshots flagged as model disagreements', async () => {
    cleanupEnabledMock.value = true;
    sqlMock.mockResolvedValueOnce([]);
    await GET(makeReq());
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/model_disagreement_kind\s+is\s+null/i);
  });

  it('excludes snapshots with any rating row (rating OR verdict)', async () => {
    cleanupEnabledMock.value = true;
    sqlMock.mockResolvedValueOnce([]);
    await GET(makeReq());
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/webcam_snapshot_ratings/i);
    expect(q).toMatch(/rating\s+is\s+not\s+null\s+or\s+is_sunset_verdict\s+is\s+not\s+null/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npx vitest run app/api/snapshots/cleanup/route.test.ts --reporter=basic
```

Expected: 4 tests fail. The first test fails because the current endpoint deletes regardless; the others fail because the SELECT doesn't have the new filter clauses.

- [ ] **Step 3: Implement the gate + new query**

Open `app/api/snapshots/cleanup/route.ts`. Replace the entire file with:

```typescript
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { deleteFromFirebase } from '@/app/lib/webcamSnapshot';
import { CLEANUP_ENABLED } from '@/app/lib/masterConfig';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

// ---------------------------------------------------------------------------
// DANGER — Cleanup endpoint state as of 2026-06-02
// ---------------------------------------------------------------------------
// This endpoint is NOT on any cron schedule. It only runs when manually
// invoked. Even then, it respects:
//   1. The CLEANUP_ENABLED flag in app/lib/masterConfig.ts (default false)
//   2. Snapshots with any webcam_snapshot_ratings row (rating OR verdict)
//      survive forever — they're training data
//   3. Snapshots with model_disagreement_kind != NULL survive — they're on
//      the Hard Examples queue waiting for a verdict
//
// Before adding this endpoint to vercel.json's crons or POSTing to it
// manually, re-read the retention rules above. The archive contained
// ~33,000 snapshots when this gate was added; an accidental cleanup run
// would have nuked thousands of star-rated snapshots.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  return cleanup(request);
}

export async function POST(request: Request) {
  return cleanup(request);
}

async function cleanup(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const isAuthorized =
      authHeader === `Bearer ${process.env.CRON_SECRET}` ||
      process.env.NODE_ENV === 'development';

    if (!isAuthorized && process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!CLEANUP_ENABLED) {
      return NextResponse.json({
        ok: true,
        deleted: 0,
        skipped_reason:
          'CLEANUP_ENABLED is false in app/lib/masterConfig.ts. ' +
          'Flip to true if you intentionally want to prune. See the comment ' +
          'block at the top of this route for retention rules.',
      });
    }

    console.log('Starting snapshot cleanup...');

    // Three classes of snapshots are NEVER cleaned up:
    //   1. Anything older than 7 days that has no human signal and no
    //      model-disagreement signal — that's the only thing we drop.
    //   2. Anything with model_disagreement_kind set (queued for triage).
    //   3. Anything that any user ever rated or verdicted (training data).
    const oldSnapshots = await sql`
      SELECT id, firebase_path, captured_at
      FROM webcam_snapshots
      WHERE captured_at < NOW() - INTERVAL '7 days'
        AND model_disagreement_kind IS NULL
        AND id NOT IN (
          SELECT DISTINCT snapshot_id FROM webcam_snapshot_ratings
          WHERE rating IS NOT NULL OR is_sunset_verdict IS NOT NULL
        )
      ORDER BY captured_at ASC
    `;

    console.log(`Found ${oldSnapshots.length} snapshots to clean up`);

    const results = {
      ok: true,
      deleted: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const snapshot of oldSnapshots) {
      try {
        await deleteFromFirebase(snapshot.firebase_path as string);
        await sql`
          DELETE FROM webcam_snapshots
          WHERE id = ${snapshot.id as number}
        `;
        results.deleted++;
      } catch (error) {
        console.error(
          `Failed to delete snapshot ${snapshot.id}:`,
          error,
        );
        results.failed++;
        results.errors.push(
          `Snapshot ${snapshot.id}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    }

    console.log(
      `Cleanup complete. Deleted: ${results.deleted}, Failed: ${results.failed}`,
    );

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error in cleanup route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details:
          error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx vitest run app/api/snapshots/cleanup/route.test.ts --reporter=basic
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/snapshots/cleanup/route.ts app/api/snapshots/cleanup/route.test.ts
git commit -m "feat(cleanup): gate behind CLEANUP_ENABLED + exclude rated/disagreement rows"
```

---

## Task 6: Rate endpoint — accept `isSunsetVerdict`

**Files:**
- Modify: `app/api/snapshots/[id]/rate/route.ts`
- Create: `app/api/snapshots/[id]/rate/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/snapshots/[id]/rate/route.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
}));

import { POST } from './route';

beforeEach(() => {
  sqlMock.mockReset();
});

function makeReq(body: Record<string, unknown>): Request {
  return new Request('http://test/api/snapshots/1/rate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/snapshots/[id]/rate', () => {
  it('accepts star-only rating (back-compat with existing UX)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 1 }])           // snapshot exists check
      .mockResolvedValueOnce(undefined)              // upsert rating
      .mockResolvedValueOnce([{ avg_rating: 4.5 }]) // avg recompute
      .mockResolvedValueOnce(undefined)              // update calculated_rating
      .mockResolvedValueOnce([{ majority: null }])  // verdict majority recompute
      .mockResolvedValueOnce(undefined)              // update human_sunset_majority
      .mockResolvedValueOnce([{ rating_count: 3 }]);// count
    const res = await POST(
      makeReq({ userSessionId: 's1', rating: 5 }),
      makeContext('1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.calculatedRating).toBe(4.5);
  });

  it('accepts verdict-only submit (No path — no rating allowed)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ avg_rating: null }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ majority: false }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ rating_count: 1 }]);
    const res = await POST(
      makeReq({ userSessionId: 's1', isSunsetVerdict: false }),
      makeContext('1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('accepts verdict + rating together (Yes path)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ avg_rating: 4.0 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ majority: true }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ rating_count: 1 }]);
    const res = await POST(
      makeReq({ userSessionId: 's1', isSunsetVerdict: true, rating: 4 }),
      makeContext('1'),
    );
    expect(res.status).toBe(200);
  });

  it('rejects rating without verdict=true', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);
    const res = await POST(
      makeReq({ userSessionId: 's1', isSunsetVerdict: false, rating: 4 }),
      makeContext('1'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/can't rate non-sunsets|cannot rate/i);
  });

  it('rejects an empty submit (neither rating nor verdict)', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);
    const res = await POST(
      makeReq({ userSessionId: 's1' }),
      makeContext('1'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required|provide/i);
  });

  it('rejects missing userSessionId', async () => {
    const res = await POST(makeReq({ rating: 5 }), makeContext('1'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
npx vitest run app/api/snapshots/[id]/rate/route.test.ts --reporter=basic
```

Expected: most tests fail. The current endpoint doesn't accept the new shape, doesn't recompute the majority, and doesn't validate the verdict×rating constraints.

- [ ] **Step 3: Update the rate endpoint**

Open `app/api/snapshots/[id]/rate/route.ts`. Replace the file with:

```typescript
//database update tools

import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

interface RateRequest {
  userSessionId: string;
  rating?: number;
  isSunsetVerdict?: boolean;
}

interface DeleteRequest {
  userSessionId: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const snapshotId = parseInt(id, 10);

    if (isNaN(snapshotId)) {
      return NextResponse.json(
        { error: 'Invalid snapshot ID' },
        { status: 400 },
      );
    }

    const body = (await request.json()) as RateRequest;
    const { userSessionId, rating, isSunsetVerdict } = body;

    if (!userSessionId || typeof userSessionId !== 'string') {
      return NextResponse.json(
        { error: 'User session ID required' },
        { status: 400 },
      );
    }

    const hasRating = rating !== undefined && rating !== null;
    const hasVerdict = typeof isSunsetVerdict === 'boolean';

    if (!hasRating && !hasVerdict) {
      return NextResponse.json(
        { error: 'rating or isSunsetVerdict required' },
        { status: 400 },
      );
    }

    if (hasRating) {
      if (
        typeof rating !== 'number' ||
        rating < 1 ||
        rating > 5 ||
        !Number.isInteger(rating)
      ) {
        return NextResponse.json(
          { error: 'Rating must be an integer between 1 and 5' },
          { status: 400 },
        );
      }
      if (hasVerdict && isSunsetVerdict === false) {
        return NextResponse.json(
          { error: "Can't rate non-sunsets — drop the rating or set isSunsetVerdict=true" },
          { status: 400 },
        );
      }
    }

    // Check snapshot exists
    const snapshotCheck = await sql`
      SELECT id FROM webcam_snapshots WHERE id = ${snapshotId}
    `;
    if (snapshotCheck.length === 0) {
      return NextResponse.json(
        { error: 'Snapshot not found' },
        { status: 404 },
      );
    }

    // Upsert. Both columns nullable, both included so unset values clear
    // any prior write from the same user. The COALESCE pattern would
    // preserve old values; we deliberately do NOT use it.
    await sql`
      INSERT INTO webcam_snapshot_ratings (
        snapshot_id, user_session_id, rating, is_sunset_verdict
      )
      VALUES (
        ${snapshotId},
        ${userSessionId},
        ${hasRating ? rating : null},
        ${hasVerdict ? isSunsetVerdict : null}
      )
      ON CONFLICT (snapshot_id, user_session_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        is_sunset_verdict = EXCLUDED.is_sunset_verdict,
        created_at = NOW()
    `;

    // Recompute calculated_rating (existing behavior).
    const avgResult = await sql`
      SELECT AVG(rating)::DECIMAL(3,2) as avg_rating
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
    `;
    const avgRating = avgResult[0]?.avg_rating ?? null;

    await sql`
      UPDATE webcam_snapshots
      SET calculated_rating = ${avgRating}
      WHERE id = ${snapshotId}
    `;

    // Recompute human_sunset_majority (NEW). Majority vote across all
    // users who gave a verdict for this snapshot. Tie → false (treat
    // unclear as not-a-sunset).
    const majorityResult = await sql`
      SELECT
        CASE
          WHEN COUNT(*) FILTER (WHERE is_sunset_verdict = TRUE)
                 > COUNT(*) FILTER (WHERE is_sunset_verdict = FALSE)
          THEN TRUE
          WHEN COUNT(*) FILTER (WHERE is_sunset_verdict = FALSE) > 0
          THEN FALSE
          ELSE NULL
        END AS majority
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
        AND is_sunset_verdict IS NOT NULL
    `;
    const majority = majorityResult[0]?.majority ?? null;

    await sql`
      UPDATE webcam_snapshots
      SET human_sunset_majority = ${majority}
      WHERE id = ${snapshotId}
    `;

    const countResult = await sql`
      SELECT COUNT(*)::int as rating_count
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
    `;
    const ratingCount = countResult[0]?.rating_count ?? 0;

    return NextResponse.json({
      success: true,
      snapshotId,
      calculatedRating: avgRating,
      humanSunsetMajority: majority,
      ratingCount,
    });
  } catch (error) {
    console.error('Error in rate route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details:
          error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const snapshotId = parseInt(id, 10);

    if (isNaN(snapshotId)) {
      return NextResponse.json(
        { error: 'Invalid snapshot ID' },
        { status: 400 },
      );
    }

    const body = (await request.json()) as DeleteRequest;
    const { userSessionId } = body;

    if (!userSessionId || typeof userSessionId !== 'string') {
      return NextResponse.json(
        { error: 'User session ID required' },
        { status: 400 },
      );
    }

    await sql`
      DELETE FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId} AND user_session_id = ${userSessionId}
    `;

    // After delete, recompute both denormalized columns so they don't
    // hold stale values from the now-deleted vote.
    const avgResult = await sql`
      SELECT AVG(rating)::DECIMAL(3,2) as avg_rating
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
    `;
    const avgRating = avgResult[0]?.avg_rating ?? null;
    await sql`
      UPDATE webcam_snapshots
      SET calculated_rating = ${avgRating}
      WHERE id = ${snapshotId}
    `;

    const majorityResult = await sql`
      SELECT
        CASE
          WHEN COUNT(*) FILTER (WHERE is_sunset_verdict = TRUE)
                 > COUNT(*) FILTER (WHERE is_sunset_verdict = FALSE)
          THEN TRUE
          WHEN COUNT(*) FILTER (WHERE is_sunset_verdict = FALSE) > 0
          THEN FALSE
          ELSE NULL
        END AS majority
      FROM webcam_snapshot_ratings
      WHERE snapshot_id = ${snapshotId}
        AND is_sunset_verdict IS NOT NULL
    `;
    const majority = majorityResult[0]?.majority ?? null;
    await sql`
      UPDATE webcam_snapshots
      SET human_sunset_majority = ${majority}
      WHERE id = ${snapshotId}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in rate delete route:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details:
          error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx vitest run app/api/snapshots/[id]/rate/route.test.ts --reporter=basic
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/snapshots/[id]/rate/route.ts app/api/snapshots/[id]/rate/route.test.ts
git commit -m "feat(rate): accept isSunsetVerdict; recompute human_sunset_majority"
```

---

## Task 7: Snapshots route — add `hard-examples` mode

**Files:**
- Modify: `app/api/snapshots/route.ts`

- [ ] **Step 1: Add the hard-examples branch**

Open `app/api/snapshots/route.ts`. Find the line that determines the mode (around line 33):

```typescript
    const mode =
      searchParams.get('mode') === 'curated' ? 'curated' : 'archive';
```

Replace with:

```typescript
    const modeParam = searchParams.get('mode');
    const mode: 'archive' | 'curated' | 'hard-examples' =
      modeParam === 'curated'
        ? 'curated'
        : modeParam === 'hard-examples'
        ? 'hard-examples'
        : 'archive';
```

- [ ] **Step 2: Add the hard-examples query branch**

Open `app/api/snapshots/route.ts`. Find the start of the curated branch (search for `if (mode === 'curated') {`). Just BEFORE that block, add a new branch for `hard-examples`. Open the file, locate `// CURATED MIX MODE` comment around line 76. Add this new block immediately before the `if (mode === 'curated') {` line:

```typescript
    // HARD EXAMPLES MODE: snapshots the cron flagged as model disagreements,
    // ordered newest-first. Excludes anything the current operator has already
    // verdicted (so submitted snapshots leave the queue). See
    // docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md.
    if (mode === 'hard-examples') {
      const userSessionId = searchParams.get('user_session_id');
      const hardExamplesQuery = userSessionId
        ? sql`
            SELECT
              s.id, s.webcam_id, s.captured_at, s.calculated_rating,
              s.initial_rating, s.ai_rating, s.firebase_url,
              s.ai_regression_score, s.ai_model_version_regression,
              s.model_disagreement_kind, s.human_sunset_majority,
              w.title as webcam_title,
              w.location_city, w.location_region, w.location_country,
              w.phase as webcam_phase,
              w.source as webcam_source,
              w.ai_rating as webcam_ai_rating,
              w.ai_model_version as webcam_ai_model_version,
              w.ai_rating_binary as webcam_ai_rating_binary,
              w.ai_model_version_binary as webcam_ai_model_version_binary,
              w.ai_rating_regression as webcam_ai_rating_regression,
              w.ai_model_version_regression as webcam_ai_model_version_regression
            FROM webcam_snapshots s
            LEFT JOIN webcams w ON w.id = s.webcam_id
            WHERE s.model_disagreement_kind IS NOT NULL
              AND s.id NOT IN (
                SELECT snapshot_id FROM webcam_snapshot_ratings
                WHERE user_session_id = ${userSessionId}
                  AND is_sunset_verdict IS NOT NULL
              )
            ORDER BY s.captured_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
          `
        : sql`
            SELECT
              s.id, s.webcam_id, s.captured_at, s.calculated_rating,
              s.initial_rating, s.ai_rating, s.firebase_url,
              s.ai_regression_score, s.ai_model_version_regression,
              s.model_disagreement_kind, s.human_sunset_majority,
              w.title as webcam_title,
              w.location_city, w.location_region, w.location_country,
              w.phase as webcam_phase,
              w.source as webcam_source,
              w.ai_rating as webcam_ai_rating,
              w.ai_model_version as webcam_ai_model_version,
              w.ai_rating_binary as webcam_ai_rating_binary,
              w.ai_model_version_binary as webcam_ai_model_version_binary,
              w.ai_rating_regression as webcam_ai_rating_regression,
              w.ai_model_version_regression as webcam_ai_model_version_regression
            FROM webcam_snapshots s
            LEFT JOIN webcams w ON w.id = s.webcam_id
            WHERE s.model_disagreement_kind IS NOT NULL
            ORDER BY s.captured_at DESC
            LIMIT ${pageSize} OFFSET ${offset}
          `;

      const rows = (await hardExamplesQuery) as SnapshotRow[];

      const countResult = userSessionId
        ? await sql`
            SELECT COUNT(*)::int AS total
            FROM webcam_snapshots s
            WHERE s.model_disagreement_kind IS NOT NULL
              AND s.id NOT IN (
                SELECT snapshot_id FROM webcam_snapshot_ratings
                WHERE user_session_id = ${userSessionId}
                  AND is_sunset_verdict IS NOT NULL
              )
          `
        : await sql`
            SELECT COUNT(*)::int AS total
            FROM webcam_snapshots s
            WHERE s.model_disagreement_kind IS NOT NULL
          `;
      const total = (countResult as Array<{ total: number }>)[0]?.total ?? 0;

      return NextResponse.json({
        snapshots: rows.map(transformSnapshot),
        page,
        pageSize,
        total,
      });
    }
```

The function names `transformSnapshot` and the variables `page`, `pageSize`, `offset` are already in scope in this file. If your environment shows them undefined, scroll up — they're defined earlier in the same `GET` handler.

- [ ] **Step 3: Build to verify nothing else broke**

Run:
```bash
DATABASE_URL='postgresql://stub:stub@localhost/stub?sslmode=disable' npm run build 2>&1 | grep -i error | head -10
```

Expected: no errors. (Warnings are fine.)

- [ ] **Step 4: Commit**

```bash
git add app/api/snapshots/route.ts
git commit -m "feat(api): add mode=hard-examples to /api/snapshots query"
```

---

## Task 8: Extend the Snapshot store to include `hard-examples`

**Files:**
- Modify: `app/store/useSnapshotStore.ts`

- [ ] **Step 1: Extend the mode union throughout**

Open `app/store/useSnapshotStore.ts`. Find every occurrence of `'archive' | 'curated' | 'unrated'` and replace with `'archive' | 'curated' | 'unrated' | 'hard-examples'`.

If you can't find them via search, look for these patterns:
- The mode parameter type on `setPage`, `nextPage`, `previousPage`, etc.
- Any `mode === 'archive'` / `'curated'` / `'unrated'` switches

Add adjacent state fields mirroring the archive ones:

```typescript
  hardExamples: Snapshot[];
  hardExamplesPage: number;
  hardExamplesPageSize: number;
  hardExamplesTotal: number;
```

In the initial state object, add:

```typescript
  hardExamples: [],
  hardExamplesPage: 1,
  hardExamplesPageSize: 24,
  hardExamplesTotal: 0,
```

Inside the actions that switch on mode, add the `'hard-examples'` case mirroring how `'archive'` is handled.

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit -p . 2>&1 | grep -v ".test." | grep "error TS" | head -10
```

Expected: no NON-test errors that mention `'hard-examples'`. If you see existing test errors, ignore them (they're pre-existing).

- [ ] **Step 3: Commit**

```bash
git add app/store/useSnapshotStore.ts
git commit -m "feat(store): extend snapshot mode union to include hard-examples"
```

---

## Task 9: SnapshotConsole — accept `hard-examples` mode

**Files:**
- Modify: `app/components/SnapshotConsole.tsx`

- [ ] **Step 1: Extend the mode prop type**

Open `app/components/SnapshotConsole.tsx`. Find the line `mode: 'archive' | 'curated' | 'unrated';` (around line 15). Replace with:

```typescript
  mode: 'archive' | 'curated' | 'unrated' | 'hard-examples';
```

- [ ] **Step 2: Pick the active mode's data**

Find the block that reads `currentData`, `currentPage`, `pageSize`, `total` (around lines 53-61). Extend each ternary with a `'hard-examples'` clause. The full block becomes:

```typescript
  const currentData =
    mode === 'archive'
      ? archive
      : mode === 'curated'
      ? curated
      : mode === 'hard-examples'
      ? hardExamples
      : unrated;
  const currentPage =
    mode === 'archive'
      ? archivePage
      : mode === 'curated'
      ? curatedPage
      : mode === 'hard-examples'
      ? hardExamplesPage
      : 1;
  const pageSize =
    mode === 'archive'
      ? archivePageSize
      : mode === 'curated'
      ? curatedPageSize
      : mode === 'hard-examples'
      ? hardExamplesPageSize
      : 24;
  const total =
    mode === 'archive'
      ? archiveTotal
      : mode === 'curated'
      ? curatedTotal
      : mode === 'hard-examples'
      ? hardExamplesTotal
      : 0;
```

You'll need to import the new `hardExamples*` state fields from the store. Add them to the existing `useSnapshotStore(...)` selector calls at the top of the component, mirroring how `archive*` and `curated*` are imported.

- [ ] **Step 3: Wire mode into the fetch URL**

Find where the existing fetch call is constructed (search for `mode=`). Mirror the existing logic for `'archive'` / `'curated'` — when `mode === 'hard-examples'`, the URL gains `?mode=hard-examples`. The backend route already accepts this (Task 7).

- [ ] **Step 4: Build to verify**

Run:
```bash
DATABASE_URL='postgresql://stub:stub@localhost/stub?sslmode=disable' npm run build 2>&1 | grep -i error | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/SnapshotConsole.tsx
git commit -m "feat(console): SnapshotConsole supports mode=hard-examples"
```

---

## Task 10: VerdictButtons component

**Files:**
- Create: `app/components/console/VerdictButtons.tsx`

- [ ] **Step 1: Create the component**

Create `app/components/console/VerdictButtons.tsx`:

```tsx
'use client';

import { useState } from 'react';

/**
 * Yes / No buttons that capture the operator's "is this a sunrise/sunset?"
 * verdict. Sits above the star rating in the labeling card. Phase-aware copy.
 *
 * Behavior contract:
 *   - No verdict yet → both buttons un-selected; onChange not called
 *   - "Yes" clicked → highlights, onChange(true) fires (parent enables stars)
 *   - "No" clicked  → highlights, onChange(false) fires (parent hides stars +
 *                     submits immediately since there's nothing else to enter)
 *   - Clicking the already-selected button un-selects (onChange(null))
 */

export type Verdict = boolean | null;

export type VerdictButtonsProps = {
  value: Verdict;
  onChange: (next: Verdict) => void;
  /** Webcam phase. Drives the question copy ("Is this a sunrise?" vs sunset). */
  phase?: 'sunrise' | 'sunset' | null;
  /** Disable interaction (e.g. when a submit is in-flight). */
  disabled?: boolean;
};

export default function VerdictButtons({
  value,
  onChange,
  phase = null,
  disabled = false,
}: VerdictButtonsProps) {
  const phaseWord =
    phase === 'sunrise'
      ? 'sunrise'
      : phase === 'sunset'
      ? 'sunset'
      : 'sunrise or sunset';
  const question = `Is this a ${phaseWord}?`;

  const handleClick = (next: boolean) => {
    if (disabled) return;
    // Click the already-selected button → un-select.
    onChange(value === next ? null : next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs uppercase tracking-wide text-gray-500">
        {question}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handleClick(true)}
          disabled={disabled}
          aria-pressed={value === true}
          className={`flex-1 rounded border px-3 py-1.5 text-sm font-medium transition ${
            value === true
              ? 'border-amber-500 bg-amber-100 text-amber-900'
              : 'border-gray-300 text-gray-700 hover:border-gray-400'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => handleClick(false)}
          disabled={disabled}
          aria-pressed={value === false}
          className={`flex-1 rounded border px-3 py-1.5 text-sm font-medium transition ${
            value === false
              ? 'border-slate-500 bg-slate-100 text-slate-900'
              : 'border-gray-300 text-gray-700 hover:border-gray-400'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          No
        </button>
      </div>
    </div>
  );
}

/**
 * Convenience hook for the parent: tracks verdict locally and exposes the
 * "is stars enabled?" derived state. Callers should still POST to the rate
 * endpoint when they want to persist the verdict.
 */
export function useVerdictState(initial: Verdict = null) {
  const [verdict, setVerdict] = useState<Verdict>(initial);
  return {
    verdict,
    setVerdict,
    starsEnabled: verdict === true,
  };
}
```

- [ ] **Step 2: Build to verify**

Run:
```bash
DATABASE_URL='postgresql://stub:stub@localhost/stub?sslmode=disable' npm run build 2>&1 | grep -i error | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/console/VerdictButtons.tsx
git commit -m "feat(console): add VerdictButtons component"
```

---

## Task 11: Wire `VerdictButtons` into `SnapshotQueueCard`

**Files:**
- Modify: `app/components/SnapshotQueueCard.tsx`

- [ ] **Step 1: Inspect the existing card layout**

Open `app/components/SnapshotQueueCard.tsx`. The card renders an image and a star rating with an `onRate` callback. We're adding the verdict layer above the stars.

- [ ] **Step 2: Import VerdictButtons + state**

At the top of the file, add:

```typescript
import VerdictButtons, {
  useVerdictState,
  type Verdict,
} from '@/app/components/console/VerdictButtons';
```

- [ ] **Step 3: Wire verdict state and submit**

Find the existing `onRate` handler and the star-rating render. Add a `useVerdictState()` call in the component body:

```typescript
  const { verdict, setVerdict, starsEnabled } = useVerdictState(null);
```

Replace the existing star-rating block with a wrapper that gates stars on `starsEnabled`. The conceptual structure:

```tsx
  <div className="flex flex-col gap-3">
    <VerdictButtons
      value={verdict}
      onChange={(next) => {
        setVerdict(next);
        if (next === false) {
          // Submit verdict immediately — no star follow-up needed.
          void onRate(0, { isSunsetVerdict: false });
        }
      }}
      phase={
        webcam.phase === 'sunrise' || webcam.phase === 'sunset'
          ? webcam.phase
          : null
      }
    />
    {starsEnabled && (
      <StarRating
        value={currentRating}
        onChange={(value) => {
          void onRate(value, { isSunsetVerdict: true });
        }}
      />
    )}
  </div>
```

Note: the existing `onRate` signature in this codebase takes just `(rating: number) => Promise<RateResult | void>`. Extend it in this file (and wherever the callers pass it in) to optionally accept a second arg. Concretely, change the `onRate` prop signature in this file's prop type to:

```typescript
  onRate: (
    rating: number,
    opts?: { isSunsetVerdict?: boolean },
  ) => Promise<RateResult | void>;
```

The parent (`SnapshotConsole.tsx`) sets up the callback. Open `SnapshotConsole.tsx`, find where it constructs the `onRate` prop for each card, and update the fetch call to send `isSunsetVerdict` in the POST body when present:

```typescript
  const onRate = async (
    rating: number,
    opts?: { isSunsetVerdict?: boolean },
  ): Promise<RateResult | void> => {
    const body: Record<string, unknown> = { userSessionId };
    if (opts?.isSunsetVerdict !== undefined) {
      body.isSunsetVerdict = opts.isSunsetVerdict;
    }
    if (opts?.isSunsetVerdict !== false) {
      body.rating = rating;
    }
    const res = await fetch(`/api/snapshots/${snapshot.id}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    // ... existing response handling stays as-is
  };
```

- [ ] **Step 4: Build to verify**

Run:
```bash
DATABASE_URL='postgresql://stub:stub@localhost/stub?sslmode=disable' npm run build 2>&1 | grep -i error | head -10
```

Expected: no errors. If you get errors about prop-type mismatches, double-check that every place `onRate` is passed in receives the updated signature.

- [ ] **Step 5: Commit**

```bash
git add app/components/SnapshotQueueCard.tsx app/components/SnapshotConsole.tsx
git commit -m "feat(console): SnapshotQueueCard supports Yes/No verdict gating stars"
```

---

## Task 12: `RatingCard` `readOnly` prop + map popup uses it

**Files:**
- Modify: `app/components/Webcam/RatingCard.tsx`
- Modify: `app/components/Map/hooks/useSetWebcamMarkers.tsx`

- [ ] **Step 1: Add the `readOnly` prop to RatingCard**

Open `app/components/Webcam/RatingCard.tsx`. Find the `RatingCardProps` type (around line 13). Add:

```typescript
  /**
   * When true, hides the StarRating widget and the rate-handler entry
   * point. The AI verdict + rating block stays visible. Used by the
   * public map popup; drawer surfaces leave this unset.
   */
  readOnly?: boolean;
```

Find the function signature `export function RatingCard({...}: RatingCardProps)` and add `readOnly = false` to the destructure list.

Find the JSX that renders the rate prompt + StarRating widget (it'll be something like `<p>{rateText}</p>` followed by `<StarRating ... />`). Wrap that block in `{!readOnly && (...)}`:

```tsx
        {!readOnly && (
          <div className="flex flex-col items-start gap-1">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              {rateText}
            </p>
            <StarRating
              value={currentRating}
              onChange={handleRate}
              disabled={disabled || submitting}
            />
            {error && (
              <p className="text-xs text-red-500 mt-1">{error}</p>
            )}
            {feedback && (
              <p
                className={`text-xs rounded px-2 py-1 mt-1 border ${feedbackToneClass}`}
              >
                {feedback.message}
              </p>
            )}
          </div>
        )}
```

(The exact JSX may differ slightly from the above — preserve whatever's currently there and just wrap it.)

- [ ] **Step 2: Pass `readOnly={true}` from the map popup**

Open `app/components/Map/hooks/useSetWebcamMarkers.tsx`. Find where `<RatingCard ... />` is mounted (search for `<RatingCard`). Add the `readOnly` prop:

```tsx
            <RatingCard
              webcam={webcam}
              initialRating={initialRating}
              onRate={async () => {
                /* no-op; map popup is read-only */
              }}
              readOnly={true}
              heading={...}
            />
```

- [ ] **Step 3: Build to verify**

Run:
```bash
DATABASE_URL='postgresql://stub:stub@localhost/stub?sslmode=disable' npm run build 2>&1 | grep -i error | head -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/Webcam/RatingCard.tsx app/components/Map/hooks/useSetWebcamMarkers.tsx
git commit -m "feat(rating): RatingCard.readOnly prop; map popup mounts read-only"
```

---

## Task 13: Insert the "Hard Examples" tab in HomeClient

**Files:**
- Modify: `app/HomeClient.tsx`

- [ ] **Step 1: Add the tab label**

Open `app/HomeClient.tsx`. Find the `<Tabs ...>` block (around line 114). Locate the existing labels:

```tsx
              <Tab label="Current Sunrises/Sunsets" />
              <Tab label="Snapshot Archive" />
```

Insert "⚠ Hard Examples" between them:

```tsx
              <Tab label="Current Sunrises/Sunsets" />
              <Tab label="⚠ Hard Examples" />
              <Tab label="Snapshot Archive" />
```

- [ ] **Step 2: Renumber the existing tab content blocks**

Each existing `{tabValue === N && (...)}` block needs to shift up by one because we inserted a tab at index 1. Find every `tabValue === N` for N >= 1, and increment:

- Old `tabValue === 1` → `tabValue === 2`
- Old `tabValue === 2` → `tabValue === 3`
- Old `tabValue === 3` → `tabValue === 4`
- Old `tabValue === 4` → `tabValue === 5`
- Old `tabValue === 5` → `tabValue === 6`

- [ ] **Step 3: Add the new tab content for "Hard Examples" at index 1**

Right after the `{tabValue === 0 && (...)}` block (which renders the current sunrises/sunsets), insert:

```tsx
              {tabValue === 1 && (
                // Hard Examples — model-disagreement queue
                <Box>
                  <SnapshotConsole
                    mode="hard-examples"
                    title={'⚠ Hard Examples — confirm or correct the model'}
                    hotkeysEnabled={drawerOpen}
                  />
                </Box>
              )}
```

- [ ] **Step 4: Build to verify**

Run:
```bash
DATABASE_URL='postgresql://stub:stub@localhost/stub?sslmode=disable' npm run build 2>&1 | grep -i error | head -5
```

Expected: no errors. The new tab compiles even though the actual data-fetching for `mode="hard-examples"` was wired in Tasks 7-9.

- [ ] **Step 5: Commit**

```bash
git add app/HomeClient.tsx
git commit -m "feat(drawer): insert Hard Examples tab at index 1"
```

---

## Task 14: OPERATING_GUIDE — retention rules section

**Files:**
- Modify: `ml/OPERATING_GUIDE.md`

- [ ] **Step 1: Append the new section**

Open `ml/OPERATING_GUIDE.md`. Scroll to the end of the file. Append:

```markdown

---

## Snapshot retention rules (as of 2026-06-02)

The webcam_snapshots table is the v5 training corpus. Three classes of rows
are **never** auto-deleted by the cleanup endpoint:

1. **Human-touched** — anyone gave the snapshot a star rating OR a
   binary sunset/sunrise verdict via the Hard Examples drawer tab.
   Implementation: rows joined to `webcam_snapshot_ratings` where
   `rating IS NOT NULL OR is_sunset_verdict IS NOT NULL`.

2. **Model disagreement** — the cron flagged the snapshot via
   `model_disagreement_kind != NULL` because the binary and regression
   heads pointed in opposite directions. These rows sit in the Hard
   Examples queue waiting for human triage.

3. **(Future) Phase 2 winners** — once the winner-selection job ships,
   `is_window_winner = true` becomes the third exclusion class.

### The cleanup endpoint

`/api/snapshots/cleanup` is **not on any cron schedule**. It can only
run when manually POSTed. Even then, it respects the `CLEANUP_ENABLED`
flag in `app/lib/masterConfig.ts` (default `false`).

To intentionally prune old non-valuable snapshots:

```typescript
// 1. Edit app/lib/masterConfig.ts:
export const CLEANUP_ENABLED = true;

// 2. Deploy, then POST to the endpoint:
//    curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//      https://www.sunrisesunset.studio/api/snapshots/cleanup
// 3. Flip CLEANUP_ENABLED back to false to prevent accidents.
```

The endpoint returns the count deleted and a list of any errors per
snapshot.
```

- [ ] **Step 2: Commit**

```bash
git add ml/OPERATING_GUIDE.md
git commit -m "docs(operating): snapshot retention rules + cleanup endpoint"
```

---

## Task 15: End-to-end smoke + PR

- [ ] **Step 1: Full test run**

Run:
```bash
npx vitest run --reporter=basic 2>&1 | tail -10
```

Expected: all tests pass, with at most the two pre-existing failures in `useSetMarker.test.ts` and `terminatorRing.test.ts` (unrelated to this PR).

- [ ] **Step 2: Full production build**

Run:
```bash
DATABASE_URL='postgresql://stub:stub@localhost/stub?sslmode=disable' npm run build 2>&1 | tail -10
```

Expected: build succeeds with no errors. The route summary at the bottom should include `/api/snapshots`.

- [ ] **Step 3: Push the branch and open PR**

```bash
git push -u origin feat/hard-example-mining
```

Open: `https://github.com/jessekauppila/the-sunset-webcam-map/pull/new/feat/hard-example-mining`

PR title: `feat: hard-example mining + private labeling`

PR body (paste into the GitHub description):

```markdown
## Summary

Implements `docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md`. Three database columns, a cron-side auto-flag, a CLEANUP_ENABLED gate that respects training-data retention, a new private drawer tab for labeling model-disagreement snapshots, Yes/No verdict buttons that gate the star rating, and removal of the public popup rating widget.

## Database migration

Applied via:
```bash
psql "$DATABASE_URL" -f database/migrations/20260602_hard_example_mining.sql
```
Idempotent. Run before deploying the code changes (all new columns nullable; old code keeps working).

## Test plan

- [x] vitest: full suite passes (besides chronic terminatorRing + useSetMarker failures unrelated to this PR)
- [x] Production build clean
- [ ] After deploy: open the drawer, confirm "⚠ Hard Examples" tab renders left of "Snapshot Archive"
- [ ] After deploy: click a webcam on the map → popup shows verdict + stars but NO Rate UI
- [ ] After deploy: in Hard Examples tab, click No on a snapshot → it leaves the queue; click Yes + 4 stars on another → it leaves the queue; query DB to confirm `webcam_snapshot_ratings.is_sunset_verdict` and `webcam_snapshots.human_sunset_majority` populated
- [ ] After deploy: verify `CLEANUP_ENABLED` is false by `curl -X POST .../api/snapshots/cleanup` and confirming `{deleted: 0, skipped_reason: 'CLEANUP_ENABLED is false...'}`

## What's not in this PR

- Phase 2 winner-selection retention exclusion (lands when winner-selection ships)
- Hard-example dataset extraction in `ml/export_dataset.py` (lands when v5 training starts)
- Operator auth (anonymous session model continues)

## References

- Spec: `docs/superpowers/specs/2026-06-02-hard-example-mining-and-private-labeling-design.md`
- Memory: `feedback_silent_ml_fallback.md` (silent-failure family)
```

---

## Success criteria

1. **Retention story safe**: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://www.sunrisesunset.studio/api/snapshots/cleanup` returns `{deleted: 0, skipped_reason: ...}` — proves nothing is being auto-deleted accidentally
2. **Disagreements get flagged**: After 10 minutes of cron ticks against current production webcams, a query like `SELECT COUNT(*) FROM webcam_snapshots WHERE model_disagreement_kind IS NOT NULL` returns a positive number
3. **Labeling works end-to-end**: Submit "No" via the Hard Examples tab on a flagged snapshot; verify `webcam_snapshot_ratings.is_sunset_verdict = false` in DB; verify the snapshot disappears from the Hard Examples queue; verify it's protected from cleanup even with `CLEANUP_ENABLED = true`
4. **Map popup is read-only**: Clicking any webcam on the public map shows the AI verdict + rating display with NO interactive rating widget
5. **Custom Pi cam rating still works**: A custom Pi camera snapshot rated via the existing drawer-side path still produces a rating row and the `calculated_rating` updates
