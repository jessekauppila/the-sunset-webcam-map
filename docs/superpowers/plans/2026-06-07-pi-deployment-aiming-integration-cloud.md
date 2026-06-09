# Deployment-Aiming Integration (Cloud-Protocol Slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the cloud the location-down / aim-up split: a three-state placement lifecycle (`awaiting_location` → `awaiting_aim` → `ready`), deliver lat/lng to the device once known so it can draw the sun overlay, and accept the device's confirmed aim via a new placement endpoint.

**Architecture:** Pure logic in the existing Next.js API — no DB migration (the `cameras` table already has `lat`/`lng`/`azimuth_deg`/`tilt_deg`). Extend the derived `derivePlacementStatus`, branch the heartbeat response on the three states (returning lat/lng in `awaiting_aim`), add `POST /api/cameras/:id/placement`, and surface `awaiting_aim` in the wizard's `setup-status` poll.

**Tech Stack:** Next.js App Router (`app/api/...route.ts`), `@/app/lib/db` tagged-template `sql`, `vitest` (`// @vitest-environment node`, mocked `sql`/`cameraAuth`/`cameraRegistration`).

---

## Scope & gating

This is the **now-unblocked cloud-protocol slice** of `docs/superpowers/specs/2026-06-07-pi-deployment-aiming-integration-design.md` (spec slices touching `app/`+`database/`). **Unblocked because labeling-queue PR #49 merged to main** (`f78c1e4c0`), so there's no longer a shared-surface conflict.

**Still gated, NOT in this plan:** the device-side **supervisor** (starts/stops `sunset-cam-aiming` vs `sunset-cam` by status) and the **`sunset-cam-aiming.service` systemd unit** + the **`reaim`/`reprovision`** relocation directives — these depend on sub-project E's device state machine existing. Separate follow-on plan.

**Compatibility note:** changing `derivePlacementStatus`'s return values from `'pending'|'ready'` to the three-state set changes the device-protocol response. The existing capture firmware (sunset-cam-0/1) uses the window-based capture path, not the placement flow, so this is safe; the new firmware (this feature) expects the three states. Confirm no other caller hard-codes `'pending'`.

## Working location

`the-sunset-webcam-map` on branch **`feat/deploy-aiming-cloud`** off **`origin/main`** (which now includes PR #49). Use a git worktree. Confirm the branch before each commit.
Run tests: `npx vitest run <path>` (or the repo's configured test script). Confirm the repo's lint/build passes before the final commit: `npm run lint`.

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `app/lib/cameraRegistration.ts` | `PlacementStatus` type + `derivePlacementStatus` → three states | Modify |
| `app/api/cameras/[id]/heartbeat/route.ts` | branch on three states; return lat/lng in `awaiting_aim` | Modify |
| `app/api/cameras/[id]/placement/route.ts` | **new** `POST` — device reports confirmed aim | Create |
| `app/api/cameras/setup-status/[claim_code]/route.ts` | surface `awaiting_aim` | Modify |
| `app/lib/cameraRegistration.test.ts` | three-state tests (create if absent) | Create/Modify |
| `app/api/cameras/[id]/heartbeat/route.test.ts` | awaiting_aim returns lat/lng | Modify |
| `app/api/cameras/[id]/placement/route.test.ts` | new-route tests | Create |
| `app/api/cameras/setup-status/[claim_code]/route.test.ts` | awaiting_aim status | Modify |

---

### Task 1: Three-state `derivePlacementStatus`

**Files:** Modify `app/lib/cameraRegistration.ts`; test `app/lib/cameraRegistration.test.ts`.

- [ ] **Step 1: Write the failing tests** (create `app/lib/cameraRegistration.test.ts` if it doesn't exist; if it does, append)

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { derivePlacementStatus } from './cameraRegistration';

describe('derivePlacementStatus (three states)', () => {
  it('awaiting_location when lat or lng missing', () => {
    expect(derivePlacementStatus({ lat: null, lng: null, azimuth_deg: null, tilt_deg: null }))
      .toBe('awaiting_location');
    expect(derivePlacementStatus({ lat: 48.7, lng: null, azimuth_deg: null, tilt_deg: null }))
      .toBe('awaiting_location');
  });
  it('awaiting_aim when located but not aimed', () => {
    expect(derivePlacementStatus({ lat: 48.7, lng: -122.4, azimuth_deg: null, tilt_deg: null }))
      .toBe('awaiting_aim');
  });
  it('ready when located and aimed', () => {
    expect(derivePlacementStatus({ lat: 48.7, lng: -122.4, azimuth_deg: 270, tilt_deg: 2 }))
      .toBe('ready');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run app/lib/cameraRegistration.test.ts`
Expected: FAIL — current function returns `'pending'`, not `'awaiting_location'`/`'awaiting_aim'`.

- [ ] **Step 3: Implement** — in `app/lib/cameraRegistration.ts` replace the type + function:

```typescript
export type PlacementStatus = 'awaiting_location' | 'awaiting_aim' | 'ready';

export function derivePlacementStatus(row: PlacementShape): PlacementStatus {
  if (row.lat == null || row.lng == null) return 'awaiting_location';
  if (row.azimuth_deg == null || row.tilt_deg == null) return 'awaiting_aim';
  return 'ready';
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run app/lib/cameraRegistration.test.ts` → PASS. Then `npm run lint` to catch any caller that pattern-matched the old `'pending'` literal (TypeScript will flag exhaustive checks). Heartbeat + setup-status are updated in Tasks 2/4; if `register/route.ts` references `derivePlacementStatus`, it passes the value straight through to its response (no literal comparison) — verify with `grep -n "pending" app/api/cameras/register/route.ts` returns nothing; if it does, update that branch to the new states in this task.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # MUST be feat/deploy-aiming-cloud
git add app/lib/cameraRegistration.ts app/lib/cameraRegistration.test.ts
git commit -m "feat(cameras): three-state placement status (awaiting_location/awaiting_aim/ready)"
```

---

### Task 2: Heartbeat returns lat/lng in `awaiting_aim`

The device needs lat/lng to draw the sun overlay before it can aim. Current heartbeat returns `{placement_status:'pending'}` (no coords) when not ready. Split that into the two pending states.

**Files:** Modify `app/api/cameras/[id]/heartbeat/route.ts`; test `app/api/cameras/[id]/heartbeat/route.test.ts`.

- [ ] **Step 1: Write the failing test** (append; mirror the existing file's mock setup — `derivePlacementStatusMock`, `sqlMock`, `verifyDeviceTokenMock`, `makeRequest`, `makeContext`)

```typescript
it('returns lat/lng with awaiting_aim so the device can aim', async () => {
  verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42 });
  sqlMock.mockResolvedValueOnce([
    { lat: 48.7519, lng: -122.4787, elevation_m: null, timezone: 'America/Los_Angeles',
      azimuth_deg: null, tilt_deg: null, horizon_altitude_deg: null, horizon_profile: null },
  ]);
  derivePlacementStatusMock.mockReturnValueOnce('awaiting_aim');
  const res = await POST(
    makeRequest({ id: '42', bearer: 'good', body: { request_placement: true } }),
    makeContext('42')
  );
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.placement_status).toBe('awaiting_aim');
  expect(json.lat).toBe(48.7519);
  expect(json.lng).toBe(-122.4787);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run "app/api/cameras/[id]/heartbeat/route.test.ts"`
Expected: FAIL — current code returns `{placement_status:'pending'}` with no lat/lng.

- [ ] **Step 3: Implement** — in the placement-branch of `heartbeat/route.ts`, replace the `status === 'pending'` block with three-state handling:

```typescript
  const status = derivePlacementStatus(row);
  if (status === 'awaiting_location') {
    return NextResponse.json({ acknowledged_at: acknowledgedAt, placement_status: 'awaiting_location' });
  }
  if (status === 'awaiting_aim') {
    return NextResponse.json({
      acknowledged_at: acknowledgedAt,
      placement_status: 'awaiting_aim',
      lat: row.lat,
      lng: row.lng,
    });
  }
  return NextResponse.json({
    acknowledged_at: acknowledgedAt,
    placement_status: 'ready',
    placement: {
      lat: row.lat,
      lng: row.lng,
      // ...keep the existing `placement` fields (elevation_m, timezone, azimuth_deg, tilt_deg, horizon_*)
    },
  });
```
(Keep the existing `placement` object's full field list in the `ready` branch — only the pending branches change.)

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run "app/api/cameras/[id]/heartbeat/route.test.ts"` → PASS (new + existing). Update any existing test that asserted `placement_status: 'pending'` to the correct new state.

- [ ] **Step 5: Commit**

```bash
git add "app/api/cameras/[id]/heartbeat/route.ts" "app/api/cameras/[id]/heartbeat/route.test.ts"
git commit -m "feat(heartbeat): deliver lat/lng in awaiting_aim so the device can aim"
```

---

### Task 3: `POST /api/cameras/:id/placement` — accept the confirmed aim

**Files:** Create `app/api/cameras/[id]/placement/route.ts` + `app/api/cameras/[id]/placement/route.test.ts`.

- [ ] **Step 1: Write the failing tests** (mirror the heartbeat test's mock harness for `verifyDeviceToken` + `sql`)

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
const verifyDeviceTokenMock = vi.fn();
const sqlMock = vi.fn();
vi.mock('@/app/lib/cameraAuth', () => ({ verifyDeviceToken: (...a: unknown[]) => verifyDeviceTokenMock(...a) }));
vi.mock('@/app/lib/db', () => ({ sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v) }));
import { POST } from './route';
beforeEach(() => { verifyDeviceTokenMock.mockReset(); sqlMock.mockReset(); });

function req(opts: { id?: string; bearer?: string; body?: unknown }) {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Request(`http://test/api/cameras/${opts.id ?? '42'}/placement`, {
    method: 'POST', headers, body: JSON.stringify(opts.body ?? {}),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/cameras/[id]/placement', () => {
  it('401 when unauthenticated', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce(null);
    const res = await POST(req({ bearer: 'bad', body: { azimuth_deg: 270, tilt_deg: 2 } }), ctx('42'));
    expect(res.status).toBe(401);
  });
  it('saves the aim and reports ready', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42 });
    sqlMock.mockResolvedValueOnce([{ lat: 48.7, lng: -122.4, azimuth_deg: 270, tilt_deg: 2 }]);
    const res = await POST(req({ bearer: 'good', body: { azimuth_deg: 270, tilt_deg: 2, confirmed_at: '2026-06-07T00:00:00Z' } }), ctx('42'));
    expect(res.status).toBe(200);
    expect((await res.json()).placement_status).toBe('ready');
  });
  it('400 on non-numeric aim', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42 });
    const res = await POST(req({ bearer: 'good', body: { azimuth_deg: 'x' } }), ctx('42'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run "app/api/cameras/[id]/placement/route.test.ts"`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement** `app/api/cameras/[id]/placement/route.ts`. Use `verifyDeviceToken` **exactly as `heartbeat/route.ts` calls it** (same argument order + the same 401-on-null handling — open `heartbeat/route.ts` and copy that call shape):

```typescript
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { verifyDeviceToken } from '@/app/lib/cameraAuth';
import { derivePlacementStatus } from '@/app/lib/cameraRegistration';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const cameraId = Number(id);
  if (!Number.isInteger(cameraId)) {
    return NextResponse.json({ error: 'invalid camera id' }, { status: 400 });
  }
  const auth = await verifyDeviceToken(request, cameraId); // MATCH heartbeat's exact call
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let body: { azimuth_deg?: unknown; tilt_deg?: unknown };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const azimuth = Number(body.azimuth_deg);
  const tilt = Number(body.tilt_deg);
  if (!Number.isFinite(azimuth) || !Number.isFinite(tilt)) {
    return NextResponse.json({ error: 'azimuth_deg and tilt_deg must be numbers' }, { status: 400 });
  }
  const rows = (await sql`
    UPDATE cameras SET azimuth_deg = ${azimuth}, tilt_deg = ${tilt}
    WHERE id = ${cameraId}
    RETURNING lat, lng, azimuth_deg, tilt_deg
  `) as { lat: number | null; lng: number | null; azimuth_deg: number | null; tilt_deg: number | null }[];
  if (!rows[0]) {
    return NextResponse.json({ error: 'camera not found' }, { status: 404 });
  }
  return NextResponse.json({ placement_status: derivePlacementStatus(rows[0]) });
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run "app/api/cameras/[id]/placement/route.test.ts"` → PASS. If `verifyDeviceToken`'s real signature differs from `(request, cameraId)`, adjust the call to match `heartbeat/route.ts` and re-run.

- [ ] **Step 5: Commit**

```bash
git add "app/api/cameras/[id]/placement/route.ts" "app/api/cameras/[id]/placement/route.test.ts"
git commit -m "feat(cameras): POST /api/cameras/:id/placement accepts the device's confirmed aim"
```

---

### Task 4: `setup-status` surfaces `awaiting_aim`

The cloud wizard polls this to know when to show the aiming step.

**Files:** Modify `app/api/cameras/setup-status/[claim_code]/route.ts`; test `app/api/cameras/setup-status/[claim_code]/route.test.ts`.

- [ ] **Step 1: Write the failing test** (append; mirror existing mock harness)

```typescript
it('reports awaiting_aim when located but not yet aimed', async () => {
  getClaimCodeMock.mockResolvedValueOnce({ expires_at: new Date(Date.now() + 1e6) });
  sqlMock.mockResolvedValueOnce([
    { id: 1, hardware_id: 'pi-real', device_token_hash: 'real',
      lat: 48.7, lng: -122.4, azimuth_deg: null, tilt_deg: null },
  ]);
  derivePlacementStatusMock.mockReturnValueOnce('awaiting_aim');
  const res = await GET(new Request('http://test/'), { params: Promise.resolve({ claim_code: 'SUNSET-A-B' }) });
  expect((await res.json()).status).toBe('awaiting_aim');
});
```
(Match the existing test file's mocks — it mocks `getClaimCode`, `sql`, and `derivePlacementStatus`/`sentinelForClaimCode`. Use the same mock names already in that file.)

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run "app/api/cameras/setup-status/[claim_code]/route.test.ts"`
Expected: FAIL — current mapping only emits `'ready'` or `'registered'`.

- [ ] **Step 3: Implement** — replace the final return in `setup-status/[claim_code]/route.ts`:

```typescript
  const placement = derivePlacementStatus(row);
  const status =
    placement === 'ready' ? 'ready'
    : placement === 'awaiting_aim' ? 'awaiting_aim'
    : 'registered'; // awaiting_location: device is up but has no coords yet
  return NextResponse.json({ status });
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run "app/api/cameras/setup-status/[claim_code]/route.test.ts"` → PASS (new + existing). Then run the full cloud test suite + `npm run lint` to confirm no other caller broke on the type change.

- [ ] **Step 5: Commit**

```bash
git add "app/api/cameras/setup-status/[claim_code]/route.ts" "app/api/cameras/setup-status/[claim_code]/route.test.ts"
git commit -m "feat(setup-status): surface awaiting_aim for the cloud wizard"
```

---

## Self-Review

- **Spec coverage:** three-state `placement_status` → Task 1; lat/lng in register/heartbeat → Task 2 (heartbeat is where ongoing delivery happens; register passes the derived status through automatically — verified in Task 1 Step 4); `POST /api/cameras/:id/placement` → Task 3; `setup-status` `awaiting_aim` → Task 4. No migration — columns exist. The `reaim`/`reprovision` directives + `local_ip` are explicitly gated (device-supervisor plan).
- **Placeholders:** Tasks 2 & 3 reference "keep the existing `placement` fields" / "match heartbeat's `verifyDeviceToken` call" — these point at concrete, named existing code to copy exactly (not vague "handle X"); the new logic is given in full. Acceptable for edits to existing routes.
- **Type consistency:** `PlacementStatus` = `'awaiting_location'|'awaiting_aim'|'ready'` used consistently in Tasks 1/2/4; `derivePlacementStatus(row)` returns it; the placement route (Task 3) returns it via the same function.

## Follow-on (gated on sub-project E)
The device-side supervisor (start/stop `sunset-cam-aiming` vs `sunset-cam` by the `placement_status` it reads from heartbeat), the `sunset-cam-aiming.service` unit, heartbeat `local_ip`, and the `reaim`/`reprovision` relocation directives. The firmware already writes its confirmed placement to `/etc/sunset-cam/placement.json` (the `placement_sink`) and reports it via `POST /api/cameras/:id/placement` (this plan) — the supervisor is what ties the mode transitions together.
