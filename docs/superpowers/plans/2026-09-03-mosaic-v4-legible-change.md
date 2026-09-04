# Mosaic v4 — legible change — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `v4` mosaic, forked from v3, whose tiles shrink as their sunset ends, never draw two cameras over each other, and change at a steady trickle rather than on the minute.

**Architecture:** `app/components/mosaic/v4/` is a copy of v3 with four additions. The engine's `sizeTiles` gains an altitude-driven exit taper. `motion.ts` gains a per-tile phase key, scheduled ("pending") retargets so stagger works in drift mode, entry/exit fades with their own duration and scale, and a fade-through rule that makes an entry wait for any departing tile it would overlap. `MosaicCanvas` schedules frame crossfades on the same delays, keeps drawing a departing tile's last frame, and sleeps on a timer between scheduled events instead of spinning. `useLoadedTiles` holds a camera that goes missing for a few cycles.

**Tech Stack:** Next.js app, React 19 client components, canvas 2D, Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-mosaic-v4-legible-change-design.md`

## Global Constraints

- Work in the sibling worktree `~/GitHub/the-sunset-webcam-map.worktrees/feat-mosaic-v4` on branch `feat/mosaic-v4`. Verify the branch in the same command as every commit: `[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/mosaic-v4" ] && git commit ...`.
- Stage explicit paths. Never `git add -A`.
- **Touch nothing under `v1/`, `v2/`, `v3/`.** v3 is frozen as the show fallback.
- `DEFAULT_MOSAIC_VERSION` stays `'v1'`.
- Push after every commit with the gh credential helper (the keychain helper hangs): `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/mosaic-v4`, then verify `git rev-parse HEAD origin/feat/mosaic-v4` prints the same hash twice.
- Run tests with `npx vitest run <path>`; the full suite is `npm run test`. `npx tsc --noEmit` has ~185 pre-existing errors on main and cannot gate anything; `npm run build` can.
- Defaults from the spec, verbatim: `exitTaperDeg` 6, `motionOrder` `scatter`, `changeSpreadMs` 60000, `transitionStyle` `fadeThrough`, `fadeMs` 20000, `fadeScale` 0.85, `missGraceCycles` 2.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_018a9bbcpGGuhq6Y6cdJQhYE
  ```

## File map

| File (all under `app/components/mosaic/`) | Responsibility after this plan |
|---|---|
| `registry.ts` | adds the `v4` row and schema |
| `v4/**` | copy of v3 with identifiers renamed (Task 1) |
| `v4/engine/axis.ts` | `+ exitEdgeDeg(cfg, feed)` |
| `v4/engine/sizing.ts` | `+ exitTaper(alt, cfg, feed)`; `sizeTiles` takes `feed` |
| `v4/engine/compose.ts` | passes `feed` into `sizeTiles` |
| `v4/engine/types.ts` | `V4Config` gains `exitTaperDeg`, `missGraceCycles` |
| `v4/settingsSchema.ts` | new/renamed dials; `motionFromSettings` returns the v4 `MotionConfig` |
| `v4/motion.ts` | rewritten: scatter key, spread, pending retargets, enter/exit fades, fade-through, `nextEventAt` |
| `v4/MosaicCanvas.tsx` | scheduled crossfades, departed tiles keep their frame, timer wake |
| `v4/useLoadedTiles.ts` | miss grace, `held` count |
| `v4/overlays/SetupOverlay.tsx` | shows `held` |
| `v4/index.tsx` | wires `missGraceCycles` and `held` |

---

### Task 1: Fork v3 into v4 and register it

**Files:**
- Create: `app/components/mosaic/v4/**` (copy of `v3/`)
- Modify: `app/components/mosaic/registry.ts`

**Interfaces:**
- Produces: `MosaicV4`, `V4_SETTINGS_SCHEMA`, `V4Config`, `v4Config()`, test id `v4-setup-counts`. Every later task edits files under `v4/` only (plus `registry.ts` here).

- [ ] **Step 1: Copy the folder and rename the identifiers**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-mosaic-v4/app/components/mosaic
cp -R v3 v4
grep -rl . v4 | xargs perl -pi -e '
  s/\bMosaicV3\b/MosaicV4/g;
  s/\bV3_SETTINGS_SCHEMA\b/V4_SETTINGS_SCHEMA/g;
  s/\bV3Config\b/V4Config/g;
  s/\bv3Config\b/v4Config/g;
  s/v3-setup-counts/v4-setup-counts/g;
  s/\x27v3 registration\x27/\x27v4 registration\x27/g;
  s/MOSAIC_VERSIONS\.v3\b/MOSAIC_VERSIONS.v4/g;
  s/MOSAIC_SETTINGS_SCHEMAS\.v3\b/MOSAIC_SETTINGS_SCHEMAS.v4/g;
  s/resolveMosaic\(\x27v3\x27\)/resolveMosaic(\x27v4\x27)/g;
  s/is reachable under the v3 key/is reachable under the v4 key/g;
'
grep -rn "v3" v4 --include='*.ts' --include='*.tsx' | grep -v "v2's\|v3's\|v3 \|from v3\|in v3\|v3 —\|v3 already\|v3 makes\|v3 removed\|v3 does\|v3 —" | head -30
```

Read the remaining `v3` hits. Prose that describes history ("v2's de-overlap pass … DELETED in v3") stays. Anything that is an identifier or a test name still saying v3 gets renamed by hand. In `v4/index.test.tsx` the test "gives v3 a schema object distinct from v2" becomes "gives v4 a schema object distinct from v3" and compares `MOSAIC_SETTINGS_SCHEMAS.v4` with `.v3`.

- [ ] **Step 2: Register v4**

In `app/components/mosaic/registry.ts`:

```ts
import { MosaicV4 } from './v4';
import { V4_SETTINGS_SCHEMA } from './v4/settingsSchema';
// ...
export const MOSAIC_VERSIONS: Record<string, MosaicComponent> = {
  v1: MosaicV1,
  v2: MosaicV2,
  v3: MosaicV3,
  v4: MosaicV4,
};
// ...
export const MOSAIC_SETTINGS_SCHEMAS: Record<string, SettingsSchema> = {
  v1: V1_SETTINGS_SCHEMA,
  v2: V2_SETTINGS_SCHEMA,
  v3: V3_SETTINGS_SCHEMA,
  v4: V4_SETTINGS_SCHEMA,
};
```

- [ ] **Step 3: Put the fork's purpose at the top of `v4/index.tsx`**

Replace the header comment of `MosaicV4` with:

```ts
/**
 * v4 — legible change. v3's composition (fixed bands, absolute placement,
 * eviction) untouched; what changes is how change LOOKS: an exit taper in
 * the engine, fade-through transitions and scattered change in the motion
 * layer, and a miss grace in the loader. Spec:
 * docs/superpowers/specs/2026-09-03-mosaic-v4-legible-change-design.md
 */
```

- [ ] **Step 4: Run the v4 folder's tests, the registry test, and the shared-schema test**

Run: `npx vitest run app/components/mosaic/v4 app/components/mosaic/registry.test.tsx app/lib/settings`
Expected: all green. If any test still names v3, fix the rename, not the test's intent.

- [ ] **Step 5: Commit and push**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-mosaic-v4
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/mosaic-v4" ] && \
  git add app/components/mosaic/v4 app/components/mosaic/registry.ts && \
  git commit -m "feat(mosaic): fork v3 into v4 and register it

Byte-for-byte v3 behaviour under a new key; the legible-change work
lands on top in the following commits. DEFAULT stays v1.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018a9bbcpGGuhq6Y6cdJQhYE"
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/mosaic-v4
git rev-parse HEAD origin/feat/mosaic-v4
```

---

### Task 2: Exit taper in the engine

**Files:**
- Modify: `app/components/mosaic/v4/engine/axis.ts`
- Modify: `app/components/mosaic/v4/engine/sizing.ts`
- Modify: `app/components/mosaic/v4/engine/compose.ts` (three `sizeTiles(` calls)
- Modify: `app/components/mosaic/v4/engine/types.ts`
- Modify: `app/components/mosaic/v4/settingsSchema.ts`
- Test: `app/components/mosaic/v4/engine/sizing.test.ts`, `app/components/mosaic/v4/engine/realPool.test.ts`

**Interfaces:**
- Produces: `exitEdgeDeg(cfg: AxisConfig, feed: 'sunrise' | 'sunset'): number`; `exitTaper(altDeg: number | null, cfg: V4Config, feed): number` in `[0,1]`; `sizeTiles(tiles, cfg, feed)`; `V4Config.exitTaperDeg: number`.

- [ ] **Step 1: Write the failing tests**

Append to `app/components/mosaic/v4/engine/sizing.test.ts`:

```ts
describe('sizeTiles — the exit taper', () => {
  // Window -24..-2, taper 6 deg. Score 1 renders at the 500px ceiling
  // once the tile is 6 deg or more inside the window from its exit edge.
  const taperCfg = (over: Partial<V4Config> = {}) =>
    cfg({ axisNightEdgeDeg: -24, axisDayEdgeDeg: -2, exitTaperDeg: 6, ...over });
  const at = (alt: number | null, passes = true): TileInput => ({
    ...tile(1, passes, 1), sunAltitudeDeg: alt,
  });

  it('renders a sunset tile AT the night edge at exactly the floor', () => {
    const [t] = sizeTiles([at(-24)], taperCfg(), 'sunset');
    expect(t.height).toBe(100);
  });

  it('renders a sunset tile past the night edge at the floor too', () => {
    const [t] = sizeTiles([at(-30)], taperCfg(), 'sunset');
    expect(t.height).toBe(100);
  });

  it('renders a sunset tile one taper inside the edge at its score height', () => {
    const [t] = sizeTiles([at(-18)], taperCfg(), 'sunset');
    expect(t.height).toBe(500);
  });

  it('renders halfway through the taper halfway between (smoothstep)', () => {
    const [t] = sizeTiles([at(-21)], taperCfg(), 'sunset');
    expect(t.height).toBeCloseTo(300, 6);
  });

  it('mirrors on the sunrise panel: the DAY edge is the exit', () => {
    const [atDay] = sizeTiles([at(-2)], taperCfg(), 'sunrise');
    const [inside] = sizeTiles([at(-8)], taperCfg(), 'sunrise');
    const [nightSide] = sizeTiles([at(-24)], taperCfg(), 'sunrise');
    expect(atDay.height).toBe(100);
    expect(inside.height).toBe(500);
    expect(nightSide.height).toBe(500);
  });

  it('is disabled by exitTaperDeg = 0', () => {
    const [t] = sizeTiles([at(-24)], taperCfg({ exitTaperDeg: 0 }), 'sunset');
    expect(t.height).toBe(500);
  });

  it('leaves gate-failers at the floor and null altitudes untouched', () => {
    const [failer] = sizeTiles([at(-18, false)], taperCfg(), 'sunset');
    const [unknown] = sizeTiles([at(null)], taperCfg(), 'sunset');
    expect(failer.height).toBe(100);
    expect(failer.pinnedToFloor).toBe(true);
    expect(unknown.height).toBe(500);
  });

  it('follows the width through the aspect ratio', () => {
    const [t] = sizeTiles([at(-24)], taperCfg(), 'sunset');
    expect(t.width).toBeCloseTo((100 * 400) / 300, 6);
  });
});
```

Update every existing `sizeTiles(...)` call in this test file to pass a feed: `sizeTiles([...], cfg(), 'sunset')`. Import `V4Config` and `TileInput` are already imported at the top of the file.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/components/mosaic/v4/engine/sizing.test.ts`
Expected: FAIL — `exitTaperDeg` is not a `V4Config` key (TS) and the taper cases return 500.

- [ ] **Step 3: Add the dial to types and schema**

`app/components/mosaic/v4/engine/types.ts`, inside `V4Config` after `scoreCeiling`:

```ts
  exitTaperDeg: number; // degrees inside the exit edge over which a passer shrinks to the floor; 0 disables
```

`app/components/mosaic/v4/settingsSchema.ts`, in the sizing section after `scoreCeiling`:

```ts
  {
    key: 'exitTaperDeg', kind: 'number', min: 0, max: 15, step: 0.5, default: 6,
    label: 'exit taper (deg)', section: 'sizing',
    description: 'Over the last few degrees before a camera leaves the window (the night edge on sunset, the day edge on sunrise) its tile eases from its score height down to the floor, so a sunset gets smaller as it ends instead of vanishing at full size. Uses the solar altitude the client already computes; no rating cadence involved. 0 disables.',
  },
```

and in `configFromSettings`:

```ts
    exitTaperDeg: values.exitTaperDeg as number,
```

- [ ] **Step 4: Implement the taper**

`app/components/mosaic/v4/engine/axis.ts`, append:

```ts
/**
 * The edge a camera leaves through. Altitude FALLS on the sunset panel, so
 * cameras leave at the night edge; it RISES on sunrise, so they leave at the
 * day edge. The other edge is where they arrive.
 */
export function exitEdgeDeg(cfg: AxisConfig, feed: 'sunrise' | 'sunset'): number {
  return feed === 'sunset' ? cfg.axisNightEdgeDeg : cfg.axisDayEdgeDeg;
}
```

`app/components/mosaic/v4/engine/sizing.ts`: add the import and the taper, and thread `feed` through `sizeTiles`:

```ts
import { exitEdgeDeg } from './axis';
import type { SizedTile, TileInput, V4Config } from './types';

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/**
 * Multiplier on a passer's score height in [0,1]: 0 at or past the exit
 * edge, 1 once the tile is exitTaperDeg or more inside the window. A sunset
 * therefore gets smaller as it ends and leaves from the floor, using the
 * altitude the loader already computes — the score, re-rated only while the
 * camera is still inside the sweep, would otherwise hold it at full size
 * until the pool dropped it (spec §2, §5).
 */
export function exitTaper(
  altDeg: number | null,
  cfg: V4Config,
  feed: 'sunrise' | 'sunset'
): number {
  if (cfg.exitTaperDeg <= 0 || altDeg === null) return 1;
  const edge = exitEdgeDeg(cfg, feed);
  // Angular distance INSIDE the window from the exit edge.
  const inside = feed === 'sunset' ? altDeg - edge : edge - altDeg;
  if (inside <= 0) return 0;
  if (inside >= cfg.exitTaperDeg) return 1;
  return smoothstep(inside / cfg.exitTaperDeg);
}
```

In `sizeTiles`, change the signature to
`export function sizeTiles(tiles: TileInput[], cfg: V4Config, feed: 'sunrise' | 'sunset'): SizedTile[]`
and the passer branch to:

```ts
      height = cfg.floorPx + span * unit * exitTaper(t.sunAltitudeDeg, cfg, feed);
```

Add to the function's doc comment: "The exit taper (`exitTaper`) multiplies the passer's spread above the floor; failers are already at the floor and never tapered."

`app/components/mosaic/v4/engine/compose.ts`: every `sizeTiles(candidates, cfg)` becomes `sizeTiles(candidates, cfg, feed)` (in `fits`, twice in `requiredScale`, twice in `compose`). The peer feed is sized as the peer feed: inside `compose`, the peer call already goes through `requiredScale(..., peerFeed, ...)`, which now sizes with `peerFeed`.

- [ ] **Step 5: Run the sizing tests**

Run: `npx vitest run app/components/mosaic/v4/engine/sizing.test.ts`
Expected: PASS.

- [ ] **Step 6: Re-pin the real-pool measurement**

Run: `npx vitest run app/components/mosaic/v4/engine`
Expected: only `realPool.test.ts` "records how dense the default dials actually leave the wall" may fail, because tapered tiles near the night edge are smaller and collide less. Read the new numbers from the failure output, update the four assertions, and extend the comment:

```ts
    // v4 adds the exit taper (2026-09-03): tiles within 6 deg of the night
    // edge shrink toward the floor, so they collide less and eviction admits
    // more. Numbers re-pinned from the run, not predicted.
```

If the numbers did not change, add the comment anyway stating that the taper touched no tile on this fixture at these dials. Run the folder again: all green.

- [ ] **Step 7: Commit and push**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-mosaic-v4
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/mosaic-v4" ] && \
  git add app/components/mosaic/v4/engine app/components/mosaic/v4/settingsSchema.ts && \
  git commit -m "feat(mosaic/v4): exit taper — a sunset shrinks to the floor as it ends

Score is re-rated only while a camera is inside the sweep, so a departing
tile used to sit at the panel edge at full size for the whole retention
grace and then vanish. Height now eases to the floor over the last
exitTaperDeg (default 6) before the exit edge: night edge on sunset,
day edge on sunrise.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018a9bbcpGGuhq6Y6cdJQhYE"
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/mosaic-v4
git rev-parse HEAD origin/feat/mosaic-v4
```

---

### Task 3: The v4 motion layer

**Files:**
- Rewrite: `app/components/mosaic/v4/motion.ts`
- Rewrite: `app/components/mosaic/v4/motion.test.ts`
- Modify: `app/components/mosaic/v4/settingsSchema.ts` (motion section, `motionFromSettings`)
- Modify: `app/components/mosaic/v4/MosaicCanvas.tsx` (one line: `commit` now returns a map; ignore it for now) and `MosaicCanvas.test.tsx` (the `CUT` fixture gains the new fields)

**Interfaces:**
- Produces (Task 4 depends on these exact names):
  ```ts
  export type StaggerOrder = 'none' | 'scatter' | 'latitude' | 'sweep' | 'magnitude';
  export type TransitionStyle = 'fadeThrough' | 'dissolve';
  export interface MotionConfig {
    mode: MotionMode; order: StaggerOrder; durationMs: number; spreadMs: number;
    waveGridMs: number; transition: TransitionStyle; fadeMs: number; fadeScale: number; gapPx: number;
  }
  export function scatterKey(id: number): number;               // [0,1), deterministic
  export function commit(state, targets, cfg, now, ctx): Map<number, number>; // id -> delay ms
  export function sample(state, now, dtMs, cfg): MotionFrame[]; // frames with opacity > 0 only
  export function isSettled(state, cfg, now): boolean;         // nothing animating RIGHT NOW
  export function nextEventAt(state, now): number | null;      // earliest future start, or null
  ```

- [ ] **Step 1: Write the new test file**

Replace `app/components/mosaic/v4/motion.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import {
  createMotionState,
  commit,
  sample,
  staggerKeys,
  scatterKey,
  isSettled,
  nextEventAt,
  type MotionConfig,
  type MotionTarget,
} from './motion';

const CFG: MotionConfig = {
  mode: 'tween',
  order: 'none',
  durationMs: 1000,
  spreadMs: 0,
  waveGridMs: 0,
  transition: 'dissolve',
  fadeMs: 1000,
  fadeScale: 0.85,
  gapPx: 0,
};

const cfg = (over: Partial<MotionConfig> = {}): MotionConfig => ({ ...CFG, ...over });

const target = (id: number, over: Partial<MotionTarget> = {}): MotionTarget => ({
  id, x: 0, y: 0, width: 100, height: 75, lat: 45, ...over,
});

const CTX = { panelWidth: 1080, panelSlot: 0 as const };

const byId = <T extends { id: number }>(frames: T[]) =>
  new Map(frames.map((f) => [f.id, f] as const));

/** Run an entry to completion so a later commit is a retarget, not a mid-entry update. */
function settle(s: ReturnType<typeof createMotionState>, c: MotionConfig, now: number) {
  sample(s, now, 16, c);
}

describe('motion — entry and exit fades', () => {
  it('enters from fadeScale and transparent, then lands full size and opaque', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 200, y: 100 })], cfg(), 0, CTX);

    // Transparent frames are not drawn, so t=0 yields nothing.
    expect(sample(s, 0, 16, cfg())).toEqual([]);

    const mid = sample(s, 500, 16, cfg())[0];
    expect(mid.width).toBeGreaterThan(85);
    expect(mid.width).toBeLessThan(100);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);

    const done = sample(s, 1000, 16, cfg())[0];
    expect(done).toMatchObject({ x: 200, y: 100, width: 100, height: 75, opacity: 1 });
  });

  it('uses fadeMs for the entry, not durationMs', () => {
    const s = createMotionState();
    const c = cfg({ durationMs: 10, fadeMs: 2000 });
    commit(s, [target(1)], c, 0, CTX);
    expect(sample(s, 1000, 16, c)[0].opacity).toBeLessThan(1);
    expect(sample(s, 2000, 16, c)[0].opacity).toBe(1);
  });

  it('exits by shrinking about its centre to fadeScale while fading, then is forgotten', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 100, y: 100 }), target(2, { x: 400 })], cfg(), 0, CTX);
    settle(s, cfg(), 1000);

    commit(s, [target(2, { x: 400 })], cfg(), 1000, CTX);
    const mid = byId(sample(s, 1500, 16, cfg())).get(1)!;
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(mid.width).toBeLessThan(100);
    expect(mid.width).toBeGreaterThan(85);
    // Centre held: x + width/2 stays at 150.
    expect(mid.x + mid.width / 2).toBeCloseTo(150, 6);

    const after = byId(sample(s, 2000, 16, cfg()));
    expect(after.has(1)).toBe(false);
    expect(after.has(2)).toBe(true);
  });

  it('exits as a tween even in drift mode', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'drift', durationMs: 60_000 });
    commit(s, [target(1)], c, 0, CTX);
    settle(s, c, 1000);
    commit(s, [], c, 1000, CTX);
    // A 60s drift constant would barely move; the exit is done at fadeMs.
    expect(byId(sample(s, 2000, 16, c)).has(1)).toBe(false);
  });

  it('cancels an exit when the tile comes back', () => {
    const s = createMotionState();
    commit(s, [target(1)], cfg(), 0, CTX);
    settle(s, cfg(), 1000);
    commit(s, [], cfg(), 1000, CTX);
    sample(s, 1500, 16, cfg()); // half faded
    commit(s, [target(1)], cfg(), 1500, CTX);
    const back = sample(s, 2500, 16, cfg())[0];
    expect(back).toMatchObject({ width: 100, opacity: 1 });
  });
});

describe('motion — travel', () => {
  it('tweens a retarget between two layouts rather than jumping', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 0 })], cfg(), 0, CTX);
    settle(s, cfg(), 1000);

    commit(s, [target(1, { x: 400 })], cfg(), 1000, CTX);
    const mid = sample(s, 1500, 16, cfg())[0];
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(400);
    expect(sample(s, 2000, 16, cfg())[0].x).toBe(400);
  });

  it('cut lands on the target with no travel', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'cut' });
    commit(s, [target(1, { x: 300 })], c, 0, CTX);
    expect(sample(s, 0, 16, c)[0]).toMatchObject({ x: 300, width: 100, opacity: 1 });
  });

  it('drift closes most of the gap in one time constant and never overshoots', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'drift', durationMs: 1000 });
    commit(s, [target(1, { x: 0 })], c, 0, CTX);
    settle(s, c, 1000);

    commit(s, [target(1, { x: 1000 })], c, 1000, CTX);
    const step = sample(s, 1100, 100, c)[0];
    expect(step.x).toBeGreaterThan(0);
    expect(step.x).toBeLessThan(1000);
    const later = sample(s, 2000, 900, c)[0];
    expect(later.x).toBeGreaterThan(900);
    expect(later.x).toBeLessThanOrEqual(1000);
  });

  it('a retarget during an entry just redirects the entry', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 0 })], cfg(), 0, CTX);
    commit(s, [target(1, { x: 200 })], cfg(), 200, CTX);
    const done = sample(s, 1000, 16, cfg())[0];
    expect(done).toMatchObject({ x: 200, opacity: 1 });
  });
});

describe('scatter', () => {
  it('keys are deterministic, in [0,1), and differ across ids', () => {
    expect(scatterKey(1234)).toBe(scatterKey(1234));
    const keys = [1, 2, 3, 1000, 1001, 1002].map(scatterKey);
    for (const k of keys) {
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(1);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is the ordering staggerKeys uses for scatter', () => {
    const keys = staggerKeys([target(7), target(8)], createMotionState(), 'scatter', CTX);
    expect(keys.get(7)).toBe(scatterKey(7));
    expect(keys.get(8)).toBe(scatterKey(8));
  });

  it('none still gives every tile key 0', () => {
    const keys = staggerKeys([target(1), target(2)], createMotionState(), 'none', CTX);
    expect([...keys.values()]).toEqual([0, 0]);
  });
});

describe('spread — the delay every change waits', () => {
  it('reports each tile\'s delay as key × spreadMs', () => {
    const s = createMotionState();
    const c = cfg({ order: 'scatter', spreadMs: 60_000 });
    const delays = commit(s, [target(5)], c, 0, CTX);
    expect(delays.get(5)).toBeCloseTo(scatterKey(5) * 60_000, 6);
  });

  it('holds a retarget until its delay in drift mode — stagger is no longer inert there', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'drift', durationMs: 100, order: 'latitude', spreadMs: 2000 });
    commit(s, [target(1, { x: 0, lat: 60 }), target(2, { x: 0, lat: 10 })], c, 0, CTX);
    settle(s, c, 1000);

    // Tile 1 (north) has key 0, tile 2 key 1: its move waits 2000ms.
    commit(s, [target(1, { x: 500, lat: 60 }), target(2, { x: 500, lat: 10 })], c, 1000, CTX);
    const early = byId(sample(s, 1500, 500, c));
    expect(early.get(1)!.x).toBeGreaterThan(0);
    expect(early.get(2)!.x).toBe(0);
    const late = byId(sample(s, 3500, 500, c));
    expect(late.get(2)!.x).toBeGreaterThan(0);
  });

  it('delays an exit by the same rule, and freezes the tile until then', () => {
    const s = createMotionState();
    const c = cfg({ order: 'scatter', spreadMs: 100_000 });
    commit(s, [target(1), target(2, { x: 300 })], c, 0, CTX);
    settle(s, c, 100_000); // both entries long finished

    commit(s, [target(1)], c, 100_000, CTX);
    const delay = scatterKey(2) * 100_000;
    // Frozen and opaque right up to its moment...
    const before = byId(sample(s, 100_000 + delay - 1, 16, c)).get(2)!;
    expect(before).toMatchObject({ x: 300, width: 100, opacity: 1 });
    // ...fading after it, gone at its end.
    const during = byId(sample(s, 100_000 + delay + 500, 16, c)).get(2)!;
    expect(during.opacity).toBeLessThan(1);
    expect(byId(sample(s, 100_000 + delay + 1000, 16, c)).has(2)).toBe(false);
  });

  it('sweep still rounds the wave start onto the shared grid', () => {
    const a = createMotionState();
    const b = createMotionState();
    const c = cfg({ order: 'sweep', spreadMs: 0, waveGridMs: 1000 });
    commit(a, [target(1, { x: 0, width: 0 })], c, 1200, { panelWidth: 1080, panelSlot: 0 });
    commit(b, [target(2, { x: 0, width: 0 })], c, 1500, { panelWidth: 1080, panelSlot: 1 });
    expect(sample(a, 1900, 16, c)).toEqual([]);
    expect(sample(b, 1900, 16, c)).toEqual([]);
    expect(sample(a, 2100, 16, c)[0].opacity).toBeGreaterThan(0);
    expect(sample(b, 2100, 16, c)[0].opacity).toBeGreaterThan(0);
  });
});

describe('fade-through — two cameras never share pixels', () => {
  const FT = cfg({ transition: 'fadeThrough' });

  it('makes an entry wait for the departing tile it would overlap', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 100, y: 100 })], FT, 0, CTX);
    settle(s, FT, 1000);

    // Tile 2 arrives exactly where tile 1 is leaving.
    commit(s, [target(2, { x: 100, y: 100 })], FT, 1000, CTX);
    const mid = byId(sample(s, 1500, 16, FT));
    expect(mid.has(1)).toBe(true);
    expect(mid.has(2)).toBe(false);

    // Exit ends at 2000; entry runs 2000..3000.
    const later = byId(sample(s, 2500, 16, FT));
    expect(later.has(1)).toBe(false);
    expect(later.get(2)!.opacity).toBeGreaterThan(0);
    expect(later.get(2)!.opacity).toBeLessThan(1);
  });

  it('does not make an entry wait for a departure it would not touch', () => {
    const s = createMotionState();
    commit(s, [target(1, { x: 100, y: 100 })], FT, 0, CTX);
    settle(s, FT, 1000);
    commit(s, [target(2, { x: 800, y: 600 })], FT, 1000, CTX);
    const mid = byId(sample(s, 1500, 16, FT));
    expect(mid.has(1)).toBe(true);
    expect(mid.get(2)!.opacity).toBeGreaterThan(0);
  });

  it('counts the gap as overlap', () => {
    const s = createMotionState();
    const c = cfg({ transition: 'fadeThrough', gapPx: 10 });
    commit(s, [target(1, { x: 0, y: 0 })], c, 0, CTX);
    settle(s, c, 1000);
    // 5px clear of tile 1, inside the 10px gap.
    commit(s, [target(2, { x: 105, y: 0 })], c, 1000, CTX);
    expect(byId(sample(s, 1500, 16, c)).has(2)).toBe(false);
  });

  it('dissolve lets both run at once', () => {
    const s = createMotionState();
    const c = cfg({ transition: 'dissolve' });
    commit(s, [target(1, { x: 100, y: 100 })], c, 0, CTX);
    settle(s, c, 1000);
    commit(s, [target(2, { x: 100, y: 100 })], c, 1000, CTX);
    const mid = byId(sample(s, 1500, 16, c));
    expect(mid.has(1)).toBe(true);
    expect(mid.has(2)).toBe(true);
  });

  it('PROPERTY: over a whole replacement, no two drawn frames ever intersect', () => {
    const s = createMotionState();
    const c = cfg({ transition: 'fadeThrough', order: 'scatter', spreadMs: 700 });
    commit(s, [target(1, { x: 100, y: 100 }), target(3, { x: 100, y: 300 })], c, 0, CTX);
    settle(s, c, 1000);
    commit(s, [target(2, { x: 120, y: 110 }), target(4, { x: 90, y: 320 })], c, 1000, CTX);
    for (let now = 1000; now <= 6000; now += 16) {
      const frames = sample(s, now, 16, c);
      for (let i = 0; i < frames.length; i++) {
        for (let j = i + 1; j < frames.length; j++) {
          const a = frames[i], b = frames[j];
          const clear =
            a.x + a.width <= b.x || b.x + b.width <= a.x ||
            a.y + a.height <= b.y || b.y + b.height <= a.y;
          expect(`${now}: ${a.id} vs ${b.id} clear=${clear}`).toBe(`${now}: ${a.id} vs ${b.id} clear=true`);
        }
      }
    }
  });
});

describe('isSettled and nextEventAt', () => {
  it('is unsettled mid-fade and settled after it', () => {
    const s = createMotionState();
    commit(s, [target(1)], cfg(), 0, CTX);
    expect(isSettled(s, cfg(), 500)).toBe(false);
    sample(s, 1000, 16, cfg());
    expect(isSettled(s, cfg(), 1000)).toBe(true);
  });

  it('is settled while a change is still waiting for its delay, and knows when it starts', () => {
    const s = createMotionState();
    const c = cfg({ order: 'latitude', spreadMs: 5000 });
    commit(s, [target(1, { lat: 60 }), target(2, { lat: 10 })], c, 0, CTX);
    sample(s, 1000, 16, c); // tile 1 entered; tile 2 waits until 5000
    expect(isSettled(s, c, 1000)).toBe(true);
    expect(nextEventAt(s, 1000)).toBe(5000);
    expect(isSettled(s, c, 5500)).toBe(false);
  });

  it('reports no event when nothing is scheduled', () => {
    const s = createMotionState();
    commit(s, [target(1)], cfg(), 0, CTX);
    sample(s, 1000, 16, cfg());
    expect(nextEventAt(s, 1000)).toBeNull();
  });

  it('cut is always settled', () => {
    const s = createMotionState();
    const c = cfg({ mode: 'cut' });
    commit(s, [target(1)], c, 0, CTX);
    expect(isSettled(s, c, 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/components/mosaic/v4/motion.test.ts`
Expected: FAIL — `scatterKey`, `nextEventAt` not exported; `spreadMs` etc. unknown.

- [ ] **Step 3: Rewrite `motion.ts`**

Replace `app/components/mosaic/v4/motion.ts` with:

```ts
/**
 * The motion layer: geometry only.
 *
 * `compose()` stays a pure function from tiles to a target layout. This module
 * holds the part that layout has never had — memory. Each tile keeps a track
 * keyed by webcamId, and a track's current pose chases its target pose over
 * time instead of snapping to it.
 *
 * v4 adds three things on top of v3 (spec §6, §7):
 *   - every change waits its own delay, `key × spreadMs`, so the 60s poll has
 *     no signature; a retarget is held as `pending` until then, which is what
 *     makes stagger real in drift mode (v3's drift ignored startAt);
 *   - entries and exits are fades with their own duration and scale, and an
 *     exit is a tween in every mode;
 *   - under `fadeThrough`, an entry waits for any departing tile it would
 *     overlap, so two cameras' pixels are never drawn over each other.
 *
 * Image crossfades live in the canvas, not here. A track knows where a tile is
 * and how opaque it is; which frame is drawn into it is the canvas's business.
 */

export type MotionMode = 'cut' | 'tween' | 'drift';
export type StaggerOrder = 'none' | 'scatter' | 'latitude' | 'sweep' | 'magnitude';
export type TransitionStyle = 'fadeThrough' | 'dissolve';

export interface MotionConfig {
  mode: MotionMode;
  order: StaggerOrder;
  /** Travel time of a retarget, or the drift time constant. */
  durationMs: number;
  /** Spread between the first change to start and the last: delay = key × spread. */
  spreadMs: number;
  /**
   * Sweep phase quantum. The two panels are separate pages that commit at
   * different moments. Rounding the start up to a shared grid puts both on
   * the same wave without either knowing the other exists. Sweep only.
   */
  waveGridMs: number;
  /** fadeThrough: an entry waits for the departures it would overlap. */
  transition: TransitionStyle;
  /** Duration of an entry or exit fade. */
  fadeMs: number;
  /** A tile enters from, and exits to, this fraction of its size about its centre. */
  fadeScale: number;
  /** The composition's tile gap; counted as overlap for the fade-through test. */
  gapPx: number;
}

export interface MotionTarget {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lat: number;
}

export interface MotionFrame {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

interface Pose {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

type Phase = 'enter' | 'travel' | 'exit';

interface Track {
  id: number;
  lat: number;
  current: Pose;
  from: Pose;
  to: Pose;
  startAt: number;
  phase: Phase;
  /** A retarget waiting for its scheduled moment. */
  pending: { to: Pose; startAt: number } | null;
}

export interface MotionState {
  tracks: Map<number, Track>;
}

export interface CommitContext {
  /** Panel width in CSS px, used to place a tile along the sweep. */
  panelWidth: number;
  /** 0 for the sunrise panel, 1 for the sunset panel. */
  panelSlot: 0 | 1;
}

export function createMotionState(): MotionState {
  return { tracks: new Map() };
}

function poseOf(t: MotionTarget, opacity: number): Pose {
  return { x: t.x, y: t.y, width: t.width, height: t.height, opacity };
}

/** The pose scaled by k about its own centre. */
function scaled(p: Pose, k: number, opacity: number): Pose {
  const width = p.width * k;
  const height = p.height * k;
  return {
    x: p.x + (p.width - width) / 2,
    y: p.y + (p.height - height) / 2,
    width,
    height,
    opacity,
  };
}

/**
 * A stable phase in [0,1) for a webcam id. The same camera changes at the
 * same point in the minute on every refetch, every reload, and both panels.
 * An integer mix (murmur3's finaliser) rather than `id % n`, because ids
 * from one sweep are often consecutive and would march in order.
 */
export function scatterKey(id: number): number {
  let h = (id ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * A delay weight in [0,1] per tile. 0 changes first, 1 changes last.
 *
 * `scatter` is the default: it says nothing about the world, which is the
 * point — it is the ordering with no visible tick. `sweep` says something
 * true (the terminator really does travel across the wall, and the key spans
 * both panels rather than restarting on each). `latitude` and `magnitude`
 * are arbitrary, kept because they are worth looking at.
 */
export function staggerKeys(
  targets: MotionTarget[],
  state: MotionState,
  order: StaggerOrder,
  ctx: CommitContext
): Map<number, number> {
  const keys = new Map<number, number>();
  if (targets.length === 0) return keys;

  if (order === 'none') {
    for (const t of targets) keys.set(t.id, 0);
    return keys;
  }

  if (order === 'scatter') {
    for (const t of targets) keys.set(t.id, scatterKey(t.id));
    return keys;
  }

  if (order === 'latitude') {
    const lats = targets.map((t) => t.lat);
    const north = Math.max(...lats);
    const south = Math.min(...lats);
    const span = north - south;
    for (const t of targets) {
      keys.set(t.id, span === 0 ? 0 : (north - t.lat) / span);
    }
    return keys;
  }

  if (order === 'sweep') {
    for (const t of targets) {
      const local = ctx.panelWidth === 0 ? 0 : (t.x + t.width / 2) / ctx.panelWidth;
      const clamped = local < 0 ? 0 : local > 1 ? 1 : local;
      keys.set(t.id, (ctx.panelSlot + clamped) / 2);
    }
    return keys;
  }

  // magnitude: whichever tile has furthest to travel leads.
  let widest = 0;
  const deltas = new Map<number, number>();
  for (const t of targets) {
    const track = state.tracks.get(t.id);
    const d = track
      ? Math.hypot(t.x - track.current.x, t.y - track.current.y) +
        Math.abs(t.width - track.current.width)
      : Infinity;
    const finite = Number.isFinite(d) ? d : 0;
    deltas.set(t.id, finite);
    if (finite > widest) widest = finite;
  }
  for (const t of targets) {
    keys.set(t.id, widest === 0 ? 0 : 1 - (deltas.get(t.id) as number) / widest);
  }
  return keys;
}

function intersects(a: Pose, b: Pose, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

const fadeEnd = (track: Track, cfg: MotionConfig): number => track.startAt + cfg.fadeMs;

/**
 * Point every track at a new layout. Does not move anything; `sample` does.
 * Returns each tile's delay (ms after `now`) so the canvas can schedule its
 * frame crossfades from the same clock.
 */
export function commit(
  state: MotionState,
  targets: MotionTarget[],
  cfg: MotionConfig,
  now: number,
  ctx: CommitContext
): Map<number, number> {
  const seen = new Set(targets.map((t) => t.id));

  // Departures are keyed alongside the arrivals so every ordering places
  // them in the same wave.
  const departing: MotionTarget[] = [];
  for (const track of state.tracks.values()) {
    if (seen.has(track.id) || track.phase === 'exit') continue;
    const { x, y, width, height } = track.current;
    departing.push({ id: track.id, lat: track.lat, x, y, width, height });
  }

  const keys = staggerKeys([...targets, ...departing], state, cfg.order, ctx);
  const waveStart =
    cfg.order === 'sweep' && cfg.waveGridMs > 0
      ? Math.ceil(now / cfg.waveGridMs) * cfg.waveGridMs
      : now;
  const delays = new Map<number, number>();
  const startFor = (id: number): number => {
    const delay = cfg.spreadMs * (keys.get(id) ?? 0);
    delays.set(id, waveStart - now + delay);
    return waveStart + delay;
  };

  // Exits first: entries need to know when their pixels free up.
  for (const d of departing) {
    const track = state.tracks.get(d.id) as Track;
    track.pending = null;
    track.phase = 'exit';
    track.from = { ...track.current };
    track.to = scaled(track.current, cfg.fadeScale, 0);
    track.startAt = startFor(d.id);
  }

  for (const t of targets) {
    const arrival = poseOf(t, 1);
    const start = startFor(t.id);
    const track = state.tracks.get(t.id);

    if (!track) {
      let startAt = start;
      if (cfg.transition === 'fadeThrough') {
        for (const other of state.tracks.values()) {
          if (other.phase === 'exit' && intersects(other.from, arrival, cfg.gapPx)) {
            startAt = Math.max(startAt, fadeEnd(other, cfg));
          }
        }
      }
      const origin = scaled(arrival, cfg.fadeScale, 0);
      state.tracks.set(t.id, {
        id: t.id,
        lat: t.lat,
        current: { ...origin },
        from: origin,
        to: arrival,
        startAt,
        phase: 'enter',
        pending: null,
      });
      continue;
    }

    track.lat = t.lat;
    if (track.phase === 'exit') {
      // Back before it was gone: come home from wherever it got to.
      track.phase = 'enter';
      track.from = { ...track.current };
      track.to = arrival;
      track.startAt = start;
      track.pending = null;
    } else if (track.phase === 'enter' && now < fadeEnd(track, cfg)) {
      // Still arriving: the fade continues, toward the updated place.
      track.to = arrival;
    } else {
      track.pending = { to: arrival, startAt: start };
    }
  }

  return delays;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function spanOf(track: Track, cfg: MotionConfig): number {
  return Math.max(1, track.phase === 'travel' ? cfg.durationMs : cfg.fadeMs);
}

/**
 * Advance every track and return what to draw. Frames at opacity 0 — an
 * entry still waiting for its moment — are not returned, so the canvas
 * neither paints nor hit-tests them. Exits are dropped once they have ended.
 */
export function sample(
  state: MotionState,
  now: number,
  dtMs: number,
  cfg: MotionConfig
): MotionFrame[] {
  const frames: MotionFrame[] = [];
  const finished: number[] = [];

  for (const track of state.tracks.values()) {
    if (track.pending && now >= track.pending.startAt) {
      track.from = { ...track.current };
      track.to = track.pending.to;
      track.startAt = track.pending.startAt;
      track.phase = 'travel';
      track.pending = null;
    }

    const { from, to, current } = track;

    if (cfg.mode === 'cut') {
      Object.assign(current, to);
    } else if (cfg.mode === 'drift' && track.phase === 'travel') {
      // Exponential chase: reaches 99.9% of the way in durationMs. A long time
      // constant turns the 60s poll steps into movement too slow to catch.
      const tau = Math.max(16, cfg.durationMs);
      const k = 1 - Math.pow(0.001, Math.max(0, dtMs) / tau);
      current.x = lerp(current.x, to.x, k);
      current.y = lerp(current.y, to.y, k);
      current.width = lerp(current.width, to.width, k);
      current.height = lerp(current.height, to.height, k);
      current.opacity = lerp(current.opacity, to.opacity, k);
    } else {
      const raw = (now - track.startAt) / spanOf(track, cfg);
      const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      const e = easeInOutCubic(p);
      current.x = lerp(from.x, to.x, e);
      current.y = lerp(from.y, to.y, e);
      current.width = lerp(from.width, to.width, e);
      current.height = lerp(from.height, to.height, e);
      current.opacity = lerp(from.opacity, to.opacity, e);
    }

    if (track.phase === 'exit' && (cfg.mode === 'cut' || now >= fadeEnd(track, cfg))) {
      finished.push(track.id);
      continue;
    }
    if (current.opacity <= 0) continue;

    frames.push({
      id: track.id,
      x: current.x,
      y: current.y,
      width: current.width,
      height: current.height,
      opacity: current.opacity,
    });
  }

  for (const id of finished) state.tracks.delete(id);
  return frames;
}

function driftClose(track: Track): boolean {
  const { current, to } = track;
  return (
    Math.abs(current.x - to.x) <= 0.25 &&
    Math.abs(current.y - to.y) <= 0.25 &&
    Math.abs(current.width - to.width) <= 0.25 &&
    Math.abs(current.opacity - to.opacity) <= 0.01
  );
}

/**
 * True when nothing is moving RIGHT NOW. A change still waiting for its
 * delay counts as settled — `nextEventAt` says when to wake for it — so
 * the render loop parks between scheduled changes instead of spinning.
 */
export function isSettled(state: MotionState, cfg: MotionConfig, now: number): boolean {
  // cut lands on the target the moment it is sampled, so one draw is always
  // enough — which is what keeps the render loop parked on a still wall.
  if (cfg.mode === 'cut') return true;
  for (const track of state.tracks.values()) {
    if (track.pending) {
      if (now >= track.pending.startAt) return false;
      continue;
    }
    if (cfg.mode === 'drift' && track.phase === 'travel') {
      if (!driftClose(track)) return false;
      continue;
    }
    if (now >= track.startAt && now < track.startAt + spanOf(track, cfg)) return false;
  }
  return true;
}

/** The earliest scheduled start still in the future, or null. */
export function nextEventAt(state: MotionState, now: number): number | null {
  let next: number | null = null;
  const consider = (at: number) => {
    if (at > now && (next === null || at < next)) next = at;
  };
  for (const track of state.tracks.values()) {
    if (track.pending) consider(track.pending.startAt);
    else if (track.phase !== 'travel') consider(track.startAt);
  }
  return next;
}
```

- [ ] **Step 4: Update the schema's motion section and `motionFromSettings`**

In `app/components/mosaic/v4/settingsSchema.ts`, replace the `motionOrder` and `motionStaggerMs` knobs and add three, so the motion section reads (in this order: `motionMode`, `motionOrder`, `changeSpreadMs`, `transitionStyle`, `fadeMs`, `fadeScale`, `motionDurationMs`, `crossfadeMs`, `waveGridMs`):

```ts
  {
    key: 'motionOrder', kind: 'enum',
    options: ['scatter', 'none', 'latitude', 'sweep', 'magnitude'] as const, default: 'scatter',
    label: 'change order', section: 'motion',
    description: 'Which tile changes first within the spread. scatter gives each camera a fixed random point in the minute, so nothing on the wall betrays the poll. sweep runs one wave across both panels in the direction the terminator travels. none changes everything at once, which is the cron tell. latitude and magnitude are arbitrary orderings kept for comparison.',
  },
  {
    key: 'changeSpreadMs', kind: 'number', min: 0, max: 120_000, step: 1_000, default: 60_000,
    label: 'change spread (ms)', section: 'motion',
    description: 'Spread between the first change and the last after each poll: every move, arrival, departure and frame crossfade waits its own share of this. At 60000, the poll interval, change arrives as a steady trickle. 0 restores v3 timing exactly, everything at once on the minute.',
  },
  {
    key: 'transitionStyle', kind: 'enum',
    options: ['fadeThrough', 'dissolve'] as const, default: 'fadeThrough',
    label: 'transition', section: 'motion',
    description: 'fadeThrough: a departing tile fades fully to black before anything arrives in its pixels, so two cameras are never drawn over each other. dissolve: the departure and the arrival run at once, one picture through another. Compare with ?transitionStyle=dissolve beside the default.',
  },
  {
    key: 'fadeMs', kind: 'number', min: 0, max: 60_000, step: 500, default: 20_000,
    label: 'fade (ms)', section: 'motion',
    description: 'How long an arrival fades in and a departure fades out. A replacement under fadeThrough takes twice this. Separate from travel: this is about appearing and leaving, not moving.',
  },
  {
    key: 'fadeScale', kind: 'number', min: 0.3, max: 1, step: 0.05, default: 0.85,
    label: 'fade scale', section: 'motion',
    description: 'A tile fades in from, and out to, this fraction of its size about its own centre. 1 is a pure fade; smaller reads as arriving and receding.',
  },
```

Rewrite `motionDurationMs`'s description: `'How long a tile that STAYS takes to reach a new place or size. In drift mode this is the time constant instead: the wall closes 99.9% of the gap in this long, so a big number is what makes the movement too slow to catch. Arrivals and departures use fade (ms), not this.'`

Replace `motionFromSettings`:

```ts
/**
 * The motion dials, kept out of V4Config on purpose: the composition engine
 * decides where a tile belongs and has no business knowing how it gets there.
 * `tileGapPx` crosses over because the fade-through overlap test must agree
 * with the engine's about what "touching" means.
 */
export function motionFromSettings(values: SettingsValues): {
  motion: MotionConfig;
  crossfadeMs: number;
} {
  return {
    motion: {
      mode: values.motionMode as MotionConfig['mode'],
      order: values.motionOrder as MotionConfig['order'],
      durationMs: values.motionDurationMs as number,
      spreadMs: values.changeSpreadMs as number,
      waveGridMs: values.waveGridMs as number,
      transition: values.transitionStyle as MotionConfig['transition'],
      fadeMs: values.fadeMs as number,
      fadeScale: values.fadeScale as number,
      gapPx: values.tileGapPx as number,
    },
    crossfadeMs: values.crossfadeMs as number,
  };
}
```

- [ ] **Step 5: Keep the canvas compiling**

In `app/components/mosaic/v4/MosaicCanvas.tsx` nothing needs to change for the return value (it was `void`; ignoring a returned map is fine). In `app/components/mosaic/v4/MosaicCanvas.test.tsx`, change the fixture:

```ts
const CUT: MotionConfig = {
  mode: 'cut', order: 'none', durationMs: 900, spreadMs: 0, waveGridMs: 0,
  transition: 'dissolve', fadeMs: 900, fadeScale: 0.85, gapPx: 0,
};
```

In `app/components/mosaic/v4/settingsSchema.test.ts`, search for `motionStaggerMs` and replace with `changeSpreadMs`; if a test pins the number of knobs or the motion defaults, update it to the new list.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run app/components/mosaic/v4`
Expected: PASS. If the fade-through property test fails, the cause is almost always the intersection test reading `other.current` (which shrinks) instead of `other.from` (the full pose): entries must wait on the pixels the departure OCCUPIED.

- [ ] **Step 7: Commit and push**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-mosaic-v4
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/mosaic-v4" ] && \
  git add app/components/mosaic/v4/motion.ts app/components/mosaic/v4/motion.test.ts \
          app/components/mosaic/v4/settingsSchema.ts app/components/mosaic/v4/settingsSchema.test.ts \
          app/components/mosaic/v4/MosaicCanvas.test.tsx && \
  git commit -m "feat(mosaic/v4): motion layer — scattered change, fade-through, real stagger in drift

Every change waits key x changeSpreadMs (default the 60s poll) so the
tick has no signature; retargets are held as pending until then, which
makes stagger act in drift mode for the first time. Entries and exits
are fades with their own duration and scale. Under fadeThrough an entry
waits for any departure it would overlap, so two cameras never share
pixels (property-tested). nextEventAt lets the canvas sleep between
scheduled changes instead of spinning.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018a9bbcpGGuhq6Y6cdJQhYE"
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/mosaic-v4
git rev-parse HEAD origin/feat/mosaic-v4
```

---

### Task 4: The canvas — scheduled crossfades, departures keep their frame, timer wake

**Files:**
- Modify: `app/components/mosaic/v4/MosaicCanvas.tsx`
- Test: `app/components/mosaic/v4/MosaicCanvas.test.tsx`

**Interfaces:**
- Consumes from Task 3: `commit` returning `Map<number, number>` of delays; `sample` omitting opacity-0 frames; `isSettled`; `nextEventAt`.

Background a fresh implementer needs: the canvas keeps a `fadesRef` map, one entry per tile, holding the image currently drawn (`current`), the one it is fading up over (`prev`), and when that started. v3 deleted a tile's entry the moment the tile left `byId`, and drew nothing for a tile with no entry — so **v3's exit fade was never visible; departures popped.** v4 keeps the entry while the motion layer is still returning a frame for that tile.

- [ ] **Step 1: Write the failing tests**

Add a `base` argument to `stubRaf` so a test can choose the timestamps the loop sees:

```ts
function stubRaf(maxFrames = 4, base = 1000) {
  let n = 0;
  let total = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    if (n >= maxFrames) return 0;
    n += 1;
    total += 1;
    cb(base + total * 16);
    return n;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return {
    count: () => total,
    /** Hand the loop a fresh budget, e.g. after a rerender. */
    reset: () => { n = 0; },
  };
}
```

Two existing tests need the clocks reconciled, because v4 no longer draws a tile at opacity 0 (v3 drew it with `globalAlpha` 0, which is why they passed):

- In `afterEach`, add `vi.useRealTimers();` before `vi.restoreAllMocks()`.
- In "moves a tile toward its new place instead of jumping there": pin the effect's clock and give the second phase a later loop clock —

```ts
  it('moves a tile toward its new place instead of jumping there', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const raf = stubRaf(2, 1000);
    const ctx = stubContext();
    const img = {} as HTMLImageElement;
    const tween: MotionConfig = { ...CUT, mode: 'tween', durationMs: 5_000 };

    const { rerender } = render(
      <MosaicCanvas
        layout={layout(0)} byId={byId(img)} width={300} height={500}
        motion={tween} crossfadeMs={0} panelSlot={0}
      />
    );
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();
    // The entry (fadeMs 900) is over by now; the retarget below is travel.
    now.mockReturnValue(2000);
    stubRaf(2, 2000);
    void raf;

    rerender(
      <MosaicCanvas
        layout={layout(250)} byId={byId(img)} width={300} height={500}
        motion={tween} crossfadeMs={0} panelSlot={0}
      />
    );

    const xs = (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(250);
  });
```

Append a describe block:

```ts
/**
 * v4: change is scheduled, not immediate. The effect stamps each new frame
 * with `now + delay` from the motion layer; the draw loop promotes it when
 * the loop's clock reaches that stamp. performance.now() is pinned at 0 in
 * these tests so the effect's clock and the stubbed rAF clock agree.
 */
describe('MosaicCanvas — scheduled change', () => {
  // sweep on panel slot 1: the tile at x=10,w=100 on a 300px panel has
  // key (1 + 0.2) / 2 = 0.6, so with a 10s spread its delay is 6000ms.
  const SWEEP: MotionConfig = { ...CUT, order: 'sweep', spreadMs: 10_000 };
  const drawn = (ctx: CanvasRenderingContext2D) =>
    (ctx.drawImage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);

  it('does not begin a frame crossfade before its delay', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    stubRaf(4, 1000); // loop clock well before 6000
    const ctx = stubContext();
    const oldImg = { id: 'old' } as unknown as HTMLImageElement;
    const newImg = { id: 'new' } as unknown as HTMLImageElement;

    const { rerender } = render(
      <MosaicCanvas layout={layout()} byId={byId(oldImg)} width={300} height={500}
                    motion={SWEEP} crossfadeMs={0} panelSlot={1} />
    );
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();
    rerender(
      <MosaicCanvas layout={layout()} byId={byId(newImg)} width={300} height={500}
                    motion={SWEEP} crossfadeMs={0} panelSlot={1} />
    );
    expect(drawn(ctx)).toContain(oldImg);
    expect(drawn(ctx)).not.toContain(newImg);
  });

  it('a newer frame arriving before the pending one begins replaces it', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    stubRaf(4, 1000);
    const ctx = stubContext();
    const oldImg = { id: 'old' } as unknown as HTMLImageElement;
    const newImg = { id: 'new' } as unknown as HTMLImageElement;
    const third = { id: 'third' } as unknown as HTMLImageElement;

    const { rerender } = render(
      <MosaicCanvas layout={layout()} byId={byId(oldImg)} width={300} height={500}
                    motion={SWEEP} crossfadeMs={0} panelSlot={1} />
    );
    rerender(
      <MosaicCanvas layout={layout()} byId={byId(newImg)} width={300} height={500}
                    motion={SWEEP} crossfadeMs={0} panelSlot={1} />
    );
    // Now let the loop's clock pass the 6000ms stamp.
    stubRaf(4, 6000);
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();
    rerender(
      <MosaicCanvas layout={layout()} byId={byId(third)} width={300} height={500}
                    motion={SWEEP} crossfadeMs={0} panelSlot={1} />
    );
    expect(drawn(ctx)).toContain(third);
    expect(drawn(ctx)).not.toContain(newImg);
  });

  it('applies a zero-delay frame at once, exactly as v3 did', () => {
    stubRaf();
    const ctx = stubContext();
    const oldImg = { id: 'old' } as unknown as HTMLImageElement;
    const newImg = { id: 'new' } as unknown as HTMLImageElement;
    const { rerender } = render(
      <MosaicCanvas layout={layout()} byId={byId(oldImg)} width={300} height={500}
                    motion={CUT} crossfadeMs={0} panelSlot={0} />
    );
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();
    rerender(
      <MosaicCanvas layout={layout()} byId={byId(newImg)} width={300} height={500}
                    motion={CUT} crossfadeMs={0} panelSlot={0} />
    );
    expect(drawn(ctx)).toContain(newImg);
  });

  it('keeps drawing a departed tile\'s last frame while it fades out', () => {
    // v3 forgot the image the moment the tile left byId, so its exit fade
    // drew nothing and departures popped.
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const raf = stubRaf(2, 1000);
    const ctx = stubContext();
    const img = { id: 'last' } as unknown as HTMLImageElement;
    const tween: MotionConfig = { ...CUT, mode: 'tween', fadeMs: 5_000 };
    const empty: Layout = { ...layout(), tiles: [] };

    const { rerender } = render(
      <MosaicCanvas layout={layout()} byId={byId(img)} width={300} height={500}
                    motion={tween} crossfadeMs={0} panelSlot={0} />
    );
    (ctx.drawImage as ReturnType<typeof vi.fn>).mockClear();
    raf.reset();
    rerender(
      <MosaicCanvas layout={empty} byId={new Map()} width={300} height={500}
                    motion={tween} crossfadeMs={0} panelSlot={0} />
    );
    expect(drawn(ctx)).toContain(img);
  });

  it('sleeps on a timer until the next scheduled change instead of spinning', () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const raf = stubRaf(8, 1000);
    stubContext();
    const tween: MotionConfig = { ...CUT, mode: 'tween', order: 'sweep', spreadMs: 10_000, fadeMs: 100 };

    // Entry for the tile is scheduled at 6000ms; nothing to draw until then.
    render(
      <MosaicCanvas layout={layout()} byId={byId({} as HTMLImageElement)} width={300} height={500}
                    motion={tween} crossfadeMs={0} panelSlot={1} />
    );
    const before = raf.count();
    expect(before).toBeLessThanOrEqual(2);
    expect(vi.getTimerCount()).toBe(1);
    vi.useRealTimers();
  });
});
```

Also import `Layout` at the top if not already (it is).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/components/mosaic/v4/MosaicCanvas.test.tsx`
Expected: the new block fails (new frames drawn immediately; departed tile not drawn; no timer).

- [ ] **Step 3: Implement**

In `app/components/mosaic/v4/MosaicCanvas.tsx`:

Imports: add `nextEventAt` to the `./motion` import.

Replace the `fadesRef` declaration:

```ts
  // Per-tile image crossfade. Geometry lives in the motion layer; which frame
  // is drawn into that geometry is this component's business. `pending` is a
  // frame that has arrived but whose scheduled moment has not: the old one
  // keeps drawing until then, and a newer arrival replaces it (spec §7.3).
  const fadesRef = useRef(
    new Map<
      number,
      {
        prev: HTMLImageElement | null;
        current: HTMLImageElement;
        startedAt: number;
        pending: { img: HTMLImageElement; at: number } | null;
      }
    >()
  );
  const wakeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Replace the body of `draw` from `const frames = sample(...)` down to the end of the loop-continuation decision:

```ts
      const frames = sample(stateRef.current, now, dt, p.motion);

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, p.width, p.height);

      const hits: HitRect[] = [];
      const live = new Set<number>();
      for (const frame of frames) {
        live.add(frame.id);
        const entry = p.byId.get(frame.id);
        const fade = fadesRef.current.get(frame.id);
        if (fade?.pending && now >= fade.pending.at) {
          fade.prev = fade.current;
          fade.current = fade.pending.img;
          fade.startedAt = fade.pending.at;
          fade.pending = null;
        }
        // A departed tile has no entry; its last frame lives in `fade`.
        const image = fade?.current ?? entry?.img;
        if (!image) continue;

        const base = Math.max(0, Math.min(1, frame.opacity));
        // A tile whose frame just changed shows the old one underneath until
        // the new one has faded up over it.
        if (fade?.prev) {
          const t = p.crossfadeMs <= 0 ? 1 : (now - fade.startedAt) / p.crossfadeMs;
          if (t >= 1) {
            fade.prev = null;
          } else {
            ctx.globalAlpha = base;
            ctx.drawImage(fade.prev, frame.x, frame.y, frame.width, frame.height);
            ctx.globalAlpha = base * Math.max(0, t);
          }
        } else {
          ctx.globalAlpha = base;
        }

        ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height);
        ctx.globalAlpha = 1;

        if (entry) {
          hits.push({
            x: frame.x, y: frame.y, w: frame.width, h: frame.height, webcam: entry.webcam,
          });
        }
      }
      hitRectsRef.current = hits;

      // Forget a tile's frames only once it is neither drawn nor in the pool.
      for (const id of [...fadesRef.current.keys()]) {
        if (!live.has(id) && !p.byId.has(id)) fadesRef.current.delete(id);
      }

      const fading = [...fadesRef.current.values()].some(
        (f) => f.prev && now - f.startedAt < p.crossfadeMs
      );
      if (!isSettled(stateRef.current, p.motion, now) || fading) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Nothing moving now. If something is scheduled, sleep until it is due
      // rather than holding a rAF loop open across the whole spread.
      let next = nextEventAt(stateRef.current, now);
      for (const f of fadesRef.current.values()) {
        if (f.pending && (next === null || f.pending.at < next)) next = f.pending.at;
      }
      if (next !== null && wakeRef.current === null) {
        wakeRef.current = setTimeout(() => {
          wakeRef.current = null;
          if (rafRef.current === null) rafRef.current = requestAnimationFrame(draw);
        }, Math.max(0, next - now));
      }
    };
```

Replace the effect body after `const now = ...`:

```ts
    // Hand the new geometry to the motion layer first: its delays schedule
    // the frame crossfades below, so both change on one clock.
    const delays = commit(
      stateRef.current,
      layout.tiles.map((t) => ({
        id: t.id, x: t.x, y: t.y, width: t.width, height: t.height, lat: t.lat,
      })),
      p.motion,
      now,
      { panelWidth: p.width, panelSlot: p.panelSlot }
    );

    for (const [id, entry] of p.byId) {
      const fade = fadesRef.current.get(id);
      if (!fade) {
        fadesRef.current.set(id, { prev: null, current: entry.img, startedAt: now, pending: null });
        continue;
      }
      if (fade.current === entry.img || fade.pending?.img === entry.img) continue;
      const delay = delays.get(id) ?? 0;
      if (delay <= 0) {
        // v3 behaviour, kept exact for changeSpreadMs = 0.
        fade.prev = fade.current;
        fade.current = entry.img;
        fade.startedAt = now;
        fade.pending = null;
      } else {
        fade.pending = { img: entry.img, at: now + delay };
      }
    }

    if (wakeRef.current !== null) {
      clearTimeout(wakeRef.current);
      wakeRef.current = null;
    }
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (wakeRef.current !== null) clearTimeout(wakeRef.current);
      wakeRef.current = null;
    };
```

Update the component's doc comment: replace the last paragraph with

```
 * The render loop parks itself whenever every track has settled and no frame
 * is mid-crossfade. v4 schedules change across the poll interval, so between
 * scheduled moments the loop sleeps on a timer rather than spinning; a still
 * wall still costs nothing.
```

- [ ] **Step 4: Run the canvas tests**

Run: `npx vitest run app/components/mosaic/v4/MosaicCanvas.test.tsx`
Expected: PASS, including the five pre-existing tests. If "parks the render loop once nothing is moving" now counts 2 frames instead of 1, the entry in CUT mode is being sampled twice; check that `sample` in cut mode assigns `current = to` before the settled check, and that `isSettled` returns true for cut.

- [ ] **Step 5: Commit and push**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-mosaic-v4
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/mosaic-v4" ] && \
  git add app/components/mosaic/v4/MosaicCanvas.tsx app/components/mosaic/v4/MosaicCanvas.test.tsx && \
  git commit -m "feat(mosaic/v4): canvas schedules crossfades, keeps a departing tile's frame, sleeps between changes

Frame crossfades now wait the same per-tile delay as geometry, so a
poll no longer flips every changed camera in one instant. A tile that
has left the pool keeps its last frame for the exit fade — v3 forgot it
immediately, so its exits were never drawn and departures popped. When
nothing is moving the loop sleeps on a timer until the next scheduled
change instead of holding rAF open across the spread.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018a9bbcpGGuhq6Y6cdJQhYE"
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/mosaic-v4
git rev-parse HEAD origin/feat/mosaic-v4
```

---

### Task 5: Miss grace in the loader, `held` on the setup overlay

**Files:**
- Modify: `app/components/mosaic/v4/useLoadedTiles.ts`
- Modify: `app/components/mosaic/v4/overlays/SetupOverlay.tsx`
- Modify: `app/components/mosaic/v4/index.tsx`
- Modify: `app/components/mosaic/v4/engine/types.ts`, `app/components/mosaic/v4/settingsSchema.ts`
- Test: `app/components/mosaic/v4/useLoadedTiles.test.ts`, `app/components/mosaic/v4/overlays/overlays.test.tsx`

**Interfaces:**
- Produces: `LoadTilesOptions.missGraceCycles?: number` (default 0); `LoadedTilesResult.held: number`; `SetupOverlay` prop `held?: number`; `V4Config.missGraceCycles: number`.

- [ ] **Step 1: Write the failing loader tests**

Append to `app/components/mosaic/v4/useLoadedTiles.test.ts`:

```ts
describe('useLoadedTiles — miss grace', () => {
  // Load both cameras, then hand the hook a pool without camera 1.
  async function loadThenDrop(graceCycles: number) {
    const hook = renderHook(
      ({ cams, at }) => useLoadedTiles(cams, { ...opts, missGraceCycles: graceCycles, at }),
      { initialProps: { cams: [cam(1, 'https://x/a.jpg'), cam(2, 'https://x/b.jpg')], at: '2026-03-20T12:00:00Z' } }
    );
    await waitFor(() => expect(created).toHaveLength(2));
    created[0].onload?.();
    created[1].onload?.();
    await waitFor(() => expect(hook.result.current.tiles).toHaveLength(2));
    return hook;
  }

  /** One refetch cycle without camera 1; camera 2 loads. */
  async function cycleWithout1(hook: Awaited<ReturnType<typeof loadThenDrop>>, at: string) {
    const before = created.length;
    hook.rerender({ cams: [cam(2, 'https://x/b.jpg')], at });
    await waitFor(() => expect(created).toHaveLength(before + 1));
    created[before].onload?.();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
  }

  it('holds a camera missing from one cycle, with a FRESH solar altitude', async () => {
    const hook = await loadThenDrop(2);
    const altBefore = hook.result.current.tiles.find((t) => t.id === 1)!.sunAltitudeDeg;

    await cycleWithout1(hook, '2026-03-20T18:00:00Z');
    const ids = hook.result.current.tiles.map((t) => t.id).sort();
    expect(ids).toEqual([1, 2]);
    expect(hook.result.current.held).toBe(1);
    expect(hook.result.current.byId.get(1)).toBeDefined();
    const altAfter = hook.result.current.tiles.find((t) => t.id === 1)!.sunAltitudeDeg;
    expect(altAfter).not.toBe(altBefore);
  });

  it('drops the camera once it has missed more than missGraceCycles cycles', async () => {
    const hook = await loadThenDrop(2);
    await cycleWithout1(hook, '2026-03-20T12:01:00Z');
    await cycleWithout1(hook, '2026-03-20T12:02:00Z');
    expect(hook.result.current.tiles.map((t) => t.id).sort()).toEqual([1, 2]);
    await cycleWithout1(hook, '2026-03-20T12:03:00Z');
    expect(hook.result.current.tiles.map((t) => t.id)).toEqual([2]);
    expect(hook.result.current.held).toBe(0);
    expect(hook.result.current.byId.get(1)).toBeUndefined();
  });

  it('resets the count when the camera comes back', async () => {
    const hook = await loadThenDrop(1);
    await cycleWithout1(hook, '2026-03-20T12:01:00Z');
    // Back for one cycle.
    const before = created.length;
    hook.rerender({ cams: [cam(1, 'https://x/a.jpg'), cam(2, 'https://x/b.jpg')], at: '2026-03-20T12:02:00Z' });
    await waitFor(() => expect(created).toHaveLength(before + 2));
    created[before].onload?.();
    created[before + 1].onload?.();
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.held).toBe(0);
    // Gone again: held, not dropped — the earlier miss was forgiven.
    await cycleWithout1(hook, '2026-03-20T12:03:00Z');
    expect(hook.result.current.tiles.map((t) => t.id).sort()).toEqual([1, 2]);
  });

  it('treats a failed load like a missing camera', async () => {
    const hook = await loadThenDrop(2);
    const before = created.length;
    hook.rerender({ cams: [cam(1, 'https://x/a.jpg'), cam(2, 'https://x/b.jpg')], at: '2026-03-20T12:01:00Z' });
    await waitFor(() => expect(created).toHaveLength(before + 2));
    created[before].onerror?.(); // camera 1, CORS attempt
    await waitFor(() => expect(created).toHaveLength(before + 3));
    created[before + 2].onerror?.(); // camera 1, plain attempt
    created[before + 1].onload?.(); // camera 2
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.tiles.map((t) => t.id).sort()).toEqual([1, 2]);
    expect(hook.result.current.held).toBe(1);
    expect(hook.result.current.skipped).toBe(1);
  });

  it('missGraceCycles 0 drops immediately (the v3 behaviour)', async () => {
    const hook = await loadThenDrop(0);
    await cycleWithout1(hook, '2026-03-20T12:01:00Z');
    expect(hook.result.current.tiles.map((t) => t.id)).toEqual([2]);
    expect(hook.result.current.held).toBe(0);
  });
});
```

And to `app/components/mosaic/v4/overlays/overlays.test.tsx`, next to the existing SetupOverlay counts test, a case that renders `<SetupOverlay ... held={2} />` and asserts `screen.getByTestId('v4-setup-counts')` has text content containing `held 2`. Copy the props the neighbouring test passes.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/components/mosaic/v4/useLoadedTiles.test.ts app/components/mosaic/v4/overlays`
Expected: FAIL — `held` undefined, camera 1 dropped at once.

- [ ] **Step 3: Implement the hold**

In `app/components/mosaic/v4/useLoadedTiles.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
```

Extend the result and options:

```ts
export interface LoadedTilesResult {
  tiles: TileInput[];
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
  skipped: number;
  /** Tiles carried over from a previous cycle because their camera went missing. */
  held: number;
  loading: boolean;
}

export interface LoadTilesOptions {
  qualitySource: QualitySource;
  gateThreshold: number;
  /** The moment to compute solar position for; defaults to render time. */
  at?: string | number;
  /**
   * How many consecutive cycles a camera may go missing — absent from the
   * pool, or failed to load — before its tile is dropped. 0 drops at once.
   */
  missGraceCycles?: number;
}

const EMPTY: LoadedTilesResult = {
  tiles: [],
  byId: new Map(),
  skipped: 0,
  held: 0,
  loading: false,
};
```

Change the hook signature to `{ qualitySource, gateThreshold, at, missGraceCycles = 0 }: LoadTilesOptions`, and add two refs after `useState`:

```ts
  // The last settled batch and each camera's run of misses — the memory the
  // grace needs. Refs, not state: they are read and written inside the
  // effect and must not re-trigger it.
  const lastRef = useRef<Pick<LoadedTilesResult, 'tiles' | 'byId'>>({ tiles: [], byId: new Map() });
  const missesRef = useRef(new Map<number, number>());
```

In the empty-pool bail-out, also clear the memory so a held tile cannot outlive an emptied pool:

```ts
    if (withPreview.length === 0) {
      lastRef.current = { tiles: [], byId: new Map() };
      missesRef.current.clear();
      setResult((prev) =>
        prev.tiles.length === 0 && prev.skipped === noPreviewCount && !prev.loading
          ? prev
          : { tiles: [], byId: new Map(), skipped: noPreviewCount, held: 0, loading: false }
      );
      return () => { cancelled = true; };
    }
```

The loading placeholder gains `held: prev.held`. Replace `maybeFinish`:

```ts
    const maybeFinish = () => {
      settled += 1;
      if (settled !== withPreview.length || cancelled) return;

      // Anything that loaded this cycle has no misses.
      for (const id of byId.keys()) missesRef.current.delete(id);

      // Carry over what went missing, for as long as the grace allows. The
      // held tile keeps its frame and its signal but gets a FRESH altitude,
      // so the exit taper keeps advancing while it is held.
      let held = 0;
      for (const [id, entry] of lastRef.current.byId) {
        if (byId.has(id)) continue;
        const misses = (missesRef.current.get(id) ?? 0) + 1;
        if (misses > missGraceCycles) {
          missesRef.current.delete(id);
          continue;
        }
        const prevTile = lastRef.current.tiles.find((t) => t.id === id);
        if (!prevTile) continue;
        missesRef.current.set(id, misses);
        tiles.push({
          ...prevTile,
          sunAltitudeDeg: sunAltitudeDeg(moment, prevTile.lat, prevTile.lng),
        });
        byId.set(id, entry);
        held += 1;
      }

      const next = { tiles: [...tiles], byId: new Map(byId), skipped, held, loading: false };
      lastRef.current = { tiles: next.tiles, byId: next.byId };
      setResult(next);
    };
```

Add `missGraceCycles` to the effect's dependency array. Update the hook's doc comment with one sentence: "A camera that goes missing for up to `missGraceCycles` cycles is held with its last frame rather than exiting and re-entering (spec §8)."

- [ ] **Step 4: Dial, config, overlay, wiring**

`engine/types.ts`, `V4Config` after `maxTiles`:

```ts
  missGraceCycles: number; // cycles a missing camera is held before its tile leaves
```

`settingsSchema.ts`, visibility section after `maxTiles`:

```ts
  {
    key: 'missGraceCycles', kind: 'number', min: 0, max: 5, step: 1, default: 2,
    label: 'miss grace (cycles)', section: 'visibility',
    description: 'How many consecutive polls a camera can go missing — dropped from the pool, or its frame failed to load — before its tile leaves. Each cycle is a minute. A one-poll blip no longer fades a tile out and back in. 0 drops at once.',
  },
```

and `missGraceCycles: values.missGraceCycles as number,` in `configFromSettings`.

`overlays/SetupOverlay.tsx`: add `held = 0` to the props (`held?: number`) and change the counts line to

```tsx
        {feed} · tiles {layout.tiles.length} · evicted {layout.evicted.length} ·
        dropped {layout.dropped.length} · skipped {skipped} · held {held} ·
        scale {layout.scale.toFixed(2)}
```

Extend its doc comment: "`held` is a camera that went missing this cycle and is being carried on its last frame; it is on the wall, but not live."

`index.tsx`:

```ts
  const signal = {
    qualitySource: cfg.qualitySource,
    gateThreshold: cfg.gateThreshold,
    at,
    missGraceCycles: cfg.missGraceCycles,
  };
  const { tiles, byId, skipped, held } = useLoadedTiles(webcams, signal);
```

and pass `held={held}` to `SetupOverlay`.

- [ ] **Step 5: Run the v4 folder**

Run: `npx vitest run app/components/mosaic/v4`
Expected: PASS. If `index.test.tsx` snapshots the counts line, add `held 0` to the expectation.

- [ ] **Step 6: Commit and push**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-mosaic-v4
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/mosaic-v4" ] && \
  git add app/components/mosaic/v4/useLoadedTiles.ts app/components/mosaic/v4/useLoadedTiles.test.ts \
          app/components/mosaic/v4/overlays/SetupOverlay.tsx app/components/mosaic/v4/overlays/overlays.test.tsx \
          app/components/mosaic/v4/index.tsx app/components/mosaic/v4/index.test.tsx \
          app/components/mosaic/v4/engine/types.ts app/components/mosaic/v4/settingsSchema.ts && \
  git commit -m "feat(mosaic/v4): miss grace — a camera gone for a poll or two is held, not faded out and back

The held tile keeps its frame and signal and gets a fresh altitude so
the exit taper keeps advancing. Counted as 'held' on the setup overlay
so it cannot be mistaken for a live camera.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018a9bbcpGGuhq6Y6cdJQhYE"
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/mosaic-v4
git rev-parse HEAD origin/feat/mosaic-v4
```

---

### Task 6: Whole-suite check, live verification, PR

**Files:**
- Modify: `docs/superpowers/plans/2026-09-03-mosaic-v4-legible-change.md` (this file: a "Findings after execution" section)

- [ ] **Step 1: Full suite and build**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-mosaic-v4
npm run test 2>&1 | tail -15
npm run build 2>&1 | tail -15
```

Expected: every test file green; build succeeds. A failure outside `v4/` means the fork leaked (Task 1's rename touched a shared file) — fix the leak, never the other version.

- [ ] **Step 2: Live check on the dev server**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-mosaic-v4
npm run dev > /tmp/v4-dev.log 2>&1 &
sleep 8; grep -o 'http://localhost:[0-9]*' /tmp/v4-dev.log | head -1
```

With agent-browser (named session `v4`), open
`<url>/kiosk/sunset?v=v4&setup=1&panel=dell` and, in a second tab,
`<url>/kiosk/sunset?v=v3&setup=1&panel=dell`. Do not screenshot (the drift loop hangs `agent-browser screenshot`); read the DOM:

- `[data-testid=v4-setup-counts]` exists and contains `held`.
- The v4 tile count is greater than or equal to the v3 tile count on the same pool (the taper only ever shrinks tiles).
- Reload the v4 tab with `&changeSpreadMs=0&transitionStyle=dissolve&exitTaperDeg=0&missGraceCycles=0` and confirm the counts line matches the v3 tab's tiles/evicted numbers. Same engine, dials off, same wall: this is the proof the fork is byte-faithful where it claims to be.

Record the three observations in the findings section below. Kill the dev server.

- [ ] **Step 3: Write the findings section**

Append to this plan:

```markdown
## Findings after execution

- realPool re-pin: <old numbers> → <new numbers>, because <one sentence>.
- Live check <date>: v4 counts line `<paste>`; v3 `<paste>`; v4 with dials off `<paste>`.
- Anything the spec got wrong, with the section number.
```

- [ ] **Step 4: Commit, push, open the PR**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-mosaic-v4
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/mosaic-v4" ] && \
  git add docs/superpowers/plans/2026-09-03-mosaic-v4-legible-change.md && \
  git commit -m "docs(mosaic/v4): findings after execution

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018a9bbcpGGuhq6Y6cdJQhYE"
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/mosaic-v4
```

PR title: `feat(mosaic): v4 — legible change (exit taper, fade-through, scattered change, miss grace)`. Body: the four pieces in one line each, the v2-on-the-glass finding, the v3-exits-were-never-drawn finding, how to A/B (`?v=v4` beside `?v=v3`, `?transitionStyle=dissolve`), what is NOT verified (Pi duty cycle, real evenings), and the trailer:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_018a9bbcpGGuhq6Y6cdJQhYE
```

Open with `gh pr create --base main --head feat/mosaic-v4 --title ... --body-file /tmp/v4-pr.md`.
