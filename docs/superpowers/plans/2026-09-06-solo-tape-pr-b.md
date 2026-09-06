# Solo tape, PR B: the draw log and the filmstrip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each studio screen gets a horizontal filmstrip of the last 24 draws, the frame on glass, and the projected next 8, fed by a new per-draw log table.

**Architecture:** `commitAdvance` logs one row per draw into `kiosk_draws` (best-effort, so a missing table never stops the glass). The state route reads the last 24 rows joined to snapshots and webcams, and `buildStateView` passes them through as `tape`. A `Tape` component renders past thumbs, an orange-ringed current thumb, a seam, and dashed projected thumbs, at the top of `FeedColumn`. The cron's `maintainBins` prunes rows older than 7 days.

**Tech Stack:** Next.js app router, Neon HTTP driver via `app/lib/db`, Vitest + Testing Library. The store's SQL is mocked in tests through the `__sqlMock` tag already used in `store.test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-05-solo-stages-and-tape-design.md` §4.

## Global Constraints

- Worktree `~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-tape`, branch `feat/solo-tape`. Verify the branch in the same command as every commit; stage explicit paths.
- **The migration must be applied to production before this code merges** (CLAUDE.md). The log insert is best-effort, so nothing breaks before then, but the tape stays empty.
- Every store call added here swallows its own failure with `console.warn('[solo/store] …')`, like `saveSweptZone`, and the readers return `[]`.
- Colours in use: sunset `#7ee2ac`, non-sunset `#c3cad6`, orange ring `#f5a344`, red repeat `#8b2e2e`, panel `#0b0e14`, line `#2a3242`, text `#9aa3b2`. No new ones.
- Tape thumbnails are 40×22 px. Past count is 24 (`TAPE_PAST`); projected count is `NEXT_COUNT` (8).
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U
  ```

---

## File map

| File | Change |
|---|---|
| `database/migrations/20260906_kiosk_draws.sql` (new) | the log table |
| `app/lib/solo/store.ts` + test | `TapeFrame`, `logDraw` (called by `commitAdvance`), `listRecentDraws`, `pruneDraws` |
| `app/api/cron/update-cameras/lib/binAdmission.ts` + test | `maintainBins` calls `pruneDraws` |
| `app/api/kiosk/solo/view.ts` + test | `StateView.tape`, optional `tape` input, `TAPE_PAST` |
| `app/api/kiosk/solo/state/route.ts` | fetches `listRecentDraws(feed, TAPE_PAST)` |
| `app/studio/solo/useSoloState.ts` | passes `data.tape` into the re-projection |
| `app/studio/solo/Tape.tsx` (new) + test | the filmstrip |
| `app/studio/solo/FeedColumn.tsx` + test | mounts `Tape` above the bins |

---

### Task 1: Migration and the store's three draw functions

**Files:**
- Create: `database/migrations/20260906_kiosk_draws.sql`
- Modify: `app/lib/solo/store.ts` (after `commitAdvance`)
- Test: `app/lib/solo/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TapeFrame {
    slot: number; snapshotId: number; shownAt: number; // ms
    imageUrl: string; title: string; city: string; country: string;
    bin: BinKind | null; // null when the bin row is gone
  }
  export async function logDraw(feed: Feed, slot: number, snapshotId: number): Promise<void>;
  export async function listRecentDraws(feed: Feed, n: number): Promise<TapeFrame[]>; // oldest first
  export async function pruneDraws(olderThanDays: number): Promise<void>;
  ```
  `commitAdvance` calls `logDraw` after the tally update; its signature and return are unchanged.

- [ ] **Step 1: Write the migration**

```sql
-- Solo kiosk: one row per draw per screen, the record behind the studio's
-- tape (stages-and-tape spec §4). Written by store.commitAdvance right after
-- the screen-state upsert succeeds, best-effort; read by GET
-- /api/kiosk/solo/state for the last 24 draws; pruned by
-- binAdmission.maintainBins after 7 days. About 8.6k rows a day per screen
-- at a 20 s dwell.
--
-- Forward-only, idempotent. The writer and the reader both degrade to
-- nothing when the table is missing, so the glass never depends on it, but
-- APPLY BEFORE MERGING the code: a swallowed insert loses the tape silently.
--   node scripts/apply-migration.mjs database/migrations/20260906_kiosk_draws.sql
--   node scripts/apply-migration.mjs database/migrations/20260906_kiosk_draws.sql --apply

CREATE TABLE IF NOT EXISTS kiosk_draws (
  feed         TEXT        NOT NULL CHECK (feed IN ('sunrise', 'sunset')),
  slot         BIGINT      NOT NULL,
  snapshot_id  BIGINT      NOT NULL,
  shown_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feed, slot)
);

CREATE INDEX IF NOT EXISTS kiosk_draws_shown_idx ON kiosk_draws (shown_at);
```

- [ ] **Step 2: Write the store tests**

Add to the import list in `app/lib/solo/store.test.ts`: `logDraw, listRecentDraws, pruneDraws`. Then, in the `describe('screen state', …)` block (the one holding the `commitAdvance` tests), change the second `commitAdvance` test and add a third:

```ts
  it('commitAdvance bumps the tally after a successful state write, then logs the draw', async () => {
    sqlMock.mockResolvedValueOnce([{ feed: 'sunset' }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const ok = await commitAdvance('sunset', 42, { snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 }, 1);
    expect(ok).toBe(true);
    expect(sqlMock).toHaveBeenCalledTimes(3);
    const tally = (sqlMock.mock.calls[1][0] as TemplateStringsArray).join('?');
    expect(tally).toMatch(/tally = tally \+ 1/);
    expect(lastQuery()).toMatch(/insert into kiosk_draws/);
    expect(lastQuery()).toMatch(/on conflict \(feed, slot\) do nothing/);
    expect(sqlMock.mock.calls.at(-1)!.slice(1)).toEqual(['sunset', 42, 7]);
  });
  it('a failed draw log does not fail the advance', async () => {
    sqlMock.mockResolvedValueOnce([{ feed: 'sunset' }]).mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('relation "kiosk_draws" does not exist'));
    const ok = await commitAdvance('sunset', 42, { snapshotId: 7, webcamId: 3, bin: 'sunset', quality: 0.9, detection: 0.8, isNew: true, tally: 0, enteredAt: 0 }, 1);
    expect(ok).toBe(true);
  });
```

Add a new describe block at the end of the file:

```ts
describe('draw log (the tape)', () => {
  it('listRecentDraws returns the last n draws oldest first, with numbers not strings', async () => {
    // The query fetches newest first and the function reverses it.
    sqlMock.mockResolvedValueOnce([
      { slot: '101', snapshot_id: '8', shown_at: '2026-09-06T01:00:20Z', firebase_url: 'u8', title: 'B', city: 'Nuuk', country: 'Greenland', bin: 'sunset' },
      { slot: '100', snapshot_id: '7', shown_at: '2026-09-06T01:00:00Z', firebase_url: 'u7', title: 'A', city: '', country: '', bin: null },
    ]);
    const out = await listRecentDraws('sunset', 24);
    expect(lastQuery()).toMatch(/from kiosk_draws d/);
    expect(lastQuery()).toMatch(/order by d.slot desc/);
    expect(sqlMock.mock.calls.at(-1)!.slice(1)).toEqual(['sunset', 24]);
    expect(out.map((f) => f.snapshotId)).toEqual([7, 8]);
    expect(out[1]).toEqual({ slot: 101, snapshotId: 8, shownAt: Date.parse('2026-09-06T01:00:20Z'),
      imageUrl: 'u8', title: 'B', city: 'Nuuk', country: 'Greenland', bin: 'sunset' });
    expect(out[0].bin).toBeNull();
  });
  it('listRecentDraws is empty when the table is missing', async () => {
    sqlMock.mockRejectedValueOnce(new Error('relation "kiosk_draws" does not exist'));
    expect(await listRecentDraws('sunrise', 24)).toEqual([]);
  });
  it('pruneDraws deletes by age and swallows its own failure', async () => {
    sqlMock.mockResolvedValueOnce([]);
    await pruneDraws(7);
    expect(lastQuery()).toMatch(/delete from kiosk_draws/);
    expect(sqlMock.mock.calls.at(-1)!.slice(1)).toEqual([7]);
    sqlMock.mockRejectedValueOnce(new Error('nope'));
    await expect(pruneDraws(7)).resolves.toBeUndefined();
  });
  it('logDraw swallows its own failure', async () => {
    sqlMock.mockRejectedValueOnce(new Error('nope'));
    await expect(logDraw('sunset', 1, 2)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run app/lib/solo/store.test.ts`
Expected: FAIL: `logDraw` etc. not exported; the commitAdvance call count is 2.

- [ ] **Step 4: Implement in `store.ts`**

In `commitAdvance`, after the tally `update` statement and before `return true;`, add:

```ts
  await logDraw(feed, slot, entry.snapshotId);
```

After `commitAdvance`, add:

```ts
/** One past draw on the studio's tape (stages-and-tape spec §4). */
export interface TapeFrame {
  slot: number;
  snapshotId: number;
  /** ms since epoch. */
  shownAt: number;
  imageUrl: string;
  title: string;
  city: string;
  country: string;
  /** Null once the bin row is gone; the tape then draws a neutral outline. */
  bin: BinKind | null;
}

/**
 * Record a draw for the tape. Best-effort: an unmigrated table must not stop
 * the glass advancing. Idempotent on (feed, slot), like the state write.
 */
export async function logDraw(feed: Feed, slot: number, snapshotId: number): Promise<void> {
  try {
    await sql`
      insert into kiosk_draws (feed, slot, snapshot_id, shown_at)
      values (${feed}, ${slot}, ${snapshotId}, now())
      on conflict (feed, slot) do nothing
    `;
  } catch (error) {
    console.warn('[solo/store] draw log failed:', error);
  }
}

/** The last `n` draws for a screen, oldest first. Empty when the table is missing. */
export async function listRecentDraws(feed: Feed, n: number): Promise<TapeFrame[]> {
  try {
    const rows = (await sql`
      select d.slot, d.snapshot_id, d.shown_at, s.firebase_url, w.title, w.city, w.country, e.bin
      from kiosk_draws d
      join webcam_snapshots s on s.id = d.snapshot_id
      join webcams w on w.id = s.webcam_id
      left join kiosk_bin_entries e on e.feed = d.feed and e.snapshot_id = d.snapshot_id
      where d.feed = ${feed}
      order by d.slot desc
      limit ${n}
    `) as unknown as {
      slot: string | number; snapshot_id: string | number; shown_at: string; firebase_url: string;
      title: string | null; city: string | null; country: string | null; bin: BinKind | null;
    }[];
    return rows.reverse().map((r) => ({
      slot: num(r.slot), snapshotId: num(r.snapshot_id), shownAt: Date.parse(r.shown_at),
      imageUrl: r.firebase_url, title: r.title ?? '', city: r.city ?? '', country: r.country ?? '', bin: r.bin ?? null,
    }));
  } catch (error) {
    console.warn('[solo/store] draw log read failed:', error);
    return [];
  }
}

/** Drop draws older than `olderThanDays`. Best-effort; the cron calls it every tick. */
export async function pruneDraws(olderThanDays: number): Promise<void> {
  try {
    await sql`
      delete from kiosk_draws where shown_at < now() - make_interval(days => ${olderThanDays})
    `;
  } catch (error) {
    console.warn('[solo/store] draw log prune failed:', error);
  }
}
```

- [ ] **Step 5: Run the store tests**

Run: `npx vitest run app/lib/solo/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-tape" ] && \
  git add database/migrations/20260906_kiosk_draws.sql app/lib/solo/store.ts app/lib/solo/store.test.ts && \
  git commit -m "feat(solo): kiosk_draws log — one row per draw, read back for the tape, pruned at 7 days

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 2: The cron prunes the log

**Files:**
- Modify: `app/api/cron/update-cameras/lib/binAdmission.ts` (`maintainBins`, imports)
- Test: `app/api/cron/update-cameras/lib/binAdmission.test.ts`

- [ ] **Step 1: Find how the test mocks the store**

Run: `grep -n "vi.mock('@/app/lib/solo/store'\|removeStale\|saveSweptZone" app/api/cron/update-cameras/lib/binAdmission.test.ts | head`
The store is mocked with `vi.mock('@/app/lib/solo/store', …)` returning `vi.fn()`s. Add `pruneDraws: vi.fn().mockResolvedValue(undefined)` to that factory the same way `saveSweptZone` is provided, and add one test inside the `maintainBins` describe:

```ts
  it('prunes the draw log after ageing the bins', async () => {
    await maintainBins({ now: new Date(), zone: { minDeg: -24, maxDeg: -2 }, grace: 2 });
    expect(pruneDraws).toHaveBeenCalledWith(7);
  });
```

(import `pruneDraws` from `@/app/lib/solo/store` next to the other mocked names the file already imports; if the file builds its fixtures differently, match the existing `maintainBins` test's arguments verbatim.)

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run app/api/cron/update-cameras/lib/binAdmission.test.ts`
Expected: FAIL: `pruneDraws` not called.

- [ ] **Step 3: Implement**

In `binAdmission.ts`, add `pruneDraws` to the import from `@/app/lib/solo/store`, add near the top:

```ts
/** The tape keeps a week; the studio reads the last 24 draws. */
const DRAW_LOG_DAYS = 7;
```

and in `maintainBins`, after the `for (const feed of FEEDS)` loop and before `return totals;`:

```ts
  await pruneDraws(DRAW_LOG_DAYS);
```

- [ ] **Step 4: Run**

Run: `npx vitest run app/api/cron/update-cameras/lib/binAdmission.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-tape" ] && \
  git add app/api/cron/update-cameras/lib/binAdmission.ts app/api/cron/update-cameras/lib/binAdmission.test.ts && \
  git commit -m "feat(cron): maintainBins prunes the draw log after a week

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 3: The view and the state route carry the tape

**Files:**
- Modify: `app/api/kiosk/solo/view.ts` (`StateView`, `buildStateView` input and return; export `TAPE_PAST`)
- Modify: `app/api/kiosk/solo/state/route.ts` (fetch and pass)
- Modify: `app/studio/solo/useSoloState.ts` (pass `data.tape`)
- Test: `app/api/kiosk/solo/view.test.ts`

**Interfaces:**
- Consumes: `TapeFrame`, `listRecentDraws` from Task 1.
- Produces: `StateView.tape: TapeFrame[]` (oldest first, at most `TAPE_PAST`), `export const TAPE_PAST = 24`, `buildStateView` input field `tape?: TapeFrame[]` (default `[]`).

- [ ] **Step 1: Add the view test**

In `app/api/kiosk/solo/view.test.ts`, inside `describe('buildStateView', …)`:

```ts
  it('passes the draw log through as tape, oldest first, and defaults to empty', () => {
    const entries = [stored(1, 'sunset', 0.9)];
    const tape = [
      { slot: 1, snapshotId: 5, shownAt: 20_000, imageUrl: 'u5', title: 'a', city: '', country: '', bin: 'sunset' as const },
      { slot: 2, snapshotId: 6, shownAt: 40_000, imageUrl: 'u6', title: 'b', city: '', country: '', bin: null },
    ];
    const v = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE, tape });
    expect(v.tape.map((f) => f.snapshotId)).toEqual([5, 6]);
    const bare = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    expect(bare.tape).toEqual([]);
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run app/api/kiosk/solo/view.test.ts`
Expected: FAIL: `tape` undefined.

- [ ] **Step 3: Change `view.ts`**

Import the type: `import type { ScreenRow, StoredEntry, TapeFrame } from '@/app/lib/solo/store';` (extend the existing type import). Below `NEXT_COUNT`:

```ts
/** Past draws on the studio's tape. */
export const TAPE_PAST = 24;
```

In `StateView`, after `zone: Zone;`:

```ts
  /** The last draws on this screen, oldest first (stages-and-tape spec §4). Empty until the log is migrated. */
  tape: TapeFrame[];
```

In `buildStateView`'s input type, after `version?: SoloVersionSpec;`:

```ts
  /** Past draws for the tape; the state route supplies them, other callers may omit. */
  tape?: TapeFrame[];
```

In the return object, after `zone: input.zone,`:

```ts
    tape: input.tape ?? [],
```

- [ ] **Step 4: The state route fetches it; the studio hook forwards it**

In `app/api/kiosk/solo/state/route.ts`, add `listRecentDraws` to the store import and `TAPE_PAST` to the `../view` import. Extend the `Promise.all` to:

```ts
  const [entries, screen, admitted, sweptZone, forcedDayRing, tape] = await Promise.all([
    listActiveEntries(feed),
    getScreenState(feed),
    countAdmittedSince(feed, nowMs - LAST_PULL_WINDOW_MS),
    getSweptZone(),
    isFlagEnabled(SWEEP_FORCE_DAY_RING),
    listRecentDraws(feed, TAPE_PAST),
  ]);
```

and add `tape,` to the `buildStateView({ … })` call.

In `app/studio/solo/useSoloState.ts`, add `tape: data.tape,` to the `buildStateView({ … })` call so the projected view keeps the server's past.

- [ ] **Step 5: Run the view and studio tests, then type-check**

Run: `npx vitest run app/api/kiosk/solo app/studio/solo && npx tsc --noEmit -p . 2>&1 | grep -i "tape" | head`
Expected: PASS; no `tape` type errors. (`FeedColumn.test.tsx` builds views without `tape`, which is allowed.)

- [ ] **Step 6: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-tape" ] && \
  git add app/api/kiosk/solo/view.ts app/api/kiosk/solo/view.test.ts app/api/kiosk/solo/state/route.ts app/studio/solo/useSoloState.ts && \
  git commit -m "feat(solo): the state view carries the last 24 draws as the tape

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 4: The Tape component

**Files:**
- Create: `app/studio/solo/Tape.tsx`
- Test: `app/studio/solo/Tape.test.tsx`

**Interfaces:**
- Consumes: `TapeFrame` (Task 1), `EntryView` (view).
- Produces:
  ```tsx
  export function Tape(props: {
    past: TapeFrame[];            // oldest first
    current: EntryView | null;    // on glass
    next: EntryView[];            // projected, first draw first
    onSelect: (entry: EntryView) => void;
  }): JSX.Element
  ```
  Test ids: `tape`, `tape-past-<snapshotId>-<slot>`, `tape-current`, `tape-seam`, `tape-next-<i>`.

- [ ] **Step 1: Write the test**

```tsx
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tape } from './Tape';
import type { EntryView } from '@/app/api/kiosk/solo/view';

const entry = (id: number, bin: 'sunset' | 'non_sunset' = 'sunset'): EntryView => ({
  snapshotId: id, webcamId: 100 + id, bin, quality: bin === 'sunset' ? 0.8 : null, detection: 0.9, isNew: false, tally: 1,
  enteredAt: 0, imageUrl: `u${id}`, title: `cam${id}`, city: 'Nuuk', region: '', country: 'Greenland', capturedAt: 0,
  timezone: null, sunAltitudeDeg: null, eligible: true, rank: 1, stage: { kind: 'queued', position: 1 },
});
const past = [
  { slot: 10, snapshotId: 1, shownAt: 1_000, imageUrl: 'u1', title: 'cam1', city: 'Nuuk', country: 'Greenland', bin: 'sunset' as const },
  { slot: 11, snapshotId: 2, shownAt: 2_000, imageUrl: 'u2', title: 'cam2', city: '', country: '', bin: 'non_sunset' as const },
  { slot: 12, snapshotId: 1, shownAt: 3_000, imageUrl: 'u1', title: 'cam1', city: 'Nuuk', country: 'Greenland', bin: 'sunset' as const },
];

it('lays out past, current, seam, and projected in order, outlined by bin', () => {
  render(<Tape past={past} current={entry(3)} next={[entry(4, 'non_sunset'), entry(1)]} onSelect={vi.fn()} />);
  const strip = screen.getByTestId('tape');
  const ids = [...strip.querySelectorAll('[data-testid^="tape-"]')].map((n) => n.getAttribute('data-testid'));
  expect(ids).toEqual(['tape-past-1-10', 'tape-past-2-11', 'tape-past-1-12', 'tape-current', 'tape-seam', 'tape-next-0', 'tape-next-1']);
  expect(screen.getByTestId('tape-past-1-10')).toHaveStyle({ borderColor: '#7ee2ac' });
  expect(screen.getByTestId('tape-past-2-11')).toHaveStyle({ borderColor: '#c3cad6' });
  expect(screen.getByTestId('tape-current')).toHaveStyle({ boxShadow: '0 0 0 2px #f5a344' });
  expect(screen.getByTestId('tape-next-0')).toHaveStyle({ borderStyle: 'dashed' });
});

it('a frame that already appears earlier on the strip gets the red top edge; the first appearance does not', () => {
  render(<Tape past={past} current={entry(3)} next={[entry(1)]} onSelect={vi.fn()} />);
  expect(screen.getByTestId('tape-past-1-10')).not.toHaveStyle({ borderTopColor: '#8b2e2e' });
  expect(screen.getByTestId('tape-past-1-12')).toHaveStyle({ borderTopColor: '#8b2e2e' });
  expect(screen.getByTestId('tape-next-0')).toHaveStyle({ borderTopColor: '#8b2e2e' });
  expect(screen.getByTestId('tape-current')).not.toHaveStyle({ borderTopColor: '#8b2e2e' });
});

it('hover text names the frame; clicking a projected or current thumb reports the entry', () => {
  const onSelect = vi.fn();
  render(<Tape past={past} current={entry(3)} next={[entry(4)]} onSelect={onSelect} />);
  expect(screen.getByTestId('tape-past-1-10').getAttribute('title')).toMatch(/cam1 · Nuuk, Greenland · draw at/);
  expect(screen.getByTestId('tape-next-0').getAttribute('title')).toMatch(/^draw 1 · cam4/);
  fireEvent.click(screen.getByTestId('tape-next-0'));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 4 }));
  fireEvent.click(screen.getByTestId('tape-current'));
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 3 }));
});

it('with no past and nothing on glass it still renders the seam and the projection', () => {
  render(<Tape past={[]} current={null} next={[entry(4)]} onSelect={vi.fn()} />);
  expect(screen.queryByTestId('tape-current')).toBeNull();
  expect(screen.getByTestId('tape-seam')).toBeInTheDocument();
  expect(screen.getByTestId('tape-next-0')).toBeInTheDocument();
  expect(screen.getByText(/no draws logged yet/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to see the module missing**

Run: `npx vitest run app/studio/solo/Tape.test.tsx`
Expected: FAIL: cannot resolve `./Tape`.

- [ ] **Step 3: Write `Tape.tsx`**

```tsx
'use client';

import { useEffect, useRef } from 'react';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { TapeFrame } from '@/app/lib/solo/store';
import type { BinKind } from '@/app/lib/solo/types';

const COLOR: Record<BinKind, string> = { sunset: '#7ee2ac', non_sunset: '#c3cad6' };
const NEUTRAL = '#2a3242';
const REPEAT = '#8b2e2e';
const RING = '0 0 0 2px #f5a344';
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
export const THUMB_W = 40;
export const THUMB_H = 22;

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const place = (f: { city: string; country: string }) => [f.city, f.country].filter(Boolean).join(', ');

function Thumb({ testId, src, color, dashed = false, ring = false, repeat = false, title, onClick }: {
  testId: string; src: string; color: string; dashed?: boolean; ring?: boolean; repeat?: boolean; title: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" data-testid={testId} title={title} onClick={onClick} disabled={!onClick} style={{
      flex: 'none', width: THUMB_W, height: THUMB_H, padding: 0, background: '#000', cursor: onClick ? 'pointer' : 'default',
      borderWidth: 1.5, borderStyle: dashed ? 'dashed' : 'solid', borderColor: color, borderTopColor: repeat ? REPEAT : color,
      borderTopWidth: repeat ? 3 : 1.5, borderRadius: 3, boxShadow: ring ? RING : undefined, boxSizing: 'border-box',
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </button>
  );
}

/**
 * The tape (stages-and-tape spec §4): what this screen drew, is drawing, and
 * will draw, in one strip. Past thumbs are fact from the draw log; the frame
 * on glass wears the orange ring; a seam separates fact from the projection,
 * whose thumbs are dashed. A frame already seen earlier on the strip carries
 * a red top edge, the REPEAT tag's colour. Scrolls sideways; on mount and
 * whenever the past grows, the seam is brought to about two thirds across.
 */
export function Tape({ past, current, next, onSelect }: {
  past: TapeFrame[];
  current: EntryView | null;
  next: EntryView[];
  onSelect: (entry: EntryView) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const seam = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = strip.current;
    const m = seam.current;
    if (!s || !m) return;
    s.scrollLeft = Math.max(0, m.offsetLeft - s.clientWidth * (2 / 3));
  }, [past.length, current?.snapshotId]);

  const seen = new Set<number>();
  const repeatOf = (id: number) => {
    const r = seen.has(id);
    seen.add(id);
    return r;
  };

  return (
    <div ref={strip} data-testid="tape" title="The tape: past draws, the frame on glass, then the projected next draws"
      style={{ display: 'flex', gap: 3, alignItems: 'center', overflowX: 'auto', padding: '4px 2px', minHeight: THUMB_H + 12 }}>
      {past.length === 0 && (
        <span style={{ fontFamily: mono, fontSize: 9.5, color: '#4b5568', whiteSpace: 'nowrap', paddingRight: 6 }}>no draws logged yet</span>
      )}
      {past.map((f) => (
        <Thumb key={`${f.snapshotId}-${f.slot}`} testId={`tape-past-${f.snapshotId}-${f.slot}`} src={f.imageUrl}
          color={f.bin ? COLOR[f.bin] : NEUTRAL} repeat={repeatOf(f.snapshotId)}
          title={`${f.title}${place(f) ? ` · ${place(f)}` : ''} · draw at ${clock(f.shownAt)}`} />
      ))}
      {current && (
        <Thumb testId="tape-current" src={current.imageUrl} color={COLOR[current.bin]} ring repeat={repeatOf(current.snapshotId)}
          title={`on glass · ${current.title}${place(current) ? ` · ${place(current)}` : ''}`} onClick={() => onSelect(current)} />
      )}
      <div ref={seam} data-testid="tape-seam" title="Left: what happened. Right: what the studio dials project."
        style={{ flex: 'none', width: 2, height: THUMB_H + 6, background: '#f5a344', opacity: 0.6, margin: '0 2px' }} />
      {next.map((e, i) => (
        <Thumb key={`${e.snapshotId}-${i}`} testId={`tape-next-${i}`} src={e.imageUrl} color={COLOR[e.bin]} dashed
          repeat={repeatOf(e.snapshotId)} title={`draw ${i + 1} · ${e.title}${place(e) ? ` · ${place(e)}` : ''}`}
          onClick={() => onSelect(e)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the Tape tests**

Run: `npx vitest run app/studio/solo/Tape.test.tsx`
Expected: PASS. If `toHaveStyle({ borderColor })` fails on jsdom shorthand expansion, assert `borderLeftColor` instead in both the test and this step's note.

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-tape" ] && \
  git add app/studio/solo/Tape.tsx app/studio/solo/Tape.test.tsx && \
  git commit -m "feat(studio): the tape — past draws, on glass, seam, projected next

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 5: Mount the tape above the bins

**Files:**
- Modify: `app/studio/solo/FeedColumn.tsx`
- Test: `app/studio/solo/FeedColumn.test.tsx`

- [ ] **Step 1: Add the test**

```tsx
it('the tape sits under the screen heading and above the bins, with the server past and the projected next', () => {
  const v = view();
  const withTape = { ...v, tape: [{ slot: 1, snapshotId: 2, shownAt: 0, imageUrl: 'u2', title: 'cam2', city: '', country: '', bin: 'sunset' as const }] };
  render(<FeedColumn feed="sunset" server={withTape} projected={v} liveDials={D} studioDials={D} nowMs={5_000} onSelect={vi.fn()} />);
  const tape = screen.getByTestId('tape');
  expect(tape).toBeInTheDocument();
  expect(screen.getByTestId('tape-past-2-1')).toBeInTheDocument();
  expect(screen.getByTestId('tape-current')).toBeInTheDocument();
  expect(screen.getByTestId('tape-next-0')).toBeInTheDocument();
  // The tape precedes the bins in document order.
  const binHeading = screen.getByText(/Sunset bin ·/);
  expect(tape.compareDocumentPosition(binHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run app/studio/solo/FeedColumn.test.tsx`
Expected: FAIL: no `tape` test id.

- [ ] **Step 3: Mount it**

In `FeedColumn.tsx`, import `{ Tape } from './Tape'`, and between the `<h3 …>` heading and the bins grid insert:

```tsx
      <Tape past={server.tape} current={current?.entry ?? null} next={projected.next} onSelect={(e) => onSelect(e, feed)} />
```

Update the component doc comment's first sentence to "One feed's tape, its two bins, each as three stages …".

- [ ] **Step 4: Run the studio tests**

Run: `npx vitest run app/studio/solo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-tape" ] && \
  git add app/studio/solo/FeedColumn.tsx app/studio/solo/FeedColumn.test.tsx && \
  git commit -m "feat(studio): the tape sits above each screen's bins

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 6: Whole-suite check, static render, push, PR, migration handoff

- [ ] **Step 1: Lint, type-check, full tests**

```bash
npm run lint && npm run test
```
and `npx tsc --noEmit -p . 2>&1 | grep -i "tape\|draw" | head` must print nothing.

- [ ] **Step 2: Static render for the PR**

Reuse the PR A approach: a throwaway vitest file in `app/studio/solo/` that builds a view from the scratchpad's `sunset.json` entries plus a synthetic `tape` of ~24 frames drawn from those entries (repeat a few ids so the red edge shows), renders `FeedColumn` with `renderToStaticMarkup`, writes `studio-tape.html` to the scratchpad; screenshot with `agent-browser --session tape`. Delete the throwaway file before committing.

- [ ] **Step 3: Push, PR**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-tape" ] && git push -u origin feat/solo-tape
```

`gh pr create` titled `feat(studio): the tape — a filmstrip of past, current and projected draws`. The body states what the tape is, the migration and that it must be applied first, that the log insert is best-effort, that the kiosk does not read the tape (no kiosk reload needed), and the one-studio note (the tape ports as one component). End with the session trailer.

- [ ] **Step 4: Hand Jesse the migration**

Tell Jesse to run, from the main checkout, dry then apply:

```
node scripts/apply-migration.mjs database/migrations/20260906_kiosk_draws.sql --from feat/solo-tape
```
```
node scripts/apply-migration.mjs database/migrations/20260906_kiosk_draws.sql --from feat/solo-tape --apply
```

Then merge. Rows begin at the next advance; the tape fills over the following eight minutes.

---

## Self-review

- **Spec §4.1** storage: Task 1 (table, best-effort insert in `commitAdvance`, prune in `maintainBins` via Task 2). **§4.2** read path: Task 1 (`listRecentDraws`, joins, left join for bin), Task 3 (`StateView.tape`, `TAPE_PAST`). **§4.3** render: Task 4 (thumbs, outlines, ring, dashed, red edge, hover, click, seam scroll), Task 5 (position under the screen, above the bins). **§5** sequencing: Task 6. Kiosk unaffected: the advance route never passes `tape`, and no kiosk component reads it.
- **Placeholders:** none.
- **Type consistency:** `TapeFrame` fields match between store, view test, Tape test, and FeedColumn test. `listRecentDraws(feed, n)` matches the route call. `pruneDraws(7)` matches the cron test.
