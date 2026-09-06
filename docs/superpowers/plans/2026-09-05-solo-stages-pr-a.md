# Solo stages, PR A: least-recently-shown ordering and staged bins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rule 3 orders a bin by never-shown first, then longest since shown; the studio shows each bin as three labelled stages (in line, resting, under floor) with one reason line per row.

**Architecture:** The engine's within-bin comparator changes and is exported so solo2's peak/valley reuse it. `buildStateView` projects far enough to reach every eligible frame once, assigns each entry a `stage`, and orders the bins by stage. `FeedColumn` partitions a bin by stage into three outlined boxes with vertical labels; `EntryRow` prints a reason line instead of rank, bold tally and the FLOOR tag.

**Tech Stack:** Next.js app router, TypeScript, React 19, Vitest + Testing Library. Pure engine code under `app/lib/solo`, view builder under `app/api/kiosk/solo/view.ts`, studio components under `app/studio/solo`.

**Spec:** `docs/superpowers/specs/2026-09-05-solo-stages-and-tape-design.md`, sections 2 and 3. Section 4 (the tape) is PR B and is NOT in this plan.

## Global Constraints

- Work in the worktree `~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-stages-tape`, branch `feat/solo-stages-tape`. Verify the branch in the same command as every commit. Stage explicit paths, never `git add -A`.
- Run tests with `npx vitest run <path>` from the worktree root; the full suite is `npm run test`, lint is `npm run lint`.
- "Shown" means `lastShownAt != null` (the same definition `isResting` uses). Tally no longer orders anything; it is still stored and displayed.
- `NEXT_COUNT` stays 8: the queue column shows 8 draws. Positions beyond 8 come from one longer projection of `eligible + NEXT_COUNT` draws.
- Colours already in use: sunset bin `#7ee2ac`, non-sunset bin `#c3cad6`, orange ring `#f5a344`, panel `#0b0e14`, row `#0e1119`, light line `#2a3242`, text `#9aa3b2`. Do not add new ones.
- `EntryView.rank` and `eligible` stay (the glass overlay prints rank with `showRank`). Only the studio row stops printing them.
- Commit message trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U
  ```

---

## File map

| File | Change |
|---|---|
| `app/lib/solo/engine.ts` | export `compareRecency`, `compareWithin`; new rule 3 order |
| `app/lib/solo/engine.test.ts` | fixtures use `lastShownAt`; add the 5-new/21-old case |
| `app/lib/solo2/engine.ts` | peak = `compareWithin`; valley = recency then lowest score |
| `app/lib/solo2/engine.test.ts` | valley fixture uses `lastShownAt`; add a peak recency case |
| `app/studio/solo/RulesBox.tsx` + test | rule 2 "at least", rule 3 wording |
| `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md` | rules 2 and 3 text, history note |
| `app/lib/solo/stages.ts` (new) + test | `Stage` type, `floorFor`, `assignStages`, `compareStaged` |
| `app/api/kiosk/solo/view.ts` + test | long projection, `stage` on `EntryView`, bins ordered by stage |
| `app/studio/solo/reason.ts` (new) + test | `reasonLine(stage, entry, nowMs)` |
| `app/studio/solo/EntryRow.tsx` + test | reason line; drop rank, bold tally, FLOOR; dim by stage |
| `app/studio/solo/FeedColumn.tsx` + test | `StageBox` with vertical label; bins partitioned by stage |

---

### Task 1: Rule 3 in the solo engine

**Files:**
- Modify: `app/lib/solo/engine.ts:39-46`
- Test: `app/lib/solo/engine.test.ts`

**Interfaces:**
- Produces: `export function compareRecency(a: BinEntry, b: BinEntry): number` (never shown first, then smaller `lastShownAt` first, 0 when both never shown) and `export function compareWithin(d: SoloDials): (a: BinEntry, b: BinEntry) => number` (recency, then `rankScore` descending, then `enteredAt`, then `snapshotId`). Tasks 2 and 4 import both.

- [ ] **Step 1: Rewrite the rule 3 tests**

In `app/lib/solo/engine.test.ts`, replace the `describe('rule 3: within a bin', …)` block with:

```ts
describe('rule 3: within a bin', () => {
  it('never shown first, whatever the tally says', () => {
    // Frame 1 is better and has a lower tally, but it has been on glass; frame 2 never has.
    expect(nx([sun(1, 0.9, { tally: 1, lastShownAt: boundaryMs(-9, FEED, D.dwellS, D.offsetS) }), sun(2, 0.6)])?.snapshotId).toBe(2);
    expect(nx([non(1, 0.5, { tally: 2, lastShownAt: boundaryMs(-9, FEED, D.dwellS, D.offsetS) }), non(2, 0.4)])?.snapshotId).toBe(2);
  });
  it('among shown frames, longest since shown first, even when its tally is higher', () => {
    const older = sun(1, 0.6, { tally: 13, lastShownAt: boundaryMs(-20, FEED, D.dwellS, D.offsetS) });
    const newer = sun(2, 0.9, { tally: 1, lastShownAt: boundaryMs(-10, FEED, D.dwellS, D.offsetS) });
    expect(nx([older, newer])?.snapshotId).toBe(1);
  });
  it('then sunsets by quality, non-sunsets by detection', () => {
    expect(nx([sun(1, 0.7), sun(2, 0.9)])?.snapshotId).toBe(2);
    expect(nx([non(1, 0.4), non(2, 0.5)])?.snapshotId).toBe(2);
  });
  it('promoteNew adds 0.10 and only while isNew', () => {
    const entries = [sun(1, 0.9), sun(2, 0.85, { isNew: true })];
    expect(nx(entries)?.snapshotId).toBe(2);
    expect(nx(entries, { ...D, promoteNew: false })?.snapshotId).toBe(1);
    const [first, second] = project(entries, D, S0, 2, 0, FEED);
    expect(first.snapshotId).toBe(2);
    expect(second.snapshotId).toBe(1);
  });
  it('remaining ties break by earlier enteredAt', () => {
    expect(nx([sun(1, 0.9, { enteredAt: 9 }), sun(2, 0.9, { enteredAt: 3 })])?.snapshotId).toBe(2);
  });
  it('the 2026-09-05 sunset screen: five new frames and twenty-one old ones each get a turn before any repeat', () => {
    // Old frames were on glass at slots -30..-10, tallies 7–13; new ones never. Rest 4 would loop the new five under the old rule.
    const old = Array.from({ length: 21 }, (_, i) =>
      sun(i + 1, 0.55 + i * 0.01, { tally: 7 + (i % 7), lastShownAt: boundaryMs(-30 + i, FEED, D.dwellS, D.offsetS) }));
    const fresh = Array.from({ length: 5 }, (_, i) => sun(100 + i, 0.6 + i * 0.03, { enteredAt: 1000 + i }));
    const out = project([...old, ...fresh], D, S0, 26, 0, FEED).map((e) => e.snapshotId);
    expect(new Set(out).size).toBe(26);
    expect(out.slice(0, 5).every((id) => id >= 100)).toBe(true);
    // Old frames come back in the order they were last on glass.
    expect(out.slice(5)).toEqual(old.map((e) => e.snapshotId));
  });
});
```

- [ ] **Step 2: Run the file and watch the new cases fail**

Run: `npx vitest run app/lib/solo/engine.test.ts`
Expected: FAIL on "never shown first, whatever the tally says", "longest since shown first", and the 2026-09-05 case (the current comparator sorts by tally).

- [ ] **Step 3: Replace the comparator in `engine.ts`**

Replace the `compareWithin` block (the comment through the closing brace) with:

```ts
/**
 * Rule 3's first key: a frame never on glass before any that has been, then
 * the one longest since shown. Tally is not consulted: with a small rest,
 * least-shown-first looped the few newest frames while rested older ones
 * waited (2026-09-05).
 */
export function compareRecency(a: BinEntry, b: BinEntry): number {
  const sa = a.lastShownAt ?? null;
  const sb = b.lastShownAt ?? null;
  if (sa == null && sb == null) return 0;
  if (sa == null) return -1;
  if (sb == null) return 1;
  return sa - sb;
}

/** Rule 3: never shown, then longest since shown, then best, then earliest, then id. */
export function compareWithin(d: SoloDials) {
  return (a: BinEntry, b: BinEntry): number =>
    compareRecency(a, b) ||
    rankScore(b, d) - rankScore(a, d) ||
    a.enteredAt - b.enteredAt ||
    a.snapshotId - b.snapshotId;
}
```

Also change the doc comment on `rankScore` from "Rule 3: quality for sunsets…" to "Rule 3's score key: quality for sunsets, detection for non-sunsets, plus the new-frame bonus."

- [ ] **Step 4: Run the file again**

Run: `npx vitest run app/lib/solo/engine.test.ts`
Expected: PASS, all cases including the spec §4 worked cases (their tallies are uniform, so the order is unchanged).

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-stages-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-stages-tape" ] && \
  git add app/lib/solo/engine.ts app/lib/solo/engine.test.ts && \
  git commit -m "feat(solo): rule 3 orders a bin by never shown, then longest since shown

Least-shown-first with rest 4 looped the five newest frames while 21 rested
older ones waited. Recency gives every eligible frame a turn before any repeat.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 2: solo2's peak and valley on the same key

**Files:**
- Modify: `app/lib/solo2/engine.ts:22-39`
- Test: `app/lib/solo2/engine.test.ts`

**Interfaces:**
- Consumes: `compareRecency`, `compareWithin` from Task 1.
- Produces: nothing new; `next2` / `project2` keep their signatures.

- [ ] **Step 1: Fix the valley fixture and add a peak case**

In `app/lib/solo2/engine.test.ts`, replace the test `'a valley prefers an unshown frame over a lower-scored one already shown'` with:

```ts
  it('a valley prefers an unshown frame over a lower-scored one already shown', () => {
    const d = { ...D, valleys: 1 };
    // Frame 3 was on glass long ago (rested); rule 3 puts never-shown before it.
    const entries = [sun(1, 0.95), sun(2, 0.6), sun(3, 0.58, { tally: 1, lastShownAt: boundaryMs(-20, 'sunrise', D.dwellS, D.offsetS) })];
    expect(next2(entries, d, S0, 1, 'sunrise')?.snapshotId).toBe(2);
  });
  it('a peak prefers the frame longest since shown over a better one shown more recently', () => {
    const d = { ...D, valleys: 1 };
    const older = sun(1, 0.6, { tally: 9, lastShownAt: boundaryMs(-20, 'sunrise', D.dwellS, D.offsetS) });
    const newer = sun(2, 0.95, { tally: 1, lastShownAt: boundaryMs(-10, 'sunrise', D.dwellS, D.offsetS) });
    // slot 0 is a peak
    expect(next2([older, newer], d, S0, 0, 'sunrise')?.snapshotId).toBe(1);
  });
```

- [ ] **Step 2: Run and watch the peak case fail**

Run: `npx vitest run app/lib/solo2/engine.test.ts`
Expected: FAIL on "a peak prefers the frame longest since shown" (tally still orders the peak).

- [ ] **Step 3: Rewrite the two comparators**

In `app/lib/solo2/engine.ts`, change the import line to:

```ts
import { afterShowing, choosePool, compareRecency, compareWithin, rankScore } from '@/app/lib/solo/engine';
```

Replace `comparePeak` and `compareValley` with:

```ts
/** solo's rule 3 order, unchanged: never shown, longest since shown, best, earliest, id. */
const comparePeak = compareWithin;

/** A valley: the same recency key, then the LOWEST score, earliest, id. */
function compareValley(d: Solo2Dials) {
  return (a: BinEntry, b: BinEntry): number =>
    compareRecency(a, b) ||
    rankScore(a, d) - rankScore(b, d) ||
    a.enteredAt - b.enteredAt ||
    a.snapshotId - b.snapshotId;
}
```

- [ ] **Step 4: Run both engine test files**

Run: `npx vitest run app/lib/solo2/engine.test.ts app/lib/solo/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-stages-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-stages-tape" ] && \
  git add app/lib/solo2/engine.ts app/lib/solo2/engine.test.ts && \
  git commit -m "feat(solo2): peak and valley share solo's recency key

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 3: Rules box and the spec say the new rule

**Files:**
- Modify: `app/studio/solo/RulesBox.tsx:25-26`
- Modify: `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md:95-105, 125`
- Test: `app/studio/solo/RulesBox.test.tsx`

- [ ] **Step 1: Update the RulesBox test**

In `app/studio/solo/RulesBox.test.tsx`, first test, replace

```ts
  expect(screen.getByText(/rests/).textContent).toContain('2');
  expect(screen.getByText(/least shown first/)).toBeInTheDocument();
```

with

```ts
  expect(screen.getByText(/rests at least/).textContent).toContain('2');
  expect(screen.getByText(/never shown first, then longest since shown/)).toBeInTheDocument();
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run app/studio/solo/RulesBox.test.tsx`
Expected: FAIL (old wording).

- [ ] **Step 3: Change the two lines in `RulesBox.tsx`**

```tsx
      <div><B>2.</B> A shown frame rests at least <B>{d.rest}</B> {d.rest === 1 ? 'draw' : 'draws'}{d.rest === 0 ? ' (off)' : ''}.</div>
      <div><B>3.</B> In a bin: never shown first, then longest since shown, then best score{d.promoteNew ? ', new frames +0.10' : ''}{rhythm ? <>;{rhythm}</> : null}.</div>
```

- [ ] **Step 4: Run it**

Run: `npx vitest run app/studio/solo/RulesBox.test.tsx`
Expected: PASS.

- [ ] **Step 5: Amend the 2026-09-04 spec**

In `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md`:

Rule 2, change the first sentence to: `**A shown frame rests.** For at least **rest** draws (0–12, default 4) after it was on glass, a frame is not a candidate in either bin.`

Rule 3, replace the whole item with:

```markdown
3. **Within a bin, never shown first, then longest since shown, then best.**
   A frame that has never been on glass comes before any that has; among
   shown frames, the earlier `last_shown_at` first; then sunset bin by
   quality, non-sunset bin by detection probability. Tally does not order.
   **Promote new frames** (boolean, default on) adds +0.10 to a frame that
   arrived while an older frame from the same camera was already in the
   bin; the flag clears the first time it is shown. Remaining ties break by
   earlier `entered_at`, then snapshot id.
```

After the existing `History:` paragraph about rule 1, add:

```markdown
History: until 2026-09-05 (evening) rule 3 was "least shown first, then
best". With rest 4 the five newest frames (tallies 1–5) formed a closed
loop while 21 rested older frames (tallies 7–13) waited; every admission
restarted the loop. See `2026-09-05-solo-stages-and-tape-design.md` §1–2.
```

- [ ] **Step 6: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-stages-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-stages-tape" ] && \
  git add app/studio/solo/RulesBox.tsx app/studio/solo/RulesBox.test.tsx docs/superpowers/specs/2026-09-04-solo-kiosk-design.md && \
  git commit -m "docs(solo): rules box and spec state the recency rule

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 4: The stage classifier

**Files:**
- Create: `app/lib/solo/stages.ts`
- Test: `app/lib/solo/stages.test.ts`

**Interfaces:**
- Consumes: `isEligible`, `isResting`, `compareWithin` from `./engine`; `slotFor` from `./schedule`; `qualityOf` from `./scores`.
- Produces:
  ```ts
  export type Stage =
    | { kind: 'onGlass' }
    | { kind: 'queued'; position: number }        // 1-based draw index, 1..queueDepth
    | { kind: 'inLine'; position: number | null } // draw index > queueDepth, or null when the projection never reached it
    | { kind: 'resting'; drawsLeft: number }      // draws until it is a candidate again, ≥ 1
    | { kind: 'underFloor'; floor: number };      // the floor it misses, on the entry's own scale
  export const STAGE_ORDER: Record<Stage['kind'], number>; // onGlass 0, queued 1, inLine 2, resting 3, underFloor 4
  export function floorFor(e: BinEntry, d: SoloDials): number;
  export function assignStages(input: {
    entries: BinEntry[]; dials: SoloDials; state: ScreenState; firstSlot: number; feed: Feed;
    draws: BinEntry[]; queueDepth: number;
  }): Map<number, Stage>;
  export function compareStaged(stages: Map<number, Stage>, d: SoloDials): (a: BinEntry, b: BinEntry) => number;
  ```

- [ ] **Step 1: Write the tests**

Create `app/lib/solo/stages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assignStages, compareStaged, floorFor, STAGE_ORDER } from './stages';
import { project } from './engine';
import { boundaryMs } from './schedule';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from './settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import type { BinEntry, Feed, ScreenState, SoloDials } from './types';

const D: SoloDials = { ...dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA)), ratingFloor: 3.2, rest: 4 }; // quality 0.55
const FEED: Feed = 'sunrise';
const sun = (id: number, q: number, extra: Partial<BinEntry> = {}): BinEntry => ({
  snapshotId: id, webcamId: 1000 + id, bin: 'sunset', quality: q, detection: 0.9,
  isNew: false, tally: 0, enteredAt: id, lastShownAt: null, ...extra });
const non = (id: number, det: number, extra: Partial<BinEntry> = {}): BinEntry => ({
  snapshotId: id, webcamId: 2000 + id, bin: 'non_sunset', quality: null, detection: det,
  isNew: false, tally: 0, enteredAt: id, lastShownAt: null, ...extra });
const shownAt = (slot: number) => ({ tally: 1, lastShownAt: boundaryMs(slot, FEED, D.dwellS, D.offsetS) });

function stagesOf(entries: BinEntry[], state: ScreenState, firstSlot: number, queueDepth = 2) {
  const eligible = entries.filter((e) => (e.bin === 'sunset' ? (e.quality ?? -1) >= 0.55 : e.detection >= D.detectionFloor)).length;
  const draws = project(entries, D, state, eligible + queueDepth, firstSlot, FEED);
  return assignStages({ entries, dials: D, state, firstSlot, feed: FEED, draws, queueDepth });
}

describe('floorFor', () => {
  it('is the rating floor as a quality for sunsets and the detection floor for non-sunsets', () => {
    expect(floorFor(sun(1, 0.9), D)).toBeCloseTo(0.55);
    expect(floorFor(non(1, 0.9), D)).toBe(D.detectionFloor);
  });
});

describe('assignStages', () => {
  it('marks the frame on glass, the queued ones by position, and the rest in line by later position', () => {
    // Slot 10: frame 1 is on glass, 2..4 never shown. Queue depth 2 → 2 and 3 queued, 4 in line at draw 3.
    const entries = [sun(1, 0.9, shownAt(9)), sun(2, 0.8), sun(3, 0.7), sun(4, 0.6)];
    const s = stagesOf(entries, { lastSnapshotId: 1, sunsetStreak: 1 }, 10);
    expect(s.get(1)).toEqual({ kind: 'onGlass' });
    expect(s.get(2)).toEqual({ kind: 'queued', position: 1 });
    expect(s.get(3)).toEqual({ kind: 'queued', position: 2 });
    expect(s.get(4)).toEqual({ kind: 'inLine', position: 3 });
  });
  it('a frame under its floor is underFloor, with the floor it misses', () => {
    const s = stagesOf([sun(1, 0.9), sun(2, 0.1), non(3, 0.1)], { lastSnapshotId: null, sunsetStreak: 0 }, 0);
    expect(s.get(2)).toEqual({ kind: 'underFloor', floor: expect.closeTo(0.55, 5) });
    expect(s.get(3)).toEqual({ kind: 'underFloor', floor: 0.3 });
  });
  it('a resting frame says how many draws until it is back', () => {
    // Shown at slot 10, rest 4: resting at slots 11–14, back at 15. From slot 11 that is 4 draws; from slot 14, 1.
    const rested = sun(1, 0.9, shownAt(10));
    const others = [sun(2, 0.8), sun(3, 0.7), sun(4, 0.6), sun(5, 0.5)];
    const state = { lastSnapshotId: 2, sunsetStreak: 1 };
    expect(stagesOf([rested, ...others], state, 11).get(1)).toEqual({ kind: 'resting', drawsLeft: 4 });
    expect(stagesOf([rested, ...others], state, 14).get(1)).toEqual({ kind: 'resting', drawsLeft: 1 });
    expect(stagesOf([rested, ...others], state, 15).get(1)?.kind).not.toBe('resting');
  });
  it('an eligible frame the projection never reaches is inLine with a null position', () => {
    // Twelve sunsets with rest 4: at least seven are always rested, above the sunset floor of six, so the projection never draws a non-sunset.
    const sunsets = Array.from({ length: 12 }, (_, i) => sun(i + 1, 0.9 - i * 0.01));
    const s = stagesOf([...sunsets, non(50, 0.5)], { lastSnapshotId: null, sunsetStreak: 0 }, 0);
    expect(s.get(50)).toEqual({ kind: 'inLine', position: null });
  });
  it('a queued frame that repeats in the queue keeps its first position', () => {
    const entries = [sun(1, 0.9), sun(2, 0.8)];
    const s = stagesOf(entries, { lastSnapshotId: null, sunsetStreak: 0 }, 0, 4);
    expect(s.get(1)).toEqual({ kind: 'queued', position: 1 });
    expect(s.get(2)).toEqual({ kind: 'queued', position: 2 });
  });
});

describe('compareStaged', () => {
  it('orders by stage, then draw position, then draws left, then the engine order', () => {
    // Projection from slot 11, queue depth 1. Frames 1 and 6 were on glass at slots 10 and 9: resting 4 and 3 draws.
    const entries = [
      sun(1, 0.9, shownAt(10)),
      sun(2, 0.1),
      sun(3, 0.7), sun(4, 0.8), sun(5, 0.6),
      sun(6, 0.65, shownAt(9)),
    ];
    const s = stagesOf(entries, { lastSnapshotId: null, sunsetStreak: 0 }, 11, 1);
    const sorted = [...entries].sort(compareStaged(s, D)).map((e) => e.snapshotId);
    // queued 4; in line 3 then 5 by position; resting 6 (3 left) before 1 (4 left); under floor 2 last.
    expect(sorted).toEqual([4, 3, 5, 6, 1, 2]);
    expect(STAGE_ORDER.queued).toBeLessThan(STAGE_ORDER.inLine);
  });
});
```

- [ ] **Step 2: Run to see the module missing**

Run: `npx vitest run app/lib/solo/stages.test.ts`
Expected: FAIL, cannot resolve `./stages`.

- [ ] **Step 3: Write `app/lib/solo/stages.ts`**

```ts
import { compareWithin, isEligible, isResting } from './engine';
import { slotFor } from './schedule';
import { qualityOf } from './scores';
import type { BinEntry, Feed, ScreenState, SoloDials } from './types';

/**
 * Where a frame stands for one screen's next draw (stages spec §3.1). The
 * studio shows each bin as these stages so a row can say why it is not on
 * glass. Pure: the projection is passed in, already run with the dials the
 * caller cares about.
 */
export type Stage =
  | { kind: 'onGlass' }
  /** In the queue column: 1-based draw index, 1..queueDepth. */
  | { kind: 'queued'; position: number }
  /** Eligible and rested; `position` is its draw index past the queue, null when the projection never reached it. */
  | { kind: 'inLine'; position: number | null }
  /** Shown within the last `rest` draws; back in line after `drawsLeft` draws. */
  | { kind: 'resting'; drawsLeft: number }
  /** Below its bin's floor, which is `floor` on the entry's own scale. */
  | { kind: 'underFloor'; floor: number };

export const STAGE_ORDER: Record<Stage['kind'], number> = {
  onGlass: 0, queued: 1, inLine: 2, resting: 3, underFloor: 4,
};

/** The floor an entry is measured against, on its own scale: quality 0–1 for sunsets, detection for the rest. */
export function floorFor(e: BinEntry, d: SoloDials): number {
  return e.bin === 'sunset' ? qualityOf(d.ratingFloor) : d.detectionFloor;
}

export function assignStages(input: {
  entries: BinEntry[];
  dials: SoloDials;
  state: ScreenState;
  /** The slot of the first projected draw. */
  firstSlot: number;
  feed: Feed;
  /** The projection, first draw at `firstSlot`; longer than `queueDepth` so in-line frames get positions. */
  draws: BinEntry[];
  queueDepth: number;
}): Map<number, Stage> {
  const { entries, dials: d, state, firstSlot, feed, draws, queueDepth } = input;
  const firstDraw = new Map<number, number>();
  draws.forEach((e, i) => {
    if (!firstDraw.has(e.snapshotId)) firstDraw.set(e.snapshotId, i + 1);
  });
  const out = new Map<number, Stage>();
  for (const e of entries) {
    const position = firstDraw.get(e.snapshotId) ?? null;
    if (e.snapshotId === state.lastSnapshotId) out.set(e.snapshotId, { kind: 'onGlass' });
    else if (position != null && position <= queueDepth) out.set(e.snapshotId, { kind: 'queued', position });
    else if (!isEligible(e, d)) out.set(e.snapshotId, { kind: 'underFloor', floor: floorFor(e, d) });
    else if (isResting(e, d, firstSlot, feed)) {
      const shownSlot = slotFor(e.lastShownAt!, feed, d.dwellS, d.offsetS);
      out.set(e.snapshotId, { kind: 'resting', drawsLeft: Math.max(1, d.rest - (firstSlot - shownSlot) + 1) });
    } else out.set(e.snapshotId, { kind: 'inLine', position });
  }
  return out;
}

/** Stage order, then position (null last), then draws left, then the engine's own order. */
export function compareStaged(stages: Map<number, Stage>, d: SoloDials) {
  const within = compareWithin(d);
  const pos = (s: Stage) => (s.kind === 'queued' || s.kind === 'inLine' ? s.position ?? Number.MAX_SAFE_INTEGER : 0);
  const left = (s: Stage) => (s.kind === 'resting' ? s.drawsLeft : 0);
  return (a: BinEntry, b: BinEntry): number => {
    const sa = stages.get(a.snapshotId) ?? { kind: 'inLine', position: null };
    const sb = stages.get(b.snapshotId) ?? { kind: 'inLine', position: null };
    return STAGE_ORDER[sa.kind] - STAGE_ORDER[sb.kind] || pos(sa) - pos(sb) || left(sa) - left(sb) || within(a, b);
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/lib/solo/stages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-stages-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-stages-tape" ] && \
  git add app/lib/solo/stages.ts app/lib/solo/stages.test.ts && \
  git commit -m "feat(solo): stage classifier — on glass, queued, in line, resting, under floor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 5: The view carries a stage and orders the bins by it

**Files:**
- Modify: `app/api/kiosk/solo/view.ts:48-52, 86-126`
- Test: `app/api/kiosk/solo/view.test.ts`

**Interfaces:**
- Consumes: `assignStages`, `compareStaged`, `Stage` from Task 4.
- Produces: `EntryView.stage: Stage` (every entry in `current`, `next`, and both bins carries one). `bins.sunset` / `bins.nonSunset` are ordered by `compareStaged`. `next` is unchanged in length and content.

- [ ] **Step 1: Update and add view tests**

In `app/api/kiosk/solo/view.test.ts`, replace the test `'queued frames are absent from the bins; bins keep the remainder ranked by score'` with:

```ts
  it('queued frames are absent from the bins; every entry carries a stage', () => {
    const entries = [stored(1, 'sunset', 0.9), stored(2, 'sunset', 0.8), stored(3, 'non_sunset', 0.5), stored(4, 'sunset', 0.1)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    expect(v.current).toBeNull();
    expect(v.next.map((e) => e.snapshotId)).toEqual([1, 2, 3, 1, 2, 3, 1, 2]);
    expect(v.next[0].stage).toEqual({ kind: 'queued', position: 1 });
    expect(v.bins.sunset.map((e) => e.snapshotId)).toEqual([4]);
    expect(v.bins.sunset[0].eligible).toBe(false);
    expect(v.bins.sunset[0].stage).toEqual({ kind: 'underFloor', floor: expect.closeTo(0.55, 5) });
  });
  it('bins are ordered by stage: in line by draw position, then resting, then under floor', () => {
    // Twelve never-shown sunsets: 8 queue, the rest are in line at draws 9+. Frame 20 is on glass, frame 30 under floor.
    const many = Array.from({ length: 12 }, (_, i) => stored(i + 1, 'sunset', 0.9 - i * 0.01));
    const onGlass = { ...stored(20, 'sunset', 0.95, 1), lastShownAt: 70_000 }; // on glass since slot 3 (dwell 20, offset 10)
    const low = stored(30, 'sunset', 0.1);
    const v = buildStateView({ feed: 'sunset', dials: D, entries: [low, onGlass, ...many],
      screen: { feed: 'sunset', currentSnapshotId: 20, shownSince: 70_000, slot: 3, sunsetStreak: 1 },
      nowMs: 75_000, admitted: { sunset: 0, nonSunset: 0 }, zone: ZONE });
    const kinds = v.bins.sunset.map((e) => e.stage.kind);
    expect(kinds.slice(0, 4)).toEqual(['inLine', 'inLine', 'inLine', 'inLine']);
    expect(v.bins.sunset.slice(0, 4).map((e) => (e.stage as { position: number | null }).position)).toEqual([9, 10, 11, 12]);
    expect(kinds[kinds.length - 1]).toBe('underFloor');
    expect(v.current?.entry.stage).toEqual({ kind: 'onGlass' });
  });
```

(Keep the `rank` test that follows; rank is unchanged.)

- [ ] **Step 2: Run to see the stage field missing**

Run: `npx vitest run app/api/kiosk/solo/view.test.ts`
Expected: FAIL on the two edited tests (`stage` undefined).

- [ ] **Step 3: Change `view.ts`**

Add to the imports:

```ts
import { assignStages, compareStaged, type Stage } from '@/app/lib/solo/stages';
```

Change `EntryView`:

```ts
export interface EntryView extends ViewEntry {
  eligible: boolean;
  /** 1-based position within its bin by score, queue membership ignored. The glass overlay prints it. */
  rank: number;
  /** Where the frame stands for this screen's next draw; the studio sections the bins by it. */
  stage: Stage;
}
```

In `buildStateView`, replace from `const view = (e: ViewEntry): EntryView => ({` through the `bins:` entry of the return with:

```ts
  const currentEntry = screen?.currentSnapshotId != null ? byId.get(screen.currentSnapshotId) ?? null : null;
  const state = {
    lastSnapshotId: currentEntry?.snapshotId ?? null,
    sunsetStreak: screen?.sunsetStreak ?? 0,
  };
  // The next draw happens at the next boundary, whose slot is one past now's.
  const firstSlot = slotFor(nowMs, feed, dials.dwellS, dials.offsetS) + 1;
  // Project past the queue so every eligible frame gets a draw position (stages spec §3.1).
  const eligibleCount = entries.filter((e) => isEligible(e, dials)).length;
  const draws = version.project(entries, dials, state, eligibleCount + NEXT_COUNT, firstSlot, feed);
  const next = draws.slice(0, NEXT_COUNT);
  const stages = assignStages({ entries, dials, state, firstSlot, feed, draws, queueDepth: NEXT_COUNT });
  const view = (e: ViewEntry): EntryView => ({
    ...e,
    eligible: isEligible(e, dials),
    rank: ranks.get(e.snapshotId) ?? 0,
    stage: stages.get(e.snapshotId) ?? { kind: 'inLine', position: null },
  });
  const queued = new Set([currentEntry?.snapshotId, ...next.map((e) => e.snapshotId)]);
  const remaining = entries.filter((e) => !queued.has(e.snapshotId));
  const staged = compareStaged(stages, dials);

  return {
    feed,
    dials,
    current: currentEntry
      ? { entry: view(currentEntry), shownSince: screen?.shownSince ?? null, slot: screen?.slot ?? null }
      : null,
    next: next.map((e) => view(byId.get(e.snapshotId)!)),
    nextRoles: next.map((_, i) => version.roleAt(firstSlot + i, feed, dials)),
    bins: {
      sunset: remaining.filter((e) => e.bin === 'sunset').sort(staged).map(view),
      nonSunset: remaining.filter((e) => e.bin === 'non_sunset').sort(staged).map(view),
    },
```

Delete the now-unused `byScore` sort from the bins only; keep `byScore` and `rankMap` for `rank`. Move the `const ranks = rankMap(entries); const byId = …` lines above if they are not already before `view`.

- [ ] **Step 4: Run the view tests and everything that builds a view**

Run: `npx vitest run app/api/kiosk/solo app/components/solo app/components/solo2 app/studio/solo`
Expected: view tests PASS. Studio component tests may fail to type-check fixtures that construct `EntryView` literals without `stage` (`EntryRow.test.tsx`, `FeedColumn.test.tsx`, `CaptionPreview.test.tsx`, `SoloRail.test.tsx`, `toWebcam.test.ts`, `SoloFrame.test.tsx`, `Solo2Frame.test.tsx`). Vitest does not type-check, so they pass at runtime; run `npx tsc --noEmit -p .` and add `stage: { kind: 'inLine', position: null }` to each such fixture until it is clean. Tasks 6 and 7 rewrite the EntryRow and FeedColumn tests anyway; fix only the others here.

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-stages-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-stages-tape" ] && \
  git add app/api/kiosk/solo/view.ts app/api/kiosk/solo/view.test.ts && \
  git add $(git diff --name-only -- app/components app/studio) && \
  git commit -m "feat(solo): every view entry carries a stage; bins order by it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 6: The reason line and the simpler row

**Files:**
- Create: `app/studio/solo/reason.ts`
- Test: `app/studio/solo/reason.test.ts`
- Modify: `app/studio/solo/EntryRow.tsx:65-100`
- Test: `app/studio/solo/EntryRow.test.tsx`

**Interfaces:**
- Consumes: `Stage` from Task 4; `formatRating`, `formatDetection` from `app/lib/solo/scores.ts`; `EntryView.stage` from Task 5.
- Produces: `export function reasonLine(stage: Stage, e: Pick<EntryView, 'bin' | 'quality' | 'detection' | 'tally' | 'lastShownAt'>, nowMs: number): string`. `EntryRow` gains a required prop `reason: string` and dims when `entry.stage.kind === 'underFloor'`. Task 7 passes `reason`.

- [ ] **Step 1: Write the reason tests**

Create `app/studio/solo/reason.test.ts`:

```ts
import { it, expect } from 'vitest';
import { reasonLine } from './reason';

const base = { bin: 'sunset' as const, quality: 0.43, detection: 0.21, tally: 4, lastShownAt: 100_000 };
const NOW = 100_000 + 14 * 60_000;

it('on glass', () => {
  expect(reasonLine({ kind: 'onGlass' }, base, NOW)).toBe('on glass · shown ×4');
});
it('queued and in line say the draw, the tally, and how long since shown', () => {
  expect(reasonLine({ kind: 'queued', position: 3 }, base, NOW)).toBe('draw 3 · shown ×4 · last 14 min ago');
  expect(reasonLine({ kind: 'inLine', position: 12 }, { ...base, tally: 13 }, NOW)).toBe('draw 12 · shown ×13 · last 14 min ago');
  expect(reasonLine({ kind: 'inLine', position: 12 }, { ...base, tally: 0, lastShownAt: null }, NOW)).toBe('draw 12 · never shown');
  expect(reasonLine({ kind: 'inLine', position: null }, base, NOW)).toBe('in line · shown ×4 · last 14 min ago');
  expect(reasonLine({ kind: 'queued', position: 1 }, { ...base, lastShownAt: NOW - 20_000 }, NOW)).toBe('draw 1 · shown ×4 · last <1 min ago');
});
it('resting says when it is back', () => {
  expect(reasonLine({ kind: 'resting', drawsLeft: 3 }, base, NOW)).toBe('back in 3 draws · shown ×4');
  expect(reasonLine({ kind: 'resting', drawsLeft: 1 }, base, NOW)).toBe('back in 1 draw · shown ×4');
});
it('under floor names the miss on the bin\'s own scale', () => {
  expect(reasonLine({ kind: 'underFloor', floor: 0.55 }, base, NOW)).toBe('rating 2.7 < 3.2');
  expect(reasonLine({ kind: 'underFloor', floor: 0.3 }, { ...base, bin: 'non_sunset', quality: null }, NOW)).toBe('sunset 21% < 30%');
});
```

- [ ] **Step 2: Run to see the module missing**

Run: `npx vitest run app/studio/solo/reason.test.ts`
Expected: FAIL, cannot resolve `./reason`.

- [ ] **Step 3: Write `app/studio/solo/reason.ts`**

```ts
import type { Stage } from '@/app/lib/solo/stages';
import { formatDetection, formatRating } from '@/app/lib/solo/scores';
import type { BinKind } from '@/app/lib/solo/types';

interface Reasoned {
  bin: BinKind;
  quality: number | null;
  detection: number;
  tally: number;
  lastShownAt?: number | null;
}

function ago(lastShownAt: number, nowMs: number): string {
  const min = Math.floor((nowMs - lastShownAt) / 60_000);
  return min < 1 ? 'last <1 min ago' : `last ${min} min ago`;
}

function history(e: Reasoned, nowMs: number): string {
  return e.lastShownAt == null ? 'never shown' : `shown ×${e.tally} · ${ago(e.lastShownAt, nowMs)}`;
}

/** One line under a studio row saying why the frame is where it is (stages spec §3.3). */
export function reasonLine(stage: Stage, e: Reasoned, nowMs: number): string {
  switch (stage.kind) {
    case 'onGlass':
      return `on glass · shown ×${e.tally}`;
    case 'queued':
      return `draw ${stage.position} · ${history(e, nowMs)}`;
    case 'inLine':
      return stage.position == null ? `in line · ${history(e, nowMs)}` : `draw ${stage.position} · ${history(e, nowMs)}`;
    case 'resting':
      return `back in ${stage.drawsLeft} ${stage.drawsLeft === 1 ? 'draw' : 'draws'} · shown ×${e.tally}`;
    case 'underFloor':
      return e.bin === 'sunset'
        ? `rating ${formatRating(e.quality ?? 0)} < ${formatRating(stage.floor)}`
        : `sunset ${formatDetection(e.detection)} < ${formatDetection(stage.floor)}`;
  }
}
```

- [ ] **Step 4: Run the reason tests**

Run: `npx vitest run app/studio/solo/reason.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the EntryRow tests**

In `app/studio/solo/EntryRow.test.tsx`, add `stage: { kind: 'inLine' as const, position: 12 }` to the `e` fixture, and replace the first two tests with:

```tsx
it('shows the reason line, scores, place, and the tags; no rank, no bold tally', () => {
  render(<EntryRow entry={e} feed="sunset" place="sunset" reason="draw 12 · shown ×2 · last 3 min ago" onClick={vi.fn()} />);
  expect(screen.getByText('draw 12 · shown ×2 · last 3 min ago')).toBeInTheDocument();
  expect(screen.queryByText(/^shown ×2$/)).toBeNull();
  expect(screen.queryByText(/bin #/)).toBeNull();
  expect(screen.getByText(/rating 4\.6 · sunset 88%/)).toBeInTheDocument();
  expect(screen.getByText('NEW')).toBeInTheDocument();
  expect(screen.getByText(/Lisbon, Portugal/)).toBeInTheDocument();
});

it('dims an under-floor frame without a FLOOR tag; a repeat keeps full strength and is tagged REPEAT', () => {
  render(<EntryRow entry={{ ...e, eligible: false, isNew: false, stage: { kind: 'underFloor', floor: 0.55 } }}
    feed="sunset" place="sunset" reason="rating 2.7 < 3.2" onClick={vi.fn()} />);
  expect(screen.queryByText('FLOOR')).toBeNull();
  expect(screen.getByText('rating 2.7 < 3.2')).toBeInTheDocument();
  expect(screen.getByRole('button')).toHaveStyle({ opacity: '0.45' });
  cleanup();
  render(<EntryRow entry={e} feed="sunset" place="queue" repeat reason="draw 6 · shown ×2 · last 1 min ago" onClick={vi.fn()} />);
  expect(screen.getByText('REPEAT')).toBeInTheDocument();
  expect(screen.getByRole('button')).toHaveStyle({ opacity: '1' });
});
```

Add `reason="…"` (any string) to every other `<EntryRow …>` in the file.

- [ ] **Step 6: Run to see them fail**

Run: `npx vitest run app/studio/solo/EntryRow.test.tsx`
Expected: FAIL (reason text absent, FLOOR present).

- [ ] **Step 7: Change `EntryRow.tsx`**

Add `reason: string;` to the props type (after `place`) and destructure it. In the `title` string, replace `(!e.eligible ? 'Below the floor dial; not eligible. ' : '')` with `${reason}. ` placed right after the bin sentence, and drop the trailing `Shown ${e.tally} time…` sentence (the reason carries it). Replace the block

```tsx
        <span style={{ fontWeight: e.tally > 0 ? 800 : 500, color: e.tally > 0 ? '#e5e7eb' : '#6b7280' }}>
          shown ×{e.tally}
        </span>
        {' · '}{scores}
        <div style={{ marginTop: 2 }}>
          {e.isNew && <Tag …>NEW</Tag>}
          {!e.eligible && <Tag bg="#3a4356" fg="#e5e7eb" title="Below the floor dial">FLOOR</Tag>}
```

with

```tsx
        <span style={{ color: '#c3cad6' }}>{reason}</span>
        <div style={{ color: '#6b7280' }}>{scores}</div>
        <div style={{ marginTop: 2 }}>
          {e.isNew && <Tag bg="#f5a344" fg="#1a1000" title="Newer frame from a camera already in the bin">NEW</Tag>}
```

(the NEW tag line is unchanged; only the FLOOR line goes). Change `opacity: e.eligible ? 1 : 0.45` to `opacity: e.stage.kind === 'underFloor' ? 0.45 : 1`. Update the component doc comment's last sentence to: "Dimming means the frame is under its floor; a repeat IS shown again, so it keeps full strength and a red tag says so. The `reason` line says why the frame sits where it does."

- [ ] **Step 8: Run EntryRow tests**

Run: `npx vitest run app/studio/solo/EntryRow.test.tsx app/studio/solo/reason.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-stages-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-stages-tape" ] && \
  git add app/studio/solo/reason.ts app/studio/solo/reason.test.ts app/studio/solo/EntryRow.tsx app/studio/solo/EntryRow.test.tsx && \
  git commit -m "feat(studio): one reason line per row replaces rank, bold tally and FLOOR

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 7: Staged bins with vertical labels

**Files:**
- Modify: `app/studio/solo/FeedColumn.tsx`
- Test: `app/studio/solo/FeedColumn.test.tsx`

**Interfaces:**
- Consumes: `EntryView.stage` (Task 5), `reasonLine` (Task 6), `EntryRow` `reason` prop (Task 6).
- Produces: a `StageBox` component local to `FeedColumn.tsx`; labels `IN LINE · n`, `RESTING · n`, `UNDER FLOOR · n` per bin.

- [ ] **Step 1: Add the FeedColumn test**

In `app/studio/solo/FeedColumn.test.tsx`, add after the first test:

```tsx
it('each bin is three labelled stages with counts, even when a stage is empty', () => {
  const v = view();
  render(<FeedColumn feed="sunset" server={v} projected={v} liveDials={D} studioDials={D} nowMs={5_000} onSelect={vi.fn()} />);
  // Frame 4 (rating 1.4) is under the sunset floor; nothing rests; both bins render all three labels.
  expect(screen.getAllByText('IN LINE · 0')).toHaveLength(2);
  expect(screen.getAllByText('RESTING · 0')).toHaveLength(2);
  expect(screen.getByText('UNDER FLOOR · 1')).toBeInTheDocument();
  expect(screen.getByText('UNDER FLOOR · 0')).toBeInTheDocument();
  expect(screen.getByText('rating 1.4 < 3.2')).toBeInTheDocument();
  expect(screen.getByText(/^on glass · shown ×/)).toBeInTheDocument();
});
```

Also, in the first test, the assertion `expect(screen.getByText(/Sunset bin · 1 waiting/))` stays.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run app/studio/solo/FeedColumn.test.tsx`
Expected: FAIL: labels absent, and existing tests fail because `EntryRow` now requires `reason`.

- [ ] **Step 3: Change `FeedColumn.tsx`**

Add imports:

```tsx
import type { Stage } from '@/app/lib/solo/stages';
import { reasonLine } from './reason';
```

Add below `Bin`:

```tsx
const STAGE_LABEL: Record<'inLine' | 'resting' | 'underFloor', string> = {
  inLine: 'IN LINE', resting: 'RESTING', underFloor: 'UNDER FLOOR',
};
const STAGE_HINT: Record<'inLine' | 'resting' | 'underFloor', string> = {
  inLine: 'Rested and above the floor, in the order the glass will draw them.',
  resting: 'Shown within the last rest draws; back in line when the count runs out.',
  underFloor: 'Below the bin\'s floor dial; never drawn until the dial or the score moves.',
};

/**
 * One stage of a bin: an outlined box with the stage name up its left edge
 * (stages spec §3.2). Stays as a short box when empty so the three stages
 * never shift.
 */
function StageBox({ kind, color, count, children }: {
  kind: 'inLine' | 'resting' | 'underFloor'; color: string; count: number; children: ReactNode;
}) {
  return (
    <div title={STAGE_HINT[kind]} style={{
      display: 'grid', gridTemplateColumns: '14px 1fr', gap: 4, border: `1px solid ${color}`, borderRadius: 6,
      padding: 3, marginBottom: 5, minHeight: 22, background: '#0b0e14',
    }}>
      <div style={{
        writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 8.5, fontWeight: 700,
        letterSpacing: '.06em', color, whiteSpace: 'nowrap', textAlign: 'center', fontFamily: mono, cursor: 'help',
      }}>{`${STAGE_LABEL[kind]} · ${count}`}</div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

const STAGE_KINDS = ['inLine', 'resting', 'underFloor'] as const;
const byStage = (rows: EntryView[]) => ({
  inLine: rows.filter((e) => e.stage.kind === 'inLine' || e.stage.kind === 'queued' || e.stage.kind === 'onGlass'),
  resting: rows.filter((e) => e.stage.kind === 'resting'),
  underFloor: rows.filter((e) => e.stage.kind === 'underFloor'),
});
```

(`queued` / `onGlass` never appear in a bin today; the fold keeps the partition total if that changes.)

Replace the two `<Bin …>` bodies for the sunset and non-sunset bins with a shared render. Replace the sunset bin's `{projected.bins.sunset.map(…)}` with:

```tsx
          {STAGE_KINDS.map((kind) => {
            const rows = byStage(projected.bins.sunset)[kind];
            return (
              <StageBox key={kind} kind={kind} color="#7ee2ac" count={rows.length}>
                {rows.map((e) => (
                  <EntryRow key={e.snapshotId} entry={e} feed={feed} place="sunset" reason={reasonLine(e.stage, e, nowMs)}
                    onClick={(x) => onSelect(x, feed)} sequence={seqFor(e, null)} rowS={rowS} preluded={preludedInQueue.has(e.snapshotId)} />
                ))}
              </StageBox>
            );
          })}
```

and the non-sunset bin's map with the same block using `projected.bins.nonSunset`, `color="#c3cad6"`, `place="non_sunset"`.

Change the two bin hints to:

- sunset: `"Frames the detection head calls a sunset. Three stages: in line (draw order), resting, under the rating floor."`
- non-sunset: `"Frames the detection head does not call a sunset. Three stages: in line (draw order), resting, under the sunset-probability floor."`

In the queue map, give each row its reason from its place in the queue rather than its stored stage, since a repeat row is a later draw:

```tsx
            const stage: Stage = i === 0 && current ? { kind: 'onGlass' } : { kind: 'queued', position: current ? i : i + 1 };
            return (
              <EntryRow key={`${e.snapshotId}-${i}`} entry={e} feed={feed} place="queue" onGlass={i === 0 && !!current}
                reason={reasonLine(stage, e, nowMs)}
                repeat={repeat} cameraIndex={m > 1 ? { n, m } : undefined} role={roleOf(i)} onClick={(x) => onSelect(x, feed)}
                sequence={queueSeqs[i]} rowS={rowS} preluded={preluded} />
            );
```

Update the component doc comment: "One feed's two bins, each as three stages (in line, resting, under floor), and its queue as the STUDIO dials would order them."

- [ ] **Step 4: Run the studio tests**

Run: `npx vitest run app/studio/solo`
Expected: PASS. If the solo2 prelude test complains about an in-line row, it is because `seqFor` is called per row exactly as before; check the `key` and `place` props were carried over.

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-stages-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-stages-tape" ] && \
  git add app/studio/solo/FeedColumn.tsx app/studio/solo/FeedColumn.test.tsx && \
  git commit -m "feat(studio): each bin is three labelled stages — in line, resting, under floor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U"
```

---

### Task 8: Whole-suite check, push, PR

**Files:** none new.

- [ ] **Step 1: Lint, type-check, full tests**

Run from the worktree root:

```bash
npm run lint && npx tsc --noEmit -p . && npm run test
```

Expected: all three clean. Fix anything that fails in the file that owns it and amend into a `fix:` commit; do not skip tests.

- [ ] **Step 2: Look at it in a browser**

Run `npm run dev` in the worktree, open `/studio/solo` signed in (owner-gated), and confirm for the sunset feed: three outlined boxes per bin with vertical labels and counts, in-line rows numbered from 9 upward, under-floor rows dimmed with a `rating x < y` line, and the queue's top row reading `on glass · shown ×n`. Take a screenshot into the scratchpad for the PR body. If not signed in locally, note that in the PR and ask Jesse for the signed-in look.

- [ ] **Step 3: Push and open the PR**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-stages-tape && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-stages-tape" ] && git push -u origin feat/solo-stages-tape
```

Then `gh pr create` with title `feat(solo): least-recently-shown ordering and staged studio bins` and a body that states: the diagnosed loop (five newest frames on a 100 s cycle, 21 rested frames waiting), the rule change, the three stages and the reason line, that no migration is needed, that the glass runs the engine so `bash scripts/pi/kiosk-doctor.sh --sync --reload` follows the merge, and that PR B (the tape) follows. End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Tsi2mkYSmb48KkQc97w39U
```

---

## Self-review

- **Spec coverage.** §2 rule change: Tasks 1–3. §3.1 classifier: Task 4. §3.2 layout, labels, hints, ordering, header: Task 7 (header unchanged, labels carry counts). §3.3 row and reason line: Task 6. §5 sequencing note and kiosk reload: Task 8. §6 tests: each task. §4 (tape) deliberately excluded; it is PR B.
- **Placeholders.** None; every step has its code or exact command.
- **Type consistency.** `Stage` kinds match across `stages.ts`, `reason.ts`, `view.ts`, `FeedColumn.tsx`. `compareRecency` / `compareWithin` names match between Tasks 1, 2 and 4. `reason` prop is required on `EntryRow` and is passed at every call site in Task 7 and in the rewritten tests of Task 6. `assignStages` input field names match between Task 4's tests and Task 5's call.
