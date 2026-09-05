# Solo Kiosk Phase 1 (Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-owned bins per feed, a pure five-rule ordering engine, cron admission and removal, and the two endpoints the solo kiosk and its studio will read.

**Architecture:** Bin entries are archive frames (`webcam_snapshots` rows) in a new `kiosk_bin_entries` table, written only by the cron (admission, zone removal) and by the kiosk's `advance` call (tally). A pure engine in `app/lib/solo/engine.ts` decides the next frame; `project()` is the same engine run forward so the studio's "next up" column is what the glass will do. Screens stagger by reading the wall clock, `app/lib/solo/schedule.ts`, and the `advance` endpoint is idempotent on the slot index. Dials live in a `solo` settings namespace that rides the existing studio/live profile machinery.

**Tech Stack:** Next.js route handlers, Neon serverless `sql` tag, Vitest (`// @vitest-environment node` for server files), SunCalc, the existing settings schema helpers.

**Spec:** `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md` (§4 rules, §5 data, §6.1 endpoints, §6.2 schedule, §9 tests).

## Global Constraints

- Every `--apply` of a migration is production; the plan never applies one. The operator applies `20260904_kiosk_bins.sql` before the PR merges (CLAUDE.md "Apply before merging the code that reads the column").
- Stage explicit paths, never `git add -A`. Verify the branch is `feat/solo-kiosk` in the same command as every commit.
- Push after every commit.
- Server-only modules start with `import 'server-only'`; their tests start with `// @vitest-environment node`.
- Cron floors are fixed: sunset bin = `binaryIsSunset === true`; non-sunset bin = `binaryRawScore >= 0.20`. Dials only narrow.
- The engine is pure. No `Date.now()`, no I/O, no module state inside `app/lib/solo/engine.ts` or `schedule.ts`.
- Detection is the raw binary probability in [0,1] everywhere in this mode. Quality is `ai_regression_score × calibration_multiplier`.
- One deviation from the spec's §5.2 table: `kiosk_screen_state` has no `last_snapshot_id`. Rule 4's "not the frame on glass" reads `current_snapshot_id`, which is the same fact.
- Run `npm run test -- <path>` for a single file and `npm run test -- --run` for the suite; `npm run lint` before each commit.

---

## File structure

| path | responsibility |
|---|---|
| `database/migrations/20260904_kiosk_bins.sql` | two tables + the intake constraint |
| `app/lib/solo/types.ts` | `Feed`, `BinKind`, `BinEntry`, `SoloDials`, `ScreenState` |
| `app/lib/solo/settingsSchema.ts` (+ test) | `SOLO_SETTINGS_SCHEMA`, `SOLO_NAMESPACE`, `dialsFrom()` |
| `app/lib/solo/engine.ts` (+ test) | rules 1–5: `isEligible`, `tierOf`, `rankScore`, `next`, `afterShowing`, `project` |
| `app/lib/solo/schedule.ts` (+ test) | `slotFor`, `boundaryMs`, `nextBoundaryMs` |
| `app/lib/solo/zone.ts` (+ test) | `sunAltitudeDeg`, `feedAt`, `inFeedZone` |
| `app/lib/solo/store.ts` (+ test) | every SQL touch of the two new tables |
| `app/api/cron/update-cameras/lib/binAdmission.ts` (+ test) | `decideBin`, `enterBins`, `maintainBins` |
| `app/api/cron/update-cameras/route.ts` | wire admission + maintenance into the tick |
| `app/api/cron/update-cameras/route.test.ts` | mock the new lib |
| `app/api/cron/update-cameras/lib/dbOperations.ts` | `intakeReason` union gains `'kiosk_bin'` |
| `app/api/cron/update-cameras/lib/dailyDigest.ts` (+ test) | `formatBinLine` |
| `app/components/mosaic/registry.ts` | register the `solo` schema |
| `app/api/kiosk/solo/state/route.ts` (+ test) | GET state for one feed |
| `app/api/kiosk/solo/advance/route.ts` (+ test) | POST advance, idempotent on slot |
| `vercel.json` | cron `*/10` |

---

### Task 1: Migration

**Files:**
- Create: `database/migrations/20260904_kiosk_bins.sql`

**Interfaces:**
- Produces: tables `kiosk_bin_entries`, `kiosk_screen_state`; `webcam_snapshots.intake_reason` accepts `'kiosk_bin'`.

- [ ] **Step 1: Write the migration**

```sql
-- Solo kiosk bins (spec: docs/superpowers/specs/2026-09-04-solo-kiosk-design.md §5).
--
-- kiosk_bin_entries: one row per (feed, archived frame) waiting to be shown on
-- the solo kiosk, or shown and waiting to be shown again. Written by the cron
-- (admission, zone removal) and by POST /api/kiosk/solo/advance (tally).
-- Removed rows stay for 48 h so the studio can show what left and why.
--
-- kiosk_screen_state: two rows, what each screen is drawing right now and the
-- schedule slot it was drawn for, so a second advance in the same slot is a
-- no-op.
--
-- Forward-only, idempotent. Apply manually via:
--   node scripts/apply-migration.mjs database/migrations/20260904_kiosk_bins.sql
--   node scripts/apply-migration.mjs database/migrations/20260904_kiosk_bins.sql --apply

CREATE TABLE IF NOT EXISTS kiosk_bin_entries (
  id                 BIGSERIAL PRIMARY KEY,
  feed               TEXT NOT NULL CHECK (feed IN ('sunrise', 'sunset')),
  bin                TEXT NOT NULL CHECK (bin IN ('sunset', 'non_sunset')),
  snapshot_id        BIGINT NOT NULL REFERENCES webcam_snapshots(id) ON DELETE CASCADE,
  webcam_id          INTEGER NOT NULL REFERENCES webcams(id) ON DELETE CASCADE,
  quality            REAL,
  detection          REAL NOT NULL,
  is_new             BOOLEAN NOT NULL DEFAULT false,
  tally              INTEGER NOT NULL DEFAULT 0,
  entered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_shown_at     TIMESTAMPTZ,
  last_shown_at      TIMESTAMPTZ,
  out_of_zone_polls  INTEGER NOT NULL DEFAULT 0,
  removed_at         TIMESTAMPTZ,
  removed_reason     TEXT CHECK (removed_reason IN ('left_zone', 'expired', 'manual')),
  UNIQUE (feed, snapshot_id)
);

CREATE INDEX IF NOT EXISTS kiosk_bin_entries_active_idx
  ON kiosk_bin_entries (feed, bin) WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS kiosk_bin_entries_entered_idx
  ON kiosk_bin_entries (entered_at);

CREATE TABLE IF NOT EXISTS kiosk_screen_state (
  feed                 TEXT PRIMARY KEY CHECK (feed IN ('sunrise', 'sunset')),
  current_snapshot_id  BIGINT REFERENCES webcam_snapshots(id) ON DELETE SET NULL,
  shown_since          TIMESTAMPTZ,
  slot                 BIGINT,
  sunset_streak        INTEGER NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE webcam_snapshots
  DROP CONSTRAINT IF EXISTS webcam_snapshots_intake_reason_check;

ALTER TABLE webcam_snapshots
  ADD CONSTRAINT webcam_snapshots_intake_reason_check
  CHECK (intake_reason IN (
    'disagreement', 'high_rated', 'trickle', 'all_rated', 'scene_capture',
    'operator_label', 'kiosk_bin'
  ));
```

- [ ] **Step 2: Dry-run it (prints statements, applies nothing)**

Run: `node scripts/apply-migration.mjs database/migrations/20260904_kiosk_bins.sql`
Expected: the six statements listed, no error, nothing applied.

- [ ] **Step 3: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && git add database/migrations/20260904_kiosk_bins.sql && git commit -m "feat(solo): kiosk_bin_entries + kiosk_screen_state tables" && git push
```

---

### Task 2: Types and settings schema

**Files:**
- Create: `app/lib/solo/types.ts`
- Create: `app/lib/solo/settingsSchema.ts`
- Test: `app/lib/solo/settingsSchema.test.ts`
- Modify: `app/components/mosaic/registry.ts:27-33`

**Interfaces:**
- Produces:
  - `type Feed = 'sunrise' | 'sunset'`, `type BinKind = 'sunset' | 'non_sunset'`
  - `interface BinEntry { snapshotId: number; webcamId: number; bin: BinKind; quality: number | null; detection: number; isNew: boolean; tally: number; enteredAt: number }`
  - `interface SoloDials { qualityFloor; detectionFloor; sunsetFloor; mix; repeatAllowance; promoteNew; zoneGrace; dwellS; offsetS; fadeS; showPlace; showScores; showRank; showTally }`
  - `interface ScreenState { lastSnapshotId: number | null; sunsetStreak: number }`
  - `SOLO_NAMESPACE = 'solo'`, `SOLO_SETTINGS_SCHEMA: SettingsSchema`, `dialsFrom(values: SettingsValues): SoloDials`

- [ ] **Step 1: Write `app/lib/solo/types.ts`**

```ts
export type Feed = 'sunrise' | 'sunset';
export type BinKind = 'sunset' | 'non_sunset';

/**
 * One archived frame waiting in a bin. The unit of the solo kiosk: a camera
 * is only a grouping (spec §2, §3).
 */
export interface BinEntry {
  snapshotId: number;
  webcamId: number;
  bin: BinKind;
  /** ai_regression_score × calibration_multiplier. Null on non-sunset rows. */
  quality: number | null;
  /** ai_binary_score, the raw sunset probability in [0,1]. Never calibrated. */
  detection: number;
  /** Arrived while an older frame from the same camera was already in the bin. */
  isNew: boolean;
  /** Times this frame has been on glass. */
  tally: number;
  /** ms since epoch. Tie-breaker after score. */
  enteredAt: number;
}

/** Every dial in the `solo` namespace, typed. Built by settingsSchema.dialsFrom. */
export interface SoloDials {
  // bins group — change which frame comes next
  qualityFloor: number;
  detectionFloor: number;
  sunsetFloor: number;
  mix: number;
  repeatAllowance: number;
  promoteNew: boolean;
  zoneGrace: number;
  // glass group — change what the screen draws
  dwellS: number;
  offsetS: number;
  fadeS: number;
  showPlace: boolean;
  showScores: boolean;
  showRank: boolean;
  showTally: boolean;
}

/** What one screen remembers between draws (rules 2 and 4). */
export interface ScreenState {
  /** The frame on glass now. Never drawn again immediately (rule 4). */
  lastSnapshotId: number | null;
  /** Consecutive sunset-bin draws since the last non-sunset draw (rule 2). */
  sunsetStreak: number;
}
```

- [ ] **Step 2: Write the failing schema test**

```ts
// app/lib/solo/settingsSchema.test.ts
import { describe, it, expect } from 'vitest';
import { SOLO_SETTINGS_SCHEMA, SOLO_NAMESPACE, dialsFrom } from './settingsSchema';
import { schemaDefaults, mergeSettings } from '@/app/lib/settings/schema';

describe('SOLO_SETTINGS_SCHEMA', () => {
  it('is namespaced solo', () => {
    expect(SOLO_NAMESPACE).toBe('solo');
  });

  it('defaults match the spec', () => {
    const d = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
    expect(d).toEqual({
      qualityFloor: 0.55, detectionFloor: 0.3, sunsetFloor: 6, mix: 2,
      repeatAllowance: 1, promoteNew: true, zoneGrace: 2,
      dwellS: 20, offsetS: 10, fadeS: 0,
      showPlace: true, showScores: false, showRank: false, showTally: false,
    });
  });

  it('every knob sits in the glass or bins section', () => {
    for (const knob of SOLO_SETTINGS_SCHEMA) {
      expect(['glass', 'bins']).toContain(knob.section);
    }
  });

  it('dialsFrom reads merged deviations', () => {
    const merged = mergeSettings(SOLO_SETTINGS_SCHEMA, { repeatAllowance: 3, dwellS: 5 });
    const d = dialsFrom(merged);
    expect(d.repeatAllowance).toBe(3);
    expect(d.dwellS).toBe(5);
    expect(d.mix).toBe(2);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npm run test -- app/lib/solo/settingsSchema.test.ts`
Expected: FAIL, cannot resolve `./settingsSchema`.

- [ ] **Step 4: Write `app/lib/solo/settingsSchema.ts`**

```ts
import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type { SoloDials } from './types';

export const SOLO_NAMESPACE = 'solo';

/**
 * Every solo dial. Two sections, and the studio colours them differently:
 * 'glass' changes what the screen draws, 'bins' changes which frame comes
 * next (spec §6.4). Defaults ARE the behaviour with no settings row.
 */
export const SOLO_SETTINGS_SCHEMA: SettingsSchema = [
  // ---- glass ----
  {
    key: 'dwellS', kind: 'number', min: 5, max: 60, step: 1, default: 20,
    label: 'dwell (s)', section: 'glass',
    description: 'How long a frame stays on one screen.',
  },
  {
    key: 'offsetS', kind: 'number', min: 0, max: 30, step: 1, default: 10,
    label: 'offset (s)', section: 'glass',
    description: 'How far the sunset clock runs behind the sunrise clock, so the two screens never change together.',
  },
  {
    key: 'fadeS', kind: 'number', min: 0, max: 10, step: 0.5, default: 0,
    label: 'fade (s)', section: 'glass',
    description: 'Crossfade at each change. 0 is a hard cut.',
  },
  {
    key: 'showPlace', kind: 'boolean', default: true,
    label: 'place + country', section: 'glass',
    description: 'Caption the frame with the camera name, region and country.',
  },
  {
    key: 'showScores', kind: 'boolean', default: false,
    label: 'scores', section: 'glass',
    description: 'Show q (quality 0–1) and d (detection probability 0–1) on glass.',
  },
  {
    key: 'showRank', kind: 'boolean', default: false,
    label: 'bin rank', section: 'glass',
    description: 'Show where this frame sits in its bin.',
  },
  {
    key: 'showTally', kind: 'boolean', default: false,
    label: 'shown tally', section: 'glass',
    description: 'Show how many times this frame has been on glass.',
  },
  // ---- bins ----
  {
    key: 'qualityFloor', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.55,
    label: 'quality floor (sunsets)', section: 'bins',
    description: 'A sunset-bin frame needs at least this quality to be eligible.',
  },
  {
    key: 'detectionFloor', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.3,
    label: 'detection floor (non-sunsets)', section: 'bins',
    description: 'A non-sunset frame needs at least this detection probability to be eligible. Raise it to shrink that bin.',
  },
  {
    key: 'sunsetFloor', kind: 'number', min: 0, max: 12, step: 1, default: 6,
    label: 'sunset floor', section: 'bins',
    description: 'While at least this many sunsets wait in the current tier, the queue is sunsets only. 0 = non-sunsets only when no sunset is eligible.',
  },
  {
    key: 'mix', kind: 'number', min: 1, max: 6, step: 1, default: 2,
    label: 'mix (sunsets per non-sunset)', section: 'bins',
    description: 'Below the sunset floor: this many sunsets between each non-sunset.',
  },
  {
    key: 'repeatAllowance', kind: 'number', min: 0, max: 3, step: 1, default: 1,
    label: 'sunset repeat allowance', section: 'bins',
    description: 'Extra showings a sunset gets before an unshown non-sunset outranks it. 0 = strict variety.',
  },
  {
    key: 'zoneGrace', kind: 'number', min: 0, max: 5, step: 1, default: 2,
    label: 'zone grace (pulls)', section: 'bins',
    description: 'A camera outside the sweep zone stays in the bins for this many cron pulls before its frames are removed.',
  },
  {
    key: 'promoteNew', kind: 'boolean', default: true,
    label: 'promote new frames', section: 'bins',
    description: 'A newer frame from a camera already in the bin gets +0.10 on its score until first shown.',
  },
] as const;

/** Typed view of a merged `solo` values object (mergeSettings output). */
export function dialsFrom(values: SettingsValues): SoloDials {
  return {
    qualityFloor: values.qualityFloor as number,
    detectionFloor: values.detectionFloor as number,
    sunsetFloor: values.sunsetFloor as number,
    mix: values.mix as number,
    repeatAllowance: values.repeatAllowance as number,
    promoteNew: values.promoteNew as boolean,
    zoneGrace: values.zoneGrace as number,
    dwellS: values.dwellS as number,
    offsetS: values.offsetS as number,
    fadeS: values.fadeS as number,
    showPlace: values.showPlace as boolean,
    showScores: values.showScores as boolean,
    showRank: values.showRank as boolean,
    showTally: values.showTally as boolean,
  };
}
```

- [ ] **Step 5: Register the schema**

In `app/components/mosaic/registry.ts`, add the import and the entry:

```ts
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
// ...
export const MOSAIC_SETTINGS_SCHEMAS: Record<string, SettingsSchema> = {
  v1: V1_SETTINGS_SCHEMA,
  v2: V2_SETTINGS_SCHEMA,
  v3: V3_SETTINGS_SCHEMA,
  v4: V4_SETTINGS_SCHEMA,
  // Phase 1 of the solo kiosk registers the namespace so PATCH /api/kiosk/settings
  // accepts its dials; the renderer joins MOSAIC_VERSIONS in phase 2.
  solo: SOLO_SETTINGS_SCHEMA,
};
```

`MOSAIC_VERSIONS` is untouched, so `activeVersion` cannot select `solo` yet.

- [ ] **Step 6: Run tests**

Run: `npm run test -- app/lib/solo app/components/mosaic/registry.test.tsx app/studio`
Expected: PASS. (`useStudioSettings` builds `KNOWN_NAMESPACES` from the schema map, so `solo` is now a known namespace with zero deviations.)

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && git add app/lib/solo/types.ts app/lib/solo/settingsSchema.ts app/lib/solo/settingsSchema.test.ts app/components/mosaic/registry.ts && git commit -m "feat(solo): types + solo settings namespace" && git push
```

---

### Task 3: The rule engine

**Files:**
- Create: `app/lib/solo/engine.ts`
- Test: `app/lib/solo/engine.test.ts`

**Interfaces:**
- Consumes: `BinEntry`, `SoloDials`, `ScreenState` from Task 2.
- Produces:
  - `NEW_FRAME_BONUS = 0.1`
  - `isEligible(e: BinEntry, d: SoloDials): boolean`
  - `tierOf(e, d): number`
  - `rankScore(e, d): number`
  - `next(entries: BinEntry[], d: SoloDials, state: ScreenState): BinEntry | null`
  - `afterShowing(e: BinEntry, state: ScreenState): ScreenState`
  - `project(entries, d, state, n: number): BinEntry[]` — n draws forward, no mutation of inputs

- [ ] **Step 1: Write the failing tests**

```ts
// app/lib/solo/engine.test.ts
import { describe, it, expect } from 'vitest';
import { next, project, isEligible, tierOf, afterShowing } from './engine';
import type { BinEntry, SoloDials, ScreenState } from './types';

const D: SoloDials = {
  qualityFloor: 0.55, detectionFloor: 0.3, sunsetFloor: 6, mix: 2,
  repeatAllowance: 1, promoteNew: true, zoneGrace: 2,
  dwellS: 20, offsetS: 10, fadeS: 0,
  showPlace: true, showScores: false, showRank: false, showTally: false,
};
const S0: ScreenState = { lastSnapshotId: null, sunsetStreak: 0 };

function sun(id: number, q: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 1000 + id, bin: 'sunset', quality: q, detection: 0.9,
    isNew: false, tally: 0, enteredAt: id, ...extra };
}
function non(id: number, det: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 2000 + id, bin: 'non_sunset', quality: null, detection: det,
    isNew: false, tally: 0, enteredAt: id, ...extra };
}
/** N1..N8 with descending detection so their order is deterministic. */
const eightNon = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => non(100 + i, 0.6 - i * 0.02));
const seq = (entries: BinEntry[], d: SoloDials, n = 12) =>
  project(entries, d, S0, n).map((e) => (e.bin === 'sunset' ? 'S' : `N${e.snapshotId - 100}`));

describe('thin night: one sunset, eight non-sunsets (spec §4 worked case)', () => {
  it('allowance 1 (default): S N1 S N2 … N8 S N1', () => {
    expect(seq([sun(1, 0.97), ...eightNon()], D)).toEqual(
      ['S', 'N1', 'S', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'S', 'N1']);
  });
  it('allowance 0: strict variety, sunset every 9th slot', () => {
    expect(seq([sun(1, 0.97), ...eightNon()], { ...D, repeatAllowance: 0 })).toEqual(
      ['S', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'S', 'N1', 'N2']);
  });
  it('allowance 2: alternates, then variety', () => {
    expect(seq([sun(1, 0.97), ...eightNon()], { ...D, repeatAllowance: 2 })).toEqual(
      ['S', 'N1', 'S', 'N2', 'S', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'S']);
  });
});

describe('rule 2: sunset floor and mix', () => {
  it('sunsets only while the tier holds at least sunsetFloor sunsets', () => {
    const sunsets = [1, 2, 3, 4, 5, 6, 7].map((i) => sun(i, 0.9 - i * 0.01));
    const out = project([...sunsets, ...eightNon()], D, S0, 7).map((e) => e.bin);
    // 7 sunsets ≥ floor 6 for the first draw; after one is shown, 6 remain ≥ 6; then 5 < 6 → mix kicks in.
    expect(out.slice(0, 2)).toEqual(['sunset', 'sunset']);
    expect(out).toContain('non_sunset');
  });
  it('below the floor, mix=2 gives two sunsets then a non-sunset', () => {
    const entries = [sun(1, 0.9), sun(2, 0.8), sun(3, 0.7), ...eightNon()];
    const out = project(entries, D, S0, 4).map((e) => e.bin);
    expect(out).toEqual(['sunset', 'sunset', 'non_sunset', 'sunset']);
  });
  it('sunsetFloor 0 never draws a non-sunset while a sunset is eligible', () => {
    const entries = [sun(1, 0.9), sun(2, 0.8), ...eightNon()];
    const out = project(entries, { ...D, sunsetFloor: 0 }, S0, 6).map((e) => e.bin);
    expect(out).toEqual(['sunset', 'sunset', 'sunset', 'sunset', 'sunset', 'sunset']);
  });
  it('an empty sunset bin draws non-sunsets', () => {
    expect(next(eightNon(), D, S0)?.snapshotId).toBe(101);
  });
});

describe('rule 3: within a bin', () => {
  it('sunsets by quality, non-sunsets by detection', () => {
    expect(next([sun(1, 0.7), sun(2, 0.9)], D, S0)?.snapshotId).toBe(2);
    expect(next([non(1, 0.4), non(2, 0.5)], D, S0)?.snapshotId).toBe(2);
  });
  it('promoteNew adds 0.10 and only while isNew', () => {
    const entries = [sun(1, 0.9), sun(2, 0.85, { isNew: true })];
    expect(next(entries, D, S0)?.snapshotId).toBe(2);
    expect(next(entries, { ...D, promoteNew: false }, S0)?.snapshotId).toBe(1);
    const [first, second] = project(entries, D, S0, 2);
    expect(first.snapshotId).toBe(2);
    expect(second.snapshotId).toBe(1);
  });
  it('ties break by lower tally, then earlier enteredAt', () => {
    expect(next([sun(1, 0.9, { tally: 1 }), sun(2, 0.9, { tally: 0, enteredAt: 5 })], { ...D, repeatAllowance: 5 }, S0)?.snapshotId).toBe(2);
    expect(next([sun(1, 0.9, { enteredAt: 9 }), sun(2, 0.9, { enteredAt: 3 })], D, S0)?.snapshotId).toBe(2);
  });
});

describe('rule 4: never twice in a row', () => {
  it('skips the frame on glass', () => {
    expect(next([sun(1, 0.9), sun(2, 0.5)], D, { lastSnapshotId: 1, sunsetStreak: 1 })?.snapshotId).toBe(2);
  });
  it('repeats when it is the only eligible frame', () => {
    expect(next([sun(1, 0.9)], D, { lastSnapshotId: 1, sunsetStreak: 1 })?.snapshotId).toBe(1);
  });
});

describe('rule 5: floors', () => {
  it('a sunset below qualityFloor is ineligible; a non-sunset below detectionFloor is ineligible', () => {
    expect(isEligible(sun(1, 0.5), D)).toBe(false);
    expect(isEligible(sun(1, 0.55), D)).toBe(true);
    expect(isEligible(non(1, 0.29), D)).toBe(false);
    expect(isEligible(non(1, 0.3), D)).toBe(true);
  });
  it('returns null when nothing is eligible', () => {
    expect(next([sun(1, 0.1), non(2, 0.1)], D, S0)).toBeNull();
  });
});

describe('tiers and state', () => {
  it('tierOf subtracts the allowance for sunsets only, floored at 0', () => {
    expect(tierOf(sun(1, 0.9, { tally: 0 }), D)).toBe(0);
    expect(tierOf(sun(1, 0.9, { tally: 3 }), D)).toBe(2);
    expect(tierOf(non(1, 0.5, { tally: 3 }), D)).toBe(3);
  });
  it('afterShowing tracks the streak and the frame on glass', () => {
    expect(afterShowing(sun(1, 0.9), S0)).toEqual({ lastSnapshotId: 1, sunsetStreak: 1 });
    expect(afterShowing(non(2, 0.5), { lastSnapshotId: 1, sunsetStreak: 2 })).toEqual({ lastSnapshotId: 2, sunsetStreak: 0 });
  });
  it('project does not mutate its inputs', () => {
    const entries = [sun(1, 0.9), non(2, 0.5)];
    project(entries, D, S0, 5);
    expect(entries[0].tally).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm run test -- app/lib/solo/engine.test.ts`
Expected: FAIL, cannot resolve `./engine`.

- [ ] **Step 3: Write `app/lib/solo/engine.ts`**

```ts
import type { BinEntry, ScreenState, SoloDials } from './types';

/**
 * The solo kiosk's ordering rules, spec §4, as a pure function. No clock, no
 * I/O, no module state: memory across draws is the ScreenState argument, and
 * the tally lives on the entries the caller passes in. The studio runs
 * `project()` with the studio profile's dials to show what the glass will do;
 * the advance endpoint runs `next()` with the live profile's.
 */

/** Rule 3: a frame that arrived while its camera was already in the bin. */
export const NEW_FRAME_BONUS = 0.1;

/** Rule 5. */
export function isEligible(e: BinEntry, d: SoloDials): boolean {
  return e.bin === 'sunset'
    ? (e.quality ?? -1) >= d.qualityFloor
    : e.detection >= d.detectionFloor;
}

/** Rule 1: the first sort key across both bins. */
export function tierOf(e: BinEntry, d: SoloDials): number {
  return e.bin === 'sunset' ? Math.max(0, e.tally - d.repeatAllowance) : e.tally;
}

/** Rule 3: quality for sunsets, detection for non-sunsets, plus the new-frame bonus. */
export function rankScore(e: BinEntry, d: SoloDials): number {
  const base = e.bin === 'sunset' ? (e.quality ?? 0) : e.detection;
  return base + (d.promoteNew && e.isNew ? NEW_FRAME_BONUS : 0);
}

function compareWithin(d: SoloDials) {
  return (a: BinEntry, b: BinEntry): number =>
    a.tally - b.tally ||
    rankScore(b, d) - rankScore(a, d) ||
    a.enteredAt - b.enteredAt ||
    a.snapshotId - b.snapshotId;
}

/** The next frame for one screen, or null when nothing is eligible. */
export function next(entries: BinEntry[], d: SoloDials, state: ScreenState): BinEntry | null {
  const eligible = entries.filter((e) => isEligible(e, d));
  // Rule 4. If the frame on glass is the only eligible one, it repeats.
  let candidates = eligible.filter((e) => e.snapshotId !== state.lastSnapshotId);
  if (candidates.length === 0) candidates = eligible;
  if (candidates.length === 0) return null;

  // Rule 1.
  const minTier = Math.min(...candidates.map((e) => tierOf(e, d)));
  const tier = candidates.filter((e) => tierOf(e, d) === minTier);
  const sunsets = tier.filter((e) => e.bin === 'sunset');
  const nonSunsets = tier.filter((e) => e.bin === 'non_sunset');

  // Rule 2.
  let pool: BinEntry[];
  if (nonSunsets.length === 0) pool = sunsets;
  else if (sunsets.length === 0) pool = nonSunsets;
  else if (sunsets.length >= d.sunsetFloor) pool = sunsets;
  else pool = state.sunsetStreak >= d.mix ? nonSunsets : sunsets;

  // Rule 3.
  return [...pool].sort(compareWithin(d))[0];
}

/** The screen's memory after `e` goes on glass. */
export function afterShowing(e: BinEntry, state: ScreenState): ScreenState {
  return {
    lastSnapshotId: e.snapshotId,
    sunsetStreak: e.bin === 'sunset' ? state.sunsetStreak + 1 : 0,
  };
}

/**
 * `n` draws forward from `state`, each applied to a private copy of the
 * entries (tally +1, isNew cleared). The inputs are never mutated. Fewer than
 * `n` entries come back only when nothing is eligible.
 */
export function project(entries: BinEntry[], d: SoloDials, state: ScreenState, n: number): BinEntry[] {
  const working = entries.map((e) => ({ ...e }));
  let s = state;
  const out: BinEntry[] = [];
  for (let i = 0; i < n; i++) {
    const pick = next(working, d, s);
    if (!pick) break;
    out.push({ ...pick });
    pick.tally += 1;
    pick.isNew = false;
    s = afterShowing(pick, s);
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- app/lib/solo/engine.test.ts`
Expected: PASS, all groups. If a thin-night sequence differs, the engine is wrong, not the fixture: the three sequences were traced by hand against these rules in the spec conversation.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && git add app/lib/solo/engine.ts app/lib/solo/engine.test.ts && git commit -m "feat(solo): pure five-rule ordering engine with the spec's worked cases as fixtures" && git push
```

---

### Task 4: Schedule and zone helpers

**Files:**
- Create: `app/lib/solo/schedule.ts`, `app/lib/solo/zone.ts`
- Test: `app/lib/solo/schedule.test.ts`, `app/lib/solo/zone.test.ts`

**Interfaces:**
- Produces:
  - `slotFor(nowMs: number, feed: Feed, dwellS: number, offsetS: number): number`
  - `boundaryMs(slot: number, feed, dwellS, offsetS): number`
  - `nextBoundaryMs(nowMs, feed, dwellS, offsetS): number`
  - `sunAltitudeDeg(at: Date, lat: number, lng: number): number`
  - `feedAt(at: Date, lat, lng): Feed`
  - `interface Zone { minDeg: number; maxDeg: number }`
  - `inFeedZone(at: Date, lat, lng, feed: Feed, zone: Zone): boolean`

- [ ] **Step 1: Write the failing schedule test**

```ts
// app/lib/solo/schedule.test.ts
import { describe, it, expect } from 'vitest';
import { slotFor, boundaryMs, nextBoundaryMs } from './schedule';

describe('schedule (spec §6.2)', () => {
  it('sunrise slots are multiples of dwell on Unix time', () => {
    expect(slotFor(0, 'sunrise', 20, 10)).toBe(0);
    expect(slotFor(19_999, 'sunrise', 20, 10)).toBe(0);
    expect(slotFor(20_000, 'sunrise', 20, 10)).toBe(1);
  });
  it('sunset slots are shifted by the offset', () => {
    expect(slotFor(9_999, 'sunset', 20, 10)).toBe(-1);
    expect(slotFor(10_000, 'sunset', 20, 10)).toBe(0);
    expect(slotFor(30_000, 'sunset', 20, 10)).toBe(1);
  });
  it('boundaryMs inverts slotFor', () => {
    expect(boundaryMs(3, 'sunrise', 20, 10)).toBe(60_000);
    expect(boundaryMs(3, 'sunset', 20, 10)).toBe(70_000);
  });
  it('the two screens never change at the same instant when offset is nonzero', () => {
    for (let t = 0; t < 200_000; t += 1_000) {
      const rise = boundaryMs(slotFor(t, 'sunrise', 20, 10), 'sunrise', 20, 10);
      const set = boundaryMs(slotFor(t, 'sunset', 20, 10), 'sunset', 20, 10);
      expect(rise).not.toBe(set);
    }
  });
  it('nextBoundaryMs is the first boundary strictly after now', () => {
    expect(nextBoundaryMs(20_000, 'sunrise', 20, 10)).toBe(40_000);
    expect(nextBoundaryMs(20_001, 'sunrise', 20, 10)).toBe(40_000);
    expect(nextBoundaryMs(25_000, 'sunset', 20, 10)).toBe(30_000);
  });
});
```

- [ ] **Step 2: Write the failing zone test**

```ts
// app/lib/solo/zone.test.ts
import { describe, it, expect } from 'vitest';
import { sunAltitudeDeg, feedAt, inFeedZone } from './zone';

// Seattle, 2026-09-04. Sunset ~19:40 PDT = 02:40Z on 09-05; sunrise ~06:33 PDT = 13:33Z.
const SEA = { lat: 47.6062, lng: -122.3321 };

describe('zone (spec §5.3)', () => {
  it('altitude is negative at local midnight and positive at local noon', () => {
    expect(sunAltitudeDeg(new Date('2026-09-05T07:00:00Z'), SEA.lat, SEA.lng)).toBeLessThan(0);
    expect(sunAltitudeDeg(new Date('2026-09-04T20:00:00Z'), SEA.lat, SEA.lng)).toBeGreaterThan(0);
  });
  it('feedAt is sunset while the sun is falling and sunrise while it rises', () => {
    expect(feedAt(new Date('2026-09-05T02:30:00Z'), SEA.lat, SEA.lng)).toBe('sunset');
    expect(feedAt(new Date('2026-09-04T13:30:00Z'), SEA.lat, SEA.lng)).toBe('sunrise');
  });
  it('inFeedZone needs both the altitude band and the feed', () => {
    const zone = { minDeg: -24, maxDeg: -2 };
    const dusk = new Date('2026-09-05T03:30:00Z'); // ~50 min after sunset, about -8°
    expect(inFeedZone(dusk, SEA.lat, SEA.lng, 'sunset', zone)).toBe(true);
    expect(inFeedZone(dusk, SEA.lat, SEA.lng, 'sunrise', zone)).toBe(false);
    const noon = new Date('2026-09-04T20:00:00Z');
    expect(inFeedZone(noon, SEA.lat, SEA.lng, 'sunset', zone)).toBe(false);
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npm run test -- app/lib/solo/schedule.test.ts app/lib/solo/zone.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write `app/lib/solo/schedule.ts`**

```ts
import type { Feed } from './types';

/**
 * Two screens, no coordination (spec §6.2). Both read the wall clock: the
 * sunrise screen changes at every multiple of dwell on Unix time, the sunset
 * screen `offset` seconds later. A slot is the index of that boundary, and
 * the advance endpoint is idempotent on it, so a reload or a double-fire
 * lands on the same frame.
 */
function shiftMs(feed: Feed, offsetS: number): number {
  return feed === 'sunset' ? offsetS * 1000 : 0;
}

export function slotFor(nowMs: number, feed: Feed, dwellS: number, offsetS: number): number {
  return Math.floor((nowMs - shiftMs(feed, offsetS)) / (dwellS * 1000));
}

export function boundaryMs(slot: number, feed: Feed, dwellS: number, offsetS: number): number {
  return slot * dwellS * 1000 + shiftMs(feed, offsetS);
}

export function nextBoundaryMs(nowMs: number, feed: Feed, dwellS: number, offsetS: number): number {
  return boundaryMs(slotFor(nowMs, feed, dwellS, offsetS) + 1, feed, dwellS, offsetS);
}
```

- [ ] **Step 5: Write `app/lib/solo/zone.ts`**

```ts
import SunCalc from 'suncalc';
import type { Feed } from './types';

const DEG_PER_RAD = 180 / Math.PI;
const TEN_MINUTES_MS = 10 * 60 * 1000;

/** Solar altitude above the horizon at a place and moment, degrees. Negative below. */
export function sunAltitudeDeg(at: Date, lat: number, lng: number): number {
  return SunCalc.getPosition(at, lat, lng).altitude * DEG_PER_RAD;
}

/** Which feed a place belongs to right now: rising sun is sunrise, falling is sunset. */
export function feedAt(at: Date, lat: number, lng: number): Feed {
  const now = sunAltitudeDeg(at, lat, lng);
  const later = sunAltitudeDeg(new Date(at.getTime() + TEN_MINUTES_MS), lat, lng);
  return later > now ? 'sunrise' : 'sunset';
}

/** The swept altitude band, from sweepGeometry's coverage span. */
export interface Zone {
  minDeg: number;
  maxDeg: number;
}

/**
 * Removal is by zone, not by absence (spec §5.3): a camera is in a feed's zone
 * when its sun sits inside the swept band AND is moving the feed's way.
 */
export function inFeedZone(at: Date, lat: number, lng: number, feed: Feed, zone: Zone): boolean {
  const alt = sunAltitudeDeg(at, lat, lng);
  return alt >= zone.minDeg && alt <= zone.maxDeg && feedAt(at, lat, lng) === feed;
}
```

- [ ] **Step 6: Run tests**

Run: `npm run test -- app/lib/solo/schedule.test.ts app/lib/solo/zone.test.ts`
Expected: PASS. If the dusk altitude assertion fails, print `sunAltitudeDeg(dusk, …)` and move the timestamp so it lands inside −24…−2; the intent is "an hour after sunset", not that exact minute.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && git add app/lib/solo/schedule.ts app/lib/solo/schedule.test.ts app/lib/solo/zone.ts app/lib/solo/zone.test.ts && git commit -m "feat(solo): clock-derived slots and zone membership helpers" && git push
```

---

### Task 5: The store

**Files:**
- Create: `app/lib/solo/store.ts`
- Test: `app/lib/solo/store.test.ts`

**Interfaces:**
- Consumes: `sql` from `@/app/lib/db`; types from Task 2.
- Produces (all `async`, all server-only):
  - `interface StoredEntry extends BinEntry { feed: Feed; imageUrl: string; title: string; city: string; region: string; country: string; lat: number; lng: number; firstShownAt: number | null; lastShownAt: number | null }`
  - `listActiveEntries(feed: Feed): Promise<StoredEntry[]>`
  - `activeWebcamIds(feed: Feed): Promise<Set<number>>`
  - `getCalibrationMultipliers(webcamIds: number[]): Promise<Map<number, number>>`
  - `insertEntry(input: { feed; bin; snapshotId; webcamId; quality: number | null; detection; isNew }): Promise<boolean>` — false when the `(feed, snapshot_id)` row already exists
  - `markSeen(feed, webcamIds: number[]): Promise<void>`
  - `markOutOfZone(feed, webcamIds: number[]): Promise<void>`
  - `removeStale(feed, opts: { grace: number; maxAgeHours: number }): Promise<{ leftZone: number; expired: number }>`
  - `interface ScreenRow { feed; currentSnapshotId: number | null; shownSince: number | null; slot: number | null; sunsetStreak: number }`
  - `getScreenState(feed): Promise<ScreenRow | null>`
  - `commitAdvance(feed, slot: number, entry: BinEntry, streak: number): Promise<boolean>` — false when that slot was already committed
  - `countAdmittedSince(feed, sinceMs: number): Promise<{ sunset: number; nonSunset: number }>`
  - `getBinDigestSummary(): Promise<BinDigestSummary | null>` where `BinDigestSummary = { admittedToday: { sunset: number; nonSunset: number }; removedToday: number; activeNow: Record<Feed, number> }`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/solo/store.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): unknown;
  __sqlMock: ReturnType<typeof vi.fn>;
};
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/db', async () => {
  const sqlMockFn = vi.fn();
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => sqlMockFn(strings, ...values);
  (tag as unknown as SqlTag).__sqlMock = sqlMockFn;
  return { sql: tag };
});

import { sql } from '@/app/lib/db';
import {
  listActiveEntries, insertEntry, removeStale, getScreenState, commitAdvance,
  countAdmittedSince, getBinDigestSummary,
} from './store';

const sqlMock = (sql as unknown as SqlTag).__sqlMock;
const lastQuery = () => (sqlMock.mock.calls.at(-1)![0] as TemplateStringsArray).join('?');

beforeEach(() => sqlMock.mockReset());

describe('listActiveEntries', () => {
  it('maps rows into StoredEntry with numbers, not Neon strings', async () => {
    sqlMock.mockResolvedValueOnce([{
      snapshot_id: '7', webcam_id: '3', bin: 'sunset', quality: '0.91', detection: '0.88',
      is_new: true, tally: '2', entered_at: '2026-09-04T01:00:00Z', first_shown_at: null, last_shown_at: null,
      firebase_url: 'https://storage.googleapis.com/x.jpg', title: 'Pier', city: 'Lisbon', region: 'Lisboa',
      country: 'Portugal', lat: '38.700000', lng: '-9.400000',
    }]);
    const [e] = await listActiveEntries('sunset');
    expect(e).toMatchObject({ snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.91, detection: 0.88,
      isNew: true, tally: 2, feed: 'sunset', lat: 38.7, lng: -9.4, imageUrl: 'https://storage.googleapis.com/x.jpg' });
    expect(e.enteredAt).toBe(Date.parse('2026-09-04T01:00:00Z'));
    expect(lastQuery()).toMatch(/removed_at is null/i);
  });
});

describe('insertEntry', () => {
  it('returns true on insert and false on conflict', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);
    expect(await insertEntry({ feed: 'sunset', bin: 'sunset', snapshotId: 7, webcamId: 3, quality: 0.9, detection: 0.8, isNew: false })).toBe(true);
    expect(lastQuery()).toMatch(/on conflict \(feed, snapshot_id\) do nothing/i);
    sqlMock.mockResolvedValueOnce([]);
    expect(await insertEntry({ feed: 'sunset', bin: 'sunset', snapshotId: 7, webcamId: 3, quality: 0.9, detection: 0.8, isNew: false })).toBe(false);
  });
});

describe('removeStale', () => {
  it('removes past-grace as left_zone and past-age as expired, and counts each', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValueOnce([{ id: 3 }]);
    expect(await removeStale('sunrise', { grace: 2, maxAgeHours: 24 })).toEqual({ leftZone: 2, expired: 1 });
    const q1 = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(q1).toMatch(/out_of_zone_polls > \?/);
    expect(sqlMock.mock.calls[0].slice(1)).toContain(2);
    expect(q1).toMatch(/'left_zone'/);
  });
});

describe('screen state', () => {
  it('getScreenState returns null when the row is absent', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getScreenState('sunset')).toBeNull();
  });
  it('commitAdvance is a no-op when the slot was already committed', async () => {
    sqlMock.mockResolvedValueOnce([]); // upsert returned nothing: slot unchanged
    const ok = await commitAdvance('sunset', 42, { snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 }, 1);
    expect(ok).toBe(false);
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
  it('commitAdvance bumps the tally after a successful state write', async () => {
    sqlMock.mockResolvedValueOnce([{ feed: 'sunset' }]).mockResolvedValueOnce([]);
    const ok = await commitAdvance('sunset', 42, { snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 }, 1);
    expect(ok).toBe(true);
    expect(sqlMock).toHaveBeenCalledTimes(2);
    expect(lastQuery()).toMatch(/tally = tally \+ 1/);
    expect(lastQuery()).toMatch(/is_new = false/);
  });
});

describe('counts', () => {
  it('countAdmittedSince returns numbers per bin', async () => {
    sqlMock.mockResolvedValueOnce([{ bin: 'sunset', n: '3' }, { bin: 'non_sunset', n: '5' }]);
    expect(await countAdmittedSince('sunset', 0)).toEqual({ sunset: 3, nonSunset: 5 });
  });
  it('getBinDigestSummary swallows its own failure', async () => {
    sqlMock.mockRejectedValueOnce(new Error('relation does not exist'));
    expect(await getBinDigestSummary()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm run test -- app/lib/solo/store.test.ts`
Expected: FAIL, cannot resolve `./store`.

- [ ] **Step 3: Write `app/lib/solo/store.ts`**

```ts
import 'server-only';
import { sql } from '@/app/lib/db';
import type { BinEntry, BinKind, Feed } from './types';

/**
 * Every SQL touch of kiosk_bin_entries and kiosk_screen_state (spec §5).
 * Neon returns NUMERIC/BIGINT as strings; every reader here casts.
 */

export interface StoredEntry extends BinEntry {
  feed: Feed;
  imageUrl: string;
  title: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  firstShownAt: number | null;
  lastShownAt: number | null;
}

interface EntryRow {
  snapshot_id: string | number;
  webcam_id: string | number;
  bin: BinKind;
  quality: string | number | null;
  detection: string | number;
  is_new: boolean;
  tally: string | number;
  entered_at: string;
  first_shown_at: string | null;
  last_shown_at: string | null;
  firebase_url: string;
  title: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: string | number;
  lng: string | number;
}

const num = (v: string | number) => Number(v);
const ms = (v: string | null) => (v ? Date.parse(v) : null);

function toEntry(feed: Feed, r: EntryRow): StoredEntry {
  return {
    feed,
    snapshotId: num(r.snapshot_id),
    webcamId: num(r.webcam_id),
    bin: r.bin,
    quality: r.quality == null ? null : num(r.quality),
    detection: num(r.detection),
    isNew: r.is_new,
    tally: num(r.tally),
    enteredAt: Date.parse(r.entered_at),
    firstShownAt: ms(r.first_shown_at),
    lastShownAt: ms(r.last_shown_at),
    imageUrl: r.firebase_url,
    title: r.title ?? '',
    city: r.city ?? '',
    region: r.region ?? '',
    country: r.country ?? '',
    lat: num(r.lat),
    lng: num(r.lng),
  };
}

export async function listActiveEntries(feed: Feed): Promise<StoredEntry[]> {
  const rows = (await sql`
    select e.snapshot_id, e.webcam_id, e.bin, e.quality, e.detection, e.is_new, e.tally,
           e.entered_at, e.first_shown_at, e.last_shown_at,
           s.firebase_url, w.title, w.city, w.region, w.country, w.lat, w.lng
    from kiosk_bin_entries e
    join webcam_snapshots s on s.id = e.snapshot_id
    join webcams w on w.id = e.webcam_id
    where e.feed = ${feed} and e.removed_at is null
    order by e.entered_at asc
  `) as unknown as EntryRow[];
  return rows.map((r) => toEntry(feed, r));
}

export async function activeWebcamIds(feed: Feed): Promise<Set<number>> {
  const rows = (await sql`
    select distinct webcam_id from kiosk_bin_entries
    where feed = ${feed} and removed_at is null
  `) as unknown as { webcam_id: string | number }[];
  return new Set(rows.map((r) => num(r.webcam_id)));
}

export async function getCalibrationMultipliers(webcamIds: number[]): Promise<Map<number, number>> {
  if (webcamIds.length === 0) return new Map();
  const rows = (await sql`
    select id, calibration_multiplier from webcams
    where id = any(${webcamIds}) and calibration_multiplier is not null
  `) as unknown as { id: string | number; calibration_multiplier: string | number }[];
  return new Map(rows.map((r) => [num(r.id), num(r.calibration_multiplier)]));
}

export interface InsertEntryInput {
  feed: Feed;
  bin: BinKind;
  snapshotId: number;
  webcamId: number;
  quality: number | null;
  detection: number;
  isNew: boolean;
}

/** True when a row was inserted; false when (feed, snapshot_id) already existed. */
export async function insertEntry(input: InsertEntryInput): Promise<boolean> {
  const rows = (await sql`
    insert into kiosk_bin_entries (feed, bin, snapshot_id, webcam_id, quality, detection, is_new)
    values (${input.feed}, ${input.bin}, ${input.snapshotId}, ${input.webcamId},
            ${input.quality}, ${input.detection}, ${input.isNew})
    on conflict (feed, snapshot_id) do nothing
    returning id
  `) as unknown as { id: number }[];
  return rows.length > 0;
}

export async function markSeen(feed: Feed, webcamIds: number[]): Promise<void> {
  if (webcamIds.length === 0) return;
  await sql`
    update kiosk_bin_entries
    set last_seen_at = now(), out_of_zone_polls = 0
    where feed = ${feed} and removed_at is null and webcam_id = any(${webcamIds})
  `;
}

export async function markOutOfZone(feed: Feed, webcamIds: number[]): Promise<void> {
  if (webcamIds.length === 0) return;
  await sql`
    update kiosk_bin_entries
    set out_of_zone_polls = out_of_zone_polls + 1
    where feed = ${feed} and removed_at is null and webcam_id = any(${webcamIds})
  `;
}

export async function removeStale(
  feed: Feed,
  opts: { grace: number; maxAgeHours: number },
): Promise<{ leftZone: number; expired: number }> {
  const leftZone = (await sql`
    update kiosk_bin_entries
    set removed_at = now(), removed_reason = 'left_zone'
    where feed = ${feed} and removed_at is null and out_of_zone_polls > ${opts.grace}
    returning id
  `) as unknown as { id: number }[];
  const expired = (await sql`
    update kiosk_bin_entries
    set removed_at = now(), removed_reason = 'expired'
    where feed = ${feed} and removed_at is null
      and entered_at < now() - (${opts.maxAgeHours} * interval '1 hour')
    returning id
  `) as unknown as { id: number }[];
  return { leftZone: leftZone.length, expired: expired.length };
}

export interface ScreenRow {
  feed: Feed;
  currentSnapshotId: number | null;
  shownSince: number | null;
  slot: number | null;
  sunsetStreak: number;
}

export async function getScreenState(feed: Feed): Promise<ScreenRow | null> {
  const rows = (await sql`
    select feed, current_snapshot_id, shown_since, slot, sunset_streak
    from kiosk_screen_state where feed = ${feed}
  `) as unknown as {
    feed: Feed; current_snapshot_id: string | number | null; shown_since: string | null;
    slot: string | number | null; sunset_streak: string | number;
  }[];
  const r = rows[0];
  if (!r) return null;
  return {
    feed: r.feed,
    currentSnapshotId: r.current_snapshot_id == null ? null : num(r.current_snapshot_id),
    shownSince: ms(r.shown_since),
    slot: r.slot == null ? null : num(r.slot),
    sunsetStreak: num(r.sunset_streak),
  };
}

/**
 * Put `entry` on glass for `slot`. The state write is conditional on the slot
 * being new, which is what makes POST /advance idempotent: a second call for
 * the same slot writes nothing and returns false, and the tally is bumped
 * only after the state write succeeded.
 */
export async function commitAdvance(
  feed: Feed,
  slot: number,
  entry: BinEntry,
  sunsetStreak: number,
): Promise<boolean> {
  const rows = (await sql`
    insert into kiosk_screen_state (feed, current_snapshot_id, shown_since, slot, sunset_streak, updated_at)
    values (${feed}, ${entry.snapshotId}, now(), ${slot}, ${sunsetStreak}, now())
    on conflict (feed) do update
      set current_snapshot_id = excluded.current_snapshot_id,
          shown_since = excluded.shown_since,
          slot = excluded.slot,
          sunset_streak = excluded.sunset_streak,
          updated_at = now()
      where kiosk_screen_state.slot is distinct from excluded.slot
    returning feed
  `) as unknown as { feed: Feed }[];
  if (rows.length === 0) return false;
  await sql`
    update kiosk_bin_entries
    set tally = tally + 1,
        is_new = false,
        first_shown_at = coalesce(first_shown_at, now()),
        last_shown_at = now()
    where feed = ${feed} and snapshot_id = ${entry.snapshotId}
  `;
  return true;
}

export async function countAdmittedSince(
  feed: Feed,
  sinceMs: number,
): Promise<{ sunset: number; nonSunset: number }> {
  const rows = (await sql`
    select bin, count(*) as n from kiosk_bin_entries
    where feed = ${feed} and entered_at >= ${new Date(sinceMs).toISOString()}
    group by bin
  `) as unknown as { bin: BinKind; n: string | number }[];
  const out = { sunset: 0, nonSunset: 0 };
  for (const r of rows) {
    if (r.bin === 'sunset') out.sunset = num(r.n);
    else out.nonSunset = num(r.n);
  }
  return out;
}

export interface BinDigestSummary {
  admittedToday: { sunset: number; nonSunset: number };
  removedToday: number;
  activeNow: Record<Feed, number>;
}

/** Null on any failure, so an unmigrated table degrades the digest to silence. */
export async function getBinDigestSummary(): Promise<BinDigestSummary | null> {
  try {
    const rows = (await sql`
      select
        count(*) filter (where entered_at >= current_date and bin = 'sunset')     as admitted_sunset,
        count(*) filter (where entered_at >= current_date and bin = 'non_sunset') as admitted_non,
        count(*) filter (where removed_at >= current_date)                        as removed,
        count(*) filter (where removed_at is null and feed = 'sunrise')           as active_sunrise,
        count(*) filter (where removed_at is null and feed = 'sunset')            as active_sunset
      from kiosk_bin_entries
    `) as unknown as Record<string, string | number>[];
    const r = rows[0];
    if (!r) return null;
    return {
      admittedToday: { sunset: num(r.admitted_sunset), nonSunset: num(r.admitted_non) },
      removedToday: num(r.removed),
      activeNow: { sunrise: num(r.active_sunrise), sunset: num(r.active_sunset) },
    };
  } catch (error) {
    console.warn('[solo/store] bin digest summary failed:', error);
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- app/lib/solo/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && git add app/lib/solo/store.ts app/lib/solo/store.test.ts && git commit -m "feat(solo): bin entry + screen state store" && git push
```

---

### Task 6: Cron admission and maintenance library

**Files:**
- Create: `app/api/cron/update-cameras/lib/binAdmission.ts`
- Test: `app/api/cron/update-cameras/lib/binAdmission.test.ts`
- Modify: `app/api/cron/update-cameras/lib/dbOperations.ts:339` (`intakeReason` union)

**Interfaces:**
- Consumes: Task 5 store functions; Task 4 `inFeedZone`, `Zone`; Task 2 types.
- Produces:
  - `BIN_ADMIT_DETECTION_FLOOR = 0.2`
  - `decideBin(scored: { binaryIsSunset?: boolean; binaryRawScore?: number }): BinKind | null`
  - `interface Admission { feed: Feed; bin: BinKind; snapshotId: number; webcamId: number; rawQuality: number; detection: number }`
  - `enterBins(admissions: Admission[]): Promise<{ sunset: number; nonSunset: number; duplicates: number }>`
  - `maintainBins(opts: { now: Date; zone: Zone; grace: number }): Promise<{ leftZone: number; expired: number }>`

- [ ] **Step 1: Extend the intake union**

In `dbOperations.ts`, the `insertWindyDisagreementSnapshot` option becomes:

```ts
  intakeReason?: 'disagreement' | 'high_rated' | 'trickle' | 'all_rated' | 'kiosk_bin';
```

- [ ] **Step 2: Write the failing test**

```ts
// app/api/cron/update-cameras/lib/binAdmission.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertEntry = vi.fn();
const activeWebcamIds = vi.fn();
const getCalibrationMultipliers = vi.fn();
const listActiveEntries = vi.fn();
const markSeen = vi.fn();
const markOutOfZone = vi.fn();
const removeStale = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/solo/store', () => ({
  insertEntry: (...a: unknown[]) => insertEntry(...a),
  activeWebcamIds: (...a: unknown[]) => activeWebcamIds(...a),
  getCalibrationMultipliers: (...a: unknown[]) => getCalibrationMultipliers(...a),
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  markSeen: (...a: unknown[]) => markSeen(...a),
  markOutOfZone: (...a: unknown[]) => markOutOfZone(...a),
  removeStale: (...a: unknown[]) => removeStale(...a),
}));

import { decideBin, enterBins, maintainBins, BIN_ADMIT_DETECTION_FLOOR } from './binAdmission';

beforeEach(() => {
  vi.clearAllMocks();
  activeWebcamIds.mockResolvedValue(new Set());
  getCalibrationMultipliers.mockResolvedValue(new Map());
  insertEntry.mockResolvedValue(true);
  removeStale.mockResolvedValue({ leftZone: 0, expired: 0 });
});

describe('decideBin (fixed cron floors, spec §5.3)', () => {
  it('detection verdict first: a sunset enters the sunset bin whatever its probability looks like', () => {
    expect(decideBin({ binaryIsSunset: true, binaryRawScore: 0.56 })).toBe('sunset');
  });
  it('a non-sunset at or above the floor enters the non-sunset bin', () => {
    expect(decideBin({ binaryIsSunset: false, binaryRawScore: BIN_ADMIT_DETECTION_FLOOR })).toBe('non_sunset');
  });
  it('below the floor, or with no binary verdict, nothing', () => {
    expect(decideBin({ binaryIsSunset: false, binaryRawScore: 0.19 })).toBeNull();
    expect(decideBin({})).toBeNull();
  });
});

describe('enterBins', () => {
  it('applies the calibration multiplier to sunset quality and leaves detection raw', async () => {
    getCalibrationMultipliers.mockResolvedValue(new Map([[3, 0.5]]));
    await enterBins([{ feed: 'sunset', bin: 'sunset', snapshotId: 7, webcamId: 3, rawQuality: 0.8, detection: 0.9 }]);
    expect(insertEntry).toHaveBeenCalledWith(expect.objectContaining({ quality: 0.4, detection: 0.9, isNew: false }));
  });
  it('non-sunset rows carry null quality', async () => {
    await enterBins([{ feed: 'sunset', bin: 'non_sunset', snapshotId: 8, webcamId: 4, rawQuality: 0.8, detection: 0.3 }]);
    expect(insertEntry).toHaveBeenCalledWith(expect.objectContaining({ quality: null }));
  });
  it('flags isNew when the camera already has an active entry in that feed', async () => {
    activeWebcamIds.mockResolvedValue(new Set([3]));
    await enterBins([{ feed: 'sunrise', bin: 'sunset', snapshotId: 9, webcamId: 3, rawQuality: 0.8, detection: 0.9 }]);
    expect(insertEntry).toHaveBeenCalledWith(expect.objectContaining({ isNew: true }));
  });
  it('counts per bin and counts conflicts as duplicates', async () => {
    insertEntry.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const out = await enterBins([
      { feed: 'sunset', bin: 'sunset', snapshotId: 1, webcamId: 1, rawQuality: 0.9, detection: 0.9 },
      { feed: 'sunset', bin: 'non_sunset', snapshotId: 2, webcamId: 2, rawQuality: 0.2, detection: 0.4 },
    ]);
    expect(out).toEqual({ sunset: 1, nonSunset: 0, duplicates: 1 });
  });
});

describe('maintainBins', () => {
  const zone = { minDeg: -24, maxDeg: -2 };
  // Seattle at ~50 min after sunset on 2026-09-04: in the sunset zone.
  const seattleDusk = new Date('2026-09-05T03:30:00Z');
  const entry = (feed: string, webcamId: number, lat: number, lng: number) => ({
    feed, webcamId, lat, lng, snapshotId: webcamId, bin: 'sunset', quality: 0.9, detection: 0.9,
    isNew: false, tally: 0, enteredAt: 0, imageUrl: '', title: '', city: '', region: '', country: '',
    firstShownAt: null, lastShownAt: null,
  });
  it('marks in-zone cameras seen and out-of-zone cameras out, per feed, then removes stale', async () => {
    listActiveEntries.mockImplementation(async (feed: string) =>
      feed === 'sunset'
        ? [entry('sunset', 1, 47.6062, -122.3321), entry('sunset', 2, -33.9, 151.2)] // Seattle dusk; Sydney (noon-ish next day)
        : []);
    const out = await maintainBins({ now: seattleDusk, zone, grace: 2 });
    expect(markSeen).toHaveBeenCalledWith('sunset', [1]);
    expect(markOutOfZone).toHaveBeenCalledWith('sunset', [2]);
    expect(removeStale).toHaveBeenCalledWith('sunset', { grace: 2, maxAgeHours: 24 });
    expect(removeStale).toHaveBeenCalledWith('sunrise', { grace: 2, maxAgeHours: 24 });
    expect(out).toEqual({ leftZone: 0, expired: 0 });
  });
  it('absence from a poll is not a reason: only zone membership drives the counters', async () => {
    listActiveEntries.mockImplementation(async (feed: string) =>
      feed === 'sunset' ? [entry('sunset', 1, 47.6062, -122.3321)] : []);
    await maintainBins({ now: seattleDusk, zone, grace: 2 });
    expect(markOutOfZone).toHaveBeenCalledWith('sunset', []);
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `npm run test -- app/api/cron/update-cameras/lib/binAdmission.test.ts`
Expected: FAIL, cannot resolve `./binAdmission`.

- [ ] **Step 4: Write `binAdmission.ts`**

```ts
import 'server-only';
import {
  activeWebcamIds,
  getCalibrationMultipliers,
  insertEntry,
  listActiveEntries,
  markOutOfZone,
  markSeen,
  removeStale,
} from '@/app/lib/solo/store';
import { inFeedZone, type Zone } from '@/app/lib/solo/zone';
import type { BinKind, Feed } from '@/app/lib/solo/types';

/**
 * Solo kiosk admission and maintenance, spec §5.3. Runs inside the cron tick.
 *
 * The cron floors are FIXED and generous. The studio dials only narrow from
 * here, so the cron never chases a dial and a dial change is visible within
 * one poll instead of one cron tick.
 */
export const BIN_ADMIT_DETECTION_FLOOR = 0.2;
const MAX_ENTRY_AGE_HOURS = 24;
const FEEDS: Feed[] = ['sunrise', 'sunset'];

/** Detection verdict first, then the probability floor. Null = not for the bins. */
export function decideBin(scored: { binaryIsSunset?: boolean; binaryRawScore?: number }): BinKind | null {
  if (scored.binaryIsSunset === true) return 'sunset';
  if (typeof scored.binaryRawScore === 'number' && scored.binaryRawScore >= BIN_ADMIT_DETECTION_FLOOR) {
    return 'non_sunset';
  }
  return null;
}

export interface Admission {
  feed: Feed;
  bin: BinKind;
  snapshotId: number;
  webcamId: number;
  /** ai_regression_score, uncalibrated. */
  rawQuality: number;
  /** ai_binary_score. */
  detection: number;
}

export async function enterBins(
  admissions: Admission[],
): Promise<{ sunset: number; nonSunset: number; duplicates: number }> {
  const out = { sunset: 0, nonSunset: 0, duplicates: 0 };
  if (admissions.length === 0) return out;
  const multipliers = await getCalibrationMultipliers([...new Set(admissions.map((a) => a.webcamId))]);
  const activeByFeed = new Map<Feed, Set<number>>();
  for (const feed of FEEDS) activeByFeed.set(feed, await activeWebcamIds(feed));

  for (const a of admissions) {
    // Quality is the calibrated tile signal; detection is never calibrated
    // (per-camera-calibration spec). Non-sunset rows carry no quality at all:
    // the quality head is trained on sunsets and its score there is noise.
    const quality = a.bin === 'sunset' ? a.rawQuality * (multipliers.get(a.webcamId) ?? 1) : null;
    const isNew = activeByFeed.get(a.feed)!.has(a.webcamId);
    const inserted = await insertEntry({
      feed: a.feed, bin: a.bin, snapshotId: a.snapshotId, webcamId: a.webcamId,
      quality, detection: a.detection, isNew,
    });
    if (!inserted) { out.duplicates += 1; continue; }
    if (a.bin === 'sunset') out.sunset += 1; else out.nonSunset += 1;
    activeByFeed.get(a.feed)!.add(a.webcamId);
  }
  return out;
}

/**
 * Removal is by zone, not by absence. Every active entry is checked against
 * where its camera's sun is right now; a poll that simply did not return the
 * camera changes nothing.
 */
export async function maintainBins(opts: {
  now: Date;
  zone: Zone;
  grace: number;
}): Promise<{ leftZone: number; expired: number }> {
  const totals = { leftZone: 0, expired: 0 };
  for (const feed of FEEDS) {
    const entries = await listActiveEntries(feed);
    const seen = new Set<number>();
    const out = new Set<number>();
    for (const e of entries) {
      (inFeedZone(opts.now, e.lat, e.lng, feed, opts.zone) ? seen : out).add(e.webcamId);
    }
    await markSeen(feed, [...seen]);
    await markOutOfZone(feed, [...out]);
    const removed = await removeStale(feed, { grace: opts.grace, maxAgeHours: MAX_ENTRY_AGE_HOURS });
    totals.leftZone += removed.leftZone;
    totals.expired += removed.expired;
  }
  return totals;
}
```

- [ ] **Step 5: Run tests**

Run: `npm run test -- app/api/cron/update-cameras/lib/binAdmission.test.ts`
Expected: PASS. If the Sydney entry is not "out", the test's Sydney coordinates at that instant are inside the band; swap to `(0, 0)` at the same instant (the Gulf of Guinea at 03:30Z is deep night, altitude around −50°).

- [ ] **Step 6: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && git add app/api/cron/update-cameras/lib/binAdmission.ts app/api/cron/update-cameras/lib/binAdmission.test.ts app/api/cron/update-cameras/lib/dbOperations.ts && git commit -m "feat(solo): cron admission decision, entry, and zone maintenance" && git push
```

---

### Task 7: Wire the cron tick

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts` (imports; `scoreOneWindy` around lines 280–345; after the scoring loop; the response)
- Modify: `app/api/cron/update-cameras/route.test.ts` (add a mock)
- Modify: `vercel.json:5`

**Interfaces:**
- Consumes: Task 6 `decideBin`, `enterBins`, `maintainBins`, `Admission`; Task 2 `SOLO_SETTINGS_SCHEMA`, `dialsFrom`; `getLiveSettingsCached`; `sweepGeometry(forcedOffsets).coverageMinDeg/MaxDeg`.
- Produces: the cron response gains `bins: { admitted: { sunset, nonSunset, duplicates }, removed: { leftZone, expired } } | { error: true }`.

- [ ] **Step 1: Add the mock to `route.test.ts`**

Next to the other `./lib/*` mocks:

```ts
vi.mock('./lib/binAdmission', () => ({
  decideBin: () => null,
  enterBins: async () => ({ sunset: 0, nonSunset: 0, duplicates: 0 }),
  maintainBins: async () => ({ leftZone: 0, expired: 0 }),
}));
vi.mock('@/app/lib/settings/liveSettings', () => ({
  getLiveSettingsCached: async () => null,
}));
```

- [ ] **Step 2: Run the cron test to confirm it still passes before the change**

Run: `npm run test -- app/api/cron/update-cameras/route.test.ts`
Expected: PASS (the mocks are unused until Step 3).

- [ ] **Step 3: Wire admission into `scoreOneWindy`**

Imports at the top of `route.ts`:

```ts
import { decideBin, enterBins, maintainBins, type Admission } from './lib/binAdmission';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
```

Directly after the phase split (`const { sunrise: sunriseList, sunset: sunsetList } = classifyWebcamsByPhase(...)`), build the feed map and the admission list:

```ts
  // Solo kiosk admission (spec §5.3) collects during scoring and writes once
  // after the loop. Feed comes from the same classification the pool uses.
  const feedByExternalId = new Map<string, 'sunrise' | 'sunset'>();
  for (const w of sunriseList) feedByExternalId.set(String(w.webcamId), 'sunrise');
  for (const w of sunsetList) feedByExternalId.set(String(w.webcamId), 'sunset');
  const admissions: Admission[] = [];
```

Inside `scoreOneWindy`, replace the persist block's decision and insert so the bin decision participates:

```ts
      const binKind = decideBin(scored);
      const binFeed = feedByExternalId.get(externalId) ?? null;
      const shouldPersist =
        disagreementKind !== null ||
        isHighRated ||
        isTrickle ||
        SAVE_ALL_RATED_SNAPSHOTS ||
        (binKind !== null && binFeed !== null);
      // Precedence matters for the analysis, not for the write: a frame that
      // would have been saved anyway is NOT part of the unbiased arm, so the
      // gated reasons win and 'trickle' marks only frames nothing else caught.
      // 'kiosk_bin' likewise marks only frames the bins alone brought in.
      const intakeReason: 'disagreement' | 'high_rated' | 'trickle' | 'all_rated' | 'kiosk_bin' =
        disagreementKind !== null
          ? 'disagreement'
          : isHighRated
            ? 'high_rated'
            : isTrickle
              ? 'trickle'
              : SAVE_ALL_RATED_SNAPSHOTS
                ? 'all_rated'
                : 'kiosk_bin';
      if (shouldPersist) {
        try {
          const capturedAt = new Date();
          const upload = await uploadToFirebase(bytes, webcamId, capturedAt);
          const snapshotId = await insertWindyDisagreementSnapshot({
            // ...every existing field unchanged...
            intakeReason,
          });
          if (binKind !== null && binFeed !== null && typeof scored.binaryRawScore === 'number') {
            admissions.push({
              feed: binFeed, bin: binKind, snapshotId, webcamId,
              rawQuality: scored.rawScore, detection: scored.binaryRawScore,
            });
          }
        } catch (persistError) {
          // unchanged warn
        }
      }
```

`scored.rawScore` is non-null here (the `unscored` branch returned earlier).

- [ ] **Step 4: Write the bins after the scoring loop**

After the `for (let i = 0; i < windyAll.length; i += SCORING_CONCURRENCY)` loop and before the archive backfill:

```ts
  // Solo kiosk bins: enter what this tick admitted, then age every entry
  // against where its camera's sun is now. Non-fatal: a failure here must not
  // cost the pool its update.
  let bins:
    | { admitted: Awaited<ReturnType<typeof enterBins>>; removed: Awaited<ReturnType<typeof maintainBins>> }
    | { error: true };
  try {
    const live = await getLiveSettingsCached();
    const dials = dialsFrom(mergeSettings(SOLO_SETTINGS_SCHEMA, live?.namespaces[SOLO_NAMESPACE]));
    const geometry = sweepGeometry(forcedOffsets);
    const admitted = await enterBins(admissions);
    const removed = await maintainBins({
      now: new Date(),
      zone: { minDeg: geometry.coverageMinDeg, maxDeg: geometry.coverageMaxDeg },
      grace: dials.zoneGrace,
    });
    bins = { admitted, removed };
  } catch (error) {
    console.warn('[update-cameras] solo bins failed:', error);
    bins = { error: true };
  }
```

`sweepGeometry` is already imported in this file. Add `bins,` to the `NextResponse.json({...})` at the end.

- [ ] **Step 5: Cron cadence**

In `vercel.json`, change the update-cameras schedule from `"*/15 * * * *"` to `"*/10 * * * *"`. Add a line to the spec's §5.3 is not needed; it already records the reason.

- [ ] **Step 6: Run the cron test and lint**

Run: `npm run test -- app/api/cron/update-cameras && npm run lint`
Expected: PASS, no lint errors. If TypeScript complains that `intakeReason`'s union does not match the option type, Task 6 Step 1 was skipped.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && git add app/api/cron/update-cameras/route.ts app/api/cron/update-cameras/route.test.ts vercel.json && git commit -m "feat(solo): admit scored frames to the bins each tick; cron every 10 min for the show" && git push
```

---

### Task 8: Digest line

**Files:**
- Modify: `app/api/cron/update-cameras/lib/dailyDigest.ts` (import; after `const sweep = await getSweepDigestSummary();`; the HTML after `${formatSweepLine(sweep)}`)
- Test: `app/api/cron/update-cameras/lib/dailyDigest.test.ts` (append)

**Interfaces:**
- Consumes: `getBinDigestSummary`, `BinDigestSummary` from Task 5.
- Produces: `formatBinLine(summary: BinDigestSummary | null): string`

- [ ] **Step 1: Append the failing test**

```ts
import { formatBinLine } from './dailyDigest';

describe('formatBinLine', () => {
  it('is empty when the table is not there', () => {
    expect(formatBinLine(null)).toBe('');
  });
  it('reads admissions, removals, and what is waiting', () => {
    const html = formatBinLine({
      admittedToday: { sunset: 41, nonSunset: 380 },
      removedToday: 220,
      activeNow: { sunrise: 12, sunset: 31 },
    });
    expect(html).toContain('Solo bins');
    expect(html).toContain('41 sunsets');
    expect(html).toContain('380 non-sunsets');
    expect(html).toContain('220 removed');
    expect(html).toContain('12 sunrise');
    expect(html).toContain('31 sunset');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm run test -- app/api/cron/update-cameras/lib/dailyDigest.test.ts`
Expected: FAIL, `formatBinLine` is not exported.

- [ ] **Step 3: Implement**

```ts
import { getBinDigestSummary, type BinDigestSummary } from '@/app/lib/solo/store';

/**
 * The solo kiosk's cost line (spec §7): how many frames the bins brought into
 * the archive today, so the admission rule's price is readable in money's
 * proxy, rows. Silent when the table is not migrated.
 */
export function formatBinLine(summary: BinDigestSummary | null): string {
  if (!summary) return '';
  const a = summary.admittedToday;
  return `<p style="font:12px sans-serif">Solo bins: admitted ${a.sunset} sunsets + ${a.nonSunset} non-sunsets today, ` +
    `${summary.removedToday} removed; waiting now ${summary.activeNow.sunrise} sunrise / ${summary.activeNow.sunset} sunset.</p>`;
}
```

In `sendDailyUsageDigest`, after the sweep summary:

```ts
    const bins = await getBinDigestSummary();
```

and in the HTML, after `${formatSweepLine(sweep)}`:

```ts
        ${formatBinLine(bins)}
```

- [ ] **Step 4: Run tests**

Run: `npm run test -- app/api/cron/update-cameras/lib/dailyDigest.test.ts`
Expected: PASS. If the existing digest tests mock `@/app/lib/db` and now fail on the new query, add `vi.mock('@/app/lib/solo/store', () => ({ getBinDigestSummary: async () => null }))` at the top of that test file.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && git add app/api/cron/update-cameras/lib/dailyDigest.ts app/api/cron/update-cameras/lib/dailyDigest.test.ts && git commit -m "feat(solo): bins line in the daily digest" && git push
```

---

### Task 9: `GET /api/kiosk/solo/state`

**Files:**
- Create: `app/api/kiosk/solo/state/route.ts`
- Create: `app/api/kiosk/solo/view.ts` (shared response shaping, used by Task 10 too)
- Test: `app/api/kiosk/solo/state/route.test.ts`, `app/api/kiosk/solo/view.test.ts`

**Interfaces:**
- Consumes: Task 5 `listActiveEntries`, `getScreenState`, `countAdmittedSince`; Task 3 `project`, `isEligible`; Task 4 `slotFor`, `nextBoundaryMs`; Task 2 schema.
- Produces:
  - `interface EntryView { snapshotId; webcamId; bin; quality; detection; isNew; tally; enteredAt; imageUrl; title; city; region; country; eligible: boolean; rank: number }` — `rank` is 1-based position within its bin by score.
  - `parseFeed(raw: string | null): Feed | null`
  - `buildStateView(input: { feed; dials: SoloDials; entries: StoredEntry[]; screen: ScreenRow | null; nowMs: number; admitted: { sunset; nonSunset } }): StateView`
  - `interface StateView { feed; dials; current: { entry: EntryView; shownSince: number | null; slot: number | null } | null; next: EntryView[]; bins: { sunset: EntryView[]; nonSunset: EntryView[] }; schedule: { slot: number; nextBoundaryMs: number }; lastPull: { admitted: { sunset; nonSunset } } }`
  - Response of `GET /api/kiosk/solo/state?feed=sunset[&profile=studio]` is a `StateView`.

- [ ] **Step 1: Write the failing view test**

```ts
// app/api/kiosk/solo/view.test.ts
import { describe, it, expect } from 'vitest';
import { buildStateView } from './view';
import type { StoredEntry } from '@/app/lib/solo/store';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const stored = (id: number, bin: 'sunset' | 'non_sunset', score: number, tally = 0): StoredEntry => ({
  feed: 'sunset', snapshotId: id, webcamId: 100 + id, bin,
  quality: bin === 'sunset' ? score : null, detection: bin === 'sunset' ? 0.9 : score,
  isNew: false, tally, enteredAt: id, firstShownAt: null, lastShownAt: null,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '', lat: 0, lng: 0,
});

describe('buildStateView', () => {
  it('queued frames are absent from the bins; bins keep the remainder ranked by score', () => {
    const entries = [stored(1, 'sunset', 0.9), stored(2, 'sunset', 0.8), stored(3, 'non_sunset', 0.5), stored(4, 'sunset', 0.1)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0, admitted: { sunset: 0, nonSunset: 0 } });
    // No screen row yet: current is null and next starts with the best sunset.
    expect(v.current).toBeNull();
    expect(v.next.map((e) => e.snapshotId)).toEqual([1, 2, 3]);
    expect(v.bins.sunset.map((e) => e.snapshotId)).toEqual([4]);
    expect(v.bins.sunset[0].eligible).toBe(false);
  });
  it('current comes from the screen row and is excluded from next', () => {
    const entries = [stored(1, 'sunset', 0.9, 1), stored(2, 'sunset', 0.8)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries,
      screen: { feed: 'sunset', currentSnapshotId: 1, shownSince: 5, slot: 3, sunsetStreak: 1 },
      nowMs: 70_000, admitted: { sunset: 2, nonSunset: 0 } });
    expect(v.current?.entry.snapshotId).toBe(1);
    expect(v.current?.slot).toBe(3);
    expect(v.next[0].snapshotId).toBe(2);
    expect(v.schedule).toEqual({ slot: 3, nextBoundaryMs: 90_000 });
    expect(v.lastPull.admitted.sunset).toBe(2);
  });
  it('rank is the position within the bin by score, ignoring queue membership', () => {
    const entries = [stored(1, 'sunset', 0.7), stored(2, 'sunset', 0.9)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0, admitted: { sunset: 0, nonSunset: 0 } });
    const byId = new Map(v.next.map((e) => [e.snapshotId, e.rank]));
    expect(byId.get(2)).toBe(1);
    expect(byId.get(1)).toBe(2);
  });
});
```

- [ ] **Step 2: Write the failing route test**

```ts
// app/api/kiosk/solo/state/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireOwner = vi.fn();
const listActiveEntries = vi.fn();
const getScreenState = vi.fn();
const countAdmittedSince = vi.fn();
const getLiveSettingsCached = vi.fn();
const getProfileSettings = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/app/lib/solo/store', () => ({
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
  countAdmittedSince: (...a: unknown[]) => countAdmittedSince(...a),
}));
vi.mock('@/app/lib/settings/liveSettings', () => ({ getLiveSettingsCached: () => getLiveSettingsCached() }));
vi.mock('@/app/lib/settings/store', () => ({ getProfileSettings: (p: string) => getProfileSettings(p) }));

import { GET } from './route';

const get = (qs: string) => GET(new NextRequest(`http://t/api/kiosk/solo/state${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  requireOwner.mockResolvedValue(null);
  listActiveEntries.mockResolvedValue([]);
  getScreenState.mockResolvedValue(null);
  countAdmittedSince.mockResolvedValue({ sunset: 0, nonSunset: 0 });
  getLiveSettingsCached.mockResolvedValue({ namespaces: { solo: { dwellS: 30 } }, revision: 1 });
  getProfileSettings.mockResolvedValue({ namespaces: { solo: { dwellS: 7 } }, revision: 1 });
});

describe('GET /api/kiosk/solo/state', () => {
  it('rejects a missing or unknown feed', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?feed=noon')).status).toBe(400);
  });
  it('live profile by default, no owner check', async () => {
    const res = await get('?feed=sunset');
    expect(res.status).toBe(200);
    expect((await res.json()).dials.dwellS).toBe(30);
    expect(requireOwner).not.toHaveBeenCalled();
  });
  it('studio profile is owner-gated and projects with studio dials', async () => {
    requireOwner.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }));
    expect((await get('?feed=sunset&profile=studio')).status).toBe(403);
    requireOwner.mockResolvedValue(null);
    const res = await get('?feed=sunset&profile=studio');
    expect((await res.json()).dials.dwellS).toBe(7);
    expect(getProfileSettings).toHaveBeenCalledWith('studio');
  });
});
```

- [ ] **Step 3: Run both to see them fail**

Run: `npm run test -- app/api/kiosk/solo`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write `app/api/kiosk/solo/view.ts`**

```ts
import { isEligible, project } from '@/app/lib/solo/engine';
import { nextBoundaryMs, slotFor } from '@/app/lib/solo/schedule';
import type { ScreenRow, StoredEntry } from '@/app/lib/solo/store';
import type { BinEntry, Feed, SoloDials } from '@/app/lib/solo/types';

/** The response shape both solo endpoints return. Pure: no I/O here. */

export const NEXT_COUNT = 8;

const FEEDS: Feed[] = ['sunrise', 'sunset'];

/** Route files may only export handler fields, so the query parser lives here. */
export function parseFeed(raw: string | null): Feed | null {
  return raw && (FEEDS as string[]).includes(raw) ? (raw as Feed) : null;
}

export interface EntryView {
  snapshotId: number;
  webcamId: number;
  bin: BinEntry['bin'];
  quality: number | null;
  detection: number;
  isNew: boolean;
  tally: number;
  enteredAt: number;
  imageUrl: string;
  title: string;
  city: string;
  region: string;
  country: string;
  eligible: boolean;
  /** 1-based position within its bin by score, queue membership ignored. */
  rank: number;
}

export interface StateView {
  feed: Feed;
  dials: SoloDials;
  current: { entry: EntryView; shownSince: number | null; slot: number | null } | null;
  next: EntryView[];
  bins: { sunset: EntryView[]; nonSunset: EntryView[] };
  schedule: { slot: number; nextBoundaryMs: number };
  lastPull: { admitted: { sunset: number; nonSunset: number } };
}

const scoreOf = (e: StoredEntry) => (e.bin === 'sunset' ? e.quality ?? -1 : e.detection);

function rankMap(entries: StoredEntry[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const bin of ['sunset', 'non_sunset'] as const) {
    entries
      .filter((e) => e.bin === bin)
      .sort((a, b) => scoreOf(b) - scoreOf(a) || a.enteredAt - b.enteredAt)
      .forEach((e, i) => out.set(e.snapshotId, i + 1));
  }
  return out;
}

export function buildStateView(input: {
  feed: Feed;
  dials: SoloDials;
  entries: StoredEntry[];
  screen: ScreenRow | null;
  nowMs: number;
  admitted: { sunset: number; nonSunset: number };
}): StateView {
  const { feed, dials, entries, screen, nowMs } = input;
  const ranks = rankMap(entries);
  const byId = new Map(entries.map((e) => [e.snapshotId, e]));
  const view = (e: StoredEntry): EntryView => ({
    snapshotId: e.snapshotId, webcamId: e.webcamId, bin: e.bin, quality: e.quality,
    detection: e.detection, isNew: e.isNew, tally: e.tally, enteredAt: e.enteredAt,
    imageUrl: e.imageUrl, title: e.title, city: e.city, region: e.region, country: e.country,
    eligible: isEligible(e, dials), rank: ranks.get(e.snapshotId) ?? 0,
  });

  const currentEntry = screen?.currentSnapshotId != null ? byId.get(screen.currentSnapshotId) ?? null : null;
  const state = {
    lastSnapshotId: currentEntry?.snapshotId ?? null,
    sunsetStreak: screen?.sunsetStreak ?? 0,
  };
  const next = project(entries, dials, state, NEXT_COUNT);
  const queued = new Set([currentEntry?.snapshotId, ...next.map((e) => e.snapshotId)]);
  const remaining = entries.filter((e) => !queued.has(e.snapshotId));
  const bySortedScore = (a: StoredEntry, b: StoredEntry) => scoreOf(b) - scoreOf(a) || a.enteredAt - b.enteredAt;

  return {
    feed,
    dials,
    current: currentEntry
      ? { entry: view(currentEntry), shownSince: screen?.shownSince ?? null, slot: screen?.slot ?? null }
      : null,
    next: next.map((e) => view(byId.get(e.snapshotId)!)),
    bins: {
      sunset: remaining.filter((e) => e.bin === 'sunset').sort(bySortedScore).map(view),
      nonSunset: remaining.filter((e) => e.bin === 'non_sunset').sort(bySortedScore).map(view),
    },
    schedule: {
      slot: slotFor(nowMs, feed, dials.dwellS, dials.offsetS),
      nextBoundaryMs: nextBoundaryMs(nowMs, feed, dials.dwellS, dials.offsetS),
    },
    lastPull: { admitted: input.admitted },
  };
}
```

- [ ] **Step 5: Write `app/api/kiosk/solo/state/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { getProfileSettings } from '@/app/lib/settings/store';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
import { countAdmittedSince, getScreenState, listActiveEntries } from '@/app/lib/solo/store';
import { buildStateView, parseFeed } from '../view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** "Last pull added": the cron runs every 10 min; count what entered in that window. */
const LAST_PULL_WINDOW_MS = 10 * 60 * 1000;

/**
 * One feed's bins, queue, and what is on glass (spec §6.1). The kiosk reads
 * it with the live profile; the studio passes ?profile=studio (owner-gated)
 * so the "next up" column reflects dials that are not deployed yet.
 */
export async function GET(request: NextRequest) {
  const feed = parseFeed(request.nextUrl.searchParams.get('feed'));
  if (!feed) return NextResponse.json({ error: 'feed must be sunrise or sunset' }, { status: 400 });

  const studio = request.nextUrl.searchParams.get('profile') === 'studio';
  if (studio) {
    const denied = await requireOwner();
    if (denied) return denied;
  }
  const profile = studio ? await getProfileSettings('studio') : await getLiveSettingsCached();
  const dials = dialsFrom(mergeSettings(SOLO_SETTINGS_SCHEMA, profile?.namespaces[SOLO_NAMESPACE]));

  const nowMs = Date.now();
  const [entries, screen, admitted] = await Promise.all([
    listActiveEntries(feed),
    getScreenState(feed),
    countAdmittedSince(feed, nowMs - LAST_PULL_WINDOW_MS),
  ]);
  return NextResponse.json(buildStateView({ feed, dials, entries, screen, nowMs, admitted }));
}
```

- [ ] **Step 6: Run tests**

Run: `npm run test -- app/api/kiosk/solo`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && git add app/api/kiosk/solo/view.ts app/api/kiosk/solo/view.test.ts app/api/kiosk/solo/state/route.ts app/api/kiosk/solo/state/route.test.ts && git commit -m "feat(solo): GET /api/kiosk/solo/state" && git push
```

---

### Task 10: `POST /api/kiosk/solo/advance`

**Files:**
- Create: `app/api/kiosk/solo/advance/route.ts`
- Test: `app/api/kiosk/solo/advance/route.test.ts`

**Interfaces:**
- Consumes: Task 5 `listActiveEntries`, `getScreenState`, `commitAdvance`, `countAdmittedSince`; Task 3 `next`, `afterShowing`; Task 9 `buildStateView`, `parseFeed`; Task 4 `slotFor`.
- Produces: `POST { feed, slot }` → `StateView` (200). `slot` must be an integer within one slot of the server's own clock, else 400. Same slot twice → 200 with `advanced: false` and no write.

- [ ] **Step 1: Write the failing test**

```ts
// app/api/kiosk/solo/advance/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listActiveEntries = vi.fn();
const getScreenState = vi.fn();
const commitAdvance = vi.fn();
const countAdmittedSince = vi.fn();
const getLiveSettingsCached = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/solo/store', () => ({
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
  commitAdvance: (...a: unknown[]) => commitAdvance(...a),
  countAdmittedSince: (...a: unknown[]) => countAdmittedSince(...a),
}));
vi.mock('@/app/lib/settings/liveSettings', () => ({ getLiveSettingsCached: () => getLiveSettingsCached() }));

import { POST } from './route';

const entry = (id: number, q: number, tally = 0) => ({
  feed: 'sunset', snapshotId: id, webcamId: 100 + id, bin: 'sunset', quality: q, detection: 0.9,
  isNew: false, tally, enteredAt: id, firstShownAt: null, lastShownAt: null,
  imageUrl: `u${id}`, title: '', city: '', region: '', country: '', lat: 0, lng: 0,
});
const post = (body: unknown) =>
  POST(new Request('http://t/api/kiosk/solo/advance', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_000_000_000_000)); // slot 50_000_000 for dwell 20 / sunrise
  getLiveSettingsCached.mockResolvedValue({ namespaces: {}, revision: 1 });
  listActiveEntries.mockResolvedValue([entry(1, 0.9), entry(2, 0.8)]);
  getScreenState.mockResolvedValue(null);
  commitAdvance.mockResolvedValue(true);
  countAdmittedSince.mockResolvedValue({ sunset: 0, nonSunset: 0 });
});

describe('POST /api/kiosk/solo/advance', () => {
  it('rejects bad bodies', async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ feed: 'sunrise', slot: 'x' })).status).toBe(400);
  });
  it('rejects a slot far from the server clock', async () => {
    expect((await post({ feed: 'sunrise', slot: 1 })).status).toBe(400);
  });
  it('advances to the engine pick and commits it with the new streak', async () => {
    const res = await post({ feed: 'sunrise', slot: 50_000_000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.advanced).toBe(true);
    expect(commitAdvance).toHaveBeenCalledWith('sunrise', 50_000_000, expect.objectContaining({ snapshotId: 1 }), 1);
  });
  it('is a no-op for a slot already committed', async () => {
    getScreenState.mockResolvedValue({ feed: 'sunrise', currentSnapshotId: 1, shownSince: 1, slot: 50_000_000, sunsetStreak: 1 });
    const res = await post({ feed: 'sunrise', slot: 50_000_000 });
    expect((await res.json()).advanced).toBe(false);
    expect(commitAdvance).not.toHaveBeenCalled();
  });
  it('reports advanced:false when nothing is eligible', async () => {
    listActiveEntries.mockResolvedValue([entry(1, 0.1)]);
    const res = await post({ feed: 'sunrise', slot: 50_000_000 });
    expect((await res.json()).advanced).toBe(false);
    expect(commitAdvance).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm run test -- app/api/kiosk/solo/advance`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the route**

```ts
import { NextResponse } from 'next/server';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { mergeSettings } from '@/app/lib/settings/schema';
import { afterShowing, next } from '@/app/lib/solo/engine';
import { slotFor } from '@/app/lib/solo/schedule';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
import { commitAdvance, countAdmittedSince, getScreenState, listActiveEntries } from '@/app/lib/solo/store';
import { buildStateView, parseFeed } from '../view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LAST_PULL_WINDOW_MS = 10 * 60 * 1000;
/** A tab's clock may drift a little; anything further off is a bug, not a boundary. */
const SLOT_TOLERANCE = 1;

/**
 * The kiosk's "what's next" at a schedule boundary (spec §6.1, §6.2).
 * Unauthenticated like /api/kiosk/tick: the kiosk page is public and cannot
 * hold a credential. Idempotent on `slot`, so a double-fire or a second tab
 * lands on the same frame.
 */
export async function POST(request: Request) {
  let body: { feed?: unknown; slot?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const feed = parseFeed(typeof body.feed === 'string' ? body.feed : null);
  const slot = typeof body.slot === 'number' && Number.isInteger(body.slot) ? body.slot : null;
  if (!feed || slot === null) {
    return NextResponse.json({ error: 'feed and integer slot required' }, { status: 400 });
  }

  const live = await getLiveSettingsCached();
  const dials = dialsFrom(mergeSettings(SOLO_SETTINGS_SCHEMA, live?.namespaces[SOLO_NAMESPACE]));
  const nowMs = Date.now();
  const serverSlot = slotFor(nowMs, feed, dials.dwellS, dials.offsetS);
  if (Math.abs(slot - serverSlot) > SLOT_TOLERANCE) {
    return NextResponse.json({ error: `slot ${slot} is not near ${serverSlot}` }, { status: 400 });
  }

  const [entries, screenBefore] = await Promise.all([listActiveEntries(feed), getScreenState(feed)]);
  let advanced = false;
  let screen = screenBefore;
  if (screenBefore?.slot !== slot) {
    const state = { lastSnapshotId: screenBefore?.currentSnapshotId ?? null, sunsetStreak: screenBefore?.sunsetStreak ?? 0 };
    const pick = next(entries, dials, state);
    if (pick) {
      const after = afterShowing(pick, state);
      advanced = await commitAdvance(feed, slot, pick, after.sunsetStreak);
      if (advanced) {
        const stored = entries.find((e) => e.snapshotId === pick.snapshotId)!;
        stored.tally += 1;
        stored.isNew = false;
        screen = { feed, currentSnapshotId: pick.snapshotId, shownSince: nowMs, slot, sunsetStreak: after.sunsetStreak };
      }
    }
  }
  const admitted = await countAdmittedSince(feed, nowMs - LAST_PULL_WINDOW_MS);
  return NextResponse.json({
    advanced,
    ...buildStateView({ feed, dials, entries, screen, nowMs, admitted }),
  });
}
```

- [ ] **Step 4: Run tests and lint**

Run: `npm run test -- app/api/kiosk/solo && npm run lint`
Expected: PASS, clean lint. If the fake-timer slot in the test does not equal what `slotFor` computes for `1_000_000_000_000 / 20_000`, it is `50_000_000`; the test constant is right, check `dwellS` came through as 20.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && git add app/api/kiosk/solo/advance/route.ts app/api/kiosk/solo/advance/route.test.ts && git commit -m "feat(solo): POST /api/kiosk/solo/advance, idempotent on the schedule slot" && git push
```

---

### Task 11: Full suite, build, PR

**Files:** none new.

- [ ] **Step 1: Whole suite and build**

Run: `npm run test -- --run && npm run lint && npm run build`
Expected: all green. The build must not pull `server-only` modules into a client bundle; nothing in this phase is imported by a client component.

- [ ] **Step 2: Migration status check**

Run: `npm run migrate:status`
Expected: exit 1, listing `20260904_kiosk_bins.sql` as pending. That is correct: the operator applies it before merge with

```
node scripts/apply-migration.mjs database/migrations/20260904_kiosk_bins.sql --from feat/solo-kiosk --apply
```

- [ ] **Step 3: Open the PR**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-kiosk" ] && gh pr create --title "feat(solo): server side of the solo kiosk — bins, rule engine, admission, endpoints" --body-file - <<'EOF'
Phase 1 of docs/superpowers/specs/2026-09-04-solo-kiosk-design.md.

- `kiosk_bin_entries` + `kiosk_screen_state` (migration **must be applied before merge**; cron writes swallow their own errors)
- `solo` settings namespace (dials only; the renderer is phase 2, so `activeVersion` cannot select it yet)
- pure five-rule engine with the spec's three worked sequences as fixtures
- cron: frames the detection head calls a sunset, or scores ≥ 0.20, are archived with `intake_reason='kiosk_bin'` and entered in a bin; entries leave by zone (SunCalc altitude) after the grace, or after 24 h
- cron cadence `*/15` → `*/10` for the show (spec §5.3, reverts after)
- `GET /api/kiosk/solo/state?feed=` and `POST /api/kiosk/solo/advance`
- digest line: bins admitted / removed / waiting

Apply first:
    node scripts/apply-migration.mjs database/migrations/20260904_kiosk_bins.sql --from feat/solo-kiosk --apply

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_0125sgxgU6Co8b9ZQqCTzSw2
EOF
```

`EOF` must be flush-left.

---

## Self-review against the spec

- §4 rules 1–5: Task 3, with the three worked sequences as tests. ✔
- §5.1 table: Task 1 (no `manual` writer yet; the reason value is allowed for a later hand tool). ✔
- §5.2 table: Task 1, minus `last_snapshot_id` (stated in Global Constraints). ✔
- §5.3 cadence, admission floors, `kiosk_bin` intake, is_new, zone removal, absence-is-not-a-reason, 24 h expiry, grace from the live profile: Tasks 6, 7. ✔
- §5.4 calibrated quality, raw detection: Task 6. ✔
- §6.1 endpoints, studio profile owner-gated, idempotent advance: Tasks 9, 10. ✔
- §6.2 slot math: Task 4; tolerance check in Task 10. ✔
- §7 admission count in the digest and in the state response: Tasks 8, 9. ✔
- §9 tests: every bullet has a test above except "a reload lands on the next boundary", which is the kiosk's behaviour (phase 2) and is covered there.
- Types: `BinEntry`, `StoredEntry`, `ScreenRow`, `SoloDials`, `Zone`, `Admission`, `EntryView`, `StateView` are named identically in every task that uses them.
