# Terminator Ring — v1 Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any phone scan a URL and become a live, wake-locked "station" in a shared ring that shows the best currently-unclaimed sunrise/sunset on Earth, greedily assigned and re-balanced as phones join and leave.

**Architecture:** A single global "ring session" is stored as one JSON blob in Upstash Redis (`ring:session:v1`). A phone (identified by a `localStorage` id) POSTs to `/api/ring/sync` on a ~20s heartbeat. The endpoint prunes stale claims, pulls the app's existing ranked terminator cameras, greedily assigns the best *unclaimed* camera to the phone (keeping its current one if still valid), saves the session, and returns the assigned camera image + the phone's evenly-spaced ring slot. A thin `/ring` fullscreen client page renders the image, requests a screen wake lock, runs the heartbeat, and shows placement guidance. All ring-decision logic lives in a pure, unit-tested module; Redis and camera-fetching are thin adapters around it.

**Tech Stack:** Next.js 15 (App Router), TypeScript, `@upstash/redis` (via `Redis.fromEnv()`), Neon Postgres (only indirectly, via the existing `fetchTerminatorWebcams()`), Vitest + jsdom, Tailwind CSS.

## Global Constraints

- **Next.js App Router only.** API routes live under `app/api/<name>/route.ts` and export `async function POST(request: NextRequest): Promise<NextResponse>`. Pages live under `app/<name>/page.tsx`.
- **Redis client:** always obtain via `Redis.fromEnv()` (reads `KV_REST_API_URL` + `KV_REST_API_TOKEN`), matching `app/lib/cache.ts`. `@upstash/redis` auto-serializes/deserializes JSON on `get`/`set`.
- **Ranked cameras come only from the existing `fetchTerminatorWebcams()`** in `app/lib/terminatorPayload.ts`. It returns `WindyWebcam[]` already ordered by phase then `rank` (rank 1 = best within a phase). Do NOT write new SQL.
- **Single global ring** for v1 (one installation at a time). No per-session namespacing — YAGNI.
- **Position model = rank-ordered even spacing (model B):** claimed phones are ordered by their camera's longitude (west→east) and distributed evenly around 360°. `angleDeg = index * 360 / total`.
- **Pure web, no install.** No "Add to Home Screen" requirement. Keep the station layout intentional even with Safari's toolbar visible.
- **Test runner:** Vitest. Run a single test file with `npm test -- <path>`. Test files sit next to source as `*.test.ts`.
- **Path alias:** `@/` maps to repo root (e.g. `@/app/lib/ring/ringLogic`).
- **Time:** all logic takes an explicit `now: number` (epoch ms) parameter so it is deterministic under test. Only the route/hook call `Date.now()`.

---

## File Structure

- `app/lib/ring/ringLogic.ts` — **pure** ring decisions (types, prune, assign, release, slot spacing). No I/O.
- `app/lib/ring/ringLogic.test.ts` — unit tests for the pure logic.
- `app/lib/ring/ringStore.ts` — load/save the session JSON in Redis.
- `app/lib/ring/ringStore.test.ts` — tests with a fake Redis.
- `app/lib/ring/rankedCameras.ts` — adapter: `fetchTerminatorWebcams()` → `RingCamera[]` (best-first).
- `app/lib/ring/rankedCameras.test.ts` — tests with `fetchTerminatorWebcams` mocked.
- `app/lib/ring/stationHelpers.ts` — pure client helpers (phone id, clock-position label).
- `app/lib/ring/stationHelpers.test.ts` — unit tests.
- `app/api/ring/sync/route.ts` — the one endpoint (join / refresh / leave).
- `app/api/ring/sync/route.test.ts` — route test wiring the mocked libs.
- `app/ring/useRingStation.ts` — client hook (sync loop, wake lock, leave-on-unload).
- `app/ring/page.tsx` — thin fullscreen station UI.

---

### Task 1: Pure ring logic

**Files:**
- Create: `app/lib/ring/ringLogic.ts`
- Test: `app/lib/ring/ringLogic.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface RingCamera { id: number; lng: number; title: string | null; imageUrl: string }`
  - `interface Claim { cameraId: number; claimedAt: number; lastHeartbeat: number }`
  - `interface RingSession { claims: Record<string, Claim> }`
  - `interface RingSlot { index: number; total: number; angleDeg: number }`
  - `const CLAIM_TTL_MS = 60000`
  - `pruneStale(session: RingSession, now: number, ttlMs?: number): RingSession`
  - `assignOrKeep(session: RingSession, phoneId: string, ranked: RingCamera[], now: number): RingSession`
  - `releasePhone(session: RingSession, phoneId: string): RingSession`
  - `computeSlots(session: RingSession, ranked: RingCamera[]): Record<string, RingSlot>`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/ring/ringLogic.test.ts
import { describe, it, expect } from 'vitest';
import {
  pruneStale,
  assignOrKeep,
  releasePhone,
  computeSlots,
  CLAIM_TTL_MS,
  type RingSession,
  type RingCamera,
} from './ringLogic';

const cams: RingCamera[] = [
  { id: 10, lng: -120, title: 'A', imageUrl: 'a.jpg' }, // best (index 0)
  { id: 20, lng: 30, title: 'B', imageUrl: 'b.jpg' },
  { id: 30, lng: 150, title: 'C', imageUrl: 'c.jpg' },
];
const empty = (): RingSession => ({ claims: {} });

describe('pruneStale', () => {
  it('drops claims older than the TTL and keeps fresh ones', () => {
    const now = 1_000_000;
    const session: RingSession = {
      claims: {
        fresh: { cameraId: 10, claimedAt: now, lastHeartbeat: now - 5_000 },
        stale: { cameraId: 20, claimedAt: now, lastHeartbeat: now - (CLAIM_TTL_MS + 1) },
      },
    };
    const out = pruneStale(session, now);
    expect(Object.keys(out.claims)).toEqual(['fresh']);
  });
});

describe('assignOrKeep', () => {
  it('gives a new phone the best unclaimed camera', () => {
    const out = assignOrKeep(empty(), 'p1', cams, 1000);
    expect(out.claims.p1.cameraId).toBe(10);
  });

  it('gives the second phone the next-best unclaimed camera', () => {
    let s = assignOrKeep(empty(), 'p1', cams, 1000);
    s = assignOrKeep(s, 'p2', cams, 1000);
    expect(s.claims.p2.cameraId).toBe(20);
  });

  it('keeps a phone on its camera and refreshes the heartbeat', () => {
    let s = assignOrKeep(empty(), 'p1', cams, 1000);
    s = assignOrKeep(s, 'p1', cams, 5000);
    expect(s.claims.p1.cameraId).toBe(10);
    expect(s.claims.p1.lastHeartbeat).toBe(5000);
  });

  it('reassigns when the phone’s camera left the terminator', () => {
    let s = assignOrKeep(empty(), 'p1', cams, 1000); // gets 10
    const shrunk = cams.filter((c) => c.id !== 10); // 10 gone
    s = assignOrKeep(s, 'p1', shrunk, 2000);
    expect(s.claims.p1.cameraId).toBe(20);
  });

  it('drops the phone when no camera is available', () => {
    let s = assignOrKeep(empty(), 'p1', [cams[0]], 1000);
    s = assignOrKeep(s, 'p2', [cams[0]], 1000); // only camera already taken
    expect(s.claims.p2).toBeUndefined();
  });
});

describe('releasePhone', () => {
  it('removes the phone’s claim', () => {
    let s = assignOrKeep(empty(), 'p1', cams, 1000);
    s = releasePhone(s, 'p1');
    expect(s.claims.p1).toBeUndefined();
  });
});

describe('computeSlots', () => {
  it('orders phones west→east by longitude and spaces them evenly', () => {
    let s = assignOrKeep(empty(), 'east', cams, 1000);   // wants 10 (lng -120)... 
    // force known assignments:
    s = { claims: {
      east: { cameraId: 30, claimedAt: 1, lastHeartbeat: 1 },  // lng 150
      west: { cameraId: 10, claimedAt: 1, lastHeartbeat: 1 },  // lng -120
      mid:  { cameraId: 20, claimedAt: 1, lastHeartbeat: 1 },  // lng 30
    } };
    const slots = computeSlots(s, cams);
    expect(slots.west.index).toBe(0);
    expect(slots.mid.index).toBe(1);
    expect(slots.east.index).toBe(2);
    expect(slots.west.total).toBe(3);
    expect(slots.west.angleDeg).toBe(0);
    expect(slots.mid.angleDeg).toBe(120);
    expect(slots.east.angleDeg).toBe(240);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/lib/ring/ringLogic.test.ts`
Expected: FAIL — cannot resolve `./ringLogic` / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/lib/ring/ringLogic.ts
export interface RingCamera {
  id: number;
  lng: number;
  title: string | null;
  imageUrl: string;
}

export interface Claim {
  cameraId: number;
  claimedAt: number;
  lastHeartbeat: number;
}

export interface RingSession {
  claims: Record<string, Claim>;
}

export interface RingSlot {
  index: number;
  total: number;
  angleDeg: number;
}

export const CLAIM_TTL_MS = 60_000;

export function pruneStale(
  session: RingSession,
  now: number,
  ttlMs: number = CLAIM_TTL_MS
): RingSession {
  const claims: Record<string, Claim> = {};
  for (const [phoneId, claim] of Object.entries(session.claims)) {
    if (now - claim.lastHeartbeat <= ttlMs) claims[phoneId] = claim;
  }
  return { claims };
}

export function assignOrKeep(
  session: RingSession,
  phoneId: string,
  ranked: RingCamera[],
  now: number
): RingSession {
  const existing = session.claims[phoneId];
  const stillValid = existing && ranked.some((c) => c.id === existing.cameraId);

  if (stillValid) {
    return {
      claims: {
        ...session.claims,
        [phoneId]: { ...existing!, lastHeartbeat: now },
      },
    };
  }

  const taken = new Set(
    Object.entries(session.claims)
      .filter(([pid]) => pid !== phoneId)
      .map(([, c]) => c.cameraId)
  );
  const pick = ranked.find((c) => !taken.has(c.id));

  if (!pick) {
    const next = { ...session.claims };
    delete next[phoneId];
    return { claims: next };
  }

  return {
    claims: {
      ...session.claims,
      [phoneId]: { cameraId: pick.id, claimedAt: now, lastHeartbeat: now },
    },
  };
}

export function releasePhone(session: RingSession, phoneId: string): RingSession {
  const next = { ...session.claims };
  delete next[phoneId];
  return { claims: next };
}

export function computeSlots(
  session: RingSession,
  ranked: RingCamera[]
): Record<string, RingSlot> {
  const lngById = new Map(ranked.map((c) => [c.id, c.lng]));
  const ordered = Object.entries(session.claims)
    .map(([phoneId, c]) => ({ phoneId, lng: lngById.get(c.cameraId) ?? 0 }))
    .sort((a, b) => a.lng - b.lng || a.phoneId.localeCompare(b.phoneId));

  const total = ordered.length;
  const slots: Record<string, RingSlot> = {};
  ordered.forEach((entry, index) => {
    slots[entry.phoneId] = {
      index,
      total,
      angleDeg: total ? (index * 360) / total : 0,
    };
  });
  return slots;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/lib/ring/ringLogic.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add app/lib/ring/ringLogic.ts app/lib/ring/ringLogic.test.ts
git commit -m "feat(ring): pure ring-session logic (assign/prune/slots)"
```

---

### Task 2: Redis-backed ring store

**Files:**
- Create: `app/lib/ring/ringStore.ts`
- Test: `app/lib/ring/ringStore.test.ts`

**Interfaces:**
- Consumes: `RingSession` from `./ringLogic`.
- Produces:
  - `loadSession(redis?: RedisLike): Promise<RingSession>`
  - `saveSession(session: RingSession, redis?: RedisLike): Promise<void>`
  - `type RedisLike = { get<T>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<unknown> }`
  - `const RING_KEY = 'ring:session:v1'`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/ring/ringStore.test.ts
import { describe, it, expect } from 'vitest';
import { loadSession, saveSession, RING_KEY, type RedisLike } from './ringStore';
import type { RingSession } from './ringLogic';

function fakeRedis(initial: Record<string, unknown> = {}): RedisLike & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = { ...initial };
  return {
    store,
    async get<T>(key: string) {
      return (store[key] as T) ?? null;
    },
    async set(key: string, value: unknown) {
      store[key] = value;
      return 'OK';
    },
  };
}

describe('ringStore', () => {
  it('returns an empty session when nothing is stored', async () => {
    const redis = fakeRedis();
    const session = await loadSession(redis);
    expect(session).toEqual({ claims: {} });
  });

  it('round-trips a session through save + load', async () => {
    const redis = fakeRedis();
    const session: RingSession = { claims: { p1: { cameraId: 10, claimedAt: 1, lastHeartbeat: 1 } } };
    await saveSession(session, redis);
    expect(redis.store[RING_KEY]).toEqual(session);
    expect(await loadSession(redis)).toEqual(session);
  });

  it('normalizes a malformed stored value to an empty session', async () => {
    const redis = fakeRedis({ [RING_KEY]: { nope: true } });
    expect(await loadSession(redis)).toEqual({ claims: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/lib/ring/ringStore.test.ts`
Expected: FAIL — cannot resolve `./ringStore`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/lib/ring/ringStore.ts
import { Redis } from '@upstash/redis';
import type { RingSession } from './ringLogic';

export const RING_KEY = 'ring:session:v1';

export type RedisLike = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
};

let client: Redis | null = null;
function defaultClient(): Redis {
  if (!client) client = Redis.fromEnv();
  return client;
}

export async function loadSession(redis: RedisLike = defaultClient()): Promise<RingSession> {
  const data = await redis.get<RingSession>(RING_KEY);
  if (data && typeof data === 'object' && data.claims && typeof data.claims === 'object') {
    return data;
  }
  return { claims: {} };
}

export async function saveSession(
  session: RingSession,
  redis: RedisLike = defaultClient()
): Promise<void> {
  await redis.set(RING_KEY, session);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/lib/ring/ringStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/ring/ringStore.ts app/lib/ring/ringStore.test.ts
git commit -m "feat(ring): Redis-backed ring-session store"
```

---

### Task 3: Ranked-camera adapter

**Files:**
- Create: `app/lib/ring/rankedCameras.ts`
- Test: `app/lib/ring/rankedCameras.test.ts`

**Interfaces:**
- Consumes: `fetchTerminatorWebcams()` from `@/app/lib/terminatorPayload` (returns `WindyWebcam[]`, already ordered by phase then `rank`, with `webcamId: number`, `title: string`, `images?.current?.preview?: string`, `location.longitude: number`, `rank: number`).
- Produces: `getRankedCameras(): Promise<RingCamera[]>` — best-first, only cameras that have a usable image URL.

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/ring/rankedCameras.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/terminatorPayload', () => ({
  fetchTerminatorWebcams: vi.fn(),
}));

import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import { getRankedCameras } from './rankedCameras';

const mockFetch = vi.mocked(fetchTerminatorWebcams);

function webcam(over: Record<string, unknown>) {
  return {
    webcamId: 1,
    title: 'cam',
    rank: 1,
    location: { longitude: 0, latitude: 0, city: '', region: '', country: '', continent: '' },
    images: { current: { preview: 'x.jpg' } },
    ...over,
  } as unknown as Awaited<ReturnType<typeof fetchTerminatorWebcams>>[number];
}

describe('getRankedCameras', () => {
  beforeEach(() => mockFetch.mockReset());

  it('maps webcams to RingCamera and sorts best (lowest rank) first', async () => {
    mockFetch.mockResolvedValue([
      webcam({ webcamId: 2, rank: 5, location: { longitude: 10, latitude: 0, city: '', region: '', country: '', continent: '' } }),
      webcam({ webcamId: 1, rank: 1, location: { longitude: -20, latitude: 0, city: '', region: '', country: '', continent: '' } }),
    ]);
    const out = await getRankedCameras();
    expect(out.map((c) => c.id)).toEqual([1, 2]);
    expect(out[0]).toEqual({ id: 1, lng: -20, title: 'cam', imageUrl: 'x.jpg' });
  });

  it('drops webcams that have no usable image URL', async () => {
    mockFetch.mockResolvedValue([
      webcam({ webcamId: 1, rank: 1, images: undefined }),
      webcam({ webcamId: 2, rank: 2, images: { current: { preview: 'ok.jpg' } } }),
    ]);
    const out = await getRankedCameras();
    expect(out.map((c) => c.id)).toEqual([2]);
  });

  it('uses null title when the webcam title is empty', async () => {
    mockFetch.mockResolvedValue([webcam({ title: '' })]);
    const out = await getRankedCameras();
    expect(out[0].title).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/lib/ring/rankedCameras.test.ts`
Expected: FAIL — cannot resolve `./rankedCameras`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/lib/ring/rankedCameras.ts
import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import type { RingCamera } from './ringLogic';

type Webcam = Awaited<ReturnType<typeof fetchTerminatorWebcams>>[number];

function normalize(w: Webcam): RingCamera | null {
  const imageUrl = w.images?.current?.preview;
  if (!imageUrl) return null;
  return {
    id: w.webcamId,
    lng: w.location.longitude,
    title: w.title ? w.title : null,
    imageUrl,
  };
}

export async function getRankedCameras(): Promise<RingCamera[]> {
  const webcams = await fetchTerminatorWebcams();
  return webcams
    .map(normalize)
    .filter((c): c is RingCamera => c !== null)
    .sort((a, b) => {
      const ra = rankOf(webcams, a.id);
      const rb = rankOf(webcams, b.id);
      return ra - rb;
    });
}

function rankOf(webcams: Webcam[], id: number): number {
  const w = webcams.find((x) => x.webcamId === id);
  return w ? w.rank : Number.MAX_SAFE_INTEGER;
}
```

Note: `fetchTerminatorWebcams()` already returns rows ordered by phase then `rank`, so `Array.prototype.sort` here is a stable no-op in the common case; it is kept explicit so the "best first" contract does not depend on the caller's ordering.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/lib/ring/rankedCameras.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/ring/rankedCameras.ts app/lib/ring/rankedCameras.test.ts
git commit -m "feat(ring): rankedCameras adapter over fetchTerminatorWebcams"
```

---

### Task 4: `/api/ring/sync` endpoint

**Files:**
- Create: `app/api/ring/sync/route.ts`
- Test: `app/api/ring/sync/route.test.ts`

**Interfaces:**
- Consumes: `loadSession`/`saveSession` (Task 2), `getRankedCameras` (Task 3), `pruneStale`/`assignOrKeep`/`releasePhone`/`computeSlots` (Task 1).
- Produces: `POST` handler. Request JSON: `{ phoneId: string, leave?: boolean }`.
  - `400` `{ error: 'phoneId required' }` when `phoneId` missing/blank.
  - `{ left: true }` when `leave` is truthy.
  - `{ assigned: false, reason: 'no_camera_available' }` when the ring is saturated.
  - `{ assigned: true, camera: { id, title, imageUrl }, slot: RingSlot }` otherwise.

- [ ] **Step 1: Write the failing test**

```typescript
// app/api/ring/sync/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/ring/ringStore', () => ({
  loadSession: vi.fn(),
  saveSession: vi.fn(),
}));
vi.mock('@/app/lib/ring/rankedCameras', () => ({
  getRankedCameras: vi.fn(),
}));

import { loadSession, saveSession } from '@/app/lib/ring/ringStore';
import { getRankedCameras } from '@/app/lib/ring/rankedCameras';
import { POST } from './route';

const mockLoad = vi.mocked(loadSession);
const mockSave = vi.mocked(saveSession);
const mockCams = vi.mocked(getRankedCameras);

function req(body: unknown): NextRequest {
  return new NextRequest('http://test/api/ring/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockLoad.mockReset();
  mockSave.mockReset().mockResolvedValue(undefined);
  mockCams.mockReset();
});

describe('POST /api/ring/sync', () => {
  it('400s when phoneId is missing', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('assigns the best camera to a new phone and returns a slot', async () => {
    mockLoad.mockResolvedValue({ claims: {} });
    mockCams.mockResolvedValue([
      { id: 10, lng: -120, title: 'A', imageUrl: 'a.jpg' },
      { id: 20, lng: 30, title: 'B', imageUrl: 'b.jpg' },
    ]);
    const res = await POST(req({ phoneId: 'p1' }));
    const json = await res.json();
    expect(json.assigned).toBe(true);
    expect(json.camera).toEqual({ id: 10, title: 'A', imageUrl: 'a.jpg' });
    expect(json.slot).toEqual({ index: 0, total: 1, angleDeg: 0 });
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('reports no_camera_available when the ring is saturated', async () => {
    mockLoad.mockResolvedValue({
      claims: { other: { cameraId: 10, claimedAt: 1, lastHeartbeat: Date.now() } },
    });
    mockCams.mockResolvedValue([{ id: 10, lng: 0, title: 'A', imageUrl: 'a.jpg' }]);
    const res = await POST(req({ phoneId: 'p1' }));
    const json = await res.json();
    expect(json.assigned).toBe(false);
    expect(json.reason).toBe('no_camera_available');
  });

  it('releases the phone when leave is true', async () => {
    mockLoad.mockResolvedValue({
      claims: { p1: { cameraId: 10, claimedAt: 1, lastHeartbeat: Date.now() } },
    });
    mockCams.mockResolvedValue([{ id: 10, lng: 0, title: 'A', imageUrl: 'a.jpg' }]);
    const res = await POST(req({ phoneId: 'p1', leave: true }));
    const json = await res.json();
    expect(json.left).toBe(true);
    expect(mockSave).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/api/ring/sync/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/api/ring/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { loadSession, saveSession } from '@/app/lib/ring/ringStore';
import { getRankedCameras } from '@/app/lib/ring/rankedCameras';
import {
  pruneStale,
  assignOrKeep,
  releasePhone,
  computeSlots,
} from '@/app/lib/ring/ringLogic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const phoneId = typeof body?.phoneId === 'string' ? body.phoneId.trim() : '';
  if (!phoneId) {
    return NextResponse.json({ error: 'phoneId required' }, { status: 400 });
  }

  const now = Date.now();
  let session = pruneStale(await loadSession(), now);

  if (body?.leave) {
    session = releasePhone(session, phoneId);
    await saveSession(session);
    return NextResponse.json({ left: true });
  }

  const ranked = await getRankedCameras();
  session = assignOrKeep(session, phoneId, ranked, now);
  await saveSession(session);

  const claim = session.claims[phoneId];
  if (!claim) {
    return NextResponse.json({ assigned: false, reason: 'no_camera_available' });
  }

  const camera = ranked.find((c) => c.id === claim.cameraId)!;
  const slot = computeSlots(session, ranked)[phoneId];
  return NextResponse.json({
    assigned: true,
    camera: { id: camera.id, title: camera.title, imageUrl: camera.imageUrl },
    slot,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/api/ring/sync/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ring/sync/route.ts app/api/ring/sync/route.test.ts
git commit -m "feat(ring): /api/ring/sync join/refresh/leave endpoint"
```

---

### Task 5: Station helpers (phone id + clock label)

**Files:**
- Create: `app/lib/ring/stationHelpers.ts`
- Test: `app/lib/ring/stationHelpers.test.ts`

**Interfaces:**
- Consumes: nothing (pure; `getOrCreatePhoneId` touches `localStorage`).
- Produces:
  - `getOrCreatePhoneId(storage?: Pick<Storage, 'getItem' | 'setItem'>, rand?: () => string): string`
  - `clockLabel(angleDeg: number): string` — e.g. `"3 o'clock"`; 0°/360° → `"12 o'clock"`.
  - `const PHONE_ID_KEY = 'ring.phoneId'`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/ring/stationHelpers.test.ts
import { describe, it, expect } from 'vitest';
import { getOrCreatePhoneId, clockLabel, PHONE_ID_KEY } from './stationHelpers';

function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('getOrCreatePhoneId', () => {
  it('creates and persists an id when none exists', () => {
    const s = memStorage();
    const id = getOrCreatePhoneId(s, () => 'fixed');
    expect(id).toBe('fixed');
    expect(s.getItem(PHONE_ID_KEY)).toBe('fixed');
  });

  it('returns the existing id without regenerating', () => {
    const s = memStorage({ [PHONE_ID_KEY]: 'existing' });
    const id = getOrCreatePhoneId(s, () => 'new');
    expect(id).toBe('existing');
  });
});

describe('clockLabel', () => {
  it.each([
    [0, "12 o'clock"],
    [90, "3 o'clock"],
    [180, "6 o'clock"],
    [270, "9 o'clock"],
    [360, "12 o'clock"],
    [30, "1 o'clock"],
  ])('maps %i° to %s', (deg, label) => {
    expect(clockLabel(deg)).toBe(label);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- app/lib/ring/stationHelpers.test.ts`
Expected: FAIL — cannot resolve `./stationHelpers`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/lib/ring/stationHelpers.ts
export const PHONE_ID_KEY = 'ring.phoneId';

export function getOrCreatePhoneId(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  rand: () => string = () => Math.random().toString(36).slice(2)
): string {
  const existing = storage.getItem(PHONE_ID_KEY);
  if (existing) return existing;
  const id = `p_${rand()}`;
  storage.setItem(PHONE_ID_KEY, id);
  return id;
}

export function clockLabel(angleDeg: number): string {
  const normalized = ((angleDeg % 360) + 360) % 360;
  const hour = Math.round(normalized / 30) % 12; // 0..11
  const display = hour === 0 ? 12 : hour;
  return `${display} o'clock`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- app/lib/ring/stationHelpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/ring/stationHelpers.ts app/lib/ring/stationHelpers.test.ts
git commit -m "feat(ring): station helpers (phone id + clock label)"
```

---

### Task 6: `/ring` station page + hook (device-verified)

**Files:**
- Create: `app/ring/useRingStation.ts`
- Create: `app/ring/page.tsx`

**Interfaces:**
- Consumes: `getOrCreatePhoneId`, `clockLabel` (Task 5); `POST /api/ring/sync` (Task 4).
- Produces: default-exported page component at route `/ring`; `useRingStation(): StationState` where
  `interface StationState { status: 'connecting' | 'live' | 'waiting' | 'error'; imageUrl: string | null; title: string | null; slot: { index: number; total: number; angleDeg: number } | null }`.

This task is browser glue: the pure logic it depends on is already tested in Tasks 1–5. It is verified by running the app and loading `/ring` on a real phone rather than by a unit test.

- [ ] **Step 1: Write the hook**

```typescript
// app/ring/useRingStation.ts
'use client';

import { useEffect, useRef, useState } from 'react';
import { getOrCreatePhoneId } from '@/app/lib/ring/stationHelpers';

const SYNC_INTERVAL_MS = 20_000;

export interface StationState {
  status: 'connecting' | 'live' | 'waiting' | 'error';
  imageUrl: string | null;
  title: string | null;
  slot: { index: number; total: number; angleDeg: number } | null;
}

export function useRingStation(): StationState {
  const [state, setState] = useState<StationState>({
    status: 'connecting',
    imageUrl: null,
    title: null,
    slot: null,
  });
  const phoneIdRef = useRef<string>('');

  useEffect(() => {
    phoneIdRef.current = getOrCreatePhoneId(window.localStorage);
    let cancelled = false;
    let wakeLock: { release: () => Promise<void> } | null = null;

    async function sync() {
      try {
        const res = await fetch('/api/ring/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneId: phoneIdRef.current }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.assigned) {
          setState({
            status: 'live',
            imageUrl: data.camera.imageUrl,
            title: data.camera.title,
            slot: data.slot,
          });
        } else {
          setState((s) => ({ ...s, status: 'waiting' }));
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, status: 'error' }));
      }
    }

    async function requestWakeLock() {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
      } catch {
        /* wake lock unavailable — screen may sleep; acceptable for v1 */
      }
    }

    function leaveBeacon() {
      const blob = new Blob(
        [JSON.stringify({ phoneId: phoneIdRef.current, leave: true })],
        { type: 'application/json' }
      );
      navigator.sendBeacon?.('/api/ring/sync', blob);
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') requestWakeLock();
    }

    sync();
    requestWakeLock();
    const interval = setInterval(sync, SYNC_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', leaveBeacon);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leaveBeacon);
      void wakeLock?.release();
    };
  }, []);

  return state;
}
```

- [ ] **Step 2: Write the page**

```tsx
// app/ring/page.tsx
'use client';

import { useRingStation } from './useRingStation';
import { clockLabel } from '@/app/lib/ring/stationHelpers';

export default function RingStationPage() {
  const { status, imageUrl, title, slot } = useRingStation();

  return (
    <main className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black text-white">
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={title ?? 'Live sunset'}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
        {status === 'live' && slot && (
          <p className="text-sm opacity-80">
            {title ?? 'Live sunset'} — stand at {clockLabel(slot.angleDeg)} ({slot.index + 1}/{slot.total})
          </p>
        )}
        {status === 'connecting' && <p className="text-sm opacity-80">Finding the best light…</p>}
        {status === 'waiting' && <p className="text-sm opacity-80">Ring is full — waiting for an opening…</p>}
        {status === 'error' && <p className="text-sm opacity-80">Reconnecting…</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds; `/ring` appears in the route list. (If the project has a faster typecheck script such as `npm run lint` or `tsc --noEmit`, run that too.)

- [ ] **Step 4: Manual device verification**

Run the dev server (`npm run dev`), then from a phone on the same network open `http://<your-machine-ip>:3000/ring`. Confirm:
- A sunset image fills the screen and a placement line ("stand at N o'clock") appears.
- Opening `/ring` on a second phone shows a *different* camera.
- The screen stays awake (Android/Chrome and iOS 16.4+ Safari).
- Closing one phone's tab frees its camera within ~60s (the other phone can then be assigned it after a reload).

- [ ] **Step 5: Commit**

```bash
git add app/ring/useRingStation.ts app/ring/page.tsx
git commit -m "feat(ring): /ring fullscreen station page with wake lock + heartbeat"
```

---

## Post-plan: manual QR + pop-up notes (not code)

The QR for the pop-up is simply the deployed URL + `/ring` (e.g. `https://<deploy-host>/ring`). One shared QR is correct for the greedy model — placement is decided *after* assignment, on-screen. Generating/printing the QR card and the physical-kit setup sheet are deferred to the physical-installation phase (see the brainstorm doc's open questions Q2/Q5).

## Known v1 limitations (intentional, documented — not silent)

- **Read-modify-write races:** two phones syncing in the same instant can both load the same session and one overwrite the other. Acceptable at pop-up scale (a handful of phones, 20s cadence). If contention shows up, move `assignOrKeep`+save into an atomic Upstash `eval` (Lua) — out of scope for the spike.
- **Cost:** `/api/ring/sync` calls `getRankedCameras()` (→ `fetchTerminatorWebcams()`, a DB read) on every heartbeat. Fine for a few phones; if a real installation scales up, back `getRankedCameras()` with the existing terminator cache (`app/lib/cache.ts`, 300s TTL) instead of hitting Neon each time. Flagged given known DB-cost sensitivity.
- **Sunrise + sunset both included:** `rank` is per-phase, so the ring interleaves top sunrises and sunsets. This is desired (the whole terminator), but "single global best" is therefore approximate.

---

## Self-Review

- **Spec coverage:** greedy best-unclaimed assignment (Task 1 `assignOrKeep` + Task 4), live session state with release-on-leave/timeout (Tasks 1–2, `pruneStale`/`releasePhone`), rank-ordered even spacing / "angle flexes with count" (Task 1 `computeSlots`), reuse of existing ranking (Task 3), wake-locked pure-web station + placement guidance (Tasks 5–6), single shared QR (post-plan note). All covered.
- **Placeholder scan:** no TBD/TODO; every code step is complete and runnable.
- **Type consistency:** `RingCamera`/`Claim`/`RingSession`/`RingSlot` defined in Task 1 and consumed unchanged in Tasks 2–4; `getRankedCameras`, `loadSession`/`saveSession`, `assignOrKeep`/`pruneStale`/`releasePhone`/`computeSlots`, `getOrCreatePhoneId`/`clockLabel` names match across tasks and the endpoint.
- **Scope:** one cohesive subsystem (the ring), single testable deliverable per task.
