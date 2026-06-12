# Per-Camera Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner-only per-camera detail page (`/cameras/[id]`) showing one camera's identity + window-relative health, a best-of leaderboard strip, and its full paginated image history — and fill A's "View all data →" popup seam.

**Architecture:** App-Router server component, owner-gated via `auth()`+`isOwner`, fetches camera metadata server-side (`fetchCameraDetail`, reusing A's `cameraHealth.ts`). Two lean client sections paginate existing public APIs: `/api/snapshots?webcam_id=&mode=archive` (already exists) and `/api/leaderboards?webcam_id=` (gains a filter param). The map popup's `CameraHealthHeader` gets a link to the page via a new optional `cameraId` on `WindyWebcam`.

**Tech Stack:** Next.js App Router (server + client components), TypeScript, Neon Postgres (`@/app/lib/db`), NextAuth (`@/auth`, `@/app/lib/owner`), Vitest + Testing Library.

---

## Spec

Source spec: `docs/superpowers/specs/2026-06-10-per-camera-detail-page-design.md`. This plan is stacked on sub-project A (branch `worktree-my-cameras-map`, PR #64); rebases to `main` when A merges.

## Conventions (match existing code)

- Server route/lib tests start with `// @vitest-environment node` and mock `@/app/lib/db`. Two db shapes exist: the leaderboards route uses `sql.query(text, params)`; most camera libs use the tagged template `` sql`...` `` (see `app/api/my-cameras/route.test.ts`). Mock whichever the file under test uses.
- NUMERIC columns (`lat`/`lng`) come back as strings → coerce with `Number()`.
- Run one test file: `npm test -- --run <path>`.
- Commit after each task with `feat:`/`test:` prefixes.

## File Structure

**Create**
- `app/lib/cameraDetail.ts` — `CameraDetail` type + `fetchCameraDetail(cameraId)`.
- `app/lib/cameraDetail.test.ts`
- `app/components/CameraDetail/CameraDetailHeader.tsx` — presentational header.
- `app/components/CameraDetail/CameraDetailHeader.test.tsx`
- `app/components/CameraDetail/CameraImageHistory.tsx` — client, paginated archive grid.
- `app/components/CameraDetail/CameraImageHistory.test.tsx`
- `app/components/CameraDetail/CameraBestStrip.tsx` — client, leaderboard strip.
- `app/components/CameraDetail/CameraBestStrip.test.tsx`
- `app/cameras/[id]/page.tsx` — owner-gated server page.
- `app/cameras/[id]/page.test.tsx`

**Modify**
- `app/api/leaderboards/route.ts` + `route.test.ts` — optional `webcam_id` filter.
- `app/lib/types.ts` — add optional `cameraId?: number` to `WindyWebcam`.
- `app/lib/myCameras.ts` — map `cameraId` through.
- `app/components/MyCameras/CameraHealthHeader.tsx` + `.test.tsx` — "View all data →" link.

---

### Task 1: `/api/leaderboards` — optional `webcam_id` filter

**Files:**
- Modify: `app/api/leaderboards/route.ts`
- Test: `app/api/leaderboards/route.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
// append inside the existing describe('GET /api/leaderboards', ...) in app/api/leaderboards/route.test.ts
  it('filters to a single webcam when webcam_id is provided (bound param)', async () => {
    await GET(req('?webcam_id=42'));
    const [text, params] = sqlQueryMock.mock.calls[0];
    expect(text).toMatch(/AND s\.webcam_id = \$2/i);
    expect(params).toEqual([60, 42]);
  });

  it('ignores a non-numeric webcam_id and adds no filter', async () => {
    await GET(req('?webcam_id=abc'));
    const [text, params] = sqlQueryMock.mock.calls[0];
    expect(text).not.toMatch(/s\.webcam_id = /i);
    expect(params).toEqual([60]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run app/api/leaderboards/route.test.ts`
Expected: the two new tests FAIL (no webcam_id handling yet); existing tests pass.

- [ ] **Step 3: Implement the filter**

In `app/api/leaderboards/route.ts`, inside `GET`, after the `limit` parse (around line 73), add:

```ts
    // Optional single-webcam filter (per-camera detail page). Bound param, never
    // interpolated. Ignored when absent or non-numeric.
    const webcamIdRaw = searchParams.get('webcam_id');
    const webcamId =
      webcamIdRaw !== null && /^\d+$/.test(webcamIdRaw)
        ? parseInt(webcamIdRaw, 10)
        : null;
    const webcamFilter = webcamId !== null ? 'AND s.webcam_id = $2' : '';
    const params: number[] = webcamId !== null ? [limit, webcamId] : [limit];
```

Add `${webcamFilter}` into the `base` WHERE clause (after the `${windowSql}` line, still inside the template):

```ts
    const base = `
      FROM webcam_snapshots s
      JOIN webcams w ON w.id = s.webcam_id
      WHERE (
        (s.llm_quality IS NOT NULL AND s.llm_is_sunset = true)
        OR (s.llm_quality IS NULL AND s.ai_regression_score IS NOT NULL AND s.ai_regression_score >= ${MODEL_SUNSET_MIN})
      )
      ${windowSql}
      ${webcamFilter}
    `;
```

Change the query execution (line 128) from `[limit]` to the new `params`:

```ts
    const rows = (await sql.query(queryText, params)) as LeaderboardEntry[];
```

(`$1` remains the `LIMIT` bind in both `queryText` branches — unchanged. `$2` is only referenced when `webcamFilter` is non-empty, so the param count always matches.)

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --run app/api/leaderboards/route.test.ts`
Expected: PASS (all, including the 2 new).

- [ ] **Step 5: Commit**

```bash
git add app/api/leaderboards/route.ts app/api/leaderboards/route.test.ts
git commit -m "feat: add optional webcam_id filter to leaderboards route"
```

---

### Task 2: `fetchCameraDetail` + `CameraDetail` type

**Files:**
- Create: `app/lib/cameraDetail.ts`
- Test: `app/lib/cameraDetail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/cameraDetail.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const computeCameraHealthMock = vi.fn();
const getWindowMock = vi.fn();
const isInWindowNowMock = vi.fn();

vi.mock('@/app/lib/db', () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values);
  return { sql };
});

vi.mock('@/app/lib/cameraHealth', () => ({
  computeCameraHealth: (...a: unknown[]) => computeCameraHealthMock(...a),
  getMostRecentExpectedWindow: (...a: unknown[]) => getWindowMock(...a),
  isInWindowNow: (...a: unknown[]) => isInWindowNowMock(...a),
}));

import { fetchCameraDetail } from './cameraDetail';

beforeEach(() => {
  sqlMock.mockReset().mockResolvedValue([]);
  computeCameraHealthMock.mockReset().mockReturnValue('live');
  getWindowMock.mockReset().mockReturnValue(null);
  isInWindowNowMock.mockReset().mockReturnValue(false);
});

describe('fetchCameraDetail', () => {
  it('returns null when no camera with that id exists', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await fetchCameraDetail(999)).toBeNull();
  });

  it('maps a row to CameraDetail, coercing NUMERIC + ISO dates and computing health', async () => {
    computeCameraHealthMock.mockReturnValue('stale');
    isInWindowNowMock.mockReturnValue(true);
    sqlMock.mockResolvedValue([
      {
        camera_id: 7,
        webcam_id: 42,
        hardware_id: 'sunset-cam-1',
        device_class: 'rpi-zero-2w',
        firmware_version: '0.4.2',
        lat: '48.751900',
        lng: '-122.478700',
        phase_preference: 'sunset',
        status: 'active',
        registered_at: '2026-05-01T00:00:00.000Z',
        last_heartbeat_at: '2026-06-10T04:00:00.000Z',
        title: 'sunset-cam-1',
        latest_snapshot_url: 'https://x/y.jpg',
        latest_snapshot_captured_at: '2026-06-10T04:01:00.000Z',
      },
    ]);
    const d = await fetchCameraDetail(7);
    expect(d).toMatchObject({
      cameraId: 7,
      webcamId: 42,
      title: 'sunset-cam-1',
      hardwareId: 'sunset-cam-1',
      deviceClass: 'rpi-zero-2w',
      firmwareVersion: '0.4.2',
      lat: 48.7519,
      lng: -122.4787,
      phase: 'sunset',
      status: 'active',
      registeredAt: '2026-05-01T00:00:00.000Z',
      lastHeartbeatAt: '2026-06-10T04:00:00.000Z',
      lastSnapshotAt: '2026-06-10T04:01:00.000Z',
      latestSnapshotUrl: 'https://x/y.jpg',
      health: 'stale',
      isInWindowNow: true,
    });
  });

  it('handles a never-reported camera (null webcam_id and null timestamps)', async () => {
    computeCameraHealthMock.mockReturnValue('never');
    sqlMock.mockResolvedValue([
      {
        camera_id: 3,
        webcam_id: null,
        hardware_id: 'barn-cam',
        device_class: 'rpi-zero-2w',
        firmware_version: null,
        lat: '10',
        lng: '20',
        phase_preference: 'both',
        status: 'active',
        registered_at: '2026-05-01T00:00:00.000Z',
        last_heartbeat_at: null,
        title: 'barn-cam',
        latest_snapshot_url: null,
        latest_snapshot_captured_at: null,
      },
    ]);
    const d = await fetchCameraDetail(3);
    expect(d?.webcamId).toBeNull();
    expect(d?.health).toBe('never');
    expect(d?.firmwareVersion).toBeNull();
    expect(d?.lastSnapshotAt).toBeNull();
    expect(d?.latestSnapshotUrl).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run app/lib/cameraDetail.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// app/lib/cameraDetail.ts
import { sql } from '@/app/lib/db';
import {
  computeCameraHealth,
  getMostRecentExpectedWindow,
  isInWindowNow,
  type CameraHealth,
  type PhasePreference,
} from '@/app/lib/cameraHealth';

export interface CameraDetail {
  cameraId: number;
  webcamId: number | null;
  title: string;
  hardwareId: string;
  deviceClass: string;
  firmwareVersion: string | null;
  lat: number;
  lng: number;
  phase: PhasePreference;
  status: string;
  registeredAt: string | null;
  lastHeartbeatAt: string | null;
  lastSnapshotAt: string | null;
  latestSnapshotUrl: string | null;
  health: CameraHealth;
  isInWindowNow: boolean;
}

type Row = {
  camera_id: number;
  webcam_id: number | null;
  hardware_id: string;
  device_class: string;
  firmware_version: string | null;
  lat: number | string;
  lng: number | string;
  phase_preference: string | null;
  status: string;
  registered_at: string | Date | null;
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

function toIso(v: string | Date | null): string | null {
  const d = toDate(v);
  return d ? d.toISOString() : null;
}

/**
 * Full metadata + window-relative health for a single custom camera, by
 * cameras.id. Reuses A's cameraHealth logic. Returns null when no such camera.
 */
export async function fetchCameraDetail(
  cameraId: number
): Promise<CameraDetail | null> {
  const rows = (await sql`
    select c.id               as camera_id,
           c.webcam_id        as webcam_id,
           c.hardware_id      as hardware_id,
           c.device_class     as device_class,
           c.firmware_version as firmware_version,
           c.lat              as lat,
           c.lng              as lng,
           c.phase_preference as phase_preference,
           c.status           as status,
           c.registered_at    as registered_at,
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
    where c.id = ${cameraId}
    limit 1
  `) as Row[];

  if (rows.length === 0) return null;
  const row = rows[0];

  const lat = Number(row.lat);
  const lng = Number(row.lng);
  const phase = toPhase(row.phase_preference);
  const lastSnapshotAt = toDate(row.latest_snapshot_captured_at);
  const lastHeartbeatAt = toDate(row.last_heartbeat_at);
  const now = new Date();
  const window = getMostRecentExpectedWindow({ lat, lng }, phase, now);
  const health = computeCameraHealth({
    lastSnapshotAt,
    lastHeartbeatAt,
    mostRecentWindow: window,
    now,
  });

  return {
    cameraId: row.camera_id,
    webcamId: row.webcam_id,
    title: row.title ?? row.hardware_id,
    hardwareId: row.hardware_id,
    deviceClass: row.device_class,
    firmwareVersion: row.firmware_version,
    lat,
    lng,
    phase,
    status: row.status,
    registeredAt: toIso(row.registered_at),
    lastHeartbeatAt: lastHeartbeatAt ? lastHeartbeatAt.toISOString() : null,
    lastSnapshotAt: lastSnapshotAt ? lastSnapshotAt.toISOString() : null,
    latestSnapshotUrl: row.latest_snapshot_url,
    health,
    isInWindowNow: isInWindowNow(window, now),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --run app/lib/cameraDetail.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/cameraDetail.ts app/lib/cameraDetail.test.ts
git commit -m "feat: add fetchCameraDetail with reused window-relative health"
```

---

### Task 3: `CameraDetailHeader`

**Files:**
- Create: `app/components/CameraDetail/CameraDetailHeader.tsx`
- Test: `app/components/CameraDetail/CameraDetailHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/CameraDetail/CameraDetailHeader.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CameraDetailHeader } from './CameraDetailHeader';
import type { CameraDetail } from '@/app/lib/cameraDetail';

const base: CameraDetail = {
  cameraId: 7, webcamId: 42, title: 'sunset-cam-1', hardwareId: 'sunset-cam-1',
  deviceClass: 'rpi-zero-2w', firmwareVersion: '0.4.2', lat: 48.75, lng: -122.48,
  phase: 'sunset', status: 'active', registeredAt: '2026-05-01T00:00:00.000Z',
  lastHeartbeatAt: '2026-06-10T04:00:00.000Z', lastSnapshotAt: '2026-06-10T04:01:00.000Z',
  latestSnapshotUrl: 'https://x/y.jpg', health: 'live', isInWindowNow: true,
};

describe('CameraDetailHeader', () => {
  it('shows the title and health label', () => {
    render(<CameraDetailHeader detail={base} />);
    expect(screen.getByText('sunset-cam-1')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('renders firmware when present and omits it when null', () => {
    const { rerender } = render(<CameraDetailHeader detail={base} />);
    expect(screen.getByText(/0\.4\.2/)).toBeInTheDocument();
    rerender(<CameraDetailHeader detail={{ ...base, firmwareVersion: null }} />);
    expect(screen.queryByText(/fw/i)).toBeNull();
  });

  it('renders a placeholder instead of an image for a never-reported camera', () => {
    render(
      <CameraDetailHeader
        detail={{ ...base, health: 'never', latestSnapshotUrl: null }}
      />
    );
    expect(screen.getByText('Never reported')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run app/components/CameraDetail/CameraDetailHeader.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// app/components/CameraDetail/CameraDetailHeader.tsx
import type { CameraDetail } from '@/app/lib/cameraDetail';
import { healthVisual } from '@/app/components/Map/cameraHealthVisual';
import { relativeTime } from '@/app/components/MyCameras/CameraHealthHeader';

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        background: '#1e2636',
        color: '#aeb7c6',
        borderRadius: 5,
        padding: '3px 8px',
      }}
    >
      {children}
    </span>
  );
}

export function CameraDetailHeader({ detail }: { detail: CameraDetail }) {
  const visual = healthVisual(detail.health);
  return (
    <header
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'center',
        padding: 16,
        background: '#141b29',
        borderRadius: 10,
      }}
    >
      {detail.latestSnapshotUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={detail.latestSnapshotUrl}
          alt={detail.title}
          style={{
            width: 96,
            height: 72,
            objectFit: 'cover',
            borderRadius: 8,
            boxShadow: `0 0 0 3px ${visual.color}`,
            flex: 'none',
          }}
        />
      ) : (
        <div
          style={{
            width: 96,
            height: 72,
            borderRadius: 8,
            background: '#0b1019',
            boxShadow: `0 0 0 3px ${visual.color}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            flex: 'none',
          }}
        >
          🛰️
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: '#eaf0f8' }}>
            {detail.title}
          </h1>
          <span style={{ color: visual.color, fontWeight: 700, fontSize: 13 }}>
            {visual.label}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 8,
          }}
        >
          <Chip>snapshot {relativeTime(detail.lastSnapshotAt)}</Chip>
          <Chip>heartbeat {relativeTime(detail.lastHeartbeatAt)}</Chip>
          {detail.firmwareVersion && <Chip>fw {detail.firmwareVersion}</Chip>}
          <Chip>{detail.deviceClass}</Chip>
          <Chip>phase {detail.phase}</Chip>
          <Chip>
            {detail.lat.toFixed(3)}, {detail.lng.toFixed(3)}
          </Chip>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --run app/components/CameraDetail/CameraDetailHeader.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/CameraDetail/CameraDetailHeader.tsx app/components/CameraDetail/CameraDetailHeader.test.tsx
git commit -m "feat: add CameraDetailHeader"
```

---

### Task 4: `CameraImageHistory` (paginated archive grid)

**Files:**
- Create: `app/components/CameraDetail/CameraImageHistory.tsx`
- Test: `app/components/CameraDetail/CameraImageHistory.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/CameraDetail/CameraImageHistory.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CameraImageHistory } from './CameraImageHistory';

function snap(id: number) {
  return {
    webcamId: 42,
    title: 'sunset-cam-1',
    snapshot: {
      id,
      firebaseUrl: `https://x/${id}.jpg`,
      capturedAt: '2026-06-10T04:00:00.000Z',
      phase: 'sunset',
    },
    llmQuality: 0.8,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('CameraImageHistory', () => {
  it('renders fetched snapshots as image tiles', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ snapshots: [snap(1), snap(2)], total: 2, limit: 24, offset: 0 }),
    });
    render(<CameraImageHistory webcamId={42} />);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/snapshots?webcam_id=42&mode=archive')
    );
  });

  it('loads more, advancing the offset, and hides the button at the end', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ snapshots: [snap(1)], total: 2, limit: 1, offset: 0 }),
    });
    render(<CameraImageHistory webcamId={42} pageSize={1} />);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1));

    fetchMock.mockResolvedValueOnce({
      json: async () => ({ snapshots: [snap(2)], total: 2, limit: 1, offset: 1 }),
    });
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(fetchMock.mock.calls[1][0]).toContain('offset=1');
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('shows an empty state when there are no captures', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ snapshots: [], total: 0, limit: 24, offset: 0 }),
    });
    render(<CameraImageHistory webcamId={42} />);
    await waitFor(() =>
      expect(screen.getByText(/no captures yet/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run app/components/CameraDetail/CameraImageHistory.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// app/components/CameraDetail/CameraImageHistory.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Snapshot } from '@/app/lib/types';

const DEFAULT_PAGE_SIZE = 24;

export function CameraImageHistory({
  webcamId,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  webcamId: number;
  pageSize?: number;
}) {
  const [items, setItems] = useState<Snapshot[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/snapshots?webcam_id=${webcamId}&mode=archive&limit=${pageSize}&offset=${nextOffset}`
        );
        const data = await res.json();
        const batch: Snapshot[] = Array.isArray(data.snapshots)
          ? data.snapshots
          : [];
        setItems((prev) => (nextOffset === 0 ? batch : [...prev, ...batch]));
        setTotal(typeof data.total === 'number' ? data.total : batch.length);
        setOffset(nextOffset + batch.length);
      } finally {
        setLoading(false);
      }
    },
    [webcamId, pageSize]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  if (total === 0) {
    return (
      <p style={{ color: '#7f8a9c', fontSize: 13 }}>No captures yet.</p>
    );
  }

  const hasMore = total !== null && items.length < total;

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
        }}
      >
        {items.map((s) => (
          <figure key={s.snapshot.id} style={{ margin: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={s.snapshot.firebaseUrl}
              alt={`capture ${s.snapshot.id}`}
              style={{
                width: '100%',
                aspectRatio: '4 / 3',
                objectFit: 'cover',
                borderRadius: 4,
                display: 'block',
              }}
            />
            <figcaption style={{ fontSize: 10, color: '#7f8a9c', marginTop: 2 }}>
              {new Date(s.snapshot.capturedAt).toLocaleString()}
            </figcaption>
          </figure>
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => void load(offset)}
          disabled={loading}
          style={{
            marginTop: 12,
            padding: '6px 14px',
            fontSize: 12,
            borderRadius: 6,
            background: '#1e2636',
            color: '#cdd4de',
          }}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --run app/components/CameraDetail/CameraImageHistory.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/CameraDetail/CameraImageHistory.tsx app/components/CameraDetail/CameraImageHistory.test.tsx
git commit -m "feat: add CameraImageHistory paginated archive grid"
```

---

### Task 5: `CameraBestStrip` (leaderboard highlights)

**Files:**
- Create: `app/components/CameraDetail/CameraBestStrip.tsx`
- Test: `app/components/CameraDetail/CameraBestStrip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/CameraDetail/CameraBestStrip.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CameraBestStrip } from './CameraBestStrip';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function entry(id: number, q: number) {
  return {
    id,
    firebaseUrl: `https://x/${id}.jpg`,
    capturedAt: '2026-06-10T04:00:00.000Z',
    llmQuality: q,
    webcamId: 42,
  };
}

describe('CameraBestStrip', () => {
  it('fetches the webcam-scoped leaderboard and renders ranked frames with a quality badge', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({ entries: [entry(1, 0.92), entry(2, 0.8)] }),
    });
    render(<CameraBestStrip webcamId={42} />);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/leaderboards?webcam_id=42')
    );
    expect(screen.getByText('92%')).toBeInTheDocument();
  });

  it('shows an empty state when the camera has no ranked frames', async () => {
    fetchMock.mockResolvedValueOnce({ json: async () => ({ entries: [] }) });
    render(<CameraBestStrip webcamId={42} />);
    await waitFor(() =>
      expect(screen.getByText(/no ranked frames yet/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run app/components/CameraDetail/CameraBestStrip.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// app/components/CameraDetail/CameraBestStrip.tsx
'use client';

import { useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@/app/api/leaderboards/route';

const STRIP_LIMIT = 12;

function qualityPct(q: number | string | null): string | null {
  if (q == null) return null;
  const n = Number(q);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : null;
}

export function CameraBestStrip({ webcamId }: { webcamId: number }) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch(
        `/api/leaderboards?webcam_id=${webcamId}&limit=${STRIP_LIMIT}`
      );
      const data = await res.json();
      if (!cancelled) {
        setEntries(Array.isArray(data.entries) ? data.entries : []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [webcamId]);

  if (entries !== null && entries.length === 0) {
    return <p style={{ color: '#7f8a9c', fontSize: 13 }}>No ranked frames yet.</p>;
  }

  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
      {(entries ?? []).map((e) => {
        const pct = qualityPct(e.sortScore ?? e.llmQuality);
        return (
          <div key={e.id} style={{ position: 'relative', flex: 'none' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={e.firebaseUrl ?? ''}
              alt={`top frame ${e.id}`}
              style={{
                width: 120,
                height: 88,
                objectFit: 'cover',
                borderRadius: 6,
                display: 'block',
              }}
            />
            {pct && (
              <span
                style={{
                  position: 'absolute',
                  bottom: 4,
                  right: 4,
                  fontSize: 10,
                  fontWeight: 800,
                  background: 'rgba(67,56,202,0.85)',
                  color: '#fff',
                  borderRadius: 999,
                  padding: '1px 6px',
                }}
              >
                {pct}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --run app/components/CameraDetail/CameraBestStrip.test.tsx`
Expected: PASS (2 tests). Note: `entry(1, 0.92)` has no `sortScore`, so `e.sortScore ?? e.llmQuality` falls back to `llmQuality` 0.92 → "92%".

- [ ] **Step 5: Commit**

```bash
git add app/components/CameraDetail/CameraBestStrip.tsx app/components/CameraDetail/CameraBestStrip.test.tsx
git commit -m "feat: add CameraBestStrip leaderboard highlights"
```

---

### Task 6: `app/cameras/[id]/page.tsx` (owner-gated page)

**Files:**
- Create: `app/cameras/[id]/page.tsx`
- Test: `app/cameras/[id]/page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/cameras/[id]/page.test.tsx
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
const isOwnerMock = vi.fn();
const fetchCameraDetailMock = vi.fn();
const redirectMock = vi.fn(() => {
  throw new Error('REDIRECT');
});
const notFoundMock = vi.fn(() => {
  throw new Error('NOT_FOUND');
});

vi.mock('@/auth', () => ({ auth: (...a: unknown[]) => authMock(...a) }));
vi.mock('@/app/lib/owner', () => ({ isOwner: (...a: unknown[]) => isOwnerMock(...a) }));
vi.mock('@/app/lib/cameraDetail', () => ({
  fetchCameraDetail: (...a: unknown[]) => fetchCameraDetailMock(...a),
}));
vi.mock('next/navigation', () => ({
  redirect: (...a: unknown[]) => redirectMock(...a),
  notFound: (...a: unknown[]) => notFoundMock(...a),
}));
// Client components are not exercised in this node-env gating test.
vi.mock('@/app/components/CameraDetail/CameraBestStrip', () => ({ CameraBestStrip: () => null }));
vi.mock('@/app/components/CameraDetail/CameraImageHistory', () => ({ CameraImageHistory: () => null }));
vi.mock('@/app/components/CameraDetail/CameraDetailHeader', () => ({ CameraDetailHeader: () => null }));

import CameraDetailPage from './page';

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { email: 'owner@x.com' } });
  isOwnerMock.mockReset().mockReturnValue(true);
  fetchCameraDetailMock.mockReset().mockResolvedValue({ cameraId: 7, webcamId: 42 });
  redirectMock.mockClear();
  notFoundMock.mockClear();
});

describe('CameraDetailPage gating', () => {
  it('redirects a non-owner', async () => {
    isOwnerMock.mockReturnValue(false);
    await expect(CameraDetailPage(params('7'))).rejects.toThrow('REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/');
    expect(fetchCameraDetailMock).not.toHaveBeenCalled();
  });

  it('404s a non-numeric id', async () => {
    await expect(CameraDetailPage(params('abc'))).rejects.toThrow('NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalled();
    expect(fetchCameraDetailMock).not.toHaveBeenCalled();
  });

  it('404s an unknown camera id', async () => {
    fetchCameraDetailMock.mockResolvedValue(null);
    await expect(CameraDetailPage(params('999'))).rejects.toThrow('NOT_FOUND');
    expect(fetchCameraDetailMock).toHaveBeenCalledWith(999);
  });

  it('renders for the owner with a valid camera', async () => {
    const el = await CameraDetailPage(params('7'));
    expect(el).toBeTruthy();
    expect(fetchCameraDetailMock).toHaveBeenCalledWith(7);
    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- --run app/cameras/[id]/page.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```tsx
// app/cameras/[id]/page.tsx
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { isOwner } from '@/app/lib/owner';
import { fetchCameraDetail } from '@/app/lib/cameraDetail';
import { CameraDetailHeader } from '@/app/components/CameraDetail/CameraDetailHeader';
import { CameraBestStrip } from '@/app/components/CameraDetail/CameraBestStrip';
import { CameraImageHistory } from '@/app/components/CameraDetail/CameraImageHistory';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#7f8a9c',
  margin: '24px 0 8px',
};

export default async function CameraDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!isOwner(session)) redirect('/');

  const { id } = await params;
  const cameraId = Number(id);
  if (!Number.isInteger(cameraId) || cameraId <= 0) notFound();

  const detail = await fetchCameraDetail(cameraId);
  if (!detail) notFound();

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '24px 16px',
        color: '#e5e7eb',
        background: '#0b1220',
        minHeight: '100vh',
      }}
    >
      <div style={{ marginBottom: 16, fontSize: 13 }}>
        <Link href="/" style={{ color: '#60a5fa' }}>
          ← back to map
        </Link>
      </div>

      <CameraDetailHeader detail={detail} />

      {detail.webcamId == null ? (
        <p style={{ color: '#7f8a9c', fontSize: 13, marginTop: 24 }}>
          No captures yet — this camera has not reported any snapshots.
        </p>
      ) : (
        <>
          <div style={sectionLabel}>★ Best from this camera</div>
          <CameraBestStrip webcamId={detail.webcamId} />

          <div style={sectionLabel}>All captures · newest first</div>
          <CameraImageHistory webcamId={detail.webcamId} />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- --run app/cameras/[id]/page.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "app/cameras/[id]/page.tsx" "app/cameras/[id]/page.test.tsx"
git commit -m "feat: add owner-gated per-camera detail page"
```

---

### Task 7: Fill A's seam — "View all data →" link

**Files:**
- Modify: `app/lib/types.ts`
- Modify: `app/lib/myCameras.ts`
- Modify: `app/components/MyCameras/CameraHealthHeader.tsx`
- Test: `app/components/MyCameras/CameraHealthHeader.test.tsx` (append)

- [ ] **Step 1: Add `cameraId` to `WindyWebcam`**

In `app/lib/types.ts`, in the "My Cameras" optional-fields block of `WindyWebcam` (added by A, after `lastHeartbeatAt?`), add:

```ts
  cameraId?: number;
```

- [ ] **Step 2: Map it through**

In `app/lib/myCameras.ts`, add `cameraId` to the returned object in `myCameraToWindyWebcam` (alongside `cameraHealth`):

```ts
    cameraHealth: cam.health,
    cameraId: cam.cameraId,
    isInWindowNow: cam.isInWindowNow,
```

- [ ] **Step 3: Write the failing test (append)**

```tsx
// append to app/components/MyCameras/CameraHealthHeader.test.tsx
describe('CameraHealthHeader — View all data link', () => {
  it('renders a link to the detail page when cameraId is set', () => {
    render(
      <CameraHealthHeader webcam={{ ...base, cameraHealth: 'live', cameraId: 7 }} />
    );
    const link = screen.getByRole('link', { name: /view all data/i });
    expect(link).toHaveAttribute('href', '/cameras/7');
  });

  it('renders no link when cameraId is absent', () => {
    render(<CameraHealthHeader webcam={{ ...base, cameraHealth: 'live' }} />);
    expect(screen.queryByRole('link', { name: /view all data/i })).toBeNull();
  });
});
```

(`base` is the existing fixture at the top of this test file; reuse it.)

- [ ] **Step 4: Run to verify failure**

Run: `npm test -- --run app/components/MyCameras/CameraHealthHeader.test.tsx`
Expected: the two new tests FAIL (no link yet).

- [ ] **Step 5: Render the link**

In `app/components/MyCameras/CameraHealthHeader.tsx`, add the link at the end of the component's inner content — immediately after the snapshot/heartbeat `<div>` and before the outer closing `</div>`:

```tsx
      {webcam.cameraId != null && (
        <a
          href={`/cameras/${webcam.cameraId}`}
          style={{ fontSize: 11, color: '#60a5fa', marginTop: 4 }}
        >
          View all data →
        </a>
      )}
```

- [ ] **Step 6: Run to verify pass**

Run: `npm test -- --run app/components/MyCameras/CameraHealthHeader.test.tsx`
Expected: PASS (all, including the 2 new).

- [ ] **Step 7: Full suite + lint (shared type touched)**

Run: `npm test -- --run`
Expected: all pass.
Run: `npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add app/lib/types.ts app/lib/myCameras.ts app/components/MyCameras/CameraHealthHeader.tsx app/components/MyCameras/CameraHealthHeader.test.tsx
git commit -m "feat: link map popup to per-camera detail page via cameraId"
```

---

### Task 8: Build + manual verification

**Files:** none (verification)

- [ ] **Step 1: Production build**

Run: `DATABASE_URL="postgresql://u:p@localhost:5432/db" npm run build`
Expected: compiles + type-checks; `/cameras/[id]` appears as a dynamic route (`ƒ`).

- [ ] **Step 2: Manual smoke test (owner only)**

Run `npm run dev`, sign in with an `OWNER_EMAILS` account, and confirm:
- From the My Cameras map popup, "View all data →" navigates to `/cameras/{id}`.
- The header shows the camera's latest frame, health, and vitals.
- The best strip shows ranked frames; the history grid paginates with "Load more".
- A never-reported camera shows the "No captures yet" state.
- Visiting `/cameras/{id}` while signed out redirects to `/`; a bogus id 404s.

---

## Self-Review

**Spec coverage:**
- Route + owner gating (`auth`/`isOwner`, redirect/404) → Task 6.
- Header via `fetchCameraDetail` reusing `cameraHealth` → Tasks 2, 3.
- Best strip on `/api/leaderboards?webcam_id=` → Tasks 1, 5.
- History grid on existing `/api/snapshots?webcam_id=&mode=archive` → Task 4.
- "View all data →" seam via `cameraId` on `WindyWebcam` → Task 7.
- Edge states (never-reported empty state, 404, redirect) → Tasks 6 (page), 4/5 (empty states), 3 (placeholder header).
- Testing weighted to `fetchCameraDetail` + the leaderboards filter + gating → Tasks 1, 2, 6.

**Intentional deviations from the spec's optimistic reuse (both improve correctness):**
1. The history grid renders **lean `<img>` tiles**, not `SnapshotCard` — `SnapshotCard` is a framer-motion *swipe* card (requires `onSwipe`, full-width), wrong for a grid.
2. The best strip shows a **compact quality % badge**, not the full `ClaudeVerdictDisplay` block — that component is a large verdict card, too heavy for a horizontal thumbnail strip. (`ClaudeVerdictDisplay` remains available; just not used here.)

**Placeholder scan:** No TBD/TODO; every code step is complete.

**Type consistency:** `CameraDetail` (Task 2) is consumed unchanged by `CameraDetailHeader` (Task 3) and the page (Task 6). `LeaderboardEntry` (imported from the route) is used by `CameraBestStrip` (Task 5); `Snapshot`/`SnapshotMetadata` (existing) by `CameraImageHistory` (Task 4). `cameraId` is added to `WindyWebcam` (Task 7) and set by `myCameraToWindyWebcam`, consumed by `CameraHealthHeader`. The `webcam_id` filter param (Task 1) is what `CameraBestStrip` (Task 5) calls. `fetchCameraDetail` signature matches between definition (Task 2) and the page + page-test mock (Task 6).
