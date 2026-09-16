# Glass Mirror Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two public pages, `/sunrise` and `/sunset`, that show what the glass shows, fed by a small edge-cached projection that advances the schedule on read, so the glass and the mirror are both followers of one server-side schedule.

**Architecture:** The draw logic leaves `POST /api/kiosk/solo/advance` for `app/lib/solo/advance.ts`, where `advanceIfDue` runs it when a request lands past the dwell's end. A new `GET /api/mirror/state` calls it, then answers with `MirrorView`: the current dwell's run resolved to frames, the next run for preload, the live solo2 dials, the panel preset, and the build stamp, under a one-second `s-maxage`. One client hook, `useGlassFollower`, fetches that at each boundary and never POSTs; `Solo2Kiosk` (the kiosk page's renderer) and the new `MirrorPage` both render through a split-out `Solo2Screen` from it.

**Tech Stack:** Next.js app router (route handlers, route groups), React 19 client components, Vitest + Testing Library (jsdom by default; `// @vitest-environment node` for route tests), Neon via `sql` in `app/lib/solo/store.ts`, Vercel CDN caching by `Cache-Control: s-maxage`.

**Spec:** `docs/superpowers/specs/2026-09-15-glass-mirror-pages-design.md` (parts 1 to 6; part 7, the mosaic retirement, is a separate PR and a separate plan).

## Global Constraints

- **Branch from the beat.** PR #216 (`feat/solo2-beat`) changes every solo2 file this plan touches (`advance/route.ts`, `versions.ts`, `store.ts`, `solo2/index.tsx`, `plan.ts`, `run.ts`). All code below is written against that branch. Create the worktree with `scripts/wt.sh new feat/glass-mirror feat/solo2-beat`; when #216 merges, `git rebase origin/main` before opening the PR. Do not open the PR against `main` while #216 is open.
- **Never `git add -A`.** Stage explicit paths. Verify the branch in the same command as every commit: `[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/glass-mirror" ] && git add ... && git commit ...`.
- **Push after every commit:** `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin feat/glass-mirror` (a plain `git push` hangs on this Mac's keychain prompt).
- **Commit trailers.** Every commit message ends with these two lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UVSR1oxGyybGRqZW5bwMjQ
  ```
- **Route files export only handler fields** (`GET`, `POST`, `dynamic`, `runtime`). Constants and pure helpers live in a sibling `view.ts`.
- **Cache header, verbatim:** `public, s-maxage=1, stale-while-revalidate=4`.
- **Follower timings, verbatim:** `FOLLOW_GRACE_MS = 700`, `RETRY_MS = 1_000`, `FOLLOW_PATIENCE_MS = 10_000`, `STATE_REFRESH_MS = 60_000`.
- **The mirror reads no query parameters** and never calls `/api/kiosk/state`, `/api/kiosk/tick`, `/api/kiosk/solo/state`, or `/api/kiosk/solo/advance`.
- **Only the live path advances.** `GET /api/kiosk/solo/state` is not touched by this plan.
- **Run tests with** `npx vitest run <path>`; the whole suite with `npx vitest run`; lint with `npm run lint`; the type check is `npm run build`.
- Deviations from the spec's sketch, decided here so executors do not re-decide them: the pages live in a route group `app/(mirror)/` so one layout covers both (the spec wrote `app/mirror/`, which would make the URLs `/mirror/...`); the projection carries `slot` at the top level and `current` in the state view's own shape rather than a `screen` block, so the follower is a drop-in for `useSoloGlass`'s return type.

---

## File map

| File | Responsibility |
| --- | --- |
| `app/lib/solo/advance.ts` (create) | `drawSlot`: one draw, extracted from the POST route. `advanceIfDue`: draw when the stored dwell has ended. `dwellEndMs`, `isDue`. |
| `app/lib/solo/advance.test.ts` (create) | Unit tests for the above with the store mocked. |
| `app/api/kiosk/solo/advance/route.ts` (modify) | Calls `drawSlot`; its own tests stay green unchanged. |
| `app/api/mirror/view.ts` (create) | `MirrorView` type, `MIRROR_CACHE_CONTROL`, `buildMirrorView` (pure). |
| `app/api/mirror/view.test.ts` (create) | Shape and trimming tests. |
| `app/api/mirror/state/route.ts` (create) | `GET`: live dials, two store reads, `advanceIfDue`, `buildMirrorView`, cache header. |
| `app/api/mirror/state/route.test.ts` (create) | Header, 400, advance on read, race, size guard. |
| `app/components/solo2/Solo2Screen.tsx` (create) | The renderer given a `SoloGlass` and dials. Body moved out of `Solo2Kiosk`. |
| `app/components/solo2/Solo2Screen.test.tsx` (create) | The rendering tests, moved from `index.test.tsx`, with a hand-built glass. |
| `app/components/solo2/useGlassFollower.ts` (create) | The follower hook. |
| `app/components/solo2/useGlassFollower.test.tsx` (create) | Boundary fetch, retry, patience, refresh, GET-only. |
| `app/components/solo2/index.tsx` (modify) | `Solo2Kiosk` = `useGlassFollower` + `Solo2Screen`. |
| `app/components/solo2/index.test.tsx` (modify) | Wiring tests only. |
| `app/kiosk/sunset/page.test.tsx`, `app/kiosk/sunrise/page.test.tsx` (modify) | One test each: `activeVersion: solo2` renders the solo2 component with the feed. |
| `app/(mirror)/layout.tsx` (create) | Black, full-window, centered, solo fonts, cursor visible. |
| `app/(mirror)/MirrorPage.tsx` (create) | `useGlassFollower` + `PanelFrame` + `Solo2Screen`. |
| `app/(mirror)/MirrorPage.test.tsx` (create) | Real hook, stubbed fetch: endpoints, GET-only, panel size, no overlay, black first. |
| `app/(mirror)/sunrise/page.tsx`, `app/(mirror)/sunset/page.tsx` (create) | Metadata + `<MirrorPage feed=... />`. |

---

### Task 0: Worktree on the beat branch

**Files:** none.

- [ ] **Step 1: Create the worktree from `feat/solo2-beat`**

```bash
cd ~/GitHub/the-sunset-webcam-map && git fetch origin feat/solo2-beat && scripts/wt.sh new feat/glass-mirror origin/feat/solo2-beat
```

Expected: a new directory `~/GitHub/the-sunset-webcam-map.worktrees/feat-glass-mirror` on branch `feat/glass-mirror`. Every later command in this plan runs from that directory.

- [ ] **Step 2: Prove the suite is green at the base**

Run: `npx vitest run app/api/kiosk/solo app/components/solo2`
Expected: all pass. If not, stop: the base is broken and the plan cannot tell its own failures from inherited ones.

---

### Task 1: `drawSlot` and `advanceIfDue`

**Files:**
- Create: `app/lib/solo/advance.ts`
- Create: `app/lib/solo/advance.test.ts`
- Modify: `app/api/kiosk/solo/advance/route.ts`

**Interfaces:**
- Consumes: `commitAdvance`, `getScreenState`, `ScreenRow`, `StoredEntry` from `app/lib/solo/store.ts`; `afterShowing` from `app/lib/solo/engine.ts`; `SoloVersionSpec` from `app/lib/solo/versions.ts`.
- Produces:
  ```ts
  export interface DrawInput { feed: Feed; version: SoloVersionSpec; dials: SoloDials; entries: StoredEntry[]; screenBefore: ScreenRow | null; slot: number; nowMs: number }
  export interface DrawResult { advanced: boolean; screen: ScreenRow | null }
  export function drawSlot(input: DrawInput): Promise<DrawResult>
  export function dwellEndMs(screen: ScreenRow | null): number | null
  export function isDue(screen: ScreenRow | null, nowMs: number): boolean
  export function advanceIfDue(input: Omit<DrawInput, 'slot'>): Promise<DrawResult>
  ```

- [ ] **Step 1: Write the failing tests**

`app/lib/solo/advance.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { SOLO2_SETTINGS_SCHEMA } from '@/app/lib/solo2/settingsSchema';

const commitAdvance = vi.fn();
const getScreenState = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/app/lib/solo/store', () => ({
  commitAdvance: (...a: unknown[]) => commitAdvance(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
}));

import { advanceIfDue, drawSlot, dwellEndMs, isDue } from './advance';

const solo = SOLO_VERSIONS.solo as SoloVersionSpec;
const solo2 = SOLO_VERSIONS.solo2 as SoloVersionSpec;
const D = solo.dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const D2 = solo2.dialsFrom(schemaDefaults(SOLO2_SETTINGS_SCHEMA));
const entry = (id: number, q: number, tally = 0) => ({
  feed: 'sunset' as const, snapshotId: id, webcamId: 100 + id, bin: 'sunset' as const, quality: q, detection: 0.9,
  isNew: false, tally, enteredAt: id, firstShownAt: null, lastShownAt: null,
  imageUrl: `u${id}`, title: '', city: '', region: '', country: '', lat: 0, lng: 0,
  capturedAt: 0, timezone: null, sunAltitudeDeg: null,
});
const NOW = Date.UTC(2026, 8, 15, 17, 30, 0);
const row = (slot: number, shownSince: number | null, dwellMs: number | null) => ({
  feed: 'sunset' as const, currentSnapshotId: 2, shownSince, slot, sunsetStreak: 1, dwellMs, shownSnapshotIds: [2],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  commitAdvance.mockResolvedValue(true);
  getScreenState.mockResolvedValue(null);
});
afterEach(() => vi.useRealTimers());

describe('dwellEndMs / isDue', () => {
  it('a row with a start and a span ends at their sum; anything less is due', () => {
    expect(dwellEndMs(row(4, NOW - 5_000, 20_000))).toBe(NOW + 15_000);
    expect(isDue(row(4, NOW - 5_000, 20_000), NOW)).toBe(false);
    expect(isDue(row(4, NOW - 25_000, 20_000), NOW)).toBe(true);
    expect(isDue(row(4, NOW - 20_000, 20_000), NOW)).toBe(true); // at the end is due
    expect(dwellEndMs(row(4, NOW, null))).toBeNull(); // a row from before the dwell was pinned
    expect(isDue(row(4, NOW, null), NOW)).toBe(true);
    expect(isDue(null, NOW)).toBe(true);
  });
});

describe('drawSlot', () => {
  it('draws the engine pick, commits it, and returns the new row with the pick', async () => {
    const entries = [entry(1, 0.9), entry(2, 0.8)];
    const r = await drawSlot({ feed: 'sunset', version: solo, dials: D, entries, screenBefore: null, slot: 0, nowMs: NOW });
    expect(r.advanced).toBe(true);
    expect(r.screen).toMatchObject({ feed: 'sunset', currentSnapshotId: 1, slot: 0, sunsetStreak: 1, shownSnapshotIds: [1], shownSince: NOW });
    expect(commitAdvance).toHaveBeenCalledWith('sunset', 0, expect.objectContaining({ snapshotId: 1 }), 1,
      [expect.objectContaining({ snapshotId: 1 })], 'solo', D.dwellS * 1000, NOW);
    expect(entries[0].tally).toBe(1); // the frames shown are marked in the pool the caller holds
  });
  it('is a no-op for the slot already on the row', async () => {
    const r = await drawSlot({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: row(7, NOW, 20_000), slot: 7, nowMs: NOW });
    expect(r).toEqual({ advanced: false, screen: row(7, NOW, 20_000) });
    expect(commitAdvance).not.toHaveBeenCalled();
  });
  it('returns the old row when nothing is eligible', async () => {
    const floor3 = solo.dialsFrom({ ...schemaDefaults(SOLO_SETTINGS_SCHEMA), ratingFloor: 3 });
    const r = await drawSlot({ feed: 'sunset', version: solo, dials: floor3, entries: [entry(1, 0.1)], screenBefore: null, slot: 0, nowMs: NOW });
    expect(r).toEqual({ advanced: false, screen: null });
    expect(commitAdvance).not.toHaveBeenCalled();
  });
  it('returns the old row when the commit loses the race', async () => {
    commitAdvance.mockResolvedValue(false);
    const entries = [entry(1, 0.9)];
    const r = await drawSlot({ feed: 'sunset', version: solo, dials: D, entries, screenBefore: null, slot: 0, nowMs: NOW });
    expect(r).toEqual({ advanced: false, screen: null });
    expect(entries[0].tally).toBe(0);
  });
  it('solo2 starts the dwell on the nearest tick', async () => {
    const r = await drawSlot({ feed: 'sunset', version: solo2, dials: D2, entries: [entry(1, 0.9)], screenBefore: null, slot: 0, nowMs: NOW + 300 });
    expect(r.screen?.shownSince).toBe(NOW);
    expect(commitAdvance).toHaveBeenLastCalledWith('sunset', 0, expect.anything(), expect.any(Number), expect.any(Array), 'solo2', expect.any(Number), NOW);
  });
});

describe('advanceIfDue', () => {
  it('leaves a running dwell alone', async () => {
    const before = row(4, NOW - 5_000, 20_000);
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: before, nowMs: NOW });
    expect(r).toEqual({ advanced: false, screen: before });
    expect(commitAdvance).not.toHaveBeenCalled();
    expect(getScreenState).not.toHaveBeenCalled();
  });
  it('draws the next slot once the dwell has ended', async () => {
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9), entry(2, 0.8)], screenBefore: row(4, NOW - 25_000, 20_000), nowMs: NOW });
    expect(r.advanced).toBe(true);
    expect(r.screen?.slot).toBe(5);
    expect(commitAdvance).toHaveBeenCalledWith('sunset', 5, expect.anything(), expect.any(Number), expect.any(Array), 'solo', expect.any(Number), expect.any(Number));
  });
  it('draws slot 0 when there is no row', async () => {
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: null, nowMs: NOW });
    expect(r.screen?.slot).toBe(0);
  });
  it('a row from before the dwell was pinned is due', async () => {
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: row(4, NOW, null), nowMs: NOW });
    expect(r.screen?.slot).toBe(5);
  });
  it('the loser of a race answers with the winner\'s row', async () => {
    commitAdvance.mockResolvedValue(false);
    const winner = row(5, NOW, 20_000);
    getScreenState.mockResolvedValue(winner);
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: D, entries: [entry(1, 0.9)], screenBefore: row(4, NOW - 25_000, 20_000), nowMs: NOW });
    expect(r).toEqual({ advanced: false, screen: winner });
    expect(getScreenState).toHaveBeenCalledWith('sunset');
  });
  it('re-reads the row when nothing was eligible, so the answer is whatever stands', async () => {
    const floor3 = solo.dialsFrom({ ...schemaDefaults(SOLO_SETTINGS_SCHEMA), ratingFloor: 3 });
    const stale = row(4, NOW - 25_000, 20_000);
    getScreenState.mockResolvedValue(stale);
    const r = await advanceIfDue({ feed: 'sunset', version: solo, dials: floor3, entries: [entry(1, 0.1)], screenBefore: stale, nowMs: NOW });
    expect(r).toEqual({ advanced: false, screen: stale });
    expect(commitAdvance).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run app/lib/solo/advance.test.ts`
Expected: FAIL, `Cannot find module './advance'`.

- [ ] **Step 3: Write `app/lib/solo/advance.ts`**

```ts
import { afterShowing } from '@/app/lib/solo/engine';
import type { SoloVersionSpec } from '@/app/lib/solo/versions';
import { commitAdvance, getScreenState, type ScreenRow, type StoredEntry } from '@/app/lib/solo/store';
import type { Feed, SoloDials } from '@/app/lib/solo/types';

export interface DrawInput {
  feed: Feed;
  version: SoloVersionSpec;
  dials: SoloDials;
  /** The pool as read for this draw. MUTATED on success: the frames shown get their tally bumped, as the pool row does. */
  entries: StoredEntry[];
  screenBefore: ScreenRow | null;
  slot: number;
  nowMs: number;
}

export interface DrawResult {
  advanced: boolean;
  /** The row after this call: the new one on success, otherwise what the caller passed in (or, for advanceIfDue, a fresh read). */
  screen: ScreenRow | null;
}

/**
 * One draw for `slot`: the engine's pick, the frames it plays, the dwell's
 * span and start, committed in one compare-and-set on the screen row. This
 * is the body POST /api/kiosk/solo/advance has always run; it lives here so
 * a GET that finds a dwell over can run the same one (mirror spec §4.1).
 * Idempotent on the slot: the row's own slot is a no-op, and a lost race
 * (`commitAdvance` false) leaves the pool untouched.
 */
export async function drawSlot(input: DrawInput): Promise<DrawResult> {
  const { feed, version, dials, entries, screenBefore, slot, nowMs } = input;
  if (screenBefore?.slot === slot) return { advanced: false, screen: screenBefore };
  const state = {
    lastSnapshotId: screenBefore?.currentSnapshotId ?? null,
    sunsetStreak: screenBefore?.sunsetStreak ?? 0,
  };
  const pick = version.next(entries, dials, state, slot, feed);
  if (!pick) return { advanced: false, screen: screenBefore };
  const after = afterShowing(pick, state);
  const shown = version.shown(entries, pick, dials);
  // Decided ONCE, here, against the pool this draw actually saw, and stored
  // beside the start instant. Every surface reads it back rather than
  // working it out again from a pool that has since moved.
  const dwellMs = version.dwellMs(entries, pick, dials);
  // On the beat the dwell begins on the tick, not when the request landed
  // (beat spec §2.6); solo starts now.
  const startMs = version.startMs(nowMs, dials);
  const advanced = await commitAdvance(feed, slot, pick, after.sunsetStreak, shown, version.name, dwellMs, startMs);
  if (!advanced) return { advanced: false, screen: screenBefore };
  for (const f of shown) {
    const stored = entries.find((e) => e.snapshotId === f.snapshotId)!;
    stored.tally += 1;
    stored.isNew = false;
    stored.lastShownAt = startMs;
  }
  return {
    advanced: true,
    screen: {
      feed, currentSnapshotId: pick.snapshotId, shownSince: startMs, slot, sunsetStreak: after.sunsetStreak,
      dwellMs, shownSnapshotIds: shown.map((e) => e.snapshotId),
    },
  };
}

/** When the stored dwell ends, or null for a row that has no start or no span (which counts as over). */
export function dwellEndMs(screen: ScreenRow | null): number | null {
  if (!screen || screen.shownSince == null || screen.dwellMs == null) return null;
  return screen.shownSince + screen.dwellMs;
}

export function isDue(screen: ScreenRow | null, nowMs: number): boolean {
  const end = dwellEndMs(screen);
  return end == null || end <= nowMs;
}

/**
 * Advance on read (mirror spec §4.1): when the stored dwell is over, draw
 * the next slot. Any number of readers past the same end produce one draw,
 * because the commit is a compare-and-set on the slot; a reader that did
 * not win, or found nothing eligible, answers with the row as it now stands
 * rather than the one it read before trying.
 */
export async function advanceIfDue(input: Omit<DrawInput, 'slot'>): Promise<DrawResult> {
  if (!isDue(input.screenBefore, input.nowMs)) return { advanced: false, screen: input.screenBefore };
  const slot = (input.screenBefore?.slot ?? -1) + 1;
  const result = await drawSlot({ ...input, slot });
  if (result.advanced) return result;
  return { advanced: false, screen: await getScreenState(input.feed) };
}
```

- [ ] **Step 4: Run the new tests**

Run: `npx vitest run app/lib/solo/advance.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Make the POST route call `drawSlot`**

In `app/api/kiosk/solo/advance/route.ts`, replace the block from `let advanced = false;` through the closing brace of `if (screenBefore?.slot !== slot) { ... }` with:

```ts
  const { advanced, screen } = await drawSlot({ feed, version, dials, entries, screenBefore, slot, nowMs });
```

Remove the now-unused imports `afterShowing` (from `@/app/lib/solo/engine`) and `commitAdvance` (from the store import list), and add:

```ts
import { drawSlot } from '@/app/lib/solo/advance';
```

The response block below it (`countAdmittedSince`, `getSweptZone`, `buildStateView`) is unchanged.

- [ ] **Step 6: Run the route's existing tests and lint**

Run: `npx vitest run app/api/kiosk/solo/advance && npm run lint`
Expected: the route tests PASS unchanged (they are the regression guard for the extraction); lint clean.

- [ ] **Step 7: Commit and push**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/glass-mirror" ] && git add app/lib/solo/advance.ts app/lib/solo/advance.test.ts app/api/kiosk/solo/advance/route.ts && git commit -m "refactor(solo): extract the draw into lib/solo/advance with advanceIfDue" -m "One definition of a draw, so a GET past the dwell's end can run the same one the kiosk's POST does (mirror spec §4.1)." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVSR1oxGyybGRqZW5bwMjQ" && GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin feat/glass-mirror
```

---

### Task 2: `buildMirrorView`

**Files:**
- Create: `app/api/mirror/view.ts`
- Create: `app/api/mirror/view.test.ts`

**Interfaces:**
- Consumes: `buildStateView`, `EntryView`, `ViewEntry`, `StateView` from `app/api/kiosk/solo/view.ts`; `ScreenRow` from the store; `SOLO_VERSIONS`.
- Produces:
  ```ts
  export const MIRROR_CACHE_CONTROL = 'public, s-maxage=1, stale-while-revalidate=4';
  export interface MirrorView { feed: Feed; version: 'solo2'; panelPreset: string; dials: Solo2Dials; slot: number; current: StateView['current']; entries: EntryView[]; next: EntryView[]; build: string }
  export function buildMirrorView(input: { feed: Feed; dials: Solo2Dials; entries: ViewEntry[]; screen: ScreenRow | null; nowMs: number; panelPreset: string; build: string }): MirrorView
  ```
  `next` is the projected next dwell's frames in play order, drawn frame last. `entries` is the current run plus `next`, deduplicated.

- [ ] **Step 1: Write the failing tests**

`app/api/mirror/view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import { buildStateView } from '@/app/api/kiosk/solo/view';
import { buildMirrorView, MIRROR_CACHE_CONTROL } from './view';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const solo2 = SOLO_VERSIONS.solo2 as SoloVersionSpec;
// Camera 7 has frames 1, 2, 3 (oldest to newest); camera 8 has frame 9; camera 6 has 4 and 5.
const entry = (id: number, capturedAt: number, webcamId = 7, quality = 0.9) => ({
  snapshotId: id, webcamId, bin: 'sunset' as const, quality, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  lastShownAt: null, imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C',
  capturedAt, timezone: null, sunAltitudeDeg: null,
});
const pool = [entry(1, 100), entry(2, 200), entry(3, 300), entry(9, 250, 8, 0.8), entry(4, 100, 6, 0.7), entry(5, 200, 6, 0.7)];
const NOW = 1_000_000_000_000;
const base = { feed: 'sunset' as const, dials: D, entries: pool, nowMs: NOW, panelPreset: 'dell-l', build: 'b1' };
const ids = (xs: { snapshotId: number }[]) => xs.map((e) => e.snapshotId);

describe('buildMirrorView', () => {
  it('names the cache policy the route sets', () => {
    expect(MIRROR_CACHE_CONTROL).toBe('public, s-maxage=1, stale-while-revalidate=4');
  });
  it('resolves the pinned run in play order and carries the next run for preload, nothing wider', () => {
    const screen = { feed: 'sunset' as const, currentSnapshotId: 3, shownSince: NOW - 4_000, slot: 12, sunsetStreak: 1, dwellMs: 20_000, shownSnapshotIds: [1, 3] };
    const v = buildMirrorView({ ...base, screen });
    expect(v.feed).toBe('sunset');
    expect(v.version).toBe('solo2');
    expect(v.slot).toBe(12);
    expect(v.panelPreset).toBe('dell-l');
    expect(v.build).toBe('b1');
    expect(v.dials.beatS).toBe(D.beatS);
    expect(v.current?.entry.snapshotId).toBe(3);
    expect(v.current?.shownSnapshotIds).toEqual([1, 3]);
    expect(v.current?.endsAtMs).toBe(NOW + 16_000);
    // The next run is what the engine's first projected draw would play: the
    // same answer the state view gives, so the mirror is a trim, not a second
    // opinion.
    const state = buildStateView({ feed: 'sunset', dials: D, entries: pool, screen, nowMs: NOW, admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: 0, maxDeg: 0 }, version: solo2 });
    const expectedNext = ids(solo2.shown(pool, state.next[0], D));
    expect(expectedNext.length).toBeGreaterThan(0);
    expect(ids(v.next)).toEqual(expectedNext);
    expect(ids(v.entries)).toEqual([...new Set([1, 3, ...expectedNext])]);
    expect(v).not.toHaveProperty('bins');
    expect(v).not.toHaveProperty('tape');
    expect(v).not.toHaveProperty('zone');
  });
  it('omits a pinned frame the pool has dropped, keeping the pinned ids so the step rate holds', () => {
    const screen = { feed: 'sunset' as const, currentSnapshotId: 3, shownSince: NOW, slot: 1, sunsetStreak: 1, dwellMs: 20_000, shownSnapshotIds: [1, 2, 3] };
    const v = buildMirrorView({ ...base, entries: pool.filter((e) => e.snapshotId !== 2), screen });
    expect(v.current?.shownSnapshotIds).toEqual([1, 2, 3]);
    expect(ids(v.entries).slice(0, 2)).toEqual([1, 3]);
  });
  it('a row from before the dwell was pinned yields the drawn frame alone, never a re-derived run', () => {
    const screen = { feed: 'sunset' as const, currentSnapshotId: 3, shownSince: NOW, slot: 1, sunsetStreak: 1, dwellMs: null, shownSnapshotIds: null };
    const v = buildMirrorView({ ...base, screen });
    expect(v.current?.shownSnapshotIds).toEqual([3]);
    expect(ids(v.entries)[0]).toBe(3);
    expect(ids(v.entries)).not.toContain(1);
  });
  it('with no row: slot 0, no current, and the next run to preload', () => {
    const v = buildMirrorView({ ...base, screen: null });
    expect(v.slot).toBe(0);
    expect(v.current).toBeNull();
    expect(v.next.length).toBeGreaterThan(0);
    expect(ids(v.entries)).toEqual(ids(v.next));
  });
  it('keeps the slot when the frame on glass has aged out of the pool', () => {
    const screen = { feed: 'sunset' as const, currentSnapshotId: 77, shownSince: NOW, slot: 41, sunsetStreak: 1, dwellMs: 20_000, shownSnapshotIds: [77] };
    const v = buildMirrorView({ ...base, screen });
    expect(v.slot).toBe(41);
    expect(v.current).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run app/api/mirror/view.test.ts`
Expected: FAIL, `Cannot find module './view'`.

- [ ] **Step 3: Write `app/api/mirror/view.ts`**

```ts
import { buildStateView, type EntryView, type StateView, type ViewEntry } from '@/app/api/kiosk/solo/view';
import type { ScreenRow } from '@/app/lib/solo/store';
import type { Feed } from '@/app/lib/solo/types';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import type { Solo2Dials } from '@/app/lib/solo2/types';

/**
 * One second at the edge (mirror spec §4.1). The beat gives a follower one
 * beat to see a new slot, and one origin call per second per feed per region
 * is the cost ceiling whatever the visitor count. The stale window is what
 * the follower's retry tolerates, not a longer TTL.
 */
export const MIRROR_CACHE_CONTROL = 'public, s-maxage=1, stale-while-revalidate=4';

/**
 * What one follower needs for one feed, and nothing the operator's studio
 * view carries: no bins, no tape, no queue beyond the next draw. The state
 * view is a megabyte; this is a few tens of KB.
 */
export interface MirrorView {
  feed: Feed;
  version: 'solo2';
  /** The live panelPreset name, so a follower scales to the glass's size. */
  panelPreset: string;
  /** The same Solo2Dials the server built for the engine, caption included. */
  dials: Solo2Dials;
  /** The screen's slot counter, whether or not anything is drawable; a follower watches it to know the glass moved. */
  slot: number;
  /** As the state view has it; null when the row has no frame or its frame left the pool. */
  current: StateView['current'];
  /**
   * The current run resolved to frames (play order, drawn frame last,
   * frames the pool has since dropped omitted), then the next run. The
   * renderer resolves `current.shownSnapshotIds` against this and preloads
   * the rest.
   */
  entries: EntryView[];
  /** The projected next dwell's frames, play order, drawn frame last. */
  next: EntryView[];
  build: string;
}

export function buildMirrorView(input: {
  feed: Feed;
  dials: Solo2Dials;
  entries: ViewEntry[];
  screen: ScreenRow | null;
  nowMs: number;
  panelPreset: string;
  build: string;
}): MirrorView {
  const version = SOLO_VERSIONS.solo2 as SoloVersionSpec;
  // The state view already ranks, stages and projects the queue with this
  // engine; the mirror is a trim of it, not a second derivation. Admitted
  // counts and the zone are pass-through fields it does not carry.
  const state = buildStateView({
    feed: input.feed, dials: input.dials, entries: input.entries, screen: input.screen, nowMs: input.nowMs,
    admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: 0, maxDeg: 0 }, version,
  });
  const all = new Map<number, EntryView>();
  for (const e of [...(state.current ? [state.current.entry] : []), ...state.next, ...state.bins.sunset, ...state.bins.nonSunset]) {
    all.set(e.snapshotId, e);
  }
  // The pinned ids from the ROW, not the state view's, which re-derives a
  // run for an unpinned row. The mirror does not: such a row plays the drawn
  // frame alone (spec §4.1).
  const pinnedIds = input.screen?.shownSnapshotIds?.length ? input.screen.shownSnapshotIds : null;
  const currentIds = state.current ? pinnedIds ?? [state.current.entry.snapshotId] : [];
  const run = currentIds.map((id) => all.get(id)).filter((e): e is EntryView => !!e);
  const first = state.next[0];
  const next = first
    ? version.shown(input.entries, first, input.dials).map((e) => all.get(e.snapshotId)).filter((e): e is EntryView => !!e)
    : [];
  const seen = new Set(run.map((e) => e.snapshotId));
  const entries = [...run, ...next.filter((e) => !seen.has(e.snapshotId))];
  return {
    feed: input.feed,
    version: 'solo2',
    panelPreset: input.panelPreset,
    dials: input.dials,
    slot: state.schedule.slot,
    current: state.current ? { ...state.current, shownSnapshotIds: currentIds } : null,
    entries,
    next,
    build: input.build,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/api/mirror/view.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit and push**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/glass-mirror" ] && git add app/api/mirror/view.ts app/api/mirror/view.test.ts && git commit -m "feat(mirror): buildMirrorView, the follower's trim of the state view" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVSR1oxGyybGRqZW5bwMjQ" && GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/glass-mirror
```

---

### Task 3: `GET /api/mirror/state`

**Files:**
- Create: `app/api/mirror/state/route.ts`
- Create: `app/api/mirror/state/route.test.ts`

**Interfaces:**
- Consumes: `advanceIfDue` (Task 1), `buildMirrorView` and `MIRROR_CACHE_CONTROL` (Task 2), `parseFeed` and `toViewEntry` from the kiosk solo view, `getLiveSettingsCached`, `listActiveEntries`, `getScreenState`, `BUILD_ID`, `SHARED_SCHEMA`/`SHARED_NAMESPACE`, `withCaption`, `mergeSettings`.
- Produces: `GET /api/mirror/state?feed=<sunrise|sunset>` → `MirrorView` JSON with `Cache-Control: public, s-maxage=1, stale-while-revalidate=4`; 400 on any other feed.

- [ ] **Step 1: Write the failing tests**

`app/api/mirror/state/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const listActiveEntries = vi.fn();
const getScreenState = vi.fn();
const commitAdvance = vi.fn();
const getLiveSettingsCached = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/app/lib/solo/store', () => ({
  listActiveEntries: (...a: unknown[]) => listActiveEntries(...a),
  getScreenState: (...a: unknown[]) => getScreenState(...a),
  commitAdvance: (...a: unknown[]) => commitAdvance(...a),
}));
vi.mock('@/app/lib/settings/liveSettings', () => ({ getLiveSettingsCached: () => getLiveSettingsCached() }));

import { GET } from './route';

const get = (qs: string) => GET(new NextRequest(`http://t/api/mirror/state${qs}`));
const entry = (id: number, capturedAt: number, webcamId = 7, quality = 0.9) => ({
  feed: 'sunset', snapshotId: id, webcamId, bin: 'sunset', quality, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  firstShownAt: null, lastShownAt: null, imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '', lat: 0, lng: 0,
  capturedAt, timezone: null, sunAltitudeDeg: null,
});
const NOW = Date.UTC(2026, 8, 15, 17, 30, 0);
const row = (slot: number, shownSince: number, dwellMs: number, currentSnapshotId = 3) => ({
  feed: 'sunset', currentSnapshotId, shownSince, slot, sunsetStreak: 1, dwellMs, shownSnapshotIds: [1, 3],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  getLiveSettingsCached.mockResolvedValue({ namespaces: { shared: { panelPreset: 'ktc-l' }, solo2: { valleys: 0 } }, revision: 1 });
  listActiveEntries.mockResolvedValue([entry(1, 100), entry(2, 200), entry(3, 300), entry(9, 250, 8, 0.8)]);
  getScreenState.mockResolvedValue(null);
  commitAdvance.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

describe('GET /api/mirror/state', () => {
  it('rejects a bad or missing feed', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?feed=noon')).status).toBe(400);
  });
  it('is cacheable at the edge for one second', async () => {
    const res = await get('?feed=sunset');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=1, stale-while-revalidate=4');
  });
  it('carries the live panel preset, the solo2 dials with caption, and the build', async () => {
    const body = await (await get('?feed=sunset')).json();
    expect(body.version).toBe('solo2');
    expect(body.panelPreset).toBe('ktc-l');
    expect(body.dials.beatS).toBeGreaterThan(0);
    expect(body.dials.cameraRun).toBeDefined();
    expect(typeof body.build).toBe('string');
  });
  it('leaves a running dwell alone', async () => {
    getScreenState.mockResolvedValue(row(12, NOW - 4_000, 20_000));
    const body = await (await get('?feed=sunset')).json();
    expect(commitAdvance).not.toHaveBeenCalled();
    expect(body.slot).toBe(12);
    expect(body.current.entry.snapshotId).toBe(3);
    expect(body.current.endsAtMs).toBe(NOW + 16_000);
  });
  it('draws the next slot when the dwell is over, and answers with the new one', async () => {
    getScreenState.mockResolvedValue(row(12, NOW - 30_000, 20_000));
    const body = await (await get('?feed=sunset')).json();
    expect(commitAdvance).toHaveBeenCalledWith('sunset', 13, expect.anything(), expect.any(Number), expect.any(Array), 'solo2', expect.any(Number), expect.any(Number));
    expect(body.slot).toBe(13);
    expect(body.current.shownSince).toBe(NOW); // on the tick
  });
  it('draws slot 0 when there is no row', async () => {
    const body = await (await get('?feed=sunset')).json();
    expect(commitAdvance).toHaveBeenCalledWith('sunset', 0, expect.anything(), expect.any(Number), expect.any(Array), 'solo2', expect.any(Number), expect.any(Number));
    expect(body.slot).toBe(0);
  });
  it('a reader that loses the race answers with the winner\'s row', async () => {
    getScreenState.mockResolvedValueOnce(row(12, NOW - 30_000, 20_000)).mockResolvedValueOnce(row(13, NOW, 20_000));
    commitAdvance.mockResolvedValue(false);
    const body = await (await get('?feed=sunset')).json();
    expect(getScreenState).toHaveBeenCalledTimes(2);
    expect(body.slot).toBe(13);
  });
  it('sends the run and the next run, not the pool', async () => {
    const big = Array.from({ length: 800 }, (_, i) => entry(1000 + i, i, 200 + (i % 150), 0.5));
    listActiveEntries.mockResolvedValue([entry(1, 100), entry(2, 200), entry(3, 300), ...big]);
    getScreenState.mockResolvedValue(row(12, NOW - 4_000, 20_000));
    const body = await (await get('?feed=sunset')).json();
    // A run is bounded by the frame cap and a camera has about five frames here; the point is "not 800".
    expect(body.entries.length).toBeLessThan(80);
    expect(body).not.toHaveProperty('bins');
    expect(body).not.toHaveProperty('tape');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run app/api/mirror/state/route.test.ts`
Expected: FAIL, `Cannot find module './route'`.

- [ ] **Step 3: Write `app/api/mirror/state/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getLiveSettingsCached } from '@/app/lib/settings/liveSettings';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SHARED_NAMESPACE, SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import { getScreenState, listActiveEntries } from '@/app/lib/solo/store';
import { advanceIfDue } from '@/app/lib/solo/advance';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { BUILD_ID } from '@/app/lib/buildStamp';
import { parseFeed, toViewEntry } from '@/app/api/kiosk/solo/view';
import { buildMirrorView, MIRROR_CACHE_CONTROL } from '../view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * What every follower of one feed reads (mirror spec §4.1): the glass and
 * the public pages alike. Public, no profile, solo2 fixed. Two Neon reads,
 * then advance on read: if the stored dwell is over, this request draws the
 * next slot before answering, idempotently. Only this live path advances;
 * the studio's re-projection never does.
 */
export async function GET(request: NextRequest) {
  const feed = parseFeed(request.nextUrl.searchParams.get('feed'));
  if (!feed) return NextResponse.json({ error: 'feed must be sunrise or sunset' }, { status: 400 });
  const version = SOLO_VERSIONS.solo2 as SoloVersionSpec;

  const live = await getLiveSettingsCached();
  const shared = live?.namespaces[SHARED_NAMESPACE];
  // Built exactly as /api/kiosk/solo/state builds them, so a follower needs no settings fetch of its own.
  const dials = version.dialsFrom(withCaption(mergeSettings(version.schema, live?.namespaces[version.namespace]), shared)) as Solo2Dials;
  const panelPreset = String(mergeSettings(SHARED_SCHEMA, shared).panelPreset);

  const nowMs = Date.now();
  const [entries, screenBefore] = await Promise.all([listActiveEntries(feed), getScreenState(feed)]);
  const { screen } = await advanceIfDue({ feed, version, dials, entries, screenBefore, nowMs });
  const body = buildMirrorView({ feed, dials, entries: entries.map(toViewEntry), screen, nowMs, panelPreset, build: BUILD_ID });
  return NextResponse.json(body, { headers: { 'Cache-Control': MIRROR_CACHE_CONTROL } });
}
```

- [ ] **Step 4: Run the tests and lint**

Run: `npx vitest run app/api/mirror && npm run lint`
Expected: PASS (route 8, view 6); lint clean.

- [ ] **Step 5: Confirm the studio path is untouched**

Run: `git diff --stat origin/feat/solo2-beat -- app/api/kiosk/solo/state`
Expected: no output. The operator view is not part of this plan.

- [ ] **Step 6: Commit and push**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/glass-mirror" ] && git add app/api/mirror/state/route.ts app/api/mirror/state/route.test.ts && git commit -m "feat(mirror): GET /api/mirror/state, cached one second, advances on read" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVSR1oxGyybGRqZW5bwMjQ" && GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/glass-mirror
```

---

### Task 4: Split `Solo2Screen` out of `Solo2Kiosk`

A pure refactor: `Solo2Kiosk` keeps calling `useSoloGlass` for now. The rendering tests move to the new component; `index.test.tsx` keeps only the wiring test.

**Files:**
- Create: `app/components/solo2/Solo2Screen.tsx`
- Create: `app/components/solo2/Solo2Screen.test.tsx`
- Modify: `app/components/solo2/index.tsx`
- Modify: `app/components/solo2/index.test.tsx`

**Interfaces:**
- Consumes: `SoloGlass` from `app/components/solo/useSoloGlass.ts`; `Solo2Frame`, `useStage`, `fitPlan`, `changeBeatsOf`, `capFor`, `planDialsFor`, `runOf`.
- Produces:
  ```ts
  export function Solo2Screen(props: { glass: SoloGlass; dials: Solo2Dials; width: number; height: number; feed: Feed; debug?: boolean }): JSX.Element
  ```

- [ ] **Step 1: Write `Solo2Screen.test.tsx` (the rendering tests, moved)**

Create `app/components/solo2/Solo2Screen.test.tsx` with this header:

```tsx
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ARRIVAL_EASES } from '@/app/lib/solo2/veil';
import * as planModule from '@/app/lib/solo2/plan';
import { render, screen } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import type { SoloGlass } from '@/app/components/solo/useSoloGlass';
import { Solo2Screen } from './Solo2Screen';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const entry = (id: number, capturedAt: number, webcamId = 7) => ({
  snapshotId: id, webcamId, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt, timezone: null, sunAltitudeDeg: null, stage: { kind: 'inLine' as const, position: null },
});
const entries = [entry(1, 100), entry(2, 200), entry(3, 300), entry(9, 250, 8)];
const glass: SoloGlass = { current: entry(3, 300), shownSince: 0, next: null, slot: 1,
  endsAtMs: 20_000, boundaryMs: 20_000, error: null, queueLength: 1,
  nextEntries: [], entries, shownSnapshotIds: [] };
const draw = (g: SoloGlass, dials = D) =>
  render(<Solo2Screen glass={g} dials={dials} width={100} height={50} feed="sunset" />);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(20_000)); // the dwell began at 0: 20 s elapsed, so the run is on its last frame
});
afterEach(() => vi.useRealTimers());
```

Then copy every test from the current `index.test.tsx` **except** the first one ("asks the glass hook for solo2, drives by default, follows in a preview") into this file, converting each by these substitutions and nothing else:

| In `index.test.tsx` | In `Solo2Screen.test.tsx` |
| --- | --- |
| `render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />)` | `draw(glass)` |
| `mocked.mockImplementation(() => X); render(<Solo2Kiosk ... />)` | `draw(X)` |
| `render(<Solo2Kiosk ... settings={{ cameraRun: false }} />)` | `draw(glass, { ...D, cameraRun: false })` |
| `render(<Solo2Kiosk ... settings={{ transition: 'crossfade' }} />)` and the matching `rerender(...)` | `draw(glass, { ...D, transition: 'crossfade' })` and `rerender(<Solo2Screen glass={...} dials={{ ...D, transition: 'crossfade' }} width={100} height={50} feed="sunset" />)` |
| `mocked.mockImplementation(() => Y); rerender(<Solo2Kiosk ... />)` | `rerender(<Solo2Screen glass={Y} dials={D} width={100} height={50} feed="sunset" />)` |

The converted tests, by name, all of which must be present:
`late in the dwell, draws the drawn frame with its caption`;
`at the start of the dwell, the camera run begins at its oldest frame`;
`with the camera run off, the dwell is the drawn frame alone`;
`the dwell clock starts at the server's shown-since, so a follower joins the run in the right place`;
`a new frame on glass arrives with the old one as its previous in the same render, and restarts the clock`;
`a follower whose published end moves without a new frame keeps its dwell clock`;
`plays the frames the draw pinned, in the order it pinned them`;
`steps on the beat, not the span the server happens to publish`;
`does not step backwards when the pool grows under a running dwell`;
`a frame the pool dropped mid-dwell costs its picture, never the step rate`;
`a pinned dwell reads its rest from the published span, not a re-rank of a moving pool`.

Two of them, fully converted, as the pattern:

```tsx
it('with the camera run off, the dwell is the drawn frame alone', () => {
  vi.setSystemTime(new Date(-19_500));
  draw(glass, { ...D, cameraRun: false });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
});

it('a new frame on glass arrives with the old one as its previous in the same render, and restarts the clock', () => {
  const fade = { ...D, transition: 'crossfade' as const };
  const { rerender } = render(<Solo2Screen glass={glass} dials={fade} width={100} height={50} feed="sunset" />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u1', 'u2', 'u3']);
  // Camera 8 goes on glass at 20 s.
  rerender(<Solo2Screen glass={{ ...glass, current: entry(9, 250, 8), shownSince: 20_000, endsAtMs: 40_000, boundaryMs: 40_000 }} dials={fade} width={100} height={50} feed="sunset" />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u3', 'u9']);
  expect(screen.getByTestId('stack'))
    .toHaveStyle({ animation: `solo2-fade-in 4s ${ARRIVAL_EASES.gentle} both` });
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u9');
});
```

- [ ] **Step 2: Run the new file to see it fail**

Run: `npx vitest run app/components/solo2/Solo2Screen.test.tsx`
Expected: FAIL, `Cannot find module './Solo2Screen'`.

- [ ] **Step 3: Create `Solo2Screen.tsx`**

Move the body of `Solo2Kiosk` (everything from `const current = glass.current;` to the end of the returned JSX) into:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { SoloGlass } from '@/app/components/solo/useSoloGlass';
import type { Feed } from '@/app/lib/solo/types';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { changeBeatsOf, fitPlan } from '@/app/lib/solo2/plan';
import { capFor, planDialsFor, runOf } from '@/app/lib/solo2/run';
import { Solo2Frame } from './Solo2Frame';
import { useStage } from './useStage';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function preload(url: string) {
  const img = new Image();
  img.src = url;
}

/**
 * What the glass remembers across dwells: the frame on glass, the one before
 * it, and when this dwell began. All three change in ONE state update when
 * the server's current frame changes, so no render sees a new frame with
 * the old previous, and a follower tab whose boundary ticks past without an
 * advance keeps the start it had (the audit of 2026-09-05 found both).
 */
interface Dwell {
  entry: EntryView | null;
  previous: EntryView | null;
  /** When the dwell began: the server's shown-since when it has one, else the boundary just passed. */
  startMs: number;
}

/**
 * The solo2 screen, given its source (mirror spec §5): the dwell state, the
 * pinned run and plan, the stage clock, the preload of the next run, and
 * the frame. It cannot tell whether `glass` came from the kiosk's hook or
 * the public follower, which is the point.
 */
export function Solo2Screen({ glass, dials, width, height, feed, debug = false }: {
  glass: SoloGlass;
  dials: Solo2Dials;
  width: number;
  height: number;
  feed: Feed;
  debug?: boolean;
}) {
  const current = glass.current;
  // The server stamps shown-since; without one, treat the dwell as starting
  // now rather than working backwards from an end and a dial, which a budget
  // makes wrong (spec §5.1).
  const startFor = () => glass.shownSince ?? Date.now();
  const [dwell, setDwell] = useState<Dwell>(() => ({ entry: current, previous: null, startMs: startFor() }));
  // Derived during render, so the new dwell and its previous frame commit together.
  if ((current?.snapshotId ?? null) !== (dwell.entry?.snapshotId ?? null)) {
    setDwell({ entry: current, previous: dwell.entry, startMs: startFor() });
  }
  const previous = dwell.previous;

  /**
   * The fallback is the old derivation, reached only for a screen row written
   * before the dwell was pinned.
   */
  const byId = new Map(glass.entries.map((e) => [e.snapshotId, e]));
  const pinnedIds = glass.shownSnapshotIds;
  // A frame the pool dropped mid-dwell cannot be drawn, but it keeps its place
  // in the timing: `plan.frames` stays the pinned count, so the step rate is
  // unchanged and only the missing picture is skipped.
  const pinnedRun = pinnedIds.map((id) => byId.get(id)).filter((e): e is EntryView => !!e);
  // The run the draw pinned. On the beat the plan is integers over that
  // count, so the glass can only land on the tick the server did; nothing
  // here re-reads the pool (beat spec §2.4).
  const pinned = pinnedRun.length > 0;
  const run = pinned
    ? pinnedRun
    : current ? runOf(current, glass.entries, dials.cameraRun, capFor(current, dials, glass.entries, dials.cameraRun)) : [];
  // When the draw is pinned, the server published the dwell's span; the rest
  // is whatever that span holds beyond the change and the frames. Read, not
  // re-derived: the pool moves every minute and the rank with it, and a plan
  // that follows the pool changes dwellS under a clock that has already
  // started (2026-09-08, again 2026-09-14).
  const plan = pinned && glass.endsAtMs != null && glass.shownSince != null
    ? fitPlan({
        ...dials,
        dwellBeats: Math.max(1, Math.round((glass.endsAtMs - glass.shownSince) / 1000 / dials.beatS) - changeBeatsOf(dials)),
      }, pinnedIds.length)
    : fitPlan(current ? planDialsFor(current, dials, glass.entries, dials.cameraRun) : dials, run.length);
  const stage = useStage(plan, dwell.startMs);

  // Preload the projected next frame and its run, so the arrival is clean.
  const nextEntry = glass.nextEntries[0] ?? null;
  const nextId = nextEntry?.snapshotId ?? null;
  useEffect(() => {
    if (!nextEntry) return;
    for (const f of runOf(nextEntry, glass.entries, dials.cameraRun, capFor(nextEntry, dials, glass.entries, dials.cameraRun))) preload(f.imageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextId, dials.cameraRun]);

  return (
    <div style={{ position: 'relative', width, height, background: '#000' }}>
      {current ? (
        <Solo2Frame entry={current} run={run} previous={previous} stage={stage} plan={plan} dials={dials} dwellKey={dwell.startMs}
          width={width} height={height} feed={feed} />
      ) : null}
      {debug && (
        <div style={{
          position: 'absolute', top: 8, left: 8, fontFamily: mono, fontSize: 12, color: '#7ee2ac',
          background: 'rgba(0,0,0,.7)', padding: '4px 8px', borderRadius: 4,
        }}>
          slot {glass.slot} · next in {Math.max(0, Math.ceil((glass.boundaryMs - Date.now()) / 1000))} s
          · queue {glass.queueLength} · frame {stage.index + 1}/{plan.frames} · lead {Math.round(stage.leadProgress * 100)}%
          {glass.error ? ` · ${glass.error}` : ''}
        </div>
      )}
    </div>
  );
}
```

This is the body of `Solo2Kiosk` on `feat/solo2-beat` verbatim, apart from `props.width`, `props.height`, `props.feed` becoming the bare props and the `const debug = ...` line becoming the `debug` prop. If the base branch's `index.tsx` differs from this text (a later commit on #216), the base wins: move what is there, apply the same four edits.

- [ ] **Step 4: Reduce `index.tsx` to the wrapper**

Replace `app/components/solo2/index.tsx` with:

```tsx
'use client';

import type { MosaicProps } from '@/app/components/mosaic/types';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { useSoloGlass } from '@/app/components/solo/useSoloGlass';
import { Solo2Screen } from './Solo2Screen';

/**
 * solo2 as a registered version (rhythm spec §5.3): solo's bins and
 * schedule, with rhythm decided on the server and the camera run, lead,
 * transition and local time drawn here.
 */
export function Solo2Kiosk(props: MosaicProps) {
  const dials = dialsFrom2(withCaption(mergeSettings(SOLO2_SETTINGS_SCHEMA, props.settings), props.shared));
  const glass = useSoloGlass({
    feed: props.feed,
    drive: props.driveSchedule !== false,
    dozing: props.dozing === true,
    version: 'solo2',
  });
  const debug = props.allowDebugOverlays !== false && (props.search ?? '').includes('debug=1');
  return <Solo2Screen glass={glass} dials={dials} width={props.width} height={props.height} feed={props.feed} debug={debug} />;
}
```

- [ ] **Step 5: Trim `index.test.tsx` to the wiring test**

Replace `app/components/solo2/index.test.tsx` with:

```tsx
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Solo2Kiosk } from './index';

const entry = (id: number) => ({
  snapshotId: id, webcamId: 7, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt: id * 100, timezone: null, sunAltitudeDeg: null, stage: { kind: 'inLine' as const, position: null },
});
const glass = { current: entry(3), shownSince: 0, next: null, slot: 1, endsAtMs: 20_000, boundaryMs: 20_000,
  error: null, queueLength: 1, nextEntries: [], entries: [entry(3)], shownSnapshotIds: [3] };
vi.mock('@/app/components/solo/useSoloGlass', () => ({ useSoloGlass: vi.fn(() => glass) }));
import { useSoloGlass } from '@/app/components/solo/useSoloGlass';

it('asks the glass hook for solo2, drives by default, follows in a preview, and draws the screen', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ version: 'solo2', drive: true, dozing: false }));
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" driveSchedule={false} dozing />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ drive: false, dozing: true }));
});
```

- [ ] **Step 6: Run both files, then everything that renders solo2**

Run: `npx vitest run app/components/solo2 app/kiosk app/studio/solo && npm run lint`
Expected: PASS everywhere (`Solo2Screen.test.tsx` 11, `index.test.tsx` 1); lint clean.

- [ ] **Step 7: Commit and push**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/glass-mirror" ] && git add app/components/solo2/Solo2Screen.tsx app/components/solo2/Solo2Screen.test.tsx app/components/solo2/index.tsx app/components/solo2/index.test.tsx && git commit -m "refactor(solo2): Solo2Screen renders a given glass; Solo2Kiosk supplies one" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVSR1oxGyybGRqZW5bwMjQ" && GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/glass-mirror
```

---

### Task 5: `useGlassFollower`

**Files:**
- Create: `app/components/solo2/useGlassFollower.ts`
- Create: `app/components/solo2/useGlassFollower.test.tsx`

**Interfaces:**
- Consumes: `MirrorView` (Task 2), `SoloGlass`, `useBuildReload`.
- Produces:
  ```ts
  export const STATE_REFRESH_MS = 60_000; export const FOLLOW_GRACE_MS = 700; export const RETRY_MS = 1_000; export const FOLLOW_PATIENCE_MS = 10_000;
  export interface GlassFollower extends SoloGlass { dials: Solo2Dials | null; panelPreset: string | null }
  export function useGlassFollower(feed: Feed): GlassFollower
  ```
  `next` and `nextEntries[0]` are the next dwell's **drawn** frame (the last of `MirrorView.next`); `entries` is `MirrorView.entries`.

- [ ] **Step 1: Write the failing tests**

`app/components/solo2/useGlassFollower.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { FOLLOW_GRACE_MS, FOLLOW_PATIENCE_MS, RETRY_MS, STATE_REFRESH_MS, useGlassFollower } from './useGlassFollower';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const entry = (id: number, webcamId = 7) => ({
  snapshotId: id, webcamId, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '', eligible: true, rank: 1,
  capturedAt: id * 100, timezone: null, sunAltitudeDeg: null, stage: { kind: 'inLine' as const, position: null },
});
const NOW = 1_000_000_000_000;
const DWELL = 20_000;
/** The projection for draw `n`: on glass since NOW + n·DWELL, ending a dwell later. */
const view = (n: number, opts: { current?: boolean } = {}) => ({
  feed: 'sunrise', version: 'solo2', panelPreset: 'dell-l', dials: D, slot: n, build: 'b1',
  current: opts.current === false ? null : {
    entry: entry(n + 1), shownSince: NOW + n * DWELL, slot: n, endsAtMs: NOW + (n + 1) * DWELL, shownSnapshotIds: [n + 1],
  },
  entries: [entry(n + 1), entry(50, 8), entry(51, 8)],
  next: [entry(50, 8), entry(51, 8)],
});

let calls: { url: string; method: string }[];
/** What the next fetch answers with. Tests reassign it to move the server along. */
let served: ReturnType<typeof view>;
const fetchMock = vi.fn();
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(5); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const fetches = () => calls.filter((c) => c.url.includes('/api/mirror/state')).length;

beforeEach(() => {
  calls = [];
  served = view(0);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.stubGlobal('Image', class { set src(_v: string) { /* preload */ } });
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return { ok: true, json: async () => served };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useGlassFollower', () => {
  it('reads the projection on mount and exposes it in the glass shape', async () => {
    const { result } = renderHook(() => useGlassFollower('sunrise'));
    expect(result.current.current).toBeNull();
    expect(result.current.dials).toBeNull();
    await flush();
    expect(calls[0]).toEqual({ url: '/api/mirror/state?feed=sunrise', method: 'GET' });
    expect(result.current.current?.snapshotId).toBe(1);
    expect(result.current.shownSince).toBe(NOW);
    expect(result.current.endsAtMs).toBe(NOW + DWELL);
    expect(result.current.shownSnapshotIds).toEqual([1]);
    expect(result.current.slot).toBe(0);
    expect(result.current.next?.snapshotId).toBe(51); // the next dwell's DRAWN frame, its run's last
    expect(result.current.nextEntries.map((e) => e.snapshotId)).toEqual([51]);
    expect(result.current.entries.map((e) => e.snapshotId)).toEqual([1, 50, 51]);
    expect(result.current.dials?.beatS).toBe(D.beatS);
    expect(result.current.panelPreset).toBe('dell-l');
  });
  it('fetches again just after the published end and adopts the new slot', async () => {
    const { result } = renderHook(() => useGlassFollower('sunrise'));
    await flush();
    served = view(1);
    await advance(DWELL + FOLLOW_GRACE_MS - 10);
    expect(fetches()).toBe(1);
    await advance(20);
    expect(fetches()).toBe(2);
    expect(result.current.slot).toBe(1);
    expect(result.current.endsAtMs).toBe(NOW + 2 * DWELL);
  });
  it('retries once a second while the slot has not moved, then stops after the patience window', async () => {
    renderHook(() => useGlassFollower('sunrise'));
    await flush();
    await advance(DWELL + FOLLOW_GRACE_MS + 5); // t ≈ 20.7 s: the boundary fetch finds slot 0 still
    expect(fetches()).toBe(2);
    await advance(RETRY_MS * 3 + 5); // t ≈ 23.7 s: three retries
    expect(fetches()).toBe(5);
    await advance(FOLLOW_PATIENCE_MS); // t ≈ 33.7 s: retries stopped at 30.7 s
    const afterPatience = fetches();
    await advance(RETRY_MS * 5); // t ≈ 38.7 s, before the minute refresh
    expect(fetches()).toBe(afterPatience); // parked
  });
  it('resumes boundary timing when a refresh brings a future end', async () => {
    const { result } = renderHook(() => useGlassFollower('sunrise'));
    await flush();
    const toParked = DWELL + FOLLOW_GRACE_MS + FOLLOW_PATIENCE_MS + RETRY_MS;
    await advance(toParked); // t ≈ 31.7 s: parked
    const parked = fetches();
    // The glass moved on while we were parked. The minute refresh at 60 s
    // learns of slot 1, on glass since 70 s, ending at 90 s.
    served = { ...view(1), current: { ...view(1).current!, shownSince: NOW + 70_000, endsAtMs: NOW + 90_000 } };
    await advance(STATE_REFRESH_MS - toParked + 10); // t ≈ 60.01 s
    expect(fetches()).toBe(parked + 1);
    expect(result.current.slot).toBe(1);
    served = view(2);
    await advance(30_000); // t ≈ 90.01 s: the end, but not yet the grace
    expect(fetches()).toBe(parked + 1);
    await advance(FOLLOW_GRACE_MS + 10); // t ≈ 90.72 s
    expect(fetches()).toBe(parked + 2);
    expect(result.current.slot).toBe(2);
  });
  it('with nothing on glass, only the minute refresh runs', async () => {
    served = view(0, { current: false });
    renderHook(() => useGlassFollower('sunrise'));
    await flush();
    expect(fetches()).toBe(1);
    await advance(RETRY_MS * 5);
    expect(fetches()).toBe(1);
    await advance(STATE_REFRESH_MS);
    expect(fetches()).toBe(2);
    await advance(STATE_REFRESH_MS);
    expect(fetches()).toBe(3);
  });
  it('never sends anything but a GET, and never to the kiosk endpoints', async () => {
    renderHook(() => useGlassFollower('sunrise'));
    await flush();
    await advance(DWELL + FOLLOW_GRACE_MS + FOLLOW_PATIENCE_MS + STATE_REFRESH_MS);
    expect(calls.length).toBeGreaterThan(3);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.every((c) => c.url.startsWith('/api/mirror/state?feed=sunrise'))).toBe(true);
  });
  it('records an error and keeps the last state when a fetch fails', async () => {
    const { result } = renderHook(() => useGlassFollower('sunrise'));
    await flush();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      return { ok: false, status: 503, json: async () => ({}) };
    });
    await advance(DWELL + FOLLOW_GRACE_MS + 5);
    expect(result.current.error).toMatch(/503/);
    expect(result.current.current?.snapshotId).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run app/components/solo2/useGlassFollower.test.tsx`
Expected: FAIL, `Cannot find module './useGlassFollower'`.

- [ ] **Step 3: Write `useGlassFollower.ts`**

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MirrorView } from '@/app/api/mirror/view';
import type { SoloGlass } from '@/app/components/solo/useSoloGlass';
import { useBuildReload } from '@/app/components/useBuildReload';
import type { Feed } from '@/app/lib/solo/types';
import type { Solo2Dials } from '@/app/lib/solo2/types';

/** The safety net: a follower that missed a boundary catches up within a minute. */
export const STATE_REFRESH_MS = 60_000;
/** After the published end: the first origin call past it makes the draw, then the edge cache's window. */
export const FOLLOW_GRACE_MS = 700;
/** Between retries while the slot has not moved. */
export const RETRY_MS = 1_000;
/** How long to retry before parking on the minute refresh. */
export const FOLLOW_PATIENCE_MS = 10_000;

export interface GlassFollower extends SoloGlass {
  /** The live solo2 dials, caption included, as the server built them. Null before the first projection. */
  dials: Solo2Dials | null;
  panelPreset: string | null;
}

function preload(url: string) {
  const img = new Image();
  img.src = url;
}

/**
 * Every follower's loop (mirror spec §4.2): read the projection, wait for
 * the instant the SERVER says the dwell ends, read again. The server draws
 * the next frame on that read (advance on read), so there is nothing here
 * to decide and nothing to POST. If the slot has not moved (a stale edge
 * hit, a slow commit), retry once a second for the patience window, then
 * leave it to the minute refresh.
 */
export function useGlassFollower(feed: Feed): GlassFollower {
  const [view, setView] = useState<MirrorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);
  /** When the current run of retries began; null while the dwell is still running. */
  const waitingSinceMs = useRef<number | null>(null);
  const lastSlot = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/mirror/state?feed=${feed}`);
      if (!res.ok) throw new Error(`mirror ${res.status}`);
      const v = (await res.json()) as MirrorView;
      setView(v);
      setError(null);
      for (const e of v.next) preload(e.imageUrl);
    } catch (e) {
      setError(String(e));
    } finally {
      inFlight.current = false;
    }
  }, [feed]);

  // The minute refresh: on mount and every minute, whatever the boundary timer is doing.
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), STATE_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const endsAtMs = view?.current?.endsAtMs ?? null;
  const slot = view?.slot ?? null;

  // The boundary timer.
  useEffect(() => {
    if (slot !== lastSlot.current) {
      lastSlot.current = slot;
      waitingSinceMs.current = null;
    }
    // Nothing on glass: the minute refresh is what recovers.
    if (endsAtMs == null) return;
    const now = Date.now();
    const due = endsAtMs + FOLLOW_GRACE_MS;
    let wait: number;
    if (due > now) {
      waitingSinceMs.current = null;
      wait = due - now;
    } else {
      waitingSinceMs.current ??= now;
      if (now - waitingSinceMs.current >= FOLLOW_PATIENCE_MS) return; // parked
      wait = RETRY_MS;
    }
    const t = setTimeout(async () => {
      await load();
      setTick((n) => n + 1); // re-arm; the deps below decide whether that is a wait or a retry
    }, wait);
    return () => clearTimeout(t);
  }, [load, endsAtMs, slot, tick]);

  useBuildReload(view?.build ?? null);

  const drawnNext = view?.next.at(-1) ?? null;
  return {
    current: view?.current?.entry ?? null,
    shownSince: view?.current?.shownSince ?? null,
    endsAtMs,
    shownSnapshotIds: view?.current?.shownSnapshotIds ?? [],
    next: drawnNext,
    slot: slot ?? 0,
    boundaryMs: endsAtMs ?? Date.now(),
    error,
    queueLength: drawnNext ? 1 : 0,
    nextEntries: drawnNext ? [drawnNext] : [],
    entries: view?.entries ?? [],
    dials: view?.dials ?? null,
    panelPreset: view?.panelPreset ?? null,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/components/solo2/useGlassFollower.test.tsx`
Expected: PASS (7 tests). The timer arithmetic in the comments assumes the mount fetch lands at t ≈ 5 ms and the minute interval was armed at t ≈ 0; if a count is off by one, print `calls` and correct the expected number, never loosen the parked assertion to `toBeGreaterThan`, which is the one that matters.

- [ ] **Step 5: Lint, commit, push**

```bash
npm run lint && [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/glass-mirror" ] && git add app/components/solo2/useGlassFollower.ts app/components/solo2/useGlassFollower.test.tsx && git commit -m "feat(solo2): useGlassFollower, the one follower loop; never a POST" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVSR1oxGyybGRqZW5bwMjQ" && GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/glass-mirror
```

---

### Task 6: The kiosk's solo2 page becomes a follower

**Files:**
- Modify: `app/components/solo2/index.tsx`
- Modify: `app/components/solo2/index.test.tsx`
- Modify: `app/kiosk/sunset/page.test.tsx`
- Modify: `app/kiosk/sunrise/page.test.tsx`

**Interfaces:**
- Consumes: `useGlassFollower` (Task 5), `Solo2Screen` (Task 4).
- Produces: `Solo2Kiosk(props: MosaicProps)` unchanged in signature; it now ignores `settings`, `shared`, `dozing`, `driveSchedule`.

- [ ] **Step 1: Rewrite `index.test.tsx`**

```tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { Solo2Kiosk } from './index';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const entry = (id: number) => ({
  snapshotId: id, webcamId: 7, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt: id * 100, timezone: null, sunAltitudeDeg: null, stage: { kind: 'inLine' as const, position: null },
});
const loaded = { current: entry(3), shownSince: 0, next: null, slot: 1, endsAtMs: 20_000, boundaryMs: 20_000,
  error: null, queueLength: 0, nextEntries: [], entries: [entry(3)], shownSnapshotIds: [3], dials: D, panelPreset: 'dell-l' };
const empty = { ...loaded, current: null, entries: [], shownSnapshotIds: [], dials: null, panelPreset: null };
const useGlassFollower = vi.fn(() => loaded);
vi.mock('./useGlassFollower', () => ({ useGlassFollower: (feed: string) => useGlassFollower(feed) }));
const useSoloGlass = vi.fn();
vi.mock('@/app/components/solo/useSoloGlass', () => ({ useSoloGlass: () => useSoloGlass() }));

beforeEach(() => {
  vi.clearAllMocks();
  useGlassFollower.mockReturnValue(loaded);
});

it('follows its feed through the projection and draws the screen with the projection\'s dials', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" settings={{ cameraRun: false }} />);
  expect(useGlassFollower).toHaveBeenCalledWith('sunset');
  expect(useSoloGlass).not.toHaveBeenCalled();
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
});

it('is black until the first projection arrives', () => {
  useGlassFollower.mockReturnValue(empty);
  const { container } = render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(screen.queryByTestId('top')).toBeNull();
  expect((container.firstChild as HTMLElement).style.background).toBe('rgb(0, 0, 0)');
});

it('ignores dozing and driveSchedule: nothing on this surface advances, so there is nothing to gate', () => {
  render(<Solo2Kiosk webcams={[]} width={100} height={50} feed="sunrise" dozing driveSchedule={false} />);
  expect(useGlassFollower).toHaveBeenCalledWith('sunrise');
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/components/solo2/index.test.tsx`
Expected: FAIL: `useSoloGlass` was called, and the black test finds `top`.

- [ ] **Step 3: Rewrite `index.tsx`**

```tsx
'use client';

import type { MosaicProps } from '@/app/components/mosaic/types';
import { Solo2Screen } from './Solo2Screen';
import { useGlassFollower } from './useGlassFollower';

/**
 * solo2 as a registered version (rhythm spec §5.3), now a follower like
 * every other screen (mirror spec §5): the projection carries the live
 * dials, so `settings` and `shared` are not read, and nothing here
 * advances, so `dozing` and `driveSchedule` have nothing to gate. Doze is
 * the kiosk page's overlay; behind it the follower keeps stepping.
 */
export function Solo2Kiosk(props: MosaicProps) {
  const glass = useGlassFollower(props.feed);
  const debug = props.allowDebugOverlays !== false && (props.search ?? '').includes('debug=1');
  if (!glass.dials) {
    return <div style={{ width: props.width, height: props.height, background: '#000' }} />;
  }
  return <Solo2Screen glass={glass} dials={glass.dials} width={props.width} height={props.height} feed={props.feed} debug={debug} />;
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run app/components/solo2/index.test.tsx`
Expected: PASS (3).

- [ ] **Step 5: Add the registry-wiring test to both kiosk page tests**

In `app/kiosk/sunset/page.test.tsx`, add below the existing `vi.mock('@/app/components/mosaic/v1', ...)`:

```tsx
vi.mock('@/app/components/solo2', () => ({
  Solo2Kiosk: (props: Record<string, unknown>) => (
    <div data-testid="solo2" data-feed={String(props.feed)} />
  ),
}));
```

and add this test inside the `describe`:

```tsx
  it('with activeVersion solo2 renders the follower for this feed, doze overlay and all', () => {
    useKioskRuntimeMock.mockReturnValue({
      dozing: true,
      liveSettings: { namespaces: { shared: { activeVersion: 'solo2' } }, revision: 1 },
    } as never);
    render(<SunsetKioskPage />);
    expect(screen.getByTestId('solo2').getAttribute('data-feed')).toBe('sunset');
    expect(screen.queryByTestId('geo-mosaic')).toBeNull();
  });
```

Do the same in `app/kiosk/sunrise/page.test.tsx` with `SunriseKioskPage`, `'sunrise'`, and its own `useKioskRuntime` mock name (read the file; it mirrors the sunset one).

- [ ] **Step 6: Run the kiosk tests and lint**

Run: `npx vitest run app/kiosk app/components/solo2 && npm run lint`
Expected: PASS; lint clean.

- [ ] **Step 7: Commit and push**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/glass-mirror" ] && git add app/components/solo2/index.tsx app/components/solo2/index.test.tsx app/kiosk/sunset/page.test.tsx app/kiosk/sunrise/page.test.tsx && git commit -m "feat(kiosk): the solo2 page follows the projection and no longer posts the advance" -m "Doze is the overlay alone now; the schedule runs whether or not the glass is awake (mirror spec §4.4)." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVSR1oxGyybGRqZW5bwMjQ" && GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/glass-mirror
```

---

### Task 7: `/sunrise` and `/sunset`

**Files:**
- Create: `app/(mirror)/layout.tsx`
- Create: `app/(mirror)/MirrorPage.tsx`
- Create: `app/(mirror)/MirrorPage.test.tsx`
- Create: `app/(mirror)/sunrise/page.tsx`
- Create: `app/(mirror)/sunset/page.tsx`

**Interfaces:**
- Consumes: `useGlassFollower`, `Solo2Screen`, `PanelFrame`, `PANEL_PRESETS`, `DEFAULT_PANEL_PRESET`, `soloFontClassName`.
- Produces: `MirrorPage({ feed }: { feed: Feed })`; routes `/sunrise`, `/sunset`.

- [ ] **Step 1: Write the failing test**

`app/(mirror)/MirrorPage.test.tsx` (the real hook, a stubbed `fetch`):

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import { withCaption } from '@/app/lib/solo/captionSchema';
import { MirrorPage } from './MirrorPage';

const D = dialsFrom2(withCaption(schemaDefaults(SOLO2_SETTINGS_SCHEMA)));
const entry = (id: number) => ({
  snapshotId: id, webcamId: 7, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 0, enteredAt: id,
  imageUrl: `u${id}`, title: `t${id}`, city: '', region: 'R', country: 'C', eligible: true, rank: 1,
  capturedAt: id * 100, timezone: null, sunAltitudeDeg: null, stage: { kind: 'inLine' as const, position: null },
});
const NOW = 1_000_000_000_000;
const view = {
  feed: 'sunset', version: 'solo2', panelPreset: 'dell-l', dials: D, slot: 4, build: 'b1',
  current: { entry: entry(3), shownSince: NOW - 19_000, slot: 4, endsAtMs: NOW + 1_000, shownSnapshotIds: [3] },
  entries: [entry(3)], next: [],
};
let calls: { url: string; method: string }[];
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(5); });

beforeEach(() => {
  calls = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  window.history.replaceState({}, '', '/sunset?debug=1&v=v1&panel=ktc');
  vi.stubGlobal('Image', class { set src(_v: string) { /* preload */ } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    return { ok: true, json: async () => view };
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('MirrorPage', () => {
  it('is black before the first projection', () => {
    render(<MirrorPage feed="sunset" />);
    expect(screen.getByTestId('mirror-dark')).toBeInTheDocument();
    expect(screen.queryByTestId('top')).toBeNull();
  });
  it('renders the glass\'s composition at the live panel size, scaled into the window', async () => {
    render(<MirrorPage feed="sunset" />);
    await flush();
    expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
    const stage = screen.getByTestId('panel-stage');
    expect(stage.style.width).toBe('1920px');
    expect(stage.style.height).toBe('1080px');
  });
  it('reads no query parameters: no debug overlay with ?debug=1, and the live preset wins over ?panel=', async () => {
    render(<MirrorPage feed="sunset" />);
    await flush();
    expect(screen.queryByText(/slot 4/)).toBeNull();
    expect(screen.getByTestId('panel-stage').style.width).toBe('1920px');
  });
  it('talks only to the projection, only with GET', async () => {
    render(<MirrorPage feed="sunrise" />);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.every((c) => c.url === '/api/mirror/state?feed=sunrise')).toBe(true);
    for (const banned of ['/api/kiosk/state', '/api/kiosk/tick', '/api/kiosk/solo/state', '/api/kiosk/solo/advance']) {
      expect(calls.some((c) => c.url.includes(banned))).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run "app/(mirror)"`
Expected: FAIL, `Cannot find module './MirrorPage'`.

- [ ] **Step 3: Write `MirrorPage.tsx`**

```tsx
'use client';

import { Solo2Screen } from '@/app/components/solo2/Solo2Screen';
import { useGlassFollower } from '@/app/components/solo2/useGlassFollower';
import { PanelFrame } from '@/app/kiosk/PanelFrame';
import { DEFAULT_PANEL_PRESET, PANEL_PRESETS } from '@/app/kiosk/panelPreview';
import type { Feed } from '@/app/lib/solo/types';

/**
 * A public screen that shows what the glass shows (mirror spec §3). It
 * follows the same projection the kiosk does and renders the same
 * composition at the glass's own panel size, scaled into the window: a
 * visitor sees the picture the gallery sees, pillarboxed on a landscape
 * desktop and nearly full-bleed on a portrait phone. No query parameters,
 * no overlays, no doze: those are the kiosk's, not a visitor's.
 */
export function MirrorPage({ feed }: { feed: Feed }) {
  const glass = useGlassFollower(feed);
  if (!glass.dials) {
    return <div data-testid="mirror-dark" style={{ width: '100vw', height: '100vh', background: '#000' }} />;
  }
  const panel = PANEL_PRESETS[glass.panelPreset ?? DEFAULT_PANEL_PRESET] ?? PANEL_PRESETS[DEFAULT_PANEL_PRESET];
  return (
    <PanelFrame panel={panel}>
      <Solo2Screen glass={glass} dials={glass.dials} width={panel.width} height={panel.height} feed={feed} debug={false} />
    </PanelFrame>
  );
}
```

- [ ] **Step 4: Write the layout and the two pages**

`app/(mirror)/layout.tsx`:

```tsx
import { soloFontClassName } from '@/app/kiosk/soloFonts';

/**
 * Black, the whole window, the picture centered. The solo fonts come from
 * the kiosk's bundle so the caption is the glass's caption. The cursor stays
 * visible: hiding it is the gallery's rule, not a visitor's.
 */
export default function MirrorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`bg-black w-screen h-screen overflow-hidden flex items-center justify-center ${soloFontClassName}`}>
      {children}
    </div>
  );
}
```

`app/(mirror)/sunset/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { MirrorPage } from '../MirrorPage';

export const metadata: Metadata = { title: 'Sunset' };

export default function SunsetMirror() {
  return <MirrorPage feed="sunset" />;
}
```

`app/(mirror)/sunrise/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { MirrorPage } from '../MirrorPage';

export const metadata: Metadata = { title: 'Sunrise' };

export default function SunriseMirror() {
  return <MirrorPage feed="sunrise" />;
}
```

- [ ] **Step 5: Run the test, lint, and the whole suite**

Run: `npx vitest run "app/(mirror)" && npm run lint && npx vitest run`
Expected: PASS (4 in MirrorPage); lint clean; the whole suite green.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: succeeds; the route list printed at the end includes `/sunrise`, `/sunset`, and `/api/mirror/state`. If `next/font` complains that `soloFonts` is imported outside a layout, the layout is the only importer, so the message means the import path is wrong; fix the path, not the font file.

- [ ] **Step 7: Run it and look**

Run: `npm run dev`, then open `http://localhost:<port>/sunset` in a browser beside `http://localhost:<port>/kiosk/sunset`. Both should change frames within a second of each other. Open `/sunset?debug=1`: no overlay. Resize the window: the picture scales, never scrolls. Stop the dev server.

- [ ] **Step 8: Commit and push**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/glass-mirror" ] && git add "app/(mirror)/layout.tsx" "app/(mirror)/MirrorPage.tsx" "app/(mirror)/MirrorPage.test.tsx" "app/(mirror)/sunrise/page.tsx" "app/(mirror)/sunset/page.tsx" && git commit -m "feat(mirror): /sunrise and /sunset, public followers of the glass" -m "Closes #218 (part 7, the mosaic retirement, is its own PR)." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVSR1oxGyybGRqZW5bwMjQ" && GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/glass-mirror
```

---

### Task 8: PR, deploy smoke, and the glass

**Files:** none.

- [ ] **Step 1: Rebase if the beat has merged**

Run: `gh pr view 216 --json state -q .state`
If `MERGED`: `git fetch origin && git rebase origin/main && npx vitest run && GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push --force-with-lease origin feat/glass-mirror`, and open the PR against `main`. If `OPEN`: open the PR against `feat/solo2-beat` and say so in the body; it retargets to `main` when #216 lands.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base <main or feat/solo2-beat> --title "feat: /sunrise and /sunset mirror the glass; the server advances on read" --body-file - <<'EOF'
Spec: docs/superpowers/specs/2026-09-15-glass-mirror-pages-design.md (parts 1 to 6). Closes #218.

One canonical schedule, every screen a follower. `GET /api/mirror/state` draws the next frame when a request lands past the dwell's end (idempotent on the slot, one second at the edge), and both the kiosk's solo2 page and the new public pages follow it. The kiosk no longer posts the advance; doze is the overlay alone, and the show keeps stepping behind it.

Smoke after deploy: two curls in one second show `x-vercel-cache: HIT` on the second; `/sunset` on a phone beside the glass changes frames within a second of it; remote doze in Ops blacks the glass while the phone keeps stepping.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01UVSR1oxGyybGRqZW5bwMjQ
EOF
```

- [ ] **Step 3: After the merge deploys, smoke the projection**

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}B cache=%header{x-vercel-cache}\n" \
  "https://www.sunrisesunset.studio/api/mirror/state?feed=sunset"; \
curl -s -o /dev/null -w "%{http_code} %{size_download}B cache=%header{x-vercel-cache}\n" \
  "https://www.sunrisesunset.studio/api/mirror/state?feed=sunset"
```

Expected: both 200, a few tens of KB (not a megabyte), the second line `cache=HIT`. Then:

```bash
curl -sI "https://www.sunrisesunset.studio/api/mirror/state?feed=sunset" | grep -i cache-control
```

Expected: `public, s-maxage=1, stale-while-revalidate=4`.

- [ ] **Step 4: Watch the slot move with nobody driving**

```bash
for i in 1 2 3 4 5 6; do curl -s "https://www.sunrisesunset.studio/api/mirror/state?feed=sunset" | python3 -c "import json,sys,time;d=json.load(sys.stdin);c=d['current'];print(int(time.time()),'slot',d['slot'],'ends in',round((c['endsAtMs']/1000-time.time()),1) if c else None)"; sleep 10; done
```

Expected: the slot increments each time `ends in` passes zero, whether or not the Pi is awake.

- [ ] **Step 5: The glass**

The kiosk tabs reload themselves on the new build stamp within a couple of minutes (#189). Confirm with `/studio` Ops showing the new build, or run `bash scripts/pi/kiosk-doctor.sh --sync --reload` if they have not moved after five minutes. Then open `/sunset` on a phone next to the glass and watch one frame change land on both within about a second. Finally toggle remote doze in Ops: the glass goes black, the phone keeps stepping; toggle it back.

- [ ] **Step 6: Close out**

`gh issue view 218` should show the PR closing it. Remove the worktree once merged: `scripts/wt.sh rm feat/glass-mirror`. File the mosaic retirement (spec part 7) as its own issue with `gh issue create --label speced` pointing at the same spec, so the second PR has an id.
