# "My Cameras" Map View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a login-gated `My Cameras` view — a globe of the owner's own custom cameras, color-coded by window-relative health, with a worst-health-first camera list and an all/in-range toggle.

**Architecture:** Reuse the existing Mapbox/Deck.gl globe (`SimpleMap`/`GlobeMap`), the marker+popup hook (`useSetWebcamMarkers`), NextAuth owner-gating, and SunCalc. New server route `/api/my-cameras` (owner-gated) computes per-camera health from each camera's most recent expected sunrise/sunset window. New client store + view component compose the existing map with a summary bar, toggle, and camera list. Custom-camera data is mapped into the existing `WindyWebcam` shape (carrying a few additive optional fields) so markers and the popup are reused, not forked.

**Tech Stack:** Next.js App Router, TypeScript, Zustand, SWR, MUI, Mapbox GL + Deck.gl, `suncalc`, Neon Postgres (`@/app/lib/db`), Vitest + Testing Library.

---

## Spec

Source spec: `docs/superpowers/specs/2026-06-09-my-cameras-map-design.md`.

## File Structure

**Create**
- `app/lib/cameraHealth.ts` — pure health model: `CameraHealth` type, `computeCameraHealth`, `getMostRecentExpectedWindow`, `isInWindowNow`.
- `app/lib/cameraHealth.test.ts`
- `app/components/Map/cameraHealthVisual.ts` — pure `healthVisual(health)` → `{color, badge, label}` (shared by marker, popup header, list).
- `app/components/Map/cameraHealthVisual.test.ts`
- `app/lib/myCameras.types.ts` — `MyCameraMarker` payload type + `MY_CAMERA_MARKER_ID_OFFSET`.
- `app/api/my-cameras/route.ts` — owner-gated GET returning `MyCameraMarker[]`.
- `app/api/my-cameras/route.test.ts`
- `app/lib/myCameras.ts` — `myCameraToWindyWebcam` mapper.
- `app/lib/myCameras.test.ts`
- `app/store/useMyCamerasStore.ts` — Zustand store.
- `app/store/useMyCamerasStore.test.ts`
- `app/store/useLoadMyCameras.ts` — SWR loader hook (operator-gated key).
- `app/components/MyCameras/healthOrdering.ts` — `sortByHealthWorstFirst`, `summarizeHealth`.
- `app/components/MyCameras/healthOrdering.test.ts`
- `app/components/MyCameras/CameraHealthHeader.tsx` — popup health header + `relativeTime`.
- `app/components/MyCameras/CameraHealthHeader.test.tsx`
- `app/components/MyCameras/MyCamerasView.tsx` — composes map + chips + toggle + list.
- `app/components/MyCameras/MyCamerasView.test.tsx`

**Modify**
- `app/lib/types.ts` — add optional `cameraHealth`, `isInWindowNow`, `lastSnapshotAt`, `lastHeartbeatAt` to `WindyWebcam`.
- `app/components/Map/hooks/useSetWebcamMarkers.tsx` — health ring/badge in `createMarkerElement`; `focusWebcamId` option; render `CameraHealthHeader` in popup.
- `app/components/Map/SimpleMap.tsx` — accept `mode: 'map' | 'globe' | 'my-cameras'`, optional `cameraWebcams` + `focusWebcamId`; show globe for `my-cameras`; disable auto-cycling for `my-cameras`.
- `app/components/MainViewContainer.tsx` — add `'my-cameras'` to `ViewMode`; render `MyCamerasView`.
- `app/components/MapMosaicModeToggle.tsx` — add `'my-cameras'` to unions; `showMyCameras` prop; conditional button.
- `app/components/MapMosaicModeToggle.test.tsx` (create if absent) — button visibility.
- `app/HomeClient.tsx` — pass `showMyCameras={isOperator}`; logout fallback to `'globe'`.

## Conventions (match existing code)

- Server route tests start with `// @vitest-environment node` and mock `@/app/lib/db` (sql tagged-template) and `@/app/lib/owner` (`requireOwner`), per `app/api/snapshots/route.test.ts:1-28`.
- `sql` is a Neon tagged template (`app/lib/db.ts:3`). NUMERIC columns (`lat`,`lng`) come back as strings → coerce with `Number(...)`.
- Run a single test file with: `npm test -- --run <path>`.
- Commit after each task. Use `feat:`/`test:` prefixes.

---

### Task 1: Health model — `computeCameraHealth`

**Files:**
- Create: `app/lib/cameraHealth.ts`
- Test: `app/lib/cameraHealth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/cameraHealth.test.ts
import { describe, it, expect } from 'vitest';
import { computeCameraHealth, type ExpectedWindow } from './cameraHealth';

const win = (startIso: string, endIso: string): ExpectedWindow => ({
  start: new Date(startIso),
  end: new Date(endIso),
});

describe('computeCameraHealth', () => {
  const now = new Date('2026-06-09T20:00:00Z');
  const window = win('2026-06-09T03:00:00Z', '2026-06-09T05:00:00Z'); // sunrise window earlier today

  it('returns "never" when there is no data at all', () => {
    expect(
      computeCameraHealth({ lastSnapshotAt: null, lastHeartbeatAt: null, mostRecentWindow: window, now })
    ).toBe('never');
  });

  it('returns "live" when a snapshot landed during the most recent window (even if silent for hours since)', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: new Date('2026-06-09T04:00:00Z'),
        lastHeartbeatAt: new Date('2026-06-09T04:00:00Z'),
        mostRecentWindow: window,
        now,
      })
    ).toBe('live');
  });

  it('returns "stale" when it sent a heartbeat for the window but no snapshot landed', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: null,
        lastHeartbeatAt: new Date('2026-06-09T04:00:00Z'),
        mostRecentWindow: window,
        now,
      })
    ).toBe('stale');
  });

  it('returns "stale" when the only snapshot predates the window but a heartbeat is in-window', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: new Date('2026-06-08T04:00:00Z'),
        lastHeartbeatAt: new Date('2026-06-09T04:00:00Z'),
        mostRecentWindow: window,
        now,
      })
    ).toBe('stale');
  });

  it('returns "offline" when it missed the window entirely', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: new Date('2026-06-08T04:00:00Z'),
        lastHeartbeatAt: new Date('2026-06-08T04:00:00Z'),
        mostRecentWindow: window,
        now,
      })
    ).toBe('offline');
  });

  it('falls back to a rolling 24h when no window can be derived', () => {
    expect(
      computeCameraHealth({
        lastSnapshotAt: new Date('2026-06-09T10:00:00Z'), // within 24h of now
        lastHeartbeatAt: null,
        mostRecentWindow: null,
        now,
      })
    ).toBe('live');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run app/lib/cameraHealth.test.ts`
Expected: FAIL (`computeCameraHealth` not exported / module missing).

- [ ] **Step 3: Write the minimal implementation**

```ts
// app/lib/cameraHealth.ts
import SunCalc from 'suncalc';

export type CameraHealth = 'live' | 'stale' | 'offline' | 'never';
export type PhasePreference = 'sunrise' | 'sunset' | 'both';
export type ExpectedWindow = { start: Date; end: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ComputeCameraHealthInput {
  lastSnapshotAt: Date | null;
  lastHeartbeatAt: Date | null;
  mostRecentWindow: ExpectedWindow | null;
  now: Date;
}

/**
 * Window-relative health. These cameras are duty-cycled (asleep at midday), so
 * a healthy camera is legitimately silent most of the day. We judge against the
 * most recent expected capture window, NOT the wall clock.
 */
export function computeCameraHealth({
  lastSnapshotAt,
  lastHeartbeatAt,
  mostRecentWindow,
  now,
}: ComputeCameraHealthInput): CameraHealth {
  if (lastSnapshotAt == null && lastHeartbeatAt == null) return 'never';

  // No derivable window (e.g. polar day/night) → rolling 24h so health is never stuck.
  const windowStart = mostRecentWindow
    ? mostRecentWindow.start
    : new Date(now.getTime() - DAY_MS);
  const startMs = windowStart.getTime();

  if (lastSnapshotAt != null && lastSnapshotAt.getTime() >= startMs) return 'live';
  if (lastHeartbeatAt != null && lastHeartbeatAt.getTime() >= startMs) return 'stale';
  return 'offline';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run app/lib/cameraHealth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/cameraHealth.ts app/lib/cameraHealth.test.ts
git commit -m "feat: add window-relative computeCameraHealth"
```

---

### Task 2: Health model — `getMostRecentExpectedWindow` + `isInWindowNow`

**Files:**
- Modify: `app/lib/cameraHealth.ts`
- Test: `app/lib/cameraHealth.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
// append to app/lib/cameraHealth.test.ts
import { getMostRecentExpectedWindow, isInWindowNow } from './cameraHealth';

describe('getMostRecentExpectedWindow', () => {
  const midLat = { lat: 40, lng: -74 }; // New York-ish, reliable sun events

  it('returns a window that has already started, with end after start', () => {
    const now = new Date('2026-06-09T18:00:00Z'); // afternoon UTC
    const w = getMostRecentExpectedWindow(midLat, 'both', now);
    expect(w).not.toBeNull();
    expect(w!.start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(w!.end.getTime()).toBeGreaterThan(w!.start.getTime());
  });

  it('honors phase preference (sunrise-only never returns an evening window)', () => {
    const now = new Date('2026-06-09T18:00:00Z');
    const sunrise = getMostRecentExpectedWindow(midLat, 'sunrise', now);
    const sunset = getMostRecentExpectedWindow(midLat, 'sunset', now);
    expect(sunrise).not.toBeNull();
    expect(sunset).not.toBeNull();
    // The sunrise window starts earlier in the day than the sunset window.
    expect(sunrise!.start.getTime()).toBeLessThan(sunset!.start.getTime());
  });
});

describe('isInWindowNow', () => {
  it('is false for a null window', () => {
    expect(isInWindowNow(null, new Date())).toBe(false);
  });

  it('is true only when now is between start and end', () => {
    const w = { start: new Date('2026-06-09T03:00:00Z'), end: new Date('2026-06-09T05:00:00Z') };
    expect(isInWindowNow(w, new Date('2026-06-09T04:00:00Z'))).toBe(true);
    expect(isInWindowNow(w, new Date('2026-06-09T06:00:00Z'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run app/lib/cameraHealth.test.ts`
Expected: FAIL (`getMostRecentExpectedWindow` / `isInWindowNow` not exported).

- [ ] **Step 3: Implement (append to `app/lib/cameraHealth.ts`)**

```ts
// append to app/lib/cameraHealth.ts
function isValidDate(d: Date | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function windowForPhase(
  times: ReturnType<typeof SunCalc.getTimes>,
  phase: 'sunrise' | 'sunset'
): ExpectedWindow | null {
  // Sunrise window ≈ civil dawn → end of morning golden hour.
  // Sunset window ≈ start of evening golden hour → civil dusk.
  const start = phase === 'sunrise' ? times.dawn : times.goldenHour;
  const end = phase === 'sunrise' ? times.goldenHourEnd : times.dusk;
  return isValidDate(start) && isValidDate(end) ? { start, end } : null;
}

/**
 * The most recent expected capture window for this location whose start is at or
 * before `now`. Scans today and yesterday so a window that began before midnight
 * (or before now) still counts. Returns null when no window can be computed
 * (e.g. polar day/night where SunCalc yields Invalid Dates).
 */
export function getMostRecentExpectedWindow(
  location: { lat: number; lng: number },
  phasePreference: PhasePreference,
  now: Date
): ExpectedWindow | null {
  const phases: Array<'sunrise' | 'sunset'> =
    phasePreference === 'both' ? ['sunrise', 'sunset'] : [phasePreference];

  const candidates: ExpectedWindow[] = [];
  for (const dayOffset of [0, -1]) {
    const day = new Date(now.getTime() + dayOffset * DAY_MS);
    const times = SunCalc.getTimes(day, location.lat, location.lng);
    for (const phase of phases) {
      const win = windowForPhase(times, phase);
      if (win && win.start.getTime() <= now.getTime()) candidates.push(win);
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.start.getTime() - a.start.getTime());
  return candidates[0];
}

export function isInWindowNow(window: ExpectedWindow | null, now: Date): boolean {
  if (!window) return false;
  const t = now.getTime();
  return t >= window.start.getTime() && t <= window.end.getTime();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run app/lib/cameraHealth.test.ts`
Expected: PASS (all tests including the new ones).

- [ ] **Step 5: Commit**

```bash
git add app/lib/cameraHealth.ts app/lib/cameraHealth.test.ts
git commit -m "feat: derive most-recent sunrise/sunset window via SunCalc"
```

---

### Task 3: Health visuals — `healthVisual`

**Files:**
- Create: `app/components/Map/cameraHealthVisual.ts`
- Test: `app/components/Map/cameraHealthVisual.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/components/Map/cameraHealthVisual.test.ts
import { describe, it, expect } from 'vitest';
import { healthVisual } from './cameraHealthVisual';

describe('healthVisual', () => {
  it('maps each health state to a distinct color, badge, and label', () => {
    expect(healthVisual('live')).toEqual({ color: '#37d67a', badge: '✓', label: 'Live' });
    expect(healthVisual('stale')).toEqual({ color: '#f5a623', badge: '!', label: 'Stale' });
    expect(healthVisual('offline')).toEqual({ color: '#e74c3c', badge: '×', label: 'Offline' });
    expect(healthVisual('never')).toEqual({ color: '#8a93a3', badge: '?', label: 'Never reported' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run app/components/Map/cameraHealthVisual.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// app/components/Map/cameraHealthVisual.ts
import type { CameraHealth } from '@/app/lib/cameraHealth';

export interface HealthVisual {
  color: string;
  badge: string;
  label: string;
}

export function healthVisual(health: CameraHealth): HealthVisual {
  switch (health) {
    case 'live':
      return { color: '#37d67a', badge: '✓', label: 'Live' };
    case 'stale':
      return { color: '#f5a623', badge: '!', label: 'Stale' };
    case 'offline':
      return { color: '#e74c3c', badge: '×', label: 'Offline' };
    case 'never':
      return { color: '#8a93a3', badge: '?', label: 'Never reported' };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run app/components/Map/cameraHealthVisual.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/Map/cameraHealthVisual.ts app/components/Map/cameraHealthVisual.test.ts
git commit -m "feat: add healthVisual color/badge/label mapping"
```

---

### Task 4: Payload type + owner-gated `/api/my-cameras`

**Files:**
- Create: `app/lib/myCameras.types.ts`
- Create: `app/api/my-cameras/route.ts`
- Test: `app/api/my-cameras/route.test.ts`

- [ ] **Step 1: Create the payload type (no test — consumed by the route test)**

```ts
// app/lib/myCameras.types.ts
import type { CameraHealth, PhasePreference } from './cameraHealth';

export interface MyCameraMarker {
  markerId: number;       // unique key for the marker map (webcamId or offset+cameraId)
  cameraId: number;
  webcamId: number | null;
  title: string;
  lat: number;
  lng: number;
  health: CameraHealth;
  isInWindowNow: boolean;
  lastHeartbeatAt: string | null; // ISO
  lastSnapshotAt: string | null;  // ISO
  latestSnapshotUrl: string | null;
  phase: PhasePreference;
}

// Custom cameras without a webcams row still need a unique, non-colliding marker
// key. Real webcam ids are far below this offset.
export const MY_CAMERA_MARKER_ID_OFFSET = 1_000_000_000;
```

- [ ] **Step 2: Write the failing route test**

```ts
// app/api/my-cameras/route.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const sqlMock = vi.fn();
const requireOwnerMock = vi.fn();
const computeCameraHealthMock = vi.fn();
const getWindowMock = vi.fn();
const isInWindowNowMock = vi.fn();

vi.mock('@/app/lib/db', () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values);
  return { sql };
});

vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));

vi.mock('@/app/lib/cameraHealth', () => ({
  computeCameraHealth: (...a: unknown[]) => computeCameraHealthMock(...a),
  getMostRecentExpectedWindow: (...a: unknown[]) => getWindowMock(...a),
  isInWindowNow: (...a: unknown[]) => isInWindowNowMock(...a),
}));

import { GET } from './route';

beforeEach(() => {
  sqlMock.mockReset().mockResolvedValue([]);
  requireOwnerMock.mockReset().mockResolvedValue(null); // authorized owner
  computeCameraHealthMock.mockReset().mockReturnValue('live');
  getWindowMock.mockReset().mockReturnValue(null);
  isInWindowNowMock.mockReset().mockReturnValue(false);
});

describe('GET /api/my-cameras', () => {
  it('returns 401 before any query when not the owner', async () => {
    requireOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    );
    const res = await GET();
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('queries only active cameras', async () => {
    await GET();
    const q = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(q).toMatch(/from cameras c/i);
    expect(q).toMatch(/c\.status = 'active'/i);
  });

  it('maps a row with a webcam_id, coercing NUMERIC strings and ISO dates', async () => {
    computeCameraHealthMock.mockReturnValue('stale');
    isInWindowNowMock.mockReturnValue(true);
    sqlMock.mockResolvedValue([
      {
        camera_id: 7,
        webcam_id: 42,
        lat: '40.123456',
        lng: '-74.654321',
        phase_preference: 'sunset',
        last_heartbeat_at: '2026-06-09T04:00:00.000Z',
        title: 'deck-west',
        latest_snapshot_url: 'https://x/y.jpg',
        latest_snapshot_captured_at: '2026-06-09T04:01:00.000Z',
      },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      markerId: 42,
      cameraId: 7,
      webcamId: 42,
      title: 'deck-west',
      lat: 40.123456,
      lng: -74.654321,
      health: 'stale',
      isInWindowNow: true,
      lastHeartbeatAt: '2026-06-09T04:00:00.000Z',
      lastSnapshotAt: '2026-06-09T04:01:00.000Z',
      latestSnapshotUrl: 'https://x/y.jpg',
      phase: 'sunset',
    });
  });

  it('uses the offset marker id when a camera has no webcam_id, and null timestamps', async () => {
    computeCameraHealthMock.mockReturnValue('never');
    sqlMock.mockResolvedValue([
      {
        camera_id: 3,
        webcam_id: null,
        lat: '10',
        lng: '20',
        phase_preference: 'both',
        last_heartbeat_at: null,
        title: 'barn-cam',
        latest_snapshot_url: null,
        latest_snapshot_captured_at: null,
      },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body[0].markerId).toBe(1_000_000_003);
    expect(body[0].webcamId).toBeNull();
    expect(body[0].health).toBe('never');
    expect(body[0].lastHeartbeatAt).toBeNull();
    expect(body[0].lastSnapshotAt).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- --run app/api/my-cameras/route.test.ts`
Expected: FAIL (route module missing).

- [ ] **Step 4: Implement the route**

```ts
// app/api/my-cameras/route.ts
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { requireOwner } from '@/app/lib/owner';
import {
  computeCameraHealth,
  getMostRecentExpectedWindow,
  isInWindowNow,
  type PhasePreference,
} from '@/app/lib/cameraHealth';
import {
  MY_CAMERA_MARKER_ID_OFFSET,
  type MyCameraMarker,
} from '@/app/lib/myCameras.types';

export const dynamic = 'force-dynamic';

type Row = {
  camera_id: number;
  webcam_id: number | null;
  lat: number | string;
  lng: number | string;
  phase_preference: string | null;
  last_heartbeat_at: string | Date | null;
  title: string | null;
  latest_snapshot_url: string | null;
  latest_snapshot_captured_at: string | Date | null;
};

function toPhase(value: string | null): PhasePreference {
  return value === 'sunrise' || value === 'sunset' ? value : 'both';
}

function toDate(v: string | Date | null): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const rows = (await sql`
    select c.id               as camera_id,
           c.webcam_id        as webcam_id,
           c.lat              as lat,
           c.lng              as lng,
           c.phase_preference as phase_preference,
           c.last_heartbeat_at as last_heartbeat_at,
           coalesce(w.title, c.hardware_id) as title,
           ls.firebase_url    as latest_snapshot_url,
           ls.captured_at     as latest_snapshot_captured_at
    from cameras c
    left join webcams w on w.id = c.webcam_id
    left join lateral (
      select firebase_url, captured_at
      from webcam_snapshots
      where webcam_id = c.webcam_id
      order by captured_at desc
      limit 1
    ) ls on true
    where c.status = 'active'
    order by c.id
  `) as Row[];

  const now = new Date();

  const cameras: MyCameraMarker[] = rows.map((row) => {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    const phase = toPhase(row.phase_preference);
    const lastSnapshotAt = toDate(row.latest_snapshot_captured_at);
    const lastHeartbeatAt = toDate(row.last_heartbeat_at);
    const window = getMostRecentExpectedWindow({ lat, lng }, phase, now);
    const health = computeCameraHealth({
      lastSnapshotAt,
      lastHeartbeatAt,
      mostRecentWindow: window,
      now,
    });

    return {
      markerId: row.webcam_id ?? MY_CAMERA_MARKER_ID_OFFSET + row.camera_id,
      cameraId: row.camera_id,
      webcamId: row.webcam_id,
      title: row.title ?? `camera-${row.camera_id}`,
      lat,
      lng,
      health,
      isInWindowNow: isInWindowNow(window, now),
      lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
      lastSnapshotAt: lastSnapshotAt ? lastSnapshotAt.toISOString() : null,
      latestSnapshotUrl: row.latest_snapshot_url,
      phase,
    };
  });

  return NextResponse.json(cameras);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --run app/api/my-cameras/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/lib/myCameras.types.ts app/api/my-cameras/route.ts app/api/my-cameras/route.test.ts
git commit -m "feat: owner-gated /api/my-cameras with per-camera health"
```

---

### Task 5: Extend `WindyWebcam` + `myCameraToWindyWebcam` mapper

**Files:**
- Modify: `app/lib/types.ts`
- Create: `app/lib/myCameras.ts`
- Test: `app/lib/myCameras.test.ts`

- [ ] **Step 1: Extend `WindyWebcam` (no test — exercised by the mapper test)**

Add the import near the top of `app/lib/types.ts` (with the other type imports):

```ts
import type { CameraHealth } from './cameraHealth';
```

Inside the `WindyWebcam` interface (append after the `llmModel` field, before the closing `}`):

```ts
  // "My Cameras" view only — present for the owner's own custom cameras.
  // Absent on Windy/terminator webcams, so existing markers are unchanged.
  cameraHealth?: CameraHealth;
  isInWindowNow?: boolean;
  lastSnapshotAt?: string | null;
  lastHeartbeatAt?: string | null;
```

- [ ] **Step 2: Write the failing mapper test**

```ts
// app/lib/myCameras.test.ts
import { describe, it, expect } from 'vitest';
import { myCameraToWindyWebcam } from './myCameras';
import type { MyCameraMarker } from './myCameras.types';

const base: MyCameraMarker = {
  markerId: 42,
  cameraId: 7,
  webcamId: 42,
  title: 'deck-west',
  lat: 40,
  lng: -74,
  health: 'stale',
  isInWindowNow: true,
  lastHeartbeatAt: '2026-06-09T04:00:00.000Z',
  lastSnapshotAt: '2026-06-09T04:01:00.000Z',
  latestSnapshotUrl: 'https://x/y.jpg',
  phase: 'sunset',
};

describe('myCameraToWindyWebcam', () => {
  it('maps marker fields into the WindyWebcam shape the marker hook expects', () => {
    const w = myCameraToWindyWebcam(base);
    expect(w.webcamId).toBe(42);
    expect(w.title).toBe('deck-west');
    expect(w.location).toEqual({ latitude: 40, longitude: -74 });
    expect(w.images?.current.preview).toBe('https://x/y.jpg');
    expect(w.cameraHealth).toBe('stale');
    expect(w.isInWindowNow).toBe(true);
    expect(w.phase).toBe('sunset');
  });

  it('omits images when there is no snapshot, and drops phase for "both"', () => {
    const w = myCameraToWindyWebcam({
      ...base,
      latestSnapshotUrl: null,
      phase: 'both',
    });
    expect(w.images).toBeUndefined();
    expect(w.phase).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- --run app/lib/myCameras.test.ts`
Expected: FAIL (`myCameras` module missing).

- [ ] **Step 4: Implement the mapper**

```ts
// app/lib/myCameras.ts
import type { WindyWebcam } from './types';
import type { MyCameraMarker } from './myCameras.types';

/**
 * Adapt a custom-camera marker into the WindyWebcam shape so the existing map
 * marker + popup code renders it unchanged. The extra cameraHealth/isInWindowNow
 * fields ride along for the health ring and popup header.
 */
export function myCameraToWindyWebcam(cam: MyCameraMarker): WindyWebcam {
  return {
    webcamId: cam.markerId,
    title: cam.title,
    viewCount: 0,
    status: cam.health,
    images: cam.latestSnapshotUrl
      ? { current: { preview: cam.latestSnapshotUrl } }
      : undefined,
    location: { latitude: cam.lat, longitude: cam.lng },
    categories: [],
    phase: cam.phase === 'both' ? undefined : cam.phase,
    cameraHealth: cam.health,
    isInWindowNow: cam.isInWindowNow,
    lastSnapshotAt: cam.lastSnapshotAt,
    lastHeartbeatAt: cam.lastHeartbeatAt,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --run app/lib/myCameras.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck the whole project (the type edit touches a shared file)**

Run: `npm run lint`
Expected: no new errors referencing `types.ts` / `myCameras.ts`.

- [ ] **Step 7: Commit**

```bash
git add app/lib/types.ts app/lib/myCameras.ts app/lib/myCameras.test.ts
git commit -m "feat: map custom cameras into WindyWebcam with health fields"
```

---

### Task 6: Zustand store + SWR loader

**Files:**
- Create: `app/store/useMyCamerasStore.ts`
- Test: `app/store/useMyCamerasStore.test.ts`
- Create: `app/store/useLoadMyCameras.ts`

- [ ] **Step 1: Write the failing store test**

```ts
// app/store/useMyCamerasStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useMyCamerasStore } from './useMyCamerasStore';
import type { MyCameraMarker } from '@/app/lib/myCameras.types';

const cam: MyCameraMarker = {
  markerId: 1, cameraId: 1, webcamId: 1, title: 'a', lat: 0, lng: 0,
  health: 'live', isInWindowNow: false, lastHeartbeatAt: null,
  lastSnapshotAt: null, latestSnapshotUrl: null, phase: 'both',
};

beforeEach(() => {
  useMyCamerasStore.setState({ cameras: [], loading: false, error: undefined });
});

describe('useMyCamerasStore', () => {
  it('sets cameras, loading, and error', () => {
    useMyCamerasStore.getState().setCameras([cam]);
    useMyCamerasStore.getState().setLoading(true);
    useMyCamerasStore.getState().setError('boom');
    const s = useMyCamerasStore.getState();
    expect(s.cameras).toHaveLength(1);
    expect(s.loading).toBe(true);
    expect(s.error).toBe('boom');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run app/store/useMyCamerasStore.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the store**

```ts
// app/store/useMyCamerasStore.ts
'use client';

import { create } from 'zustand';
import type { MyCameraMarker } from '../lib/myCameras.types';

type State = {
  cameras: MyCameraMarker[];
  loading: boolean;
  error?: string;
  setCameras: (cameras: MyCameraMarker[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e?: string) => void;
};

export const useMyCamerasStore = create<State>()((set) => ({
  cameras: [],
  loading: false,
  setCameras: (cameras) => set({ cameras }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run app/store/useMyCamerasStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the loader hook (no separate test — exercised via the view in Task 10)**

```ts
// app/store/useLoadMyCameras.ts
'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import { useMyCamerasStore } from './useMyCamerasStore';
import { useIsOperator } from '@/app/components/auth/useIsOperator';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Loads /api/my-cameras into the store on a 60s cadence, but only for the
 * operator — the SWR key is null otherwise, so no request (and no 401) fires
 * for logged-out visitors.
 */
export function useLoadMyCameras() {
  const { isOperator } = useIsOperator();
  const setCameras = useMyCamerasStore((s) => s.setCameras);
  const setLoading = useMyCamerasStore((s) => s.setLoading);
  const setError = useMyCamerasStore((s) => s.setError);

  const { data, error, isLoading } = useSWR(
    isOperator ? '/api/my-cameras' : null,
    fetcher,
    { refreshInterval: 60_000 }
  );

  useEffect(() => { setLoading(isLoading); }, [isLoading, setLoading]);
  useEffect(() => { if (error) setError(error.message); }, [error, setError]);
  useEffect(() => { if (Array.isArray(data)) setCameras(data); }, [data, setCameras]);
}
```

- [ ] **Step 6: Commit**

```bash
git add app/store/useMyCamerasStore.ts app/store/useMyCamerasStore.test.ts app/store/useLoadMyCameras.ts
git commit -m "feat: add My Cameras store and operator-gated SWR loader"
```

---

### Task 7: Marker health ring + `focusWebcamId` option

**Files:**
- Modify: `app/components/Map/hooks/useSetWebcamMarkers.tsx`

This task is map-DOM wiring; the pure visual mapping it relies on (`healthVisual`) is already tested (Task 3). Verify via typecheck + the existing marker test still passing.

- [ ] **Step 1: Add the import**

At the top of `useSetWebcamMarkers.tsx`, after the existing imports:

```tsx
import { healthVisual } from '@/app/components/Map/cameraHealthVisual';
import { CameraHealthHeader } from '@/app/components/MyCameras/CameraHealthHeader';
```

> Note: `CameraHealthHeader` is created in Task 8. If executing strictly in order, do Task 8 before running this file's typecheck, or add the import in Task 8. Both land before Task 10 consumes them.

- [ ] **Step 2: Replace `createMarkerElement` with the health-aware version**

Replace the whole `createMarkerElement` function (`useSetWebcamMarkers.tsx:33-81`) with:

```tsx
function createMarkerElement(webcam: WindyWebcam) {
  const wrapper = document.createElement('div');
  wrapper.className = 'webcam-marker';
  wrapper.style.cssText = `
    width: 60px;
    height: 60px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    position: relative;
  `;

  const inner = document.createElement('div');
  inner.className = 'webcam-marker-inner';
  inner.style.cssText = `
    width: 100%;
    height: 100%;
    border-radius: 50%;
    border: 1px solid rgba(87, 87, 87, 0.64);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0);
    overflow: hidden;
    background: rgba(0, 0, 0, 0);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    transition: opacity 280ms ease, transform 280ms ease;
    opacity: 0;
    transform: scale(0.9);
  `;

  if (webcam.images?.current?.preview) {
    const img = document.createElement('img');
    img.src = webcam.images.current.preview;
    img.alt = webcam.title;
    img.style.cssText = `
      width: 100%;
      height: 100%;
      object-fit: cover;
    `;
    inner.appendChild(img);
  } else if (webcam.cameraHealth === 'never') {
    inner.textContent = '🛰️';
  } else {
    inner.textContent = '🌅';
  }

  wrapper.appendChild(inner);

  // "My Cameras" health ring + corner badge (absent for Windy webcams).
  if (webcam.cameraHealth) {
    const visual = healthVisual(webcam.cameraHealth);
    inner.style.boxShadow = `0 0 0 3px ${visual.color}, 0 0 14px ${visual.color}`;
    inner.style.border = `1px solid ${visual.color}`;

    const badge = document.createElement('div');
    badge.className = 'webcam-marker-badge';
    badge.textContent = visual.badge;
    badge.style.cssText = `
      position: absolute;
      bottom: -2px;
      right: -2px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: ${visual.color};
      color: #0d1016;
      font-size: 11px;
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #11151c;
    `;
    wrapper.appendChild(badge);
  }

  return wrapper;
}
```

- [ ] **Step 3: Add the `focusWebcamId` option**

Extend `UseSetWebcamMarkersOptions` (`useSetWebcamMarkers.tsx:23-27`):

```tsx
type UseSetWebcamMarkersOptions = {
  activeWebcamId?: number | null;
  onAdvance?: () => void;
  onPopupStateChange?: (isOpen: boolean) => void;
  focusWebcamId?: number | null;
};
```

Then add this effect inside `useSetWebcamMarkers`, immediately before the final cleanup `useEffect` (`useSetWebcamMarkers.tsx:362`):

```tsx
  // Fly to + open a specific marker when the consumer sets focusWebcamId
  // (used by the My Cameras list when a row is clicked).
  useEffect(() => {
    if (!map || !mapLoaded) return;
    const focusId = options?.focusWebcamId ?? null;
    if (focusId == null) return;
    const entry = markersRef.current.get(focusId);
    if (!entry) return;
    const lngLat = entry.marker.getLngLat();
    map.flyTo({
      center: [lngLat.lng, lngLat.lat],
      zoom: Math.max(map.getZoom(), 3),
      duration: 1200,
    });
    entry.popup.addTo(map);
  }, [map, mapLoaded, options?.focusWebcamId]);
```

- [ ] **Step 4: Render the health header in the popup**

Replace `entry.render` (`useSetWebcamMarkers.tsx:315-326`) with:

```tsx
        entry.render = (cam: WindyWebcam) => {
          root.render(
            <>
              <CameraHealthHeader webcam={cam} />
              <RatingCard
                webcam={cam}
                initialRating={entry.latestRating ?? cam.rating ?? null}
                onRate={async () => {
                  /* no-op; map popup is read-only */
                }}
                readOnly={true}
              />
            </>
          );
        };
```

- [ ] **Step 5: Verify the existing marker test still passes and typecheck**

Run: `npm test -- --run app/components/Map/hooks/useSetMarkers.test.ts`
Expected: PASS (unchanged — that test targets `useSetMarkers`, a different hook).

Run: `npm run lint`
Expected: no new errors in `useSetWebcamMarkers.tsx` (requires Task 8's `CameraHealthHeader` to exist).

- [ ] **Step 6: Commit**

```bash
git add app/components/Map/hooks/useSetWebcamMarkers.tsx
git commit -m "feat: health ring, focus-to-marker, and popup health header"
```

---

### Task 8: `CameraHealthHeader` + `relativeTime`

**Files:**
- Create: `app/components/MyCameras/CameraHealthHeader.tsx`
- Test: `app/components/MyCameras/CameraHealthHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/MyCameras/CameraHealthHeader.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CameraHealthHeader, relativeTime } from './CameraHealthHeader';
import type { WindyWebcam } from '@/app/lib/types';

const base: WindyWebcam = {
  webcamId: 1,
  title: 'deck-west',
  viewCount: 0,
  status: 'stale',
  location: { latitude: 0, longitude: 0 },
  categories: [],
};

describe('relativeTime', () => {
  const now = new Date('2026-06-09T10:00:00Z');
  it('formats nulls, minutes, hours, and days', () => {
    expect(relativeTime(null, now)).toBe('never');
    expect(relativeTime('2026-06-09T09:30:00Z', now)).toBe('30m ago');
    expect(relativeTime('2026-06-09T06:00:00Z', now)).toBe('4h ago');
    expect(relativeTime('2026-06-07T10:00:00Z', now)).toBe('2d ago');
  });
});

describe('CameraHealthHeader', () => {
  it('renders nothing for a webcam without cameraHealth', () => {
    const { container } = render(<CameraHealthHeader webcam={base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the health label for a custom camera', () => {
    render(<CameraHealthHeader webcam={{ ...base, cameraHealth: 'offline' }} />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run app/components/MyCameras/CameraHealthHeader.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// app/components/MyCameras/CameraHealthHeader.tsx
import type { WindyWebcam } from '@/app/lib/types';
import { healthVisual } from '@/app/components/Map/cameraHealthVisual';

export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const diffMs = Math.max(0, now.getTime() - then);
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/**
 * Small health banner shown above the reused RatingCard in the My Cameras popup.
 * Renders nothing for non-custom webcams (no cameraHealth field).
 */
export function CameraHealthHeader({ webcam }: { webcam: WindyWebcam }) {
  if (!webcam.cameraHealth) return null;
  const visual = healthVisual(webcam.cameraHealth);
  return (
    <div
      className="camera-health-header"
      style={{
        background: '#11151c',
        color: '#e8edf4',
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: visual.color,
            display: 'inline-block',
          }}
        />
        <strong style={{ fontSize: 13 }}>{visual.label}</strong>
      </div>
      <div style={{ fontSize: 11, opacity: 0.75 }}>
        Snapshot {relativeTime(webcam.lastSnapshotAt)} · heartbeat{' '}
        {relativeTime(webcam.lastHeartbeatAt)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run app/components/MyCameras/CameraHealthHeader.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/MyCameras/CameraHealthHeader.tsx app/components/MyCameras/CameraHealthHeader.test.tsx
git commit -m "feat: add CameraHealthHeader popup banner"
```

---

### Task 9: List ordering + summary helpers

**Files:**
- Create: `app/components/MyCameras/healthOrdering.ts`
- Test: `app/components/MyCameras/healthOrdering.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/components/MyCameras/healthOrdering.test.ts
import { describe, it, expect } from 'vitest';
import { sortByHealthWorstFirst, summarizeHealth } from './healthOrdering';
import type { MyCameraMarker } from '@/app/lib/myCameras.types';

const mk = (title: string, health: MyCameraMarker['health']): MyCameraMarker => ({
  markerId: 0, cameraId: 0, webcamId: 0, title, lat: 0, lng: 0,
  health, isInWindowNow: false, lastHeartbeatAt: null, lastSnapshotAt: null,
  latestSnapshotUrl: null, phase: 'both',
});

describe('sortByHealthWorstFirst', () => {
  it('orders offline → stale → never → live, then alphabetically within a tier', () => {
    const out = sortByHealthWorstFirst([
      mk('z-live', 'live'),
      mk('barn', 'offline'),
      mk('deck', 'stale'),
      mk('new', 'never'),
      mk('a-live', 'live'),
    ]).map((c) => c.title);
    expect(out).toEqual(['barn', 'deck', 'new', 'a-live', 'z-live']);
  });

  it('does not mutate the input array', () => {
    const input = [mk('a', 'live'), mk('b', 'offline')];
    sortByHealthWorstFirst(input);
    expect(input.map((c) => c.title)).toEqual(['a', 'b']);
  });
});

describe('summarizeHealth', () => {
  it('counts each health state', () => {
    expect(
      summarizeHealth([mk('a', 'live'), mk('b', 'live'), mk('c', 'stale'), mk('d', 'offline')])
    ).toEqual({ live: 2, stale: 1, offline: 1, never: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run app/components/MyCameras/healthOrdering.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// app/components/MyCameras/healthOrdering.ts
import type { CameraHealth } from '@/app/lib/cameraHealth';
import type { MyCameraMarker } from '@/app/lib/myCameras.types';

// Worst first: surface broken cameras at the top of the list.
export const HEALTH_ORDER: Record<CameraHealth, number> = {
  offline: 0,
  stale: 1,
  never: 2,
  live: 3,
};

export function sortByHealthWorstFirst(cams: MyCameraMarker[]): MyCameraMarker[] {
  return [...cams].sort((a, b) => {
    const d = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
    return d !== 0 ? d : a.title.localeCompare(b.title);
  });
}

export interface HealthSummary {
  live: number;
  stale: number;
  offline: number;
  never: number;
}

export function summarizeHealth(cams: MyCameraMarker[]): HealthSummary {
  const s: HealthSummary = { live: 0, stale: 0, offline: 0, never: 0 };
  for (const c of cams) s[c.health] += 1;
  return s;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run app/components/MyCameras/healthOrdering.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/MyCameras/healthOrdering.ts app/components/MyCameras/healthOrdering.test.ts
git commit -m "feat: add worst-first sort and health summary helpers"
```

---

### Task 10: `MyCamerasView` (chips + toggle + list + map)

**Files:**
- Create: `app/components/MyCameras/MyCamerasView.tsx`
- Test: `app/components/MyCameras/MyCamerasView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/MyCameras/MyCamerasView.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { MyCameraMarker } from '@/app/lib/myCameras.types';

// Stub the actual map — we only test the surrounding chrome here.
vi.mock('@/app/components/Map/SimpleMap', () => ({
  __esModule: true,
  default: () => <div data-testid="simple-map" />,
}));

// Loader is a no-op in the test; data is injected via the store.
vi.mock('@/app/store/useLoadMyCameras', () => ({
  useLoadMyCameras: () => {},
}));

import { useMyCamerasStore } from '@/app/store/useMyCamerasStore';
import { MyCamerasView } from './MyCamerasView';

const mk = (
  title: string,
  health: MyCameraMarker['health'],
  isInWindowNow = false
): MyCameraMarker => ({
  markerId: title.length, cameraId: title.length, webcamId: title.length,
  title, lat: 0, lng: 0, health, isInWindowNow,
  lastHeartbeatAt: null, lastSnapshotAt: null, latestSnapshotUrl: null, phase: 'both',
});

beforeEach(() => {
  useMyCamerasStore.setState({
    cameras: [
      mk('alpha', 'live', true),
      mk('bravo', 'offline', false),
      mk('charlie', 'stale', true),
    ],
    loading: false,
    error: undefined,
  });
});

describe('MyCamerasView', () => {
  it('renders the map and a summary of health counts', () => {
    render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
    expect(screen.getByTestId('simple-map')).toBeInTheDocument();
    expect(screen.getByTestId('summary-live')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-stale')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-offline')).toHaveTextContent('1');
  });

  it('lists cameras worst-health first', () => {
    render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
    const rows = screen.getAllByTestId('camera-row');
    expect(rows.map((r) => r.getAttribute('data-title'))).toEqual([
      'bravo', // offline
      'charlie', // stale
      'alpha', // live
    ]);
  });

  it('filters to in-window cameras when In-range is selected', () => {
    render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
    fireEvent.click(screen.getByRole('button', { name: /in range/i }));
    const rows = screen.getAllByTestId('camera-row');
    expect(rows.map((r) => r.getAttribute('data-title'))).toEqual(['charlie', 'alpha']);
    expect(screen.queryByText('bravo')).not.toBeInTheDocument();
  });

  it('collapses the camera list', () => {
    render(<MyCamerasView userLocation={{ lat: 0, lng: 0 }} />);
    expect(screen.getAllByTestId('camera-row').length).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: /collapse list/i }));
    expect(screen.queryAllByTestId('camera-row').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run app/components/MyCameras/MyCamerasView.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// app/components/MyCameras/MyCamerasView.tsx
'use client';

import { useMemo, useState } from 'react';
import SimpleMap from '@/app/components/Map/SimpleMap';
import type { Location } from '@/app/lib/types';
import { useMyCamerasStore } from '@/app/store/useMyCamerasStore';
import { useLoadMyCameras } from '@/app/store/useLoadMyCameras';
import { myCameraToWindyWebcam } from '@/app/lib/myCameras';
import { sortByHealthWorstFirst, summarizeHealth } from './healthOrdering';
import { healthVisual } from '@/app/components/Map/cameraHealthVisual';

export function MyCamerasView({ userLocation }: { userLocation: Location }) {
  useLoadMyCameras();
  const cameras = useMyCamerasStore((s) => s.cameras);

  const [inRangeOnly, setInRangeOnly] = useState(false); // default: All
  const [listCollapsed, setListCollapsed] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);

  const visible = useMemo(
    () => (inRangeOnly ? cameras.filter((c) => c.isInWindowNow) : cameras),
    [cameras, inRangeOnly]
  );
  const summary = useMemo(() => summarizeHealth(visible), [visible]);
  const sorted = useMemo(() => sortByHealthWorstFirst(visible), [visible]);
  const markerWebcams = useMemo(() => visible.map(myCameraToWindyWebcam), [visible]);

  return (
    <section className="map-container w-full h-screen" style={{ position: 'relative' }}>
      <SimpleMap
        userLocation={userLocation}
        mode="my-cameras"
        cameraWebcams={markerWebcams}
        focusWebcamId={focusId}
      />

      {/* Summary chips */}
      <div
        style={{
          position: 'absolute', top: 16, left: 16, zIndex: 3, display: 'flex',
          gap: 8, alignItems: 'center', background: 'rgba(0,0,0,0.7)',
          padding: '6px 10px', borderRadius: 999, color: 'white', fontSize: 12,
        }}
      >
        <strong style={{ fontSize: 12 }}>My Cameras</strong>
        <span data-testid="summary-live" style={{ color: healthVisual('live').color }}>
          {summary.live} live
        </span>
        <span data-testid="summary-stale" style={{ color: healthVisual('stale').color }}>
          {summary.stale} stale
        </span>
        <span data-testid="summary-offline" style={{ color: healthVisual('offline').color }}>
          {summary.offline} off
        </span>
        <button
          type="button"
          onClick={() => setInRangeOnly((v) => !v)}
          style={{
            marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 999,
            background: inRangeOnly ? '#37607a' : 'rgba(255,255,255,0.15)', color: 'white',
          }}
        >
          {inRangeOnly ? 'In range' : 'All'}
        </button>
      </div>

      {/* Camera list panel */}
      <div
        style={{
          position: 'absolute', top: 16, right: 16, bottom: 16, zIndex: 3,
          width: 200, background: 'rgba(14,19,27,0.92)', borderRadius: 10,
          color: '#e8edf4', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <button
          type="button"
          onClick={() => setListCollapsed((v) => !v)}
          aria-label={listCollapsed ? 'Expand list' : 'Collapse list'}
          style={{
            padding: '8px 10px', fontSize: 11, textAlign: 'left',
            borderBottom: '1px solid #2a2f3a', color: '#aeb6c2',
          }}
        >
          {listCollapsed ? 'Expand list ▾' : 'Collapse list ▴'}
        </button>
        {!listCollapsed && (
          <div style={{ overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sorted.map((cam) => {
              const visual = healthVisual(cam.health);
              return (
                <button
                  key={cam.markerId}
                  type="button"
                  data-testid="camera-row"
                  data-title={cam.title}
                  onClick={() => setFocusId(cam.markerId)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 11,
                    background: '#151b25', borderRadius: 6, padding: '5px 6px', textAlign: 'left',
                  }}
                >
                  <span
                    style={{ width: 8, height: 8, borderRadius: '50%', background: visual.color, flex: 'none' }}
                  />
                  <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {cam.title}
                  </span>
                  <span style={{ marginLeft: 'auto', color: visual.color }}>{visual.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run app/components/MyCameras/MyCamerasView.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/MyCameras/MyCamerasView.tsx app/components/MyCameras/MyCamerasView.test.tsx
git commit -m "feat: add MyCamerasView with summary, toggle, and camera list"
```

---

### Task 11: Wire `SimpleMap` for the `my-cameras` mode

**Files:**
- Modify: `app/components/Map/SimpleMap.tsx`

- [ ] **Step 1: Update the props interface**

Replace `SimpleMapProps` (`SimpleMap.tsx:24-27`) with:

```tsx
import type { WindyWebcam } from '../../lib/types';

interface SimpleMapProps {
  userLocation: Location;
  mode: 'map' | 'globe' | 'my-cameras';
  cameraWebcams?: WindyWebcam[];
  focusWebcamId?: number | null;
}
```

(Keep the existing `import type { Location }` line; add the `WindyWebcam` import if not already present.)

- [ ] **Step 2: Destructure the new props**

Update the function signature (`SimpleMap.tsx:29-32`):

```tsx
export default function SimpleMap({
  userLocation,
  mode,
  cameraWebcams,
  focusWebcamId,
}: SimpleMapProps) {
```

- [ ] **Step 3: Choose the marker dataset and disable cycling for my-cameras**

After the line `const allTerminatorWebcams = useTerminatorStore((t) => t.combined);` (`SimpleMap.tsx:49`), add:

```tsx
  const isMyCameras = mode === 'my-cameras';
  const markerWebcams = isMyCameras ? cameraWebcams ?? [] : allTerminatorWebcams;
```

Change the `useCyclingWebcams` call (`SimpleMap.tsx:58-68`) to cycle over the right set and not auto-start for my-cameras:

```tsx
  const {
    currentWebcam: nextLatitudeNorthSunsetWebCam,
    currentWebcamLocation: nextLatitudeNorthSunsetLocation,
    next: goToNextWebcam,
    resume: resumeWebcamCycling,
    pause: pauseWebcamCycling,
  } = useCyclingWebcams(markerWebcams, {
    startIndex: 0,
    intervalMs: 3000,
    autoStart: !isMyCameras,
  });
```

- [ ] **Step 4: Pass the dataset + focus into the marker hook**

Update the `useSetWebcamMarkers` call (`SimpleMap.tsx:94-108`):

```tsx
  useSetWebcamMarkers(map, mapLoaded, markerWebcams, {
    activeWebcamId: nextLatitudeNorthSunsetWebCam?.webcamId ?? null,
    focusWebcamId: focusWebcamId ?? null,
    onAdvance: () => {
      resetInteractionPause();
      resumeWebcamCycling();
      goToNextWebcam();
    },
    onPopupStateChange: (isOpen: boolean) => {
      if (isOpen) {
        pauseWebcamCycling();
      } else {
        resumeWebcamCycling();
      }
    },
  });
```

- [ ] **Step 5: Show the globe for my-cameras**

Change the globe render condition (`SimpleMap.tsx:120`) from `{mode === 'globe' && (` to:

```tsx
          {(mode === 'globe' || mode === 'my-cameras') && (
```

- [ ] **Step 6: Typecheck**

Run: `npm run lint`
Expected: no new errors in `SimpleMap.tsx`.

Run: `npm test -- --run app/components/Map/SimpleMap.test.tsx`
Expected: PASS (unchanged).

- [ ] **Step 7: Commit**

```bash
git add app/components/Map/SimpleMap.tsx
git commit -m "feat: support my-cameras data source in SimpleMap"
```

---

### Task 12: Add the operator-gated tab (MainViewContainer, toggle, HomeClient)

**Files:**
- Modify: `app/components/MainViewContainer.tsx`
- Modify: `app/components/MapMosaicModeToggle.tsx`
- Create: `app/components/MapMosaicModeToggle.test.tsx`
- Modify: `app/HomeClient.tsx`

- [ ] **Step 1: Write the failing toggle-visibility test**

```tsx
// app/components/MapMosaicModeToggle.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapMosaicModeToggle } from './MapMosaicModeToggle';

describe('MapMosaicModeToggle', () => {
  it('hides the My Cameras button by default (logged out)', () => {
    render(<MapMosaicModeToggle mode="globe" onModeChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /my cameras/i })).toBeNull();
  });

  it('shows the My Cameras button when showMyCameras is true', () => {
    render(<MapMosaicModeToggle mode="globe" onModeChange={vi.fn()} showMyCameras />);
    expect(screen.getByRole('button', { name: /my cameras/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- --run app/components/MapMosaicModeToggle.test.tsx`
Expected: FAIL (`showMyCameras` prop + button don't exist).

- [ ] **Step 3: Update `MapMosaicModeToggle`**

Replace the `MapMosaicModeToggleProps` interface (`MapMosaicModeToggle.tsx:5-24`) with (adds `'my-cameras'` to both unions and a `showMyCameras` flag):

```tsx
type Mode =
  | 'map'
  | 'globe'
  | 'sunrise-mosaic'
  | 'sunset-mosaic'
  | 'rating'
  | 'swipe'
  | 'gallery'
  | 'my-cameras';

interface MapMosaicModeToggleProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  showMyCameras?: boolean;
}
```

Update the destructure (`MapMosaicModeToggle.tsx:26-29`):

```tsx
export function MapMosaicModeToggle({
  mode,
  onModeChange,
  showMyCameras = false,
}: MapMosaicModeToggleProps) {
```

Add the conditional button after the `sunset-mosaic` ToggleButton (`MapMosaicModeToggle.tsx:74-76`), before the commented-out block:

```tsx
        <ToggleButton value="sunset-mosaic">
          Sunset Mosaics
        </ToggleButton>
        {showMyCameras && (
          <ToggleButton value="my-cameras">My Cameras</ToggleButton>
        )}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --run app/components/MapMosaicModeToggle.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Update `MainViewContainer`**

Add `'my-cameras'` to the `ViewMode` union (`MainViewContainer.tsx:11-18`):

```tsx
export type ViewMode =
  | 'map'
  | 'globe'
  | 'sunrise-mosaic'
  | 'sunset-mosaic'
  | 'rating'
  | 'swipe'
  | 'gallery'
  | 'my-cameras';
```

Add the import near the top (after the other component imports, e.g. `MainViewContainer.tsx:8`):

```tsx
import { MyCamerasView } from './MyCameras/MyCamerasView';
```

Add a case to the switch, right after the `case 'map': case 'globe':` block (`MainViewContainer.tsx:90`):

```tsx
    case 'my-cameras':
      return <MyCamerasView userLocation={userLocation} />;
```

- [ ] **Step 6: Update `HomeClient` — operator gating + logout fallback**

In `HomeClient.tsx`, replace the `MapMosaicModeToggle` block (`HomeClient.tsx:89-101`) with:

```tsx
        {/* Mode Toggle */}
        <MapMosaicModeToggle
          mode={mode}
          onModeChange={(newMode) => setMode(newMode as ViewMode)}
          showMyCameras={isOperator}
        />
```

Add a logout fallback effect right after the existing `visibleTabs` fallback effect (`HomeClient.tsx:56-60`):

```tsx
  // If the operator signs out while on the My Cameras view, drop back to globe.
  useEffect(() => {
    if (!isOperator && mode === 'my-cameras') {
      setMode('globe');
    }
  }, [isOperator, mode]);
```

- [ ] **Step 7: Run the full suite + lint**

Run: `npm test -- --run`
Expected: PASS (all prior 404 tests + the new ones).

Run: `npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add app/components/MainViewContainer.tsx app/components/MapMosaicModeToggle.tsx app/components/MapMosaicModeToggle.test.tsx app/HomeClient.tsx
git commit -m "feat: add operator-gated My Cameras tab with logout fallback"
```

---

### Task 13: Manual verification

**Files:** none (manual smoke test)

- [ ] **Step 1: Build to confirm no type/route errors**

Run: `npm run build`
Expected: build succeeds; `/api/my-cameras` appears in the route list.

- [ ] **Step 2: Run the dev server and smoke-test as the owner**

Run: `npm run dev`, sign in with an `OWNER_EMAILS` Google account, and confirm:
- The **My Cameras** toggle button appears top-right (and disappears when signed out).
- Selecting it shows the globe with the owner's cameras, health-ringed; summary chips show counts.
- The **All / In range** toggle filters the markers and the list.
- Clicking a list row flies to the camera and opens its popup with the health header.
- Signing out while on My Cameras falls back to the globe and hides the button.

- [ ] **Step 3: Confirm the data route is gated**

Run (signed out, in a separate terminal):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/my-cameras
```

Expected: `401`.

---

## Self-Review

**Spec coverage:**
- Third login-gated tab reusing globe/markers/popup/auth → Tasks 11, 12.
- Owner-gated `/api/my-cameras` → Task 4 (gating test included).
- Window-relative health (Live/Stale/Offline/Never; healthy-asleep stays green) → Tasks 1–2.
- Style-A health ring + corner badge; 🛰️ for never-reported → Task 7.
- Reused popup + health header + "View all data →" seam → Task 8 wires the header; the "View all data →" stub is intentionally deferred to Sub-project B and is **not** built here (noted as out of scope below).
- Layout A: summary chips, All/In-range toggle (default All), worst-first collapsible list, row-click fly-to → Tasks 9, 10, 7.
- Testing weighted toward pure health computation → Tasks 1–3, 9 are pure-function tests.

**Intentional scope note:** The spec's "View all data →" stub link is the seam for Sub-project B. To avoid shipping a dead control, it is **not** added in this plan; the popup health header (Task 8) marks where it will attach. Flag for the reviewer in case they want a visible disabled stub now.

**Placeholder scan:** No TBD/TODO/"add error handling" placeholders; every code step is complete.

**Type consistency:** `CameraHealth`, `PhasePreference`, `ExpectedWindow`, `MyCameraMarker`, and `MY_CAMERA_MARKER_ID_OFFSET` are defined once (Tasks 1, 4) and imported consistently. `computeCameraHealth`/`getMostRecentExpectedWindow`/`isInWindowNow` signatures match between definition (Tasks 1–2), the route (Task 4), and the route's mocks (Task 4 test). `healthVisual` shape (`{color,badge,label}`) is consistent across Tasks 3, 7, 8, 10. `MyCamerasView` prop `cameraWebcams`/`focusWebcamId` match `SimpleMap`'s new props (Tasks 10, 11). Toggle `Mode` union includes `'my-cameras'` consistent with `ViewMode` (Task 12).
