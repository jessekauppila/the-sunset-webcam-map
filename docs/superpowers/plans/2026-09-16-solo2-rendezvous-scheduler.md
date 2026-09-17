# solo2 rendezvous phase 3: the scheduler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two screens meet several times more often by letting the
fitting screen choose *which camera* it draws from the front of its queue,
instead of accepting whichever one the rotation hands it.

**Architecture:** `fitNext` already receives the whole pool but is handed a
single camera. This plan widens that seam to a short ordered queue, deletes the
rank gate that was suppressing 80% of meetings, and adds a bounded choice among
the queue's head. No new I/O in the hot path, no schema change, no negotiation
between the screens — they still pass exactly one number.

**Tech Stack:** TypeScript, Next.js App Router, vitest, Neon Postgres,
`vite-node` for the replay CLI.

**Spec:** `docs/superpowers/specs/2026-09-16-solo2-rendezvous-scheduler-design.md`

## Global Constraints

- Branch is `feat/solo2-scheduler` in the worktree
  `~/GitHub/the-sunset-webcam-map.worktrees/feat-solo2-scheduler`. **Verify the
  branch in the same command as any commit.** Stage explicit paths, never
  `git add -A`. Push as soon as a commit exists.
- `fitNext` stays **pure**: no clock, no I/O, no mutation of its inputs. The
  server and the replay must be able to call it identically.
- **No migration.** `kiosk_screen_state.peak_at`, `kiosk_screen_state.rendezvous`,
  `kiosk_draws.peak_at` and `kiosk_draws.rendezvous` already exist.
- **No new per-advance database read** unless `rendezvousRest > 0` (default 0).
- Dial defaults, exact: `rendezvousWindow` 1–8 step 1, default **4**;
  `rendezvousGood` 0–1 step 0.05, default **0.75**; `rendezvousRest` 0–8 step 1,
  default **0**. `rendezvousRank` is **removed**, not repurposed.
- Preference order when several cameras can reach a landing: **highest
  `qualityRank`, then fewest frames dropped, then earlier queue position.**
- Valleys are never eligible. The announcing screen never chooses its camera.
- Run `npm run test` before every commit. Run `npm run build` before the final
  push.
- Replay command used for every measurement step, verbatim:

```bash
npx vite-node --config vitest.config.ts scripts/solo-replay.ts \
  --feed both --from 2026-09-16T00:00Z --to 2026-09-16T06:00Z \
  --version solo2 --dial rendezvous=true
```

- Baseline on that window, today's engine at `rendezvousRank` 0.6:
  **made 18 · missed 196 (no partner 185 · too soon 0 · nothing to add 11) ·
  dropped 64 · grown 6 · eligible sunrise 124 / sunset 121.**

---

## File Structure

| File | Responsibility |
|---|---|
| `app/lib/solo2/engine.ts` | gains `queue2` — the rules' order, first `n`. `next2` becomes its head. |
| `app/lib/solo2/rendezvous.ts` | `fitNext` — un-gated, queue-taking, camera-choosing. The only decision site. |
| `app/lib/solo2/types.ts` | `Solo2Dials`: drop `rendezvousRank`, add `rendezvousWindow` / `rendezvousGood` / `rendezvousRest`. |
| `app/lib/solo2/settingsSchema.ts` | the three dials and their bounds. |
| `app/lib/solo/versions.ts` | `SoloVersionSpec.queue`; solo2 wires `queue2`. |
| `app/lib/solo/advance.ts` | builds `MySide.queue`, takes the pick from the decision, applies the rest gate. |
| `app/lib/solo/replay.ts` | same two changes, plus the new counters. |
| `scripts/solo-replay.ts` | prints cadence / magnitude / conversion / tax / variety. |
| `app/studio/solo/queueLane.ts` | **new**, pure: queue-lane geometry and the queue→glass links. |
| `app/studio/solo/QueueLane.tsx` | **new**: renders a lane, every frame clickable. |
| `app/studio/solo/PairTape.tsx` | the meeting box around both landing frames. |

---

### Task 1: Un-gate rank

Deletes the clause that was suppressing most meetings. Behaviour change only —
no new dials, no new types. Reviewable on its own: the replay numbers move and
nothing else does.

**Files:**
- Modify: `app/lib/solo2/rendezvous.ts:56-58`
- Test: `app/lib/solo2/rendezvous.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing new. `fitNext`'s signature is unchanged this task.

- [ ] **Step 1: Write the failing test**

In `app/lib/solo2/rendezvous.test.ts`, inside `describe('fitNext')`, replace the
`mine({ pick: pool[13], entries: pool })` line inside the "not eligible" loop
(it asserts camera 8 is excluded by rank) and add this test after it:

```ts
  it('a weak sunset is still eligible: rank gates nothing (scheduler spec §3)', () => {
    // Camera 8 is the weakest sunset present — qualityRank 0 — and used to be
    // excluded by rendezvousRank 0.6. Participation no longer looks at rank.
    const dec = fitNext(mine({ pick: pool[13] }), { peakAtMs: null }, D);
    expect(dec.kind).toBe('pin');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/solo2/rendezvous.test.ts -t 'rank gates nothing'`
Expected: FAIL — `expected 'plain' to be 'pin'`.

- [ ] **Step 3: Remove the gate**

In `app/lib/solo2/rendezvous.ts`, the `eligible` expression becomes:

```ts
  const eligible = d.rendezvous && mine.role === 'peak' && peak !== null && d.cameraRun;
```

Drop `qualityRank` from the import on line 1 — it is unused here now.

- [ ] **Step 4: Fix the "not eligible" loop**

Remove the `mine({ pick: pool[13], entries: pool })` entry from the array in the
`'not eligible → plain'` test; camera 8 is eligible now. The valley case, the
no-peak case and the dial-off case all stay.

- [ ] **Step 5: Run the suite**

Run: `npm run test`
Expected: PASS. If `app/api/kiosk/solo/advance/route.test.ts:220` fails, its
comment claims a rank of 1 "clears rendezvousRank 0.6" — update the comment to
say the camera has a peak; do not change its assertions.

- [ ] **Step 6: Measure**

Run the global replay command. Expected, on the six-hour window:
**made ≈ 133 · no partner ≈ 271 · too soon 0 · dropped ≈ 661 · grown ≈ 34.**
Record the actual numbers in the commit message.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD && \
git add app/lib/solo2/rendezvous.ts app/lib/solo2/rendezvous.test.ts && \
git commit -m "feat(rendezvous): rank no longer gates participation (#228)"
```

---

### Task 2: The queue, as a function

`fitNext` needs the rules' order, not one pick. This task exposes it and leaves
behaviour identical.

**Files:**
- Modify: `app/lib/solo2/engine.ts:41-51`
- Modify: `app/lib/solo/versions.ts:24` (interface), `:83` (solo2 wiring)
- Test: `app/lib/solo2/engine.test.ts`

**Interfaces:**
- Produces:
  - `queue2<T extends RunEntry>(entries: T[], d: Solo2Dials, state: ScreenState, slot: number, feed: Feed, n: number): T[]`
    — up to `n` entries in the rules' order, mapped back to the caller's entries.
    `queue2(..., 1)[0]` is exactly what `next2` returns.
  - `SoloVersionSpec.queue?(entries, d, state, slot, feed, n): BinEntry[]`

- [ ] **Step 1: Write the failing test**

Add to `app/lib/solo2/engine.test.ts`:

```ts
import { queue2, next2 } from './engine';

describe('queue2 (scheduler spec §3)', () => {
  it('its head is what next2 draws, and it is ordered by the same rules', () => {
    const q = queue2(pool, D2, state, 0, 'sunset', 4);
    expect(q[0].snapshotId).toBe(next2(pool, D2, state, 0, 'sunset')!.snapshotId);
    expect(q.length).toBeLessThanOrEqual(4);
    // Every entry came back from the caller's array, not a copy.
    for (const e of q) expect(pool).toContain(e);
  });

  it('asking for more than the pool holds returns the pool, not padding', () => {
    expect(queue2(pool, D2, state, 0, 'sunset', 99).length).toBeLessThanOrEqual(pool.length);
  });
});
```

Reuse the `pool`, `D2` and `state` fixtures already defined at the top of that
file; if `state` is not defined there, use
`const state = { lastSnapshotId: null, sunsetStreak: 0 };`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/solo2/engine.test.ts -t 'queue2'`
Expected: FAIL — `queue2 is not a function`.

- [ ] **Step 3: Implement**

In `app/lib/solo2/engine.ts`, replace the body of `next2` with:

```ts
/**
 * The first `n` draws for one screen at `slot`, in the rules' order — the
 * queue as the studio draws it. The rendezvous chooses from its head
 * (scheduler spec §3.1); everything else takes `[0]`.
 */
export function queue2<T extends RunEntry>(
  entries: T[], d: Solo2Dials, state: ScreenState, slot: number, feed: Feed, n: number,
): T[] {
  const pool = choosePool(poolEntries(entries, d.cameraRun), d, state, slot);
  if (pool.length === 0 || n <= 0) return [];
  const cmp = roleAt(slot, feed, d) === 'peak' ? comparePeak(d) : compareValley(d);
  const out: T[] = [];
  for (const p of [...pool].sort(cmp).slice(0, n)) {
    const found = entries.find((e) => e.snapshotId === p.snapshotId);
    if (found) out.push(found);
  }
  return out;
}

export function next2<T extends RunEntry>(
  entries: T[], d: Solo2Dials, state: ScreenState, slot: number, feed: Feed,
): T | null {
  return queue2(entries, d, state, slot, feed, 1)[0] ?? null;
}
```

- [ ] **Step 4: Wire it onto the version spec**

In `app/lib/solo/versions.ts`, add to the `SoloVersionSpec` interface after
`next`:

```ts
  /** The first `n` draws at `slot`, in the rules' order. Only versions with a rendezvous need it. */
  queue?<T extends RunEntry>(entries: T[], d: D, state: ScreenState, slot: number, feed: Feed, n: number): T[];
```

and add `queue: queue2,` to the `solo2` object, importing `queue2` alongside
`next2`.

- [ ] **Step 5: Run the suite**

Run: `npm run test`
Expected: PASS, including `app/lib/solo/versions.test.ts` — solo still has no
`queue`, solo2 does. Add that assertion beside the existing `fitNext` one:

```ts
    expect(SOLO_VERSIONS.solo.queue).toBeUndefined();
    expect(typeof SOLO_VERSIONS.solo2.queue).toBe('function');
```

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD && \
git add app/lib/solo2/engine.ts app/lib/solo2/engine.test.ts \
        app/lib/solo/versions.ts app/lib/solo/versions.test.ts && \
git commit -m "feat(solo2): queue2 exposes the rules' order (#228)"
```

---

### Task 3: Widen the seam

`MySide` takes a queue; decisions carry the camera they chose. Behaviour is
unchanged — the queue is length 1 everywhere until Task 4.

**Files:**
- Modify: `app/lib/solo2/rendezvous.ts` (types + `fitNext` body)
- Modify: `app/lib/solo/advance.ts:81-91`
- Modify: `app/lib/solo/replay.ts:439-443`, `:490-506`
- Test: `app/lib/solo2/rendezvous.test.ts`, `app/lib/solo/advance.test.ts`

**Interfaces:**
- Consumes: `queue2` (Task 2).
- Produces:
  - `MySide<T>` — `pick: T` is replaced by `queue: T[]`; `queue[0]` is what
    `next` would have drawn. Other fields unchanged.
  - Every draw-shaped `Decision` variant (`plain`, `pin`, `fit`, `nofit`) gains
    `pick: T`. `grow` does not — it draws nothing.

- [ ] **Step 1: Write the failing test**

In `app/lib/solo2/rendezvous.test.ts`, change the `mine` helper to build a queue,
and add a test:

```ts
  const mine = (over: Partial<MySide<RunEntry>> = {}): MySide<RunEntry> =>
    ({ t0Ms: T0, queue: [night[12]], entries: pool, role: 'peak', ending: null, ...over });

  it('every drawing decision names the camera it chose', () => {
    const dec = fitNext(mine(), { peakAtMs: null }, D);
    expect(dec.kind).toBe('pin');
    if (dec.kind === 'grow') return;
    expect(dec.pick.webcamId).toBe(7);
  });
```

Replace every other `pick:` override in that file with `queue: [...]` — e.g.
`mine({ pick: pool[13] })` becomes `mine({ queue: [pool[13]] })`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/solo2/rendezvous.test.ts`
Expected: FAIL — type errors on `queue`, and `dec.pick` undefined.

- [ ] **Step 3: Change the types**

In `app/lib/solo2/rendezvous.ts`:

```ts
export interface MySide<T extends RunEntry> {
  /** The tick this draw would start on: the previous dwell's end. */
  t0Ms: number;
  /**
   * The rules' order, head first (engine `queue2`). `queue[0]` is the draw
   * the engine would make on its own; the rendezvous may choose deeper into
   * it (scheduler spec §3.1). Never empty when the caller has a pick.
   */
  queue: T[];
  entries: T[];
  role: Role;
  ending: { webcamId: number; lastShownId: number } | null;
}

export type Decision<T> =
  | { kind: 'plain'; pick: T; frames: T[]; dropped: T[]; peakAtMs: null }
  | { kind: 'pin'; pick: T; frames: T[]; dropped: T[]; peakAtMs: number }
  | { kind: 'fit'; pick: T; frames: T[]; dropped: T[]; peakAtMs: number }
  | { kind: 'grow'; add: T[] }
  | { kind: 'nofit'; pick: T; why: 'too soon' | 'nothing to add'; frames: T[]; dropped: T[]; peakAtMs: null };
```

- [ ] **Step 4: Thread it through `fitNext`**

At the top of `fitNext`, bind `const pick = mine.queue[0];` and use `pick`
wherever `mine.pick` appeared. Add `pick` to each returned object — `plain`,
`pin`, both `nofit` returns, and `fit`.

- [ ] **Step 5: Update the server call site**

In `app/lib/solo/advance.ts`, replace the `version.next(...)` pick with the
queue, and take the drawn camera from the decision. The `pick` const at line 53
becomes:

```ts
  const queue = version.queue
    ? version.queue(entries, dials, state, slot, feed, Math.max(1, Math.floor((dials as Solo2Dials).rendezvousWindow ?? 1)))
    : [];
  const pick = queue[0] ?? version.next(entries, dials, state, slot, feed);
  if (!pick) return { advanced: false, grown: false, decision: null, screen: screenBefore };
```

In the `fitNext` call, pass `queue: queue.length > 0 ? queue : [pick]` in place
of `pick`. After the call, in the `dec.kind !== 'grow'` branch, add
`drawn = dec.pick;` and use `drawn` — not `pick` — for `shown`, `afterShowing`,
`commitAdvance` and the pool tally. Declare `let drawn = pick;` beside `let shown`.

> **Why this matters:** the row's `currentSnapshotId`, the `shown` tallies and
> the `sunsetStreak` must all describe the camera that actually went on glass.
> Taking any of them from `pick` while the decision drew something else is the
> bug this task exists to prevent.

- [ ] **Step 6: Update the replay call site**

In `app/lib/solo/replay.ts`, in `decideFor`, pass
`queue: [pick as ReplayEntry]` for now (Task 4 widens it), and at the bottom
where the `StepDecision` is built, return `dec.pick` so `stepOnce` stamps the
right frame. Add a `pick` field to `StepDecision`'s `draw` variant:

```ts
  | { kind: 'draw'; pick: BinEntry; shown: BinEntry[]; lengthMs: number; peakAtMs: number | null; rendezvous: boolean; dropped: number }
```

and in `stepOnce`, replace the two uses of the outer `pick` after the decision
(`s.working.find(...)` and `s.seen.add(...)`, `afterShowing(pick, s.state)`)
with `decision.pick`.

- [ ] **Step 7: Run the suite**

Run: `npm run test`
Expected: PASS. `app/lib/solo/advance.test.ts` stubs `fitNext`; add `pick` to
each stubbed decision, e.g.
`fitNext: () => ({ kind: 'fit' as const, pick: fitted[0], frames: fitted, dropped: [], peakAtMs: NOW + 8_000 })`.

- [ ] **Step 8: Measure — nothing may move**

Run the global replay command.
Expected: **identical to Task 1's numbers.** This task is a refactor; any change
in `made` or `dropped` is a bug in the threading. Stop and find it.

- [ ] **Step 9: Commit**

```bash
git rev-parse --abbrev-ref HEAD && \
git add app/lib/solo2/rendezvous.ts app/lib/solo2/rendezvous.test.ts \
        app/lib/solo/advance.ts app/lib/solo/advance.test.ts app/lib/solo/replay.ts && \
git commit -m "refactor(rendezvous): fitNext takes a queue and names its pick (#228)"
```

---

### Task 4: The dials

Three new dials in, one out. Separate from Task 5 so the schema change can be
reviewed without the algorithm.

**Files:**
- Modify: `app/lib/solo2/types.ts:76-81`
- Modify: `app/lib/solo2/settingsSchema.ts:145`, `:180`
- Test: `app/lib/solo2/settingsSchema.test.ts:31-41`

**Interfaces:**
- Produces: `Solo2Dials.rendezvousWindow: number`, `.rendezvousGood: number`,
  `.rendezvousRest: number`. `.rendezvousRank` is gone.

- [ ] **Step 1: Write the failing test**

Replace the three `rendezvousRank` tests in
`app/lib/solo2/settingsSchema.test.ts` with:

```ts
  it('has the rendezvous dials, and rank is gone', () => {
    expect(keys).toEqual(expect.arrayContaining(['rendezvous', 'rendezvousWindow', 'rendezvousGood', 'rendezvousRest']));
    expect(keys).not.toContain('rendezvousRank');
  });
  it('their defaults', () => {
    expect(d.rendezvousWindow).toBe(4);
    expect(d.rendezvousGood).toBe(0.75);
    expect(d.rendezvousRest).toBe(0);
  });
  it('the window is clamped to [1, 8] by mergeSettings', () => {
    expect(dialsFrom2(mergeSettings(SOLO2_SETTINGS_SCHEMA, { rendezvousWindow: 99 })).rendezvousWindow).toBe(8);
    expect(dialsFrom2(mergeSettings(SOLO2_SETTINGS_SCHEMA, { rendezvousWindow: 0 })).rendezvousWindow).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/solo2/settingsSchema.test.ts`
Expected: FAIL — `rendezvousWindow` undefined.

- [ ] **Step 3: Change the dials type**

In `app/lib/solo2/types.ts`, replace the `rendezvousRank` field with:

```ts
  /** How many cameras deep into the queue the rendezvous may choose. 1 = never chooses (scheduler spec §3.1). */
  rendezvousWindow: number;
  /** A meeting counts as good at or above this pair rank. A label for the studio and the replay; it gates nothing. */
  rendezvousGood: number;
  /** After a meeting, how many of this screen's runs pass before it announces again. 0 is off. */
  rendezvousRest: number;
```

- [ ] **Step 4: Change the schema**

In `app/lib/solo2/settingsSchema.ts`, replace the `rendezvousRank` entry with
three entries and update `dialsFrom2`:

```ts
  {
    key: 'rendezvousWindow', kind: 'number', min: 1, max: 8, step: 1, default: 4,
    label: 'choice window', hint: 'How many cameras deep into the queue the rendezvous may choose. 1 means it never chooses — strict rotation, fewer meetings.',
  },
  {
    key: 'rendezvousGood', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.75,
    label: 'a good meeting', hint: 'A meeting counts as good at or above this pair rank. A label only — it does not decide whether meetings happen.',
  },
  {
    key: 'rendezvousRest', kind: 'number', min: 0, max: 8, step: 1, default: 0,
    label: 'rest after a meeting', hint: 'Runs this screen lets pass before announcing again. A ceiling on how often the screens meet; 0 is off.',
  },
```

```ts
    rendezvousWindow: values.rendezvousWindow as number,
    rendezvousGood: values.rendezvousGood as number,
    rendezvousRest: values.rendezvousRest as number,
```

Match the `label`/`hint` property names to the neighbouring entries in that file
— read one before writing these.

- [ ] **Step 5: Update `RendezvousDials`**

In `app/lib/solo2/rendezvous.ts` line 17-18, the `Pick<>` becomes:

```ts
export type RendezvousDials = Pick<Solo2Dials,
  'beatS' | 'changeBeats' | 'transition' | 'cameraRun' | 'runFramesSunset' | 'runFramesOther' | 'runShape'
  | 'rendezvous' | 'rendezvousWindow'>;
```

Update the `D` fixture in `app/lib/solo2/rendezvous.test.ts`: drop
`rendezvousRank: 0.6`, add `rendezvousWindow: 1`.

- [ ] **Step 6: Run the suite**

Run: `npm run test`
Expected: PASS. Search for stragglers first:
`grep -rn rendezvousRank app scripts --include='*.ts' --include='*.tsx'`
must come back empty except for the spec's own prose.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD && \
git add app/lib/solo2/types.ts app/lib/solo2/settingsSchema.ts \
        app/lib/solo2/settingsSchema.test.ts app/lib/solo2/rendezvous.ts \
        app/lib/solo2/rendezvous.test.ts && \
git commit -m "feat(rendezvous): window, good and rest dials replace rank (#228)"
```

---

### Task 5: The window chooses

The scheduler itself.

**Files:**
- Modify: `app/lib/solo2/rendezvous.ts` (`fitNext` tier 1)
- Modify: `app/lib/solo/replay.ts` (pass the real queue)
- Test: `app/lib/solo2/rendezvous.test.ts`

**Interfaces:**
- Consumes: `MySide.queue` (Task 3), `rendezvousWindow` (Task 4).
- Produces: no new exported names.

- [ ] **Step 1: Write the failing tests**

Add to `describe('fitNext')` in `app/lib/solo2/rendezvous.test.ts`. Camera 7's
peak is id 10 with a climb of 9; camera 8 has two frames and a peak at id 21.

```ts
  it('picks deeper in the queue when the head cannot reach the landing', () => {
    // 1 beat of change + 1 beat of climb: camera 8's peak is one frame in, so it
    // reaches; camera 7's climb is nine and cannot land that early.
    const T = T0 + beat(1 + 1);
    const dec = fitNext(mine({ queue: [night[12], pool[14]] }), { peakAtMs: T }, { ...D, rendezvousWindow: 2 });
    expect(dec.kind).toBe('fit');
    if (dec.kind !== 'fit') return;
    expect(dec.pick.webcamId).toBe(8);
    expect(dec.peakAtMs).toBe(T);
  });

  it('a window of 1 never chooses: the head fits or nothing does', () => {
    const T = T0 + beat(1 + 1);
    const dec = fitNext(mine({ queue: [night[12], pool[14]] }), { peakAtMs: T }, { ...D, rendezvousWindow: 1 });
    expect(dec.kind).toBe('fit');
    if (dec.kind !== 'fit') return;
    expect(dec.pick.webcamId).toBe(7);
  });

  it('among cameras that reach, the best-ranked wins', () => {
    // Camera 9 is a stronger sunset than camera 8 and sits behind it in the queue.
    const strong = [f(40, 9, 1000, 0.9), f(41, 9, 1100, 0.95)];
    const entries = [...pool, ...strong];
    const T = T0 + beat(1 + 1);
    const dec = fitNext(
      mine({ queue: [night[12], pool[14], strong[1]], entries }),
      { peakAtMs: T }, { ...D, rendezvousWindow: 3 },
    );
    expect(dec.kind).toBe('fit');
    if (dec.kind !== 'fit') return;
    expect(dec.pick.webcamId).toBe(9);
  });

  it('a camera with no peak is never a candidate', () => {
    const grey = f(50, 11, 500, null);
    const T = T0 + beat(1 + 1);
    const dec = fitNext(
      mine({ queue: [grey, pool[14]], entries: [...pool, grey] }),
      { peakAtMs: T }, { ...D, rendezvousWindow: 2 },
    );
    expect(dec.kind).toBe('fit');
    if (dec.kind !== 'fit') return;
    expect(dec.pick.webcamId).toBe(8);
  });

  it('nothing in the window reaches → grow by the least any of them needs', () => {
    const ending = [f(60, 12, 100, null), f(61, 12, 200, null), f(62, 12, 300, null)];
    const T = T0 + beat(1 + 12); // further out than any climb in the window
    const dec = fitNext(
      mine({ queue: [night[12], pool[14]], entries: [...pool, ...ending], ending: { webcamId: 12, lastShownId: 60 } }),
      { peakAtMs: T }, { ...D, rendezvousWindow: 2 },
    );
    expect(dec.kind).toBe('grow');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/lib/solo2/rendezvous.test.ts -t 'deeper in the queue'`
Expected: FAIL — the head is drawn, `dec.pick.webcamId` is 7.

- [ ] **Step 3: Implement tier 1**

Replace everything in `fitNext` from `const T = theirs.peakAtMs;` to the end with:

```ts
  const T = theirs.peakAtMs;
  const change = changeBeats(d);
  const beatMs = d.beatS * 1000;
  const landing = (before: number) => mine.t0Ms + (change + before) * beatMs;

  if (T == null) {
    const w = windowAround(series, peak, cap);
    return { kind: 'pin', pick, frames: w.frames, dropped: w.dropped, peakAtMs: landing(w.frames.findIndex((e) => e.snapshotId === peak.snapshotId)) };
  }
  const avail = Math.round((T - mine.t0Ms) / beatMs) - change;
  if (avail < 0 || (T - mine.t0Ms) % beatMs !== 0) {
    const w = windowAround(series, peak, cap);
    return { kind: 'nofit', pick, why: 'too soon', frames: w.frames, dropped: w.dropped, peakAtMs: null };
  }

  // The choice window (scheduler spec §3): the head of the queue, and only
  // cameras that have a peak of their own to land.
  const depth = Math.max(1, Math.floor(d.rendezvousWindow));
  const candidates = mine.queue.slice(0, depth).flatMap((c, index) => {
    const cSeries = cameraGroups(mine.entries).get(c.webcamId) ?? [c];
    const cPeak = peakOf(cSeries);
    if (cPeak === null) return [];
    const cCap = capFor(c, d, mine.entries, d.cameraRun);
    const climbMax = Math.min(
      cSeries.slice().sort(compareCapture).findIndex((e) => e.snapshotId === cPeak.snapshotId),
      roomOf(cCap),
    );
    return [{ c, index, cSeries, cPeak, cCap, climbMax, rank: qualityRank(c, mine.entries, d.cameraRun) }];
  });

  // Highest rank, then fewest frames dropped, then earlier in the queue.
  const reaching = candidates
    .filter((x) => avail <= x.climbMax)
    .map((x) => ({ ...x, w: windowAround(x.cSeries, x.cPeak, x.cCap, avail) }))
    .sort((a, b) => b.rank - a.rank || a.w.dropped.length - b.w.dropped.length || a.index - b.index);
  if (reaching.length > 0) {
    const best = reaching[0];
    return { kind: 'fit', pick: best.c, frames: best.w.frames, dropped: best.w.dropped, peakAtMs: T };
  }

  // Nobody reaches: grow the ending run by the least any candidate needs, so
  // the later choice stays as wide as possible.
  const need = candidates.length > 0 ? Math.min(...candidates.map((x) => avail - x.climbMax)) : avail - climbMax;
  if (need > 0 && mine.ending) {
    const theirSeries = (cameraGroups(mine.entries).get(mine.ending.webcamId) ?? []).slice().sort(compareCapture);
    const last = theirSeries.findIndex((e) => e.snapshotId === mine.ending!.lastShownId);
    const add = last >= 0 ? theirSeries.slice(last + 1, last + 1 + need) : [];
    if (add.length === need) return { kind: 'grow', add };
  }
  const w = windowAround(series, peak, cap);
  return { kind: 'nofit', pick, why: 'nothing to add', frames: w.frames, dropped: w.dropped, peakAtMs: null };
```

Keep the existing `series`, `cap`, `peak`, `plain`, `eligible` and `climbMax`
bindings above this; `climbMax` stays as the head's, used only in the `need`
fallback when the window yields no candidate at all.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/lib/solo2/rendezvous.test.ts`
Expected: PASS, all of them, including the pre-existing fit/grow/too-soon tests.

- [ ] **Step 5: Give the replay the real queue**

In `app/lib/solo/replay.ts` `decideFor`, replace the placeholder queue with:

```ts
    const depth = Math.max(1, Math.floor((dials as unknown as { rendezvousWindow?: number }).rendezvousWindow ?? 1));
    const q = version.queue
      ? version.queue<ReplayEntry>(pool, dials, s.state, s.slot, s.o.feed, depth)
      : [];
    const dec = version.fitNext<ReplayEntry>(
      { t0Ms: s.atMs, queue: q.length > 0 ? q : [pick as ReplayEntry], entries: pool, role: version.roleAt(s.slot, s.o.feed, dials), ending },
      { peakAtMs: theirs && theirs.atMs > s.atMs ? theirs.atMs : null },
      dials,
    );
```

- [ ] **Step 6: Run the suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 7: Sweep the window and record it**

Run the global replay command four times, adding
`--dial rendezvousWindow=1`, `=2`, `=4`, `=8`. Record `made`, `no partner`,
`dropped` and the `draws per camera` table for each.

Expected shape: `made` rises with the window and `no partner` falls. If `made`
at window 8 is not meaningfully above window 1, the candidate filter is wrong —
check that `peakOf` is being asked about each candidate's own series, not the
head's.

The variety check: in the `draws per camera` table at window 8, no camera's
count should be more than about twice its count at window 1. If one is, say so
in the commit message — that is the signal the default should be lower than 4.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD && \
git add app/lib/solo2/rendezvous.ts app/lib/solo2/rendezvous.test.ts app/lib/solo/replay.ts && \
git commit -m "feat(rendezvous): the window chooses the camera that can meet the landing (#228)"
```

---

### Task 6: Rest after a meeting

The cadence ceiling. Inert at the default, and it must cost nothing when off.

**Files:**
- Modify: `app/lib/solo2/rendezvous.ts` (`TheirSide` gains `resting`)
- Modify: `app/lib/solo/advance.ts`, `app/lib/solo/store.ts`
- Test: `app/lib/solo2/rendezvous.test.ts`, `app/lib/solo/store.test.ts`

**Interfaces:**
- Produces:
  - `TheirSide` gains `resting: boolean` — true when this screen may not
    announce. It never blocks a *fit*: an announced landing was already
    budgeted, and refusing to meet it would waste the other screen's run.
  - `runsSinceRendezvous(feed: Feed, slot: number): Promise<number>` in
    `app/lib/solo/store.ts` — this feed's draws since the newest
    `kiosk_draws` row with `rendezvous = true`.

- [ ] **Step 1: Write the failing test**

```ts
  it('resting suppresses an announcement but never a meeting', () => {
    expect(fitNext(mine(), { peakAtMs: null, resting: true }, D).kind).toBe('plain');
    const T = T0 + beat(1 + 9);
    expect(fitNext(mine(), { peakAtMs: T, resting: true }, D).kind).toBe('fit');
  });
```

Add `resting: false` to every other `TheirSide` literal in that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/solo2/rendezvous.test.ts -t 'resting'`
Expected: FAIL — `resting` is not a property of `TheirSide`.

- [ ] **Step 3: Implement**

In `app/lib/solo2/rendezvous.ts`:

```ts
export interface TheirSide {
  /** The other screen's pinned landing, ms, or null. */
  peakAtMs: number | null;
  /**
   * This screen has met recently and is letting runs pass before announcing
   * again (`rendezvousRest`). It still fits: a landing already announced was
   * budgeted by the screen that made it, and refusing it wastes that run.
   */
  resting: boolean;
}
```

and in `fitNext`, in the `T == null` branch only:

```ts
  if (T == null) {
    if (theirs.resting) return plain();
    const w = windowAround(series, peak, cap);
    return { kind: 'pin', pick, ... };
  }
```

- [ ] **Step 4: Add the store query**

In `app/lib/solo/store.ts`, following the file's existing query style:

```ts
/**
 * This feed's draws since the last meeting, or Infinity when it has never
 * met. Called only when `rendezvousRest > 0`, so the default costs no query.
 */
export async function runsSinceRendezvous(feed: Feed, slot: number): Promise<number> {
  const rows = await sql`
    SELECT slot FROM kiosk_draws
    WHERE feed = ${feed} AND rendezvous = true
    ORDER BY slot DESC LIMIT 1
  `;
  if (rows.length === 0) return Number.POSITIVE_INFINITY;
  return slot - Number(rows[0].slot);
}
```

Read a neighbouring function in that file first and match how it names the sql
tag and coerces rows; `slot` is a BIGINT and arrives as a string.

- [ ] **Step 5: Gate it in the advance**

In `app/lib/solo/advance.ts`, beside the `getScreenState` call:

```ts
    const rest = Math.max(0, Math.floor((dials as Solo2Dials).rendezvousRest ?? 0));
    const resting = rest > 0 && (await runsSinceRendezvous(feed, slot)) < rest;
```

and pass `{ peakAtMs: otherPeak, resting }`. In `replayPair`, compute it from
the landings already counted — `counts.landings` holds every meeting, so:

```ts
      const restDials = Math.max(0, Math.floor((dials as unknown as { rendezvousRest?: number }).rendezvousRest ?? 0));
      const sinceMeeting = counts.landings.length === 0
        ? Number.POSITIVE_INFINITY
        : s.slot - (side === 'sunrise' ? counts.landings.at(-1)!.sunriseSlot : counts.landings.at(-1)!.sunsetSlot);
      const resting = restDials > 0 && sinceMeeting < restDials;
```

- [ ] **Step 6: Run the suite and check the cost**

Run: `npm run test`
Expected: PASS.

Then confirm the query does not run at the default:
`grep -n "runsSinceRendezvous" app/lib/solo/advance.ts` — the call must sit
behind `rest > 0` with short-circuit evaluation, on one line, so that at
`rendezvousRest = 0` no promise is created.

- [ ] **Step 7: Measure**

Run the global replay command with `--dial rendezvousWindow=4` and
`--dial rendezvousRest=3`, then again with `rendezvousRest=0`.
Expected: at the current rate the two runs are close — the rest rarely binds.
Record both.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD && \
git add app/lib/solo2/rendezvous.ts app/lib/solo2/rendezvous.test.ts \
        app/lib/solo/store.ts app/lib/solo/advance.ts app/lib/solo/replay.ts && \
git commit -m "feat(rendezvous): rest after a meeting, off by default (#228)"
```

---

### Task 7: The replay reports against the two dials

**Files:**
- Modify: `app/lib/solo/replay.ts` (`RendezvousCounts`)
- Modify: `scripts/solo-replay.ts` (the printed block)
- Test: `app/lib/solo/replay.test.ts`

**Interfaces:**
- Produces: `RendezvousCounts` gains
  `pairRanks: number[]`, `good: number`, `gaps: Record<Feed, number[]>`,
  `perCamera: Record<number, { draws: number; meetings: number }>`.

- [ ] **Step 1: Write the failing test**

In `app/lib/solo/replay.test.ts`, inside `describe('replayPair ...')`:

```ts
    it('reports pair rank and the gaps between meetings', () => {
      const pair = replayPair({ sunrise: a(), sunset: b() });
      const r = pair.rendezvous;
      expect(r.pairRanks.length).toBe(r.made);
      for (const x of r.pairRanks) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
      // One gap per meeting after the first, on each screen.
      expect(r.gaps.sunrise.length).toBe(Math.max(0, r.made - 1));
      expect(Object.values(r.perCamera).reduce((n, c) => n + c.meetings, 0)).toBe(r.made * 2);
    });
```

Reuse the `a()` / `b()` fixtures already in that describe block.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/solo/replay.test.ts -t 'pair rank'`
Expected: FAIL — `pairRanks` is undefined.

- [ ] **Step 3: Implement**

Add the four fields to `RendezvousCounts` and initialise them beside
`made: 0, missed: 0`. In `decideFor`'s `dec.kind === 'fit'` branch, after
`counts.made += 1`:

```ts
      const mineRank = qualityRank(dec.pick as RunEntry, pool as RunEntry[], true);
      const theirRank = theirs?.rank ?? mineRank;
      counts.pairRanks.push(Math.min(mineRank, theirRank));
      if (Math.min(mineRank, theirRank) >= goodDial) counts.good += 1;
      const prev = counts.landings.at(-1);
      if (prev) {
        counts.gaps.sunrise.push(s.slot - prev.sunriseSlot);
        counts.gaps.sunset.push(other.slot - prev.sunsetSlot);
      }
```

The announcing screen's rank has to travel with its pin, so extend the `pins`
record with `rank: number` and set it where the pin is stored:
`pins[side] = next == null ? null : { atMs: next, matched: false, lastFailure: null, rank: qualityRank(dec.pick as RunEntry, pool as RunEntry[], true) };`

Count `perCamera` in `stepOnce`'s draw branch — `draws += 1` always,
`meetings += 1` when `decision.rendezvous`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/lib/solo/replay.test.ts`
Expected: PASS.

- [ ] **Step 5: Print it**

In `scripts/solo-replay.ts`, replace the `rendezvous:` block with, in this order:

```
rendezvous
  cadence     133 meetings · one every 2.7 min · gap median 5 runs, worst 22
  magnitude   pair rank median 0.48 · 19 good (≥ 0.75)
  conversion  30% of 444 landings met · no partner 271 · too soon 0 · nothing to add 40
  tax         661 frames dropped · 34 grown
```

Add a `meetings` column to the existing `draws per camera` table.

- [ ] **Step 6: Run it**

Run the global replay command with `--dial rendezvousWindow=4`.
Expected: all four lines print with real numbers; the per-camera table has the
new column.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD && \
git add app/lib/solo/replay.ts app/lib/solo/replay.test.ts scripts/solo-replay.ts && \
git commit -m "feat(replay): cadence, magnitude, conversion, tax and variety (#228)"
```

---

### Task 8: The queue lane, as geometry

The pure half of the readout, so the picture can be tested without a browser.

**Files:**
- Create: `app/studio/solo/queueLane.ts`
- Test: `app/studio/solo/queueLane.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LaneItem<T> {
  entry: T;          // the camera's representative
  frames: T[];       // its series in capture order
  playedIds: Set<number>; // which of those the draw would play; the rest draw dim
  position: number;  // 1-based place in the queue
  reaches: boolean;  // could land its peak on the outstanding tick
  took: boolean;     // this is the camera the draw chose
  x: number; width: number;
}
export interface Link { fromX: number; toX: number; took: boolean; }
export interface Lane<T> { items: LaneItem<T>[]; links: Link[]; width: number; }
export function layoutQueueLane<T extends RunEntry>(o: {
  queue: T[]; entries: T[]; dials: Solo2Dials; outstandingMs: number | null; t0Ms: number;
  chosenId: number | null; blockX: Map<number, number>; framePx: number; gapPx: number;
}): Lane<T>;
export function crossings(links: Link[]): number;
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { layoutQueueLane, crossings } from './queueLane';

describe('layoutQueueLane (scheduler spec §6)', () => {
  it('lays items out in queue order, each as wide as its frame count', () => {
    const lane = layoutQueueLane({ ...base, framePx: 20, gapPx: 4 });
    expect(lane.items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(lane.items[0].x).toBe(0);
    expect(lane.items[1].x).toBe(lane.items[0].width + 4);
    expect(lane.items[0].width).toBe(lane.items[0].frames.length * 20);
  });

  it('marks the camera the draw took, and only that one', () => {
    const lane = layoutQueueLane({ ...base, chosenId: base.queue[2].snapshotId });
    expect(lane.items.filter((i) => i.took).map((i) => i.position)).toEqual([3]);
  });
});

describe('crossings', () => {
  it('is zero when the queue is taken in turn', () => {
    expect(crossings([{ fromX: 0, toX: 0, took: false }, { fromX: 10, toX: 10, took: false }])).toBe(0);
  });
  it('counts a camera pulled out of turn', () => {
    // The 2nd camera reached the glass before the 1st.
    expect(crossings([{ fromX: 0, toX: 50, took: false }, { fromX: 20, toX: 10, took: true }])).toBe(1);
  });
});
```

Define `base` at the top of the file with three single-frame cameras, a
`blockX` map, `outstandingMs: null`, `chosenId: null`, `t0Ms: 0`, and the same
`D` dial fixture shape used in `app/lib/solo2/rendezvous.test.ts` plus
`rendezvousWindow: 4`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/studio/solo/queueLane.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { cameraGroups, capFor, compareCapture, peakOf, roomOf, runOf, type RunEntry } from '@/app/lib/solo2/run';
import type { Solo2Dials } from '@/app/lib/solo2/types';

/**
 * The queue lane (scheduler spec §6): the queue in the rules' own order, each
 * camera one box holding its series, with the frames a draw would not play
 * marked so they can be drawn dim — the convention FeedColumn already uses.
 * Pure, so the picture is testable without a browser.
 */
export function layoutQueueLane<T extends RunEntry>(o: {
  /** The rules' order, head first — the same array `queue2` returned for this draw. */
  queue: T[];
  /** The whole pool, so a camera's series and cap can be worked out. */
  entries: T[];
  dials: Solo2Dials;
  /** The landing outstanding on the other screen at this draw, or null. */
  outstandingMs: number | null;
  /** The tick this draw starts on. */
  t0Ms: number;
  /** The snapshot id the draw actually chose, or null for a draw not yet made. */
  chosenId: number | null;
  /** Where each camera's block sits on the strip, by webcamId — the link's other end. */
  blockX: Map<number, number>;
  framePx: number;
  gapPx: number;
}): Lane<T> {
  const groups = cameraGroups(o.entries);
  const items: LaneItem<T>[] = [];
  let x = 0;
  o.queue.forEach((entry, i) => {
    const frames = (groups.get(entry.webcamId) ?? [entry]).slice().sort(compareCapture);
    const cap = capFor(entry, o.dials, o.entries, o.dials.cameraRun);
    const playedIds = new Set(runOf(entry, o.entries, o.dials.cameraRun, cap).map((f) => f.snapshotId));
    const width = frames.length * o.framePx;
    items.push({
      entry, frames, playedIds, position: i + 1,
      reaches: reachesTick(frames, cap, o),
      took: o.chosenId != null && o.chosenId === entry.snapshotId,
      x, width,
    });
    x += width + o.gapPx;
  });
  const links = items.flatMap((it) => {
    const toX = o.blockX.get(it.entry.webcamId);
    return toX == null ? [] : [{ fromX: it.x + it.width / 2, toX, took: it.took }];
  });
  return { items, links, width: Math.max(0, x - o.gapPx) };
}

/** Can this camera's peak land on the outstanding tick, by thinning its climb? */
function reachesTick<T extends RunEntry>(frames: T[], cap: number, o: { outstandingMs: number | null; t0Ms: number; dials: Solo2Dials }): boolean {
  if (o.outstandingMs == null) return false;
  const peak = peakOf(frames);
  if (peak === null) return false;
  const beatMs = o.dials.beatS * 1000;
  const change = o.dials.transition === 'cut' ? 0 : Math.max(0, Math.floor(o.dials.changeBeats));
  const avail = Math.round((o.outstandingMs - o.t0Ms) / beatMs) - change;
  const climbMax = Math.min(frames.findIndex((e) => e.snapshotId === peak.snapshotId), roomOf(cap));
  return avail >= 0 && avail <= climbMax;
}

/** How many links cross: a camera that reached the glass out of queue order. */
export function crossings(links: Link[]): number {
  let n = 0;
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      if ((links[i].fromX - links[j].fromX) * (links[i].toX - links[j].toX) < 0) n += 1;
    }
  }
  return n;
}
```

Fill the `o` parameter type from the Interfaces block above — do not leave the
comment in the shipped code.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/studio/solo/queueLane.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD && \
git add app/studio/solo/queueLane.ts app/studio/solo/queueLane.test.ts && \
git commit -m "feat(studio): queue lane geometry and crossing count (#228)"
```

---

### Task 9: The readout on screen

**Files:**
- Create: `app/studio/solo/QueueLane.tsx`
- Test: `app/studio/solo/QueueLane.test.tsx`
- Modify: `app/studio/solo/PairTape.tsx` (the meeting box)

**Interfaces:**
- Consumes: `layoutQueueLane`, `crossings` (Task 8); `Thumb`, `COLOR` from
  `./tapeParts`; `onSelect(entry, feed, list)` as `FeedColumn` calls it.
- Produces: `<QueueLane feed lane onSelect />`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueueLane } from './QueueLane';

describe('QueueLane', () => {
  it('draws a box per camera, labelled with its place in the queue', () => {
    render(<QueueLane feed="sunset" lane={lane} onSelect={() => {}} />);
    expect(screen.getByTestId('queue-cam-1')).toBeTruthy();
    expect(screen.getByTestId('queue-cam-3')).toBeTruthy();
  });

  it('rings the camera the rendezvous took', () => {
    render(<QueueLane feed="sunset" lane={tookThird} onSelect={() => {}} />);
    expect(screen.getByTestId('queue-cam-3').getAttribute('data-took')).toBe('true');
    expect(screen.getByTestId('queue-cam-1').getAttribute('data-took')).toBe('false');
  });

  it('every frame opens the frame modal with its own lane as the list', () => {
    const onSelect = vi.fn();
    render(<QueueLane feed="sunset" lane={lane} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId(`queue-frame-${lane.items[0].frames[0].snapshotId}`));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const [entry, feed, list] = onSelect.mock.calls[0];
    expect(entry.snapshotId).toBe(lane.items[0].frames[0].snapshotId);
    expect(feed).toBe('sunset');
    expect(list.length).toBe(lane.items.flatMap((i) => i.frames).length);
  });
});
```

Build `lane` and `tookThird` by calling `layoutQueueLane` on fixtures, so the
component test and the geometry test cannot disagree.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/studio/solo/QueueLane.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';
import type { Lane } from './queueLane';
import { COLOR, mono } from './tapeParts';

/**
 * One screen's queue, in the rules' own order (scheduler spec §6): a camera is
 * one box holding its series, the frames it will not play drawn dim, the one
 * the rendezvous took ringed. Every frame clicks through to the label card,
 * with the lane as the list so the arrows step along it.
 */
export function QueueLane({ feed, lane, onSelect }: {
  feed: Feed;
  lane: Lane<EntryView>;
  onSelect: (entry: EntryView, feed: Feed, list: EntryView[]) => void;
}) {
  const list = lane.items.flatMap((i) => i.frames);
  return (
    <div style={{ position: 'relative', height: 40, width: lane.width }}>
      {lane.items.map((it) => (
        <div key={it.entry.webcamId} data-testid={`queue-cam-${it.position}`} data-took={String(it.took)}
          title={`${it.position} in the queue${it.reaches ? ' · reaches the landing' : ''}`}
          style={{
            position: 'absolute', left: it.x, width: it.width, top: 0, display: 'flex', gap: 1, padding: 2,
            border: `1.5px solid ${COLOR[it.entry.bin]}`, borderRadius: 4, boxSizing: 'border-box',
            boxShadow: it.took ? '0 0 0 2px #f5a344' : undefined,
            opacity: it.reaches || it.took ? 1 : 0.6,
          }}>
          {it.frames.map((f) => (
            <button key={f.snapshotId} type="button" data-testid={`queue-frame-${f.snapshotId}`}
              onClick={() => onSelect(f, feed, list)}
              style={{
                flex: 1, padding: 0, border: 0, borderRadius: 1, background: '#000', cursor: 'pointer',
                opacity: it.playedIds.has(f.snapshotId) ? 1 : 0.28, position: 'relative', overflow: 'hidden',
              }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              {f.bin === 'sunset' && f.quality != null && (
                <span style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: `${Math.round(f.quality * 100)}%`, background: COLOR.sunset }} />
              )}
            </button>
          ))}
          <span style={{ position: 'absolute', left: 0, bottom: -13, fontFamily: mono, fontSize: 9, color: '#8d95a3', whiteSpace: 'nowrap' }}>
            {it.position} · {it.entry.city}
          </span>
        </div>
      ))}
    </div>
  );
}
```

Check `EntryView`'s real field names for the thumbnail and the city before
writing this — `app/api/kiosk/solo/view.ts` defines it, and `EntryRow.tsx`
already reads both.

- [ ] **Step 4: Draw the links**

Add an SVG below the boxes, one line per `lane.links`, orange and 2px when
`took`, `#3f4759` and 1.5px otherwise:

```tsx
      <svg width={lane.width} height={40} style={{ position: 'absolute', left: 0, top: 44, overflow: 'visible' }}>
        {lane.links.map((l, i) => (
          <line key={i} x1={l.fromX} y1={0} x2={l.toX} y2={40}
            stroke={l.took ? '#f5a344' : '#3f4759'} strokeWidth={l.took ? 2 : 1.5} />
        ))}
      </svg>
```

- [ ] **Step 5: The meeting box**

In `app/studio/solo/PairTape.tsx`, replace the vertical landing rule with a
rectangle spanning both strips. Add this element beside `OrangeEdge`:

```tsx
/** A landing, as a box around the two frames that share it (scheduler spec §6). */
function MeetingBox({ left, width, top, height, label, met }: {
  left: number; width: number; top: number; height: number; label: string; met: boolean;
}) {
  return (
    <div data-testid="tape-meeting" data-met={String(met)} aria-hidden style={{
      position: 'absolute', left: left - 4, width: width + 8, top: top - 4, height: height + 8,
      border: `2px ${met ? 'solid' : 'dashed'} ${met ? ORANGE : GHOST}`, borderRadius: 6, pointerEvents: 'none',
    }}>
      <span style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)', top: -17, whiteSpace: 'nowrap',
        font: `10px/1 ${mono}`, color: met ? ORANGE : GHOST,
      }}>{label}</span>
    </div>
  );
}
```

Render one per landing, `left = x(peakAtMs)` and `width` the strip's frame
width, `top` the sunrise strip's top and `height` spanning through the ruler to
the sunset strip's bottom. `label` is the clock plus the pair rank for a
meeting, and the clock plus `no partner` for a landing that went unmet. Delete
the vertical rule the tape draws today — the box replaces it.

Add to `PairTape.test.tsx`:

```tsx
  it('draws one box per landing, and says which ones were met', () => {
    render(<PairTape {...props} />);
    const boxes = screen.queryAllByTestId('tape-meeting');
    expect(boxes.length).toBe(props.projection.rendezvous.landings.length);
    expect(boxes.some((b) => b.getAttribute('data-met') === 'false')).toBe(true);
  });
```

Reuse the `props` fixture already built in that file; if its projection has no
unmet landing, extend the fixture with one rather than weakening the assertion.

- [ ] **Step 6: Run the suite and build**

Run: `npm run test && npm run build`
Expected: both PASS.

- [ ] **Step 7: Commit and push**

```bash
git rev-parse --abbrev-ref HEAD && \
git add app/studio/solo/QueueLane.tsx app/studio/solo/QueueLane.test.tsx \
        app/studio/solo/PairTape.tsx app/studio/solo/PairTape.test.tsx && \
git commit -m "feat(studio): queue lanes, links and the meeting box (#228)" && \
git push
```

---

## Wiring the lanes into the page

`FeedColumn` owns the queue today and `PairTape` owns the time axis. The lanes
belong to the tape, because a lane is read against the strip beside it. Add
`<QueueLane>` above the sunrise strip and below the sunset strip inside
`PairTape`, sourcing the queue from `projectPair`'s existing projection, and
pass `PairTape`'s `onSelect` straight through. `FeedColumn`'s own queue column
is unchanged by this plan — #240 decides whether it stays.

## Definition of done

- `npm run test` and `npm run build` pass.
- `grep -rn rendezvousRank app scripts --include='*.ts' --include='*.tsx'` is
  empty.
- The six-hour replay at `rendezvousWindow=4` shows **more meetings and fewer
  `no partner` misses than window 1**, with no camera's draw count more than
  about double its window-1 count.
- A PR body carrying the window sweep table and `Closes #228`.
