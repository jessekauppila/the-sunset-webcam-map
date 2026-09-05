# Solo Kiosk Phase 3 (Studio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/studio/solo`, the transparency surface: each feed's on-glass frame with overlays and a countdown, the queue as a column beside the two bins, a dial rail in two colour-coded groups with a live rules box, tooltips on everything, and click-to-rate through the shared `FrameLabelCard`.

**Architecture:** One SWR poll per feed against `GET /api/kiosk/solo/state` (phase 1), refreshed every 5 s. The response now carries the raw `entries` list and the `zone`, so the client re-runs the pure `buildStateView` with the **studio** profile's dials the moment a dial moves, without waiting for the settings PATCH. Timing on the panel uses the **live** profile's dials, because that is what the glass runs. Dials, Deploy, and Revert reuse `useStudioSettings` and `DeployButton` unchanged; the `solo` namespace is already registered.

**Tech Stack:** Next.js app router, SWR, React with inline styles (matches `/studio`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md` §6.4; mockup `.superpowers/brainstorm/83245-1788567565/content/studio-v3.html` in the main checkout.

## Global Constraints

- Branch `feat/solo-studio`, worktree `~/GitHub/the-sunset-webcam-map.worktrees/feat-solo-studio`. Verify the branch in the same command as every commit; stage explicit paths; push after each commit with the gh credential helper:
  `GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push origin feat/solo-studio`
- No new dependencies.
- Colours, fixed: sunset bin `#7ee2ac`, non-sunset bin `#c3cad6`, queue outline `#4b5568`, on-glass ring `#f5a344`, glass dial group `#f5a344`, bins dial group `#4fd1c5`, NEW tag `#f5a344`, LEFT ZONE / FLOOR tags grey `#3a4356`. Backgrounds `#0b0e14` page, `#10141d` rail, `#0e1119` rows.
- Tally text is `shown ×N`, always, bold when N > 0.
- Every dial, bin header, tag, row, and status item has a `title` tooltip.
- Detection is shown as a probability (0–1) with the label `d`; quality as `q`.
- Rendering never blocks on the rating card: `FrameLabelCard` mounts only when a frame is selected.

---

## File structure

| path | responsibility |
|---|---|
| `app/api/kiosk/solo/view.ts` (+ test) | `buildStateView` takes `ViewEntry[]` (client-safe) and returns `entries` + `zone` too |
| `app/api/kiosk/solo/state/route.ts` (+ test) | maps `StoredEntry` → `ViewEntry`, computes `zone` from the day-ring flag |
| `app/api/kiosk/solo/advance/route.ts` | same mapping (one helper) |
| `app/studio/solo/page.tsx` | owner-gated route |
| `app/studio/solo/SoloStudioClient.tsx` | layout: status strip, rail, two feed columns, detail modal |
| `app/studio/solo/useSoloState.ts` (+ test) | SWR per feed + client re-projection with studio dials |
| `app/studio/solo/countdown.ts` (+ test) | `nextCronMs`, `formatCountdown` |
| `app/studio/solo/toWebcam.ts` (+ test) | `EntryView` → `WindyWebcam` for the label card |
| `app/studio/solo/RulesBox.tsx` (+ test) | the five rules with live values |
| `app/studio/solo/SoloRail.tsx` (+ test) | Deploy slot, two colour groups of dials from the schema, rules box |
| `app/studio/solo/EntryRow.tsx` (+ test) | one frame row with thumbnail, tally, scores, tags, tooltip |
| `app/studio/solo/FeedColumn.tsx` (+ test) | panel + countdown + three columns for one feed |
| `app/studio/solo/SoloStatusStrip.tsx` (+ test) | cron countdown, last pull, glass revision, zone |
| `app/studio/StudioClient.tsx` | one link pill to `/studio/solo` |

---

### Task 1: View carries raw entries and the zone

**Files:**
- Modify: `app/api/kiosk/solo/view.ts`, `app/api/kiosk/solo/view.test.ts`
- Modify: `app/api/kiosk/solo/state/route.ts`, `app/api/kiosk/solo/state/route.test.ts`
- Modify: `app/api/kiosk/solo/advance/route.ts`

**Interfaces:**
- Produces:
  - `interface ViewEntry extends BinEntry { imageUrl; title; city; region; country }` (no lat/lng, no feed)
  - `toViewEntry(e: StoredEntry): ViewEntry`
  - `buildStateView(input: { feed; dials; entries: ViewEntry[]; screen; nowMs; admitted; zone: Zone }): StateView`
  - `StateView` gains `entries: ViewEntry[]` and `zone: { minDeg: number; maxDeg: number }`

- [ ] **Step 1: Update the view test**

Replace the `stored()` fixture type with `ViewEntry` (drop `feed`, `lat`, `lng`, `firstShownAt`, `lastShownAt`) and pass `zone: { minDeg: -24, maxDeg: -2 }` in every `buildStateView` call. Add:

```ts
  it('echoes the raw entries and the zone so a client can re-project', () => {
    const entries = [stored(1, 'sunset', 0.9)];
    const v = buildStateView({ feed: 'sunset', dials: D, entries, screen: null, nowMs: 0,
      admitted: { sunset: 0, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: 14 } });
    expect(v.entries).toHaveLength(1);
    expect(v.zone).toEqual({ minDeg: -24, maxDeg: 14 });
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run app/api/kiosk/solo/view.test.ts`
Expected: FAIL on the new field and on the type of `entries`.

- [ ] **Step 3: Update `view.ts`**

```ts
import type { StoredEntry, ScreenRow } from '@/app/lib/solo/store';
import type { Zone } from '@/app/lib/solo/zone';

/** What the client needs per frame. No coordinates, no feed: those stay server-side. */
export interface ViewEntry extends BinEntry {
  imageUrl: string;
  title: string;
  city: string;
  region: string;
  country: string;
}

export function toViewEntry(e: StoredEntry): ViewEntry {
  return {
    snapshotId: e.snapshotId, webcamId: e.webcamId, bin: e.bin, quality: e.quality,
    detection: e.detection, isNew: e.isNew, tally: e.tally, enteredAt: e.enteredAt,
    imageUrl: e.imageUrl, title: e.title, city: e.city, region: e.region, country: e.country,
  };
}
```

`EntryView` becomes `ViewEntry & { eligible: boolean; rank: number }`. `StateView` gains `entries: ViewEntry[]` and `zone: Zone`. `buildStateView` takes `entries: ViewEntry[]` and `zone: Zone`, and returns `entries` (the input, unchanged) and `zone`. Replace every `StoredEntry` in the file with `ViewEntry`; `scoreOf`, `rankMap`, `byScore` keep working since they read only `BinEntry` fields.

- [ ] **Step 4: Update the routes**

`state/route.ts`:

```ts
import { isFlagEnabled, SWEEP_FORCE_DAY_RING } from '@/app/lib/runtimeFlags';
import { sweepGeometry } from '@/app/api/cron/update-cameras/lib/sweepGeometry';
import { TERMINATOR_DAY_SIDE_OFFSETS_DEG } from '@/app/lib/masterConfig';
import { buildStateView, parseFeed, toViewEntry } from '../view';
// ...
  const [entries, screen, admitted, forcedDayRing] = await Promise.all([
    listActiveEntries(feed),
    getScreenState(feed),
    countAdmittedSince(feed, nowMs - LAST_PULL_WINDOW_MS),
    isFlagEnabled(SWEEP_FORCE_DAY_RING),
  ]);
  const geometry = sweepGeometry(forcedDayRing ? TERMINATOR_DAY_SIDE_OFFSETS_DEG : []);
  const zone = { minDeg: geometry.coverageMinDeg, maxDeg: geometry.coverageMaxDeg };
  return NextResponse.json(buildStateView({
    feed, dials, entries: entries.map(toViewEntry), screen, nowMs, admitted, zone,
  }));
```

`advance/route.ts`: same flag read and geometry; pass `entries.map(toViewEntry)` and `zone` to `buildStateView`. The `stored.tally += 1` mutation stays on the `StoredEntry` list before mapping.

`state/route.test.ts`: add mocks

```ts
vi.mock('@/app/lib/runtimeFlags', () => ({ isFlagEnabled: async () => false, SWEEP_FORCE_DAY_RING: 'x' }));
```

and assert `(await res.json()).zone` equals `{ minDeg: -24, maxDeg: -2 }` in the live-profile test. `advance/route.test.ts` gets the same `runtimeFlags` mock.

- [ ] **Step 5: Run tests and lint**

Run: `npx vitest run app/api/kiosk/solo && npx eslint app/api/kiosk/solo`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-studio" ] && git add app/api/kiosk/solo && git commit -m "feat(solo): state view carries raw entries and the zone for client re-projection"
```

---

### Task 2: Pure helpers: countdown and toWebcam

**Files:**
- Create: `app/studio/solo/countdown.ts`, `app/studio/solo/countdown.test.ts`
- Create: `app/studio/solo/toWebcam.ts`, `app/studio/solo/toWebcam.test.ts`

**Interfaces:**
- `CRON_PERIOD_MS = 10 * 60 * 1000`
- `nextCronMs(nowMs: number): number` — next multiple of the cron period on Unix time
- `formatCountdown(ms: number): string` — `m:ss`, never negative
- `toWebcam(entry: EntryView, feed: Feed): WindyWebcam` — `frameId = snapshotId`, `phase = feed`, images.current.preview = imageUrl, location from city/region/country, ai fields filled

- [ ] **Step 1: Tests**

```ts
// countdown.test.ts
import { describe, it, expect } from 'vitest';
import { nextCronMs, formatCountdown, CRON_PERIOD_MS } from './countdown';

describe('countdown', () => {
  it('nextCronMs is the next 10-minute mark', () => {
    expect(nextCronMs(0)).toBe(CRON_PERIOD_MS);
    expect(nextCronMs(CRON_PERIOD_MS - 1)).toBe(CRON_PERIOD_MS);
    expect(nextCronMs(CRON_PERIOD_MS)).toBe(2 * CRON_PERIOD_MS);
  });
  it('formatCountdown renders m:ss and clamps at zero', () => {
    expect(formatCountdown(605_000)).toBe('10:05');
    expect(formatCountdown(59_000)).toBe('0:59');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});
```

```ts
// toWebcam.test.ts
import { describe, it, expect } from 'vitest';
import { toWebcam } from './toWebcam';

describe('toWebcam', () => {
  it('names the archived frame so the label card writes against it', () => {
    const w = toWebcam({
      snapshotId: 88213, webcamId: 42, bin: 'sunset', quality: 0.91, detection: 0.88, isNew: false,
      tally: 1, enteredAt: 0, imageUrl: 'https://storage.googleapis.com/x.jpg', title: 'Pier',
      city: 'Lisbon', region: 'Lisboa', country: 'Portugal', eligible: true, rank: 1,
    }, 'sunset');
    expect(w.frameId).toBe(88213);
    expect(w.webcamId).toBe(42);
    expect(w.phase).toBe('sunset');
    expect(w.images?.current?.preview).toBe('https://storage.googleapis.com/x.jpg');
    expect(w.location.city).toBe('Lisbon');
    expect(w.aiRatingBinary).toBeCloseTo(1 + 0.88 * 4);
  });
});
```

- [ ] **Step 2: Run to see them fail**, then implement:

```ts
// countdown.ts
export const CRON_PERIOD_MS = 10 * 60 * 1000;

export function nextCronMs(nowMs: number): number {
  return (Math.floor(nowMs / CRON_PERIOD_MS) + 1) * CRON_PERIOD_MS;
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
```

```ts
// toWebcam.ts
import type { WindyWebcam } from '@/app/lib/types';
import type { Feed } from '@/app/lib/solo/types';
import type { EntryView } from '@/app/api/kiosk/solo/view';

/**
 * The label card speaks WindyWebcam. A bin entry IS an archived frame, so
 * `frameId` is set and the card writes a gold label against that exact row
 * without a capture step. Detection is carried in the 1–5 form the card's
 * AI readout expects (1 + p × 4, the cron's own mapping).
 */
export function toWebcam(e: EntryView, feed: Feed): WindyWebcam {
  return {
    webcamId: e.webcamId,
    title: e.title,
    viewCount: 0,
    status: 'active',
    images: { current: { preview: e.imageUrl } },
    location: { city: e.city, region: e.region, country: e.country, latitude: 0, longitude: 0 },
    categories: [],
    phase: feed,
    frameId: e.snapshotId,
    aiRatingRegression: e.quality == null ? undefined : 1 + e.quality * 4,
    aiRatingBinary: 1 + e.detection * 4,
  };
}
```

If `WindyWebcam.images.current` requires more than `preview`, fill the other fields with `imageUrl` too.

- [ ] **Step 3: Run tests, commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-studio" ] && git add app/studio/solo/countdown.ts app/studio/solo/countdown.test.ts app/studio/solo/toWebcam.ts app/studio/solo/toWebcam.test.ts && git commit -m "feat(solo-studio): countdown + toWebcam helpers"
```

---

### Task 3: `useSoloState`

**Files:**
- Create: `app/studio/solo/useSoloState.ts`, `app/studio/solo/useSoloState.test.tsx`

**Interfaces:**
- `useSoloState(feed: Feed, studioDials: SoloDials): { server: StateView | undefined; projected: StateView | undefined; error?: string }`
  - `server` = what the endpoint returned (live dials)
  - `projected` = `buildStateView` re-run client-side over `server.entries` with `studioDials`, `server.current`'s screen row reconstructed, `Date.now()`

- [ ] **Step 1: Test**

```tsx
// useSoloState.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSoloState } from './useSoloState';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const entry = (id: number, q: number) => ({
  snapshotId: id, webcamId: 100 + id, bin: 'sunset', quality: q, detection: 0.9, isNew: false,
  tally: 0, enteredAt: id, imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '',
});
const serverView = {
  feed: 'sunset', dials: D, current: null, next: [], bins: { sunset: [], nonSunset: [] },
  schedule: { slot: 0, nextBoundaryMs: 0 }, lastPull: { admitted: { sunset: 0, nonSunset: 0 } },
  entries: [entry(1, 0.9), entry(2, 0.5)], zone: { minDeg: -24, maxDeg: -2 },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => serverView })));
});

describe('useSoloState', () => {
  it('re-projects with the studio dials: a lower quality floor admits frame 2', async () => {
    const { result } = renderHook(() => useSoloState('sunset', { ...D, qualityFloor: 0.4 }));
    await waitFor(() => expect(result.current.projected).toBeDefined());
    expect(result.current.projected!.next.map((e) => e.snapshotId).slice(0, 2)).toEqual([1, 2]);
  });
  it('with the default floor frame 2 stays in the bin, ineligible', async () => {
    const { result } = renderHook(() => useSoloState('sunset', D));
    await waitFor(() => expect(result.current.projected).toBeDefined());
    expect(result.current.projected!.bins.sunset[0]).toMatchObject({ snapshotId: 2, eligible: false });
  });
});
```

- [ ] **Step 2: Implement**

```ts
'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { buildStateView, type StateView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const POLL_MS = 5_000;

/**
 * One feed's bins as the server sees them, plus the same bins re-projected
 * with the STUDIO dials so a dial move is visible before the PATCH lands and
 * before Deploy. `server` is what the glass is doing; `projected` is what it
 * would do with these dials.
 */
export function useSoloState(feed: Feed, studioDials: SoloDials) {
  const { data, error } = useSWR<StateView>(`/api/kiosk/solo/state?feed=${feed}`, fetcher, {
    refreshInterval: POLL_MS,
  });
  const projected = useMemo(() => {
    if (!data) return undefined;
    const screen = data.current
      ? { feed, currentSnapshotId: data.current.entry.snapshotId, shownSince: data.current.shownSince,
          slot: data.current.slot, sunsetStreak: 0 }
      : null;
    return buildStateView({
      feed, dials: studioDials, entries: data.entries, screen, nowMs: Date.now(),
      admitted: data.lastPull.admitted, zone: data.zone,
    });
  }, [data, feed, studioDials]);
  return { server: data, projected, error: error ? String(error) : undefined };
}
```

`sunsetStreak` is not in the response; the projection starts the streak at 0, which can differ from the server by at most one draw. Note this in a comment; the server's own `next` is the authority and both are shown when they differ (Task 6).

- [ ] **Step 3: Run tests, lint, commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-studio" ] && git add app/studio/solo/useSoloState.ts app/studio/solo/useSoloState.test.tsx && git commit -m "feat(solo-studio): useSoloState polls and re-projects with studio dials"
```

---

### Task 4: `RulesBox` and `SoloRail`

**Files:**
- Create: `app/studio/solo/RulesBox.tsx` (+ test), `app/studio/solo/SoloRail.tsx` (+ test)

**Interfaces:**
- `RulesBox({ dials }: { dials: SoloDials })` renders five lines, each rule with the current numbers in `<b>`.
- `SoloRail({ api, deploySlot }: { api: StudioSettingsApi; deploySlot: ReactNode })` renders: deploySlot; a line with the glass version and panel; group headers "Glass · what the screen draws" (amber) and "Bins · the ordering algorithm" (teal); one control per knob in `SOLO_SETTINGS_SCHEMA` for that section (range input with a value readout for numbers, checkbox for booleans), label bold when the key is in `api.diffByNamespace.solo`; a "reset" button per group calling `api.resetSection('solo', section)`; `RulesBox` at the bottom.

- [ ] **Step 1: Tests**

```tsx
// RulesBox.test.tsx
import { render, screen } from '@testing-library/react';
import { RulesBox } from './RulesBox';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

it('states the five rules with the dial values in force', () => {
  const d = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
  render(<RulesBox dials={{ ...d, repeatAllowance: 2, sunsetFloor: 4, mix: 3 }} />);
  expect(screen.getByText(/minus/).textContent).toContain('2');
  expect(screen.getByText(/sunsets only/).textContent).toContain('4');
  expect(screen.getByText(/per non-sunset/).textContent).toContain('3');
  expect(screen.getByText(/Never the same frame twice/)).toBeInTheDocument();
  expect(screen.getByText(/Floors/).textContent).toContain('0.55');
});
```

```tsx
// SoloRail.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SoloRail } from './SoloRail';
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults, mergeSettings } from '@/app/lib/settings/schema';
import type { StudioSettingsApi } from '../useStudioSettings';

function api(over: Partial<StudioSettingsApi> = {}): StudioSettingsApi {
  return {
    loading: false, studio: undefined, live: undefined, lastPollAt: null, liveRevision: 3,
    effective: (ns) => (ns === 'solo' ? mergeSettings(SOLO_SETTINGS_SCHEMA, {}) : { activeVersion: 'v1', panelPreset: 'dell' }),
    setKnob: vi.fn(), resetSection: vi.fn(), applyNamespace: () => [],
    diffByNamespace: { solo: ['mix'] }, diffCount: 1,
    deploy: async () => {}, revert: async () => {}, deployedAtMs: null, droppedKeys: [],
    ...over,
  };
}

it('renders every solo knob under its group and marks the differing one', () => {
  render(<SoloRail api={api()} deploySlot={<span>DEPLOY</span>} />);
  expect(screen.getByText('DEPLOY')).toBeInTheDocument();
  for (const k of SOLO_SETTINGS_SCHEMA) expect(screen.getByLabelText(k.label)).toBeInTheDocument();
  expect(screen.getByText('mix (sunsets per non-sunset)').closest('label')).toHaveStyle({ fontWeight: 700 });
});

it('a range change calls setKnob with a number; a checkbox with a boolean', () => {
  const a = api();
  render(<SoloRail api={a} deploySlot={null} />);
  fireEvent.change(screen.getByLabelText('dwell (s)'), { target: { value: '30' } });
  expect(a.setKnob).toHaveBeenCalledWith('solo', 'dwellS', 30);
  fireEvent.click(screen.getByLabelText('scores'));
  expect(a.setKnob).toHaveBeenCalledWith('solo', 'showScores', true);
});

it('reset buttons clear one section each', () => {
  const a = api();
  render(<SoloRail api={a} deploySlot={null} />);
  fireEvent.click(screen.getByText('reset glass'));
  expect(a.resetSection).toHaveBeenCalledWith('solo', 'glass');
});
```

Use `vi` from vitest in the imports.

- [ ] **Step 2: Implement `RulesBox.tsx`**

```tsx
'use client';

import type { SoloDials } from '@/app/lib/solo/types';

const box = { fontSize: 11.5, color: '#9aa3b2', border: '1px dashed #2a3242', borderRadius: 6, padding: '8px 10px', marginTop: 8, lineHeight: 1.5 } as const;
const B = ({ children }: { children: React.ReactNode }) => <b style={{ color: '#4fd1c5' }}>{children}</b>;

/** Spec §4, restated with the dial values currently in force. */
export function RulesBox({ dials: d }: { dials: SoloDials }) {
  return (
    <div style={box} title="The ordering rules, in the order they apply, with the current dial values substituted.">
      <div><B>1.</B> Lowest tier first across both bins; tier = shown tally, minus <B>{d.repeatAllowance}</B> for sunsets.</div>
      <div><B>2.</B> In a tier: <B>{d.sunsetFloor}</B>+ sunsets → sunsets only, else <B>{d.mix}</B> sunsets per non-sunset.</div>
      <div><B>3.</B> In a bin: best score first{d.promoteNew ? ', new frames +0.10' : ''}.</div>
      <div><B>4.</B> Never the same frame twice in a row.</div>
      <div><B>5.</B> Floors: sunsets q ≥ <B>{d.qualityFloor.toFixed(2)}</B>, non-sunsets d ≥ <B>{d.detectionFloor.toFixed(2)}</B>.</div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `SoloRail.tsx`**

```tsx
'use client';

import type { ReactNode } from 'react';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
import { SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import type { KnobDescriptor } from '@/app/lib/settings/schema';
import type { StudioSettingsApi } from '../useStudioSettings';
import { RulesBox } from './RulesBox';

const GROUPS = [
  { section: 'glass', title: 'Glass · what the screen draws', color: '#f5a344',
    hint: 'These change what the screens draw. They never change which frame comes next.' },
  { section: 'bins', title: 'Bins · the ordering algorithm', color: '#4fd1c5',
    hint: 'These change which frame comes next. The queue re-runs the moment one moves.' },
] as const;

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function Control({ knob, value, differs, onChange }: {
  knob: KnobDescriptor; value: number | boolean | string; differs: boolean;
  onChange: (v: number | boolean) => void;
}) {
  const id = `solo-${knob.key}`;
  const labelStyle = { color: '#c3cad6', fontSize: 12, fontWeight: differs ? 700 : 400, cursor: 'help' } as const;
  if (knob.kind === 'boolean') {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 4px' }}>
        <label htmlFor={id} title={knob.description} style={labelStyle}>{knob.label}</label>
        <input id={id} type="checkbox" checked={value as boolean} onChange={(e) => onChange(e.target.checked)} />
      </div>
    );
  }
  if (knob.kind === 'number') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px', gap: 6, alignItems: 'center', padding: '3px 4px' }}>
        <label htmlFor={id} title={knob.description} style={labelStyle}>{knob.label}</label>
        <span style={{ fontFamily: mono, fontSize: 12, color: '#e5e7eb', textAlign: 'right' }}>{value}</span>
        <input id={id} type="range" min={knob.min} max={knob.max} step={knob.step} value={value as number}
          onChange={(e) => onChange(Number(e.target.value))} style={{ gridColumn: '1 / 2', width: '100%' }} />
      </div>
    );
  }
  return null; // no enum knobs in the solo schema
}

export function SoloRail({ api, deploySlot }: { api: StudioSettingsApi; deploySlot: ReactNode }) {
  const values = api.effective(SOLO_NAMESPACE);
  const shared = api.effective(SHARED_NAMESPACE);
  const diff = new Set(api.diffByNamespace[SOLO_NAMESPACE] ?? []);
  return (
    <div style={{ fontSize: 12 }}>
      {deploySlot}
      <div style={{ fontFamily: mono, color: '#8b95a7', padding: '6px 4px' }}
        title="Which version the glass runs and the panel geometry. Both are shared dials, set on /studio.">
        glass {String(shared.activeVersion)} · panel {String(shared.panelPreset)}
      </div>
      {GROUPS.map((g) => (
        <section key={g.section}>
          <h4 title={g.hint} style={{ margin: '10px 0 6px', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase',
            padding: '4px 8px', borderRadius: 4, background: `${g.color}22`, color: g.color, borderLeft: `3px solid ${g.color}`,
            display: 'flex', justifyContent: 'space-between' }}>
            <span>{g.title}</span>
            <button type="button" onClick={() => api.resetSection(SOLO_NAMESPACE, g.section)}
              style={{ background: 'transparent', border: 0, color: g.color, fontSize: 10, cursor: 'pointer' }}>
              reset {g.section}
            </button>
          </h4>
          {SOLO_SETTINGS_SCHEMA.filter((k) => k.section === g.section).map((k) => (
            <Control key={k.key} knob={k} value={values[k.key]} differs={diff.has(k.key)}
              onChange={(v) => api.setKnob(SOLO_NAMESPACE, k.key, v)} />
          ))}
        </section>
      ))}
      <RulesBox dials={dialsFrom(values)} />
    </div>
  );
}
```

- [ ] **Step 4: Run tests, lint, commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-studio" ] && git add app/studio/solo/RulesBox.tsx app/studio/solo/RulesBox.test.tsx app/studio/solo/SoloRail.tsx app/studio/solo/SoloRail.test.tsx && git commit -m "feat(solo-studio): dial rail in two colour groups with a live rules box"
```

---

### Task 5: `EntryRow`

**Files:**
- Create: `app/studio/solo/EntryRow.tsx`, `app/studio/solo/EntryRow.test.tsx`

**Interfaces:**
- `EntryRow({ entry, feed, place, onGlass, repeat, onClick })` where `place: 'sunset' | 'non_sunset' | 'queue'`, `onGlass` draws the amber ring, `repeat` dims and prefixes "repeat", tags rendered: NEW (`isNew`), FLOOR (`!eligible`), `CAM n/m` via optional `cameraIndex?: { n: number; m: number }`.

- [ ] **Step 1: Test**

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { EntryRow } from './EntryRow';

const e = { snapshotId: 7, webcamId: 3, bin: 'sunset' as const, quality: 0.91, detection: 0.88, isNew: true,
  tally: 2, enteredAt: 0, imageUrl: 'u', title: 'Pier', city: 'Lisbon', region: '', country: 'Portugal', eligible: true, rank: 1 };

it('shows tally first, scores, place, and the tags', () => {
  render(<EntryRow entry={e} feed="sunset" place="sunset" onClick={vi.fn()} />);
  expect(screen.getByText('shown ×2')).toHaveStyle({ fontWeight: 800 });
  expect(screen.getByText(/q 0\.91/)).toBeInTheDocument();
  expect(screen.getByText(/d 0\.88/)).toBeInTheDocument();
  expect(screen.getByText('NEW')).toBeInTheDocument();
  expect(screen.getByText(/Lisbon, Portugal/)).toBeInTheDocument();
});

it('marks ineligible frames FLOOR and repeats as repeat', () => {
  render(<EntryRow entry={{ ...e, eligible: false, isNew: false }} feed="sunset" place="sunset" onClick={vi.fn()} />);
  expect(screen.getByText('FLOOR')).toBeInTheDocument();
  render(<EntryRow entry={e} feed="sunset" place="queue" repeat onClick={vi.fn()} />);
  expect(screen.getByText(/repeat/)).toBeInTheDocument();
});

it('non-sunset rows show only detection, and a click reports the entry', () => {
  const onClick = vi.fn();
  render(<EntryRow entry={{ ...e, bin: 'non_sunset', quality: null }} feed="sunset" place="non_sunset" onClick={onClick} />);
  expect(screen.queryByText(/q /)).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 7 }));
});
```

- [ ] **Step 2: Implement**

```tsx
'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';

const COLOR = { sunset: '#7ee2ac', non_sunset: '#c3cad6' } as const;
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function Tag({ children, bg, fg, title }: { children: string; bg: string; fg: string; title: string }) {
  return <span title={title} style={{ display: 'inline-block', fontSize: 8.5, fontWeight: 700, padding: '1px 4px', borderRadius: 3, marginRight: 3, background: bg, color: fg, cursor: 'help' }}>{children}</span>;
}

export function EntryRow({ entry: e, feed, place, onGlass = false, repeat = false, cameraIndex, onClick }: {
  entry: EntryView;
  feed: Feed;
  place: 'sunset' | 'non_sunset' | 'queue';
  onGlass?: boolean;
  repeat?: boolean;
  cameraIndex?: { n: number; m: number };
  onClick: (entry: EntryView) => void;
}) {
  const scores = e.bin === 'sunset' ? `q ${(e.quality ?? 0).toFixed(2)} d ${e.detection.toFixed(2)}` : `d ${e.detection.toFixed(2)}`;
  const placeText = [e.city, e.country].filter(Boolean).join(', ');
  const title = `${e.title} · ${placeText}. Frame ${e.snapshotId}, ${feed} feed. ` +
    (e.bin === 'sunset' ? 'Sunset bin, ordered by quality. ' : 'Non-sunset bin, ordered by detection. ') +
    (!e.eligible ? 'Below the floor dial; not eligible. ' : '') +
    (repeat ? 'Already appears earlier in the queue; this is a repeat showing. ' : '') +
    `Shown ${e.tally} time${e.tally === 1 ? '' : 's'} today.`;
  return (
    <button type="button" onClick={() => onClick(e)} title={title}
      style={{ display: 'grid', gridTemplateColumns: '46px 1fr', gap: 5, alignItems: 'center', width: '100%', textAlign: 'left',
        border: `1.5px solid ${COLOR[e.bin]}`, borderRadius: 5, padding: 3, marginBottom: 4, background: '#0e1119',
        fontFamily: mono, fontSize: 9.5, color: '#9aa3b2', cursor: 'pointer',
        opacity: !e.eligible || repeat ? 0.45 : 1, boxShadow: onGlass ? '0 0 0 2px #f5a344' : undefined }}>
      <img src={e.imageUrl} alt="" style={{ width: 46, aspectRatio: '16/9', objectFit: 'cover', borderRadius: 3, display: 'block' }} />
      <div style={{ minWidth: 0 }}>
        <span style={{ fontWeight: e.tally > 0 ? 800 : 500, color: e.tally > 0 ? '#e5e7eb' : '#6b7280' }}>shown ×{e.tally}</span>
        {' · '}{scores}{repeat ? ' · repeat' : ''}
        <div style={{ marginTop: 2 }}>
          {e.isNew && <Tag bg="#f5a344" fg="#1a1000" title="Newer frame from a camera already in the bin">NEW</Tag>}
          {!e.eligible && <Tag bg="#3a4356" fg="#e5e7eb" title="Below the floor dial">FLOOR</Tag>}
          {cameraIndex && <Tag bg="#7ea6e2" fg="#061224" title="Same camera as another queue entry">{`CAM ${cameraIndex.n}/${cameraIndex.m}`}</Tag>}
        </div>
        <div style={{ color: '#c3cad6', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
        <div style={{ color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{placeText}</div>
      </div>
    </button>
  );
}
```

`place` is accepted for the queue's bin-coloured outline logic (the outline follows `e.bin` in every place, which is the spec), so it is only used in the tooltip.

- [ ] **Step 3: Run tests, lint, commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-studio" ] && git add app/studio/solo/EntryRow.tsx app/studio/solo/EntryRow.test.tsx && git commit -m "feat(solo-studio): EntryRow"
```

---

### Task 6: `FeedColumn`

**Files:**
- Create: `app/studio/solo/FeedColumn.tsx`, `app/studio/solo/FeedColumn.test.tsx`

**Interfaces:**
- `FeedColumn({ feed, server, projected, liveDials, studioDials, nowMs, onSelect })`
  - Header: feed label, `next frame in N s` from `nextBoundaryMs(nowMs, feed, liveDials.dwellS, liveDials.offsetS)`.
  - Panel: `server.current.entry.imageUrl` (or a dark placeholder "nothing on glass yet: phase 2 renderer not live") with overlays per `liveDials.show*`, a draining bar.
  - Three columns from `projected`: sunset bin, non-sunset bin, queue (current first with the ring, then `next`). Queue rows get `repeat` when the snapshotId appeared earlier in the queue, and `cameraIndex` when the same webcamId appears more than once.
  - Bin headers: `Sunset bin · N waiting · M queued`.
  - When `projected.next` differs from `server.next` in its first entry, a small amber line under the queue header: "projected with studio dials; glass will draw {server.next[0].title}".

- [ ] **Step 1: Test**

```tsx
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { FeedColumn } from './FeedColumn';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { buildStateView } from '@/app/api/kiosk/solo/view';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const entry = (id: number, bin: 'sunset' | 'non_sunset', score: number, webcamId = 100 + id) => ({
  snapshotId: id, webcamId, bin, quality: bin === 'sunset' ? score : null, detection: bin === 'sunset' ? 0.9 : score,
  isNew: false, tally: 0, enteredAt: id, imageUrl: `u${id}`, title: `cam${id}`, city: '', region: '', country: '',
});
const view = (dials = D) => buildStateView({
  feed: 'sunset', dials, entries: [entry(1, 'sunset', 0.9), entry(2, 'sunset', 0.8, 101), entry(3, 'non_sunset', 0.5), entry(4, 'sunset', 0.1)],
  screen: { feed: 'sunset', currentSnapshotId: 1, shownSince: 0, slot: 0, sunsetStreak: 1 },
  nowMs: 0, admitted: { sunset: 1, nonSunset: 0 }, zone: { minDeg: -24, maxDeg: -2 },
});

it('draws the on-glass frame at the top of the queue and keeps queued frames out of the bins', () => {
  const v = view();
  render(<FeedColumn feed="sunset" server={v} projected={v} liveDials={D} studioDials={D} nowMs={5_000} onSelect={vi.fn()} />);
  expect(screen.getByText(/next frame in 15 s/)).toBeInTheDocument();
  expect(screen.getByText(/Sunset bin · 1 waiting/)).toBeInTheDocument(); // frame 4 (below floor) waits
  expect(screen.getAllByText('cam1').length).toBeGreaterThan(0);
  expect(screen.getByText(/CAM 1\/2/)).toBeInTheDocument(); // frames 1 and 2 share webcam 101
});

it('says so when the studio dials would draw a different next frame than the glass', () => {
  const server = view();
  const projected = view({ ...D, promoteNew: true, qualityFloor: 0.05 });
  render(<FeedColumn feed="sunset" server={server} projected={projected} liveDials={D} studioDials={D} nowMs={0} onSelect={vi.fn()} />);
  expect(screen.getByText(/projected with studio dials/)).toBeInTheDocument();
});
```

If the second test's projection happens to match, change the projected dials to `{ ...D, repeatAllowance: 0 }` and a fixture where that changes the first draw.

- [ ] **Step 2: Implement**

```tsx
'use client';

import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';
import { nextBoundaryMs } from '@/app/lib/solo/schedule';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import { EntryRow } from './EntryRow';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const LABEL: Record<Feed, string> = { sunrise: 'Sunrise · left screen', sunset: 'Sunset · right screen' };

function Bin({ color, title, hint, children }: { color: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ border: `2px solid ${color}`, borderRadius: 8, background: '#0b0e14', padding: 5, minWidth: 0 }}>
      <h5 title={hint} style={{ margin: '0 0 6px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em', color, cursor: 'help' }}>{title}</h5>
      {children}
    </div>
  );
}

export function FeedColumn({ feed, server, projected, liveDials, studioDials, nowMs, onSelect }: {
  feed: Feed; server: StateView; projected: StateView; liveDials: SoloDials; studioDials: SoloDials;
  nowMs: number; onSelect: (entry: EntryView, feed: Feed) => void;
}) {
  const boundary = nextBoundaryMs(nowMs, feed, liveDials.dwellS, liveDials.offsetS);
  const leftS = Math.max(0, Math.ceil((boundary - nowMs) / 1000));
  const current = server.current;
  const queue: EntryView[] = [...(current ? [current.entry] : []), ...projected.next];
  const seen = new Set<number>();
  const camCount = new Map<number, number>();
  for (const e of queue) camCount.set(e.webcamId, (camCount.get(e.webcamId) ?? 0) + 1);
  const camSeen = new Map<number, number>();
  const differs = server.next[0] && projected.next[0] && server.next[0].snapshotId !== projected.next[0].snapshotId;
  const qSun = queue.filter((e) => e.bin === 'sunset').length;
  const qNon = queue.length - qSun;

  const caption = current && (
    <>
      {liveDials.showPlace && (
        <div style={{ position: 'absolute', left: 12, bottom: 10, color: '#fff', textShadow: '0 1px 3px #000', fontSize: 14 }}>
          {current.entry.title}
          <small style={{ display: 'block', fontSize: 11, opacity: 0.8 }}>{[current.entry.region, current.entry.country].filter(Boolean).join(', ')}</small>
        </div>
      )}
      <div style={{ position: 'absolute', right: 12, bottom: 10, color: '#fff', textShadow: '0 1px 3px #000', fontFamily: mono, fontSize: 12, textAlign: 'right' }}>
        {liveDials.showTally && <div>shown <b style={{ color: '#f5a344' }}>×{current.entry.tally}</b></div>}
        {liveDials.showRank && <div>{current.entry.bin === 'sunset' ? 'sunset' : 'non-sunset'} bin #{current.entry.rank}</div>}
        {liveDials.showScores && <div>{current.entry.bin === 'sunset' ? `q ${(current.entry.quality ?? 0).toFixed(2)} · ` : ''}d {current.entry.detection.toFixed(2)}</div>}
      </div>
      <div style={{ position: 'absolute', left: 0, bottom: 0, height: 3, background: '#f5a344', width: `${(leftS / liveDials.dwellS) * 100}%` }} />
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h3 style={{ margin: 0, fontSize: 13, color: '#9aa3b2', display: 'flex', justifyContent: 'space-between' }}>
        <span>{LABEL[feed]}</span>
        <span title="Time until this screen changes, on the live dials' clock">next frame in <b style={{ color: '#f5a344', fontFamily: mono }}>{leftS} s</b></span>
      </h3>
      <div title={current ? 'What this screen is drawing right now, with the on-glass overlays as deployed' : 'Nothing on glass yet: the solo renderer is not live, or no frame is eligible'}
        onClick={() => current && onSelect(current.entry, feed)}
        style={{ position: 'relative', aspectRatio: '16 / 9', background: '#000', border: '1px solid #2a3242', borderRadius: 6, overflow: 'hidden', cursor: current ? 'pointer' : 'default' }}>
        {current ? <img src={current.entry.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ color: '#4b5568', fontFamily: mono, fontSize: 12, padding: 12 }}>nothing on glass yet</div>}
        {caption}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.15fr', gap: 6 }}>
        <Bin color="#7ee2ac" title={`Sunset bin · ${projected.bins.sunset.length} waiting · ${qSun} queued`}
          hint="Frames the detection head calls a sunset, ordered by quality. Shown frames sink below unshown ones. Dimmed rows are below the quality floor.">
          {projected.bins.sunset.map((e) => <EntryRow key={e.snapshotId} entry={e} feed={feed} place="sunset" onClick={(x) => onSelect(x, feed)} />)}
        </Bin>
        <Bin color="#c3cad6" title={`Non-sunset bin · ${projected.bins.nonSunset.length} waiting · ${qNon} queued`}
          hint="Frames the detection head does not call a sunset, ordered by detection probability so 'almost a sunset' is on top. Dimmed rows are below the detection floor.">
          {projected.bins.nonSunset.map((e) => <EntryRow key={e.snapshotId} entry={e} feed={feed} place="non_sunset" onClick={(x) => onSelect(x, feed)} />)}
        </Bin>
        <Bin color="#4b5568" title="On glass + next up"
          hint="The play order for this screen, computed from both bins by the five rules with the STUDIO dials. Top row is on glass. Row outline = which bin it came from. A queued frame is no longer in its bin.">
          {differs && <div style={{ fontSize: 10, color: '#f5a344', marginBottom: 4 }}>projected with studio dials; glass will draw {server.next[0].title}</div>}
          {queue.map((e, i) => {
            const repeat = seen.has(e.snapshotId); seen.add(e.snapshotId);
            const m = camCount.get(e.webcamId) ?? 1;
            const n = (camSeen.get(e.webcamId) ?? 0) + 1; camSeen.set(e.webcamId, n);
            return <EntryRow key={`${e.snapshotId}-${i}`} entry={e} feed={feed} place="queue" onGlass={i === 0 && !!current}
              repeat={repeat} cameraIndex={m > 1 ? { n, m } : undefined} onClick={(x) => onSelect(x, feed)} />;
          })}
        </Bin>
      </div>
    </div>
  );
}
```

`studioDials` is accepted so the header can later say which dials the projection used; it is unused in this task beyond the prop, and that is fine.

- [ ] **Step 3: Run tests, lint, commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-studio" ] && git add app/studio/solo/FeedColumn.tsx app/studio/solo/FeedColumn.test.tsx && git commit -m "feat(solo-studio): FeedColumn with panel, countdown, bins, and queue"
```

---

### Task 7: `SoloStatusStrip`, `SoloStudioClient`, the page, and the link

**Files:**
- Create: `app/studio/solo/SoloStatusStrip.tsx` (+ test), `app/studio/solo/SoloStudioClient.tsx`, `app/studio/solo/page.tsx`
- Modify: `app/studio/StudioClient.tsx` (a link pill next to the collapse pill area; see below)

**Interfaces:**
- `SoloStatusStrip({ nowMs, sunrise, sunset, liveRevision, diffCount, zone })` where `sunrise`/`sunset` are `StateView | undefined`.

- [ ] **Step 1: Strip test**

```tsx
import { render, screen } from '@testing-library/react';
import { SoloStatusStrip } from './SoloStatusStrip';

it('counts down to the next pull, reports the last pull per feed, the glass revision, and the zone', () => {
  const lastPull = { admitted: { sunset: 3, nonSunset: 4 } };
  const v = (feed: 'sunrise' | 'sunset') => ({ feed, lastPull } as never);
  render(<SoloStatusStrip nowMs={60_000} sunrise={v('sunrise')} sunset={v('sunset')} liveRevision={41} diffCount={3} zone={{ minDeg: -24, maxDeg: 14 }} />);
  expect(screen.getByText('9:00')).toBeInTheDocument();
  expect(screen.getByText(/↑ 3 \+ 4 · ↓ 3 \+ 4/)).toBeInTheDocument();
  expect(screen.getByText(/rev 41/)).toBeInTheDocument();
  expect(screen.getByText(/3 differ/)).toBeInTheDocument();
  expect(screen.getByText(/−24° … \+14°/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement the strip**

```tsx
'use client';

import type { StateView } from '@/app/api/kiosk/solo/view';
import type { Zone } from '@/app/lib/solo/zone';
import { formatCountdown, nextCronMs } from './countdown';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const item = { marginRight: 18, cursor: 'help' } as const;
const fmtDeg = (d: number) => `${d < 0 ? '−' : '+'}${Math.abs(d)}°`;

export function SoloStatusStrip({ nowMs, sunrise, sunset, liveRevision, diffCount, zone }: {
  nowMs: number; sunrise?: StateView; sunset?: StateView; liveRevision: number; diffCount: number; zone?: Zone;
}) {
  const pull = (v?: StateView) => (v ? `${v.lastPull.admitted.sunset} + ${v.lastPull.admitted.nonSunset}` : '–');
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', fontFamily: mono, fontSize: 12, color: '#9aa3b2', height: '100%' }}>
      <span style={item} title="The cron pulls every camera in the sweep from Windy on this clock. New frames enter the bins right after it runs.">
        next pull in <b style={{ color: '#f5a344' }}>{formatCountdown(nextCronMs(nowMs) - nowMs)}</b>
      </span>
      <span style={item} title="Frames the last pull admitted, sunsets + non-sunsets, per feed (↑ sunrise, ↓ sunset).">
        last pull: <b style={{ color: '#e5e7eb' }}>↑ {pull(sunrise)} · ↓ {pull(sunset)}</b>
      </span>
      <span style={item} title="The live settings revision the glass reads, and how many studio dials differ from it.">
        glass <b style={{ color: '#e5e7eb' }}>rev {liveRevision}</b>{diffCount > 0 ? ` · ${diffCount} differ` : ' · dials match glass'}
      </span>
      {zone && (
        <span style={item} title="The sweep zone in solar altitude; cameras outside it leave the bins after the grace.">
          zone <b style={{ color: '#e5e7eb' }}>{fmtDeg(zone.minDeg)} … {fmtDeg(zone.maxDeg)}</b>
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `SoloStudioClient.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useStudioSettings } from '../useStudioSettings';
import { DeployButton } from '../DeployButton';
import { SoloRail } from './SoloRail';
import { FeedColumn } from './FeedColumn';
import { SoloStatusStrip } from './SoloStatusStrip';
import { useSoloState } from './useSoloState';
import { toWebcam } from './toWebcam';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
import { mergeSettings } from '@/app/lib/settings/schema';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';
import { FrameLabelCard } from '@/app/components/Webcam/FrameLabelCard';

const bg = '#0b0e14';
const railBg = '#10141d';
const border = '#1d2432';

export function SoloStudioClient() {
  const api = useStudioSettings();
  const studioDials = dialsFrom(api.effective(SOLO_NAMESPACE));
  const liveDials = dialsFrom(mergeSettings(SOLO_SETTINGS_SCHEMA, api.live?.namespaces?.[SOLO_NAMESPACE]));
  const sunrise = useSoloState('sunrise', studioDials);
  const sunset = useSoloState('sunset', studioDials);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selected, setSelected] = useState<{ entry: EntryView; feed: Feed } | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gridTemplateRows: '30px 1fr', height: '100vh', background: bg, color: '#e5e7eb', overflow: 'hidden' }}>
      <div style={{ gridColumn: '1 / -1', background: '#0e1119', borderBottom: `1px solid ${border}`, display: 'flex', alignItems: 'center' }}>
        <SoloStatusStrip nowMs={nowMs} sunrise={sunrise.server} sunset={sunset.server}
          liveRevision={api.liveRevision} diffCount={api.diffCount} zone={sunset.server?.zone ?? sunrise.server?.zone} />
        <Link href="/studio" style={{ marginLeft: 'auto', marginRight: 12, fontSize: 11, color: '#8b95a7' }} title="The mosaic studio">← mosaic studio</Link>
      </div>
      <aside style={{ background: railBg, borderRight: `1px solid ${border}`, padding: 10, overflowY: 'auto' }}>
        <SoloRail api={api} deploySlot={<DeployButton diffCount={api.diffCount} onDeploy={api.deploy} onRevert={api.revert} />} />
      </aside>
      <main style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 12, overflowY: 'auto', minWidth: 0 }}>
        {(['sunrise', 'sunset'] as const).map((feed) => {
          const s = feed === 'sunrise' ? sunrise : sunset;
          return s.server && s.projected ? (
            <FeedColumn key={feed} feed={feed} server={s.server} projected={s.projected} liveDials={liveDials}
              studioDials={studioDials} nowMs={nowMs} onSelect={(entry, f) => setSelected({ entry, feed: f })} />
          ) : (
            <div key={feed} style={{ color: '#4b5568', fontFamily: 'monospace', fontSize: 12 }}>{s.error ?? `loading ${feed}…`}</div>
          );
        })}
      </main>
      {selected && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
          style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: railBg, border: `1px solid ${border}`, borderRadius: 10, width: 'min(760px, 92vw)', padding: 14 }}>
            <button type="button" onClick={() => setSelected(null)} style={{ float: 'right', background: 'transparent', color: '#8b95a7', border: `1px solid ${border}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>close</button>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#9aa3b2', marginBottom: 8 }}>
              frame {selected.entry.snapshotId} · {selected.entry.bin === 'sunset' ? 'sunset' : 'non-sunset'} bin · shown ×{selected.entry.tally}
            </div>
            <FrameLabelCard webcam={toWebcam(selected.entry, selected.feed)} allowCapture={false} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `page.tsx`**

```tsx
'use client';

import { Suspense } from 'react';
import { OwnerGate } from '@/app/components/auth/OwnerGate';
import { SoloStudioClient } from './SoloStudioClient';

export default function SoloStudioPage() {
  return (
    <Suspense fallback={null}>
      <OwnerGate label="Solo studio">
        <SoloStudioClient />
      </OwnerGate>
    </Suspense>
  );
}
```

- [ ] **Step 5: Link from the mosaic studio**

In `app/studio/StudioClient.tsx`, inside the `<aside>` before `<StudioRail`, add:

```tsx
          <a href="/studio/solo" title="The solo kiosk's studio: bins, queue, and its own dials"
            style={{ display: 'block', fontSize: 11, color: '#8b95a7', marginBottom: 6 }}>solo studio →</a>
```

- [ ] **Step 6: Run everything**

Run: `npx vitest run app/studio app/api/kiosk/solo && npx eslint app/studio/solo app/studio/StudioClient.tsx && npm run build`
Expected: PASS, clean, build succeeds and lists `/studio/solo`.

- [ ] **Step 7: Commit, push, PR**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-studio" ] && git add app/studio/solo app/studio/StudioClient.tsx && git commit -m "feat(solo-studio): /studio/solo — bins, queue, dials, rules, countdowns, click-to-rate"
GIT_TERMINAL_PROMPT=0 git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin feat/solo-studio
```

PR title: `feat(solo): /studio/solo, the bins transparency surface (phase 3)`.

---

## Self-review against the spec §6.4

- Status strip: cron countdown, last pull per bin, glass revision + diff, zone ✔ (Task 7)
- Rail in two colour groups, rules box with live values, tooltips ✔ (Task 4)
- Two feed columns, panel with overlays and draining bar, three bins with the queue in the bin's colour, amber ring on glass, `N waiting · M queued` ✔ (Task 6)
- Rows: thumbnail, `shown ×N` first, scores, camera, place, tags NEW / FLOOR / LEFT ZONE / CAM n/m ✔ (Task 5; LEFT ZONE rows are not returned by the active-entries query, so that tag waits for the removed-rows listing in phase 5)
- Click → `FrameLabelCard` against the archive row ✔ (Task 7)
- Projection with studio dials, glass on live dials ✔ (Tasks 3, 6)
- Repeats drawn visibly (the phase 1 note) ✔ (Task 5, 6)
