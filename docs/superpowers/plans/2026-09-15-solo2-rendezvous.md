# solo2 — The Rendezvous (phase 2a: the mechanism) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Both screens land on their best-rated frame on the same tick, when the dial is on and the sunset is good enough, fitted by dropping frames from the climb or growing the run that is ending, never by holding or changing the rate.

**Architecture:** One pure module, `app/lib/solo2/rendezvous.ts`, decides a draw (`fitNext`): plain, pin, fit, grow, or no fit. The run window moves to "around the peak, climb first" in `runOf`, so every surface that derives a run follows. The server threads one number between the screens through `kiosk_screen_state.peak_at`, gains a "keep going" answer that extends the ending dwell, and refuses to advance a dwell that has not ended. The kiosk already re-fits its plan from the published span, so a grown dwell plays on without a remount. A two-screen replay walks both clocks over recorded pools and counts rendezvous made, missed, frames dropped and grown.

**Tech Stack:** Next.js 15 app router, TypeScript, Vitest + Testing Library, Neon Postgres. Tests: `npx vitest run <path>`.

**Spec:** `docs/superpowers/specs/2026-09-14-solo2-beat-and-rendezvous-design.md` §3 (all of it), §5 (replay), §6 (migration). §4.1 (one tape for two screens), §4.2's rendezvous wording, and the ties/ghosts on the tape are **phase 2b**, a separate plan; the state view in this plan exposes what 2b will draw.

## Global Constraints

- Builds on phase 1 (`feat/solo2-beat`, PR #216): a frame is one beat; `fitPlan(d, frames)` is whole beats; `DwellPlan.arrivalS = changeBeats × beatS`; the advance snaps to the nearest tick; `endsAtMs = shownSince + dwellMs` is a tick.
- **Peak** = the best-rated sunset frame of a camera's series (`quality`, sunset bin). **Landing** = the tick its run's peak goes on glass = `t0 + (changeBeats + before) × beatS`. **Eligible** = `rendezvous` on, a peak draw (rhythm role), the camera has a peak, `qualityRank ≥ rendezvousRank`.
- The window around the peak (spec §3.6): `before ≤ P`, `after ≤ A`, `before + 1 + after ≤ cap`; default `before = min(P, cap − 1)`, `after = min(A, cap − 1 − before)`. A camera with no sunset frame keeps the newest-`cap` window.
- Thinning (spec §3.5): keep index `round((P − 1) − j · (P − 1) / (before − 1))` for `j = 0 … before − 1`; `before = 1` keeps only the frame nearest the peak; dropped frames are not stamped shown.
- The fit (spec §3.4): `avail = (T − t0) / beatS − changeBeats`; `avail < 0` → no fit, too soon; `avail ≤ min(P, cap − 1)` → fit with `before = avail`; else grow the ending run by `avail − min(P, cap − 1)` frames from its own camera's series after the last frame it played, or no fit, nothing to add.
- A pin plays the full climb; there is no wait, no hold, no bend.
- Two dials: `rendezvous` (boolean, default off), `rendezvousRank` (0–1, step 0.05, default 0.6). No wait dial.
- Migration `database/migrations/20260915_kiosk_rendezvous.sql` is applied to production by Jesse **before** this PR merges (`node scripts/apply-migration.mjs <file> --apply`; `npm run migrate:status` must be clean). Every write to the new columns is best-effort or guarded so a missing column cannot stall the glass. **Amendment to spec §3.3:** `kiosk_screen_state` also gains `rendezvous BOOLEAN NOT NULL DEFAULT false`, so the state view can say a dwell is a rendezvous without reading the other screen's row.
- The advance refuses to draw while the current dwell has not ended (`nowMs < shownSince + dwellMs − beatMs / 2`): it answers `advanced: false` with the current state. The kiosk never posts early; this guard exists so a racing second tab cannot cut a grown dwell short.
- Work in a sibling worktree stacked on phase 1: from the main checkout, `scripts/wt.sh new feat/solo2-rendezvous feat/solo2-beat`. PR base `feat/solo2-beat` until #216 merges. Stage explicit paths; verify the branch in the same command as every commit; commit messages end with the session's attribution lines.

---

## File map

| file | change |
|---|---|
| `database/migrations/20260915_kiosk_rendezvous.sql` | create |
| `app/lib/solo2/rendezvous.ts` + `.test.ts` | create: `peakOf`, `windowAround`, `thinClimb`, `fitNext`, `Decision` |
| `app/lib/solo2/run.ts` + `.test.ts` | `runOf` windows around the peak, climb first |
| `app/lib/solo2/engine.ts` + `.test.ts` | `dwellMsFor(entries, pick, d, frames)`; `dwellMs2` through it; shown-order tests |
| `app/lib/solo2/types.ts`, `settingsSchema.ts` + `.test.ts` | the two dials |
| `app/lib/solo/versions.ts` + `.test.ts` | optional `fitNext` on the version; solo2 wires it |
| `app/lib/solo/store.ts` + `.test.ts` | `peak_at`/`rendezvous` read and written; `growDwell` |
| `app/api/kiosk/solo/view.ts`, `advance/route.ts` + `.test.ts`, `state/route.ts` | the decision, the guard, the keep-going answer, `current.peakAtMs`/`rendezvous`/`decision` |
| `app/components/solo/useSoloGlass.ts` + `.test.ts`, `components/solo2/index.tsx` | a grown answer re-arms on the new end without the 60 s back-off |
| `app/lib/solo/replay.ts` + `.test.ts`, `scripts/solo-replay.ts` | `replayPair` over both feeds; `--feed both`; the counts |

---

### Task 1: The migration

**Files:**
- Create: `database/migrations/20260915_kiosk_rendezvous.sql`

**Interfaces:**
- Produces columns: `kiosk_screen_state.peak_at TIMESTAMPTZ NULL`, `kiosk_screen_state.rendezvous BOOLEAN NOT NULL DEFAULT false`, `kiosk_draws.peak_at TIMESTAMPTZ NULL`, `kiosk_draws.rendezvous BOOLEAN NOT NULL DEFAULT false`.

- [ ] **Step 1: Write the file**

```sql
-- solo2 rendezvous: one number between the screens, and the record of it.
-- (beat-and-rendezvous spec docs/superpowers/specs/2026-09-14-solo2-beat-and-rendezvous-design.md §3.3, §6)
--
-- peak_at on kiosk_screen_state is the tick the current dwell's peak lands on,
-- when that draw cleared the rendezvous gate; null otherwise. The advance that
-- starts a dwell writes it, decided once against the pool the draw saw. The
-- other screen reads it on its own advance and fits to it. The screens never
-- talk; this column is the whole conversation.
--
-- rendezvous on kiosk_screen_state says the current dwell's peak was fitted to
-- (or pinned and met by) the other screen's, so the state view can say so
-- without reading the other row (an amendment to spec §3.3).
--
-- The same two on kiosk_draws, so the replay can count what happened.
--
-- Forward-only, idempotent. APPLY BEFORE MERGING the code that writes them:
-- commitAdvance writes these in the same statement as dwell_ms, and a missing
-- column would fail the advance and stall the glass.
--   node scripts/apply-migration.mjs database/migrations/20260915_kiosk_rendezvous.sql
--   node scripts/apply-migration.mjs database/migrations/20260915_kiosk_rendezvous.sql --apply

ALTER TABLE kiosk_screen_state ADD COLUMN IF NOT EXISTS peak_at    TIMESTAMPTZ;
ALTER TABLE kiosk_screen_state ADD COLUMN IF NOT EXISTS rendezvous BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE kiosk_draws        ADD COLUMN IF NOT EXISTS peak_at    TIMESTAMPTZ;
ALTER TABLE kiosk_draws        ADD COLUMN IF NOT EXISTS rendezvous BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Dry-run the ledger check**

Run: `node scripts/apply-migration.mjs database/migrations/20260915_kiosk_rendezvous.sql`
Expected: prints the statements it would apply and exits without applying (dry by default). Do NOT pass `--apply`; that is Jesse's step.

- [ ] **Step 3: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-rendezvous && git add database/migrations/20260915_kiosk_rendezvous.sql && git commit -m "db(solo2): peak_at and rendezvous on the screen state and the draw log"
```

---

### Task 2: The pure decision (`rendezvous.ts`)

**Files:**
- Create: `app/lib/solo2/rendezvous.ts`
- Create: `app/lib/solo2/rendezvous.test.ts`

**Interfaces:**
- Consumes: `RunEntry`, `cameraGroups`, `compareCapture`, `capFor`, `qualityRank` from `./run`; `Role` and `Solo2Dials` from `./types` (dials gain `rendezvous`/`rendezvousRank` in Task 5; until then the tests pass them explicitly).
- Produces:
  ```ts
  export function peakOf<T extends RunEntry>(series: T[]): T | null
  export function thinClimb<T>(climb: T[], before: number): { kept: T[]; dropped: T[] }
  export function windowAround<T extends RunEntry>(series: T[], peak: T, cap: number, before?: number): { frames: T[]; dropped: T[] }
  export interface MySide<T> { t0Ms: number; pick: T; entries: T[]; role: Role; ending: { webcamId: number; lastShownId: number } | null }
  export interface TheirSide { peakAtMs: number | null }
  export type Decision<T> =
    | { kind: 'plain'; frames: T[]; dropped: T[]; peakAtMs: null }
    | { kind: 'pin'; frames: T[]; dropped: T[]; peakAtMs: number }
    | { kind: 'fit'; frames: T[]; dropped: T[]; peakAtMs: number }
    | { kind: 'grow'; add: T[] }
    | { kind: 'nofit'; why: 'too soon' | 'nothing to add'; frames: T[]; dropped: T[]; peakAtMs: null };
  export function fitNext<T extends RunEntry>(mine: MySide<T>, theirs: TheirSide, d: RendezvousDials): Decision<T>
  export type RendezvousDials = Pick<Solo2Dials, 'beatS' | 'changeBeats' | 'transition' | 'cameraRun' | 'rendezvous' | 'rendezvousRank' | 'runFramesSunset' | 'runFramesOther' | 'runShape'>
  ```

- [ ] **Step 1: Write the failing tests** — `app/lib/solo2/rendezvous.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fitNext, peakOf, thinClimb, windowAround, type MySide } from './rendezvous';
import type { RunEntry } from './run';

const f = (id: number, cam: number, at: number, q: number | null, bin: 'sunset' | 'non_sunset' = q == null ? 'non_sunset' : 'sunset'): RunEntry => ({
  snapshotId: id, webcamId: cam, bin, quality: q, detection: 0.8, isNew: false, tally: 0, enteredAt: id, lastShownAt: null, capturedAt: at,
});
/** A night of camera 7: five grey frames, a climb of four, the peak at id 10, three after. */
const night = [
  f(1, 7, 100, null), f(2, 7, 200, null), f(3, 7, 300, null), f(4, 7, 400, null), f(5, 7, 500, null),
  f(6, 7, 600, 0.4), f(7, 7, 700, 0.5), f(8, 7, 800, 0.6), f(9, 7, 900, 0.8),
  f(10, 7, 1000, 0.95),
  f(11, 7, 1100, 0.7), f(12, 7, 1200, 0.5), f(13, 7, 1300, null),
];
const ids = (xs: RunEntry[]) => xs.map((x) => x.snapshotId);
const D = { beatS: 4, changeBeats: 1, transition: 'dip' as const, cameraRun: true, rendezvous: true, rendezvousRank: 0.6, runFramesSunset: 8, runFramesOther: 3, runShape: 'flat' as const };
const T0 = Date.UTC(2026, 8, 15, 2, 0, 0);
const beat = (n: number) => n * 4_000;

describe('peakOf', () => {
  it('is the best-rated sunset frame; null when the series has none', () => {
    expect(peakOf(night)!.snapshotId).toBe(10);
    expect(peakOf(night.filter((x) => x.bin !== 'sunset'))).toBeNull();
  });
});

describe('thinClimb', () => {
  const climb = night.slice(0, 9); // ids 1..9
  it('keeps everything when before ≥ P', () => {
    expect(ids(thinClimb(climb, 9).kept)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(thinClimb(climb, 12).dropped).toEqual([]);
  });
  it('keeps the frame nearest the peak and spreads the rest evenly', () => {
    expect(ids(thinClimb(climb, 3).kept)).toEqual([1, 5, 9]);
    expect(ids(thinClimb(climb, 1).kept)).toEqual([9]);
    expect(ids(thinClimb(climb, 0).kept)).toEqual([]);
    expect(ids(thinClimb(climb, 4).kept)).toEqual([1, 4, 6, 9]); // round(8 − j·8/3): 8, 5.33→5, 2.67→3, 0
    expect(ids(thinClimb(climb, 3).dropped)).toEqual([2, 3, 4, 6, 7, 8]);
  });
});

describe('windowAround', () => {
  const peak = night[9];
  it('by default the climb comes first and the cap\'s remainder plays after the peak', () => {
    const w = windowAround(night, peak, 8);
    expect(ids(w.frames)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]); // before = min(9, 7) = 7 (newest 7 of the climb), after = 0
    expect(w.dropped).toEqual([]);
    const wide = windowAround(night, peak, 16);
    expect(ids(wide.frames)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]); // the whole night
  });
  it('with an explicit before, thins the climb and hands the rest to after', () => {
    const w = windowAround(night, peak, 8, 3);
    expect(ids(w.frames)).toEqual([1, 5, 9, 10, 11, 12, 13]); // 3 climb + peak + min(3, 8 − 1 − 3 = 4) after
    expect(ids(w.dropped)).toEqual([2, 3, 4, 6, 7, 8]);
    expect(ids(windowAround(night, peak, 8, 0).frames)).toEqual([10, 11, 12, 13]);
  });
  it('the peak always plays; before is clamped to the climb and the cap', () => {
    expect(ids(windowAround(night, peak, 1).frames)).toEqual([10]);
    expect(ids(windowAround(night, peak, 4, 99).frames)).toEqual([7, 8, 9, 10]);
  });
});

describe('fitNext', () => {
  const pool = [...night, f(20, 8, 1000, 0.3), f(21, 8, 1100, 0.35)]; // camera 8 is the weaker sunset
  const mine = (over: Partial<MySide<RunEntry>> = {}): MySide<RunEntry> =>
    ({ t0Ms: T0, pick: night[12], entries: pool, role: 'peak', ending: null, ...over });

  it('not eligible → plain, with the default window and no peak pinned', () => {
    for (const m of [
      mine({ role: 'valley' }),
      mine({ pick: pool[13], entries: pool }),                    // camera 8 ranks 0 < 0.6
      mine({ pick: f(30, 9, 500, null), entries: [...pool, f(30, 9, 500, null)] }), // no peak
    ]) {
      const dec = fitNext(m, { peakAtMs: null }, D);
      expect(dec.kind).toBe('plain');
      expect(dec.peakAtMs).toBeNull();
    }
    expect(fitNext(mine(), { peakAtMs: null }, { ...D, rendezvous: false }).kind).toBe('plain');
  });

  it('eligible with nothing to meet → pin at the full climb', () => {
    const dec = fitNext(mine(), { peakAtMs: null }, D);
    expect(dec.kind).toBe('pin');
    if (dec.kind !== 'pin') return;
    expect(ids(dec.frames)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(dec.peakAtMs).toBe(T0 + beat(1 + 7)); // change + 7 climb frames
  });

  it('eligible with a reachable partner peak → fit: the climb thinned so the peak lands on that tick', () => {
    const T = T0 + beat(1 + 3);
    const dec = fitNext(mine(), { peakAtMs: T }, D);
    expect(dec.kind).toBe('fit');
    if (dec.kind !== 'fit') return;
    expect(ids(dec.frames)).toEqual([1, 5, 9, 10, 11, 12, 13]);
    expect(ids(dec.dropped)).toEqual([2, 3, 4, 6, 7, 8]);
    expect(dec.peakAtMs).toBe(T);
    // avail 0: the peak is the first frame after the change
    const first = fitNext(mine(), { peakAtMs: T0 + beat(1) }, D);
    expect(first.kind).toBe('fit');
    if (first.kind === 'fit') expect(ids(first.frames)).toEqual([10, 11, 12, 13]);
  });

  it('a partner peak already passed, or inside the change beat → no fit, too soon', () => {
    for (const T of [T0 - beat(1), T0, T0 + 2_000]) {
      const dec = fitNext(mine(), { peakAtMs: T }, D);
      expect(dec.kind).toBe('nofit');
      if (dec.kind === 'nofit') { expect(dec.why).toBe('too soon'); expect(ids(dec.frames)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]); }
    }
  });

  it('a partner peak beyond the climb → grow the ending run by the difference, from its own series', () => {
    const T = T0 + beat(1 + 9); // needs 9 before the peak; the cap allows 7
    const ending = [f(40, 9, 100, null), f(41, 9, 200, null), f(42, 9, 300, 0.5), f(43, 9, 400, null), f(44, 9, 500, null), f(45, 9, 600, null)];
    const dec = fitNext(mine({ entries: [...pool, ...ending], ending: { webcamId: 9, lastShownId: 42 } }), { peakAtMs: T }, D);
    expect(dec.kind).toBe('grow');
    if (dec.kind === 'grow') expect(ids(dec.add)).toEqual([43, 44]);
  });

  it('… or no fit, nothing to add, when the ending camera has no more frames', () => {
    const T = T0 + beat(1 + 9);
    const ending = [f(40, 9, 100, null), f(41, 9, 200, 0.5)];
    const dec = fitNext(mine({ entries: [...pool, ...ending], ending: { webcamId: 9, lastShownId: 41 } }), { peakAtMs: T }, D);
    expect(dec.kind).toBe('nofit');
    if (dec.kind === 'nofit') expect(dec.why).toBe('nothing to add');
    expect(fitNext(mine({ ending: null }), { peakAtMs: T }, D).kind).toBe('nofit');
  });

  it('the cap applies to a fit: after takes what is left', () => {
    const dec = fitNext(mine(), { peakAtMs: T0 + beat(1 + 6) }, { ...D, runFramesSunset: 8 });
    if (dec.kind !== 'fit') throw new Error(dec.kind);
    expect(dec.frames).toHaveLength(8); // 6 + peak + 1
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/lib/solo2/rendezvous.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `app/lib/solo2/rendezvous.ts`:

```ts
import { cameraGroups, capFor, compareCapture, qualityRank, runOf, type RunEntry } from './run';
import type { Role, Solo2Dials } from './types';

/**
 * The rendezvous (beat-and-rendezvous spec §3): both screens land on their
 * best frame on the same tick. Pure: no clock, no I/O. The server calls
 * `fitNext` once per advance with its own side and the other screen's
 * pinned peak; the replay calls it the same way over recorded pools. The
 * count of frames is the only knob — a peak moves one beat for every frame
 * dropped ahead of it or added ahead of it; nothing holds, nothing changes
 * rate (§3.5).
 */

export type RendezvousDials = Pick<Solo2Dials,
  'beatS' | 'changeBeats' | 'transition' | 'cameraRun' | 'rendezvous' | 'rendezvousRank' | 'runFramesSunset' | 'runFramesOther' | 'runShape'>;

const q = (e: RunEntry) => (e.bin === 'sunset' && e.quality != null ? e.quality : -1);

/** The best-rated sunset frame of a series, or null when it has none. Ties go to the earlier frame. */
export function peakOf<T extends RunEntry>(series: T[]): T | null {
  let best: T | null = null;
  for (const e of series) if (q(e) >= 0 && (best === null || q(e) > q(best))) best = e;
  return best;
}

/**
 * `before` frames of the climb, keeping the one nearest the peak and
 * spreading the rest evenly (§3.5): keep index
 * round((P − 1) − j · (P − 1) / (before − 1)), j = 0 … before − 1.
 */
export function thinClimb<T>(climb: T[], before: number): { kept: T[]; dropped: T[] } {
  const P = climb.length;
  const n = Math.max(0, Math.min(P, Math.floor(before)));
  if (n >= P) return { kept: climb.slice(), dropped: [] };
  const keep = new Set<number>();
  if (n === 1) keep.add(P - 1);
  else for (let j = 0; j < n; j++) keep.add(Math.round((P - 1) - (j * (P - 1)) / (n - 1)));
  return { kept: climb.filter((_, i) => keep.has(i)), dropped: climb.filter((_, i) => !keep.has(i)) };
}

/**
 * The window around the peak (§3.6): `before` frames ahead of it, the peak,
 * then what the cap leaves after it. Without `before` the climb comes first:
 * the newest `cap − 1` of it, and the remainder goes after the peak. The
 * peak always plays.
 */
export function windowAround<T extends RunEntry>(series: T[], peak: T, cap: number, before?: number): { frames: T[]; dropped: T[] } {
  const sorted = series.slice().sort(compareCapture);
  const p = sorted.findIndex((e) => e.snapshotId === peak.snapshotId);
  const climb = sorted.slice(0, Math.max(0, p));
  const after = sorted.slice(p + 1);
  const room = Math.max(1, Math.floor(cap)) - 1;
  const b = Math.max(0, Math.min(climb.length, room, before ?? room));
  // The default takes the NEWEST b of the climb (nothing dropped from inside
  // it); an explicit before thins the whole climb evenly.
  const climbPart = before === undefined
    ? { kept: climb.slice(climb.length - b), dropped: [] as T[] }
    : thinClimb(climb, b);
  const a = Math.max(0, Math.min(after.length, room - climbPart.kept.length));
  return { frames: [...climbPart.kept, sorted[p], ...after.slice(0, a)], dropped: climbPart.dropped };
}

export interface MySide<T extends RunEntry> {
  /** The tick this draw would start on: the previous dwell's end. */
  t0Ms: number;
  /** The engine's pick (the camera's newest frame). */
  pick: T;
  /** This screen's whole pool. */
  entries: T[];
  /** The rhythm role of this draw; a valley is never eligible. */
  role: Role;
  /** The dwell that is ending on this screen, if any: its camera and the last frame it played. */
  ending: { webcamId: number; lastShownId: number } | null;
}

export interface TheirSide {
  /** The other screen's pinned landing, ms, or null. */
  peakAtMs: number | null;
}

export type Decision<T> =
  | { kind: 'plain'; frames: T[]; dropped: T[]; peakAtMs: null }
  | { kind: 'pin'; frames: T[]; dropped: T[]; peakAtMs: number }
  | { kind: 'fit'; frames: T[]; dropped: T[]; peakAtMs: number }
  /** Do not draw yet: extend the ending dwell by these frames of its own camera, in order. */
  | { kind: 'grow'; add: T[] }
  | { kind: 'nofit'; why: 'too soon' | 'nothing to add'; frames: T[]; dropped: T[]; peakAtMs: null };

const changeBeats = (d: RendezvousDials) => (d.transition === 'cut' ? 0 : Math.max(0, Math.floor(d.changeBeats)));

/**
 * The greedy fit (§3.4), one seam for the search version to replace later
 * (§3.9): whoever draws first pins, the other fits.
 */
export function fitNext<T extends RunEntry>(mine: MySide<T>, theirs: TheirSide, d: RendezvousDials): Decision<T> {
  const series = cameraGroups(mine.entries).get(mine.pick.webcamId) ?? [mine.pick];
  const cap = capFor(mine.pick, d, mine.entries, d.cameraRun);
  const peak = peakOf(series);
  const plain = (): Decision<T> => ({ kind: 'plain', frames: runOf(mine.pick, mine.entries, d.cameraRun, cap), dropped: [], peakAtMs: null });
  const eligible = d.rendezvous && mine.role === 'peak' && peak !== null && d.cameraRun
    && qualityRank(mine.pick, mine.entries, d.cameraRun) >= d.rendezvousRank;
  if (!eligible || peak === null) return plain();

  const beatMs = d.beatS * 1000;
  const change = changeBeats(d);
  const climbMax = Math.min(series.slice().sort(compareCapture).findIndex((e) => e.snapshotId === peak.snapshotId), Math.max(1, cap) - 1);
  const landing = (before: number) => mine.t0Ms + (change + before) * beatMs;

  const T = theirs.peakAtMs;
  if (T == null) {
    const w = windowAround(series, peak, cap);
    return { kind: 'pin', frames: w.frames, dropped: w.dropped, peakAtMs: landing(w.frames.findIndex((e) => e.snapshotId === peak.snapshotId)) };
  }
  const avail = Math.round((T - mine.t0Ms) / beatMs) - change;
  if (avail < 0 || (T - mine.t0Ms) % beatMs !== 0) {
    const w = windowAround(series, peak, cap);
    return { kind: 'nofit', why: 'too soon', frames: w.frames, dropped: w.dropped, peakAtMs: null };
  }
  if (avail <= climbMax) {
    const w = windowAround(series, peak, cap, avail);
    return { kind: 'fit', frames: w.frames, dropped: w.dropped, peakAtMs: T };
  }
  // The climb is too short: grow the run that is ending, from its own night.
  const need = avail - climbMax;
  if (mine.ending) {
    const theirSeries = (cameraGroups(mine.entries).get(mine.ending.webcamId) ?? []).slice().sort(compareCapture);
    const last = theirSeries.findIndex((e) => e.snapshotId === mine.ending!.lastShownId);
    const add = last >= 0 ? theirSeries.slice(last + 1, last + 1 + need) : [];
    if (add.length === need) return { kind: 'grow', add };
  }
  const w = windowAround(series, peak, cap);
  return { kind: 'nofit', why: 'nothing to add', frames: w.frames, dropped: w.dropped, peakAtMs: null };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/lib/solo2/rendezvous.test.ts`
Expected: PASS. (Until Task 5 adds the dials to `Solo2Dials`, the `Pick<Solo2Dials, 'rendezvous' | 'rendezvousRank'>` will not type-check; define `RendezvousDials` for now as `Pick<Solo2Dials, 'beatS' | 'changeBeats' | 'transition' | 'cameraRun' | 'runFramesSunset' | 'runFramesOther' | 'runShape'> & { rendezvous: boolean; rendezvousRank: number }` and switch to the plain `Pick` in Task 5.)

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-rendezvous && git add app/lib/solo2/rendezvous.ts app/lib/solo2/rendezvous.test.ts && git commit -m "feat(solo2): the rendezvous decision — peak, window around it, thin the climb, fit or pin or grow"
```

---

### Task 3: The run window moves to the peak (`run.ts`)

**Files:**
- Modify: `app/lib/solo2/run.ts` (`runOf`)
- Modify: `app/lib/solo2/run.test.ts`, `app/lib/solo2/engine.test.ts`

**Interfaces:**
- `runOf(entry, entries, cameraRun, cap)` unchanged signature. New behaviour: when the camera's series has a peak, the run is `windowAround(series, peak, cap).frames` (climb first); otherwise the newest `cap` frames as today. `rendezvous.ts` imports `runOf` for `plain`, and `run.ts` must not import `rendezvous.ts` (cycle): move `peakOf` and `windowAround` INTO `run.ts` and re-export them from `rendezvous.ts` (`export { peakOf, windowAround, thinClimb } from './run';`).

- [ ] **Step 1: Write the failing tests** — in `run.test.ts`, inside `describe('poolEntries / runOf')`, add:

```ts
  it('a camera with a peak windows around it, climb first, and the peak always plays', () => {
    const night = [f(1, 7, 100, { bin: 'non_sunset', quality: null }), f(2, 7, 200, { quality: 0.4 }), f(3, 7, 300, { quality: 0.9 }), f(4, 7, 400, { quality: 0.5 }), f(5, 7, 500, { bin: 'non_sunset', quality: null })];
    expect(runOf(night[4], night, true, 3).map((e) => e.snapshotId)).toEqual([1, 2, 3]);  // newest 2 of the climb, the peak; nothing left for after
    expect(runOf(night[4], night, true, 4).map((e) => e.snapshotId)).toEqual([1, 2, 3, 4]);
    expect(runOf(night[4], night, true, 1).map((e) => e.snapshotId)).toEqual([3]);
    expect(runOf(night[4], night, true).map((e) => e.snapshotId)).toEqual([1, 2, 3, 4, 5]);
  });
  it('a camera with no sunset frame keeps the newest-cap window', () => {
    const grey = [f(1, 7, 100, { bin: 'non_sunset', quality: null }), f(2, 7, 200, { bin: 'non_sunset', quality: null }), f(3, 7, 300, { bin: 'non_sunset', quality: null })];
    expect(runOf(grey[2], grey, true, 2).map((e) => e.snapshotId)).toEqual([2, 3]);
  });
```

Then run `npx vitest run app/lib/solo2/run.test.ts app/lib/solo2/engine.test.ts` and note which existing assertions about run ORDER now fail: any fixture whose series has a sunset peak that is not its newest frame. Update each such expectation to the climb-first window and say so in the report; do not delete tests.

- [ ] **Step 2: Implement** — in `run.ts`, add `peakOf`, `thinClimb`, `windowAround` (moved verbatim from Task 2's file, with `q` and `compareCapture`), then rewrite `runOf`:

```ts
/**
 * What a dwell of `entry` plays (camera-run spec §3.2, amended by the
 * rendezvous spec §3.6): the camera's frames around its PEAK, climb first,
 * capped; the newest `cap` frames when the camera has no sunset frame.
 * `[entry]` when the dial is off. Oldest to newest, always.
 */
export function runOf<T extends RunEntry>(
  entry: T, entries: T[], cameraRun: boolean, cap = Number.POSITIVE_INFINITY,
): T[] {
  if (!cameraRun) return [entry];
  const series = entries.filter((e) => e.webcamId === entry.webcamId).sort(compareCapture);
  const peak = peakOf(series);
  if (peak) return windowAround(series, peak, cap).frames;
  const keep = Math.max(1, Math.floor(cap)) - 1; // the chosen frame takes one place
  const earlier = series.filter((e) => e.snapshotId !== entry.snapshotId && compareCapture(e, entry) < 0);
  return [...earlier.slice(Math.max(0, earlier.length - keep)), entry];
}
```

In `rendezvous.ts` delete the three moved functions and add `export { peakOf, thinClimb, windowAround } from './run';` plus the import for internal use.

Update `shown2`'s doc in `engine.ts` (it says "the drawn frame last"): "the camera's frames around its peak, climb first; the drawn frame (the newest) plays only when the cap reaches it".

- [ ] **Step 3: Run**

Run: `npx vitest run app/lib/solo2/run.test.ts app/lib/solo2/engine.test.ts app/lib/solo2/rendezvous.test.ts`
Expected: PASS after the order updates from Step 1.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-rendezvous && git add app/lib/solo2/run.ts app/lib/solo2/run.test.ts app/lib/solo2/engine.ts app/lib/solo2/engine.test.ts app/lib/solo2/rendezvous.ts && git commit -m "feat(solo2): a run windows around its peak, climb first"
```

---

### Task 4: The engine prices a given run (`engine.ts`, `versions.ts`)

**Files:**
- Modify: `app/lib/solo2/engine.ts`, `.test.ts`
- Modify: `app/lib/solo/versions.ts`, `.test.ts`

**Interfaces:**
- Produces: `export function dwellMsFor(entries: BinEntry[], pick: BinEntry, d: Solo2Dials, frames: number): number` = `fitPlan(planDialsFor(pick, d, entries, d.cameraRun), frames).dwellS * 1000`; `dwellMs2` becomes `dwellMsFor(entries, pick, d, shown2(...).length)`.
- `SoloVersionSpec` gains optional `fitNext?<T extends RunEntry>(mine: MySide<T>, theirs: TheirSide, d: D): Decision<T>` and `dwellMsFor?(entries, pick, d, frames): number`; solo2 wires both; solo has neither.

- [ ] **Step 1: Tests** — `engine.test.ts`: `expect(dwellMsFor(one, one[0], D2, 5)).toBe(6 * BEAT)` and `expect(dwellMs2(twelve, twelve[11], D2)).toBe(dwellMsFor(twelve, twelve[11], D2, shown2(twelve, twelve[11], D2).length))`. `versions.test.ts`: `expect(SOLO_VERSIONS.solo.fitNext).toBeUndefined(); expect(typeof SOLO_VERSIONS.solo2.fitNext).toBe('function');` and that `solo2.dwellMsFor(entries, entries[0], d, 1)` equals `solo2.dwellMs(entries, entries[0], d)` for a lone frame.

- [ ] **Step 2: Implement** as the interfaces say; `versions.ts` imports `fitNext` from `@/app/lib/solo2/rendezvous` and `dwellMsFor` from `@/app/lib/solo2/engine`.

- [ ] **Step 3: Run** `npx vitest run app/lib/solo2/engine.test.ts app/lib/solo/versions.test.ts` — PASS.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-rendezvous && git add app/lib/solo2/engine.ts app/lib/solo2/engine.test.ts app/lib/solo/versions.ts app/lib/solo/versions.test.ts && git commit -m "feat(solo2): the version prices a given run and exposes the rendezvous seam"
```

---

### Task 5: The two dials

**Files:**
- Modify: `app/lib/solo2/types.ts`, `app/lib/solo2/settingsSchema.ts`, `app/lib/solo2/settingsSchema.test.ts`, `app/lib/solo2/rendezvous.ts` (the `RendezvousDials` Pick)

- [ ] **Step 1: Test** — in `settingsSchema.test.ts` add: keys contain `rendezvous` and `rendezvousRank`; defaults `false` and `0.6`; `rendezvousRank` is clamped to [0, 1] by `mergeSettings`.

- [ ] **Step 2: Implement** — `Solo2Dials` gains:
```ts
  // rendezvous
  /** Both screens land on their best frame on the same tick, when the sunset is good enough (rendezvous spec §3). */
  rendezvous: boolean;
  /** A draw is eligible when its camera's sunset rank clears this: 1 = only the best sunset present, 0 = every sunset. */
  rendezvousRank: number;
```
Schema, a new section `'rendezvous'` placed after the `bins` entries:
```ts
  {
    key: 'rendezvous', kind: 'boolean', default: false,
    label: 'rendezvous', section: 'rendezvous',
    description: 'Both screens land on their best-rated frame on the same tick. A screen that draws a good sunset pins the tick its peak will land on; the other screen, drawing its own good sunset, fits to it by dropping frames from its climb or by letting the run that is ending play on. Nothing holds and the rate never changes. Off: the screens drift.',
  },
  {
    key: 'rendezvousRank', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.6,
    label: 'rendezvous rank', section: 'rendezvous',
    description: 'How good a sunset must be to get a rendezvous, as its rank among the sunsets present: 1 is only the best on offer, 0 is every sunset. 0.6 is the top forty percent.',
  },
```
`dialsFrom2`: `rendezvous: values.rendezvous as boolean, rendezvousRank: values.rendezvousRank as number`. In `rendezvous.ts` make `RendezvousDials` the plain `Pick<Solo2Dials, …>` including the two keys. Check `app/studio/Rail.tsx`'s `TABS`/sections: if the rail only shows known sections, add `'rendezvous'` to the Play tab's section list (grep `section ===` / `SECTIONS` there and follow the pattern).

- [ ] **Step 3: Run** `npx vitest run app/lib/solo2 app/studio/Rail.test.tsx` — PASS.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-rendezvous && git add app/lib/solo2/types.ts app/lib/solo2/settingsSchema.ts app/lib/solo2/settingsSchema.test.ts app/lib/solo2/rendezvous.ts app/studio/Rail.tsx && git commit -m "feat(solo2): rendezvous and rendezvous rank dials"
```

---

### Task 6: The store reads and writes the landing (`store.ts`)

**Files:**
- Modify: `app/lib/solo/store.ts`, `app/lib/solo/store.test.ts`

**Interfaces:**
- `ScreenRow` gains `peakAtMs?: number | null; rendezvous?: boolean`. `getScreenState` selects `peak_at, rendezvous`.
- `commitAdvance(feed, slot, entry, sunsetStreak, shown, version, dwellMs, startMs, peakAtMs: number | null = null, rendezvous = false)` writes `peak_at`, `rendezvous` in the same upsert; `logDraw(feed, slot, entry, version, shown, shownAtMs, peakAtMs = null, rendezvous = false)` writes them too.
- New:
  ```ts
  /** The keep-going answer (spec §3.8): the current dwell plays `add` more frames and ends later. Same slot. */
  export async function growDwell(feed: Feed, slot: number, add: BinEntry[], dwellMs: number, shownAtMs: number): Promise<boolean>
  ```
  which, in one statement guarded by `where feed = ${feed} and slot = ${slot}`, does `update kiosk_screen_state set shown_snapshot_ids = shown_snapshot_ids || ${addIds}::bigint[], dwell_ms = ${dwellMs}, updated_at = now() returning feed`; if a row returned, stamps the added frames shown in `kiosk_bin_entries` (the same update `commitAdvance` runs, with `last_shown_slot = slot`), and best-effort updates `kiosk_draws set shown_snapshot_ids = shown_snapshot_ids || ${addIds}::bigint[] where feed and slot` inside a try/catch that warns. Returns whether the screen row changed.

- [ ] **Step 1: Tests** — in `store.test.ts` (it mocks `sql`; follow its pattern): `commitAdvance` with `peakAtMs` passes an ISO timestamptz and `true` at the new positions; `getScreenState` maps `peak_at`/`rendezvous`; `growDwell` issues the three statements in order and returns false when the screen update returns no row (and then skips the other two).

- [ ] **Step 2: Implement** as above. In `commitAdvance`'s upsert add `peak_at, rendezvous` to the column list, `${peakAtMs == null ? null : new Date(peakAtMs).toISOString()}::timestamptz, ${rendezvous}` to the values, and `peak_at = excluded.peak_at, rendezvous = excluded.rendezvous` to the `do update set`. Same two in `logDraw`'s insert.

- [ ] **Step 3: Run** `npx vitest run app/lib/solo/store.test.ts app/api/kiosk/solo/advance/route.test.ts` — the route test may need `expect.any(...)`/`null`/`false` for the two new trailing arguments; update its arity assertions the way Task 5 of phase 1 did.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-rendezvous && git add app/lib/solo/store.ts app/lib/solo/store.test.ts app/api/kiosk/solo/advance/route.test.ts && git commit -m "feat(solo2): the store keeps each screen's landing and can grow a dwell"
```

---

### Task 7: The advance decides, guards, and keeps going (`advance/route.ts`, `view.ts`)

**Files:**
- Modify: `app/api/kiosk/solo/advance/route.ts`, `app/api/kiosk/solo/advance/route.test.ts`
- Modify: `app/api/kiosk/solo/view.ts` (`StateView.current` gains `peakAtMs: number | null; rendezvous: boolean`), `app/api/kiosk/solo/state/route.ts` untouched (it passes `screen` through).

**Interfaces:**
- Response gains `grown: boolean` (true only on the keep-going answer) and `decision: 'plain' | 'pin' | 'fit' | 'grow' | 'nofit · too soon' | 'nofit · nothing to add' | null` (null for solo).
- `buildStateView` reads `screen.peakAtMs` / `screen.rendezvous` into `current`.

- [ ] **Step 1: Tests** — in `route.test.ts`, with the existing mocks plus `getScreenState` answering per feed and a new `growDwell` mock, add for `version: 'solo2'` with `rendezvous: true` in the mocked live settings (the mock of `getLiveSettingsCached` must return `{ namespaces: { solo2: { rendezvous: true } } }` for these tests):
  1. **pin**: sunset screen, no current row, other screen's row has `peakAtMs: null`; pool = one camera with a 4-frame climb and a peak → `commitAdvance` called with `peakAtMs = t0 + (1 + 4) × 4000`, `rendezvous false`; body `decision === 'pin'`, `current.peakAtMs` equal.
  2. **fit**: other screen's `peakAtMs = t0 + 3 × 4000` (2 climb frames reachable) → `commitAdvance` shown ids are the thinned window, `peakAtMs = T`, `rendezvous true`; `decision === 'fit'`.
  3. **grow**: current row on this screen ending now (`shownSince = t0 − 16_000`, `dwellMs 16_000`, `shownSnapshotIds` of camera 9 with two more frames in the pool), other's `peakAtMs` two beats beyond this pick's climb → `growDwell` called with those two frames and `dwellMs = 16_000 + 8_000`; `commitAdvance` NOT called; body `advanced false`, `grown true`, `decision 'grow'`, `current.endsAtMs = shownSince + 24_000`, `schedule.slot` unchanged.
  4. **guard**: current row with `shownSince = t0 − 4_000`, `dwellMs = 20_000` (not ending) → no `commitAdvance`, no `growDwell`, `advanced false`, `grown false`.
  5. **too soon**: other's `peakAtMs = t0` → `commitAdvance` with `peakAtMs null`, `decision 'nofit · too soon'`.
  6. **off**: `rendezvous` absent → `decision 'plain'`, `peakAtMs null`, and the whole existing behaviour.

- [ ] **Step 2: Implement** — in the route, after computing `serverSlot` and before `if (screenBefore?.slot !== slot)`:

```ts
  const beatMs = 'beatS' in dials ? (dials as Solo2Dials).beatS * 1000 : 0;
  // A dwell that has not ended is not drawn over (rendezvous spec, global
  // constraint): the kiosk fires at the end, so only a racing second tab or a
  // stale tab arrives early, and drawing then would cut a grown dwell short.
  const ending = screenBefore?.shownSince != null && screenBefore.dwellMs != null
    ? screenBefore.shownSince + screenBefore.dwellMs
    : null;
  const notYet = ending != null && nowMs < ending - beatMs / 2;
  let grown = false;
  let decision: string | null = null;
  if (notYet) {
    // fall through to the state view with advanced=false
  } else if (screenBefore?.slot !== slot) {
    const state = { lastSnapshotId: …, sunsetStreak: … }; // as today
    const pick = version.next(entries, dials, state, slot, feed);
    if (pick) {
      const startMs = version.startMs(nowMs, dials);
      let shown = version.shown(entries, pick, dials);
      let peakAtMs: number | null = null;
      let rendezvous = false;
      if (version.fitNext && version.dwellMsFor) {
        const other = await getScreenState(feed === 'sunrise' ? 'sunset' : 'sunrise');
        const otherPeak = other?.peakAtMs != null && other.peakAtMs > nowMs ? other.peakAtMs : null;
        const currentEntry = screenBefore?.currentSnapshotId != null ? entries.find((e) => e.snapshotId === screenBefore.currentSnapshotId) : undefined;
        const lastShownId = screenBefore?.shownSnapshotIds?.at(-1) ?? screenBefore?.currentSnapshotId ?? null;
        const dec = version.fitNext(
          { t0Ms: startMs, pick, entries, role: version.roleAt(slot, feed, dials), ending: currentEntry && lastShownId != null ? { webcamId: currentEntry.webcamId, lastShownId } : null },
          { peakAtMs: otherPeak }, dials,
        );
        if (dec.kind === 'grow' && screenBefore?.slot != null && screenBefore.shownSince != null && screenBefore.dwellMs != null) {
          const newDwellMs = screenBefore.dwellMs + dec.add.length * beatMs;
          grown = await growDwell(feed, screenBefore.slot, dec.add, newDwellMs, nowMs);
          decision = 'grow';
          if (grown) {
            for (const f of dec.add) { const s = entries.find((e) => e.snapshotId === f.snapshotId)!; s.tally += 1; s.isNew = false; s.lastShownAt = nowMs; }
            screen = { ...screenBefore, dwellMs: newDwellMs, shownSnapshotIds: [...(screenBefore.shownSnapshotIds ?? []), ...dec.add.map((e) => e.snapshotId)] };
          }
        } else if (dec.kind !== 'grow') {
          shown = dec.frames;
          peakAtMs = dec.peakAtMs;
          rendezvous = dec.kind === 'fit';
          decision = dec.kind === 'nofit' ? `nofit · ${dec.why}` : dec.kind;
        }
      }
      if (!grown && decision !== 'grow') {
        const dwellMs = version.dwellMsFor ? version.dwellMsFor(entries, pick, dials, shown.length) : version.dwellMs(entries, pick, dials);
        advanced = await commitAdvance(feed, slot, pick, after.sunsetStreak, shown, version.name, dwellMs, startMs, peakAtMs, rendezvous);
        // … the existing post-commit block, with peakAtMs/rendezvous on the screen object
      }
    }
  }
```

Return `{ advanced, grown, decision, ...buildStateView(...) }`. A `grow` that `growDwell` refused (row changed under us) falls through as `advanced: false, grown: false` and the kiosk retries at the new state's end.

In `view.ts`, `current` gains `peakAtMs: screen?.peakAtMs ?? null, rendezvous: screen?.rendezvous ?? false`.

- [ ] **Step 3: Run** `npx vitest run app/api/kiosk/solo` — PASS.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-rendezvous && git add app/api/kiosk/solo/advance/route.ts app/api/kiosk/solo/advance/route.test.ts app/api/kiosk/solo/view.ts && git commit -m "feat(solo2): the advance pins, fits, or keeps going, and never draws over a dwell that has not ended"
```

---

### Task 8: The kiosk plays a grown dwell on (`useSoloGlass.ts`, `index.tsx`)

**Files:**
- Modify: `app/components/solo/useSoloGlass.ts`, `app/components/solo/useSoloGlass.test.ts` (create if absent, in the style of `app/components/solo2/index.test.tsx`'s timer tests)
- Modify: `app/components/solo2/index.tsx` (comment only, if the behaviour already holds)

**Interfaces:**
- On an advance response with `grown: true`, the hook must NOT set the 60 s back-off (`notBeforeMs`), because the published end moved and the timer re-arms on it. Today: `if (v.schedule.slot === screenSlot) notBeforeMs.current = Date.now() + STATE_REFRESH_MS;` → `if (v.schedule.slot === screenSlot && !v.grown) …`. Type the response as `StateView & { advanced: boolean; grown?: boolean }`.
- `index.tsx`: the dwell key is `shownSince`, unchanged by a grow, so the stack does not remount; `pinnedIds` grows; the plan re-fits from the new span (`endsAtMs − shownSince`) with the new frame count, so `stageAt` continues at the added frame on the tick. Add a test in `index.test.tsx`: a state with 3 pinned frames and `endsAtMs = since + 16_000` re-rendered with 5 pinned frames and `endsAtMs = since + 24_000` keeps the same `stack` key (no remount: the `stack` element identity persists) and at `since + 17_000` shows frame index 3.

- [ ] **Step 1: Tests**, **Step 2: Implement**, **Step 3: Run** `npx vitest run app/components/solo app/components/solo2` — PASS.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-rendezvous && git add app/components/solo/useSoloGlass.ts app/components/solo/useSoloGlass.test.ts app/components/solo2/index.tsx app/components/solo2/index.test.tsx && git commit -m "feat(solo2): the glass plays a grown dwell on, without a remount or a back-off"
```

---

### Task 9: Replay both screens together (`replay.ts`, `solo-replay.ts`)

**Files:**
- Modify: `app/lib/solo/replay.ts`, `app/lib/solo/replay.test.ts`
- Modify: `scripts/solo-replay.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PairOptions<D extends SoloDials> { sunrise: ReplayOptions<D>; sunset: ReplayOptions<D>; }
  export interface PairResult { sunrise: Strip; sunset: Strip; rendezvous: { made: number; missed: number; dropped: number; grown: number; landings: { atMs: number; sunriseSlot: number; sunsetSlot: number }[] } }
  export function replayPair<D extends SoloDials>(o: PairOptions<D>): PairResult
  ```
  `replayPair` walks two clocks: whichever screen's `atMs` is earlier draws next (ties: sunrise first). For each draw it builds `MySide` (t0 = that screen's `atMs`, snapped with `version.startMs`; `ending` from the screen's last strip frame), `TheirSide` from the other screen's pinned peak (kept per screen; cleared when that screen draws again), and calls `version.fitNext` when present, else the plain path. A `grow` extends the previous strip frame's `shownSnapshotIds` and `dwellMs` and moves that screen's clock, counting `grown += add.length`; a `fit` counts `made += 1`, `dropped += dropped.length`; a pin that passes unmet counts `missed += 1` when the pinning screen draws again with its pin unmatched. `StripFrame` gains `peakAtMs: number | null; rendezvous: boolean; dropped: number; grown: number` (all default falsy for `actualStrip`, where `peakAtMs`/`rendezvous` come from the draw record's new columns).
- CLI: `--feed both` runs `replayPair` and prints, after the two strips, `rendezvous: made N · missed M · frames dropped D · grown G` and each landing's time with both slots; `--feed sunrise|sunset` unchanged. `listDrawsBetween` and `DrawRecord` gain `peakAtMs`/`rendezvous` (select the two columns; `null`/`false` when the table predates them).

- [ ] **Step 1: Tests** — in `replay.test.ts`, with a version stub whose `fitNext` is the real one from `rendezvous.ts` (import it) and two small pools: one evening where the sunset screen pins and the sunrise screen fits (`made 1`, the landings entry's `atMs` equal to the sunset frame's `peakAtMs`); one where the sunrise climb is too short and its previous run grows by 2 (`grown 2`, the previous frame's `dwellMs` longer by 8 000 and its ids longer by 2); one with `rendezvous: false` dials → all zeros and strips equal to two single-feed `replay` runs.

- [ ] **Step 2: Implement** as the interfaces say; keep `replay()` for one feed unchanged and share its inner step through a small helper `stepOnce(screen, …)` so the two do not drift.

- [ ] **Step 3: Run** `npx vitest run app/lib/solo/replay.test.ts` — PASS. Then a dry CLI run: `npx vite-node --config vitest.config.ts scripts/solo-replay.ts --feed both --from <an ISO time 1 h ago> --to now --version solo2 --dial rendezvous=true` prints the counts (0 made is fine on a pool with no eligible pairs; the point is that it runs).

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD | grep -qx feat/solo2-rendezvous && git add app/lib/solo/replay.ts app/lib/solo/replay.test.ts app/lib/solo/store.ts scripts/solo-replay.ts && git commit -m "feat(solo2): replay both screens together and count the rendezvous"
```

---

### Task 10: Build, suite, PR

- [ ] **Step 1:** `npx vitest run && npm run lint && npm run build` — all green, no new lint warnings.
- [ ] **Step 2:** `npm run migrate:status` — expected: exit 1 naming `20260915_kiosk_rendezvous.sql` as pending (that is the reminder for Jesse; do not apply).
- [ ] **Step 3:** Push (`GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin feat/solo2-rendezvous`) and open the PR against `feat/solo2-beat` with the title `feat(solo2): the rendezvous — both screens land on their best frame on one tick` and a body that says: what (three sentences), the two dials off by default, **the migration to apply before merge**, the guard, the keep-going answer, verification lines, and what phase 2b adds (the one tape with ties and ghosts). End with the attribution lines.
- [ ] **Step 4:** Comment on issue #200 with the PR number and the migration reminder.

---

## Self-review

**Spec coverage:** §3.1 vocabulary → Task 2 doc. §3.2 dials → Task 5. §3.3 columns (+ the amendment) → Tasks 1, 6. §3.4 steps 1–5 → Task 2 (`fitNext`) and Task 7 (the route: pick, decision, pin/fit/grow/nofit, `peak_at` cleared by the screen's own next advance because `commitAdvance` writes `peakAtMs` every time). §3.5 dropping and adding → Task 2 (`thinClimb`, `grow`), Task 6 (`growDwell`), Task 7. §3.6 window → Task 3. §3.8 keep-going → Tasks 6, 7, 8. §3.9 seam → Task 4 (`fitNext` on the version). §5 replay counts → Task 9. §6 migration → Task 1. §4.1/§4.2 → phase 2b (out of scope, stated).

**Placeholders:** Task 4 and Task 8 name their tests in prose with exact expectations rather than full code blocks; Task 7's route code is a block with two `…` where it says "as today" for lines that already exist verbatim in the file. Each is bounded by the exact values given.

**Type consistency:** `Decision` kinds match between Task 2 and Task 7; `growDwell(feed, slot, add, dwellMs, shownAtMs)` matches Tasks 6 and 7; `commitAdvance`'s ninth/tenth arguments match Tasks 6 and 7; `StripFrame`'s new fields are named the same in Task 9's two halves; `RendezvousDials` is the `Pick` after Task 5.
