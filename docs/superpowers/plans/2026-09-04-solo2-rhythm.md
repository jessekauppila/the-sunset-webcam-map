# solo2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second registered kiosk version, `solo2`, that adds rhythm (peaks and valleys on a slot-derived beat), an anticipation lead, an optional same-camera prelude, transition kinds, and a local-time caption, without touching `solo`'s behaviour.

**Architecture:** `solo2` is a version descriptor (`app/lib/solo/versions.ts`) that the two solo endpoints, the glass, and the studio select by name. Its engine composes `solo`'s pure helpers and adds rule 3's beat; its glass computes each dwell's stage from the wall clock through pure `plan.ts` functions; the studio pages are the existing solo studio components parametrised by the descriptor. Bins, screen state, cron, and schedule are shared and unchanged.

**Tech Stack:** Next.js route handlers, Vitest (`// @vitest-environment node` for server files), React Testing Library, `tz-lookup` (+ `@types/tz-lookup`), SunCalc via `app/lib/solo/zone.ts`, the existing settings schema helpers.

**Spec:** `docs/superpowers/specs/2026-09-04-solo2-rhythm-design.md`

## Global Constraints

- `solo`'s engine (`app/lib/solo/engine.ts`), schema, and renderer (`app/components/solo/SoloFrame.tsx`, `index.tsx`) are not modified. Additive, default-preserving changes to shared plumbing (`useSoloGlass`, `view.ts`, the endpoints, the studio components) are allowed; every existing test must keep passing unchanged.
- Every new dial defaults to `solo`'s behaviour except `timeStyle`, which defaults to `12h`.
- The engine and the plan helpers are pure: no `Date.now()`, no I/O, no module state.
- Hold floor is 3 s (`MIN_HOLD_S = 3`).
- `captured_at` is selected as `captured_at::text` and parsed as UTC (`Date.parse(text.replace(' ', 'T') + 'Z')`).
- The client view carries no coordinates: `timezone` and `sunAltitudeDeg` are computed server-side in `toViewEntry`.
- Work in the worktree `~/GitHub/the-sunset-webcam-map.worktrees/feat-solo2-rhythm` on branch `feat/solo2-rhythm`. Verify the branch in the same command as each commit. Stage explicit paths. Push after every commit with `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push`.
- `npm run test -- --run <path>` for one file; `npm run lint` and `npx tsc --noEmit` before each commit.

---

## File structure

| path | responsibility |
|---|---|
| `app/lib/solo2/types.ts` | `Solo2Dials extends SoloDials`, `Transition`, `TimeStyle`, `Screens`, `Role` |
| `app/lib/solo2/settingsSchema.ts` (+ test) | `SOLO2_NAMESPACE`, `SOLO2_SETTINGS_SCHEMA`, `dialsFrom2()` |
| `app/lib/solo2/engine.ts` (+ test) | `beatOf`, `roleAt`, `next2`, `project2` |
| `app/lib/solo2/plan.ts` (+ test) | `fitPlan`, `stageAt`, `MIN_HOLD_S` |
| `app/lib/solo2/prelude.ts` (+ test) | `preludeFor` |
| `app/lib/solo2/caption.ts` (+ test) | `formatTime`, `captionLines` |
| `app/lib/solo/versions.ts` (+ test) | `SoloVersionSpec`, `SOLO_VERSIONS`, `resolveSoloVersion` |
| `app/lib/solo/store.ts` | `capturedAt` on `StoredEntry` from `captured_at::text` |
| `app/api/kiosk/solo/view.ts` (+ test) | `capturedAt`/`timezone`/`sunAltitudeDeg` on `ViewEntry`; `buildStateView` takes `version`; `nextRoles` |
| `app/api/kiosk/solo/state/route.ts` (+ test) | `?version=` |
| `app/api/kiosk/solo/advance/route.ts` (+ test) | `body.version` |
| `app/components/solo/useSoloGlass.ts` (+ test) | optional `version`; returns `entries`, `nextEntries` |
| `app/components/solo2/Solo2Frame.tsx` (+ test) | layers, transition, lead, prelude, caption |
| `app/components/solo2/useStage.ts` (+ test) | clock-driven stage from `plan.ts` |
| `app/components/solo2/index.tsx` (+ test) | the registered renderer |
| `app/components/mosaic/registry.ts` (+ test) | register `solo2` |
| `app/studio/solo/*` | take a `SoloVersionSpec`; enum control; budget line; PEAK/VALLEY tags; caption via `captionLines` |
| `app/studio/solo2/page.tsx` | `/studio/solo2` |
| `docs/ops/pushing-an-update-to-the-glass.md` | a line on switching to `solo2` |

---

### Task 1: Types and settings schema

**Files:**
- Create: `app/lib/solo2/types.ts`, `app/lib/solo2/settingsSchema.ts`, `app/lib/solo2/settingsSchema.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Transition = 'cut' | 'crossfade' | 'dip';
  export type TimeStyle = 'off' | '12h' | '12h-there' | '24h' | 'sun' | '12h-sun';
  export type Screens = 'together' | 'alternate';
  export type Role = 'peak' | 'valley';
  export interface Solo2Dials extends SoloDials {
    transition: Transition; leadS: number; leadScale: number;
    prelude: boolean; preludeFrames: number; preludeStepS: number;
    timeStyle: TimeStyle; valleys: number; screens: Screens;
  }
  export const SOLO2_NAMESPACE = 'solo2';
  export const SOLO2_SETTINGS_SCHEMA: SettingsSchema;
  export function dialsFrom2(values: SettingsValues): Solo2Dials;
  ```
- Schema order (glass): dwellS, offsetS, transition, fadeS, leadS, leadScale, prelude, preludeFrames, preludeStepS, showPlace, timeStyle, showScores, showRank, showTally. (bins): qualityFloor, detectionFloor, sunsetFloor, mix, repeatAllowance, valleys, screens, zoneGrace, promoteNew. Ranges per spec §3–§4.

- [ ] Test: every `solo` key is present with the same default; the new keys default to `cut`, 0, 1.03, false, 3, 1.5, `12h`, 0, `together`; `dialsFrom2(schemaDefaults(...))` typed shape.
- [ ] Implement; run; commit `feat(solo2): dials`.

### Task 2: Engine with the beat

**Files:**
- Create: `app/lib/solo2/engine.ts`, `app/lib/solo2/engine.test.ts`

**Interfaces:**
- Consumes: `isEligible`, `tierOf`, `rankScore`, `afterShowing` from `app/lib/solo/engine`.
- Produces:
  ```ts
  export function beatOf(slot: number, feed: Feed, d: Pick<Solo2Dials,'valleys'|'screens'>): number;
  export function roleAt(slot: number, feed: Feed, d: Solo2Dials): Role;   // beat 0 → 'peak'
  export function next2(entries: BinEntry[], d: Solo2Dials, state: ScreenState, slot: number, feed: Feed): BinEntry | null;
  export function project2(entries: BinEntry[], d: Solo2Dials, state: ScreenState, n: number, firstSlot: number, feed: Feed): BinEntry[];
  ```
- Valley comparator: `a.tally - b.tally || rankScore(a) - rankScore(b) || a.enteredAt - b.enteredAt || a.snapshotId - b.snapshotId`.

- [ ] Tests: valleys 0 reproduces the three `solo` allowance fixtures; 21 sunsets, valleys 1, together → `S1 S21 S2 S20 S3 S19`; valleys 2 → `S1 S21 S20 S2 S19 S18`; alternate: sunset feed at slot 0 is a valley and slot 1 a peak; a valley prefers an unshown low frame over a shown lower one; rule 4 on a valley with two frames; non-sunsets still arrive through mix with valleys 1; `beatOf` negative slots wrap to 0..period-1.
- [ ] Implement; run; commit `feat(solo2): engine — peaks and valleys on a slot-derived beat`.

### Task 3: Plan helpers (`fitPlan`, `stageAt`)

**Files:**
- Create: `app/lib/solo2/plan.ts`, `app/lib/solo2/plan.test.ts`

**Interfaces:**
```ts
export const MIN_HOLD_S = 3;
export interface DwellPlan { dwellS: number; preludeFrames: number; preludeStepS: number; leadS: number; holdS: number; clamped: boolean }
export function fitPlan(d: Pick<Solo2Dials,'dwellS'|'prelude'|'preludeFrames'|'preludeStepS'|'leadS'>, available: number): DwellPlan;
export type Stage = { layer: 'prelude'; index: number } | { layer: 'main'; leadProgress: number };
export function stageAt(elapsedMs: number, p: DwellPlan): Stage;
```
- `available` = prelude frames actually available for this entry; `preludeFrames` in the result = `min(dial, available)` when `prelude` on, else 0. Drop frames (oldest first = reduce the count) until `holdS ≥ MIN_HOLD_S`; then shorten `leadS`; `clamped` true if anything was reduced.

- [ ] Tests: fits as-is; drops prelude frames one at a time; shortens lead after prelude is gone; prelude off → 0 frames; `stageAt` before `k·t` → prelude index; after → main with `leadProgress` 0 until `dwell − lead`, linear to 1 at `dwell`, clamped ≥ 0 and ≤ 1; negative elapsed → first stage.
- [ ] Implement; run; commit `feat(solo2): dwell plan and clock-driven stage`.

### Task 4: Prelude and caption helpers

**Files:**
- Create: `app/lib/solo2/prelude.ts` (+ test), `app/lib/solo2/caption.ts` (+ test)

**Interfaces:**
```ts
// prelude.ts — generic over anything with webcamId, snapshotId, capturedAt
export function preludeFor<T extends { webcamId: number; snapshotId: number; capturedAt: number }>(entry: T, entries: T[], max: number): T[];
// caption.ts
export function formatTime(style: TimeStyle, capturedAt: number, timezone: string | null, sunAltitudeDeg: number | null): string | null;
export function captionLines(entry: { title: string; region: string; country: string; capturedAt: number; timezone: string | null; sunAltitudeDeg: number | null }, d: Pick<Solo2Dials,'showPlace'|'timeStyle'>): { title: string; sub: string } | null;
```
- `formatTime` uses `new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12 })` and lower-cases `AM/PM`. `sun` → `sun 1.2° above the horizon` / `below`. Null timezone → the sun part only if asked, else null.

- [ ] Tests: same camera only, earlier only, order, last `max`, alone → `[]`; each style string for `2026-09-05T02:42:00Z` in `America/Mazatlan` (7:42 pm); `24h` → `19:42`; `off` → null; null timezone with `12h` → null; `captionLines` joins `region, country · time` and omits the dot when no time.
- [ ] Implement; run; commit `feat(solo2): prelude and caption helpers`.

### Task 5: Version descriptors

**Files:**
- Create: `app/lib/solo/versions.ts` (+ test)

**Interfaces:**
```ts
export interface SoloVersionSpec<D extends SoloDials = SoloDials> {
  name: 'solo' | 'solo2'; namespace: string; schema: SettingsSchema;
  dialsFrom(values: SettingsValues): D;
  project(entries: BinEntry[], d: D, state: ScreenState, n: number, firstSlot: number, feed: Feed): BinEntry[];
  next(entries: BinEntry[], d: D, state: ScreenState, slot: number, feed: Feed): BinEntry | null;
  roleAt(slot: number, feed: Feed, d: D): Role;   // solo: always 'peak'
}
export const SOLO_VERSIONS: { solo: SoloVersionSpec<SoloDials>; solo2: SoloVersionSpec<Solo2Dials> };
export type SoloVersionName = keyof typeof SOLO_VERSIONS;
export function resolveSoloVersion(raw: string | null | undefined): SoloVersionSpec | null; // undefined/null/'' → solo; unknown → null
```
- Client-safe: no `server-only`, no store imports.

- [ ] Tests: resolve default/known/unknown; `solo.project` ignores the slot and equals `project`; `solo2.roleAt` follows `beatOf`.
- [ ] Implement; run; commit.

### Task 6: Store and view

**Files:**
- Modify: `app/lib/solo/store.ts` (`captured_at::text as captured_at`, `capturedAt: number` on `StoredEntry`, parser `parseUtcText`), `app/api/kiosk/solo/view.ts` (+ test)

**Interfaces:**
- `ViewEntry` gains `capturedAt: number; timezone: string | null; sunAltitudeDeg: number | null`.
- `toViewEntry(e: StoredEntry)` computes `timezone = tzLookup(e.lat, e.lng)` (try/catch → null) and `sunAltitudeDeg = sunAltitudeDeg(new Date(e.capturedAt), e.lat, e.lng)`.
- `buildStateView(input & { version?: SoloVersionSpec })` — default `SOLO_VERSIONS.solo`; `firstSlot = schedule.slot + 1`; `StateView.nextRoles: Role[]`.
- Existing test fixtures gain the three fields via a helper default (tests that build `ViewEntry` objects need `capturedAt: 0, timezone: null, sunAltitudeDeg: null`).

- [ ] Tests: `parseUtcText('2026-09-05 03:34:28.703')` = `Date.UTC(2026,8,5,3,34,28,703)`; `toViewEntry` sets a timezone for Cabo (`America/Mazatlan`) and a finite altitude; `buildStateView` with `solo2` and valleys 1 yields alternating roles and the `S1 S21` order; default keeps every existing assertion.
- [ ] Implement; run whole `app/api/kiosk/solo` and `app/lib/solo`; commit.

### Task 7: Endpoints take a version

**Files:**
- Modify: `state/route.ts`, `advance/route.ts` (+ their tests)

- `state`: `resolveSoloVersion(searchParams.get('version'))`, 400 `version must be solo or solo2` on null. Dials from `version.dialsFrom(mergeSettings(version.schema, profile?.namespaces[version.namespace]))`. Pass `version` to `buildStateView`.
- `advance`: same from `body.version`; `version.next(entries, dials, state, slot, feed)`.

- [ ] Tests: `?version=solo2` reads the `solo2` namespace (`dwellS: 9` there vs 30 in `solo`) and returns `nextRoles`; unknown → 400; missing → solo as before; advance with `solo2` valleys 1 at an odd slot draws the valley.
- [ ] Implement; run; commit.

### Task 8: Glass hook gains version and entries

**Files:**
- Modify: `app/components/solo/useSoloGlass.ts` (+ test)

- `useSoloGlass({ feed, dials, drive, dozing, version = 'solo' })`; URL `&version=`, body `version`. Return adds `entries: ViewEntry[]` and `nextEntries: EntryView[]` (the full `next` list). Existing return fields unchanged.

- [ ] Tests: default calls omit nothing the old test asserted (`body` equality → update to include `version: 'solo'`); `version: 'solo2'` appears in URL and body; `entries` surfaces the view's entries.
- [ ] Implement; run; commit.

### Task 9: `solo2` renderer

**Files:**
- Create: `app/components/solo2/useStage.ts` (+ test), `Solo2Frame.tsx` (+ test), `index.tsx` (+ test)
- Modify: `app/components/mosaic/registry.ts` (+ test)

**Interfaces:**
```ts
// useStage.ts
export function useStage(plan: DwellPlan, startMs: number, tickMs = 250): Stage;   // startMs = boundaryMs − dwell
// Solo2Frame.tsx
export function Solo2Frame(p: { entry: EntryView; prelude: EntryView[]; previous: EntryView | null; stage: Stage; plan: DwellPlan; dials: Solo2Dials; width: number; height: number }): JSX.Element;
```
- Layers, bottom to top: previous image (if transition ≠ cut and a previous exists); for `dip`, a black div animating `opacity 0→1` over `fadeS/2`; the top image (prelude[index] or entry) with `crossfade` animation over `fadeS`, or for `dip` an animation with `animation-delay: fadeS/2`; `key` on the top image = its `snapshotId` so a change re-runs the animation; prelude steps swap `src` under the same key (no animation) — implement as `key={'top'}` + `src` change for prelude and `key={entry.snapshotId}` on the entry into the dwell.
- Lead: when `stage.layer === 'main'` and `plan.leadS > 0`, style `animation: solo2-lead ${leadS}s linear forwards; animation-delay: -${leadProgress*leadS}s` with keyframes `to { transform: scale(leadScale) }`.
- Overlays only when `stage.layer === 'main'`: caption from `captionLines`, scores/rank/tally exactly as `SoloFrame`.
- `index.tsx`: `dialsFrom2(mergeSettings(SOLO2_SETTINGS_SCHEMA, props.settings))`; `useSoloGlass({ ..., version: 'solo2' })`; `prelude = dials.prelude ? preludeFor(current, entries, dials.preludeFrames) : []`; `plan = fitPlan(dials, prelude.length)`; `startMs = boundaryMs − dwellS*1000`; `stage = useStage(plan, startMs)`; preload `next[0]` and its prelude.
- Registry: `solo2: Solo2Kiosk`, schemas `solo2: SOLO2_SETTINGS_SCHEMA`.

- [ ] Tests: `useStage` with fake timers walks prelude → main → lead; `Solo2Frame` prelude stage shows no caption, main stage shows `Lisboa, Portugal · 7:42 pm`; `dip` renders the black layer; `cut` renders no previous; lead sets the animation; `index` passes `version: 'solo2'` and `drive/dozing`; registry has `solo2` and `SHARED_SCHEMA` activeVersion options include it.
- [ ] Implement; run; commit.

### Task 10: Studio parametrised by version, `/studio/solo2`

**Files:**
- Modify: `app/studio/solo/SoloStudioClient.tsx`, `SoloRail.tsx`, `RulesBox.tsx`, `FeedColumn.tsx`, `EntryRow.tsx`, `useSoloState.ts`, `page.tsx` (+ tests)
- Create: `app/studio/solo2/page.tsx`, `app/studio/solo/DwellBudget.tsx` (+ test)

- `SoloStudioClient({ version })`, `SoloRail({ api, deploySlot, version })`, `useSoloState(feed, dials, version)` (URL `&version=`; projection via `buildStateView({ ..., version })`), `RulesBox({ dials, version })` — for `solo2` rule 3 reads `In a bin: best first; after each peak, N valleys (lowest eligible) · screens together|alternate`; `FeedColumn` gets `roles={projected.nextRoles}` and passes `role` to `EntryRow`, which renders a `PEAK`/`VALLEY` tag only when `version.name === 'solo2' && valleys > 0`; the panel caption uses `captionLines` when the dials carry `timeStyle`.
- `Control` renders `kind === 'enum'` as `<select>`; `setKnob` receives the string.
- `DwellBudget({ dials })` under the glass group for `solo2`: `prelude 4.5 s + lead 4 s + hold 11.5 s`, red + ` (clamped)` when `fitPlan(dials, dials.preludeFrames).clamped`.
- Each studio's strip links to the other (`solo2 studio →` / `← solo studio`).

- [ ] Tests: rail renders every `solo2` knob incl. selects and writes strings; budget line values and clamp; feed column shows PEAK/VALLEY tags with valleys 1; existing solo studio tests unchanged.
- [ ] Implement; run whole `app/studio/solo`; commit.

### Task 11: Docs, lint, full suite, PR

- [ ] `docs/ops/pushing-an-update-to-the-glass.md`: a short "solo2" note (merge → build → doctor reload → active version `solo2` → tune on `/studio/solo2`; back is the same dial).
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run test -- --run`.
- [ ] Commit; push; open the PR with the spec summary, the dial table, the on-glass procedure, and the `npm install` note for the main checkout.
