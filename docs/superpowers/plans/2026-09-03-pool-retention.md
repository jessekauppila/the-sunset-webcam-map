# Pool Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the terminator pool from being emptied by one bad Windy tick, and stop cameras flickering out when Windy skips them for a tick, so the glass keeps showing live cameras through a spotty minute and through an outage.

**Architecture:** Two rules, both in the cron tick. A **grace period**: a camera is deactivated only when it has not been seen for `TERMINATOR_RETENTION_GRACE_MS`, using the `last_seen_at` column `terminator_webcam_state` already has, instead of the moment one tick misses it. A **sweep hold**: when the sweep looks failed (no boxes, nothing found, or at least half the boxes non-OK) the tick skips deactivation entirely and keeps the last good pool. Upserts still run, so anything the failed sweep did find is added. The cache refresh already reads the pool back from the database, so it needs no change. Held ticks are counted into `daily_sunset_stats` and printed in the digest.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Neon Postgres over `@neondatabase/serverless` (tagged-template `sql`), Resend digest.

**Spec:** This plan is its own spec. The design was settled in conversation on 2026-09-03 from these measurements, all read from production that day:
- Every active row in `terminator_webcam_state` was seen within the last 5 minutes; nothing older was active. The pool has no memory between ticks.
- Right then, a 10-minute grace would have retained 6 more cameras, 20 minutes 17, 30 minutes 45, against 101 active. Upper bounds: some genuinely left the swept area. 20 minutes is two Windy preview cycles (one every 10.1 minutes) and is where retention stops being mostly jitter and starts being mostly departures.
- Windy preview URLs (`https://imgproxy.windy.com/_/preview/plain/current/<id>/original.jpg?v=2`) carry no token and no expiry, and are served by a different service from the listing API. A retained camera keeps showing live frames while the listing API is failing.
- `deactivateMissingTerminatorState` with an empty id list deactivates every active row for the feed. The route test `skips upsert/deactivate for empty buckets gracefully` asserts that contract on purpose. This plan changes that contract on purpose, and rewrites that test.

## Global Constraints

- **Plain branches in the main checkout.** `git checkout -b feat/pool-retention` from `main`. Never create `.claude/worktrees/`. Several sessions share this checkout: run `ListAgents` and message any active peer before switching, and leave the checkout on `main` when idle.
- **Verify the branch in the SAME Bash invocation as every commit:** `[ "$(git rev-parse --abbrev-ref HEAD)" = feat/pool-retention ] && git add ... && git commit ...`. If it is not the branch, stop and say so; do not switch.
- **Never `git add -A` or `git add .`.** Stage exactly the paths each task's **Files** block names.
- **Push after the first commit** so the checkout is never the only copy.
- **Migrations are forward-only and idempotent**, applied by hand, and there is no separate dev database: applying one is a production schema change. Dry-run first: `node scripts/apply-migration.mjs <file>.sql`, then `--apply`.
- **`NUMERIC` and `BIGINT` come back from the Neon driver as strings.** Wrap numeric reads in `Number()`.
- **Telemetry is never worth failing a cron tick over.** Every new read or write in the tick catches its own errors.
- **The hold fails toward keeping cameras.** If the health assessment cannot run, deactivate nothing.
- **Run `npm run test` before every commit**, not just the new file.
- **Default behaviour changes on purpose.** With this merged, a tick that finds nothing keeps the pool instead of emptying it. Say so in the PR body.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app/lib/masterConfig.ts` | **Modify.** Adds `TERMINATOR_RETENTION_GRACE_MS` and `TERMINATOR_SWEEP_FAILED_HOLD_RATIO`, near `TERMINATOR_CAMERA_FLOOR` (line 36). |
| `app/lib/masterConfig.test.ts` | **Modify.** Pins both constants and the invariant that the grace exceeds one Windy preview cycle. |
| `app/api/cron/update-cameras/lib/dbOperations.ts` | **Modify.** `deactivateMissingTerminatorState` gains a `graceMs` parameter (lines 193–214). |
| `app/api/cron/update-cameras/lib/dbOperations.test.ts` | **Modify.** The three existing deactivate tests (lines 186–222) pass the grace; one new test asserts it reaches the SQL. |
| `app/api/cron/update-cameras/lib/sweepHealth.ts` | **Create.** `assessSweepHold`: pure, reads `SweepTelemetry`, returns whether this tick may deactivate. |
| `app/api/cron/update-cameras/lib/sweepHealth.test.ts` | **Create.** |
| `app/api/cron/update-cameras/route.ts` | **Modify.** Calls `assessSweepHold` after the union (around line 437), skips deactivation on hold, passes the grace otherwise, surfaces `retention` in the JSON response (around line 527). |
| `app/api/cron/update-cameras/route.test.ts` | **Modify.** Rewrites the empty-buckets test; adds the grace and hold tests. |
| `database/migrations/20260904_sweep_hold.sql` | **Create.** `sweep_held_ticks` on `daily_sunset_stats`. |
| `app/api/cron/update-cameras/lib/sweepStats.ts` | **Modify.** `heldTicks` through compute, persist, and the digest summary. |
| `app/api/cron/update-cameras/lib/sweepStats.test.ts` | **Modify.** |
| `app/api/cron/update-cameras/lib/dailyDigest.ts` | **Modify.** One clause in the sweep line when any tick held. |
| `app/api/cron/update-cameras/lib/dailyDigest.test.ts` | **Modify.** |

Tasks 1 through 4 are the feature and are enough to protect the show. Tasks 5 and 6 make it observable in the digest. Ship 1–4 first if time is short.

---

## Task 1: The two constants

**Files:**
- Modify: `app/lib/masterConfig.ts` (after `TERMINATOR_CAMERA_FLOOR`, line 36)
- Test: `app/lib/masterConfig.test.ts`

**Interfaces:**
- Produces:
  - `TERMINATOR_RETENTION_GRACE_MS: number` — used by Task 2 (signature) and Task 4 (call site).
  - `TERMINATOR_SWEEP_FAILED_HOLD_RATIO: number` — used by Task 3 (parameter) and Task 4 (call site).

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('terminator widening constants', ...)` block in `app/lib/masterConfig.test.ts`, and add the two names to the import list at the top of the file:

```ts
  it('keeps a camera for two Windy preview cycles after it was last seen', () => {
    // Measured 2026-09-03 against 101 active cameras: a 10-minute grace
    // would have retained 6 more, 20 minutes 17, 30 minutes 45. Windy
    // publishes a new preview every 10.1 minutes, so 20 minutes is two
    // cycles: long enough to ride out a tick that skipped a camera, short
    // enough that cameras the terminator has moved past still age out.
    expect(TERMINATOR_RETENTION_GRACE_MS).toBe(20 * 60_000);
    expect(TERMINATOR_RETENTION_GRACE_MS).toBeGreaterThan(10.1 * 60_000);
  });

  it('holds the pool when at least half the boxes fail', () => {
    // Antimeridian and pole boxes fail with 400 at a few percent on a normal
    // day (measured 2026-09-02/03); that must not hold every tick. Half is
    // unambiguous: no healthy sweep has ever come close.
    expect(TERMINATOR_SWEEP_FAILED_HOLD_RATIO).toBe(0.5);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/masterConfig.test.ts`
Expected: FAIL, `TERMINATOR_RETENTION_GRACE_MS` is not exported.

- [ ] **Step 3: Add the constants**

In `app/lib/masterConfig.ts`, directly after the `TERMINATOR_CAMERA_FLOOR` export (line 36):

```ts
// How long a camera stays in the pool after the sweep last returned it.
//
// Before this existed the pool had no memory: every tick rebuilt it from that
// tick's Windy responses and deactivated everything else, so a camera Windy
// skipped for one tick vanished from the glass for a minute, and a tick that
// got nothing back emptied both panels. Measured 2026-09-03: 20 minutes would
// have kept 17 more cameras against 101 active; 30 minutes 45, which is where
// cameras the terminator has genuinely moved past start dominating. Windy
// publishes a new preview every 10.1 minutes, so this is two cycles.
export const TERMINATOR_RETENTION_GRACE_MS = 20 * 60_000;

// Fraction of a tick's Windy boxes that must come back non-OK before the tick
// is treated as failed and deactivates nothing. Edge-of-world boxes fail with
// 400 at a few percent on an ordinary day and must not trip this.
export const TERMINATOR_SWEEP_FAILED_HOLD_RATIO = 0.5;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/masterConfig.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/pool-retention ] \
  && git add app/lib/masterConfig.ts app/lib/masterConfig.test.ts \
  && git commit -m "feat(config): retention grace and failed-sweep hold ratio" \
  && git push -u origin feat/pool-retention
```

---

## Task 2: Grace period in deactivation

**Files:**
- Modify: `app/api/cron/update-cameras/lib/dbOperations.ts:193-214`
- Test: `app/api/cron/update-cameras/lib/dbOperations.test.ts:186-222`

**Interfaces:**
- Consumes: nothing new; `graceMs` is a plain number so this module stays free of `masterConfig`.
- Produces: `deactivateMissingTerminatorState(phase: 'sunrise' | 'sunset', activeWebcamIds: number[], graceMs: number): Promise<void>` — Task 4 calls it with `TERMINATOR_RETENTION_GRACE_MS`.

- [ ] **Step 1: Update the existing tests and add one**

Replace the whole `describe('deactivateMissingTerminatorState', ...)` block (lines 186–222) with:

```ts
describe('deactivateMissingTerminatorState', () => {
  const GRACE_MS = 20 * 60_000;

  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
  });

  it('deactivates rows of any source not in the active set', async () => {
    await deactivateMissingTerminatorState('sunrise', [42, 99], GRACE_MS);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    // The SQL template-tag invocation should NOT reference w.source = 'windy'.
    const firstCallStrings = sqlMock.mock.calls[0][0] as readonly string[];
    expect(firstCallStrings.join(' ')).not.toContain("source = 'windy'");
  });

  it('deactivates only aged-out rows when the active set is empty', async () => {
    await deactivateMissingTerminatorState('sunset', [], GRACE_MS);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const strings = sqlMock.mock.calls[0][0] as readonly string[];
    const fullQuery = strings.join(' ');
    expect(fullQuery).not.toContain("source = 'windy'");
    // Empty-array fast path: no `<> all` filter ...
    expect(fullQuery).not.toContain('<> all');
    // ... but the grace still applies. An empty sweep used to empty the feed.
    expect(fullQuery).toContain('last_seen_at <');
  });

  it('passes the active ids array into the SQL parameters', async () => {
    await deactivateMissingTerminatorState('sunrise', [42, 99], GRACE_MS);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    // Index 0 of the call is the TemplateStringsArray; rest are interpolated values.
    const values = sqlMock.mock.calls[0].slice(1);
    // The phase string and the active-ids array should both appear in values.
    expect(values).toContain('sunrise');
    expect(values.some((v) => Array.isArray(v) && (v as number[]).join(',') === '42,99')).toBe(true);
  });

  it('applies the grace to the non-empty branch too', async () => {
    await deactivateMissingTerminatorState('sunrise', [42], GRACE_MS);

    const strings = sqlMock.mock.calls[0][0] as readonly string[];
    expect(strings.join(' ')).toContain('last_seen_at <');
    const values = sqlMock.mock.calls[0].slice(1);
    expect(values).toContain(GRACE_MS);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/api/cron/update-cameras/lib/dbOperations.test.ts`
Expected: FAIL on the two grace assertions (`last_seen_at <` absent).

- [ ] **Step 3: Add the grace to both branches**

Replace `deactivateMissingTerminatorState` (lines 193–214 of `dbOperations.ts`) with:

```ts
export async function deactivateMissingTerminatorState(
  phase: 'sunrise' | 'sunset',
  activeWebcamIds: number[],
  graceMs: number,
): Promise<void> {
  // Grace on both branches: a row leaves the pool only when the sweep has not
  // returned it for `graceMs`, never because one tick skipped it. Same
  // `${n} * interval '1 millisecond'` shape as cameraClaimCode's TTL, so the
  // driver binds a plain number.
  if (activeWebcamIds.length === 0) {
    await sql`
      update terminator_webcam_state
      set active = false, updated_at = now()
      where phase = ${phase}
        and active = true
        and last_seen_at < now() - ${graceMs} * interval '1 millisecond'
    `;
    return;
  }

  await sql`
    update terminator_webcam_state
    set active = false, updated_at = now()
    where phase = ${phase}
      and active = true
      and last_seen_at < now() - ${graceMs} * interval '1 millisecond'
      and webcam_id <> all(${activeWebcamIds})
  `;
}
```

Also update the doc comment above it (lines 186–192): keep the source-agnostic WARNING, and add one sentence: "Rows are kept for `graceMs` after they were last seen; passing an empty set no longer empties the feed, it only ages out rows past the grace."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/api/cron/update-cameras/lib/dbOperations.test.ts`
Expected: PASS. `npx tsc --noEmit` will now fail in `route.ts` (two-argument call); Task 4 fixes that. Do not commit a red build: do Task 3 and Task 4 before committing Task 2, **or** temporarily pass `0` from the route in this commit. Prefer the first.

- [ ] **Step 5: Commit** (together with Task 4's route change if you did them back-to-back; the branch check is the same)

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/pool-retention ] \
  && git add app/api/cron/update-cameras/lib/dbOperations.ts \
             app/api/cron/update-cameras/lib/dbOperations.test.ts \
  && git commit -m "feat(sweep): keep cameras for a grace period after last seen"
```

---

## Task 3: The sweep-hold assessment

**Files:**
- Create: `app/api/cron/update-cameras/lib/sweepHealth.ts`
- Test: `app/api/cron/update-cameras/lib/sweepHealth.test.ts`

**Interfaces:**
- Consumes: `SweepTelemetry` from `./terminatorSweep` (fields used: `rings[].attempted`, `rings[].failed`).
- Produces:
  ```ts
  export type SweepHoldReason = 'none' | 'no-boxes' | 'nothing-found' | 'failed-ratio';
  export interface SweepHold { held: boolean; reason: SweepHoldReason; attempted: number; failed: number; found: number }
  export function assessSweepHold(telemetry: SweepTelemetry, found: number, failedHoldRatio: number): SweepHold
  ```
  Task 4 calls it and puts the result in the response as `retention`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { assessSweepHold } from './sweepHealth';
import type { SweepTelemetry } from './terminatorSweep';

function telemetry(rings: Array<{ attempted: number; failed: number }>): SweepTelemetry {
  return {
    rings: rings.map((r, i) => ({
      offsetDeg: i === 0 ? 0 : 15.75,
      feedsSwept: ['sunrise', 'sunset'],
      attempted: r.attempted,
      empty: 0,
      failed: r.failed,
      failedByStatus: r.failed ? { '400': r.failed } : {},
      newWebcams: 0,
      newWebcamIds: [],
      elapsedMs: 0,
    })),
    counts: { sunrise: 0, sunset: 0 },
    thinAfterBase: [],
    escalations: 0,
    budgetExhausted: false,
  };
}

describe('assessSweepHold', () => {
  it('does not hold a healthy sweep', () => {
    const r = assessSweepHold(telemetry([{ attempted: 30, failed: 1 }]), 97, 0.5);
    expect(r).toEqual({ held: false, reason: 'none', attempted: 30, failed: 1, found: 97 });
  });

  it('holds when no boxes were sent at all', () => {
    // A ring that built no coordinates is a bug, not an empty world.
    const r = assessSweepHold(telemetry([{ attempted: 0, failed: 0 }]), 0, 0.5);
    expect(r.held).toBe(true);
    expect(r.reason).toBe('no-boxes');
  });

  it('holds when boxes went out and nothing came back', () => {
    // The 200-with-empty-body shape a quota could take: not one failure, and
    // not one camera. The base ring circles the whole terminator and has never
    // been all ocean.
    const r = assessSweepHold(telemetry([{ attempted: 30, failed: 0 }]), 0, 0.5);
    expect(r.held).toBe(true);
    expect(r.reason).toBe('nothing-found');
  });

  it('holds when at least the ratio of boxes failed, even if some cameras came back', () => {
    const r = assessSweepHold(telemetry([{ attempted: 30, failed: 15 }]), 12, 0.5);
    expect(r.held).toBe(true);
    expect(r.reason).toBe('failed-ratio');
  });

  it('does not hold on the ordinary edge-of-world failures', () => {
    // 2 of 30 boxes 400 on the antimeridian: a normal day.
    const r = assessSweepHold(telemetry([{ attempted: 30, failed: 2 }]), 90, 0.5);
    expect(r.held).toBe(false);
  });

  it('sums across rings', () => {
    const r = assessSweepHold(
      telemetry([{ attempted: 30, failed: 0 }, { attempted: 30, failed: 30 }]),
      40,
      0.5,
    );
    expect(r.attempted).toBe(60);
    expect(r.failed).toBe(30);
    expect(r.held).toBe(true);
    expect(r.reason).toBe('failed-ratio');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/api/cron/update-cameras/lib/sweepHealth.test.ts`
Expected: FAIL, cannot resolve `./sweepHealth`.

- [ ] **Step 3: Write the module**

```ts
import type { SweepTelemetry } from './terminatorSweep';

export type SweepHoldReason =
  | 'none'
  | 'no-boxes'
  | 'nothing-found'
  | 'failed-ratio';

export interface SweepHold {
  held: boolean;
  reason: SweepHoldReason;
  attempted: number;
  failed: number;
  found: number;
}

/**
 * Should this tick be allowed to deactivate cameras?
 *
 * A tick that could not see the world must not rewrite the pool from what it
 * saw. Three shapes of "could not see": no boxes were sent (a ring built no
 * coordinates); boxes went out and not one camera came back (the empty-200
 * shape a quota could take, and the base ring has never been all ocean); or
 * at least `failedHoldRatio` of the boxes came back non-OK. Ordinary days
 * fail a few percent of boxes on the antimeridian and poles, well under the
 * ratio.
 *
 * Pure: reads telemetry the sweep already produces. The caller decides what a
 * hold means (skip deactivation, keep the last good pool).
 */
export function assessSweepHold(
  telemetry: SweepTelemetry,
  found: number,
  failedHoldRatio: number,
): SweepHold {
  let attempted = 0;
  let failed = 0;
  for (const ring of telemetry.rings) {
    attempted += ring.attempted;
    failed += ring.failed;
  }
  const base = { attempted, failed, found };
  if (attempted === 0) return { held: true, reason: 'no-boxes', ...base };
  if (found === 0) return { held: true, reason: 'nothing-found', ...base };
  if (failed / attempted >= failedHoldRatio) {
    return { held: true, reason: 'failed-ratio', ...base };
  }
  return { held: false, reason: 'none', ...base };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/api/cron/update-cameras/lib/sweepHealth.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/pool-retention ] \
  && git add app/api/cron/update-cameras/lib/sweepHealth.ts \
             app/api/cron/update-cameras/lib/sweepHealth.test.ts \
  && git commit -m "feat(sweep): assess whether a tick may deactivate cameras"
```

---

## Task 4: Wire the hold and the grace into the tick

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts` (imports near line 20–40; the upsert/deactivate block around lines 434–440; the response object around line 527)
- Test: `app/api/cron/update-cameras/route.test.ts` (mocks near line 66–75 and 107; tests at lines 319–360)

**Interfaces:**
- Consumes: `assessSweepHold` (Task 3), `deactivateMissingTerminatorState(phase, ids, graceMs)` (Task 2), `TERMINATOR_RETENTION_GRACE_MS` and `TERMINATOR_SWEEP_FAILED_HOLD_RATIO` (Task 1).
- Produces: a `retention: SweepHold` field in the tick's JSON response; `sweepHold` variable in scope for Task 5.

- [ ] **Step 1: Write the failing tests**

In `route.test.ts`, add a passthrough mock for `sweepHealth` next to the `sweepStats` mock (after line 115), following that file's pattern:

```ts
const sweepHoldMock = vi.fn();
vi.mock('./lib/sweepHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/sweepHealth')>();
  return {
    ...actual,
    assessSweepHold: (...a: Parameters<typeof actual.assessSweepHold>) =>
      sweepHoldMock.mock.calls.length >= 0 && sweepHoldMock.getMockImplementation()
        ? sweepHoldMock(...a)
        : actual.assessSweepHold(...a),
  };
});
```

Add to the file's `beforeEach` (wherever the other `*Mock.mockReset()` calls live): `sweepHoldMock.mockReset();` so the real implementation is used unless a test sets one.

Add `TERMINATOR_RETENTION_GRACE_MS` to the existing `import ... from '@/app/lib/masterConfig'` in the test file (the file already imports the real module through its partial mock).

Replace the test `skips upsert/deactivate for empty buckets gracefully` (lines 340–360) with:

```ts
  it('holds the pool when the sweep finds nothing: upserts still run, deactivate does not', async () => {
    // Boxes went out (the ring mock gives one coord per feed) and nothing came
    // back. Before retention this emptied both feeds within one tick. Now the
    // last good pool stays until a tick that can see the world.
    fetchBatchesMock.mockResolvedValue([[]]);
    classifyMock.mockReturnValue({ sunrise: [], sunset: [] });
    getIdMapMock.mockResolvedValue(new Map());
    customClassifyMock.mockResolvedValue({ sunrise: [], sunset: [] });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const sunriseUpsertCall = upsertStateMock.mock.calls.find((c) => c[1] === 'sunrise');
    expect(sunriseUpsertCall).toBeDefined();
    expect(sunriseUpsertCall![0]).toEqual([]);

    expect(deactivateMock).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.retention).toMatchObject({ held: true, reason: 'nothing-found' });
  });

  it('deactivates with the retention grace on a healthy tick', async () => {
    classifyMock.mockReturnValue({
      sunrise: [{ webcamId: 'wA', location: { latitude: 0, longitude: 0 } }],
      sunset: [],
    });
    getIdMapMock.mockResolvedValue(new Map([['wA', 1]]));
    customClassifyMock.mockResolvedValue({ sunrise: [], sunset: [] });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const sunriseDeactCall = deactivateMock.mock.calls.find((c) => c[0] === 'sunrise');
    expect(sunriseDeactCall).toBeDefined();
    expect(sunriseDeactCall![2]).toBe(TERMINATOR_RETENTION_GRACE_MS);

    const body = await res.json();
    expect(body.retention).toMatchObject({ held: false, reason: 'none' });
  });

  it('skips deactivation whenever the assessment says hold', async () => {
    sweepHoldMock.mockImplementation(() => ({
      held: true, reason: 'failed-ratio', attempted: 30, failed: 20, found: 5,
    }));
    classifyMock.mockReturnValue({
      sunrise: [{ webcamId: 'wA', location: { latitude: 0, longitude: 0 } }],
      sunset: [],
    });
    getIdMapMock.mockResolvedValue(new Map([['wA', 1]]));
    customClassifyMock.mockResolvedValue({ sunrise: [], sunset: [] });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    // What the failed sweep DID find is still added ...
    expect(upsertStateMock).toHaveBeenCalled();
    // ... but nothing is removed on its say-so.
    expect(deactivateMock).not.toHaveBeenCalled();
  });
```

Also update the existing test `passes the union of ids to deactivateMissingTerminatorState` (line 319): keep it as is; it still passes because the sweep in that test finds a camera.

If the file's `fetchBatchesMock` needs a shape for "one box, no cameras", `[[]]` is one batch containing zero webcams, which the windyApi mock counts as `attempted: 2, empty: 1` for the two mocked coords. That is enough for `found === 0`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts`
Expected: FAIL. The empty-sweep test fails because `deactivateMock` was called; the grace test fails because `sunriseDeactCall[2]` is undefined; the hold test fails because `deactivateMock` was called.

- [ ] **Step 3: Wire it in**

Imports in `route.ts`: add `TERMINATOR_RETENTION_GRACE_MS` and `TERMINATOR_SWEEP_FAILED_HOLD_RATIO` to the `@/app/lib/masterConfig` import list (lines 20–36), and add:

```ts
import { assessSweepHold } from './lib/sweepHealth';
```

Replace the upsert/deactivate block (currently):

```ts
  await upsertTerminatorState(sunriseRows, 'sunrise');
  await upsertTerminatorState(sunsetRows, 'sunset');

  const sunriseIds = sunriseRows.map((r) => r.webcamId);
  const sunsetIds = sunsetRows.map((r) => r.webcamId);
  await deactivateMissingTerminatorState('sunrise', sunriseIds);
  await deactivateMissingTerminatorState('sunset', sunsetIds);
```

with:

```ts
  // Retention. Everything this tick saw is added; what it did not see is
  // removed only if (a) this tick could see the world at all and (b) the
  // camera has been unseen for the grace period. Before this, one tick that
  // got nothing back from Windy emptied both panels, and a camera Windy
  // skipped for a tick vanished for a minute.
  const sweepHold = assessSweepHold(
    sweep.telemetry,
    windyAll.length,
    TERMINATOR_SWEEP_FAILED_HOLD_RATIO,
  );

  await upsertTerminatorState(sunriseRows, 'sunrise');
  await upsertTerminatorState(sunsetRows, 'sunset');

  if (sweepHold.held) {
    console.error(
      `🛑 sweep hold (${sweepHold.reason}): ${sweepHold.failed}/${sweepHold.attempted} boxes failed, ${sweepHold.found} cameras found; keeping the last good pool`,
    );
  } else {
    const sunriseIds = sunriseRows.map((r) => r.webcamId);
    const sunsetIds = sunsetRows.map((r) => r.webcamId);
    await deactivateMissingTerminatorState('sunrise', sunriseIds, TERMINATOR_RETENTION_GRACE_MS);
    await deactivateMissingTerminatorState('sunset', sunsetIds, TERMINATOR_RETENTION_GRACE_MS);
  }
```

The cache refresh that follows (`fetchTerminatorWebcams()` then `setCachedTerminatorPayload`) needs no change: it reads the pool back from the database, which on a held tick still holds the last good set.

In the JSON response (the object that has `sweep: sweep.telemetry` near line 527), add:

```ts
    retention: sweepHold,
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts && npx tsc --noEmit`
Expected: PASS, and no type errors (the two-argument call from Task 2 is gone).

- [ ] **Step 5: Run the full suite, then commit**

```bash
npm run test
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/pool-retention ] \
  && git add app/api/cron/update-cameras/route.ts \
             app/api/cron/update-cameras/route.test.ts \
  && git commit -m "feat(cron): hold the pool on a failed sweep, deactivate only past the grace" \
  && git push
```

**Ship gate.** Tasks 1–4 are the protection. Open the PR here if the show is close. Body must state: an all-empty or half-failed sweep now keeps the last good pool instead of emptying it; cameras leave the pool 20 minutes after last seen instead of instantly; `retention` is in the tick response; no migration in this PR.

---

## Task 5: Count held ticks

**Files:**
- Create: `database/migrations/20260904_sweep_hold.sql`
- Modify: `app/api/cron/update-cameras/lib/sweepStats.ts` (`SweepTickStats` interface ~line 24; `computeSweepTickStats` input and return ~lines 60–125; `upsertSweepStats` insert ~lines 145–200; `SweepDigestSummary` and `getSweepDigestSummary` ~lines 207–270)
- Modify: `app/api/cron/update-cameras/route.ts` (the `computeSweepTickStats({...})` call ~line 480)
- Test: `app/api/cron/update-cameras/lib/sweepStats.test.ts`

**Interfaces:**
- Consumes: `sweepHold` from Task 4 (in scope in the route).
- Produces: `SweepTickStats.heldTicks: number`, `SweepDigestSummary.heldTicks: number`, column `daily_sunset_stats.sweep_held_ticks`. Task 6 reads `heldTicks` from the summary.

- [ ] **Step 1: Write the migration**

```sql
-- Pool retention: count the ticks that kept the last good pool because the
-- sweep could not see the world (no boxes, nothing found, or at least half
-- the boxes non-OK). Tick-level like the other sweep_* counters: one tick
-- contributes at most 1, so the column reads "N of today's ticks held".
--
-- Forward-only, idempotent. Apply manually via:
--   node scripts/apply-migration.mjs database/migrations/20260904_sweep_hold.sql
--   node scripts/apply-migration.mjs database/migrations/20260904_sweep_hold.sql --apply

ALTER TABLE daily_sunset_stats
  ADD COLUMN IF NOT EXISTS sweep_held_ticks INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Write the failing tests**

In `sweepStats.test.ts`, find the existing `computeSweepTickStats` tests and add, using whatever telemetry fixture helper that file already defines (it has one; the other tests call it):

```ts
  it('counts a held tick as 1 and a normal tick as 0', () => {
    const held = computeSweepTickStats({ telemetry: fixture(), floor: 15, held: true });
    expect(held.heldTicks).toBe(1);
    const normal = computeSweepTickStats({ telemetry: fixture(), floor: 15, held: false });
    expect(normal.heldTicks).toBe(0);
  });

  it('defaults heldTicks to 0 when held is not passed', () => {
    const s = computeSweepTickStats({ telemetry: fixture(), floor: 15 });
    expect(s.heldTicks).toBe(0);
  });
```

And in the `upsertSweepStats` tests, add one assertion to whichever test already inspects the SQL strings:

```ts
    expect(strings.join(' ')).toContain('sweep_held_ticks');
```

And in the `getSweepDigestSummary` tests, extend the mocked row with `sweep_held_ticks: '3'` (a string, as the driver returns it) and assert `summary!.heldTicks === 3`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run app/api/cron/update-cameras/lib/sweepStats.test.ts`
Expected: FAIL, `heldTicks` undefined.

- [ ] **Step 4: Implement**

In `SweepTickStats` (after `budgetExhaustedTicks`):

```ts
  /** The tick kept the last good pool because the sweep could not see the world. */
  heldTicks: number;
```

In `computeSweepTickStats`, extend the input type and the return:

```ts
export function computeSweepTickStats(input: {
  telemetry: SweepTelemetry;
  floor: number;
  gateByOffset?: Map<number, RingGateCounts>;
  held?: boolean;
}): SweepTickStats {
  const { telemetry, floor, gateByOffset, held = false } = input;
```

and in the returned object, after `budgetExhaustedTicks`:

```ts
    heldTicks: held ? 1 : 0,
```

In `upsertSweepStats`, add `sweep_held_ticks` to the column list after `sweep_budget_exhausted_ticks`, `${stats.heldTicks}` to the values in the same position, and to the `on conflict` set:

```sql
        sweep_held_ticks =
          daily_sunset_stats.sweep_held_ticks + excluded.sweep_held_ticks,
```

In `SweepDigestSummary`, add `heldTicks: number;` after `budgetExhaustedTicks`. In `getSweepDigestSummary`, add `sweep_held_ticks` to the selected columns and `heldTicks: Number(row.sweep_held_ticks),` to the returned object.

In `route.ts`, the `computeSweepTickStats({ telemetry: sweep.telemetry, ... })` call gains `held: sweepHold.held,`.

- [ ] **Step 5: Run the tests, then apply the migration (dry run first)**

```bash
npx vitest run app/api/cron/update-cameras/lib/sweepStats.test.ts
node scripts/apply-migration.mjs database/migrations/20260904_sweep_hold.sql
node scripts/apply-migration.mjs database/migrations/20260904_sweep_hold.sql --apply
```

Expected: tests PASS; the dry run prints the ALTER; the apply reports success. The insert in `upsertSweepStats` will error on every tick until the column exists, and it swallows that error, so **apply the migration before merging**, not after.

- [ ] **Step 6: Commit**

```bash
npm run test
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/pool-retention ] \
  && git add database/migrations/20260904_sweep_hold.sql \
             app/api/cron/update-cameras/lib/sweepStats.ts \
             app/api/cron/update-cameras/lib/sweepStats.test.ts \
             app/api/cron/update-cameras/route.ts \
  && git commit -m "feat(sweep): count held ticks into daily_sunset_stats" \
  && git push
```

---

## Task 6: The digest clause

**Files:**
- Modify: `app/api/cron/update-cameras/lib/dailyDigest.ts` (the sweep line; the `parts.push(...)` for budget exhaustion is at ~line 170)
- Test: `app/api/cron/update-cameras/lib/dailyDigest.test.ts`

**Interfaces:**
- Consumes: `SweepDigestSummary.heldTicks` (Task 5).

- [ ] **Step 1: Write the failing test**

Find the existing digest test that builds a `SweepDigestSummary` fixture and asserts the sweep line (it exists for the budget clause). Add:

```ts
  it('names held ticks in the sweep line when any tick held the pool', () => {
    const html = renderSweepSection({ ...sweepFixture(), ticks: 1440, heldTicks: 4 });
    expect(html).toContain('4 ticks held the last good pool');
  });

  it('says nothing about holds when none happened', () => {
    const html = renderSweepSection({ ...sweepFixture(), heldTicks: 0 });
    expect(html).not.toContain('held the last good pool');
  });
```

(Use the file's real names for the render function and the fixture; they are the ones the budget-clause test already uses. Add `heldTicks: 0` to the fixture so the other tests keep compiling.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/lib/dailyDigest.test.ts`
Expected: FAIL, the phrase is absent.

- [ ] **Step 3: Add the clause**

Directly after the existing budget clause:

```ts
  if (s.budgetExhaustedTicks > 0) {
    parts.push(`${s.budgetExhaustedTicks} ticks hit the sweep budget`);
  }
```

add:

```ts
  // A held tick is a tick Windy could not be trusted: the pool was kept, not
  // rebuilt. One or two on a day is a Windy blip. A run of them is an outage
  // the glass rode out, and the reason is in the tick log's `sweep hold` line.
  if (s.heldTicks > 0) {
    parts.push(`<b>${s.heldTicks} ticks held the last good pool</b>`);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/api/cron/update-cameras/lib/dailyDigest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit and open the PR**

```bash
npm run test
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/pool-retention ] \
  && git add app/api/cron/update-cameras/lib/dailyDigest.ts \
             app/api/cron/update-cameras/lib/dailyDigest.test.ts \
  && git commit -m "feat(digest): say when ticks held the pool" \
  && git push
```

PR body must state: the behaviour change (held ticks keep the pool; 20-minute grace), that `20260904_sweep_hold.sql` is already applied, and how to verify after deploy: `curl` the cron with `CRON_SECRET` and read `.retention`, or grep the function logs for `sweep hold`; then `select sweep_held_ticks from daily_sunset_stats where date = current_date` should stay 0 on a healthy day.

---

## Verification after deploy

1. **Grace visible.** `select count(*) from terminator_webcam_state where active` should exceed the per-tick camera count in the `📊 Webcam split` log line by roughly the 20-minute retention, about 15–20 cameras at today's turnover.
2. **Held stays 0.** `sweep_held_ticks` stays 0 across a healthy day. If it climbs on a day with no Windy trouble, the ratio or the found check is misfiring; read the `sweep hold` log lines for the reason.
3. **Nothing flickers.** Watch the glass for ten minutes. A camera that was there a minute ago is still there.
4. **Per-feed failure is not a hold.** If one panel drains while the tick response shows `retention.held: false`, read `sweep.rings[].failedByStatus` in the same response before suspecting the pool; a one-feed Windy failure that stays under the 50% ratio is bounded only by the grace.
5. **Boundary cameras may sit in both phases for the grace.** `select webcam_id from terminator_webcam_state where active group by webcam_id having count(*) > 1` should stay near zero (baseline 0 on 2026-09-03). Cosmetic if not: the camera shows on both walls briefly.

## Self-review

- Spec coverage: grace (Task 1, 2, 4), hold (Task 1, 3, 4), observability (Task 4 response, Task 5 counter, Task 6 digest), rewritten contract test (Task 4). No gaps.
- Placeholders: Task 6 asks the implementer to use the digest test file's real fixture and render names, which I did not read; it names the neighbouring test (the budget clause) so the implementer can find them in one grep. Everything else is literal.
- Types: `SweepHold` shape is identical in Task 3, Task 4's tests, and the route response. `heldTicks` is the same name in `SweepTickStats`, `SweepDigestSummary`, and the digest. `graceMs` is the third positional parameter everywhere.
