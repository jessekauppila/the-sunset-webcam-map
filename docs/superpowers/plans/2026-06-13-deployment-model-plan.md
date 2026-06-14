# Deployment Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve `webcams` into a 1:many deployment table so each camera keeps a full placement trail, retarget the already-built F wizard persistence onto deployments, and gate public visibility on deployment `state` (owner-aware testing/deployed).

**Architecture:** A `Camera` row is pure identity (created at provisioning). A `Deployment` is a `webcams` row with `source='custom'` + lifecycle columns (`state/paused/started_at/ended_at`) + placement + provenance; a camera owns many over time, the active one = `ended_at IS NULL`. `cameras.webcam_id` caches the active deployment. The wizard creates/updates deployments; the human chooses re-aim vs new spot; `isOwner(session)` decides testing vs deployed. Snapshots already key on `webcam_id`, so a new deployment = a clean archive automatically.

**Tech Stack:** Next.js App Router (RSC + route handlers), `@neondatabase/serverless` template-literal `sql`, `next-auth` (`auth()`/`isOwner`), vitest (jsdom for components, `// @vitest-environment node` for DB/route modules), forward-only SQL migrations applied by hand to prod.

**Design of record:** `docs/superpowers/specs/2026-06-13-deployment-model-reconciliation-design.md`. Section refs below (§N) point there.

**IMPORTANT — run every vitest/tsc command prefixed with `NODE_OPTIONS=`** (a broken node-options preload otherwise crashes node — an env flake, not a real error). E.g. `NODE_OPTIONS= npx vitest run <file>`.

**Branch:** continue on `feat/cloud-https-setup` (PR #67 is held, not merged). Commit per task.

---

## File Structure

**New files:**
- `app/lib/deploymentPlacement.ts` (+ `.test.ts`) — pure geo: `haversineMeters`, `suggestMode`, threshold.
- `app/lib/cameraDeployment.ts` (+ `.test.ts`) — the deployment data layer: `getActiveDeployment`, `upsertActiveDeployment`, `endActiveDeployment`, `setDeploymentPaused`, `derivePlacementStatus` (deployment-shaped).
- `app/api/cameras/provision/route.ts` (+ `.test.ts`) — owner/secret-gated: mint claim code + create the Camera identity row.
- `app/api/cameras/[id]/resume/route.ts` (+ `.test.ts`) — un-pause the active deployment.
- `database/migrations/20260613_deployment_model.sql` — add deployment columns to `webcams` + `wifi_wipe_requested` to `cameras`.
- `database/migrations/20260613_deployment_model_backfill.sql` — backfill existing custom rows into active deployments.

**Modified files (F retarget, §11):**
- `app/lib/cameraRegistration.ts` — `derivePlacementStatus` stays (shape-compatible); `upsertCameraByClaimCode` removed (callers move to `cameraDeployment`).
- `app/api/cameras/pre-register/route.ts` — resolve existing camera; state from `isOwner`; call `upsertActiveDeployment(mode,state)`.
- `app/api/cameras/register/route.ts` — drop create/mint; authenticate + update the existing camera.
- `app/api/cameras/[id]/heartbeat/route.ts` — placement from the active deployment.
- `app/api/cameras/setup-status/[claim_code]/route.ts` — derive from camera + active deployment.
- `app/api/cameras/[id]/decommission/route.ts`, `.../pause/route.ts` — act on the active deployment.
- `app/api/db-all-webcams/route.ts` — public map `state` filter.
- `app/api/my-cameras/route.ts` — join active deployment; `?includeEnded=1` for the trail.
- `app/setup/[claim_code]/page.tsx` — pass `isOwner` to the wizard.
- `app/setup/[claim_code]/WizardClient.tsx`, `steps/SubmitStep.tsx`, `steps/WizardEntry.tsx`, `types.ts` — thread `mode` + owner `publish`.

---

## Slice 0 — Recon (no code change, but REQUIRED before the migration)

## Task 0: Enumerate the live `webcams` schema

**Why:** `upsertActiveDeployment` INSERTs a new `webcams` row per deployment. Every NOT NULL column without a default must be supplied or the INSERT 500s in prod. We must know the real constraints before writing the migration and the INSERT.

- [ ] **Step 1: Dump the schema**

Run against a Neon branch or prod read-only (user's hands if prod creds needed — ask them to paste it as a single line):

```
psql "$DATABASE_URL" -c "\d webcams"
```

- [ ] **Step 2: Record findings in this plan**

Capture, in a comment block at the top of `database/migrations/20260613_deployment_model.sql`, the list of NOT NULL columns on `webcams` that lack a default (e.g. `source`, `external_id`, `lat`, `lng`, `title`, `status`, ...). The deployment INSERT in Task 5 must supply all of them. Note any that are awkward for a custom row (e.g. `external_id` if NOT NULL → use the camera's `hardware_id` or `custom-{cameraId}-{startedAt}`).

- [ ] **Step 3: Confirm how existing custom rows were created**

Run `grep -rn "INSERT INTO webcams\|insert into webcams" app/` to find the existing custom-camera/pairing INSERT (if any) and mirror its required-column set. If none exists in-app (camera 1 was paired by a script/by hand), rely on the `\d webcams` output.

Expected output of this task: a definitive NOT-NULL column list, pasted into the migration file header, used by Tasks 1 and 5.

---

## Slice A — Schema + backfill

## Task 1: Deployment migration (additive)

**Files:**
- Create: `database/migrations/20260613_deployment_model.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Deployment model (spec 2026-06-13-deployment-model-reconciliation-design §4/§12).
-- Evolve webcams into the 1:many deployment table; a custom camera owns many
-- webcams rows (one per deployment). All new columns nullable/defaulted so the
-- thousands of Windy rows (state IS NULL) are untouched.
--
-- NOT NULL columns on webcams that the deployment INSERT must supply (from Task 0):
--   <PASTE the \d webcams NOT-NULL-without-default list here>
--
-- Forward-only, idempotent. Apply BEFORE the retargeted routes deploy.
--   psql "$DATABASE_URL" -f database/migrations/20260613_deployment_model.sql

-- Deployment lifecycle
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS state TEXT;            -- testing|deployed|ended (NULL = windy)
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;  -- NULL = active

-- Placement (lat/lng already exist on webcams)
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS azimuth_deg NUMERIC;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS tilt_deg NUMERIC;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS elevation_m NUMERIC;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS horizon_altitude_deg NUMERIC;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS horizon_profile JSONB;

-- Provenance (moved off cameras)
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS azimuth_source TEXT;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS coarse BOOLEAN;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS bracket JSONB;

-- Operator prefs (moved off cameras)
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS phase_preference TEXT;
ALTER TABLE webcams ADD COLUMN IF NOT EXISTS delivery_preferences JSONB;

-- Index: fast active-deployment lookup
CREATE INDEX IF NOT EXISTS webcams_active_deployment_idx
  ON webcams (custom_camera_id)
  WHERE source = 'custom' AND ended_at IS NULL;

-- The one camera-level piece of the superseded lifecycle migration.
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS wifi_wipe_requested BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 2: Verify it parses + columns exist (Neon branch)**

Apply to a Neon branch: `psql "$BRANCH_URL" -f database/migrations/20260613_deployment_model.sql` then `psql "$BRANCH_URL" -c "\d webcams"` — confirm the columns + index exist. (No vitest; migrations are SQL.)

- [ ] **Step 3: Commit**

```bash
git add database/migrations/20260613_deployment_model.sql
git commit -m "feat(db): deployment model columns on webcams + wifi_wipe on cameras"
```

## Task 2: Backfill existing custom rows into active deployments

**Files:**
- Create: `database/migrations/20260613_deployment_model_backfill.sql`

- [ ] **Step 1: Write the backfill**

```sql
-- Backfill: each existing custom camera's webcams row becomes its active
-- deployment (spec §12.2). Copy placement/provenance from the cameras row where
-- the webcams column is still NULL. camera 1 (the bench unit) → state='testing'.
--
-- Idempotent: only touches custom rows with state IS NULL.
--   psql "$DATABASE_URL" -f database/migrations/20260613_deployment_model_backfill.sql

UPDATE webcams w SET
  state = COALESCE(w.state, 'testing'),
  started_at = COALESCE(w.started_at, w.created_at, NOW()),
  ended_at = NULL,
  azimuth_deg = COALESCE(w.azimuth_deg, c.azimuth_deg),
  tilt_deg = COALESCE(w.tilt_deg, c.tilt_deg),
  elevation_m = COALESCE(w.elevation_m, c.elevation_m),
  timezone = COALESCE(w.timezone, c.timezone),
  horizon_altitude_deg = COALESCE(w.horizon_altitude_deg, c.horizon_altitude_deg),
  horizon_profile = COALESCE(w.horizon_profile, c.horizon_profile),
  azimuth_source = COALESCE(w.azimuth_source, c.azimuth_source),
  coarse = COALESCE(w.coarse, c.coarse),
  bracket = COALESCE(w.bracket, c.bracket),
  phase_preference = COALESCE(w.phase_preference, c.phase_preference),
  delivery_preferences = COALESCE(w.delivery_preferences, c.delivery_preferences)
FROM cameras c
WHERE w.custom_camera_id = c.id
  AND w.source = 'custom'
  AND w.state IS NULL;

-- Ensure cameras.webcam_id points at the (single) active deployment.
UPDATE cameras c SET webcam_id = w.id
FROM webcams w
WHERE w.custom_camera_id = c.id AND w.source = 'custom' AND w.ended_at IS NULL
  AND (c.webcam_id IS DISTINCT FROM w.id);
```

> NOTE: this references `c.azimuth_source/coarse/bracket` which exist on `cameras`
> only if `20260613_cameras_bracket_provenance.sql` was ever applied. It was NOT
> applied to prod (held/superseded), so on prod those `c.*` provenance columns
> don't exist → **drop those three COALESCE lines for the prod run** (camera 1 has
> no bracket data anyway). Keep them only if running against a branch where the
> bracket-provenance migration was applied. Confirm with `\d cameras` first.

- [ ] **Step 2: Verify on a Neon branch**

Apply, then `psql -c "SELECT id, custom_camera_id, state, started_at, ended_at FROM webcams WHERE source='custom';"` — confirm camera 1's row is `state=testing, ended_at=NULL`, and `SELECT id, webcam_id FROM cameras;` points correctly.

- [ ] **Step 3: Commit**

```bash
git add database/migrations/20260613_deployment_model_backfill.sql
git commit -m "feat(db): backfill custom webcams rows into active deployments"
```

---

## Slice B — Pure libs

## Task 3: `deploymentPlacement.ts` — haversine + mode suggestion

**Files:**
- Create: `app/lib/deploymentPlacement.ts`
- Test: `app/lib/deploymentPlacement.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { haversineMeters, suggestMode, NEW_LOCATION_THRESHOLD_M } from './deploymentPlacement';

describe('haversineMeters', () => {
  it('is 0 for the same point', () => {
    expect(haversineMeters({ lat: 47.6, lng: -122.3 }, { lat: 47.6, lng: -122.3 })).toBeCloseTo(0, 5);
  });
  it('~111.2 km per degree of latitude', () => {
    const d = haversineMeters({ lat: 47, lng: -122 }, { lat: 48, lng: -122 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
  it('small local move is tens of meters', () => {
    // ~0.0003 deg lat ≈ 33 m
    const d = haversineMeters({ lat: 47.6000, lng: -122.3 }, { lat: 47.6003, lng: -122.3 });
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(40);
  });
});

describe('suggestMode', () => {
  it('suggests reaim within the threshold', () => {
    expect(suggestMode(NEW_LOCATION_THRESHOLD_M - 1)).toBe('reaim');
  });
  it('suggests new beyond the threshold', () => {
    expect(suggestMode(NEW_LOCATION_THRESHOLD_M + 1)).toBe('new');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS= npx vitest run app/lib/deploymentPlacement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// Pure geo helpers for the placement flow (spec §8). ADVISORY ONLY — nothing here
// mutates state; the wizard uses suggestMode to pre-select the default the human
// confirms, and haversineMeters to power the non-blocking "nearby" FYI.
const EARTH_RADIUS_M = 6_371_000;
export const NEW_LOCATION_THRESHOLD_M = 100;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export type PlacementMode = 'reaim' | 'new';

export function suggestMode(distanceM: number): PlacementMode {
  return distanceM > NEW_LOCATION_THRESHOLD_M ? 'new' : 'reaim';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS= npx vitest run app/lib/deploymentPlacement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/deploymentPlacement.ts app/lib/deploymentPlacement.test.ts
git commit -m "feat(lib): deploymentPlacement haversine + mode suggestion (advisory)"
```

## Task 4: `cameraDeployment.ts` — types + read helpers

**Files:**
- Create: `app/lib/cameraDeployment.ts`
- Test: `app/lib/cameraDeployment.test.ts`

This task adds the types + `getActiveDeployment` + a deployment-shaped `derivePlacementStatus`. Task 5 adds the writes.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v) }));
import { getActiveDeployment, derivePlacementStatus } from './cameraDeployment';

beforeEach(() => sqlMock.mockReset());

describe('getActiveDeployment', () => {
  it('returns the active (ended_at IS NULL) custom row for a camera', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 9, custom_camera_id: 1, state: 'testing', paused: false,
      lat: 47.6, lng: -122.3, azimuth_deg: 270, tilt_deg: 0 }]);
    const d = await getActiveDeployment(1);
    expect(d?.id).toBe(9);
    expect(d?.state).toBe('testing');
  });
  it('returns null when the camera has no active deployment', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getActiveDeployment(1)).toBeNull();
  });
});

describe('derivePlacementStatus', () => {
  it('awaiting_location with no deployment', () => {
    expect(derivePlacementStatus(null)).toBe('awaiting_location');
  });
  it('awaiting_aim when placed but no azimuth', () => {
    expect(derivePlacementStatus({ lat: 47.6, lng: -122.3, azimuth_deg: null, tilt_deg: null } as never)).toBe('awaiting_aim');
  });
  it('ready when placed + aimed', () => {
    expect(derivePlacementStatus({ lat: 47.6, lng: -122.3, azimuth_deg: 270, tilt_deg: 0 } as never)).toBe('ready');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS= npx vitest run app/lib/cameraDeployment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { sql } from '@/app/lib/db';

export type DeploymentState = 'testing' | 'deployed' | 'ended';
export type PlacementStatus = 'awaiting_location' | 'awaiting_aim' | 'ready';

export type DeploymentRow = {
  id: number;
  custom_camera_id: number;
  state: DeploymentState;
  paused: boolean;
  started_at: Date | null;
  ended_at: Date | null;
  lat: number | null;
  lng: number | null;
  elevation_m: number | null;
  timezone: string | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  horizon_altitude_deg: number | null;
  horizon_profile: unknown;
  azimuth_source: string | null;
  coarse: boolean | null;
  bracket: unknown;
  phase_preference: string | null;
  delivery_preferences: unknown;
};

const DEPLOYMENT_COLS = sql``; // placeholder kept for readability; columns inlined below.

export async function getActiveDeployment(cameraId: number): Promise<DeploymentRow | null> {
  const rows = (await sql`
    SELECT id, custom_camera_id, state, paused, started_at, ended_at,
           lat, lng, elevation_m, timezone,
           azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
           azimuth_source, coarse, bracket, phase_preference, delivery_preferences
    FROM webcams
    WHERE custom_camera_id = ${cameraId} AND source = 'custom' AND ended_at IS NULL
    LIMIT 1
  `) as DeploymentRow[];
  return rows[0] ?? null;
}

export function derivePlacementStatus(
  d: Pick<DeploymentRow, 'lat' | 'lng' | 'azimuth_deg' | 'tilt_deg'> | null
): PlacementStatus {
  if (!d || d.lat == null || d.lng == null) return 'awaiting_location';
  if (d.azimuth_deg == null || d.tilt_deg == null) return 'awaiting_aim';
  return 'ready';
}
```

> Remove the unused `DEPLOYMENT_COLS` line — it's illustrative; do not ship dead code.

- [ ] **Step 4: Run to verify it passes**

Run: `NODE_OPTIONS= npx vitest run app/lib/cameraDeployment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/cameraDeployment.ts app/lib/cameraDeployment.test.ts
git commit -m "feat(lib): cameraDeployment types + getActiveDeployment + placement status"
```

## Task 5: `upsertActiveDeployment` + `endActiveDeployment` + `setDeploymentPaused`

**Files:**
- Modify: `app/lib/cameraDeployment.ts`
- Test: `app/lib/cameraDeployment.test.ts`

- [ ] **Step 1: Write the failing tests** (append)

```ts
import { upsertActiveDeployment, endActiveDeployment, setDeploymentPaused } from './cameraDeployment';

const PLACEMENT = {
  lat: 47.6, lng: -122.3, elevation_m: 30, timezone: 'America/Los_Angeles',
  azimuth_deg: 270, tilt_deg: 0, horizon_altitude_deg: 0, horizon_profile: null,
  azimuth_source: 'bracket', coarse: true, bracket: { lens: 'wide_120' },
  phase_preference: 'sunset', delivery_preferences: null,
};

describe('upsertActiveDeployment', () => {
  it('creates deployment #1 when none exists and repoints cameras.webcam_id', async () => {
    sqlMock.mockResolvedValueOnce([]);                       // getActive → none
    sqlMock.mockResolvedValueOnce([{ id: 50, state: 'testing' }]); // INSERT deployment
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);              // UPDATE cameras.webcam_id
    const d = await upsertActiveDeployment(1, PLACEMENT, { state: 'testing', mode: 'reaim' });
    expect(d.id).toBe(50);
    // 3rd call repoints the cache
    expect(sqlMock.mock.calls[2][0].join('')).toContain('webcam_id');
  });

  it('mode=new ends the active deployment then inserts a fresh one', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 40, state: 'deployed' }]); // getActive → exists
    sqlMock.mockResolvedValueOnce([{ id: 40 }]);                    // UPDATE end old
    sqlMock.mockResolvedValueOnce([{ id: 41, state: 'deployed' }]); // INSERT new
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);                     // repoint
    const d = await upsertActiveDeployment(1, PLACEMENT, { state: 'deployed', mode: 'new' });
    expect(d.id).toBe(41);
    expect(sqlMock.mock.calls[1][0].join('')).toContain('ended_at');
    expect(sqlMock.mock.calls[1][0].join('')).toContain("'ended'");
  });

  it('mode=reaim updates the active deployment in place (no new row, state untouched)', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 40, state: 'deployed' }]); // getActive → exists
    sqlMock.mockResolvedValueOnce([{ id: 40, state: 'deployed' }]); // UPDATE in place
    const d = await upsertActiveDeployment(1, PLACEMENT, { state: 'testing', mode: 'reaim' });
    expect(d.id).toBe(40);
    // Only 2 sql calls — no INSERT, no repoint.
    expect(sqlMock.mock.calls.length).toBe(2);
    // re-aim must NOT overwrite state with the passed-in 'testing'.
    expect(sqlMock.mock.calls[1][0].join('')).not.toContain('state =');
  });
});

describe('endActiveDeployment', () => {
  it('ends the active deployment, clears webcam_id, sets wifi_wipe when relocating', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 40 }]);  // UPDATE webcams end
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);   // UPDATE cameras (webcam_id NULL + wifi_wipe)
    const r = await endActiveDeployment(1, { relocate: true });
    expect(r.ended).toBe(true);
    expect(sqlMock.mock.calls[1][0].join('')).toContain('wifi_wipe_requested');
  });
  it('returns ended=false when there was no active deployment', async () => {
    sqlMock.mockResolvedValueOnce([]); // UPDATE end → 0 rows
    const r = await endActiveDeployment(1, { relocate: false });
    expect(r.ended).toBe(false);
  });
});

describe('setDeploymentPaused', () => {
  it('flips paused on the active deployment', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 40, paused: true }]);
    const r = await setDeploymentPaused(1, true);
    expect(r?.paused).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `NODE_OPTIONS= npx vitest run app/lib/cameraDeployment.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement** (append to `cameraDeployment.ts`)

```ts
export type DeploymentPlacementInput = {
  lat: number | null;
  lng: number | null;
  elevation_m: number | null;
  timezone: string | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  horizon_altitude_deg: number | null;
  horizon_profile: unknown;
  azimuth_source: string | null;
  coarse: boolean | null;
  bracket: unknown;
  phase_preference: string | null;
  delivery_preferences: unknown;
};

import type { PlacementMode } from '@/app/lib/deploymentPlacement';

function j(v: unknown): string | null {
  return v == null ? null : JSON.stringify(v);
}

// §8. mode='new' ends the active deployment and opens a fresh one; mode='reaim'
// updates the active in place (state untouched). When none exists, always inserts
// deployment #1. Repoints cameras.webcam_id on every active-row transition.
// NOTE: the INSERT must satisfy webcams NOT NULL columns enumerated in Task 0 —
// supply source='custom', custom_camera_id, lat, lng, and any others found there
// (e.g. external_id = `custom-${cameraId}`, title, status='active').
export async function upsertActiveDeployment(
  cameraId: number,
  p: DeploymentPlacementInput,
  opts: { state: DeploymentState; mode: PlacementMode }
): Promise<DeploymentRow> {
  const active = await getActiveDeployment(cameraId);

  if (active && opts.mode === 'reaim') {
    const rows = (await sql`
      UPDATE webcams SET
        lat = ${p.lat}, lng = ${p.lng}, elevation_m = ${p.elevation_m},
        timezone = ${p.timezone}, azimuth_deg = ${p.azimuth_deg}, tilt_deg = ${p.tilt_deg},
        horizon_altitude_deg = ${p.horizon_altitude_deg},
        horizon_profile = ${j(p.horizon_profile)}::jsonb,
        azimuth_source = ${p.azimuth_source}, coarse = ${p.coarse}, bracket = ${j(p.bracket)}::jsonb,
        phase_preference = ${p.phase_preference},
        delivery_preferences = ${j(p.delivery_preferences)}::jsonb
      WHERE id = ${active.id}
      RETURNING id, custom_camera_id, state, paused, started_at, ended_at,
                lat, lng, elevation_m, timezone, azimuth_deg, tilt_deg,
                horizon_altitude_deg, horizon_profile, azimuth_source, coarse,
                bracket, phase_preference, delivery_preferences
    `) as DeploymentRow[];
    return rows[0];
  }

  if (active && opts.mode === 'new') {
    await sql`UPDATE webcams SET ended_at = NOW(), state = 'ended' WHERE id = ${active.id}`;
  }

  const inserted = (await sql`
    INSERT INTO webcams (
      source, custom_camera_id, external_id, title, status,
      state, paused, started_at,
      lat, lng, elevation_m, timezone, azimuth_deg, tilt_deg,
      horizon_altitude_deg, horizon_profile, azimuth_source, coarse, bracket,
      phase_preference, delivery_preferences
    ) VALUES (
      'custom', ${cameraId}, ${'custom-' + cameraId}, ${'Camera ' + cameraId}, 'active',
      ${opts.state}, FALSE, NOW(),
      ${p.lat}, ${p.lng}, ${p.elevation_m}, ${p.timezone}, ${p.azimuth_deg}, ${p.tilt_deg},
      ${p.horizon_altitude_deg}, ${j(p.horizon_profile)}::jsonb, ${p.azimuth_source}, ${p.coarse}, ${j(p.bracket)}::jsonb,
      ${p.phase_preference}, ${j(p.delivery_preferences)}::jsonb
    )
    RETURNING id, custom_camera_id, state, paused, started_at, ended_at,
              lat, lng, elevation_m, timezone, azimuth_deg, tilt_deg,
              horizon_altitude_deg, horizon_profile, azimuth_source, coarse,
              bracket, phase_preference, delivery_preferences
  `) as DeploymentRow[];

  await sql`UPDATE cameras SET webcam_id = ${inserted[0].id} WHERE id = ${cameraId}`;
  return inserted[0];
}

export async function endActiveDeployment(
  cameraId: number,
  opts: { relocate: boolean }
): Promise<{ ended: boolean }> {
  const ended = (await sql`
    UPDATE webcams SET ended_at = NOW(), state = 'ended'
    WHERE custom_camera_id = ${cameraId} AND source = 'custom' AND ended_at IS NULL
    RETURNING id
  `) as { id: number }[];
  await sql`
    UPDATE cameras
    SET webcam_id = NULL,
        wifi_wipe_requested = (wifi_wipe_requested OR ${opts.relocate})
    WHERE id = ${cameraId}
  `;
  return { ended: ended.length > 0 };
}

export async function setDeploymentPaused(
  cameraId: number,
  paused: boolean
): Promise<{ id: number; paused: boolean } | null> {
  const rows = (await sql`
    UPDATE webcams SET paused = ${paused}
    WHERE custom_camera_id = ${cameraId} AND source = 'custom' AND ended_at IS NULL
    RETURNING id, paused
  `) as { id: number; paused: boolean }[];
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `NODE_OPTIONS= npx vitest run app/lib/cameraDeployment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/cameraDeployment.ts app/lib/cameraDeployment.test.ts
git commit -m "feat(lib): upsert/end/pause active deployment (webcams 1:many)"
```

---

## Slice C — Provisioning

## Task 6: `POST /api/cameras/provision` — create the Camera identity

**Files:**
- Create: `app/api/cameras/provision/route.ts`
- Test: `app/api/cameras/provision/route.test.ts`

Owner-gated (reuse the `admin/claim-codes` `CRON_SECRET` Bearer pattern — provisioning is a CLI/script step). Mints a permanent claim code + device token, inserts the Camera identity row (no deployment), binds the claim code to it. Returns `claim_code`, `camera_id`, `device_token` (shown once, baked at flash).

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
const sqlMock = vi.fn();
const mintClaimCodeMock = vi.fn();
const mintDeviceTokenMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v) }));
vi.mock('@/app/lib/cameraClaimCode', () => ({ mintClaimCode: (...a: unknown[]) => mintClaimCodeMock(...a) }));
vi.mock('@/app/lib/cameraRegistration', () => ({ mintDeviceToken: (...a: unknown[]) => mintDeviceTokenMock(...a) }));
import { POST } from './route';

beforeEach(() => {
  sqlMock.mockReset(); mintClaimCodeMock.mockReset(); mintDeviceTokenMock.mockReset();
  process.env.CRON_SECRET = 'secret';
  mintClaimCodeMock.mockResolvedValue({ code: 'SUNSET-AAAA-BBBB', expires_at: new Date('2099-01-01') });
  mintDeviceTokenMock.mockReturnValue({ plaintext: 'tok-plain', hash: 'tok-hash' });
});

function req(body: unknown, auth = 'Bearer secret') {
  return new Request('http://t/api/cameras/provision', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify(body),
  });
}

describe('POST /api/cameras/provision', () => {
  it('rejects without the secret', async () => {
    expect((await POST(req({ hardware_id: 'sunset-cam-2' }, 'Bearer nope'))).status).toBe(401);
  });
  it('mints code + token, inserts the camera, returns the token once', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 2 }]);  // INSERT cameras
    sqlMock.mockResolvedValueOnce([{ code: 'SUNSET-AAAA-BBBB' }]); // bind claim code
    const res = await POST(req({ hardware_id: 'sunset-cam-2' }));
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b.camera_id).toBe(2);
    expect(b.claim_code).toBe('SUNSET-AAAA-BBBB');
    expect(b.device_token).toBe('tok-plain');
  });
  it('rejects missing hardware_id with 400', async () => {
    expect((await POST(req({}))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS= npx vitest run app/api/cameras/provision/route.test.ts`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

```ts
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { mintClaimCode } from '@/app/lib/cameraClaimCode';
import { mintDeviceToken } from '@/app/lib/cameraRegistration';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return Boolean(process.env.CRON_SECRET) && request.headers.get('authorization') === expected;
}

// Provisioning (spec §9): create the Camera identity ONCE, at flash time. Mints a
// permanent claim code (the QR pointer) + the device token (baked into the SD
// config, shown once here). No deployment yet — the wizard makes those.
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: { hardware_id?: unknown; device_class?: unknown; label?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const hardwareId = typeof body.hardware_id === 'string' && body.hardware_id.trim() ? body.hardware_id.trim() : null;
  if (!hardwareId) {
    return NextResponse.json({ error: 'hardware_id is required' }, { status: 400 });
  }

  const deviceClass = typeof body.device_class === 'string' && body.device_class.trim() ? body.device_class.trim() : 'rpi-zero-2w';
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : hardwareId;

  // Permanent setup pointer: ~10y TTL (shipped codes are effectively non-expiring).
  const claim = await mintClaimCode({ label, ttlDays: 3650 });
  const { plaintext, hash } = mintDeviceToken();

  try {
    const inserted = (await sql`
      INSERT INTO cameras (hardware_id, device_token_hash, device_class, claim_code, status)
      VALUES (${hardwareId}, ${hash}, ${deviceClass}, ${claim.code}, 'active')
      RETURNING id
    `) as { id: number }[];
    const cameraId = inserted[0].id;

    // Bind the claim code to the camera (resolution + audit). Not single-use.
    await sql`
      UPDATE camera_claim_codes
      SET consumed_at = NOW(), consumed_by_camera_id = ${cameraId}
      WHERE code = ${claim.code}
    `;

    return NextResponse.json(
      { camera_id: cameraId, claim_code: claim.code, device_token: plaintext },
      { status: 201 }
    );
  } catch (error) {
    console.error('[cameras/provision] failed:', error);
    return NextResponse.json(
      { error: 'provision failed', details: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
```

> NOTE: `cameras` may still have NOT NULL `lat/lng/timezone`? No — `20260516_cameras_either_order_registration.sql` dropped those NOT NULLs. Provision omits them (identity only). Confirm with `\d cameras` during Task 0.

- [ ] **Step 4: Run + type-check**

Run: `NODE_OPTIONS= npx vitest run app/api/cameras/provision/route.test.ts && NODE_OPTIONS= npx tsc --noEmit 2>&1 | grep "provision" || echo OK`
Expected: PASS, no provision type errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/cameras/provision
git commit -m "feat(api): owner-gated provision endpoint (mint code+token, create camera)"
```

---

## Slice D — Retarget the F endpoints

## Task 7: `pre-register` → write a deployment (owner-aware state + mode)

**Files:**
- Modify: `app/api/cameras/pre-register/route.ts`
- Test: `app/api/cameras/pre-register/route.test.ts`

Resolve the existing camera by claim code (404 if not provisioned). Determine `state` server-side from `isOwner(session)` (+ owner `publish` flag). Read `mode` from the body (default `'reaim'`). Call `upsertActiveDeployment`. Keep all existing bracket validation (`parseBracket`, PR-2 invariant) unchanged.

- [ ] **Step 1: Update the tests**

Replace the upsert mock with deployment mocks. Key new/changed cases:
- camera-not-found-for-claim → 404 (new: provisioning required).
- owner session → `state='testing'` (mock `isOwner` true); owner + `publish:true` → `state='deployed'`.
- non-owner → `state='deployed'`.
- `mode:'new'` is forwarded to `upsertActiveDeployment`.
- existing bracket-validation cases still pass.

```ts
// add to mocks:
const isOwnerMock = vi.fn();
const upsertMock = vi.fn();
vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'x' } }) }));
vi.mock('@/app/lib/owner', () => ({ isOwner: (...a: unknown[]) => isOwnerMock(...a) }));
vi.mock('@/app/lib/cameraDeployment', () => ({
  upsertActiveDeployment: (...a: unknown[]) => upsertMock(...a),
  derivePlacementStatus: () => 'ready',
}));
// resolve camera by claim code uses sql or cameras lookup — mock accordingly.
```

(Write concrete cases mirroring the existing file's style; assert `upsertMock` received `{ state, mode }` correctly per session/body.)

- [ ] **Step 2: Run to verify the new expectations fail**

Run: `NODE_OPTIONS= npx vitest run app/api/cameras/pre-register/route.test.ts`
Expected: FAIL — route still calls `upsertCameraByClaimCode`.

- [ ] **Step 3: Implement the retarget**

Resolve the camera, branch state on `isOwner`, forward `mode`:

```ts
import { auth } from '@/auth';
import { isOwner } from '@/app/lib/owner';
import { upsertActiveDeployment, derivePlacementStatus } from '@/app/lib/cameraDeployment';
// ...after claim validation (unchanged getClaimCode + expiry checks)...

// Resolve the provisioned camera. With provisioning (§9) the camera always exists.
const cameraRows = (await sql`SELECT id FROM cameras WHERE claim_code = ${claimCode} LIMIT 1`) as { id: number }[];
if (!cameraRows[0]) {
  return NextResponse.json({ error: 'camera not provisioned for this claim code' }, { status: 404 });
}
const cameraId = cameraRows[0].id;

// Owner-aware state (§7), server-enforced — never trust a client 'state'.
const session = await auth();
const owner = isOwner(session);
const publish = owner && body.placement /* owner publish flag */ != null && (body as { publish?: unknown }).publish === true;
const state: 'testing' | 'deployed' = owner ? (publish ? 'deployed' : 'testing') : 'deployed';

const mode = (body as { mode?: unknown }).mode === 'new' ? 'new' : 'reaim';

const deployment = await upsertActiveDeployment(cameraId, {
  lat, lng, elevation_m: asNumber(body.elevation_m), timezone,
  azimuth_deg: azimuth, tilt_deg: tilt,
  horizon_altitude_deg: asNumber(body.placement?.horizon_altitude_deg) ?? 0,
  horizon_profile: horizonProfile ?? null,
  azimuth_source: azimuthSource, coarse, bracket: bracketResult.value,
  phase_preference: phase, delivery_preferences: body.operator_preferences?.delivery ?? null,
}, { state, mode });

return NextResponse.json(
  { camera_id: cameraId, deployment_id: deployment.id, state: deployment.state,
    placement_status: derivePlacementStatus(deployment) },
  { status: 202 }
);
```

Add `mode?` and `publish?` to the `Body` type. Remove the `upsertCameraByClaimCode` import.

- [ ] **Step 4: Run + type-check**

Run: `NODE_OPTIONS= npx vitest run app/api/cameras/pre-register/route.test.ts && NODE_OPTIONS= npx tsc --noEmit 2>&1 | grep "pre-register" || echo OK`
Expected: PASS, no errors in scope.

- [ ] **Step 5: Commit**

```bash
git add app/api/cameras/pre-register
git commit -m "feat(api): pre-register writes a deployment (owner-aware state, re-aim/new mode)"
```

## Task 8: `register` → authenticate + update the existing camera (no create/mint)

**Files:**
- Modify: `app/api/cameras/register/route.ts`
- Test: `app/api/cameras/register/route.test.ts`

Per §9: the camera is provisioned, so `register` no longer inserts or mints. It resolves the camera by `claim_code`, verifies `hardware_id` matches the provisioned row, updates `firmware_version`/`capabilities`/`last_seen_at`, and returns placement from the active deployment (if any). It does NOT return a new device token.

- [ ] **Step 1: Update the tests**

New behavior:
- camera exists (provisioned) + hardware_id matches → 200, updates device fields, returns `placement_status` from active deployment; **no `device_token` in the response**.
- unknown claim code → 404; expired → 410.
- hardware_id mismatch vs provisioned row → 409.
- (Removed: the "register-first creates a row" and "consume claim code" cases.)

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS= npx vitest run app/api/cameras/register/route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Resolve camera by claim code; verify hardware_id; UPDATE device fields; read active deployment for placement; drop `mintDeviceToken`/`consumeClaimCode`. (Keep the claim expiry check.) Response: `{ camera_id, placement_status, placement? }`.

- [ ] **Step 4: Run + type-check**

Run: `NODE_OPTIONS= npx vitest run app/api/cameras/register/route.test.ts && NODE_OPTIONS= npx tsc --noEmit 2>&1 | grep "register" || echo OK`
Expected: PASS.

> CONTRACT NOTE: this changes the device↔cloud register seam (no token returned;
> camera must pre-exist). Record it in the E↔F contract when sub-project E is built
> (spec §13). Camera 1 already has its token + heartbeats, so the current fleet is
> unaffected.

- [ ] **Step 5: Commit**

```bash
git add app/api/cameras/register
git commit -m "feat(api): register authenticates the provisioned camera (no create/mint)"
```

## Task 9: `heartbeat` → placement from the active deployment

**Files:**
- Modify: `app/api/cameras/[id]/heartbeat/route.ts`
- Test: `app/api/cameras/[id]/heartbeat/route.test.ts`

Keep the wifi_wipe CTE (Task 23c) — that's camera-level. Change the placement source: after the camera UPDATE, look up the active deployment via `getActiveDeployment(cameraId)` and build the placement block / status from it (not from the camera row).

- [ ] **Step 1: Update the tests**

- placement-requested + active deployment ready → returns deployment placement (azimuth/bracket from the deployment).
- placement-requested + no active deployment → `awaiting_location`.
- wipe_wifi directive case unchanged (still from the camera CTE).

- [ ] **Step 2: Run to verify it fails** — `NODE_OPTIONS= npx vitest run app/api/cameras/[id]/heartbeat/route.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Keep the CTE UPDATE but RETURNING only `wifi_wipe_was_requested` (+ heartbeat ack). Then `const d = await getActiveDeployment(cameraId)` and use `derivePlacementStatus(d)` + `d` fields for the placement block. Import from `cameraDeployment`.

- [ ] **Step 4: Run + type-check** — `... && NODE_OPTIONS= npx tsc --noEmit 2>&1 | grep heartbeat || echo OK` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cameras/[id]/heartbeat
git commit -m "feat(api): heartbeat reads placement from the active deployment"
```

## Task 10: `setup-status` → derive from camera + active deployment

**Files:**
- Modify: `app/api/cameras/setup-status/[claim_code]/route.ts`
- Test: `app/api/cameras/setup-status/[claim_code]/route.test.ts`

The camera always exists (provisioned), so the sentinel check is dropped. Status: no camera row → `awaiting_wifi` (shouldn't happen post-provisioning, keep defensively); camera but no active deployment → `registered`; active deployment → map `derivePlacementStatus(d)` (`awaiting_location`/`awaiting_aim`/`ready`). `WizardEntry`'s "already-placed" = `ready`.

- [ ] **Step 1: Update tests** — drop sentinel cases; add "active deployment ready → ready", "no deployment → registered".
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — resolve camera by claim code; `getActiveDeployment`; map status. Remove `sentinelForClaimCode`.
- [ ] **Step 4: Run + tsc grep `setup-status` → PASS.**
- [ ] **Step 5: Commit** — `feat(api): setup-status derives from camera + active deployment`.

## Task 11: `decommission`/`pause` retarget + new `resume`

**Files:**
- Modify: `app/api/cameras/[id]/decommission/route.ts`, `app/api/cameras/[id]/pause/route.ts`
- Create: `app/api/cameras/[id]/resume/route.ts` (+ `.test.ts`)
- Test: update `decommission/route.test.ts`, `pause/route.test.ts`

`resolveCameraRef` (claim-code OR id) stays. Decommission calls `endActiveDeployment(cameraId, {relocate})`; pause calls `setDeploymentPaused(cameraId, true)`; resume calls `setDeploymentPaused(cameraId, false)`. They no longer touch `cameras.status`.

- [ ] **Step 1: Update/Write tests**
- decommission → `endActiveDeployment` called; `relocate:true` ⇒ wifi flag (assert via the lib mock). Response `{ camera_id, ended: true }`.
- pause → `setDeploymentPaused(.., true)`, response `{ camera_id, paused: true }`.
- resume → `setDeploymentPaused(.., false)`.
- 404/410 resolution cases unchanged.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — mock-friendly: routes import `endActiveDeployment`/`setDeploymentPaused` from `cameraDeployment`.
- [ ] **Step 4: Run + tsc grep decommission/pause/resume → PASS.**
- [ ] **Step 5: Commit** — `feat(api): decommission/pause/resume act on the active deployment`.

---

## Slice E — Map + My Cameras

## Task 12: Public map `state` filter (`db-all-webcams`)

**Files:**
- Modify: `app/api/db-all-webcams/route.ts`
- Test: `app/api/db-all-webcams/route.test.ts` (create if absent)

Custom rows show only when live; Windy rows (`state IS NULL`) must be unaffected.

- [ ] **Step 1: Write the failing test**

Mock `sql` to return a mix: a Windy row (`source:'windy', state:null`), a deployed custom row, a testing custom row, an ended custom row, a paused custom row. Assert the SQL `WHERE` keeps Windy + the deployed-active-unpaused custom row, and excludes testing/ended/paused. (Assert on the response set; the filter is in SQL so the test asserts the query string contains the guard AND that with a stubbed result the mapping passes through.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — add to the `WHERE`:

```sql
where (w.source <> 'custom'
       or (w.state = 'deployed' and w.ended_at is null and w.paused = false))
```

- [ ] **Step 4: Run + tsc grep db-all-webcams → PASS.**

- [ ] **Step 5: Commit** — `feat(api): public map shows only live (deployed) custom deployments`.

## Task 13: My Cameras — active deployment join + `?includeEnded` trail

**Files:**
- Modify: `app/api/my-cameras/route.ts`
- Test: `app/api/my-cameras/route.test.ts`

Today it reads lat/lng from `cameras` and filters `c.status='active'`. Retarget: join the active deployment (`webcams ed on ed.id = c.webcam_id`) for lat/lng/phase/title/snapshot; drop the `c.status='active'` filter in favor of "has an active deployment OR show all owned." Add `?includeEnded=1` to also return `ended` deployments (the trail) for the owner map toggle.

- [ ] **Step 1: Update tests** — active deployment provides lat/lng; a camera with no active deployment is omitted from the default list; `includeEnded` returns ended rows too (with their retained lat/lng + an `ended_at`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — query owned cameras joined to their deployments; default `ended_at IS NULL`; `includeEnded` returns all deployments with `state`/`ended_at` in the marker payload (extend `MyCameraMarker` with `state` + `ended_at`).
- [ ] **Step 4: Run + tsc grep my-cameras → PASS.**
- [ ] **Step 5: Commit** — `feat(api): my-cameras reads deployments + includeEnded trail`.

## Task 14: "Show decommissioned" toggle (My Cameras UI)

**Files:**
- Modify: `app/components/MyCameras/MyCamerasView.tsx` (+ store hook `app/store/useLoadMyCameras.ts`)
- Test: `app/components/MyCameras/MyCamerasView.test.tsx`

A client toggle that, when on, requests `?includeEnded=1` and renders `ended` deployments distinctly (muted marker + "decommissioned" label) at their retained location.

- [ ] **Step 1: Write the failing test** — toggle off → only active markers; toggle on → ended markers appear with a decommissioned indicator. (Mock the fetch/store.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — add the toggle + thread `includeEnded` into the loader; style ended markers.
- [ ] **Step 4: Run + tsc grep MyCameras → PASS.**
- [ ] **Step 5: Commit** — `feat(my-cameras): show-decommissioned toggle reveals the deployment trail`.

---

## Slice F — Wizard wiring (owner mode + re-aim/new)

## Task 15: setup page passes `isOwner`; thread `mode` + `publish`

**Files:**
- Modify: `app/setup/[claim_code]/page.tsx`, `WizardClient.tsx`, `types.ts`, `steps/SubmitStep.tsx`, `steps/WizardEntry.tsx`
- Test: `app/setup/[claim_code]/steps/SubmitStep.test.tsx`, `WizardClient.test.tsx`

- [ ] **Step 1: Update tests**

- `SubmitStep`: POST body includes `mode` (from props) and, in owner mode, `publish`. Assert the fetch body carries `mode:'reaim'` by default and `mode:'new'` when re-aiming a placed camera as a move; assert `publish` only sent when `isOwner`.
- `WizardClient`: `WizardEntry` "Re-aim" → the flow runs with `mode='new'` available; commission → `mode='reaim'`/first deployment. (Owner publish surfaces a "Publish now (go live)" checkbox in owner mode.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

`page.tsx`:
```tsx
import { auth } from '@/auth';
import { isOwner } from '@/app/lib/owner';
// ...
const session = await auth();
return <WizardClient claimCode={claim_code} isOwner={isOwner(session)} />;
```

`WizardClient`: accept `isOwner`; track `mode` (commission/first → `'reaim'`; the WizardEntry "Re-aim / move" path can offer "moved to a new spot?" → `mode='new'`). Pass `isOwner`, `mode`, and an owner-only `publish` state into `SubmitStep`.

`SubmitStep`: include `mode` and (owner) `publish` in the `buildPreRegisterPayload` POST body.

`types.ts`: add `mode: 'reaim' | 'new'` and `publish: boolean` to `WizardState` (publish default false; only meaningful in owner mode).

- [ ] **Step 4: Run + tsc grep `setup/\[claim_code\]` → PASS.**

- [ ] **Step 5: Commit** — `feat(wizard): owner-aware (isOwner) + re-aim/new mode + publish`.

---

## Slice G — Gate + deploy notes

## Task 16: Full suite + type-check gate

- [ ] **Step 1:** `NODE_OPTIONS= npx vitest run app/setup app/api/cameras app/api/my-cameras app/api/db-all-webcams app/lib` — all green.
- [ ] **Step 2:** `NODE_OPTIONS= npx tsc --noEmit 2>&1 | grep -E "setup/\[claim_code\]|api/cameras|cameraDeployment|deploymentPlacement|my-cameras|db-all-webcams" || echo "NO TS ERRORS IN SCOPE"` — clean for scope (pre-existing unrelated errors out of scope).
- [ ] **Step 3:** Update `docs/superpowers/specs/2026-06-13-deployment-model-reconciliation-design.md` §13 — strike resolved open questions (provisioning endpoint built; Windy filter tested).
- [ ] **Step 4: Commit** — `chore: deployment-model suite + type-check gate`.

## Deploy runbook (NOT part of the branch; user's hands, after merge approval)

Apply to prod **in this order, before the route code deploys** (spec §12):
1. `psql "$DATABASE_URL" -f database/migrations/20260613_deployment_model.sql`
2. Edit the backfill per its prod note (drop the `c.azimuth_source/coarse/bracket` COALESCE lines — those columns don't exist on prod `cameras`), then `psql "$DATABASE_URL" -f database/migrations/20260613_deployment_model_backfill.sql`
3. Verify: camera 1 → one `state='testing'` active deployment; `cameras.webcam_id` repointed; public map unaffected for Windy.
4. Provision any new bench units via `POST /api/cameras/provision` (CRON_SECRET) before flashing.

The held migrations `20260613_cameras_bracket_provenance.sql` + `20260613_cameras_lifecycle.sql` are **superseded — do NOT apply them**.

---

## Self-Review

- **Spec coverage:** §3 webcams-as-deployment → Tasks 1,2,5. §4 column map → Task 1. §5 lifecycle → Tasks 5,11. §6 decommission/pause/wipe → Task 11 (wipe CTE retained in Task 9). §7 owner-aware → Tasks 7,15. §8 placement/mode + advisory distance → Tasks 3,5,15. §9 provisioning + identity → Tasks 6,8. §10 map+my-cameras → Tasks 12,13,14. §11 retarget → Tasks 7–11. §12 migration → Tasks 1,2 + deploy runbook. ✓
- **Placeholder scan:** the `DEPLOYMENT_COLS` illustrative line in Task 4 is explicitly flagged for removal; the Task 1 migration header has a `<PASTE ...>` that Task 0 fills — intentional, not a code placeholder. No other TBDs.
- **Type consistency:** `DeploymentRow`/`DeploymentPlacementInput`/`PlacementMode`/`DeploymentState` defined in Tasks 4–5 and reused by 7–13. `derivePlacementStatus` is deployment-shaped (Task 4) and replaces the camera-shaped one in the retargeted routes. `upsertActiveDeployment(cameraId, input, {state, mode})` signature consistent across 5/7.
- **Known risk carried forward:** the webcams INSERT (Task 5) depends on Task 0's NOT-NULL enumeration — that's why Task 0 is mandatory and first.
