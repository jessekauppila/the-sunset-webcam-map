# Run Collection (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ## ⛔ DO NOT MERGE BEFORE 2026-09-12
> Task 4 edits the `update-cameras` cron, which is the tick the opening-night
> show depends on. The show is Friday 2026-09-12 and the freeze is Wednesday
> 09-10. **Build and review this now, merge it after the show.** Four lost
> evenings of run data is cheap; a broken cron during show week is not.
> Runbook: `docs/superpowers/plans/2026-09-03-opening-night-runbook.md`.

**Goal:** Start collecting uniform, whole-event frame runs from a bounded panel of cameras, so that run-crossing labeling has an unbiased corpus to work on. A run is one camera and one solar event, so a panel camera yields two runs a day, a sunrise and a sunset. "Evening" below is shorthand for either. Both phases are retained; the spec's Leg 0 says why.

**Architecture:** A `run_panel` table names the cameras. A `runtime_flags` row switches collection on without a redeploy. The `update-cameras` cron persists every scored frame for a panel camera and stamps it `intake_reason = 'run'`, which takes highest precedence so a panel frame is never misattributed to a model-gated reason. A pure `runKey` function gives a run its identity from local solar time rather than a fixed UTC offset.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Neon serverless Postgres, forward-only SQL migrations.

**Spec:** `docs/superpowers/specs/2026-09-08-run-crossing-labeling-design.md`

## Global Constraints

- **Migrations apply BEFORE the code that reads the column merges.** `node scripts/apply-migration.mjs <file> --apply`. Dry by default. There is no dev database — every `--apply` is production.
- **Stage explicit paths.** Never `git add -A`. Parallel sessions exist.
- **Verify the branch in the same command as any commit**, per `CLAUDE.md`.
- Run tests with `npm run test`. Lint with `npm run lint`. Build with `npm run build`.
- **Never write derived labels into `manual_labels`.** Out of scope here, but it governs Phase 2 and is repeated so it is not lost.
- `beforeEach` bodies use braces, never a concise arrow returning `mockReset()` — a returned mock value is called as Vitest teardown.
- Panel size is **60 cameras** unless the operator says otherwise.
- Camera coordinates on `webcams` are **`lat` and `lng`, both `double precision`** — verified 2026-09-08. There is no `longitude` column.

## Scope

This plan is Phase 1 of two. **Phase 1 is collection only.** The marking queue, the `run_crossings` table and the reproducibility experiment are Phase 2 and get their own plan, written after this lands and after real runs have accumulated. Phase 1 is useful on its own: it starts banking the corpus, which is the only part that loses value every day it is delayed.

---

### Task 1: Migration — the `run` intake reason, the panel table, the flag

**Files:**
- Create: `database/migrations/20260908_run_panel.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `run_panel (webcam_id BIGINT PRIMARY KEY, added_at TIMESTAMPTZ, note TEXT)`; `runtime_flags` row with key `run_panel_capture`; `webcam_snapshots.intake_reason` accepts `'run'`.

- [ ] **Step 1: Write the migration**

```sql
-- Whole-evening run capture: a bounded panel of cameras whose frames are kept
-- regardless of model score.
--
-- Why: the archive's other intake reasons are model-gated. Measured 2026-09-08,
-- inside 6+ frame sunset runs from the last 45 days, 4,864 frames entered as
-- 'disagreement' against 66 as 'trickle'. The N-to-1 crossing is exactly where
-- both heads agree nothing is there, so the boundary that carries 21 of the 35
-- ceiling disagreements is the one intake systematically drops. Crossing labels
-- derived from those gaps would be interpolations across non-random holes.
-- Spec: docs/superpowers/specs/2026-09-08-run-crossing-labeling-design.md
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260908_run_panel.sql --apply

CREATE TABLE IF NOT EXISTS run_panel (
  webcam_id  BIGINT PRIMARY KEY,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  note       TEXT
);

-- 'run' joins the existing reasons. The full list is restated because the
-- constraint is replaced wholesale, not extended.
ALTER TABLE webcam_snapshots
  DROP CONSTRAINT IF EXISTS webcam_snapshots_intake_reason_check;

ALTER TABLE webcam_snapshots
  ADD CONSTRAINT webcam_snapshots_intake_reason_check
  CHECK (intake_reason IN (
    'disagreement', 'high_rated', 'trickle', 'all_rated', 'scene_capture',
    'operator_label', 'kiosk_bin', 'run'
  ));

-- Seeded OFF. Flip with scripts/set-runtime-flag.mjs once the panel is seeded.
INSERT INTO runtime_flags (key, enabled, note)
VALUES (
  'run_panel_capture',
  false,
  'Keep every scored frame for cameras in run_panel, stamped intake_reason=run. Both phases: ~9 frames per camera-event, two events a day.'
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Dry-run the migration**

Run: `node scripts/apply-migration.mjs database/migrations/20260908_run_panel.sql`
Expected: prints the statements and exits without writing, saying it is a dry run.

- [ ] **Step 3: Commit**

```bash
git add database/migrations/20260908_run_panel.sql
git commit -m "feat(run-capture): migration for run_panel, run intake reason, capture flag"
```

> **Operator step, not the implementer's:** apply this migration with `--apply` before Task 4's code merges. A missing constraint value would make every panel insert throw inside a cron that swallows its own errors.

---

### Task 2: `runKey` — run identity from local solar time

**Files:**
- Create: `app/lib/runKey.ts`
- Test: `app/lib/runKey.test.ts`

**Interfaces:**
- Consumes: `SolarPhase` from `@/app/lib/solarPhase`.
- Produces: `runKey(webcamId: number, phase: SolarPhase, capturedAt: Date, lngDeg: number): string` returning `"<webcamId>:<phase>:<YYYY-MM-DD>"`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { runKey } from './runKey';

describe('runKey', () => {
  it('groups an evening that straddles UTC midnight into one run', () => {
    // Seattle, lng -122. Both frames are the same local evening, but they sit
    // on opposite sides of UTC midnight, so a naive UTC date splits them.
    const before = new Date('2026-09-07T23:30:00Z');
    const after = new Date('2026-09-08T01:00:00Z');

    expect(runKey(700, 'sunset', before, -122)).toBe('700:sunset:2026-09-07');
    expect(runKey(700, 'sunset', after, -122)).toBe('700:sunset:2026-09-07');
  });

  it('separates two different evenings on the same camera', () => {
    const monday = new Date('2026-09-08T02:00:00Z');
    const tuesday = new Date('2026-09-09T02:00:00Z');

    expect(runKey(700, 'sunset', monday, -122)).not.toBe(
      runKey(700, 'sunset', tuesday, -122),
    );
  });

  it('keeps sunrise and sunset on the same camera and day apart', () => {
    const at = new Date('2026-09-08T02:00:00Z');

    expect(runKey(700, 'sunset', at, -122)).not.toBe(
      runKey(700, 'sunrise', at, -122),
    );
  });

  it('handles an eastern longitude', () => {
    // Tokyo, lng +139. 2026-09-08T09:30Z is the evening of 09-08 local.
    const at = new Date('2026-09-08T09:30:00Z');
    expect(runKey(42, 'sunset', at, 139)).toBe('42:sunset:2026-09-08');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/runKey.test.ts`
Expected: FAIL, cannot resolve `./runKey`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { SolarPhase } from './solarPhase';

const MS_PER_HOUR = 3_600_000;

/**
 * The identity of one camera's one evening.
 *
 * Keyed on LOCAL SOLAR date, not a fixed UTC offset. Longitude gives local
 * solar time directly at 15 degrees per hour, and both solar events sit far
 * from local midnight, so a sunset never straddles a local-solar-day boundary.
 * A fixed offset does not have that property: at lng -122 an evening lands on
 * both sides of UTC midnight and would split into two runs, which is exactly
 * the bug that would cut a run in half at its most interesting end.
 *
 * KNOWN DUPLICATION: scripts/run-inventory.mjs mirrors this in SQL, because a
 * .mjs script cannot import a .ts module. This function is the definition of
 * record. Phase 2 collapses the two when the queue needs run identity in
 * TypeScript; until then, a change here must be made in that query too.
 */
export function runKey(
  webcamId: number,
  phase: SolarPhase,
  capturedAt: Date,
  lngDeg: number,
): string {
  const solarLocal = new Date(
    capturedAt.getTime() + (lngDeg / 15) * MS_PER_HOUR,
  );
  const date = solarLocal.toISOString().slice(0, 10);
  return `${webcamId}:${phase}:${date}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/runKey.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/lib/runKey.ts app/lib/runKey.test.ts
git commit -m "feat(run-capture): runKey identifies a camera-evening by local solar date"
```

---

### Task 3: The panel loader

**Files:**
- Create: `app/api/cron/update-cameras/lib/runPanel.ts`
- Test: `app/api/cron/update-cameras/lib/runPanel.test.ts`

**Interfaces:**
- Consumes: `sql` from `@/app/lib/db`.
- Produces: `loadRunPanel(): Promise<Set<number>>`. Returns an empty set when the flag is off or the panel is empty, so callers need no null check.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { loadRunPanel } from './runPanel';

describe('loadRunPanel', () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it('returns the panel ids when the flag is on', async () => {
    sqlMock
      .mockResolvedValueOnce([{ enabled: true }])
      .mockResolvedValueOnce([{ webcam_id: 700 }, { webcam_id: 800 }]);

    const panel = await loadRunPanel();

    expect(panel.has(700)).toBe(true);
    expect(panel.has(800)).toBe(true);
    expect(panel.size).toBe(2);
  });

  it('returns an empty set and never queries the panel when the flag is off', async () => {
    sqlMock.mockResolvedValueOnce([{ enabled: false }]);

    const panel = await loadRunPanel();

    expect(panel.size).toBe(0);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty set when the flag row does not exist', async () => {
    sqlMock.mockResolvedValueOnce([]);

    const panel = await loadRunPanel();

    expect(panel.size).toBe(0);
  });

  it('coerces ids that the driver serializes as strings', async () => {
    sqlMock
      .mockResolvedValueOnce([{ enabled: true }])
      .mockResolvedValueOnce([{ webcam_id: '700' }]);

    const panel = await loadRunPanel();

    expect(panel.has(700)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/lib/runPanel.test.ts`
Expected: FAIL, cannot resolve `./runPanel`.

- [ ] **Step 3: Write the implementation**

```typescript
import { sql } from '@/app/lib/db';

/**
 * The cameras whose whole evening is kept, or an empty set when capture is off.
 *
 * Read once per tick, not per frame. The BIGINT id comes back from the Neon
 * driver as a string on some paths, so it is coerced here rather than at every
 * call site.
 */
export async function loadRunPanel(): Promise<Set<number>> {
  const flag = (await sql`
    SELECT enabled FROM runtime_flags WHERE key = 'run_panel_capture'
  `) as { enabled: boolean }[];

  if (flag[0]?.enabled !== true) return new Set();

  const rows = (await sql`
    SELECT webcam_id FROM run_panel
  `) as { webcam_id: number | string }[];

  return new Set(rows.map((r) => Number(r.webcam_id)));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/api/cron/update-cameras/lib/runPanel.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/runPanel.ts app/api/cron/update-cameras/lib/runPanel.test.ts
git commit -m "feat(run-capture): loadRunPanel reads the flag and the camera panel"
```

---

### Task 4: Wire run capture into the cron tick

**Files:**
- Modify: `app/api/cron/update-cameras/lib/dbOperations.ts:340` — add `'run'` to the `intakeReason` union
- Modify: `app/api/cron/update-cameras/route.ts:311-333` — panel membership, persistence, precedence
- Test: `app/api/cron/update-cameras/lib/dbOperations.test.ts`

**Interfaces:**
- Consumes: `loadRunPanel` from Task 3.
- Produces: rows in `webcam_snapshots` with `intake_reason = 'run'`.

- [ ] **Step 1: Write the failing test**

Append to `app/api/cron/update-cameras/lib/dbOperations.test.ts`, inside the existing `insertWindyDisagreementSnapshot` describe block:

```typescript
  it('accepts the run intake reason for whole-evening panel capture', async () => {
    sqlMock.mockResolvedValue([{ id: 4242 }]);

    const id = await insertWindyDisagreementSnapshot({
      webcamId: 700,
      phase: 'sunset',
      firebaseUrl: 'https://storage.googleapis.com/x.jpg',
      firebasePath: 'x.jpg',
      aiRating: 2.5,
      aiRegressionScore: 0.375,
      aiModelVersionRegression: 'v5',
      scoringPath: 'onnx',
      disagreementKind: null,
      intakeReason: 'run',
    });

    expect(id).toBe(4242);
    const values = sqlMock.mock.calls[0].slice(1);
    expect(values).toContain('run');
  });

  it('accepts a sunrise-phase frame for the same panel capture', async () => {
    // The panel is not sunset-only. This test exists so that a later change
    // adding a phase gate to the persist path fails loudly here.
    sqlMock.mockResolvedValue([{ id: 4243 }]);

    const id = await insertWindyDisagreementSnapshot({
      webcamId: 700,
      phase: 'sunrise',
      firebaseUrl: 'https://storage.googleapis.com/y.jpg',
      firebasePath: 'y.jpg',
      aiRating: 2.5,
      aiRegressionScore: 0.375,
      aiModelVersionRegression: 'v5',
      scoringPath: 'onnx',
      disagreementKind: null,
      intakeReason: 'run',
    });

    expect(id).toBe(4243);
    expect(sqlMock.mock.calls[0].slice(1)).toContain('run');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/lib/dbOperations.test.ts`
Expected: FAIL at type-check or assertion, because `'run'` is not in the `intakeReason` union.

- [ ] **Step 3: Widen the union in `dbOperations.ts`**

Replace the `intakeReason` field declaration at `app/api/cron/update-cameras/lib/dbOperations.ts:340`:

```typescript
  // Why this row entered the archive. 'trickle' is the unbiased control arm
  // (masterConfig SAVE_RANDOM_TRICKLE_RATE) and must stay separable from the
  // model-gated reasons, or the arm is unrecoverable after the fact. 'run' is
  // whole-evening panel capture and outranks every other reason, because a
  // panel frame was kept regardless of score and attributing it to a gated
  // reason would misrepresent it as model-selected.
  intakeReason?:
    | 'disagreement'
    | 'high_rated'
    | 'trickle'
    | 'all_rated'
    | 'kiosk_bin'
    | 'run';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/api/cron/update-cameras/lib/dbOperations.test.ts`
Expected: PASS.

- [ ] **Step 5: Load the panel once per tick**

In `app/api/cron/update-cameras/route.ts`, add the import beside the other lib imports:

```typescript
import { loadRunPanel } from './lib/runPanel';
```

Then, immediately before the loop that iterates webcams (the same place `feedByExternalId` is prepared), add:

```typescript
  // One query per tick, not per frame. Empty when the flag is off.
  const runPanel = await loadRunPanel();
```

- [ ] **Step 6: Add panel membership to persistence and precedence**

In `app/api/cron/update-cameras/route.ts`, after the `const isTrickle = ...` line at :311, add:

```typescript
      // Whole-event capture: this camera's frames are kept regardless of
      // score, which is the entire point — the model-gated reasons drop the
      // N-to-1 crossing, and that crossing is what run labeling needs.
      //
      // Deliberately NOT gated on phase. Sunrise runs teach the same two
      // boundaries, the corpus is short of them, and the gate is one Set
      // lookup either way. Do not add a phase condition here without reading
      // Leg 0 of the spec first.
      const isRunPanel = runPanel.has(webcamId);
```

Extend `shouldPersist` to include it:

```typescript
      const shouldPersist =
        disagreementKind !== null ||
        isHighRated ||
        isTrickle ||
        isRunPanel ||
        SAVE_ALL_RATED_SNAPSHOTS ||
        (binKind !== null && binFeed !== null);
```

Put `'run'` at the top of the precedence chain:

```typescript
      // Precedence matters for the analysis, not for the write. 'run' is FIRST:
      // a panel frame would have been kept whatever it scored, so stamping it
      // 'disagreement' would make a uniformly sampled frame look model-selected
      // and silently poison the corpus this panel exists to produce. The
      // disagreement itself is not lost — model_disagreement_kind is written
      // independently, and the Hard Examples queue filters on that column, not
      // on intake_reason.
      const intakeReason:
        | 'disagreement' | 'high_rated' | 'trickle' | 'all_rated' | 'kiosk_bin' | 'run' =
        isRunPanel
          ? 'run'
          : disagreementKind !== null
            ? 'disagreement'
            : isHighRated
              ? 'high_rated'
              : isTrickle
                ? 'trickle'
                : SAVE_ALL_RATED_SNAPSHOTS
                  ? 'all_rated'
                  : 'kiosk_bin';
```

- [ ] **Step 7: Run the full suite and the build**

Run: `npm run test`
Expected: PASS, no regressions in the cron suites.

Run: `npm run build`
Expected: build completes.

- [ ] **Step 8: Commit**

```bash
git add app/api/cron/update-cameras/route.ts app/api/cron/update-cameras/lib/dbOperations.ts app/api/cron/update-cameras/lib/dbOperations.test.ts
git commit -m "feat(run-capture): keep whole evenings for panel cameras as intake_reason=run"
```

---

### Task 5: Seed the panel

**Files:**
- Create: `scripts/seed-run-panel.mjs`

**Interfaces:**
- Consumes: table `run_panel` from Task 1.
- Produces: 60 rows in `run_panel`. Dry by default, `--apply` to write, matching `set-runtime-flag.mjs` and `apply-migration.mjs`.

- [ ] **Step 1: Write the script**

```javascript
// scripts/seed-run-panel.mjs
//
// Chooses the whole-evening capture panel. Cameras that have actually produced
// operator-confirmed sunsets, spread across longitude so runs land at different
// UTC hours rather than all in one part of the world.
//
// Dry by default. Every env file here points at the SAME Neon endpoint, so
// every --apply run is a production change.
//
//   node scripts/seed-run-panel.mjs
//   node scripts/seed-run-panel.mjs --apply
//   node scripts/seed-run-panel.mjs --size 40 --apply
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('.env.local', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in env or .env.local');
  return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

const sql = neon(loadDatabaseUrl());
const apply = process.argv.includes('--apply');
const sizeArg = process.argv.indexOf('--size');
const SIZE = sizeArg === -1 ? 60 : Number(process.argv[sizeArg + 1]);
// 24 buckets of 15 degrees: one per hour of local solar time.
const BUCKETS = 24;

const candidates = await sql`
  SELECT w.id, w.lng, count(*)::int AS confirmed_sunsets
  FROM manual_labels m
  JOIN webcam_snapshots s ON s.id = m.image_id AND m.source = 'webcam'
  JOIN webcams w ON w.id = s.webcam_id
  WHERE m.is_sunset AND w.lng IS NOT NULL
  GROUP BY w.id, w.lng
  HAVING count(*) >= 3
  ORDER BY count(*) DESC
`;

// Round-robin across longitude buckets so the panel is not all one meridian.
const byBucket = new Map();
for (const c of candidates) {
  const b = Math.floor(((Number(c.lng) + 180) % 360) / (360 / BUCKETS));
  if (!byBucket.has(b)) byBucket.set(b, []);
  byBucket.get(b).push(c);
}

const picked = [];
let exhausted = false;
while (picked.length < SIZE && !exhausted) {
  exhausted = true;
  for (const list of byBucket.values()) {
    if (picked.length >= SIZE) break;
    const next = list.shift();
    if (next) {
      picked.push(next);
      exhausted = false;
    }
  }
}

console.log(`candidates: ${candidates.length}, buckets used: ${byBucket.size}`);
console.log(`picked ${picked.length} of a requested ${SIZE}:`);
for (const p of picked) {
  console.log(`  webcam ${p.id}  lng ${Number(p.lng).toFixed(1)}  ${p.confirmed_sunsets} confirmed sunsets`);
}

if (!apply) {
  console.log('\nDRY RUN. Re-run with --apply to write run_panel.');
  process.exit(0);
}

for (const p of picked) {
  await sql`
    INSERT INTO run_panel (webcam_id, note)
    VALUES (${Number(p.id)}, ${`seeded 2026-09-08: ${p.confirmed_sunsets} confirmed sunsets, lng ${Number(p.lng).toFixed(1)}`})
    ON CONFLICT (webcam_id) DO NOTHING
  `;
}
console.log(`\nwrote ${picked.length} rows to run_panel.`);
console.log('Now enable capture: node scripts/set-runtime-flag.mjs run_panel_capture on --apply');
```

- [ ] **Step 2: Dry-run it**

Run: `node scripts/seed-run-panel.mjs`
Expected: prints candidate count, bucket count, and 60 chosen cameras with longitudes spread across buckets. Writes nothing.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-run-panel.mjs
git commit -m "feat(run-capture): seed the capture panel across longitude buckets"
```

---

### Task 6: Run inventory report

**Files:**
- Create: `scripts/run-inventory.mjs`

**Interfaces:**
- Consumes: `webcam_snapshots.intake_reason`, `webcams.longitude`, and the run definition from Task 2 expressed in SQL.
- Produces: a console report. This is how the corpus is watched as it accumulates, and how Phase 2 decides it has enough runs to start.

- [ ] **Step 1: Write the script**

```javascript
// scripts/run-inventory.mjs
//
// What run corpus exists, and how much of it is uniform rather than
// model-selected. Read this before starting a labeling sitting.
//
// A run is one camera's one evening, keyed on LOCAL SOLAR date (longitude / 15
// hours). A fixed UTC offset splits western-hemisphere evenings in half.
//
// This query MIRRORS app/lib/runKey.ts, which is the definition of record. The
// duplication exists because a .mjs script cannot import a .ts module; change
// both or neither.
//
//   node scripts/run-inventory.mjs
//   node scripts/run-inventory.mjs --days 30
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('.env.local', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in env or .env.local');
  return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

const sql = neon(loadDatabaseUrl());
const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg === -1 ? 45 : Number(process.argv[daysArg + 1]);

const runs = await sql`
  WITH framed AS (
    SELECT s.id, s.webcam_id, s.phase, s.intake_reason,
           s.captured_at,
           ((s.captured_at AT TIME ZONE 'UTC'
             + make_interval(mins => (w.lng / 15.0 * 60)::int)))::date AS solar_day
    FROM webcam_snapshots s
    JOIN webcams w ON w.id = s.webcam_id
    WHERE s.captured_at > now() - make_interval(days => ${DAYS}::int)
      AND s.phase = 'sunset'
      AND w.lng IS NOT NULL
  ),
  grouped AS (
    SELECT webcam_id, solar_day,
           count(*)::int AS frames,
           count(*) FILTER (WHERE intake_reason = 'run')::int AS run_frames,
           extract(epoch FROM (max(captured_at) - min(captured_at))) / 60 AS span_min
    FROM framed GROUP BY webcam_id, solar_day
  )
  SELECT
    count(*) FILTER (WHERE frames >= 6 AND span_min BETWEEN 30 AND 150)::int AS labelable_runs,
    count(*) FILTER (WHERE frames >= 6 AND span_min BETWEEN 30 AND 150
                       AND run_frames = frames)::int AS uniform_runs,
    count(DISTINCT webcam_id) FILTER (WHERE run_frames > 0)::int AS panel_cameras_seen,
    round(avg(frames) FILTER (WHERE run_frames = frames)::numeric, 1) AS avg_frames_uniform
  FROM grouped
`;
console.log(`window: last ${DAYS} days, sunset phase`);
console.table(runs);

const mix = await sql`
  SELECT coalesce(intake_reason, '(null)') AS reason, count(*)::int AS frames
  FROM webcam_snapshots
  WHERE captured_at > now() - make_interval(days => ${DAYS}::int)
  GROUP BY 1 ORDER BY 2 DESC
`;
console.log('intake mix over the same window:');
console.table(mix);
```

- [ ] **Step 2: Run it against production**

Run: `node scripts/run-inventory.mjs`
Expected: `uniform_runs` is 0 before the flag is switched on. That zero is the baseline, and it is the number that should start climbing the evening after capture is enabled.

- [ ] **Step 3: Commit**

```bash
git add scripts/run-inventory.mjs
git commit -m "feat(run-capture): run inventory report separates uniform runs from model-selected ones"
```

---

## Operator checklist — after 2026-09-12, in this order

Do not reorder. The migration must land before the code that writes `'run'`, because the cron swallows its own write errors and a constraint violation would lose frames silently rather than loudly.

- [ ] Pre-flight the constraint swap: `scripts/apply-migration.mjs` sends one statement per request, so if the ADD CONSTRAINT fails after the DROP succeeds, `webcam_snapshots` is left with no `intake_reason` check at all. Run `SELECT DISTINCT intake_reason FROM webcam_snapshots;` and confirm every value returned appears in the migration's new CHECK list before running with `--apply`.
- [ ] Apply the migration: `node scripts/apply-migration.mjs database/migrations/20260908_run_panel.sql --apply`
- [ ] Confirm: `npm run migrate:status` exits 0
- [ ] Merge the PR, let the Vercel build go Ready
- [ ] Confirm the inventory script's phase-splitting fix is in place (`scripts/run-inventory.mjs` derives morning/evening from local solar hour, not the stored `phase` column). Without it, the report reads 0 uniform runs regardless of whether capture is working and looks like a failure.
- [ ] Seed the panel: `node scripts/seed-run-panel.mjs` then re-run with `--apply`
- [ ] Enable capture: `node scripts/set-runtime-flag.mjs run_panel_capture on --apply`
- [ ] Next morning, confirm the corpus is growing: `node scripts/run-inventory.mjs`, `uniform_runs` above 0
- [ ] Watch cost for a week against the ~$0.44/day baseline in `scripts/usage-report.mjs`. The panel adds roughly 540 frames per evening, well under the ~32k per week `disagreement` already takes, so a visible jump means something is wrong with panel size, not with the estimate.

## Phase 2, not in this plan

Written once runs have accumulated:

- `run_crossings` table, keyed by run, pass number and rater
- The filmstrip marking mode, boundaries first and peak last, blind
- The pre-registered reproducibility experiment against the `is_sunset` 13.6% and `rating ≥ 4` 12.6% baselines
- Export-time derivation of per-frame labels, with their own label source, never written into `manual_labels`
