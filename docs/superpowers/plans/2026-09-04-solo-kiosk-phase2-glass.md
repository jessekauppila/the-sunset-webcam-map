# Solo Kiosk Phase 2 (Glass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `solo` renderer: one archived frame filling each screen, advancing on the clock-derived schedule through `POST /api/kiosk/solo/advance`, with the next frame preloaded, an optional crossfade, and the on-glass overlays. Registered as a version so the existing active-version dial flips the glass to it and back.

**Architecture:** `app/components/solo/` holds a `MosaicComponent` that ignores the `webcams` prop and drives itself from the phase 1 endpoints. A hook owns the loop: fetch state, sleep until the next boundary (live dials), advance with that slot, swap the frame, preload the next. Two stacked images give the crossfade. Two new landscape panel presets. `MosaicProps` gains two optional flags, `dozing` and `driveSchedule`, so the kiosk pages can stop the loop while dozing and `/studio`'s preview can follow the glass without advancing it.

**Tech Stack:** React client component, Vitest + Testing Library with fake timers and a stubbed `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-04-solo-kiosk-design.md` §6.2, §6.3.

## Global Constraints

- Branch `feat/solo-glass` from `main` after PR #132 merges (needs `ViewEntry`/`entries` from phase 3's view change). Worktree via `scripts/wt.sh new feat/solo-glass`. Verify the branch in the same command as every commit; push with the gh credential helper.
- No new dependencies.
- The renderer never touches `webcams`, `peerWebcams`, or the terminator store.
- Advancing happens only when `driveSchedule !== false` and `dozing !== true`. A preview follows; the glass drives.
- Never advance twice for one slot: the hook remembers the last slot it posted.
- A failed advance or fetch leaves the current frame up and retries at the next boundary. Never a black screen because a request failed.
- Overlays draw only what the live dials say. `?debug=1` on the kiosk route (via `allowDebugOverlays`) adds a small monospace readout: slot, seconds to boundary, queue length, last error.

---

## File structure

| path | responsibility |
|---|---|
| `app/kiosk/panelPreview.ts` (+ test) | `dell-l` 1920×1080, `ktc-l` 2560×1440 |
| `app/components/mosaic/types.ts` | `dozing?: boolean`, `driveSchedule?: boolean` |
| `app/kiosk/sunrise/page.tsx`, `app/kiosk/sunset/page.tsx` | pass `dozing` |
| `app/studio/PreviewPane.tsx` | pass `driveSchedule={false}` |
| `app/components/solo/schedule.ts` (+ test) | `msUntilBoundary` helper on top of `app/lib/solo/schedule.ts` |
| `app/components/solo/useSoloGlass.ts` (+ test) | the loop: state, advance, preload |
| `app/components/solo/SoloFrame.tsx` (+ test) | two-layer image with fade + overlays |
| `app/components/solo/index.tsx` (+ test) | `SoloKiosk: MosaicComponent` |
| `app/components/mosaic/registry.ts` (+ test) | `solo` in `MOSAIC_VERSIONS` |

---

### Task 1: Landscape presets and the two new props

**Files:**
- Modify: `app/kiosk/panelPreview.ts:22-27`, `app/kiosk/panelPreview.test.ts`
- Modify: `app/components/mosaic/types.ts`
- Modify: `app/kiosk/sunrise/page.tsx`, `app/kiosk/sunset/page.tsx`, `app/studio/PreviewPane.tsx`

- [ ] **Step 1: Presets**

```ts
export const PANEL_PRESETS: Record<string, PanelSize> = {
  dell: { width: 1080, height: 1920 },
  ktc: { width: 1440, height: 2560 },
  // The same two panels turned landscape, for the solo kiosk (spec §6.3).
  'dell-l': { width: 1920, height: 1080 },
  'ktc-l': { width: 2560, height: 1440 },
};
```

Update the file's header comment ("portrait — the orientation they hang in") to say both orientations are listed. Add to `panelPreview.test.ts`:

```ts
it('offers each panel in both orientations', () => {
  expect(parsePanelPreview(new URLSearchParams('panel=ktc-l'))).toEqual({ width: 2560, height: 1440 });
  expect(PANEL_PRESETS['dell-l']).toEqual({ width: 1920, height: 1080 });
});
```

- [ ] **Step 2: Props**

In `MosaicProps`, after `allowDebugOverlays`:

```ts
  /**
   * The kiosk is dozing (quiet hours, or the operator's doze switch). A
   * version that advances state on a clock — the solo renderer's tally —
   * must not do so while nobody can see the screen. Mosaic versions ignore it.
   */
  dozing?: boolean;
  /**
   * Whether this surface DRIVES the schedule (calls advance at boundaries) or
   * only FOLLOWS what the glass is showing. Defaults to true; /studio's
   * preview passes false. A preview that advanced the queue would count
   * showings nobody saw on the wall.
   */
  driveSchedule?: boolean;
```

Both kiosk pages: `<Mosaic … dozing={dozing} />` (they already have `dozing` from `useKioskRuntime`). `PreviewPane.tsx`: add `driveSchedule={false}` where it renders the resolved `Mosaic`.

- [ ] **Step 3: Run and commit**

Run: `npx vitest run app/kiosk app/studio app/components/mosaic && npx eslint app/kiosk app/studio/PreviewPane.tsx app/components/mosaic/types.ts`

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-glass" ] && git add app/kiosk/panelPreview.ts app/kiosk/panelPreview.test.ts app/components/mosaic/types.ts app/kiosk/sunrise/page.tsx app/kiosk/sunset/page.tsx app/studio/PreviewPane.tsx && git commit -m "feat(solo): landscape panel presets; dozing + driveSchedule props"
```

---

### Task 2: `useSoloGlass`

**Files:**
- Create: `app/components/solo/schedule.ts` (+ test), `app/components/solo/useSoloGlass.ts` (+ test)

**Interfaces:**
- `msUntilBoundary(nowMs, feed, dwellS, offsetS): number` — strictly positive
- `useSoloGlass({ feed, dials, drive, dozing }): { current: EntryView | null; next: EntryView | null; slot: number; boundaryMs: number; error: string | null; queueLength: number }`

- [ ] **Step 1: Tests**

```ts
// schedule.test.ts
import { it, expect } from 'vitest';
import { msUntilBoundary } from './schedule';
it('is the gap to the next boundary, never zero', () => {
  expect(msUntilBoundary(0, 'sunrise', 20, 10)).toBe(20_000);
  expect(msUntilBoundary(19_999, 'sunrise', 20, 10)).toBe(1);
  expect(msUntilBoundary(20_000, 'sunrise', 20, 10)).toBe(20_000);
  expect(msUntilBoundary(0, 'sunset', 20, 10)).toBe(10_000);
});
```

```tsx
// useSoloGlass.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSoloGlass } from './useSoloGlass';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const entry = (id: number) => ({ snapshotId: id, webcamId: 1, bin: 'sunset', quality: 0.9, detection: 0.9, isNew: false,
  tally: 0, enteredAt: 0, imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '', eligible: true, rank: 1 });
const state = (currentId: number | null, nextIds: number[]) => ({
  feed: 'sunrise', dials: D, current: currentId ? { entry: entry(currentId), shownSince: 0, slot: 0 } : null,
  next: nextIds.map(entry), bins: { sunset: [], nonSunset: [] }, schedule: { slot: 0, nextBoundaryMs: 0 },
  lastPull: { admitted: { sunset: 0, nonSunset: 0 } }, entries: [], zone: { minDeg: -24, maxDeg: -2 },
});

let calls: { url: string; body?: unknown }[];
beforeEach(() => {
  calls = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_000_000_000_000)); // sunrise boundary in exactly 0 ms → next at +20 s
  vi.stubGlobal('Image', class { onload: null | (() => void) = null; set src(_v: string) { this.onload?.(); } decode() { return Promise.resolve(); } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes('/advance')) return { ok: true, json: async () => ({ advanced: true, ...state(2, [3]) }) };
    return { ok: true, json: async () => state(1, [2]) };
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('useSoloGlass', () => {
  it('shows the server current, preloads next, and advances at the boundary with the slot', async () => {
    const { result } = renderHook(() => useSoloGlass({ feed: 'sunrise', dials: D, drive: true, dozing: false }));
    await waitFor(() => expect(result.current.current?.snapshotId).toBe(1));
    expect(result.current.next?.snapshotId).toBe(2);
    await act(async () => { vi.advanceTimersByTime(20_000); });
    await waitFor(() => expect(result.current.current?.snapshotId).toBe(2));
    const adv = calls.find((c) => c.url.includes('/advance'));
    expect(adv?.body).toEqual({ feed: 'sunrise', slot: 50_000_001 });
  });
  it('does not advance while dozing or when it only follows', async () => {
    const { result, rerender } = renderHook((p: { drive: boolean; dozing: boolean }) =>
      useSoloGlass({ feed: 'sunrise', dials: D, ...p }), { initialProps: { drive: false, dozing: false } });
    await waitFor(() => expect(result.current.current?.snapshotId).toBe(1));
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(calls.some((c) => c.url.includes('/advance'))).toBe(false);
    rerender({ drive: true, dozing: true });
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(calls.some((c) => c.url.includes('/advance'))).toBe(false);
  });
  it('keeps the frame up and records the error when advance fails', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url.includes('/advance') ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, json: async () => state(1, [2]) });
    const { result } = renderHook(() => useSoloGlass({ feed: 'sunrise', dials: D, drive: true, dozing: false }));
    await waitFor(() => expect(result.current.current?.snapshotId).toBe(1));
    await act(async () => { vi.advanceTimersByTime(20_000); });
    await waitFor(() => expect(result.current.error).toMatch(/500/));
    expect(result.current.current?.snapshotId).toBe(1);
  });
});
```

- [ ] **Step 2: Implement `schedule.ts`**

```ts
import { nextBoundaryMs } from '@/app/lib/solo/schedule';
import type { Feed } from '@/app/lib/solo/types';

/** Milliseconds until this screen's next change. Always > 0. */
export function msUntilBoundary(nowMs: number, feed: Feed, dwellS: number, offsetS: number): number {
  return Math.max(1, nextBoundaryMs(nowMs, feed, dwellS, offsetS) - nowMs);
}
```

- [ ] **Step 3: Implement `useSoloGlass.ts`**

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import type { EntryView, StateView } from '@/app/api/kiosk/solo/view';
import { slotFor } from '@/app/lib/solo/schedule';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import { msUntilBoundary } from './schedule';

const STATE_REFRESH_MS = 60_000;

export interface SoloGlass {
  current: EntryView | null;
  next: EntryView | null;
  slot: number;
  boundaryMs: number;
  error: string | null;
  queueLength: number;
}

function preload(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // a failed preload is not a reason to skip the frame
    img.src = url;
  });
}

/**
 * The glass loop (spec §6.2): read the state, wait for the boundary the wall
 * clock dictates, ask the server for the next frame with that slot, show it,
 * preload the one after. Two tabs stay staggered because both read the same
 * clock; a reload just waits for its next boundary.
 */
export function useSoloGlass({ feed, dials, drive, dozing }: {
  feed: Feed; dials: SoloDials; drive: boolean; dozing: boolean;
}): SoloGlass {
  const [view, setView] = useState<StateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const lastSlotPosted = useRef<number | null>(null);
  const driveRef = useRef(drive);
  const dozingRef = useRef(dozing);
  driveRef.current = drive;
  dozingRef.current = dozing;

  // State refresh: on mount and every minute, so admissions from the cron
  // reach the preload even when nothing advanced.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/kiosk/solo/state?feed=${feed}`);
        if (!res.ok) throw new Error(`state ${res.status}`);
        const v = (await res.json()) as StateView;
        if (!alive) return;
        setView(v);
        if (v.next[0]) void preload(v.next[0].imageUrl);
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    void load();
    const t = setInterval(load, STATE_REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [feed]);

  // The boundary timer. Re-armed after every fire and whenever dials change.
  useEffect(() => {
    const nowMs = Date.now();
    const wait = msUntilBoundary(nowMs, feed, dials.dwellS, dials.offsetS);
    const t = setTimeout(async () => {
      const fireMs = Date.now();
      const slot = slotFor(fireMs, feed, dials.dwellS, dials.offsetS);
      if (driveRef.current && !dozingRef.current && lastSlotPosted.current !== slot) {
        lastSlotPosted.current = slot;
        try {
          const res = await fetch('/api/kiosk/solo/advance', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feed, slot }),
          });
          if (!res.ok) throw new Error(`advance ${res.status}`);
          const v = (await res.json()) as StateView & { advanced: boolean };
          setView(v);
          setError(null);
          if (v.next[0]) void preload(v.next[0].imageUrl);
        } catch (e) {
          setError(String(e));
        }
      }
      setTick((n) => n + 1); // re-arm
    }, wait);
    return () => clearTimeout(t);
  }, [feed, dials.dwellS, dials.offsetS, tick]);

  const nowMs = Date.now();
  return {
    current: view?.current?.entry ?? null,
    next: view?.next[0] ?? null,
    slot: slotFor(nowMs, feed, dials.dwellS, dials.offsetS),
    boundaryMs: nowMs + msUntilBoundary(nowMs, feed, dials.dwellS, dials.offsetS),
    error,
    queueLength: view?.next.length ?? 0,
  };
}
```

A following surface (`drive` false) still refreshes state every minute, so `/studio`'s preview tracks the glass within a minute; it never posts.

- [ ] **Step 4: Run tests, lint, commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-glass" ] && git add app/components/solo/schedule.ts app/components/solo/schedule.test.ts app/components/solo/useSoloGlass.ts app/components/solo/useSoloGlass.test.tsx && git commit -m "feat(solo): useSoloGlass — the clock-driven advance loop with preload"
```

---

### Task 3: `SoloFrame` and the registered renderer

**Files:**
- Create: `app/components/solo/SoloFrame.tsx` (+ test), `app/components/solo/index.tsx` (+ test)
- Modify: `app/components/mosaic/registry.ts`, `app/components/mosaic/registry.test.tsx`

**Interfaces:**
- `SoloFrame({ entry, previous, fadeS, dials, width, height })` renders `previous` under `entry`, the top layer fading in over `fadeS` seconds (0 = instant), `object-fit: cover`, overlays per `dials.showPlace/showScores/showRank/showTally`.
- `SoloKiosk(props: MosaicProps)` — merges `props.settings` over `SOLO_SETTINGS_SCHEMA`, calls `useSoloGlass`, keeps the previous entry for the crossfade, renders `SoloFrame` and, when `allowDebugOverlays && search includes debug=1`, the debug readout.

- [ ] **Step 1: Tests**

```tsx
// SoloFrame.test.tsx
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SoloFrame } from './SoloFrame';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const e = { snapshotId: 1, webcamId: 1, bin: 'sunset' as const, quality: 0.91, detection: 0.88, isNew: false, tally: 2, enteredAt: 0,
  imageUrl: 'u1', title: 'Pier', city: 'Lisbon', region: 'Lisboa', country: 'Portugal', eligible: true, rank: 3 };

it('draws the place by default and nothing else', () => {
  render(<SoloFrame entry={e} previous={null} fadeS={0} dials={D} width={1920} height={1080} />);
  expect(screen.getByText('Pier')).toBeInTheDocument();
  expect(screen.getByText(/Lisboa, Portugal/)).toBeInTheDocument();
  expect(screen.queryByText(/shown/)).toBeNull();
  expect(screen.queryByText(/q 0\.91/)).toBeNull();
});

it('draws scores, rank, and tally when dialled on; hides the place when dialled off', () => {
  render(<SoloFrame entry={e} previous={null} fadeS={0} dials={{ ...D, showPlace: false, showScores: true, showRank: true, showTally: true }} width={1920} height={1080} />);
  expect(screen.queryByText('Pier')).toBeNull();
  expect(screen.getByText(/q 0\.91 · d 0\.88/)).toBeInTheDocument();
  expect(screen.getByText(/sunset bin #3/)).toBeInTheDocument();
  expect(screen.getByText(/×2/)).toBeInTheDocument();
});

it('keeps the previous frame underneath and sets the fade duration on the top layer', () => {
  const prev = { ...e, snapshotId: 0, imageUrl: 'u0' };
  render(<SoloFrame entry={e} previous={prev} fadeS={3} dials={D} width={1920} height={1080} />);
  const imgs = screen.getAllByRole('presentation');
  expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['u0', 'u1']);
  expect(imgs[1]).toHaveStyle({ transition: 'opacity 3s ease' });
});
```

```tsx
// index.test.tsx
import { it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SoloKiosk } from './index';

vi.mock('./useSoloGlass', () => ({
  useSoloGlass: vi.fn(() => ({ current: null, next: null, slot: 1, boundaryMs: 0, error: null, queueLength: 0 })),
}));
import { useSoloGlass } from './useSoloGlass';

it('drives by default on the kiosk and follows in a preview; passes dozing through', () => {
  render(<SoloKiosk webcams={[]} width={100} height={50} feed="sunset" />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ drive: true, dozing: false }));
  render(<SoloKiosk webcams={[]} width={100} height={50} feed="sunset" driveSchedule={false} dozing />);
  expect(useSoloGlass).toHaveBeenLastCalledWith(expect.objectContaining({ drive: false, dozing: true }));
});
```

Add to `registry.test.tsx`:

```ts
it('registers the solo renderer as a version, so the active-version dial can select it', () => {
  expect(MOSAIC_VERSIONS.solo).toBeDefined();
  expect(MOSAIC_SETTINGS_SCHEMAS.solo).toBeDefined();
  expect(DEFAULT_MOSAIC_VERSION).not.toBe('solo'); // the public site keeps the mosaic
});
```

- [ ] **Step 2: Implement `SoloFrame.tsx`**

```tsx
'use client';

import type { EntryView } from '@/app/api/kiosk/solo/view';
import type { SoloDials } from '@/app/lib/solo/types';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * One frame filling the panel. The previous frame sits underneath so a fade
 * dial above zero crossfades instead of cutting; at zero the top layer is
 * simply there. Overlays are what the live dials say and nothing else.
 */
export function SoloFrame({ entry, previous, fadeS, dials, width, height }: {
  entry: EntryView; previous: EntryView | null; fadeS: number; dials: SoloDials; width: number; height: number;
}) {
  const layer = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' } as const;
  const scale = Math.max(1, Math.min(width, height) / 540); // overlay text scales with the panel
  return (
    <div style={{ position: 'relative', width, height, background: '#000', overflow: 'hidden' }}>
      {previous && <img key={previous.snapshotId} src={previous.imageUrl} alt="" role="presentation" style={layer} />}
      <img key={entry.snapshotId} src={entry.imageUrl} alt="" role="presentation"
        style={{ ...layer, animation: fadeS > 0 ? `solo-fade-in ${fadeS}s ease` : undefined, transition: `opacity ${fadeS}s ease` }} />
      <style>{`@keyframes solo-fade-in { from { opacity: 0 } to { opacity: 1 } }`}</style>
      {dials.showPlace && (
        <div style={{ position: 'absolute', left: 24 * scale, bottom: 20 * scale, color: '#fff', textShadow: '0 1px 4px #000', fontSize: 22 * scale, lineHeight: 1.2 }}>
          {entry.title}
          <div style={{ fontSize: 15 * scale, opacity: 0.85 }}>{[entry.region, entry.country].filter(Boolean).join(', ')}</div>
        </div>
      )}
      {(dials.showScores || dials.showRank || dials.showTally) && (
        <div style={{ position: 'absolute', right: 24 * scale, bottom: 20 * scale, color: '#fff', textShadow: '0 1px 4px #000', fontFamily: mono, fontSize: 16 * scale, textAlign: 'right', lineHeight: 1.4 }}>
          {dials.showTally && <div>shown <b style={{ color: '#f5a344' }}>×{entry.tally}</b></div>}
          {dials.showRank && <div>{entry.bin === 'sunset' ? 'sunset' : 'non-sunset'} bin #{entry.rank}</div>}
          {dials.showScores && <div>{entry.bin === 'sunset' ? `q ${(entry.quality ?? 0).toFixed(2)} · ` : ''}d {entry.detection.toFixed(2)}</div>}
        </div>
      )}
    </div>
  );
}
```

`role="presentation"` on an `<img alt="">` is what Testing Library queries; keep both. The `@next/next/no-img-element` rule needs the same eslint-disable comment the mosaic versions use on their `<img>` tags.

- [ ] **Step 3: Implement `index.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { MosaicProps } from '@/app/components/mosaic/types';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import { mergeSettings } from '@/app/lib/settings/schema';
import { SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
import { SoloFrame } from './SoloFrame';
import { useSoloGlass } from './useSoloGlass';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The solo kiosk as a registered version (spec §6.3): one archived frame per
 * screen, chosen by the server from the bins, advancing on the wall clock.
 * Ignores the pool props entirely; everything it shows comes from
 * /api/kiosk/solo.
 */
export function SoloKiosk(props: MosaicProps) {
  const dials = dialsFrom(mergeSettings(SOLO_SETTINGS_SCHEMA, props.settings));
  const glass = useSoloGlass({
    feed: props.feed, dials, drive: props.driveSchedule !== false, dozing: props.dozing === true,
  });
  const [previous, setPrevious] = useState<EntryView | null>(null);
  const lastRef = useRef<EntryView | null>(null);
  useEffect(() => {
    if (glass.current && lastRef.current && glass.current.snapshotId !== lastRef.current.snapshotId) {
      setPrevious(lastRef.current);
    }
    lastRef.current = glass.current;
  }, [glass.current]);

  const debug = props.allowDebugOverlays !== false && (props.search ?? '').includes('debug=1');

  return (
    <div style={{ position: 'relative', width: props.width, height: props.height, background: '#000' }}>
      {glass.current ? (
        <SoloFrame entry={glass.current} previous={previous} fadeS={dials.fadeS} dials={dials} width={props.width} height={props.height} />
      ) : null}
      {debug && (
        <div style={{ position: 'absolute', top: 8, left: 8, fontFamily: mono, fontSize: 12, color: '#7ee2ac', background: 'rgba(0,0,0,.7)', padding: '4px 8px', borderRadius: 4 }}>
          slot {glass.slot} · next in {Math.max(0, Math.ceil((glass.boundaryMs - Date.now()) / 1000))} s · queue {glass.queueLength}
          {glass.error ? ` · ${glass.error}` : ''}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Register**

`registry.ts`: `import { SoloKiosk } from '@/app/components/solo';` and `solo: SoloKiosk,` in `MOSAIC_VERSIONS`. `DEFAULT_MOSAIC_VERSION` stays `v1`. `SHARED_SCHEMA.activeVersion` picks up `solo` automatically from the keys.

- [ ] **Step 5: Run everything and commit**

Run: `npx vitest run app/components/solo app/components/mosaic app/kiosk app/studio && npx eslint app/components/solo app/components/mosaic/registry.ts && npm run build`

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = "feat/solo-glass" ] && git add app/components/solo app/components/mosaic/registry.ts app/components/mosaic/registry.test.tsx && git commit -m "feat(solo): the solo renderer, registered as version 'solo'"
```

---

### Task 4: On-desk check, then PR

- [ ] **Step 1: Run the dev server in the worktree and open both routes with the version forced**

```
npm run dev
```

Then in a browser: `http://localhost:<port>/kiosk/sunset?v=solo&panel=ktc-l&debug=1` and the sunrise twin. Expect: a frame within a few seconds, the debug line counting down, a change at the boundary, the sunset tab changing 10 s after the sunrise tab. Open `/studio/solo` beside them: the panels there should show the same frames the tabs show, within 5 s.

- [ ] **Step 2: PR**

Title: `feat(solo): the glass renderer, registered as version 'solo' (phase 2)`. Body notes: no migration; `activeVersion` can now be set to `solo` but the default stays `v1`; the Pi shows nothing new until phase 4 flips the dial.

---

## Self-review against the spec

- §6.2 clock-derived slots, idempotent advance, reload lands on rhythm: Task 2 (the hook re-derives the slot at fire time from `Date.now()`; a reload just arms the next boundary) ✔
- §6.3 registered as `solo`, ignores `webcams`, reads state on mount and after advance, respects doze and `?panel=`, overlays as dials, landscape presets ✔ (Tasks 1, 3)
- Fade dial via a CSS crossfade over the preloaded next image, 0 = cut ✔ (Task 3)
- §9 "a reload lands on the next boundary" ✔ (Task 2 test 1 arms from the current clock)
