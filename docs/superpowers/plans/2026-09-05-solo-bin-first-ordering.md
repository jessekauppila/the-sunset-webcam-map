# Solo Bin-First Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The solo kiosk chooses the bin first (sunset floor, then the mix dial), then the least-shown frame inside that bin, with a rest of a few draws after every showing, so the mix dial governs airtime regardless of how unequal the two bins are.

**Architecture:** `app/lib/solo/engine.ts` stays a pure function of (entries, dials, screen state, slot, feed). Rule 1 stops comparing tallies across bins; a new shared `choosePool` does eligibility, never-twice, rest, and the bin choice, and both `solo` and `solo2` draw from it. Rest is measured in draws using the `last_shown_at` column the advance route already writes, so there is no migration. The dial `repeatAllowance` is deleted and `rest` takes its slot in both schemas; deploy-history snapshots that still carry `repeatAllowance` are dropped by `sanitizeValues` and need no handling.

**Tech Stack:** Next.js route handlers, Vitest (`// @vitest-environment node` for server files), React Testing Library, the settings schema helpers in `app/lib/settings/schema.ts`, `app/lib/solo/schedule.ts` for slot math.

**Spec:** `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md` §4, as rewritten in Task 1 of this plan. The solo2 spec (`docs/superpowers/specs/2026-09-04-solo2-rhythm-design.md`) is unchanged: its rule 3 beat still applies inside the chosen bin.

## Why (the diagnosis this plan implements)

On 2026-09-05 the sunrise screen had 5 eligible sunsets at tally 9–11 and 35 non-sunsets at tally 7. Rule 1 ("lowest tier across both bins") made every one of the 35 non-sunsets outrank every sunset until all 35 had been shown again, so the 8-deep queue held no sunsets for 20-plus draws. Equal-tally fairness across bins gives each bin airtime proportional to its size, which inverts the show's purpose when the non-sunset bin is seven times larger. The repeat allowance dial (max 3) cannot bridge tallies that drift apart by 4 or more over a window.

Bin-first alone brings back the case the operator rejected in the original spec: one sunset and eight non-sunsets alternating `S N S N`. The **rest** dial covers that: a shown frame sits out `rest` draws, so a lone sunset returns every fifth draw at the default of 4, and five sunsets fill two of every three draws.

## Global Constraints

- Work in the worktree `~/GitHub/the-sunset-webcam-map.worktrees/fix-solo-bin-first-ordering` on branch `fix/solo-bin-first-ordering`. Verify the branch in the same command as each commit. Stage explicit paths, never `git add -A`. Push after every commit with `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push`.
- The engine stays pure: no `Date.now()`, no I/O, no module state. Time enters only as `slot` and as each entry's `lastShownAt`.
- No database migration. `kiosk_bin_entries.last_shown_at` already exists and `commitAdvance` already writes it.
- `rest` dial: key `rest`, number, min 0, max 12, step 1, default 4, section `bins`, label `rest (draws)`.
- Rule numbering after this change: 1 bin choice, 2 rest, 3 within a bin, 4 never twice in a row, 5 floors. Rules 3, 4 and 5 keep their numbers and their text.
- `npm run test -- --run <path>` for one file; `npm run lint` and `npx tsc --noEmit` before each commit.
- Parallel sessions: as of writing, every peer session is idle and no open worktree touches `app/lib/solo/` (deploy-history Part B, which will touch `app/studio/solo/`, has not started). Before editing `app/studio/solo/RulesBox.tsx` in Task 5, run `ListAgents` and message any session named for deploy-history or solo studio work. Land the whole plan the same day.

---

## File structure

| path | responsibility after this plan |
|---|---|
| `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md` | §2 glossary: Tier → Rest; §4 rules rewritten; worked case updated |
| `app/lib/solo/types.ts` | `SoloDials.rest` replaces `repeatAllowance`; `BinEntry.lastShownAt?` |
| `app/lib/solo/settingsSchema.ts` (+ test) | `rest` knob replaces `repeatAllowance`; `dialsFrom` reads it |
| `app/lib/solo2/settingsSchema.ts` | `solo('rest')` replaces `solo('repeatAllowance')` |
| `app/lib/solo/engine.ts` (+ test) | `isResting`, `choosePool`, `next(entries, d, state, slot, feed)`, `project(..., firstSlot, feed)`; `tierOf` deleted |
| `app/lib/solo/versions.ts` | solo's adapter passes slot and feed through |
| `app/lib/solo2/engine.ts` (+ test) | `next2`/`project2` draw from `choosePool`; own rule 1/2 block deleted |
| `app/api/kiosk/solo/view.ts` | `toViewEntry` carries `lastShownAt` |
| `app/studio/solo/RulesBox.tsx` (+ test) | restates the new §4 |
| `app/studio/solo/FeedColumn.test.tsx` | fixtures use `rest` |

---

### Task 1: Spec — rewrite §4 and the glossary

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md:54-55` (glossary), `:81-116` (§4), `:267`, `:334`

- [ ] **Step 1: Replace the glossary entry**

Replace lines 54–55:

```markdown
- **Tier** — the tally after the sunset repeat allowance is applied. The
  first sort key across both bins.
```

with:

```markdown
- **Rest** — the draws a frame sits out after it has been on glass. Dial
  **rest** (0–12 draws, default 4). Measured from `last_shown_at` in slots
  of the current dwell.
```

- [ ] **Step 2: Replace §4 from the heading through the paragraph that ends "the first test fixtures."**

```markdown
## 4. The ordering rules

Stated once, in the order they apply. The studio prints this list with the
live dial values substituted, so the rule on screen is always the rule in
force.

1. **Choose the bin.** Count the sunset-bin frames that are eligible, not on
   glass and not resting. If there are at least **sunset floor** of them
   (0–12, default 6), draw from the sunset bin. Otherwise interleave: **mix**
   sunsets per non-sunset (1–6, default 2), counted as a streak that resets
   on each non-sunset draw. If one bin has no such frames, draw from the
   other. A floor of 0 means sunsets whenever any sunset is ready. To never
   show non-sunsets, set the detection floor to 1.
2. **A shown frame rests.** For **rest** draws (0–12, default 4) after it
   was on glass, a frame is not a candidate in either bin. Rest is counted in
   slots of the current dwell from `last_shown_at`; a frame never shown is
   never resting. If every eligible frame is resting, rest is waived for
   that draw and rule 4 alone applies.
3. **Within a bin, least shown first, then best.** Lower tally first; then
   sunset bin by quality, non-sunset bin by detection probability. **Promote
   new frames** (boolean, default on) adds +0.10 to a frame that arrived
   while an older frame from the same camera was already in the bin; the
   flag clears the first time it is shown. Remaining ties break by earlier
   `entered_at`, then snapshot id.
4. **Never the same frame twice in a row on one screen.** If it is the only
   eligible frame, it repeats.
5. **Floors.** Sunset bin: quality ≥ **quality floor** (0–1, default 0.55).
   Non-sunset bin: detection probability ≥ **detection floor** (0–1, default
   0.30). Frames below a floor stay in the table, render dimmed with a FLOOR
   tag, and are not eligible.

Worked cases, floor 6, mix 2, rest 4:

- One good sunset and eight non-sunsets: `S, N1, N2, N3, N4, S, N5, N6, N7,
  N8, S, N1 …`. The sunset returns every fifth draw; with rest 0 it would
  alternate `S, N1, S, N2 …`, the sunset-heavy shape the operator rejected.
- Five sunsets and thirty-five non-sunsets (the 2026-09-05 sunrise screen):
  `S1, S2, N, S3, S4, N, S5, S1, N …`. Two of every three draws are sunsets
  no matter how large the non-sunset bin grows. Under the earlier
  tally-across-bins rule this screen queued no sunset for 20-plus draws.
- Twenty sunsets: sunsets only, since at least six are always rested. A
  rich night shows no non-sunsets unless the floor is raised above the bin.

History: until 2026-09-05 rule 1 was "lowest tier across both bins", tier
being tally minus a **sunset repeat allowance** (0–3). It made each bin's
airtime proportional to its size, which starved the sunsets whenever the
non-sunset bin was several times larger. The allowance dial is gone; stored
values are ignored.

The engine is a **pure function**:
`next(entries, dials, screenState, slot, feed) → entry | null` and
`project(entries, dials, screenState, n, firstSlot, feed) → entry[]`. No
clock, no I/O; time enters only as the slot and each entry's `last_shown_at`.
```

- [ ] **Step 3: Fix the two dial lists**

Line 267: change `mix, repeat allowance, zone grace,` to `mix, rest, zone grace,`.
Line 334: change `the three allowance sequences from the mockup` to `the rest sequences in §4`.

- [ ] **Step 4: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/fix-solo-bin-first-ordering && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = fix/solo-bin-first-ordering ] && \
  git add docs/superpowers/specs/2026-09-04-solo-kiosk-design.md && \
  git commit -m "docs(solo): spec §4 chooses the bin first and rests shown frames

Tally fairness across bins gave each bin airtime proportional to its size,
which queued no sunsets for 20+ draws on 2026-09-05. Rule 1 now picks the
bin by floor and mix; a new rest dial replaces the repeat allowance.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NmNnKqKLT66epveF23nnhF" && \
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin fix/solo-bin-first-ordering
```

---

### Task 2: Types and schemas — `rest` replaces `repeatAllowance`

**Files:**
- Modify: `app/lib/solo/types.ts:8-22` (BinEntry), `:25-45` (SoloDials)
- Modify: `app/lib/solo/settingsSchema.ts:69-73`, `:93`
- Modify: `app/lib/solo2/settingsSchema.ts:73`
- Test: `app/lib/solo/settingsSchema.test.ts:13-16`, `:26-31`

**Interfaces:**
- Produces: `SoloDials.rest: number`; `BinEntry.lastShownAt?: number | null` (ms since epoch; undefined or null = never shown). Later tasks rely on both names exactly.

- [ ] **Step 1: Update the schema test to the new dial**

In `app/lib/solo/settingsSchema.test.ts`, line 14: replace `repeatAllowance: 1,` with `rest: 4,`. Lines 27–29:

```ts
    const merged = mergeSettings(SOLO_SETTINGS_SCHEMA, { rest: 7, dwellS: 5 });
    const d = dialsFrom(merged);
    expect(d.rest).toBe(7);
```

Add a new test at the end of the `describe('SOLO_SETTINGS_SCHEMA')` block:

```ts
  it('drops a stored repeatAllowance from before 2026-09-05 and has no such dial', () => {
    expect(SOLO_SETTINGS_SCHEMA.find((k) => k.key === 'repeatAllowance')).toBeUndefined();
    const merged = mergeSettings(SOLO_SETTINGS_SCHEMA, { repeatAllowance: 3 });
    expect('repeatAllowance' in merged).toBe(false);
    expect(merged.rest).toBe(4);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- --run app/lib/solo/settingsSchema.test.ts`
Expected: FAIL — `d.rest` is undefined and the `repeatAllowance` knob is still found.

- [ ] **Step 3: Change the types**

In `app/lib/solo/types.ts`, inside `BinEntry` after `enteredAt`:

```ts
  /** When this frame was last on glass, ms since epoch. Undefined or null = never (rule 2). */
  lastShownAt?: number | null;
```

In `SoloDials`, replace `repeatAllowance: number;` with `rest: number;`.

- [ ] **Step 4: Swap the knob in both schemas**

In `app/lib/solo/settingsSchema.ts`, replace the `repeatAllowance` knob (lines 69–73) with:

```ts
  {
    key: 'rest', kind: 'number', min: 0, max: 12, step: 1, default: 4,
    label: 'rest (draws)', section: 'bins',
    description: 'Draws a frame sits out after it has been on glass, in either bin. 0 = only never twice in a row.',
  },
```

Line 93: replace `repeatAllowance: values.repeatAllowance as number,` with `rest: values.rest as number,`.

In `app/lib/solo2/settingsSchema.ts` line 73: replace `solo('repeatAllowance'),` with `solo('rest'),`.

- [ ] **Step 5: Run the schema tests**

Run: `npm run test -- --run app/lib/solo/settingsSchema.test.ts app/lib/solo2/settingsSchema.test.ts`
Expected: PASS. (`npx tsc --noEmit` will still fail until Tasks 3–5 finish; that is expected here.)

- [ ] **Step 6: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/fix-solo-bin-first-ordering && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = fix/solo-bin-first-ordering ] && \
  git add app/lib/solo/types.ts app/lib/solo/settingsSchema.ts app/lib/solo/settingsSchema.test.ts app/lib/solo2/settingsSchema.ts && \
  git commit -m "feat(solo): rest dial replaces the sunset repeat allowance; entries carry lastShownAt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NmNnKqKLT66epveF23nnhF" && \
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push
```

---

### Task 3: The solo engine — bin first, rest, least-shown within the bin

**Files:**
- Modify: `app/lib/solo/engine.ts` (whole file)
- Modify: `app/lib/solo/versions.ts:35-36`
- Test: `app/lib/solo/engine.test.ts` (whole file)

**Interfaces:**
- Consumes: `slotFor`, `boundaryMs` from `./schedule`; `SoloDials.rest`, `BinEntry.lastShownAt` from Task 2.
- Produces, all exported from `app/lib/solo/engine.ts`:
  - `isEligible(e, d): boolean` (unchanged)
  - `isResting(e: BinEntry, d: SoloDials, slot: number, feed: Feed): boolean`
  - `rankScore(e, d): number` (unchanged)
  - `choosePool(entries: BinEntry[], d: SoloDials, state: ScreenState, slot: number, feed: Feed): BinEntry[]`
  - `next(entries, d, state, slot: number, feed: Feed): BinEntry | null`
  - `project(entries, d, state, n, firstSlot: number, feed: Feed): BinEntry[]`
  - `afterShowing(e, state)` (unchanged)
  - `tierOf` is **deleted**.

- [ ] **Step 1: Rewrite the engine test file**

Replace `app/lib/solo/engine.test.ts` entirely:

```ts
import { describe, it, expect } from 'vitest';
import { next, project, isEligible, isResting, choosePool, afterShowing } from './engine';
import { boundaryMs } from './schedule';
import type { BinEntry, SoloDials, ScreenState, Feed } from './types';

const D: SoloDials = {
  qualityFloor: 0.55, detectionFloor: 0.3, sunsetFloor: 6, mix: 2,
  rest: 4, promoteNew: true, zoneGrace: 2,
  dwellS: 20, offsetS: 10, fadeS: 0,
  showPlace: true, showScores: false, showRank: false, showTally: false,
};
const S0: ScreenState = { lastSnapshotId: null, sunsetStreak: 0 };
const FEED: Feed = 'sunrise';

function sun(id: number, q: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 1000 + id, bin: 'sunset', quality: q, detection: 0.9,
    isNew: false, tally: 0, enteredAt: id, lastShownAt: null, ...extra };
}
function non(id: number, det: number, extra: Partial<BinEntry> = {}): BinEntry {
  return { snapshotId: id, webcamId: 2000 + id, bin: 'non_sunset', quality: null, detection: det,
    isNew: false, tally: 0, enteredAt: id, lastShownAt: null, ...extra };
}
/** N1..N8 with descending detection so their order is deterministic. */
const eightNon = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => non(100 + i, 0.6 - i * 0.02));
/** S1..S5 by descending quality. */
const fiveSun = () => [1, 2, 3, 4, 5].map((i) => sun(i, 0.95 - i * 0.02));
const nx = (entries: BinEntry[], d: SoloDials = D, s: ScreenState = S0, slot = 0) => next(entries, d, s, slot, FEED);
const seq = (entries: BinEntry[], d: SoloDials, n = 12) =>
  project(entries, d, S0, n, 0, FEED).map((e) => (e.bin === 'sunset' ? `S${e.snapshotId}` : `N${e.snapshotId - 100}`));
const bins = (entries: BinEntry[], d: SoloDials, n: number) => project(entries, d, S0, n, 0, FEED).map((e) => e.bin);
/** A frame that went on glass at `slot`. */
const shownAt = (slot: number) => ({ tally: 1, lastShownAt: boundaryMs(slot, FEED, D.dwellS, D.offsetS) });

describe('spec §4 worked cases (floor 6, mix 2, rest 4)', () => {
  it('one sunset, eight non-sunsets: the sunset returns every fifth draw', () => {
    expect(seq([sun(1, 0.97), ...eightNon()], D)).toEqual(
      ['S1', 'N1', 'N2', 'N3', 'N4', 'S1', 'N5', 'N6', 'N7', 'N8', 'S1', 'N1']);
  });
  it('rest 0: the sunset alternates with the non-sunsets (rule 4 is the only spacing)', () => {
    expect(seq([sun(1, 0.97), ...eightNon()], { ...D, rest: 0 })).toEqual(
      ['S1', 'N1', 'S1', 'N2', 'S1', 'N3', 'S1', 'N4', 'S1', 'N5', 'S1', 'N6']);
  });
  it('five sunsets, eight non-sunsets: two sunsets per non-sunset, least shown first', () => {
    expect(seq([...fiveSun(), ...eightNon()], D)).toEqual(
      ['S1', 'S2', 'N1', 'S3', 'S4', 'N2', 'S5', 'S1', 'N3', 'S2', 'S3', 'N4']);
  });
  it('two sunsets, eight non-sunsets: both sunsets, then non-sunsets while they rest', () => {
    expect(seq([sun(1, 0.9), sun(2, 0.8), ...eightNon()], D)).toEqual(
      ['S1', 'S2', 'N1', 'N2', 'N3', 'S1', 'S2', 'N4', 'N5', 'N6', 'S1', 'S2']);
  });
  it('the bin size of the non-sunsets does not change the sunset share', () => {
    const many = Array.from({ length: 35 }, (_, i) => non(200 + i, 0.6 - i * 0.005));
    const out = bins([...fiveSun(), ...many], D, 30);
    expect(out.filter((b) => b === 'sunset').length).toBe(20);
  });
});

describe('rule 1: choose the bin', () => {
  it('sunsets only while at least sunsetFloor sunsets are rested', () => {
    const seven = [1, 2, 3, 4, 5, 6, 7].map((i) => sun(i, 0.9 - i * 0.01));
    // Seven rested ≥ 6 → S. After seven draws only S1..S3 are rested (3 < 6) and the streak is 7 → N.
    expect(bins([...seven, ...eightNon()], D, 8)).toEqual([
      'sunset', 'sunset', 'sunset', 'sunset', 'sunset', 'sunset', 'sunset', 'non_sunset']);
  });
  it('twenty sunsets: a rich night is sunsets only', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => sun(i + 1, 0.99 - i * 0.02));
    expect(new Set(bins([...twenty, ...eightNon()], D, 12))).toEqual(new Set(['sunset']));
  });
  it('sunsetFloor 0: sunsets whenever any sunset is rested', () => {
    expect(bins([...fiveSun(), ...eightNon()], { ...D, sunsetFloor: 0 }, 12).every((b) => b === 'sunset')).toBe(true);
    expect(seq([sun(1, 0.9), sun(2, 0.8), ...eightNon()], { ...D, sunsetFloor: 0 })).toEqual(
      ['S1', 'S2', 'N1', 'N2', 'N3', 'S1', 'S2', 'N4', 'N5', 'N6', 'S1', 'S2']);
  });
  it('mix 1 alternates the bins below the floor', () => {
    expect(bins([...fiveSun(), ...eightNon()], { ...D, mix: 1 }, 4)).toEqual(
      ['sunset', 'non_sunset', 'sunset', 'non_sunset']);
  });
  it('detection floor 1.0 is the way to never show a non-sunset', () => {
    expect(bins([sun(1, 0.9), sun(2, 0.8), ...eightNon()], { ...D, detectionFloor: 1 }, 6))
      .toEqual(['sunset', 'sunset', 'sunset', 'sunset', 'sunset', 'sunset']);
  });
  it('an empty sunset bin draws non-sunsets', () => {
    expect(nx(eightNon())?.snapshotId).toBe(101);
  });
  it('the streak counts against the pool: after mix sunsets, a non-sunset', () => {
    const entries = [...fiveSun(), ...eightNon()];
    expect(choosePool(entries, D, { lastSnapshotId: 2, sunsetStreak: 2 }, 2, FEED).every((e) => e.bin === 'non_sunset')).toBe(true);
    expect(choosePool(entries, D, { lastSnapshotId: 1, sunsetStreak: 1 }, 1, FEED).every((e) => e.bin === 'sunset')).toBe(true);
  });
});

describe('rule 2: rest', () => {
  it('a frame shown at slot 0 rests through slot 4 and is back at slot 5', () => {
    const e = sun(1, 0.9, shownAt(0));
    expect([1, 2, 3, 4].map((slot) => isResting(e, D, slot, FEED))).toEqual([true, true, true, true]);
    expect(isResting(e, D, 5, FEED)).toBe(false);
  });
  it('a frame never shown is never resting; rest 0 rests only in its own slot', () => {
    expect(isResting(sun(1, 0.9), D, 3, FEED)).toBe(false);
    expect(isResting(sun(1, 0.9, { lastShownAt: undefined }), D, 3, FEED)).toBe(false);
    const e = sun(1, 0.9, shownAt(2));
    expect(isResting(e, { ...D, rest: 0 }, 2, FEED)).toBe(true);
    expect(isResting(e, { ...D, rest: 0 }, 3, FEED)).toBe(false);
  });
  it('non-sunsets rest too', () => {
    const entries = [non(101, 0.6, shownAt(0)), non(102, 0.5)];
    expect(nx(entries, D, { lastSnapshotId: 102, sunsetStreak: 0 }, 1)?.snapshotId).toBe(102);
  });
  it('when every eligible frame is resting, rest is waived and rule 4 alone applies', () => {
    expect(seq([sun(1, 0.9), sun(2, 0.8)], D, 4)).toEqual(['S1', 'S2', 'S1', 'S2']);
  });
  it('rest is measured in slots of the current dwell', () => {
    const e = sun(1, 0.9, { tally: 1, lastShownAt: boundaryMs(0, FEED, 60, D.offsetS) });
    // Shown at t=0 with a 60 s dwell: slot 3 of a 60 s dwell is 180 s later, still resting; slot 5 is not.
    expect(isResting(e, { ...D, dwellS: 60 }, 3, FEED)).toBe(true);
    expect(isResting(e, { ...D, dwellS: 60 }, 5, FEED)).toBe(false);
  });
});

describe('rule 3: within a bin', () => {
  it('least shown first', () => {
    expect(nx([sun(1, 0.9, { tally: 1 }), sun(2, 0.6)])?.snapshotId).toBe(2);
    expect(nx([non(1, 0.5, { tally: 2 }), non(2, 0.4, { tally: 1 })])?.snapshotId).toBe(2);
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
});

describe('rule 4: never twice in a row', () => {
  it('skips the frame on glass', () => {
    expect(nx([sun(1, 0.9), sun(2, 0.6)], D, { lastSnapshotId: 1, sunsetStreak: 1 })?.snapshotId).toBe(2);
  });
  it('repeats when it is the only eligible frame', () => {
    expect(nx([sun(1, 0.9)], D, { lastSnapshotId: 1, sunsetStreak: 1 })?.snapshotId).toBe(1);
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
    expect(nx([sun(1, 0.1), non(2, 0.1)])).toBeNull();
  });
});

describe('state and projection', () => {
  it('afterShowing tracks the streak and the frame on glass', () => {
    expect(afterShowing(sun(1, 0.9), S0)).toEqual({ lastSnapshotId: 1, sunsetStreak: 1 });
    expect(afterShowing(non(2, 0.5), { lastSnapshotId: 1, sunsetStreak: 2 })).toEqual({ lastSnapshotId: 2, sunsetStreak: 0 });
  });
  it('project does not mutate its inputs', () => {
    const entries = [sun(1, 0.9), non(2, 0.5)];
    project(entries, D, S0, 5, 0, FEED);
    expect(entries[0].tally).toBe(0);
    expect(entries[0].lastShownAt).toBeNull();
  });
  it('project honours the live lastShownAt of the entries it starts from', () => {
    // S1 went on glass at slot 3; projecting from slot 4 it must rest until slot 8.
    const entries = [sun(1, 0.9, shownAt(3)), sun(2, 0.8), ...eightNon()];
    const out = project(entries, D, { lastSnapshotId: 1, sunsetStreak: 1 }, 5, 4, FEED)
      .map((e) => (e.bin === 'sunset' ? `S${e.snapshotId}` : 'N'));
    expect(out).toEqual(['S2', 'N', 'N', 'N', 'S1']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- --run app/lib/solo/engine.test.ts`
Expected: FAIL — `isResting` and `choosePool` are not exported; `next` ignores its extra arguments and picks by tier.

- [ ] **Step 3: Rewrite the engine**

Replace `app/lib/solo/engine.ts` entirely:

```ts
import { boundaryMs, slotFor } from './schedule';
import type { BinEntry, Feed, ScreenState, SoloDials } from './types';

/**
 * The solo kiosk's ordering rules, spec §4, as a pure function. No clock, no
 * I/O, no module state: memory across draws is the ScreenState argument, the
 * tally and lastShownAt live on the entries the caller passes in, and time
 * enters only as the slot being drawn. The studio runs `project()` with the
 * studio profile's dials to show what the glass will do; the advance
 * endpoint runs `next()` with the live profile's.
 */

/** Rule 3: a frame that arrived while its camera was already in the bin. */
export const NEW_FRAME_BONUS = 0.1;

/** Rule 5. */
export function isEligible(e: BinEntry, d: SoloDials): boolean {
  return e.bin === 'sunset'
    ? (e.quality ?? -1) >= d.qualityFloor
    : e.detection >= d.detectionFloor;
}

/**
 * Rule 2: a frame sits out `rest` draws after it was on glass, counted in
 * slots of the current dwell. Never shown → never resting.
 */
export function isResting(e: BinEntry, d: SoloDials, slot: number, feed: Feed): boolean {
  if (e.lastShownAt == null) return false;
  const shownSlot = slotFor(e.lastShownAt, feed, d.dwellS, d.offsetS);
  return slot - shownSlot <= d.rest;
}

/** Rule 3: quality for sunsets, detection for non-sunsets, plus the new-frame bonus. */
export function rankScore(e: BinEntry, d: SoloDials): number {
  const base = e.bin === 'sunset' ? (e.quality ?? 0) : e.detection;
  return base + (d.promoteNew && e.isNew ? NEW_FRAME_BONUS : 0);
}

/** Rule 3: least shown, then best, then earliest, then id. */
function compareWithin(d: SoloDials) {
  return (a: BinEntry, b: BinEntry): number =>
    a.tally - b.tally ||
    rankScore(b, d) - rankScore(a, d) ||
    a.enteredAt - b.enteredAt ||
    a.snapshotId - b.snapshotId;
}

/**
 * Rules 5, 4, 2 and 1, in that order: the frames the next draw may come
 * from. Eligible, not on glass, not resting; then one bin, chosen by the
 * sunset floor and the mix. If everything is resting, rest is waived for
 * this draw; if the frame on glass is the only eligible one, it repeats.
 * Empty only when nothing is eligible.
 */
export function choosePool(
  entries: BinEntry[], d: SoloDials, state: ScreenState, slot: number, feed: Feed,
): BinEntry[] {
  const eligible = entries.filter((e) => isEligible(e, d));
  const notOnGlass = eligible.filter((e) => e.snapshotId !== state.lastSnapshotId);
  let candidates = notOnGlass.filter((e) => !isResting(e, d, slot, feed));
  if (candidates.length === 0) candidates = notOnGlass;
  if (candidates.length === 0) candidates = eligible;
  if (candidates.length === 0) return [];

  const sunsets = candidates.filter((e) => e.bin === 'sunset');
  const nonSunsets = candidates.filter((e) => e.bin === 'non_sunset');
  if (sunsets.length === 0) return nonSunsets;
  if (nonSunsets.length === 0) return sunsets;
  if (sunsets.length >= d.sunsetFloor) return sunsets;
  return state.sunsetStreak >= d.mix ? nonSunsets : sunsets;
}

/** The next frame for one screen drawing at `slot`, or null when nothing is eligible. */
export function next(
  entries: BinEntry[], d: SoloDials, state: ScreenState, slot: number, feed: Feed,
): BinEntry | null {
  const pool = choosePool(entries, d, state, slot, feed);
  if (pool.length === 0) return null;
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
 * `n` draws forward from `state`, the first at `firstSlot`, each applied to
 * a private copy of the entries (tally +1, isNew cleared, lastShownAt set to
 * that slot's boundary). The inputs are never mutated. Fewer than `n`
 * entries come back only when nothing is eligible.
 */
export function project(
  entries: BinEntry[], d: SoloDials, state: ScreenState, n: number, firstSlot: number, feed: Feed,
): BinEntry[] {
  const working = entries.map((e) => ({ ...e }));
  let s = state;
  const out: BinEntry[] = [];
  for (let i = 0; i < n; i++) {
    const slot = firstSlot + i;
    const pick = next(working, d, s, slot, feed);
    if (!pick) break;
    out.push({ ...pick });
    pick.tally += 1;
    pick.isNew = false;
    pick.lastShownAt = boundaryMs(slot, feed, d.dwellS, d.offsetS);
    s = afterShowing(pick, s);
  }
  return out;
}
```

- [ ] **Step 4: Pass slot and feed through the solo version adapter**

In `app/lib/solo/versions.ts` lines 35–36 replace:

```ts
  next: (entries, d, state) => next(entries, d, state),
  project: (entries, d, state, n) => project(entries, d, state, n),
```

with:

```ts
  next,
  project,
```

And on line 20 change the comment `/** The next frame for a draw at \`slot\`; solo ignores the slot. */` to `/** The next frame for a draw at \`slot\`. */`.

- [ ] **Step 5: Run the engine tests**

Run: `npm run test -- --run app/lib/solo/engine.test.ts app/lib/solo/versions.test.ts`
Expected: PASS, all cases. If a worked-case sequence differs, do not edit the expectation: trace the draw by hand against §4 (rule 1 bin → rule 2 rest → rule 3 order) and fix the engine.

- [ ] **Step 6: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/fix-solo-bin-first-ordering && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = fix/solo-bin-first-ordering ] && \
  git add app/lib/solo/engine.ts app/lib/solo/engine.test.ts app/lib/solo/versions.ts && \
  git commit -m "feat(solo): choose the bin first, rest shown frames, least-shown within the bin

Rule 1 no longer compares tallies across bins, so a 35-frame non-sunset
bin can no longer queue out a 5-frame sunset bin. choosePool is shared
with solo2 in the next commit.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NmNnKqKLT66epveF23nnhF" && \
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push
```

---

### Task 4: solo2 draws from the shared pool

**Files:**
- Modify: `app/lib/solo2/engine.ts:1`, `:40-63`, `:69-85`
- Test: `app/lib/solo2/engine.test.ts:13-19`, `:45-56`, `:76-81`

**Interfaces:**
- Consumes: `choosePool`, `afterShowing`, `rankScore` from `@/app/lib/solo/engine`; `boundaryMs` from `@/app/lib/solo/schedule`.
- Produces: `next2` and `project2` keep their signatures.

- [ ] **Step 1: Update the solo2 tests**

In `app/lib/solo2/engine.test.ts`:

Lines 13–19, add `lastShownAt: null,` after `enteredAt: id,` in both `sun` and `non`.

Lines 45–56 (`describe('valleys 0 is solo')`) become:

```ts
describe('valleys 0 is solo', () => {
  it('reproduces the thin-night fixtures for every rest', () => {
    for (const rest of [0, 4, 8]) {
      const d = { ...D, rest };
      const entries = [sun(1, 0.97), ...eightNon()];
      expect(labels(project2(entries, d, S0, 12, 5, 'sunset'))).toEqual(labels(project(entries, d, S0, 12, 5, 'sunset')));
    }
  });
  it('reproduces solo on a full sunset bin', () => {
    expect(labels(project2(twentyOne(), D, S0, 8, 0, 'sunrise'))).toEqual(labels(project(twentyOne(), D, S0, 8, 0, 'sunrise')));
  });
  it('reproduces solo on the 2026-09-05 shape: five sunsets, thirty-five non-sunsets', () => {
    const many = Array.from({ length: 35 }, (_, i) => non(200 + i, 0.6 - i * 0.005));
    const five = [1, 2, 3, 4, 5].map((i) => sun(i, 0.95 - i * 0.02));
    expect(labels(project2([...five, ...many], D, S0, 12, 0, 'sunrise'))).toEqual(labels(project([...five, ...many], D, S0, 12, 0, 'sunrise')));
  });
});
```

Lines 76–81 (`'a valley prefers an unshown frame over a lower-scored one already shown'`) become:

```ts
  it('a valley prefers an unshown frame over a lower-scored one already shown', () => {
    const d = { ...D, valleys: 1 };
    // Frame 3 has been shown once (never resting: no lastShownAt); rule 3 puts tally before score.
    const entries = [sun(1, 0.95), sun(2, 0.6), sun(3, 0.58, { tally: 1 })];
    expect(next2(entries, d, S0, 1, 'sunrise')?.snapshotId).toBe(2);
  });
```

Add at the end of the `describe('rhythm')` block:

```ts
  it('a resting frame is out of both the peak and the valley', () => {
    const d = { ...D, valleys: 1 };
    const shown = { tally: 1, lastShownAt: boundaryMs(0, 'sunrise', D.dwellS, D.offsetS) };
    const entries = [sun(1, 0.95, shown), sun(2, 0.6), sun(3, 0.58, shown)];
    // slot 1 is a valley: the lowest score among the rested is frame 2, the only one.
    expect(next2(entries, d, S0, 1, 'sunrise')?.snapshotId).toBe(2);
    // slot 2 is a peak: frame 2 is on glass, 1 and 3 still rest → rest waived → best is 1.
    expect(next2(entries, d, { lastSnapshotId: 2, sunsetStreak: 1 }, 2, 'sunrise')?.snapshotId).toBe(1);
  });
```

Add `import { boundaryMs } from '@/app/lib/solo/schedule';` to the imports.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- --run app/lib/solo2/engine.test.ts`
Expected: FAIL — type errors on `tierOf` import once Task 3 deleted it, and the new fixtures disagree with the tier logic.

- [ ] **Step 3: Compose `choosePool` in solo2**

In `app/lib/solo2/engine.ts`, line 1 becomes:

```ts
import { afterShowing, choosePool, rankScore } from '@/app/lib/solo/engine';
import { boundaryMs } from '@/app/lib/solo/schedule';
```

Replace the body of `next2` (from `const eligible = ...` through `// Rule 3, on the beat.`) so the function reads:

```ts
export function next2(
  entries: BinEntry[], d: Solo2Dials, state: ScreenState, slot: number, feed: Feed,
): BinEntry | null {
  // Rules 5, 4, 2, 1 are solo's.
  const pool = choosePool(entries, d, state, slot, feed);
  if (pool.length === 0) return null;
  // Rule 3, on the beat.
  const cmp = roleAt(slot, feed, d) === 'peak' ? comparePeak(d) : compareValley(d);
  return [...pool].sort(cmp)[0];
}
```

In `project2`, after `pick.isNew = false;` add:

```ts
    pick.lastShownAt = boundaryMs(firstSlot + i, feed, d.dwellS, d.offsetS);
```

Update the header comment's `rule 3 on a beat (spec §3)` sentence to: `solo's rules with rule 3 on a beat (spec §3). Pure: no clock, no I/O. Draws from solo's choosePool rather than copying it; solo's engine is not touched.`

- [ ] **Step 4: Run the solo2 tests**

Run: `npm run test -- --run app/lib/solo2/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/fix-solo-bin-first-ordering && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = fix/solo-bin-first-ordering ] && \
  git add app/lib/solo2/engine.ts app/lib/solo2/engine.test.ts && \
  git commit -m "feat(solo2): draw from solo's choosePool so both versions pick the bin first

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NmNnKqKLT66epveF23nnhF" && \
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push
```

---

### Task 5: View, studio rules box, remaining fixtures, full green

**Files:**
- Modify: `app/api/kiosk/solo/view.ts:39-46`
- Modify: `app/studio/solo/RulesBox.tsx:22-26`
- Test: `app/studio/solo/RulesBox.test.tsx:7-15`
- Test: `app/studio/solo/FeedColumn.test.tsx:33`, `:71`

**Interfaces:**
- Consumes: `SoloDials.rest` (Task 2), `BinEntry.lastShownAt` (Task 2).

- [ ] **Step 0: Coordination**

Run `ListAgents`. If any session name mentions deploy-history, solo studio, or solo preview, `SendMessage` it: "Editing app/studio/solo/RulesBox.tsx and FeedColumn.test.tsx on fix/solo-bin-first-ordering for the bin-first ordering fix; small diff, landing today." Then proceed.

- [ ] **Step 1: Update the RulesBox test**

Replace lines 7–15 of `app/studio/solo/RulesBox.test.tsx`:

```tsx
it('states the five rules with the dial values in force', () => {
  const d = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
  render(<RulesBox dials={{ ...d, rest: 2, sunsetFloor: 4, mix: 3 }} />);
  expect(screen.getByText(/rested sunsets/).textContent).toContain('4');
  expect(screen.getByText(/per non-sunset/).textContent).toContain('3');
  expect(screen.getByText(/rests/).textContent).toContain('2');
  expect(screen.getByText(/least shown first/)).toBeInTheDocument();
  expect(screen.getByText(/Never the same frame twice/)).toBeInTheDocument();
  expect(screen.getByText(/Floors/).textContent).toContain('0.55');
  expect(screen.queryByText(/minus/)).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- --run app/studio/solo/RulesBox.test.tsx`
Expected: FAIL — no text matches `/rested sunsets/`.

- [ ] **Step 3: Restate the rules**

Replace lines 22–26 of `app/studio/solo/RulesBox.tsx`:

```tsx
      <div><B>1.</B> Bin first: <B>{d.sunsetFloor}</B>+ rested sunsets → sunsets only, else <B>{d.mix}</B> sunsets per non-sunset.</div>
      <div><B>2.</B> A shown frame rests <B>{d.rest}</B> {d.rest === 1 ? 'draw' : 'draws'}{d.rest === 0 ? ' (off)' : ''}.</div>
      <div><B>3.</B> In a bin: least shown first, then best score{d.promoteNew ? ', new frames +0.10' : ''}{rhythm ? <>;{rhythm}</> : null}.</div>
      <div><B>4.</B> Never the same frame twice in a row.</div>
      <div><B>5.</B> Floors: sunsets q ≥ <B>{d.qualityFloor.toFixed(2)}</B>, non-sunsets d ≥ <B>{d.detectionFloor.toFixed(2)}</B>.</div>
```

- [ ] **Step 4: Carry `lastShownAt` into the view**

In `app/api/kiosk/solo/view.ts` `toViewEntry`, line 42, after `enteredAt: e.enteredAt,` add `lastShownAt: e.lastShownAt,`. (`ViewEntry extends BinEntry`, so the type already allows it; without it a client re-projecting from raw entries would never see a frame rest.)

- [ ] **Step 5: Fix the two FeedColumn fixtures**

`app/studio/solo/FeedColumn.test.tsx` line 33: `repeatAllowance: 0` → `rest: 0`. Line 71: `repeatAllowance: 0` → `rest: 0`.

- [ ] **Step 6: Type-check, lint, and run the whole suite**

Run: `npx tsc --noEmit && npm run lint && npm run test -- --run`
Expected: tsc clean, lint clean, every test passing. If `tsc` reports any remaining `repeatAllowance` or `tierOf` reference, fix that call site to use `rest` or `choosePool` per the tasks above; do not reintroduce either name.

Sanity grep, expected empty:

```bash
grep -rn "repeatAllowance\|tierOf" app --include='*.ts' --include='*.tsx'
```

- [ ] **Step 7: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/fix-solo-bin-first-ordering && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = fix/solo-bin-first-ordering ] && \
  git add app/api/kiosk/solo/view.ts app/studio/solo/RulesBox.tsx app/studio/solo/RulesBox.test.tsx app/studio/solo/FeedColumn.test.tsx && \
  git commit -m "feat(studio): rules box restates bin-first ordering and rest; view carries lastShownAt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NmNnKqKLT66epveF23nnhF" && \
  GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push
```

---

### Task 6: Smoke on a dev server, PR, deploy verification

**Files:** none new.

- [ ] **Step 1: Run the studio against production data**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/fix-solo-bin-first-ordering && npm run dev
```

Open the printed port at `/studio` (solo tab, then solo2 tab). Check, on whichever feed has a small sunset bin and a large non-sunset bin:
- The ON GLASS + NEXT UP column shows sunsets in roughly two of every three slots (mix 2), not zero.
- The rules box reads "1. Bin first: 6+ rested sunsets → sunsets only, else 2 sunsets per non-sunset." and "2. A shown frame rests 4 draws."
- The dial rail shows `rest (draws)` where `sunset repeat allowance` used to be, in both versions.
- No console errors. Stop the server.

- [ ] **Step 2: Open the PR**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/fix-solo-bin-first-ordering && \
  [ "$(git rev-parse --abbrev-ref HEAD)" = fix/solo-bin-first-ordering ] && \
  gh pr create --title "fix(solo): choose the bin first so a large non-sunset bin cannot queue out the sunsets" \
    --body-file /dev/stdin <<'EOF'
On 2026-09-05 the sunrise screen had 5 sunsets at tally 9–11 and 35 non-sunsets at tally 7. Rule 1 compared tallies across bins, so every non-sunset outranked every sunset until all 35 had shown again: no sunset in the queue for 20+ draws. Equal-tally fairness gives each bin airtime proportional to its size.

Rule 1 now picks the bin first (sunset floor, then the mix dial), then the least-shown frame inside it. A new **rest** dial (default 4 draws) replaces the sunset repeat allowance and keeps a lone sunset from alternating with the non-sunsets. Both `solo` and `solo2` draw from the shared `choosePool`.

No migration: rest reads the `last_shown_at` column the advance route already writes. Stored `repeatAllowance` values in deploy snapshots are dropped by the schema sanitizer.

Spec §4 rewritten with three worked cases. After merge the change is live on the next advance; the glass needs no reload for ordering, but `bash scripts/pi/kiosk-doctor.sh --sync --reload` refreshes the studio-facing build as usual.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01NmNnKqKLT66epveF23nnhF
EOF
```

(`EOF` must be flush-left.)

- [ ] **Step 3: After Jesse merges**

- Confirm on production `/studio` that the queue column carries sunsets in the mix ratio within two dwell periods.
- `bash scripts/pi/kiosk-doctor.sh --sync --reload` from the main checkout.
- `scripts/wt.sh rm fix/solo-bin-first-ordering` from the main checkout.
- Update the memory note `project_solo_zone_swept_rings.md` where it describes "cross-bin tiers" so it points at §4 as rewritten.

---

## Self-review

- **Spec coverage.** §4 rules 1–5: rule 1 in `choosePool` (Task 3) with floor, mix, empty-bin, floor-0 tests; rule 2 in `isResting` with slot, dwell, never-shown, waiver tests; rule 3 in `compareWithin` with tally-first test; rules 4 and 5 unchanged and still tested. Three worked cases are test fixtures. Glossary and dial lists updated (Task 1). solo2 composes the same pool (Task 4). Studio restates the rules (Task 5).
- **Placeholders.** None: every step carries its code or its exact edit.
- **Type consistency.** `rest` (number), `lastShownAt?: number | null`, `isResting(e, d, slot, feed)`, `choosePool(entries, d, state, slot, feed)`, `next(entries, d, state, slot, feed)`, `project(entries, d, state, n, firstSlot, feed)` are spelled the same in Tasks 2–5. `tierOf` and `repeatAllowance` appear only as things to delete.
- **Sequences.** Each worked-case expectation in Task 3 was traced by hand from the rules: rest counts "slot − shownSlot ≤ rest" as resting, so a frame shown at slot 0 returns at slot 5.
