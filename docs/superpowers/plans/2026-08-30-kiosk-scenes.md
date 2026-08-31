# Kiosk Scenes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frozen kiosk input states ("scenes") — reconstructable from snapshot history, capturable live, and replayable through the `/studio` preview — so mosaic v2 can be dialed against recorded edge cases before the 2026-09-13 showing.

**Architecture:** A `kiosk_scenes` table stores immutable `MosaicProps`-shaped state (`{ sunrise: WindyWebcam[], sunset: WindyWebcam[] }`) plus nullable provenance. Reconstruction reads `webcam_snapshots` (durable Firebase frame URLs + recorded `phase`/`rank` + `llm_*` ratings) with a nearest-to-T pick per webcam; live capture freezes `fetchTerminatorWebcams()` and pins any still-volatile Windy URLs through the existing Firebase upload path. Owner-gated CRUD API under `/api/kiosk/scenes`; the `/studio` preview grows a `live | scene` data-source selector.

**Tech Stack:** Next.js 15 (promise `params`), Neon serverless `sql` from `@/app/lib/db`, vitest, SWR, Firebase storage via `app/lib/webcamSnapshot.ts`.

**Spec:** `docs/superpowers/specs/2026-08-30-kiosk-scenes-design.md`

## Global Constraints

- Verify the current branch before EVERY commit (`git rev-parse --abbrev-ref HEAD` must print `feat/kiosk-scenes`); Jesse merges PRs in parallel and the shared checkout can shift. If it isn't `feat/kiosk-scenes`, STOP and report — never switch branches yourself.
- Stage explicit paths only. NEVER `git add -A` / `git add .` — peer sessions keep untracked files in this checkout.
- Scene `state` is immutable after creation; `PATCH` may touch only `label`, `tags`, `notes`.
- Postgres `NUMERIC` comes back from the Neon driver as **strings** (`"lat":"47.606200"`); every numeric column read in a transform must go through `Number(...)` / a null-safe converter.
- The kiosk itself never reads scenes; replay is a `/studio`-only surface.
- New tables follow the repo migration convention: plain SQL file in `database/migrations/`, applied manually (header comment shows the psql command), `CREATE TABLE IF NOT EXISTS`.
- **Two deliberate deviations from the spec, decided at planning:** (1) reconstruction does not recompute terminator geometry — `webcam_snapshots.phase`/`rank` recorded at capture time already say what the pool looked like; rows with `NULL` phase or missing `firebase_url` are counted in a `skipped` result field (the spec's `missing`). (2) `provenance.gateStats` is omitted in v0 — the live payload does not carry `llm_*` fields and the version-true gate helper lands with studio phase-1 Task 13; provenance is `{ activeVersion, settings }`. Note both in the PR description.

## Preconditions (Task 0 verifies)

- Studio phase-1 (`feat/kiosk-studio-phase1`) is MERGED to main — this plan imports `getProfileSettings` from `@/app/lib/settings/store` and (Task 6) modifies `app/studio/PreviewPane.tsx`.
- The peer session holding the checkout has given its all-clear and the checkout is back on `main`.

---

### Task 0: Preflight + branch setup

**Files:** none created.

- [ ] **Step 1: Confirm the checkout is free and on main**

Run: `git rev-parse --abbrev-ref HEAD && git status --short`
Expected: `main`, and no uncommitted changes except peer sessions' untracked docs (e.g. `docs/superpowers/specs/2026-08-30-kiosk-scenes-design.md`, a quality-ceiling plan, a STATE-doc edit). If HEAD is any other branch or tracked files are modified, STOP — a peer session still holds the checkout; report instead of proceeding.

- [ ] **Step 2: Confirm phase-1 is merged**

Run: `git pull --ff-only && ls app/lib/settings/store.ts app/studio/PreviewPane.tsx`
Expected: both files exist. If not, STOP and report — Tasks 4 and 6 depend on them (Tasks 1–3 could proceed, but sequencing restarts from a coordinated decision, not silently).

- [ ] **Step 3: Create the branch and push immediately (multi-session protocol)**

```bash
git checkout -b feat/kiosk-scenes
git push -u origin feat/kiosk-scenes
```

---

### Task 1: Snapshot-history coverage report

Bounds how wild reconstructed scenes can be and calibrates the default window. A read-only script, no TDD.

**Files:**
- Create: `scripts/scene-history-report.mjs`

**Interfaces:**
- Consumes: `DATABASE_URL` from `.env.local` (same pattern as `scripts/usage-report.mjs`).
- Produces: a printed report; paste it into the PR description and `.superpowers/sdd` progress notes.

- [ ] **Step 1: Write the script**

```js
// scripts/scene-history-report.mjs
// Read-only report: how deep and how evenly webcam_snapshots history covers
// the clock/calendar. Run: node scripts/scene-history-report.mjs
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync('.env.local', 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in env or .env.local');
  return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

const sql = neon(loadDatabaseUrl());

const [range] = await sql`
  SELECT MIN(captured_at) AS oldest, MAX(captured_at) AS newest,
         COUNT(*)::int AS total,
         COUNT(DISTINCT webcam_id)::int AS webcams
  FROM webcam_snapshots`;
console.log('range:', range);

const byMonth = await sql`
  SELECT to_char(date_trunc('month', captured_at), 'YYYY-MM') AS month,
         COUNT(*)::int AS rows, COUNT(DISTINCT webcam_id)::int AS webcams
  FROM webcam_snapshots GROUP BY 1 ORDER BY 1`;
console.table(byMonth);

const byHourUtc = await sql`
  SELECT EXTRACT(HOUR FROM captured_at)::int AS hour_utc, COUNT(*)::int AS rows
  FROM webcam_snapshots GROUP BY 1 ORDER BY 1`;
console.table(byHourUtc);

const phaseCoverage = await sql`
  SELECT phase, COUNT(*)::int AS rows,
         COUNT(llm_quality)::int AS with_llm
  FROM webcam_snapshots GROUP BY 1 ORDER BY 1`;
console.table(phaseCoverage);
```

- [ ] **Step 2: Run it and record the output**

Run: `node scripts/scene-history-report.mjs`
Expected: tables print. Save the output verbatim into the progress notes; it rides the PR description. If `llm_quality`/`phase` columns error as nonexistent, STOP and report the actual `webcam_snapshots` columns (`SELECT column_name FROM information_schema.columns WHERE table_name = 'webcam_snapshots'`) — Task 3's query must be adjusted to reality before proceeding.

- [ ] **Step 3: Commit**

```bash
git add scripts/scene-history-report.mjs
git commit -m "feat(scenes): snapshot-history coverage report script"
```

---

### Task 2: `kiosk_scenes` migration + DB store module

**Files:**
- Create: `database/migrations/20260830_kiosk_scenes.sql`
- Create: `app/lib/scenes/types.ts`
- Create: `app/lib/scenes/store.ts`
- Test: `app/lib/scenes/store.test.ts`

**Interfaces:**
- Consumes: `sql` from `@/app/lib/db`; `WindyWebcam` from `@/app/lib/types`.
- Produces (later tasks import from `@/app/lib/scenes/types` and `@/app/lib/scenes/store`):

```ts
// types.ts
export interface SceneState { sunrise: WindyWebcam[]; sunset: WindyWebcam[] }
export interface SceneProvenance {
  activeVersion: string;
  settings: Record<string, Record<string, unknown>>; // namespace -> deviations
}
export interface SceneSummary {
  id: number; label: string; tags: string[];
  representsAt: string; source: 'live' | 'historical'; createdAt: string;
}
export interface Scene extends SceneSummary {
  notes: string; state: SceneState; provenance: SceneProvenance | null;
}
export interface SceneCreateInput {
  label: string; tags: string[]; notes: string;
  representsAt: Date; source: 'live' | 'historical';
  state: SceneState; provenance: SceneProvenance | null;
}
// store.ts
export async function createScene(input: SceneCreateInput): Promise<number>;
export async function listScenes(): Promise<SceneSummary[]>;
export async function getScene(id: number): Promise<Scene | null>;
export async function updateSceneMeta(
  id: number,
  patch: { label?: string; tags?: string[]; notes?: string }
): Promise<boolean>; // false when id not found
export async function deleteScene(id: number): Promise<boolean>;
```

- [ ] **Step 1: Write the migration**

```sql
-- kiosk_scenes: frozen kiosk input states for /studio replay + the grant
-- archive (spec: docs/superpowers/specs/2026-08-30-kiosk-scenes-design.md).
-- state is the MosaicProps-shaped pool; provenance records what was live at
-- capture (null for reconstructed scenes). state is immutable after insert.
-- Apply with:
--   psql "$DATABASE_URL" -f database/migrations/20260830_kiosk_scenes.sql
CREATE TABLE IF NOT EXISTS kiosk_scenes (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  represents_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live', 'historical')),
  state JSONB NOT NULL,
  provenance JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the failing store test**

Follow the repo's settings-store test pattern: mock `@/app/lib/db`, capture the tagged-template strings, return canned rows.

```ts
// app/lib/scenes/store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (...args: unknown[]) => sqlMock(...args) }));

import { createScene, listScenes, getScene, updateSceneMeta, deleteScene } from './store';

const state = { sunrise: [], sunset: [] };

beforeEach(() => sqlMock.mockReset());

describe('createScene', () => {
  it('inserts and returns the new id', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    const id = await createScene({
      label: 'solstice 4:45am', tags: ['edge-case'], notes: '',
      representsAt: new Date('2026-06-21T11:45:00Z'),
      source: 'historical', state, provenance: null,
    });
    expect(id).toBe(7);
    const query = (sqlMock.mock.calls[0][0] as string[]).join('?');
    expect(query).toContain('INSERT INTO kiosk_scenes');
  });
});

describe('listScenes', () => {
  it('maps rows to summaries, newest represents_at first', async () => {
    sqlMock.mockResolvedValueOnce([{
      id: 1, label: 'a', tags: ['x'], represents_at: '2026-08-30T02:00:00Z',
      source: 'live', created_at: '2026-08-30T02:01:00Z',
    }]);
    const scenes = await listScenes();
    expect(scenes[0]).toEqual({
      id: 1, label: 'a', tags: ['x'], representsAt: '2026-08-30T02:00:00Z',
      source: 'live', createdAt: '2026-08-30T02:01:00Z',
    });
    expect((sqlMock.mock.calls[0][0] as string[]).join('?')).toContain('ORDER BY represents_at DESC');
  });
});

describe('getScene', () => {
  it('returns null for a missing id', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getScene(99)).toBeNull();
  });
  it('returns the full scene', async () => {
    sqlMock.mockResolvedValueOnce([{
      id: 2, label: 'b', tags: [], notes: 'n', represents_at: 't1',
      source: 'historical', created_at: 't2', state, provenance: null,
    }]);
    const scene = await getScene(2);
    expect(scene?.state).toEqual(state);
    expect(scene?.notes).toBe('n');
  });
});

describe('updateSceneMeta', () => {
  it('updates only provided fields and reports found', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 2 }]);
    expect(await updateSceneMeta(2, { label: 'renamed' })).toBe(true);
    const query = (sqlMock.mock.calls[0][0] as string[]).join('?');
    expect(query).toContain('UPDATE kiosk_scenes');
    expect(query).not.toContain('state');
  });
  it('returns false when nothing matched', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await updateSceneMeta(99, { notes: 'x' })).toBe(false);
  });
});

describe('deleteScene', () => {
  it('returns true when a row was deleted', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 3 }]);
    expect(await deleteScene(3)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run app/lib/scenes/store.test.ts`
Expected: FAIL — module `./store` not found.

- [ ] **Step 4: Implement `types.ts` and `store.ts`**

```ts
// app/lib/scenes/store.ts
import 'server-only';
import { sql } from '@/app/lib/db';
import type { Scene, SceneCreateInput, SceneSummary } from './types';

export async function createScene(input: SceneCreateInput): Promise<number> {
  const rows = await sql`
    INSERT INTO kiosk_scenes (label, tags, notes, represents_at, source, state, provenance)
    VALUES (${input.label}, ${input.tags}, ${input.notes}, ${input.representsAt},
            ${input.source}, ${JSON.stringify(input.state)},
            ${input.provenance ? JSON.stringify(input.provenance) : null})
    RETURNING id`;
  return rows[0].id as number;
}

export async function listScenes(): Promise<SceneSummary[]> {
  const rows = await sql`
    SELECT id, label, tags, represents_at, source, created_at
    FROM kiosk_scenes ORDER BY represents_at DESC`;
  return rows.map((r) => ({
    id: r.id as number, label: r.label as string, tags: r.tags as string[],
    representsAt: String(r.represents_at), source: r.source as 'live' | 'historical',
    createdAt: String(r.created_at),
  }));
}

export async function getScene(id: number): Promise<Scene | null> {
  const rows = await sql`
    SELECT id, label, tags, notes, represents_at, source, state, provenance, created_at
    FROM kiosk_scenes WHERE id = ${id}`;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id as number, label: r.label as string, tags: r.tags as string[],
    notes: r.notes as string, representsAt: String(r.represents_at),
    source: r.source as 'live' | 'historical', createdAt: String(r.created_at),
    state: r.state as Scene['state'],
    provenance: (r.provenance ?? null) as Scene['provenance'],
  };
}

export async function updateSceneMeta(
  id: number,
  patch: { label?: string; tags?: string[]; notes?: string }
): Promise<boolean> {
  const rows = await sql`
    UPDATE kiosk_scenes SET
      label = COALESCE(${patch.label ?? null}, label),
      tags  = COALESCE(${patch.tags ?? null}, tags),
      notes = COALESCE(${patch.notes ?? null}, notes)
    WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

export async function deleteScene(id: number): Promise<boolean> {
  const rows = await sql`DELETE FROM kiosk_scenes WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}
```

(Neon JSONB accepts stringified JSON on insert and returns parsed objects on select — same behavior the settings store relies on.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/lib/scenes/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Apply the migration**

Run (psql may be missing locally; if so use the same node + neon driver + `.env.local` approach the settings-store task used):
`psql "$DATABASE_URL" -f database/migrations/20260830_kiosk_scenes.sql`
Then verify: columns of `kiosk_scenes` match the DDL via `information_schema.columns`.

- [ ] **Step 7: Commit**

```bash
git add database/migrations/20260830_kiosk_scenes.sql \
  app/lib/scenes/types.ts app/lib/scenes/store.ts app/lib/scenes/store.test.ts
git commit -m "feat(scenes): kiosk_scenes table + CRUD store"
```

---

### Task 3: Reconstruction from snapshot history

**Files:**
- Create: `app/lib/scenes/reconstruct.ts`
- Test: `app/lib/scenes/reconstruct.test.ts`

**Interfaces:**
- Consumes: `sql` from `@/app/lib/db`; `WindyWebcam` from `@/app/lib/types`; `SceneState` from Task 2.
- Produces (consumed by Task 5):

```ts
export interface ReconstructResult {
  state: SceneState;
  reconstructed: number; // webcams placed into the state
  skipped: number;       // rows dropped (null phase or empty firebase_url)
}
export interface HistoricalSnapshotRow { /* row shape below — exported for tests */ }
export function rowsToSceneState(rows: HistoricalSnapshotRow[]): ReconstructResult; // pure
export async function reconstructScene(at: Date, windowMinutes: number): Promise<ReconstructResult>;
```

- [ ] **Step 1: Write the failing test for the pure transform**

```ts
// app/lib/scenes/reconstruct.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (...args: unknown[]) => sqlMock(...args) }));

import { rowsToSceneState, reconstructScene, type HistoricalSnapshotRow } from './reconstruct';

const row = (over: Partial<HistoricalSnapshotRow>): HistoricalSnapshotRow => ({
  webcam_id: 1, phase: 'sunset', rank: 3,
  firebase_url: 'https://firebasestorage.googleapis.com/x.jpg',
  snapshot_captured_at: '2026-06-21T11:40:00Z',
  llm_quality: '0.8125', llm_is_sunset: true, llm_model: 'claude-sonnet-4-5',
  title: 'Cam', status: 'active', view_count: 10,
  lat: '47.606200', lng: '-122.332100',
  city: 'Seattle', region: 'WA', country: 'US', continent: 'NA',
  categories: [], urls: null, player: null,
  rating: 4, orientation: 'W', webcam_source: 'windy', external_id: 'w1',
  ...over,
});

describe('rowsToSceneState', () => {
  it('builds WindyWebcam entries with the durable frame and numeric coords', () => {
    const { state, reconstructed, skipped } = rowsToSceneState([row({})]);
    expect(reconstructed).toBe(1);
    expect(skipped).toBe(0);
    const cam = state.sunset[0];
    expect(cam.images?.current.preview).toBe('https://firebasestorage.googleapis.com/x.jpg');
    expect(cam.location.latitude).toBe(47.6062);   // Neon NUMERIC string → number
    expect(cam.location.longitude).toBe(-122.3321);
    expect(cam.llmQuality).toBe(0.8125);
    expect(cam.phase).toBe('sunset');
    expect(cam.rank).toBe(3);
  });

  it('splits by recorded phase', () => {
    const { state } = rowsToSceneState([
      row({ webcam_id: 1, phase: 'sunrise' }),
      row({ webcam_id: 2, phase: 'sunset' }),
    ]);
    expect(state.sunrise).toHaveLength(1);
    expect(state.sunset).toHaveLength(1);
  });

  it('skips rows with null phase or empty firebase_url and counts them', () => {
    const { reconstructed, skipped } = rowsToSceneState([
      row({}), row({ webcam_id: 2, phase: null }), row({ webcam_id: 3, firebase_url: '' }),
    ]);
    expect(reconstructed).toBe(1);
    expect(skipped).toBe(2);
  });

  it('orders each feed by rank ascending', () => {
    const { state } = rowsToSceneState([
      row({ webcam_id: 1, rank: 9 }), row({ webcam_id: 2, rank: 2 }),
    ]);
    expect(state.sunset.map((c) => c.rank)).toEqual([2, 9]);
  });
});

describe('reconstructScene', () => {
  beforeEach(() => sqlMock.mockReset());
  it('queries a window around the timestamp with a nearest-row pick per webcam', async () => {
    sqlMock.mockResolvedValueOnce([row({})]);
    const result = await reconstructScene(new Date('2026-06-21T11:45:00Z'), 45);
    expect(result.reconstructed).toBe(1);
    const query = (sqlMock.mock.calls[0][0] as string[]).join('?');
    expect(query).toContain('DISTINCT ON (s.webcam_id)');
    expect(query).toContain('FROM webcam_snapshots s');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/lib/scenes/reconstruct.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reconstruct.ts`**

```ts
// app/lib/scenes/reconstruct.ts
import 'server-only';
import { sql } from '@/app/lib/db';
import type { WindyWebcam } from '@/app/lib/types';
import type { SceneState } from './types';

export interface HistoricalSnapshotRow {
  webcam_id: number;
  phase: 'sunrise' | 'sunset' | null;
  rank: number | null;
  firebase_url: string;
  snapshot_captured_at: string;
  llm_quality: string | number | null;
  llm_is_sunset: boolean | null;
  llm_model: string | null;
  title: string | null;
  status: string | null;
  view_count: number | null;
  lat: string | number | null;
  lng: string | number | null;
  city: string | null;
  region: string | null;
  country: string | null;
  continent: string | null;
  categories: unknown;
  urls: unknown;
  player: unknown;
  rating: number | null;
  orientation: string | null;
  webcam_source: string | null;
  external_id: string | null;
}

export interface ReconstructResult {
  state: SceneState;
  reconstructed: number;
  skipped: number;
}

const toMaybeNumber = (v: string | number | null): number | null =>
  v === null || v === undefined ? null : Number(v);

export function rowsToSceneState(rows: HistoricalSnapshotRow[]): ReconstructResult {
  const state: SceneState = { sunrise: [], sunset: [] };
  let skipped = 0;
  for (const r of rows) {
    if (!r.phase || !r.firebase_url) { skipped += 1; continue; }
    const cam: WindyWebcam = {
      webcamId: r.webcam_id,
      title: r.title ?? 'Unknown',
      viewCount: r.view_count ?? 0,
      status: r.status ?? 'unknown',
      images: { current: { preview: r.firebase_url } },
      location: {
        city: r.city ?? '', region: r.region ?? '',
        latitude: Number(r.lat), longitude: Number(r.lng),
        country: r.country ?? '', continent: r.continent ?? '',
      },
      categories: (r.categories as WindyWebcam['categories']) ?? [],
      urls: (r.urls as WindyWebcam['urls']) ?? undefined,
      player: (r.player as WindyWebcam['player']) ?? undefined,
      phase: r.phase,
      rank: r.rank ?? undefined,
      source: r.webcam_source ?? undefined,
      externalId: r.external_id ?? undefined,
      rating: r.rating ?? undefined,
      orientation: (r.orientation as WindyWebcam['orientation']) ?? undefined,
      llmQuality: toMaybeNumber(r.llm_quality),
      llmIsSunset: r.llm_is_sunset,
      llmModel: r.llm_model,
      lastUpdatedOn: r.snapshot_captured_at,
    };
    state[r.phase].push(cam);
  }
  const byRank = (a: WindyWebcam, b: WindyWebcam) =>
    (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
  state.sunrise.sort(byRank);
  state.sunset.sort(byRank);
  return { state, reconstructed: state.sunrise.length + state.sunset.length, skipped };
}

export async function reconstructScene(
  at: Date,
  windowMinutes: number
): Promise<ReconstructResult> {
  const windowMs = windowMinutes * 60 * 1000;
  const from = new Date(at.getTime() - windowMs);
  const to = new Date(at.getTime() + windowMs);
  const rows = (await sql`
    SELECT DISTINCT ON (s.webcam_id)
      s.webcam_id, s.phase, s.rank, s.firebase_url,
      s.captured_at AS snapshot_captured_at,
      s.llm_quality, s.llm_is_sunset, s.llm_model,
      w.title, w.status, w.view_count, w.lat, w.lng,
      w.city, w.region, w.country, w.continent,
      w.categories, w.urls, w.player, w.rating, w.orientation,
      w.source AS webcam_source, w.external_id
    FROM webcam_snapshots s
    JOIN webcams w ON w.id = s.webcam_id
    WHERE s.captured_at BETWEEN ${from} AND ${to}
    ORDER BY s.webcam_id,
      ABS(EXTRACT(EPOCH FROM (s.captured_at - ${at})))
  `) as HistoricalSnapshotRow[];
  return rowsToSceneState(rows);
}
```

If Task 1's report showed `webcam_snapshots` lacks any column named here, adjust the SELECT to the real columns before this step and note it in the progress file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/lib/scenes/reconstruct.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/scenes/reconstruct.ts app/lib/scenes/reconstruct.test.ts
git commit -m "feat(scenes): reconstruct scene state from snapshot history"
```

---

### Task 4: Live capture with pinning + provenance

**Files:**
- Create: `app/lib/scenes/captureLive.ts`
- Test: `app/lib/scenes/captureLive.test.ts`

**Interfaces:**
- Consumes: `fetchTerminatorWebcams` from `@/app/lib/terminatorPayload`; `captureWebcamSnapshot` from `@/app/lib/webcamSnapshot`; `getProfileSettings` from `@/app/lib/settings/store` (phase-1); `DEFAULT_MOSAIC_VERSION` from `@/app/components/mosaic/registry`; Task 2 types.
- Produces (consumed by Task 5):

```ts
export interface LiveCaptureResult {
  state: SceneState;
  provenance: SceneProvenance;
  pinned: number;      // frames uploaded to Firebase during this capture
  pinFailures: number; // frames left on their volatile URL after a failed pin
}
export async function captureLiveScene(): Promise<LiveCaptureResult>;
export function isDurableFrameUrl(url: string | undefined): boolean; // pure, exported for tests
```

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/scenes/captureLive.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WindyWebcam } from '@/app/lib/types';

const fetchTerminatorWebcams = vi.fn();
const captureWebcamSnapshot = vi.fn();
const getProfileSettings = vi.fn();
vi.mock('@/app/lib/terminatorPayload', () => ({ fetchTerminatorWebcams: (...a: unknown[]) => fetchTerminatorWebcams(...a) }));
vi.mock('@/app/lib/webcamSnapshot', () => ({ captureWebcamSnapshot: (...a: unknown[]) => captureWebcamSnapshot(...a) }));
vi.mock('@/app/lib/settings/store', () => ({ getProfileSettings: (...a: unknown[]) => getProfileSettings(...a) }));

import { captureLiveScene, isDurableFrameUrl } from './captureLive';

const cam = (over: Partial<WindyWebcam>): WindyWebcam => ({
  webcamId: 1, title: 'c', viewCount: 0, status: 'active',
  images: { current: { preview: 'https://firebasestorage.googleapis.com/f.jpg' } },
  location: { latitude: 1, longitude: 2 }, categories: [],
  phase: 'sunset', rank: 1,
  ...over,
});

beforeEach(() => {
  fetchTerminatorWebcams.mockReset();
  captureWebcamSnapshot.mockReset();
  getProfileSettings.mockReset();
  getProfileSettings.mockResolvedValue({ shared: { values: { activeVersion: 'v1' }, revision: 3 } });
});

describe('isDurableFrameUrl', () => {
  it('accepts firebase storage URLs and rejects windy CDN URLs', () => {
    expect(isDurableFrameUrl('https://firebasestorage.googleapis.com/f.jpg')).toBe(true);
    expect(isDurableFrameUrl('https://images-webcams.windy.com/x/preview.jpg')).toBe(false);
    expect(isDurableFrameUrl(undefined)).toBe(false);
  });
});

describe('captureLiveScene', () => {
  it('keeps durable frames untouched and splits feeds by phase', async () => {
    fetchTerminatorWebcams.mockResolvedValue([
      cam({ webcamId: 1, phase: 'sunrise' }), cam({ webcamId: 2, phase: 'sunset' }),
    ]);
    const result = await captureLiveScene();
    expect(captureWebcamSnapshot).not.toHaveBeenCalled();
    expect(result.state.sunrise).toHaveLength(1);
    expect(result.state.sunset).toHaveLength(1);
    expect(result.pinned).toBe(0);
  });

  it('pins volatile frames and swaps in the uploaded URL', async () => {
    const volatile = cam({ webcamId: 3, images: { current: { preview: 'https://images-webcams.windy.com/3.jpg' } } });
    fetchTerminatorWebcams.mockResolvedValue([volatile]);
    captureWebcamSnapshot.mockResolvedValue({ url: 'https://firebasestorage.googleapis.com/pinned.jpg', path: 'p' });
    const result = await captureLiveScene();
    expect(result.pinned).toBe(1);
    expect(result.state.sunset[0].images?.current.preview)
      .toBe('https://firebasestorage.googleapis.com/pinned.jpg');
  });

  it('counts a failed pin and keeps the original URL', async () => {
    const volatile = cam({ webcamId: 3, images: { current: { preview: 'https://images-webcams.windy.com/3.jpg' } } });
    fetchTerminatorWebcams.mockResolvedValue([volatile]);
    captureWebcamSnapshot.mockResolvedValue(null);
    const result = await captureLiveScene();
    expect(result.pinFailures).toBe(1);
    expect(result.state.sunset[0].images?.current.preview)
      .toBe('https://images-webcams.windy.com/3.jpg');
  });

  it('records provenance from the live profile', async () => {
    fetchTerminatorWebcams.mockResolvedValue([cam({})]);
    const result = await captureLiveScene();
    expect(getProfileSettings).toHaveBeenCalledWith('live');
    expect(result.provenance.activeVersion).toBe('v1');
    expect(result.provenance.settings.shared).toEqual({ activeVersion: 'v1' });
  });
});
```

Note for the implementer: `getProfileSettings`'s exact return shape is defined in `app/lib/settings/store.ts` (merged with phase-1). Read it first; if it differs from `{ [namespace]: { values, revision } }`, adapt the provenance extraction AND this test's mock to the real shape — the invariant that matters is: `provenance.settings` holds the live profile's deviations per namespace, and `activeVersion` falls back to `DEFAULT_MOSAIC_VERSION` when the live profile has no `shared.activeVersion`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/lib/scenes/captureLive.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `captureLive.ts`**

```ts
// app/lib/scenes/captureLive.ts
import 'server-only';
import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import { captureWebcamSnapshot } from '@/app/lib/webcamSnapshot';
import { getProfileSettings } from '@/app/lib/settings/store';
import { DEFAULT_MOSAIC_VERSION } from '@/app/components/mosaic/registry';
import type { WindyWebcam } from '@/app/lib/types';
import type { SceneProvenance, SceneState } from './types';

export function isDurableFrameUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === 'firebasestorage.googleapis.com';
  } catch {
    return false;
  }
}

export interface LiveCaptureResult {
  state: SceneState;
  provenance: SceneProvenance;
  pinned: number;
  pinFailures: number;
}

export async function captureLiveScene(): Promise<LiveCaptureResult> {
  const webcams = await fetchTerminatorWebcams();
  let pinned = 0;
  let pinFailures = 0;

  const frozen: WindyWebcam[] = [];
  for (const cam of webcams) {
    const preview = cam.images?.current?.preview;
    if (isDurableFrameUrl(preview)) {
      frozen.push(cam);
      continue;
    }
    const uploaded = await captureWebcamSnapshot(cam);
    if (uploaded) {
      pinned += 1;
      frozen.push({
        ...cam,
        images: { ...cam.images, current: { ...cam.images?.current, preview: uploaded.url } },
      });
    } else {
      pinFailures += 1;
      frozen.push(cam);
    }
  }

  const state: SceneState = {
    sunrise: frozen.filter((c) => c.phase === 'sunrise'),
    sunset: frozen.filter((c) => c.phase === 'sunset'),
  };

  const profile = await getProfileSettings('live');
  const settings: SceneProvenance['settings'] = {};
  for (const [namespace, entry] of Object.entries(profile)) {
    settings[namespace] = entry.values as Record<string, unknown>;
  }
  const activeVersion =
    (settings.shared?.activeVersion as string | undefined) ?? DEFAULT_MOSAIC_VERSION;

  return { state, provenance: { activeVersion, settings }, pinned, pinFailures };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/lib/scenes/captureLive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/scenes/captureLive.ts app/lib/scenes/captureLive.test.ts
git commit -m "feat(scenes): live capture with frame pinning + provenance"
```

---

### Task 5: Owner-gated scenes API

**Files:**
- Create: `app/api/kiosk/scenes/route.ts` (GET list, POST create)
- Create: `app/api/kiosk/scenes/[id]/route.ts` (GET, PATCH, DELETE)
- Test: `app/api/kiosk/scenes/route.test.ts`, `app/api/kiosk/scenes/[id]/route.test.ts`

**Interfaces:**
- Consumes: `requireOwner` from `@/app/lib/owner` (returns `NextResponse | null`; null means allowed); Task 2 store; Task 3 `reconstructScene`; Task 4 `captureLiveScene`.
- Produces (consumed by Task 6's hook):
  - `GET /api/kiosk/scenes` → `{ scenes: SceneSummary[] }`
  - `POST /api/kiosk/scenes` body `{ label: string, at?: string, windowMinutes?: number, tags?: string[], notes?: string }` → `201 { id, source, reconstructed?, skipped?, pinned?, pinFailures? }`. With `at`: historical reconstruct (`windowMinutes` clamped to 5–180, default 45; `400` on unparseable `at`; `422` when reconstruction finds zero webcams). Without `at`: live capture, `representsAt = now`.
  - `GET /api/kiosk/scenes/:id` → full `Scene` JSON, `404` when missing.
  - `PATCH /api/kiosk/scenes/:id` body `{ label?, tags?, notes? }` → `{ ok: true }`, `404` when missing; any other key in the body → `400` (state immutability).
  - `DELETE /api/kiosk/scenes/:id` → `{ ok: true }`, `404` when missing.
  - Every handler starts with the owner gate and returns its `401/403` response verbatim when denied.

- [ ] **Step 1: Write the failing tests**

Follow the auth/round-trip pattern of `app/api/kiosk/settings/route.test.ts` (merged with phase-1) — mock `requireOwner` plus the scenes modules; assert denied requests return the gate's response AND that store/reconstruct/capture mocks were never called.

```ts
// app/api/kiosk/scenes/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwner = vi.fn();
const listScenes = vi.fn();
const createScene = vi.fn();
const reconstructScene = vi.fn();
const captureLiveScene = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/app/lib/scenes/store', () => ({
  listScenes: () => listScenes(), createScene: (i: unknown) => createScene(i),
}));
vi.mock('@/app/lib/scenes/reconstruct', () => ({
  reconstructScene: (...a: unknown[]) => reconstructScene(...a),
}));
vi.mock('@/app/lib/scenes/captureLive', () => ({
  captureLiveScene: () => captureLiveScene(),
}));

import { GET, POST } from './route';

const emptyState = { sunrise: [], sunset: [] };
const post = (body: unknown) =>
  POST(new Request('http://t/api/kiosk/scenes', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  requireOwner.mockResolvedValue(null);
});

describe('GET /api/kiosk/scenes', () => {
  it('denies non-owners without touching the store', async () => {
    requireOwner.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listScenes).not.toHaveBeenCalled();
  });
  it('lists scenes', async () => {
    listScenes.mockResolvedValue([{ id: 1 }]);
    const res = await GET();
    expect((await res.json()).scenes).toEqual([{ id: 1 }]);
  });
});

describe('POST /api/kiosk/scenes', () => {
  it('rejects a missing label', async () => {
    expect((await post({ at: '2026-06-21T11:45:00Z' })).status).toBe(400);
  });
  it('rejects an unparseable at', async () => {
    expect((await post({ label: 'x', at: 'not-a-date' })).status).toBe(400);
  });
  it('reconstructs when at is given', async () => {
    reconstructScene.mockResolvedValue({ state: { sunrise: [{}], sunset: [] }, reconstructed: 1, skipped: 2 });
    createScene.mockResolvedValue(5);
    const res = await post({ label: 'solstice', at: '2026-06-21T11:45:00Z', windowMinutes: 30 });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 5, source: 'historical', reconstructed: 1, skipped: 2 });
    expect(reconstructScene).toHaveBeenCalledWith(new Date('2026-06-21T11:45:00Z'), 30);
    expect(createScene).toHaveBeenCalledWith(expect.objectContaining({ source: 'historical', provenance: null }));
    expect(captureLiveScene).not.toHaveBeenCalled();
  });
  it('returns 422 when reconstruction finds nothing', async () => {
    reconstructScene.mockResolvedValue({ state: emptyState, reconstructed: 0, skipped: 0 });
    expect((await post({ label: 'x', at: '2001-01-01T00:00:00Z' })).status).toBe(422);
    expect(createScene).not.toHaveBeenCalled();
  });
  it('captures live when at is omitted', async () => {
    captureLiveScene.mockResolvedValue({
      state: { sunrise: [], sunset: [{}] },
      provenance: { activeVersion: 'v1', settings: {} }, pinned: 2, pinFailures: 1,
    });
    createScene.mockResolvedValue(6);
    const res = await post({ label: 'tonight' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 6, source: 'live', pinned: 2, pinFailures: 1 });
    expect(createScene).toHaveBeenCalledWith(expect.objectContaining({
      source: 'live',
      provenance: { activeVersion: 'v1', settings: {} },
    }));
  });
});
```

```ts
// app/api/kiosk/scenes/[id]/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwner = vi.fn();
const getScene = vi.fn();
const updateSceneMeta = vi.fn();
const deleteScene = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwner() }));
vi.mock('@/app/lib/scenes/store', () => ({
  getScene: (id: number) => getScene(id),
  updateSceneMeta: (id: number, p: unknown) => updateSceneMeta(id, p),
  deleteScene: (id: number) => deleteScene(id),
}));

import { GET, PATCH, DELETE } from './route';

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  new Request('http://t/api/kiosk/scenes/2', { method: 'PATCH', body: JSON.stringify(body ?? {}) });

beforeEach(() => {
  vi.clearAllMocks();
  requireOwner.mockResolvedValue(null);
});

it('GET denies non-owners without touching the store', async () => {
  requireOwner.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }));
  const res = await GET(req(), params('2'));
  expect(res.status).toBe(403);
  expect(getScene).not.toHaveBeenCalled();
});

it('GET returns 404 for missing and the scene when found', async () => {
  getScene.mockResolvedValueOnce(null);
  expect((await GET(req(), params('9'))).status).toBe(404);
  getScene.mockResolvedValueOnce({ id: 2, label: 'b' });
  const res = await GET(req(), params('2'));
  expect((await res.json()).label).toBe('b');
});

it('GET rejects a non-numeric id', async () => {
  expect((await GET(req(), params('abc'))).status).toBe(400);
  expect(getScene).not.toHaveBeenCalled();
});

it('PATCH updates metadata only', async () => {
  updateSceneMeta.mockResolvedValue(true);
  const res = await PATCH(req({ label: 'renamed', tags: ['grant'] }), params('2'));
  expect(res.status).toBe(200);
  expect(updateSceneMeta).toHaveBeenCalledWith(2, { label: 'renamed', tags: ['grant'] });
});

it('PATCH rejects attempts to modify state', async () => {
  const res = await PATCH(req({ state: { sunrise: [] } }), params('2'));
  expect(res.status).toBe(400);
  expect(updateSceneMeta).not.toHaveBeenCalled();
});

it('PATCH and DELETE 404 on a missing id', async () => {
  updateSceneMeta.mockResolvedValue(false);
  expect((await PATCH(req({ label: 'x' }), params('9'))).status).toBe(404);
  deleteScene.mockResolvedValue(false);
  expect((await DELETE(req(), params('9'))).status).toBe(404);
});

it('DELETE removes a scene', async () => {
  deleteScene.mockResolvedValue(true);
  const res = await DELETE(req(), params('3'));
  expect(await res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/kiosk/scenes`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both routes**

```ts
// app/api/kiosk/scenes/route.ts
import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { createScene, listScenes } from '@/app/lib/scenes/store';
import { reconstructScene } from '@/app/lib/scenes/reconstruct';
import { captureLiveScene } from '@/app/lib/scenes/captureLive';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // live capture may pin several frames

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  return NextResponse.json({ scenes: await listScenes() });
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  const tags = Array.isArray(body.tags) ? body.tags.map(String) : [];
  const notes = typeof body.notes === 'string' ? body.notes : '';

  if (body.at !== undefined) {
    const at = new Date(String(body.at));
    if (Number.isNaN(at.getTime())) {
      return NextResponse.json({ error: 'unparseable at timestamp' }, { status: 400 });
    }
    const windowMinutes = Math.min(180, Math.max(5, Number(body.windowMinutes) || 45));
    const { state, reconstructed, skipped } = await reconstructScene(at, windowMinutes);
    if (reconstructed === 0) {
      return NextResponse.json(
        { error: 'no snapshots found in the window', skipped },
        { status: 422 }
      );
    }
    const id = await createScene({
      label, tags, notes, representsAt: at, source: 'historical', state, provenance: null,
    });
    return NextResponse.json({ id, source: 'historical', reconstructed, skipped }, { status: 201 });
  }

  const { state, provenance, pinned, pinFailures } = await captureLiveScene();
  const id = await createScene({
    label, tags, notes, representsAt: new Date(), source: 'live', state, provenance,
  });
  return NextResponse.json({ id, source: 'live', pinned, pinFailures }, { status: 201 });
}
```

```ts
// app/api/kiosk/scenes/[id]/route.ts
import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { deleteScene, getScene, updateSceneMeta } from '@/app/lib/scenes/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, { params }: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const scene = await getScene(id);
  if (!scene) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(scene);
}

export async function PATCH(request: Request, { params }: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const allowed = ['label', 'tags', 'notes'];
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length > 0) {
    return NextResponse.json(
      { error: `immutable or unknown fields: ${extra.join(', ')}` },
      { status: 400 }
    );
  }
  const patch: { label?: string; tags?: string[]; notes?: string } = {};
  if (typeof body.label === 'string') patch.label = body.label.trim();
  if (Array.isArray(body.tags)) patch.tags = body.tags.map(String);
  if (typeof body.notes === 'string') patch.notes = body.notes;

  const found = await updateSceneMeta(id, patch);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const found = await deleteScene(id);
  if (!found) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/kiosk/scenes`
Expected: PASS.

- [ ] **Step 5: Full test suite + lint**

Run: `npm run test && npm run lint`
Expected: green. Fix anything these surface before committing.

- [ ] **Step 6: Commit and push**

```bash
git add app/api/kiosk/scenes/route.ts app/api/kiosk/scenes/route.test.ts \
  'app/api/kiosk/scenes/[id]/route.ts' 'app/api/kiosk/scenes/[id]/route.test.ts'
git commit -m "feat(scenes): owner-gated scenes CRUD + capture API"
git push
```

---

### Task 6: `live | scene` data source in the /studio preview

Gated on studio phase-1 being merged (Task 0 verified it). The exact JSX of `PreviewPane.tsx` was written by another session — the implementer MUST read `app/studio/PreviewPane.tsx` and `app/studio/StudioClient.tsx` as merged before editing, and graft the selector into the real structure rather than pasting blindly. The pieces below (hook + fetch contract + behavior) are fixed; the graft point may shift.

**Files:**
- Create: `app/studio/useSceneWebcams.ts`
- Modify: `app/studio/PreviewPane.tsx` (preview header: add the data-source control; feed selection from the hook)
- Modify: `app/studio/StudioClient.tsx` (only if the webcams source lives there rather than in PreviewPane — follow the merged structure)
- Test: `app/studio/useSceneWebcams.test.ts`

**Interfaces:**
- Consumes: SWR; `SceneSummary`, `Scene`, `SceneState` from `@/app/lib/scenes/types`; Task 5's `GET /api/kiosk/scenes` and `GET /api/kiosk/scenes/:id`.
- Produces:

```ts
export type SceneSource = { kind: 'live' } | { kind: 'scene'; id: number };
export function useSceneWebcams(source: SceneSource): {
  scenes: SceneSummary[];            // for the picker (always fetched; /studio is owner-only)
  sceneState: SceneState | null;     // null when kind==='live' or still loading
  sceneLabel: string | null;
  error: string | null;
};
```

Behavior contract for the PreviewPane graft: when `sceneState` is non-null, the preview's sunrise feed renders `sceneState.sunrise` and the sunset feed `sceneState.sunset` instead of the terminator store's live arrays, and the live SWR polling pauses (`useLoadTerminatorWebcams({ paused: true })` — the hook already takes `paused`). The header control is a `<select>` with `live` plus one option per scene (`label — representsAt` local time). Selecting is view-state only (React `useState<SceneSource>` in the pane/client); nothing persists, nothing touches kiosk settings or the diff badge.

- [ ] **Step 1: Write the failing hook test**

```ts
// app/studio/useSceneWebcams.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { useSceneWebcams } from './useSceneWebcams';

const listPayload = {
  scenes: [{ id: 1, label: 'solstice', tags: [], representsAt: 't', source: 'historical', createdAt: 't' }],
};
const scenePayload = {
  id: 1, label: 'solstice', tags: [], notes: '', representsAt: 't', source: 'historical',
  createdAt: 't', provenance: null,
  state: { sunrise: [{ webcamId: 9 }], sunset: [] },
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(String(url).endsWith('/1') ? scenePayload : listPayload),
    })
  );
});

describe('useSceneWebcams', () => {
  it('serves the scene list and null state for live', async () => {
    const { result } = renderHook(() => useSceneWebcams({ kind: 'live' }));
    await waitFor(() => expect(result.current.scenes).toHaveLength(1));
    expect(result.current.sceneState).toBeNull();
  });

  it('serves the selected scene state', async () => {
    const { result } = renderHook(() => useSceneWebcams({ kind: 'scene', id: 1 }));
    await waitFor(() => expect(result.current.sceneState).not.toBeNull());
    expect(result.current.sceneState?.sunrise[0].webcamId).toBe(9);
    expect(result.current.sceneLabel).toBe('solstice');
  });
});
```

(SWR needs no provider for these tests; each `renderHook` gets fresh cache keys via the mocked fetch. If the merged /studio code wraps hooks in an SWR config provider, mirror what `useStudioSettings.test.ts` does.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/studio/useSceneWebcams.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// app/studio/useSceneWebcams.ts
'use client';

import useSWR from 'swr';
import type { Scene, SceneState, SceneSummary } from '@/app/lib/scenes/types';

export type SceneSource = { kind: 'live' } | { kind: 'scene'; id: number };

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  });

export function useSceneWebcams(source: SceneSource): {
  scenes: SceneSummary[];
  sceneState: SceneState | null;
  sceneLabel: string | null;
  error: string | null;
} {
  const list = useSWR<{ scenes: SceneSummary[] }>('/api/kiosk/scenes', fetcher);
  const sceneId = source.kind === 'scene' ? source.id : null;
  const scene = useSWR<Scene>(
    sceneId === null ? null : `/api/kiosk/scenes/${sceneId}`,
    fetcher
  );
  return {
    scenes: list.data?.scenes ?? [],
    sceneState: scene.data?.state ?? null,
    sceneLabel: scene.data?.label ?? null,
    error: (list.error ?? scene.error)?.message ?? null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/studio/useSceneWebcams.test.ts`
Expected: PASS.

- [ ] **Step 5: Graft the selector into the merged preview**

Read `app/studio/PreviewPane.tsx` / `StudioClient.tsx` as they exist on the branch. Add: `useState<SceneSource>({ kind: 'live' })` beside the existing preview-header state (the `sunrise | sunset | both` toggle from phase-1 Task 9); the `<select>` in the same header bar; the substitution of `sceneState.sunrise/.sunset` for the store arrays when non-null; `paused: true` into `useLoadTerminatorWebcams` while a scene is selected. Extend the existing `PreviewPane.test.tsx` with one rendering test: given a mocked `useSceneWebcams` returning a scene with one sunset cam, the pane renders that cam's tile and not the live store's.

- [ ] **Step 6: Full suite, lint, visual check**

Run: `npm run test && npm run lint`
Expected: green.
Then `npm run dev`, open `/studio` as owner, switch `live → scene` and back; the preview swaps pools within one render and the dials keep working against the scene.

- [ ] **Step 7: Commit and push**

```bash
git add app/studio/useSceneWebcams.ts app/studio/useSceneWebcams.test.ts \
  app/studio/PreviewPane.tsx app/studio/PreviewPane.test.tsx
git commit -m "feat(studio): live|scene data-source selector in the preview"
git push
```

(Include `app/studio/StudioClient.tsx` in the add only if Step 5 touched it.)

---

### Task 7: Smoke + first scene library (with Jesse)

Not a code task — the done-signal for the branch.

- [ ] **Step 1:** `POST /api/kiosk/scenes` with `at` = a few moments Task 1's report showed good coverage for (a solstice twilight, a mid-winter morning, tonight's peak). Verify `reconstructed`/`skipped` counts look sane against the report.
- [ ] **Step 2:** One live capture during an active window; verify `pinned + pinFailures` matches the number of non-Firebase frames and the stored URLs all resolve.
- [ ] **Step 3:** In `/studio`, replay each scene; confirm frames render (durable URLs), feeds split correctly, dials operate on the scene.
- [ ] **Step 4:** Open the PR (base `main`). Description carries: the Task 1 report output, the two spec deviations from Global Constraints, and the deferred stack (auto-capture cron, scene-gallery grid, invariant fixtures, print-res export).
- [ ] **Step 5:** Message peer sessions that the checkout is free (multi-session protocol) and return the checkout to `main`.
