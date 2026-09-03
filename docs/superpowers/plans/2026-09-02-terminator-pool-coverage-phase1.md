# Terminator Pool Coverage — Phase 1 (Measurement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the day-side escalation ring on behind a runtime switch for a
bounded window, and come out knowing three things: what the pool costs per
sunset it actually delivers, which lever moves that ratio, and exactly what
geometry produced every number.

**Architecture:** Four seams. A `runtime_flags` row the cron reads at tick time
(not an env var, so it flips without a redeploy). A `forcedOffsets` option on
`sweepWithEscalation` that makes a named ring sweep both feeds regardless of
`TERMINATOR_CAMERA_FLOOR`. Per-ring wall-clock added to the existing sweep
telemetry, which is the only marginal-cost signal the feature does not already
carry. And a per-day geometry record, so the ring angles behind any historical
row stay readable after the configuration has moved on. Phase 1 changes no
default behaviour: with the flag off, the sweep is what it is today.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Neon Postgres over the
`@neondatabase/serverless` HTTP driver, Resend for the digest email.

**Spec:** `docs/superpowers/specs/2026-09-02-terminator-pool-coverage-design.md`

**Sibling spec (boundary only):**
`docs/superpowers/specs/2026-09-02-mosaic-v3-band-paradigm-design.md` §8.
Task 1 is what that spec's §6 test reads. Nothing else here touches display.

---

## Global Constraints

- **Plain branches in the main checkout.** `git checkout -b ...`. Never create
  `.claude/worktrees/`. If the checkout is mid-work on another branch, ask
  before switching.
- **Verify the branch before every commit.** `git rev-parse --abbrev-ref HEAD`.
  PRs are merged in parallel sessions and the working branch can shift
  mid-task. If it is not the expected branch, stop and say so.
- **Never `git add -A` or `git add .`.** Several sessions share this one
  checkout; a broad add stages another session's files. Stage explicit paths,
  exactly the ones the task's **Files** block names.
- **Push the branch as soon as the first task commits**, so the checkout is
  never the only copy.
- **Migrations are forward-only and idempotent**, applied by hand. There is no
  separate dev database: every env file here points at the same Neon endpoint,
  so applying a migration is a production schema change. Dry-run first:
  `node scripts/apply-migration.mjs <file>.sql` then `--apply`.
- **`NUMERIC` and `BIGINT` come back from the Neon driver as strings.** Wrap
  every numeric read in `Number()`. This has already bitten `offset_deg`.
- **Telemetry is never worth failing a cron tick over.** Every new read or
  write in the cron path catches its own errors and degrades to a safe
  default.
- **The flag fails closed.** An unreadable flag means off, which means no extra
  spend.
- **Run `npm run test` before every commit**, not just the one new file.

---

## Cost posture — the actual target

The operator has approved this spend, with a band and a deliverable.

| | per day | per month |
| --- | --- | --- |
| Where the bill sits now (measured 2026-09-03) | $0.64 | ~$19 |
| Where it used to sit, and the ceiling | $2.60–3.30 | $80–100 |

There is a second ceiling that is not financial. Windy publishes no rate limit
and no quota headers, and the sibling cost spec names ~22,300 calls/day as the
likely point of discovering one. Breaching it empties the panels, which is
worse than any bill in the band above. Task 8 therefore aborts on box volume
as well as on dollars, and box volume is the faster signal.

**Anywhere between those two rows is acceptable.** Above the top row is a
problem, and Task 8 aborts on it rather than finishing the window.

Two consequences for this plan, both differing from the spec's §4 and §7:

**The bill may be visible after the fact.** The spec reads as though the digest
must ship before the spending starts. It does not. The measurement window can
open as soon as the switch exists, and the digest lines can land while it runs.
Task 8 does not wait on an email.

**Granularity is the real deliverable, not the total.** Knowing the bill went up
is worth little. Knowing *which ring bought how many gate-passed frames per
box, per second of sweep* is what says which lever to pull. Every cost number
in this plan is therefore reported per ring and divided by results, never as a
tick-level or day-level lump.

**The geometry must be recorded, not remembered.** The operator expects this
configuration to expand and contract more than once. A row saying "offset 15.75
scored 40 of 200" is uninterpretable a month later if the base altitude has
moved in between, because 15.75 will have meant a different sun angle. Task 6
records the angles themselves alongside the counters, so that every historical
number stays readable through the next change. This is a requirement, not a
nicety.

---

## The boundary constant is NOT this plan's to write

Settled with the Plan A session on 2026-09-02, reversing an earlier reading of
mine. Recorded here because the plan originally said the opposite.

Plan A §6 specifies a test asserting the display window **covers** the range
the sweep gathers. That is window ⊇ coverage. An earlier draft of this plan
assumed the reverse and proposed
`TERMINATOR_POOL_COVERAGE_DEG = { min: -39.75, max: 13.75 }`, the union over
every ring that exists in config. Against the actual test direction that value
fails on day one, because Plan A §6 also fixes the default window at −24 and
−2.

The measurement settles it. `sweep_escalated_ticks` is **0** on both
2026-09-02 and 2026-09-03: escalation has never fired in production. "The
range the sweep gathers" is therefore the base ring alone, −24° to −2°, and a
constant claiming −39.75 to +13.75 would describe rings nobody sweeps.

**The rule, and it is a tripwire.** The constant tracks what the sweep
actually gathers under the current configuration. It moves in the same commit
that makes a ring unconditional. That coupling is the point: turning a ring on
breaks Plan A's window test, and the break is the reminder to move the axis
dials with it.

Consequences for this plan:

- **Task 1 does not create the constant.** The Plan A session already
  committed one on `feat/mosaic-v3-band-paradigm` and is renaming it to
  `TERMINATOR_POOL_COVERAGE_DEG` with value `{ min: -24, max: -2 }`. Do not
  add a second one to `main`. Task 1 adds only
  `TERMINATOR_DAY_SIDE_OFFSETS_DEG`, which Plan A does not read.
- **Phase 1 does not move it.** The forced-ring switch is runtime; the
  constant is compile-time. During the measurement window the sweep really
  will gather −24° to +13.75° while the constant still says −24° to −2°. That
  is deliberate: a bounded measurement must not move the display contract.
  The honest record of what was actually swept lives in Task 6's
  `daily_sweep_geometry`, stamped per day.
- **Moving it is phase 2's first act**, alongside the axis dials.

One caveat to keep in the constant's comment rather than paper over:
escalation is unobserved, not impossible. It fires when a feed drops under
`TERMINATOR_CAMERA_FLOOR`. When it does, the pool briefly reaches +13.75° and
those cameras clamp to the panel's day edge, which is the behaviour
`horizontalPlace.ts` already documents and defends.

On dollars in the digest: Windy publishes no price, no rate limit and no quota
headers, measured 2026-09-02 and recorded in
`docs/superpowers/specs/2026-09-02-camera-refresh-cost-design.md`. That spec
also names the two numbers nobody has measured, the update-cameras function's
wall-clock duration and the cron's share of Neon compute. Task 8 measures both,
because the day-over-day Neon delta across the window gives the second one
directly. Until then the digest reports the physical bill, which is boxes,
sweep seconds and frames, all divided by gate-passed frames.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app/lib/masterConfig.ts` | **Modify.** Adds `TERMINATOR_DAY_SIDE_OFFSETS_DEG` only. The boundary constant belongs to the Plan A branch. |
| `app/lib/masterConfig.test.ts` | **Modify.** Pins the day-side offset and its ring altitude. |
| `database/migrations/20260902_runtime_flags.sql` | **Create.** The `runtime_flags` table plus the one seeded row, off. |
| `app/lib/runtimeFlags.ts` | **Create.** One read function, fails closed. The only consumer of `runtime_flags`. |
| `app/lib/runtimeFlags.test.ts` | **Create.** |
| `scripts/set-runtime-flag.mjs` | **Create.** How the switch flips without a redeploy. Dry by default. |
| `app/api/cron/update-cameras/lib/terminatorSweep.ts` | **Modify.** `forcedOffsets` option; per-ring `elapsedMs`. |
| `app/api/cron/update-cameras/lib/terminatorSweep.test.ts` | **Modify.** |
| `app/api/cron/update-cameras/route.ts` | **Modify.** Reads the flag, passes `forcedOffsets`, records the geometry, surfaces both in the response. |
| `database/migrations/20260902_sweep_timing.sql` | **Create.** Millisecond columns on the two existing sweep tables. |
| `database/migrations/20260902_sweep_geometry.sql` | **Create.** `daily_sweep_geometry`: which angles produced a day's rows. |
| `app/api/cron/update-cameras/lib/sweepGeometry.ts` | **Create.** Signature, coverage span, and the daily upsert. |
| `app/api/cron/update-cameras/lib/sweepGeometry.test.ts` | **Create.** |
| `app/api/cron/update-cameras/lib/sweepStats.ts` | **Modify.** Rolls `elapsedMs` into tick stats, persists it, reads it back for the digest. |
| `app/api/cron/update-cameras/lib/sweepStats.test.ts` | **Modify.** |
| `app/api/cron/update-cameras/lib/dailyDigest.ts` | **Modify.** Altitude-span clause, the widening bill, and cost per gate-passed frame per ring. |
| `app/api/cron/update-cameras/lib/dailyDigest.test.ts` | **Modify.** |
| `docs/superpowers/plans/2026-09-02-terminator-pool-coverage-phase1-REPORT.md` | **Create in Task 8.** The measurement answer phase 2 is decided from. |

Tasks 1 through 7 are code and need the checkout. Task 8 needs it barely at
all: a flag flip, a daily cost glance, and three SQL reads.

---

## Task 1: Name the day-side ring

Small and pure config. First because Task 4 cannot proceed without it, and it
costs about two minutes of the shared checkout.

**Read "The boundary constant is NOT this plan's to write" above before
starting.** Do **not** add `TERMINATOR_POOL_COVERAGE_DEG`. Another session
owns it and has already committed it on its own branch; a second definition
here collides on merge.

**Files:**
- Modify: `app/lib/masterConfig.ts` (after `TERMINATOR_WIDEN_OFFSETS_DEG`, around line 51)
- Test: `app/lib/masterConfig.test.ts`

**Interfaces:**
- Consumes: `TERMINATOR_SUN_ALTITUDE_DEG`, `TERMINATOR_WIDEN_OFFSETS_DEG` —
  both already in this file.
- Produces:
  - `TERMINATOR_DAY_SIDE_OFFSETS_DEG: readonly number[]` — used by Tasks 4 and 6.

- [ ] **Step 1: Write the failing test**

Append to `app/lib/masterConfig.test.ts`:

```ts
describe('TERMINATOR_DAY_SIDE_OFFSETS_DEG', () => {
  it('is the golden-hour ring, and only it', () => {
    // Positive offset moves the ring toward day. The night-side ring lands
    // near -28.75, where the detection gate floors the frames anyway, so
    // forcing it would buy cost without sunsets.
    expect(TERMINATOR_DAY_SIDE_OFFSETS_DEG).toEqual([15.75]);
  });

  it('puts its ring inside the measured quality peak', () => {
    const altitude = TERMINATOR_SUN_ALTITUDE_DEG + TERMINATOR_DAY_SIDE_OFFSETS_DEG[0];
    expect(altitude).toBeGreaterThan(0);
    expect(altitude).toBeLessThan(6);
  });
});
```

Extend the existing import at the top of the file to add
`TERMINATOR_SUN_ALTITUDE_DEG` and `TERMINATOR_DAY_SIDE_OFFSETS_DEG`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/masterConfig.test.ts`
Expected: FAIL — `TERMINATOR_DAY_SIDE_OFFSETS_DEG` is not exported.

- [ ] **Step 3: Write the implementation**

In `app/lib/masterConfig.ts`, immediately after the
`TERMINATOR_WIDEN_OFFSETS_DEG` export:

```ts
// The escalation offsets that move the ring toward day. Positive offset
// shrinks the ring radius, so positive is day. Named rather than indexed
// because "the day-side ring" is the concept the forced-sweep switch acts on,
// and TERMINATOR_WIDEN_OFFSETS_DEG[0] would silently mean something else if
// the array were ever reordered.
export const TERMINATOR_DAY_SIDE_OFFSETS_DEG = TERMINATOR_WIDEN_OFFSETS_DEG
  .filter((offset) => offset > 0);
```

Nothing else. `TERMINATOR_POOL_COVERAGE_DEG` belongs to the Plan A branch;
see the boundary section above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/lib/masterConfig.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Confirm branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/lib/masterConfig.ts app/lib/masterConfig.test.ts
git commit -m "feat(config): name the day-side widening offset"
git push -u origin HEAD
```

- [ ] **Step 6: Confirm you did not touch the boundary constant**

Run: `git show --stat HEAD` and `grep -n POOL_COVERAGE app/lib/masterConfig.ts`
Expected: the grep finds nothing on this branch. If it finds something, the
Plan A branch has merged in the meantime; leave that definition exactly as it
is and do not modify or duplicate it.

---

## Task 2: The runtime switch

A stored flag, not an env var. Env vars bake in at deploy time here, so an
env-var switch would need `vercel redeploy` to bring spending back down, which
fails the spec §4 condition outright.

**Files:**
- Create: `database/migrations/20260902_runtime_flags.sql`
- Create: `app/lib/runtimeFlags.ts`
- Create: `app/lib/runtimeFlags.test.ts`
- Create: `scripts/set-runtime-flag.mjs`

**Interfaces:**
- Consumes: `sql` from `@/app/lib/db`.
- Produces:
  - `SWEEP_FORCE_DAY_RING: 'sweep_force_day_ring'` — the flag key.
  - `isFlagEnabled(key: string): Promise<boolean>` — used by Task 4.

- [ ] **Step 1: Write the migration**

Create `database/migrations/20260902_runtime_flags.sql`:

```sql
-- runtime_flags: booleans the cron reads at tick time (spec:
-- docs/superpowers/specs/2026-09-02-terminator-pool-coverage-design.md §4).
--
-- Deliberately NOT env vars. Env vars in this project bake in at deploy time,
-- so bringing spending back down through one would need a `vercel redeploy`.
-- The operator's condition on approving this spend was a switch that works
-- without a code change or a redeploy, and a table row is that switch.
--
-- Kept separate from kiosk_settings: that table is display dials, sanitized
-- against a versioned settings schema and copied studio -> live by the Deploy
-- button. An ops kill-switch has none of those semantics and must not inherit
-- them -- in particular it must never be copied by a profile deploy.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260902_runtime_flags.sql --apply

CREATE TABLE IF NOT EXISTS runtime_flags (
  key        TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seeded OFF. Phase 1 flips it by hand for a bounded window; see
-- scripts/set-runtime-flag.mjs.
INSERT INTO runtime_flags (key, enabled, note)
VALUES (
  'sweep_force_day_ring',
  false,
  'Sweep the +15.75 day-side ring every tick regardless of TERMINATOR_CAMERA_FLOOR. Roughly doubles Windy boxes per tick.'
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Write the failing test**

Create `app/lib/runtimeFlags.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { isFlagEnabled, SWEEP_FORCE_DAY_RING } from './runtimeFlags';

// Braces, not a concise arrow: mockReset() returns the mock, and Vitest treats
// a value returned from a hook as a teardown callback.
beforeEach(() => {
  sqlMock.mockReset();
});

describe('isFlagEnabled', () => {
  it('is true when the row says enabled', async () => {
    sqlMock.mockResolvedValue([{ enabled: true }]);
    await expect(isFlagEnabled(SWEEP_FORCE_DAY_RING)).resolves.toBe(true);
  });

  it('is false when the row says disabled', async () => {
    sqlMock.mockResolvedValue([{ enabled: false }]);
    await expect(isFlagEnabled(SWEEP_FORCE_DAY_RING)).resolves.toBe(false);
  });

  it('is false when the row does not exist', async () => {
    sqlMock.mockResolvedValue([]);
    await expect(isFlagEnabled(SWEEP_FORCE_DAY_RING)).resolves.toBe(false);
  });

  it('fails closed when the table is missing or the read throws', async () => {
    // A flag that fails OPEN would spend money on an unreachable database,
    // which is the one failure mode the operator's cost condition rules out.
    // This also covers the deploy window before the migration is applied.
    sqlMock.mockRejectedValue(new Error('relation "runtime_flags" does not exist'));
    await expect(isFlagEnabled(SWEEP_FORCE_DAY_RING)).resolves.toBe(false);
  });

  it('does not treat a truthy non-boolean as enabled', async () => {
    sqlMock.mockResolvedValue([{ enabled: 'false' }]);
    await expect(isFlagEnabled(SWEEP_FORCE_DAY_RING)).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/lib/runtimeFlags.test.ts`
Expected: FAIL — cannot resolve `./runtimeFlags`.

- [ ] **Step 4: Write the implementation**

Create `app/lib/runtimeFlags.ts`:

```ts
import 'server-only';
import { sql } from '@/app/lib/db';

/**
 * Booleans the cron reads at tick time.
 *
 * The point is reversibility without a redeploy: env vars in this project
 * bake in when the deploy is built, so an env-var kill-switch cannot bring
 * spending down until someone redeploys. A row can be flipped in seconds --
 * see scripts/set-runtime-flag.mjs -- and the next tick honours it.
 */

/**
 * Sweep the day-side escalation ring every tick, both feeds, regardless of
 * TERMINATOR_CAMERA_FLOOR. Roughly doubles Windy boxes per tick. Off by
 * default; phase 1 of the pool-coverage spec turns it on for a bounded
 * measurement window.
 */
export const SWEEP_FORCE_DAY_RING = 'sweep_force_day_ring';

/**
 * Read one flag. Fails CLOSED: any error, missing row, or non-boolean value
 * reads as off.
 *
 * Failing closed is the whole safety property. This flag gates spending, and
 * an unreachable database must not be able to turn spending on. It also means
 * a deploy that lands before the migration is applied behaves exactly like
 * today rather than throwing inside the cron.
 */
export async function isFlagEnabled(key: string): Promise<boolean> {
  try {
    const rows = (await sql`
      SELECT enabled FROM runtime_flags WHERE key = ${key}
    `) as unknown as { enabled: boolean }[];
    return rows[0]?.enabled === true;
  } catch (error) {
    console.warn('[runtimeFlags] read failed, treating as off:', key, error);
    return false;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/lib/runtimeFlags.test.ts`
Expected: PASS, five cases.

- [ ] **Step 6: Write the flip script**

Create `scripts/set-runtime-flag.mjs`:

```js
// scripts/set-runtime-flag.mjs
//
// Flips a runtime_flags row. This is the switch the pool-coverage spec's cost
// condition asks for: it takes effect on the next cron tick, with no code
// change and no redeploy.
//
// Dry by default, matching apply-migration.mjs and the backfill scripts.
// Every env file here points at the SAME Neon endpoint, so every --apply run
// is a production change.
//
//   node scripts/set-runtime-flag.mjs                              # list
//   node scripts/set-runtime-flag.mjs sweep_force_day_ring on
//   node scripts/set-runtime-flag.mjs sweep_force_day_ring on --apply
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
const [key, state] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');

const rows = await sql`SELECT key, enabled, note, updated_at FROM runtime_flags ORDER BY key`;
console.log('current flags:');
for (const r of rows) console.log(`  ${r.key} = ${r.enabled}  (${r.updated_at.toISOString?.() ?? r.updated_at})`);

if (!key) process.exit(0);

if (state !== 'on' && state !== 'off') {
  console.error('usage: node scripts/set-runtime-flag.mjs <key> <on|off> [--apply]');
  process.exit(1);
}
if (!rows.some((r) => r.key === key)) {
  console.error(`no such flag: ${key}. Apply the migration that seeds it first.`);
  process.exit(1);
}

const enabled = state === 'on';
if (!apply) {
  console.log(`\nDRY RUN. Would set ${key} = ${enabled}. Re-run with --apply.`);
  process.exit(0);
}
await sql`UPDATE runtime_flags SET enabled = ${enabled}, updated_at = now() WHERE key = ${key}`;
console.log(`\n${key} = ${enabled}. Takes effect on the next cron tick.`);
```

- [ ] **Step 7: Dry-run the migration, then apply it**

```bash
node scripts/apply-migration.mjs database/migrations/20260902_runtime_flags.sql
```
Expected: prints two statements, the CREATE TABLE and the INSERT. Then:

```bash
node scripts/apply-migration.mjs database/migrations/20260902_runtime_flags.sql --apply
node scripts/set-runtime-flag.mjs
```
Expected: `sweep_force_day_ring = false`.

Do not turn it on. Task 8 owns the flip.

- [ ] **Step 8: Confirm branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add database/migrations/20260902_runtime_flags.sql app/lib/runtimeFlags.ts \
        app/lib/runtimeFlags.test.ts scripts/set-runtime-flag.mjs
git commit -m "feat(ops): a runtime flag the cron reads at tick time"
```

---

## Task 3: Forced offsets in the sweep

**Files:**
- Modify: `app/api/cron/update-cameras/lib/terminatorSweep.ts` (the `SweepOptions` interface, and the escalation loop near the end of `sweepWithEscalation`)
- Test: `app/api/cron/update-cameras/lib/terminatorSweep.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SweepOptions.forcedOffsets?: readonly number[]` — consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('sweepWithEscalation', ...)` block in
`app/api/cron/update-cameras/lib/terminatorSweep.test.ts`. The `cam`, `ring`,
`stubFetcher` and `classify` helpers are already defined at the top of that
file; do not redefine them.

```ts
  it('sweeps a forced ring even when both feeds clear the floor', async () => {
    const seen: Location[][] = [];
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher(
        { 0: [cam(1), cam(2), cam(3), cam(4)], 15.75: [cam(5), cam(6)] },
        seen
      ),
      classify,
      floor: 2,
      offsets: [15.75, -15.75],
      hasBudget: () => true,
      forcedOffsets: [15.75],
    });
    expect(res.telemetry.rings.map((r) => r.offsetDeg)).toEqual([0, 15.75]);
    expect(res.telemetry.thinAfterBase).toEqual([]);
  });

  it('sweeps BOTH feeds on a forced ring, not just a thin one', async () => {
    // A forced ring exists to widen coverage, not to rescue a feed. Sweeping
    // only the thin half would leave one panel without the golden-hour
    // cameras the whole measurement is about -- and with no feed thin at all,
    // "the thin half" is empty and the ring would fetch nothing.
    const seen: Location[][] = [];
    await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher(
        { 0: [cam(1), cam(2), cam(3), cam(4)], 15.75: [cam(5), cam(6)] },
        seen
      ),
      classify,
      floor: 2,
      offsets: [15.75],
      hasBudget: () => true,
      forcedOffsets: [15.75],
    });
    // ring() puts sunrise at lng 1 and sunset at lng 2 for each offset.
    expect(seen[1]).toEqual([
      { lat: 15.75, lng: 1 },
      { lat: 15.75, lng: 2 },
    ]);
  });

  it('still sacrifices a forced ring when the budget is gone', async () => {
    // Spec §8: budget exhaustion sacrifices escalation rings first. The
    // scoring loop needs the remaining tick more than the pool needs cameras,
    // and forcing a ring must not buy its way past that.
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [cam(1), cam(2), cam(3), cam(4)] }),
      classify,
      floor: 2,
      offsets: [15.75],
      hasBudget: () => false,
      forcedOffsets: [15.75],
    });
    expect(res.telemetry.rings.map((r) => r.offsetDeg)).toEqual([0]);
    expect(res.telemetry.budgetExhausted).toBe(true);
  });

  it('is unchanged from today when no offsets are forced', async () => {
    // Spec §8: with the switch off, sweep behaviour is what it is today.
    const healthy = {
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [cam(1), cam(2), cam(3), cam(4)] }),
      classify,
      floor: 2,
      offsets: [15.75, -15.75],
      hasBudget: () => true,
    };
    const withoutField = await sweepWithEscalation(healthy);
    const withEmptyField = await sweepWithEscalation({
      ...healthy,
      forcedOffsets: [],
    });
    expect(withoutField.telemetry.rings).toHaveLength(1);
    expect(withEmptyField.telemetry.rings).toHaveLength(1);
    expect(withoutField.telemetry.budgetExhausted).toBe(false);
    expect(withEmptyField.telemetry.budgetExhausted).toBe(false);
  });

  it('credits a shared camera to the ring that saw it first', async () => {
    // Spec §8. The day ring's boxes overlap the base ring's (15.75 is under
    // the 22-degree box span), so the same camera routinely comes back from
    // both. If the later ring re-claimed it, the day ring's gate-pass rate
    // would be diluted with base-ring cameras and the one number that
    // distinguishes "widening adds sunsets" from "widening adds cameras the
    // gate floors" would stop meaning anything.
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({
        0: [cam(1), cam(2), cam(3), cam(4)],
        15.75: [cam(2), cam(4), cam(6)], // 2 and 4 already seen by base
      }),
      classify,
      floor: 2,
      offsets: [15.75],
      hasBudget: () => true,
      forcedOffsets: [15.75],
    });
    expect(res.telemetry.rings[0].newWebcamIds).toEqual([1, 2, 3, 4]);
    expect(res.telemetry.rings[1].newWebcamIds).toEqual([6]);
    expect(res.telemetry.rings[1].newWebcams).toBe(1);
  });

  it('still escalates on a thin feed while a later ring is forced', async () => {
    // Forcing must ADD a trigger, never replace the floor-based one.
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({
        0: [cam(2), cam(4)], // sunset only; sunrise is thin
        15.75: [cam(1), cam(3)],
      }),
      classify,
      floor: 2,
      offsets: [15.75],
      hasBudget: () => true,
      forcedOffsets: [15.75],
    });
    expect(res.telemetry.thinAfterBase).toEqual(['sunrise']);
    expect(res.telemetry.rings.map((r) => r.offsetDeg)).toEqual([0, 15.75]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/cron/update-cameras/lib/terminatorSweep.test.ts`
Expected: FAIL — TypeScript rejects `forcedOffsets`, and the forced rings do
not run.

- [ ] **Step 3: Add the option to `SweepOptions`**

In `app/api/cron/update-cameras/lib/terminatorSweep.ts`, add to the
`SweepOptions` interface, after `offsets`:

```ts
  /**
   * Offsets to sweep on every tick regardless of the camera floor, both feeds.
   *
   * The floor-based trigger asks "is a panel too empty to look at". This asks
   * a different question: "does the pool reach the altitudes where sunsets
   * actually happen". Good frames peak at 0 to +6 degrees solar altitude and
   * the base ring at -13 never sees them, so the day-side ring is worth
   * paying for even when nothing is thin. Additive to the floor trigger,
   * never a replacement for it.
   *
   * Empty or absent means today's behaviour exactly.
   */
  forcedOffsets?: readonly number[];
```

- [ ] **Step 4: Change the escalation loop**

Replace the `for (const offsetDeg of opts.offsets)` loop in
`sweepWithEscalation` with:

```ts
  for (const offsetDeg of opts.offsets) {
    const forced = opts.forcedOffsets?.includes(offsetDeg) ?? false;
    const thin = feedsBelowFloor(counts, opts.floor);
    // Forced rings sweep both feeds; floor-triggered rings sweep only the
    // thin half, which is what halves the cost of the common case.
    const feeds: Feed[] = forced ? [...FEEDS] : thin;
    // `continue`, not `break`. With no forced offsets the two are observably
    // identical -- feedsBelowFloor is pure, counts have not changed, and
    // neither path pushes a ring or sets budgetExhausted -- but `break` would
    // skip a forced offset that sat after a non-forced one in the list.
    if (feeds.length === 0) continue;
    if (!opts.hasBudget()) {
      budgetExhausted = true;
      break;
    }
    await sweep(offsetDeg, feeds);
    counts = currentCounts();
  }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run app/api/cron/update-cameras/lib/terminatorSweep.test.ts`
Expected: PASS, including every pre-existing case.

- [ ] **Step 6: Confirm branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/api/cron/update-cameras/lib/terminatorSweep.ts \
        app/api/cron/update-cameras/lib/terminatorSweep.test.ts
git commit -m "feat(cron): let a named ring sweep regardless of the camera floor"
```

---

## Task 4: Wire the switch into the cron

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts` (imports at the top; the `sweepWithEscalation` call around line 89; the log line at 126; the `NextResponse.json` at 492)
- Test: `app/api/cron/update-cameras/route.test.ts`

**Interfaces:**
- Consumes: `isFlagEnabled`, `SWEEP_FORCE_DAY_RING` (Task 2);
  `TERMINATOR_DAY_SIDE_OFFSETS_DEG` (Task 1); `forcedOffsets` (Task 3).
- Produces: a `forcedDayRing: boolean` field on the cron's JSON response, so
  the switch is smoke-testable from outside without reading the database. Also
  a local `forcedOffsets` value that Task 6 reuses for the geometry record.

- [ ] **Step 1: Add the flag mock to the route test harness**

`route.test.ts` mocks every module the route imports and drives a real `GET`
via `makeReq()`. Follow that pattern exactly. Add a mock declaration beside
the others near the top of the file:

```ts
const isFlagEnabledMock = vi.fn();
```

and a `vi.mock` beside the existing ones:

```ts
vi.mock('@/app/lib/runtimeFlags', () => ({
  SWEEP_FORCE_DAY_RING: 'sweep_force_day_ring',
  isFlagEnabled: () => isFlagEnabledMock(),
}));
```

and a reset in the existing `beforeEach`, defaulting the flag OFF so every
pre-existing test keeps today's behaviour:

```ts
  isFlagEnabledMock.mockReset().mockResolvedValue(false);
```

- [ ] **Step 2: Write the failing tests**

Add inside `describe('GET /api/cron/update-cameras', ...)`. The
`HEALTHY_CLASSIFY_RESULT` fixture already puts both feeds exactly at
`TERMINATOR_CAMERA_FLOOR`, so nothing is thin and the only reason a second
ring can run is the switch.

```ts
  it('sweeps only the base ring while the switch is off', async () => {
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.forcedDayRing).toBe(false);
    expect(body.sweep.rings).toHaveLength(1);
  });

  it('sweeps the day-side ring on a healthy tick when the switch is on', async () => {
    isFlagEnabledMock.mockResolvedValue(true);
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.forcedDayRing).toBe(true);
    expect(body.sweep.rings.map((r: { offsetDeg: number }) => r.offsetDeg))
      .toEqual([0, 15.75]);
    expect(body.sweep.rings[1].feedsSwept).toEqual(['sunrise', 'sunset']);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts`
Expected: FAIL — `forcedDayRing` is `undefined`.

- [ ] **Step 4: Wire it in**

Add to the `@/app/lib/masterConfig` import block:

```ts
  TERMINATOR_DAY_SIDE_OFFSETS_DEG,
```

Add a new import beside the other `@/app/lib` imports:

```ts
import { isFlagEnabled, SWEEP_FORCE_DAY_RING } from '@/app/lib/runtimeFlags';
```

Immediately before `const tickStartedAt = Date.now();`:

```ts
  // Read per tick, so the operator can bring the spending back down without a
  // redeploy. Fails closed inside isFlagEnabled: an unreachable database
  // gives today's behaviour, never extra cost.
  const forcedDayRing = await isFlagEnabled(SWEEP_FORCE_DAY_RING);
  const forcedOffsets = forcedDayRing ? TERMINATOR_DAY_SIDE_OFFSETS_DEG : [];
```

In the `sweepWithEscalation` options object, after `offsets:`:

```ts
    // Phase 1 of the pool-coverage spec: force the golden-hour ring so the
    // pool reaches 0 to +6 degrees, where good frames actually are, instead
    // of only the -24 to -2 band the base ring covers. Roughly doubles Windy
    // boxes per tick, which is the cost the measurement window exists to
    // price.
    forcedOffsets,
```

Change the log line at 126 to carry the switch:

```ts
  console.log(
    '🛰️ terminator sweep:',
    JSON.stringify({ forcedDayRing, ...sweep.telemetry }),
  );
```

Add to the `NextResponse.json({ ... })` object, next to `sweep`:

```ts
    forcedDayRing,
```

- [ ] **Step 5: Run the whole suite**

Run: `npm run test`
Expected: PASS. Then `npm run lint` and `npm run build`, both clean.

- [ ] **Step 6: Confirm branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/api/cron/update-cameras/route.ts app/api/cron/update-cameras/route.test.ts
git commit -m "feat(cron): honour the forced-day-ring switch per tick"
```

---

## Task 5: Per-ring wall-clock, captured and persisted

Capture and persistence are one task, not two. Adding a required `elapsedMs`
to `SweepRingStats` immediately breaks `getSweepDigestSummary`'s typecheck,
which only the persistence half repairs, so there is no point between them
where the branch is green and a reviewer could accept one half alone.


Spec §7 step 2 says extend `SweepRingStats` only if a field is genuinely
missing. Boxes, gate-pass rates, new cameras and budget exhaustion are all
there. Elapsed time is not, and it is the one quantity that turns "how much
did widening cost" into something with a unit. Boxes are free at Windy;
function seconds are not.

**Files:**
- Modify: `app/api/cron/update-cameras/lib/terminatorSweep.ts` (`RingTelemetry`, and the `sweep` closure)
- Modify: `app/api/cron/update-cameras/lib/sweepStats.ts` (`SweepRingStats`, `SweepTickStats`, `SweepDigestSummary`, `computeSweepTickStats`)
- Test: `app/api/cron/update-cameras/lib/terminatorSweep.test.ts`, `app/api/cron/update-cameras/lib/sweepStats.test.ts`

**Interfaces:**
- Produces:
  - `RingTelemetry.elapsedMs: number` (required, not optional).
  - `SweepRingStats.elapsedMs: number`.
  - `SweepTickStats.baseMs: number`, `SweepTickStats.escalationMs: number`.
  - The same two fields on `SweepDigestSummary`.

- [ ] **Step 1: Write the failing tests**

In `terminatorSweep.test.ts`, inside `describe('sweepWithEscalation', ...)`:

```ts
  it('times each ring separately', async () => {
    let clock = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    try {
      const res = await sweepWithEscalation({
        buildRing: ring,
        fetchCoords: async (coords) => {
          clock += 5_000; // each ring takes 5s of wall clock
          return { webcams: [], attempted: coords.length, empty: 0 };
        },
        classify,
        floor: 2,
        offsets: [15.75],
        hasBudget: () => true,
        forcedOffsets: [15.75],
      });
      expect(res.telemetry.rings.map((r) => r.elapsedMs)).toEqual([5_000, 5_000]);
    } finally {
      nowSpy.mockRestore();
    }
  });
```

Add `vi` to the vitest import at the top of that file.

In `sweepStats.test.ts`, add `elapsedMs` to every `RingTelemetry` object in the
`healthy` and `escalated` fixtures (`elapsedMs: 8_000` on base rings,
`elapsedMs: 5_000` on escalation rings), then add:

```ts
  it('splits sweep milliseconds into base and escalation', async () => {
    const stats = computeSweepTickStats({ telemetry: escalated, floor: 15 });
    expect(stats.baseMs).toBe(8_000);
    expect(stats.escalationMs).toBe(5_000);
  });

  it('reports no escalation milliseconds on a base-only tick', async () => {
    const stats = computeSweepTickStats({ telemetry: healthy, floor: 15 });
    expect(stats.baseMs).toBe(8_000);
    expect(stats.escalationMs).toBe(0);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/api/cron/update-cameras/lib/terminatorSweep.test.ts app/api/cron/update-cameras/lib/sweepStats.test.ts`
Expected: FAIL — `elapsedMs` is not a property of `RingTelemetry`, and
`baseMs` is undefined.

- [ ] **Step 3: Time the rings**

In `terminatorSweep.ts`, add to `RingTelemetry` after `newWebcamIds`:

```ts
  /**
   * Wall clock this ring spent, in milliseconds.
   *
   * The only unit-bearing cost signal the sweep produces. Windy publishes no
   * per-call price, no rate limit and no quota headers, so a box count cannot
   * be turned into money; function seconds can. It also says how close a ring
   * came to TERMINATOR_SWEEP_BUDGET_MS, which the budget-exhausted flag only
   * reports after the fact.
   */
  elapsedMs: number;
```

In the `sweep` closure, the existing body reads:

```ts
    const before = byId.size;
    const res = await opts.fetchCoords(coords);
```

Change to:

```ts
    const before = byId.size;
    const startedAt = Date.now();
    const res = await opts.fetchCoords(coords);
    const elapsedMs = Date.now() - startedAt;
```

and add `elapsedMs,` to the `rings.push({ ... })` object.

- [ ] **Step 4: Roll it into the tick stats**

In `sweepStats.ts`, add to `SweepRingStats` after `framesGatePassed`:

```ts
  elapsedMs: number;
```

Add to `SweepTickStats`, after `escalationBoxes`:

```ts
  /** Wall clock the base ring spent, summed over the tick. */
  baseMs: number;
  /** Wall clock widening added. Boxes are free at Windy; seconds are not. */
  escalationMs: number;
```

Add the same two fields to `SweepDigestSummary`.

In `computeSweepTickStats`, add `elapsedMs: 0` to the per-offset accumulator
default, add `acc.elapsedMs += ring.elapsedMs;` beside
`acc.boxesAttempted += ring.attempted;`, and add to the returned object beside
`escalationBoxes`:

```ts
    baseMs: base?.elapsedMs ?? 0,
    escalationMs: escalation.reduce((sum, r) => sum + r.elapsedMs, 0),
```

Do **not** run the suite yet and do **not** commit here. Adding a required
field to `SweepRingStats` and `SweepDigestSummary` leaves
`getSweepDigestSummary` failing to typecheck until Step 8 fills the new
fields in, so this task only builds green once the persistence half lands.
That is why the two halves are one task.

- [ ] **Step 5: Write the migration**

Create `database/migrations/20260902_sweep_timing.sql`:

```sql
-- Sweep timing: the one cost signal with a unit.
--
-- The sweep telemetry already answers "how many boxes" and "did the frames
-- pass the gate". It cannot answer "what did widening cost", because Windy
-- publishes no price, no rate limit and no quota headers -- a box count is
-- not money. Function wall-clock is, and it is also what actually runs out
-- against TERMINATOR_SWEEP_BUDGET_MS.
--
-- BIGINT: a day of ticks summing tens of seconds each stays far inside
-- INTEGER, but these are additive counters with no natural ceiling and the
-- cost of the wider type here is nil.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260902_sweep_timing.sql --apply

ALTER TABLE daily_sunset_stats
  -- Wall clock the base ring spent, summed over today's ticks.
  ADD COLUMN IF NOT EXISTS sweep_base_ms       BIGINT NOT NULL DEFAULT 0,
  -- Wall clock widening added, summed over today's ticks. Read against
  -- sweep_base_ms, this is the widening's marginal compute cost.
  ADD COLUMN IF NOT EXISTS sweep_escalation_ms BIGINT NOT NULL DEFAULT 0;

ALTER TABLE daily_sweep_ring_stats
  ADD COLUMN IF NOT EXISTS elapsed_ms BIGINT NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Write the failing test**

In `sweepStats.test.ts`, extend whichever existing test asserts the
`upsertSweepStats` bind values so it also expects the two new millisecond
values, and add:

```ts
  it('reads the timing columns back for the digest', async () => {
    sqlMock
      .mockResolvedValueOnce([
        {
          sweep_ticks: 96, sweep_escalated_ticks: 96,
          sweep_budget_exhausted_ticks: 3,
          sweep_sunrise_thin_ticks: 0, sweep_sunset_thin_ticks: 0,
          sweep_sunrise_short_ticks: 0, sweep_sunset_short_ticks: 0,
          sweep_base_boxes: 2976, sweep_escalation_boxes: 2880,
          sweep_base_ms: '1152000', sweep_escalation_ms: '960000',
        },
      ])
      .mockResolvedValueOnce([
        {
          offset_deg: '0', rings_swept: 96, boxes_attempted: 2976,
          boxes_empty: 400, new_webcams: 300, frames_scored: 200,
          frames_gate_passed: 40, elapsed_ms: '1152000',
        },
      ]);
    const summary = await getSweepDigestSummary();
    // BIGINT arrives from the Neon driver as a string, like every NUMERIC in
    // this codebase. Unwrapped, every downstream comparison silently
    // concatenates instead of adding.
    expect(summary?.escalationMs).toBe(960_000);
    expect(summary?.rings[0].elapsedMs).toBe(1_152_000);
  });
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/lib/sweepStats.test.ts`
Expected: FAIL — `escalationMs` is `undefined`.

- [ ] **Step 8: Persist and read back**

In `upsertSweepStats`, add `sweep_base_ms, sweep_escalation_ms` to the
`daily_sunset_stats` column list, `${stats.baseMs}, ${stats.escalationMs}` to
the values, and to the `do update set` clause:

```sql
        sweep_base_ms = daily_sunset_stats.sweep_base_ms + excluded.sweep_base_ms,
        sweep_escalation_ms =
          daily_sunset_stats.sweep_escalation_ms + excluded.sweep_escalation_ms,
```

In the ring insert, add `elapsed_ms` to the column list, `${ring.elapsedMs}`
to the values, and to the update clause:

```sql
          elapsed_ms = daily_sweep_ring_stats.elapsed_ms + excluded.elapsed_ms,
```

In `getSweepDigestSummary`, add `sweep_base_ms, sweep_escalation_ms` to the
first select and `elapsed_ms` to the ring select, then map:

```ts
      baseMs: Number(row.sweep_base_ms),
      escalationMs: Number(row.sweep_escalation_ms),
```
and inside the ring mapper:
```ts
        elapsedMs: Number(r.elapsed_ms),
```

- [ ] **Step 9: Run the tests, now including the whole suite**

Run: `npx vitest run app/api/cron/update-cameras/lib/`
Expected: PASS. Then `npm run test`. If any fixture elsewhere constructs a
`RingTelemetry` or a `SweepRingStats`, TypeScript will name the file; add
`elapsedMs` there too.

- [ ] **Step 10: Dry-run the migration, then apply it**

```bash
node scripts/apply-migration.mjs database/migrations/20260902_sweep_timing.sql
node scripts/apply-migration.mjs database/migrations/20260902_sweep_timing.sql --apply
```

- [ ] **Step 11: Confirm branch, then commit**

Both halves in one commit: the type change and the code that satisfies it.

```bash
git rev-parse --abbrev-ref HEAD
git add app/api/cron/update-cameras/lib/terminatorSweep.ts \
        app/api/cron/update-cameras/lib/terminatorSweep.test.ts \
        app/api/cron/update-cameras/lib/sweepStats.ts \
        app/api/cron/update-cameras/lib/sweepStats.test.ts \
        database/migrations/20260902_sweep_timing.sql
git commit -m "feat(cron): time each sweep ring and persist it, base split from widening"
```

---

## Task 6: Record which angles produced the numbers

The configuration is expected to expand and contract more than once. Without
this task, a row saying `offset_deg = 15.75, frames_gate_passed = 40` becomes
uninterpretable as soon as `TERMINATOR_SUN_ALTITUDE_DEG` or
`SEARCH_RADIUS_DEG` moves, because the same offset will then mean a different
sun angle. The counters must carry their own geometry.

Recorded automatically rather than written down by hand, because a record that
depends on someone remembering to log a change is the record that will be
missing on the day it matters.

**Files:**
- Create: `database/migrations/20260902_sweep_geometry.sql`
- Create: `app/api/cron/update-cameras/lib/sweepGeometry.ts`
- Create: `app/api/cron/update-cameras/lib/sweepGeometry.test.ts`
- Modify: `app/api/cron/update-cameras/route.ts` (beside the existing `upsertSweepStats` call, around line 465)

**Interfaces:**
- Consumes: `TERMINATOR_SUN_ALTITUDE_DEG`, `SEARCH_RADIUS_DEG`,
  `TERMINATOR_WIDEN_OFFSETS_DEG` (existing config); the `forcedOffsets` local
  from Task 4.
- Produces:
  - `coverageSpan(ringAltitudesDeg: number[]): { min: number; max: number }`
    — also imported by Task 7's digest, so the two span calculations cannot
    drift apart.
  - `sweepGeometry(forcedOffsets: readonly number[]): SweepGeometry`
  - `upsertSweepGeometry(now: Date, geometry: SweepGeometry): Promise<void>`

- [ ] **Step 1: Write the migration**

Create `database/migrations/20260902_sweep_geometry.sql`:

```sql
-- daily_sweep_geometry: the ring angles behind each day's sweep counters.
--
-- daily_sweep_ring_stats keys on offset_deg, which is meaningless on its own:
-- +15.75 is +2.75 degrees of solar altitude only while the base ring sits at
-- -13. The pool-coverage work expects the base altitude, the radius and the
-- offset set to move more than once, so every historical row needs the
-- geometry that produced it stored beside it rather than inferred from
-- whatever masterConfig.ts happens to say later.
--
-- One row per (date, signature). A configuration change mid-day writes a
-- SECOND row for that date rather than overwriting the first, so the
-- transition is visible instead of averaged away -- which is exactly the
-- moment the record exists for.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260902_sweep_geometry.sql --apply

CREATE TABLE IF NOT EXISTS daily_sweep_geometry (
  date               DATE NOT NULL,        -- UTC date, matches daily_sunset_stats
  -- Stable label for one configuration, e.g.
  -- 'base-13_r11_off15.75,-15.75_forced15.75'. Comparing signatures across
  -- days is how a change is spotted without diffing six columns.
  signature          TEXT NOT NULL,
  base_altitude_deg  NUMERIC(6,2) NOT NULL,
  search_radius_deg  NUMERIC(6,2) NOT NULL,
  widen_offsets_deg  TEXT NOT NULL,        -- every offset the sweep MAY run
  forced_offsets_deg TEXT NOT NULL,        -- offsets it ran unconditionally
  -- The resulting solar-altitude span, stored rather than derived so it
  -- survives a change to the derivation itself.
  coverage_min_deg   NUMERIC(6,2) NOT NULL,
  coverage_max_deg   NUMERIC(6,2) NOT NULL,
  ticks              INTEGER NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (date, signature)
);
```

- [ ] **Step 2: Write the failing test**

Create `app/api/cron/update-cameras/lib/sweepGeometry.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { coverageSpan, sweepGeometry, upsertSweepGeometry } from './sweepGeometry';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('coverageSpan', () => {
  it('widens a single ring altitude by the search radius on both sides', () => {
    expect(coverageSpan([-13])).toEqual({ min: -24, max: -2 });
  });

  it('spans from the night-most floor to the day-most ceiling', () => {
    expect(coverageSpan([-13, 2.75])).toEqual({ min: -24, max: 13.75 });
  });
});

describe('sweepGeometry', () => {
  it('records the base ring alone when nothing is forced', () => {
    const g = sweepGeometry([]);
    expect(g.baseAltitudeDeg).toBe(-13);
    expect(g.searchRadiusDeg).toBe(11);
    expect(g.forcedOffsetsDeg).toBe('');
    expect(g.coverageMinDeg).toBe(-24);
    expect(g.coverageMaxDeg).toBe(-2);
  });

  it('widens the recorded coverage to golden hour when the day ring is forced', () => {
    // This is the number the whole measurement is about: the guaranteed pool
    // has to contain 0 to +6 degrees, where 19.7% of frames are good, versus
    // 1.0% at the base ring.
    const g = sweepGeometry([15.75]);
    expect(g.coverageMinDeg).toBe(-24);
    expect(g.coverageMaxDeg).toBe(13.75);
  });

  it('gives different configurations different signatures', () => {
    expect(sweepGeometry([]).signature).not.toBe(sweepGeometry([15.75]).signature);
  });

  it('gives the same configuration the same signature every tick', () => {
    expect(sweepGeometry([15.75]).signature).toBe(sweepGeometry([15.75]).signature);
  });
});

describe('upsertSweepGeometry', () => {
  it('never throws when the table is missing', async () => {
    // Same non-fatal contract as upsertSweepStats: a deploy that lands before
    // the migration is applied must not fail the tick.
    sqlMock.mockRejectedValue(new Error('relation "daily_sweep_geometry" does not exist'));
    await expect(
      upsertSweepGeometry(new Date('2026-09-05T00:10:00Z'), sweepGeometry([]))
    ).resolves.toBeUndefined();
  });

  it('writes under the UTC date', async () => {
    sqlMock.mockResolvedValue([]);
    await upsertSweepGeometry(new Date('2026-09-05T00:10:00Z'), sweepGeometry([]));
    expect(sqlMock.mock.calls[0]).toContain('2026-09-05');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/lib/sweepGeometry.test.ts`
Expected: FAIL — cannot resolve `./sweepGeometry`.

- [ ] **Step 4: Write the implementation**

Create `app/api/cron/update-cameras/lib/sweepGeometry.ts`:

```ts
import { sql } from '@/app/lib/db';
import {
  TERMINATOR_SUN_ALTITUDE_DEG,
  SEARCH_RADIUS_DEG,
  TERMINATOR_WIDEN_OFFSETS_DEG,
} from '@/app/lib/masterConfig';

/**
 * The ring angles a tick actually ran with.
 *
 * Stored beside the counters because offset_deg alone is not a fact about the
 * sky. +15.75 means +2.75 degrees of solar altitude only while the base ring
 * is at -13, and this configuration is expected to move. Without this record,
 * comparing a day of counters against a day from before a change silently
 * compares two different experiments.
 */
export interface SweepGeometry {
  signature: string;
  baseAltitudeDeg: number;
  searchRadiusDeg: number;
  widenOffsetsDeg: string;
  forcedOffsetsDeg: string;
  /**
   * The span the sweep was GUARANTEED to gather from: the base ring plus
   * whatever was forced on this tick.
   *
   * Distinct from TERMINATOR_POOL_COVERAGE_DEG, which is the display's
   * compile-time contract and only moves when a ring becomes unconditional.
   * This one is the measurement record: during a bounded measurement window
   * the runtime flag widens what the sweep really gathers while the display
   * contract deliberately stays put, and this column is the only place that
   * difference is written down.
   */
  coverageMinDeg: number;
  coverageMaxDeg: number;
}

const fmt = (offsets: readonly number[]) => [...offsets].join(',');

/**
 * The solar-altitude span a set of ring altitudes gathers from.
 *
 * Shared so the two questions that need it cannot drift apart: this module
 * asks "what was the pool guaranteed to hold on this tick", and the digest
 * asks "what did yesterday's rings actually cover". Same arithmetic, two
 * inputs. (masterConfig's TERMINATOR_POOL_COVERAGE_DEG is a third thing —
 * the display contract, moved by hand — and cannot call this, because masterConfig is
 * imported by client code and this module imports the database.)
 *
 * A true union rather than a hull: the widest gap between consecutive ring
 * altitudes (15.75) is under one band's width (2 x SEARCH_RADIUS_DEG = 22),
 * so there is no hole for min/max to paper over.
 */
export function coverageSpan(
  ringAltitudesDeg: number[],
): { min: number; max: number } {
  return {
    min: Math.min(...ringAltitudesDeg) - SEARCH_RADIUS_DEG,
    max: Math.max(...ringAltitudesDeg) + SEARCH_RADIUS_DEG,
  };
}

export function sweepGeometry(forcedOffsets: readonly number[]): SweepGeometry {
  const guaranteed = [0, ...forcedOffsets];
  const { min: coverageMinDeg, max: coverageMaxDeg } = coverageSpan(
    guaranteed.map((o) => TERMINATOR_SUN_ALTITUDE_DEG + o),
  );
  const widenOffsetsDeg = fmt(TERMINATOR_WIDEN_OFFSETS_DEG);
  const forcedOffsetsDeg = fmt(forcedOffsets);
  return {
    signature:
      `base${TERMINATOR_SUN_ALTITUDE_DEG}` +
      `_r${SEARCH_RADIUS_DEG}` +
      `_off${widenOffsetsDeg}` +
      `_forced${forcedOffsetsDeg}`,
    baseAltitudeDeg: TERMINATOR_SUN_ALTITUDE_DEG,
    searchRadiusDeg: SEARCH_RADIUS_DEG,
    widenOffsetsDeg,
    forcedOffsetsDeg,
    coverageMinDeg,
    coverageMaxDeg,
  };
}

/**
 * Add one tick to today's row for this geometry.
 *
 * `ticks` accumulates, everything else is fixed by the signature, so a
 * configuration change mid-day makes a second row rather than corrupting the
 * first. Non-fatal by contract, like every other telemetry write in this
 * directory: a missing table means a quiet warning, never a failed tick.
 */
export async function upsertSweepGeometry(
  now: Date,
  geometry: SweepGeometry,
): Promise<void> {
  const date = now.toISOString().slice(0, 10);
  try {
    await sql`
      insert into daily_sweep_geometry (
        date, signature, base_altitude_deg, search_radius_deg,
        widen_offsets_deg, forced_offsets_deg,
        coverage_min_deg, coverage_max_deg, ticks, updated_at
      ) values (
        ${date}, ${geometry.signature}, ${geometry.baseAltitudeDeg},
        ${geometry.searchRadiusDeg}, ${geometry.widenOffsetsDeg},
        ${geometry.forcedOffsetsDeg}, ${geometry.coverageMinDeg},
        ${geometry.coverageMaxDeg}, 1, now()
      )
      on conflict (date, signature) do update set
        ticks = daily_sweep_geometry.ticks + 1,
        updated_at = now()
    `;
  } catch (error) {
    console.warn('[sweepGeometry] persist failed:', error);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run app/api/cron/update-cameras/lib/sweepGeometry.test.ts`
Expected: PASS, six cases.

- [ ] **Step 6: Call it from the cron**

In `route.ts`, add the import beside the `sweepStats` one:

```ts
import { sweepGeometry, upsertSweepGeometry } from './lib/sweepGeometry';
```

and directly after the existing `await upsertSweepStats(...)` call:

```ts
  // The angles behind the counters just written. Recorded every tick rather
  // than on change, because nothing watches for a change -- masterConfig.ts
  // edits arrive by deploy and the flag flips outside the app entirely.
  await upsertSweepGeometry(new Date(), sweepGeometry(forcedOffsets));
```

- [ ] **Step 7: Run the whole suite, then apply the migration**

Run: `npm run test`
Expected: PASS.

```bash
node scripts/apply-migration.mjs database/migrations/20260902_sweep_geometry.sql
node scripts/apply-migration.mjs database/migrations/20260902_sweep_geometry.sql --apply
```

- [ ] **Step 8: Confirm branch, then commit**

```bash
git rev-parse --abbrev-ref HEAD
git add database/migrations/20260902_sweep_geometry.sql \
        app/api/cron/update-cameras/lib/sweepGeometry.ts \
        app/api/cron/update-cameras/lib/sweepGeometry.test.ts \
        app/api/cron/update-cameras/route.ts
git commit -m "feat(cron): record the ring angles behind each day's counters"
```

---

## Task 7: The digest lines

Spec §5, plus the operator's ask for granularity. Three additions. The existing
per-ring gate-pass clause stays where it is: it is the only thing that
separates widening that adds sunsets from widening that adds cameras the gate
floors.

**Files:**
- Modify: `app/api/cron/update-cameras/lib/dailyDigest.ts` (`formatSweepLine`, around lines 78–135)
- Test: `app/api/cron/update-cameras/lib/dailyDigest.test.ts`

**Interfaces:**
- Consumes: `SweepDigestSummary` with `baseMs`, `escalationMs`,
  `rings[].elapsedMs` (Task 5); `TERMINATOR_SUN_ALTITUDE_DEG`,
  `SEARCH_RADIUS_DEG` (existing config).
- Produces: `sweptAltitudeSpan(rings): { min: number; max: number } | null`,
  exported for its own test.

- [ ] **Step 1: Write the failing tests**

In `dailyDigest.test.ts`:

```ts
describe('sweptAltitudeSpan', () => {
  it('is the base ring alone when nothing escalated', () => {
    expect(sweptAltitudeSpan([ringStat(0)])).toEqual({ min: -24, max: -2 });
  });

  it('reaches golden hour once the day-side ring ran', () => {
    expect(sweptAltitudeSpan([ringStat(0), ringStat(15.75)])).toEqual({
      min: -24,
      max: 13.75,
    });
  });

  it('is null when no ring ran', () => {
    expect(sweptAltitudeSpan([])).toBeNull();
  });
});

describe('formatSweepLine', () => {
  it('prints the swept altitude span in degrees, not ring offsets', () => {
    expect(formatSweepLine(summaryWithDayRing())).toContain('-24° to +14°');
  });

  it('prints the widening bill as seconds and frames, not just boxes', () => {
    const html = formatSweepLine(summaryWithDayRing());
    expect(html).toContain('Widening cost');
    expect(html).toContain('16.0 min/day sweeping');
  });

  it('prints what each ring cost per sunset it delivered', () => {
    // The lever question. A ring that costs twice as many boxes per
    // gate-passed frame as the base ring is the one to narrow or drop, and
    // that ratio is invisible in any total.
    const html = formatSweepLine(summaryWithDayRing());
    expect(html).toContain('per gate-passed');
  });

  it('says nothing about widening cost when nothing escalated', () => {
    expect(formatSweepLine(summaryBaseOnly())).not.toContain('Widening cost');
  });
});
```

Write `ringStat(offsetDeg)`, `summaryWithDayRing()` and `summaryBaseOnly()` as
local helpers in the test file, following the existing fixture style. Give
`summaryWithDayRing()` `escalationMs: 960_000` (16 minutes),
`escalationBoxes: 2880` against `baseBoxes: 2976`, and both rings non-zero
`framesScored` and `framesGatePassed` so the per-ring ratio is computable.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run app/api/cron/update-cameras/lib/dailyDigest.test.ts`
Expected: FAIL — `sweptAltitudeSpan` is not exported.

- [ ] **Step 3: Add the span helper**

In `dailyDigest.ts`, extend the `@/app/lib/masterConfig` import with
`TERMINATOR_SUN_ALTITUDE_DEG`, import `SweepRingStats` alongside the existing
`SweepDigestSummary` import, add `import { coverageSpan } from './sweepGeometry';`,
then add above `formatSweepLine`:

```ts
/**
 * The solar-altitude span yesterday's rings actually gathered from.
 *
 * The digest already prints ring offsets, which say where a ring sits
 * relative to the base ring and nothing about where the sun was. The useful
 * form is the resulting altitude band, because that is what can be read
 * against the measured quality curve: good frames peak at 0 to +6 degrees,
 * and a span whose day edge is -2 never touches it.
 *
 * Shares its arithmetic with sweepGeometry's coverageSpan, which answers the
 * same question about a tick rather than about yesterday.
 */
export function sweptAltitudeSpan(
  rings: SweepRingStats[],
): { min: number; max: number } | null {
  if (rings.length === 0) return null;
  return coverageSpan(
    rings.map((r) => TERMINATOR_SUN_ALTITUDE_DEG + r.offsetDeg),
  );
}

/** `-24° to +14°`. Rounded outward, so the printed band never overstates. */
function formatSpan(span: { min: number; max: number }): string {
  const lo = Math.floor(span.min);
  const hi = Math.ceil(span.max);
  return `${lo}° to ${hi > 0 ? '+' : ''}${hi}°`;
}
```

- [ ] **Step 4: Add the three clauses to `formatSweepLine`**

After the existing `parts.push(...)` for boxes:

```ts
  const span = sweptAltitudeSpan(s.rings);
  if (span) parts.push(`swept ${formatSpan(span)} solar altitude`);
```

After `const lines = [\`Widening: ${parts.join(' · ')}\`];` and before the
`if (s.rings.length > 1)` block:

```ts
  // The bill, in the units that actually have one.
  //
  // Not dollars, deliberately. Windy publishes no price, no rate limit and no
  // quota headers (measured 2026-09-02, see the camera-refresh cost spec), so
  // multiplying boxes by a rate would mean inventing the rate. What widening
  // provably consumes is function wall-clock and scoring work, and both are
  // measured here.
  if (s.escalationMs > 0) {
    const escalationMin = s.escalationMs / 60_000;
    const escalationFrames = s.rings
      .filter((r) => r.offsetDeg !== 0)
      .reduce((sum, r) => sum + r.framesScored, 0);
    lines.push(
      `Widening cost: ${escalationMin.toFixed(1)} min/day sweeping ` +
        `(+${pct(s.escalationMs, s.baseMs)}% on base) · ` +
        `${count(escalationFrames)} extra frames scored`,
    );
  }

  // Cost per result, per ring. The lever line.
  //
  // Totals cannot say which ring to narrow or drop; a ratio can. A ring
  // buying gate-passed frames at several times the base ring's box cost is
  // the one to change, and that stays true whether the bill went up or down.
  // Rings with no gate-passed frames print as "none", not as a division by
  // zero dressed up as a large number.
  const efficiency = s.rings.map((r) => {
    if (r.framesGatePassed === 0) return `${ringLabel(r.offsetDeg)} none`;
    const boxesEach = Math.round(r.boxesAttempted / r.framesGatePassed);
    const secondsEach = r.elapsedMs / r.framesGatePassed / 1000;
    return (
      `${ringLabel(r.offsetDeg)} ${count(boxesEach)} boxes` +
      ` + ${secondsEach.toFixed(1)}s`
    );
  });
  lines.push(`Per gate-passed frame: ${efficiency.join(' · ')}`);
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run app/api/cron/update-cameras/lib/dailyDigest.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite, lint, build**

Run: `npm run test && npm run lint && npm run build`
Expected: all clean. Do not proceed to Task 8 on a red suite.

- [ ] **Step 7: Confirm branch, then commit and open the PR**

```bash
git rev-parse --abbrev-ref HEAD
git add app/api/cron/update-cameras/lib/dailyDigest.ts \
        app/api/cron/update-cameras/lib/dailyDigest.test.ts
git commit -m "feat(digest): swept altitude span, the widening bill, and cost per sunset"
git push
```

Open the PR. Body must state: the switch defaults off, sweep behaviour is
unchanged until it is flipped, all three migrations are already applied, and
the measurement window has not started.

---

## Task 8: The bounded measurement window

No checkout needed beyond reading. This is the task that spends money.

- [ ] **Step 1: Capture the baseline before spending anything**

The sweep landed in production on 2026-09-02 (PR #112), so there are already
rows. Confirm they are real, because every write in this path swallows its own
errors and an unapplied migration looks exactly like a quiet day.

```bash
node scripts/set-runtime-flag.mjs
```
Expected: `sweep_force_day_ring = false`.

Then read the last four days. Write the query to a file first, then run it
however you normally reach Neon:

```sql
SELECT date, sweep_ticks, sweep_escalated_ticks, sweep_budget_exhausted_ticks,
       sweep_base_boxes, sweep_escalation_boxes,
       sweep_base_ms, sweep_escalation_ms
FROM daily_sunset_stats
WHERE date >= CURRENT_DATE - 4 ORDER BY date;
```

Also capture the Neon side, which is where the dollars actually are:

```sql
SELECT day, project_id, compute_time_s
FROM provider_usage_daily
WHERE day >= CURRENT_DATE - 8 ORDER BY day;
```

**Record both in the report before flipping anything.** Without a baseline
there is nothing to compare against, and the whole window is wasted.

A first baseline was already captured on 2026-09-02/03 and is in the SDD
ledger; re-run these to extend it to the day of the flip.

- [ ] **Step 1b: Gate on the empty-box share before flipping**

Compute `boxes_empty / boxes_attempted` per day from
`daily_sweep_ring_stats`. The captured baseline shows it rising: 27% on
2026-09-02 and 38% on 2026-09-03, while `new_webcams` fell from 40,042 to
37,198. The sweep-telemetry migration names exactly that pattern as "the
signature of an undiscovered Windy quota ceiling."

Two days is not a trend, but it is the wrong direction in which to double
call volume. **If the share is still climbing across three consecutive days,
do not flip.** Report that instead: a pre-existing ceiling problem is a bigger
finding than the widening question, and doubling the call rate into it would
confound both.

- [ ] **Step 2: Log the change on the cost timeline**

`cost_events` is what annotates the Ops chart and rides in the digest. It is
the existing record of "what we changed and when", and this change belongs on
it beside the June and July entries. Write the row to a file, then apply it:

```sql
INSERT INTO cost_events (occurred_on, sha, description)
VALUES (CURRENT_DATE, NULL,
  'sweep_force_day_ring ON: day-side ring (+15.75, ~+2.75 deg solar altitude) forced on both feeds every tick; pool -24..-2 becomes -24..+14');
```

Add the matching OFF row on the day of Step 5. Two rows, not one, so the
window has both edges on the chart.

- [ ] **Step 3: Flip the switch**

```bash
node scripts/set-runtime-flag.mjs sweep_force_day_ring on
node scripts/set-runtime-flag.mjs sweep_force_day_ring on --apply
```

Verify on the next tick:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  https://<prod-host>/api/cron/update-cameras | jq '.forcedDayRing, .sweep.rings'
```
Expected: `true`, and two ring entries, offsets `0` and `15.75`, the second
with `feedsSwept: ["sunrise","sunset"]`.

If `CRON_SECRET` is not pullable, read `forcedDayRing` from the Vercel function
logs instead: it is in the `🛰️ terminator sweep:` line.

**Expected magnitude, measured 2026-09-02/03, not assumed.** The base ring is
exactly 30.0 boxes per tick. The tick rate is **not** the cron's 96/day:
`/api/kiosk/tick` re-invokes this same handler in-process whenever a gallery
screen is visible, throttled near one per minute by a Redis lock. Measured
sweep ticks were 352 and 365 per day, giving ~10,700 boxes/day. A forced day
ring on both feeds roughly doubles per-tick boxes.

| | measured baseline | forced, at observed tick rate | forced, screens on all day |
| --- | --- | --- | --- |
| ticks/day | 352–365 | 352–365 | up to ~1,536 |
| boxes/day | ~10,700 | ~21,400 | ~92,000 |

**The right-hand column is the risk.** The camera-refresh cost spec names
22,300 calls/day as the most likely way to discover a Windy rate limit, and
says discovering it makes panels *blanker* — the outcome this feature exists
to prevent. Windy publishes no quota headers, so there is no warning before
the wall. Cost here scales with **kiosk uptime**, not with the cron schedule,
and a show is exactly when screens run all day.

A half-ring takes roughly 5–7 seconds, so a full forced ring adds 10–14
seconds to a base sweep of similar length, against a 25-second budget.
**Budget exhaustion becoming common is a finding, not a bug.** It is spec §3
question 2 answering itself, and the strongest argument for a narrower offset
in phase 2.

- [ ] **Step 4: Check the cost daily, and abort if it breaches**

Once a day, not once at the end. Read the digest email, or:

```bash
node scripts/usage-report.mjs
```

Two indicators, and the leading one matters more.

**Leading — Windy boxes per day.** Visible within hours, and it is the one
that can break the product rather than the budget. Read it as
`sweep_base_boxes + sweep_escalation_boxes` for today.

| reading | action |
| --- | --- |
| under 18,000/day | continue |
| 18,000–22,000/day | continue, check twice daily, and watch the empty-box share |
| above 22,000/day, or empty-box share rising while `new_webcams` falls | **turn the switch off immediately.** That pair is the documented signature of a Windy quota ceiling, and the failure mode empties the panels |

**Lagging — dollars per day**, from the digest or `node scripts/usage-report.mjs`.

| reading | action |
| --- | --- |
| up to $2.60/day | continue, inside the approved band |
| $2.60–3.30/day | continue but note it; top of the band |
| above $3.30/day sustained for two days | turn the switch off, then finish the report from what was collected |

The band is the operator's: the bill sits near $0.64/day now (measured
2026-09-03: 3.92 CU-hr sunset + 0.67 CU-hr nwac at $0.14/CU-hr) and used to
sit at $80–100/month. Anywhere between is acceptable; above the old rate is
not.

- [ ] **Step 5: Run for three full UTC days, then stop**

Three, because the digest reads `CURRENT_DATE - 1` and the terminator's land
coverage varies day to day.

```bash
node scripts/set-runtime-flag.mjs sweep_force_day_ring off --apply
```

Then add the OFF row to `cost_events`, matching Step 2.

Turn it off even if the numbers look good. Phase 2 turns it back on
deliberately, from a decision, with a chosen configuration.

- [ ] **Step 6: Answer the three questions in a report**

Create `docs/superpowers/plans/2026-09-02-terminator-pool-coverage-phase1-REPORT.md`.
Open it with the geometry table, because everything else is only readable
through it:

```sql
SELECT date, signature, base_altitude_deg, search_radius_deg,
       forced_offsets_deg, coverage_min_deg, coverage_max_deg, ticks
FROM daily_sweep_geometry ORDER BY date, signature;
```

State plainly what the pool covered before and what it covered during: −24° to
−2° becoming −24° to +14°. Then one section per spec §3 question.

1. **Yield that survives scoring.** From `daily_sweep_ring_stats`:
   `frames_gate_passed / frames_scored` for `offset_deg = 15.75` against
   `offset_deg = 0`. The failure mode is self-concealing — a ring that adds
   cameras the gate then floors reads as success in both the escalation count
   and the new-camera count — so this ratio is the answer and `new_webcams` is
   not. Say whether the day ring's rate is comparable to base, materially
   worse, or too small a sample to call.
2. **Sweep budget.** `sweep_budget_exhausted_ticks / sweep_ticks`, plus
   `sweep_base_ms + sweep_escalation_ms` per tick against the 25,000 ms budget
   and the 50,000 ms tick deadline. Report the per-tick mean and the worst day.
3. **Cost, and the levers.** This is the section the operator actually needs.
   - `sweep_escalation_boxes` against the ~2,980/day baseline, and
     `sweep_escalation_ms` as minutes per day.
   - **Boxes per gate-passed frame and sweep-seconds per gate-passed frame,
     per ring.** The whole point: a ring costing several times the base ring's
     rate per delivered sunset is the one to narrow or drop.
   - **The Neon delta.** `provider_usage_daily` compute across the forced days
     against the baseline days. This measures the cron's share of Neon compute
     directly, which is one of the two numbers the camera-refresh cost spec
     names as missing, and it is what turns every ratio above into dollars.
   - **The function's wall-clock duration** from the Vercel function logs,
     distribution and not just mean. That is the other missing number.

Close with an explicit recommendation among the three phase-2 options in spec
§7 step 4: always-on, conditional, or a narrower offset. Recommend, do not
enumerate. If a narrower offset looks right, name the offset and say what it
would put the ring altitude at, because the next person will otherwise have to
redo the arithmetic.

- [ ] **Step 7: Commit the report and leave the checkout on main**

```bash
git rev-parse --abbrev-ref HEAD
git add docs/superpowers/plans/2026-09-02-terminator-pool-coverage-phase1-REPORT.md
git commit -m "docs(sweep): phase 1 measurement results"
git checkout main
```

Several sessions share this checkout. Whoever takes it, returns it.

---

## What phase 2 is, and why it is not in this plan

Spec §7 steps 4–6. Phase 2 chooses always-on, conditional, or a narrower
offset; it does not need a new coverage constant (Task 1 shipped one that is
correct for any ring set); and it converts the per-ring ratios into dollars
using the Neon delta and function duration Task 8 measures.

It is deliberately not written here. The spec says the final choice is
deferred until the measurement reports, and a task list that pre-commits to one
of three outcomes would be a plan pretending to be a measurement. Write the
phase 2 plan when the report exists.
