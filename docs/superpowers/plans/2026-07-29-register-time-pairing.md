# Register-Time Camera Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a custom camera get its `webcams` pairing row + `cameras.webcam_id` at device-boot registration, in a pre-placement `testing` state, so it is snapshot-capable immediately and camera 2 self-heals on next reboot.

**Architecture:** Add an idempotent `ensureDeploymentPairing(cameraId)` to `app/lib/cameraDeployment.ts` that inserts a minimal pre-placement deployment row (via a shared private `insertActiveDeployment` helper, also used by the existing `upsertActiveDeployment`) and sets the `webcam_id` back-pointer when no active deployment exists — a no-op when one already exists. Call it from `app/api/cameras/register/route.ts` on every register. Deliberately does not touch `terminator_webcam_state` (cron-owned) and adds no migration.

**Tech Stack:** Next.js App Router (route handlers), TypeScript, `@/app/lib/db` tagged-template `sql`, Vitest with mocked `sql` (no live DB in tests).

## Global Constraints

- Branch: `feat/cloud-https-setup`. Plain branch in the main checkout — NO worktrees in this repo.
- Tests mock `sql` via `vi.mock('@/app/lib/db', …)`; they never hit a real database. Match the existing suite's style.
- No new migration. Uses only existing columns; depends on the un-applied `20260613_*` migrations being present in prod at deploy time (tracked separately, not in this plan).
- `terminator_webcam_state` MUST NOT be written by onboarding code (cron-owned curated-winner cache).
- Pre-placement state value is `'testing'`; placement columns are all `NULL` on the inserted row.
- Before any commit, confirm the current branch is `feat/cloud-https-setup` (Jesse merges PRs in parallel).

---

### Task 1: Extract shared `insertActiveDeployment` helper + add `ensureDeploymentPairing`

**Files:**
- Modify: `app/lib/cameraDeployment.ts`
- Test: `app/lib/cameraDeployment.test.ts`

**Interfaces:**
- Consumes: existing `getActiveDeployment(cameraId: number): Promise<DeploymentRow | null>`, `DeploymentRow`, `DeploymentState`, `DeploymentPlacementInput`, and the private `j()` JSON helper — all already in this file.
- Produces:
  - `insertActiveDeployment(cameraId: number, p: DeploymentPlacementInput, state: DeploymentState): Promise<DeploymentRow>` — private (not exported). INSERTs one `webcams` row (`source='custom'`, `custom_camera_id=cameraId`, `external_id='custom-{cameraId}-{Date.now()}'`, `title='Camera {cameraId}'`, `status='active'`, `state`, `paused=FALSE`, `started_at=NOW()`, placement columns from `p`) and then `UPDATE cameras SET webcam_id = <inserted.id>`. Returns the inserted `DeploymentRow`.
  - `ensureDeploymentPairing(cameraId: number): Promise<DeploymentRow>` — exported. Returns the existing active deployment if one exists (no writes); otherwise inserts a pre-placement `testing` row (all placement fields `null`) via `insertActiveDeployment` and returns it.

**Context — the existing insert lives inside `upsertActiveDeployment`** (`app/lib/cameraDeployment.ts:110-131`): the `INSERT INTO webcams (...) VALUES ('custom', ${cameraId}, ${externalId}, ...) RETURNING ...` followed by `UPDATE cameras SET webcam_id = ${inserted[0].id}`. Task extracts that block verbatim into `insertActiveDeployment` and has both callers use it.

- [ ] **Step 1: Write the failing tests**

Add to `app/lib/cameraDeployment.test.ts` (follow the file's existing `sqlMock` setup — a `vi.fn()` bound to `@/app/lib/db`'s `sql`):

```typescript
describe('ensureDeploymentPairing', () => {
  it('inserts a pre-placement testing row and sets webcam_id when none exists', async () => {
    // getActiveDeployment query → no active deployment
    sqlMock.mockResolvedValueOnce([]);
    // INSERT ... RETURNING → the new row
    sqlMock.mockResolvedValueOnce([{ id: 900, custom_camera_id: 2, state: 'testing' }]);
    // UPDATE cameras SET webcam_id → (return value unused)
    sqlMock.mockResolvedValueOnce([]);

    const row = await ensureDeploymentPairing(2);

    expect(row).toEqual({ id: 900, custom_camera_id: 2, state: 'testing' });
    // 3 SQL calls: select active, insert webcams, update cameras.webcam_id
    expect(sqlMock).toHaveBeenCalledTimes(3);
    const insertSql = sqlMock.mock.calls[1][0].join('?');
    expect(insertSql).toContain('INSERT INTO webcams');
    // inserted with testing state and custom source
    expect(sqlMock.mock.calls[1]).toContain('testing');
    const updateSql = sqlMock.mock.calls[2][0].join('?');
    expect(updateSql).toContain('UPDATE cameras SET webcam_id');
  });

  it('is a no-op when an active deployment already exists', async () => {
    const existing = { id: 42, custom_camera_id: 2, state: 'deployed' };
    sqlMock.mockResolvedValueOnce([existing]); // getActiveDeployment → found

    const row = await ensureDeploymentPairing(2);

    expect(row).toEqual(existing);
    // Only the getActiveDeployment SELECT ran — no INSERT, no UPDATE.
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });
});
```

Ensure the import at the top of the test file includes `ensureDeploymentPairing`:

```typescript
import {
  getActiveDeployment,
  ensureDeploymentPairing,
  // ...existing imports
} from '@/app/lib/cameraDeployment';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/lib/cameraDeployment.test.ts -t ensureDeploymentPairing`
Expected: FAIL — `ensureDeploymentPairing is not a function` (not yet exported).

- [ ] **Step 3: Extract the shared insert helper**

In `app/lib/cameraDeployment.ts`, add a private helper above `upsertActiveDeployment`. Move the INSERT + back-pointer update out of `upsertActiveDeployment` into it:

```typescript
// Inserts a fresh active deployment row and repoints cameras.webcam_id at it.
// Shared by upsertActiveDeployment (placed rows) and ensureDeploymentPairing
// (pre-placement rows). external_id must be unique per deployment
// (UNIQUE(source, external_id)).
async function insertActiveDeployment(
  cameraId: number,
  p: DeploymentPlacementInput,
  state: DeploymentState
): Promise<DeploymentRow> {
  const externalId = `custom-${cameraId}-${Date.now()}`;
  const inserted = (await sql`
    INSERT INTO webcams (
      source, custom_camera_id, external_id, title, status,
      state, paused, started_at,
      lat, lng, elevation_m, timezone, azimuth_deg, tilt_deg,
      horizon_altitude_deg, horizon_profile, azimuth_source, coarse, bracket,
      phase_preference, delivery_preferences
    ) VALUES (
      'custom', ${cameraId}, ${externalId}, ${'Camera ' + cameraId}, 'active',
      ${state}, FALSE, NOW(),
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
```

Then replace the insert block inside `upsertActiveDeployment` (currently `app/lib/cameraDeployment.ts:108-131`) with a call to it:

```typescript
  return insertActiveDeployment(cameraId, p, opts.state);
```

(This replaces the `const externalId = …`, the `const inserted = (await sql\`INSERT …\`)…`, the `UPDATE cameras …`, and `return inserted[0];` lines — the `mode==='new'` `UPDATE webcams SET ended_at …` line just above stays.)

- [ ] **Step 4: Add `ensureDeploymentPairing`**

Add below `upsertActiveDeployment` in `app/lib/cameraDeployment.ts`:

```typescript
const NULL_PLACEMENT: DeploymentPlacementInput = {
  lat: null, lng: null, elevation_m: null, timezone: null,
  azimuth_deg: null, tilt_deg: null, horizon_altitude_deg: null,
  horizon_profile: null, azimuth_source: null, coarse: null,
  bracket: null, phase_preference: null, delivery_preferences: null,
};

// Idempotently guarantees a custom camera has an active deployment (and thus a
// cameras.webcam_id back-pointer) so it can accept snapshots. Called at device
// registration. When no active deployment exists, opens a pre-placement one in
// 'testing' state (null placement → stays off the public map until placed).
// No-op when an active deployment already exists — never clobbers placement.
export async function ensureDeploymentPairing(
  cameraId: number
): Promise<DeploymentRow> {
  const active = await getActiveDeployment(cameraId);
  if (active) return active;
  return insertActiveDeployment(cameraId, NULL_PLACEMENT, 'testing');
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run app/lib/cameraDeployment.test.ts`
Expected: PASS — the new `ensureDeploymentPairing` tests AND all pre-existing `cameraDeployment` tests (the `upsertActiveDeployment` refactor must not regress them).

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/cloud-https-setup
git add app/lib/cameraDeployment.ts app/lib/cameraDeployment.test.ts
git commit -m "feat(lib): ensureDeploymentPairing + shared insertActiveDeployment helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Call `ensureDeploymentPairing` from the register route

**Files:**
- Modify: `app/api/cameras/register/route.ts`
- Test: `app/api/cameras/register/route.test.ts`

**Interfaces:**
- Consumes: `ensureDeploymentPairing(cameraId: number): Promise<DeploymentRow>` from Task 1.
- Produces: no new exports. Behavior change only — `register` now sets `cameras.webcam_id` (via the pairing) when a camera has no active deployment; response body shape is unchanged.

**Context:** `register/route.ts` currently (step 4) updates device fields, then (step 5) calls `getActiveDeployment` + `derivePlacementStatus` for the response. Insert the `ensureDeploymentPairing` call between them. The route already imports from `@/app/lib/cameraDeployment`.

- [ ] **Step 1: Write the failing test**

Add to `app/api/cameras/register/route.test.ts` (follow the file's existing mock setup — it mocks `sql`, `getClaimCode`, and imports the route `POST`). Mock `ensureDeploymentPairing` on the `cameraDeployment` module and assert the route calls it with the resolved camera id:

```typescript
// In the existing vi.mock('@/app/lib/cameraDeployment', …) factory, add:
//   ensureDeploymentPairing: vi.fn(),
// and import the mocked fn for assertions.

it('ensures the webcams pairing exists on register', async () => {
  // ...arrange the same happy-path mocks the existing "registers" test uses
  // (valid claim code, cameras row resolves to id 2, hardware_id matches) ...

  const res = await POST(makeRegisterRequest({
    claim_code: 'SUNSET-D3P4-K9WJ',
    hardware_id: 'hw-sunset-cam-2',
  }));

  expect(res.status).toBe(200);
  expect(ensureDeploymentPairing).toHaveBeenCalledWith(2);
});
```

Model `makeRegisterRequest` and the mock arrangement on the existing happy-path test in this file (reuse its helpers/fixtures rather than inventing new ones).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/cameras/register/route.test.ts -t "ensures the webcams pairing"`
Expected: FAIL — `ensureDeploymentPairing` not called (route doesn't call it yet).

- [ ] **Step 3: Wire the call into the route**

In `app/api/cameras/register/route.ts`, extend the import:

```typescript
import {
  getActiveDeployment,
  derivePlacementStatus,
  ensureDeploymentPairing,
} from '@/app/lib/cameraDeployment';
```

Then, between step 4 (the `UPDATE cameras SET firmware_version …` block) and step 5 (`const d = await getActiveDeployment(cameraId);`), add:

```typescript
    // 4b. Guarantee the webcams pairing exists so the unit is snapshot-capable
    //     immediately (pre-placement 'testing' row when unplaced). Idempotent.
    await ensureDeploymentPairing(cameraId);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/api/cameras/register/route.test.ts`
Expected: PASS — the new test AND all pre-existing register-route tests.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/cloud-https-setup
git add app/api/cameras/register/route.ts app/api/cameras/register/route.test.ts
git commit -m "feat(api): register ensures webcams pairing (snapshot-capable on boot)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Full-suite regression + typecheck gate

**Files:** none (verification only).

- [ ] **Step 1: Run the camera test suites**

Run: `npx vitest run app/lib/cameraDeployment.test.ts app/api/cameras`
Expected: PASS — all deployment lib + camera route tests green (confirms the `upsertActiveDeployment` refactor and register wiring broke nothing).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Confirm no `terminator_webcam_state` write crept in**

Run: `git diff main -- app/lib/cameraDeployment.ts app/api/cameras/register/route.ts | grep -i terminator_webcam_state || echo "clean — no terminator_webcam_state writes"`
Expected: `clean — no terminator_webcam_state writes`.

---

## Post-implementation: live verification against camera 2 (Jesse-gated)

Not a code task — run with Jesse after the branch deploys (prod DB reads need his explicit OK; the `20260613_*` migrations must be applied to prod first):

1. Reboot camera 2 (`ssh pi@192.168.0.103`) so it re-registers.
2. Confirm `cameras.webcam_id` for `id = 2` is non-null.
3. POST a snapshot with camera 2's device token → expect **202** (was 404).
4. (Optional) Run the wizard placement to promote `testing → deployed` and confirm it appears on the public map.
