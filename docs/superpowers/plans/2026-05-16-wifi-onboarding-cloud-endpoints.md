# WiFi Onboarding — Cloud Endpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the parent-repo cloud-side endpoints required for streamlined deployment (sub-project E of `docs/superpowers/specs/2026-05-15-streamlined-deployment-overview.md`): admin claim-code minting, pre-register, register, heartbeat, and setup-status — all supporting either-order pre-register/register per spec E §5.4. The firmware-side work (captive portal, SD-card provisioning, device state machine) is a separate plan that will build against these endpoints.

**Architecture:** Next.js 15 App Router routes under `app/api/...`. Each endpoint has a thin handler delegating to a typed helper in `app/lib/` so logic is unit-testable without a request lifecycle. Database access via the existing `@/app/lib/db` `sql` template tag. Device auth via existing `verifyDeviceToken`; admin auth via `Bearer ${CRON_SECRET}` mirroring the existing cron auth pattern at `app/api/cron/update-cameras/lib/auth.ts`. Placement-status is **derived from row shape on read** — no new column — so the source of truth stays the populated/null state of `lat/azimuth_deg/tilt_deg`. One schema migration relaxes NOT NULL on `cameras.lat/lng/timezone` so a row can be created from either pre-register (without device) or register (without placement). A new nullable `cameras.claim_code` column with an index gives setup-status a one-row lookup.

**Tech Stack:** Next.js 15 App Router (TypeScript), Neon Postgres via `@neondatabase/serverless`, Vitest. Crypto helpers via `node:crypto`. No Firebase Storage involvement (snapshot upload is unrelated to onboarding).

---

## File Structure

**New files (creates):**
- `database/migrations/20260516_cameras_either_order_registration.sql` — relax NOT NULLs + add `cameras.claim_code`.
- `app/lib/cameraClaimCode.ts` — mint / lookup / consume helpers.
- `app/lib/cameraClaimCode.test.ts` — unit tests for the above.
- `app/lib/cameraRegistration.ts` — `derivePlacementStatus`, `upsertCameraByClaimCode`, `mintDeviceToken` helpers.
- `app/lib/cameraRegistration.test.ts` — unit tests for the above.
- `app/api/admin/claim-codes/route.ts` — POST mint a claim code.
- `app/api/admin/claim-codes/route.test.ts` — tests.
- `app/api/cameras/pre-register/route.ts` — POST pre-register (either-order).
- `app/api/cameras/pre-register/route.test.ts` — tests.
- `app/api/cameras/register/route.ts` — POST register.
- `app/api/cameras/register/route.test.ts` — tests.
- `app/api/cameras/[id]/heartbeat/route.ts` — POST heartbeat (with optional placement in response).
- `app/api/cameras/[id]/heartbeat/route.test.ts` — tests.
- `app/api/cameras/setup-status/[claim_code]/route.ts` — GET setup status.
- `app/api/cameras/setup-status/[claim_code]/route.test.ts` — tests.

**Modified files:**
- `docs/device-protocol.md` — Amendments A, B, C inline.

**Out of scope for this plan (separate plan):**
- Firmware-side state machine.
- SD-image build + `provision-unit.sh`.
- Sticker PDF generator.
- Captive-portal `hostapd`/`dnsmasq`/Flask wiring.

---

## Task 1: Schema migration — either-order registration

The current `cameras` schema requires `lat`, `lng`, `timezone`, `hardware_id`, and `device_token_hash` to be NOT NULL. With captive-portal onboarding, a `cameras` row may be created by pre-register (no device yet — so no `hardware_id` or `device_token_hash`) OR by register (no placement yet — so no `lat/lng/timezone`). Relax the location NOT NULLs; keep `hardware_id` and `device_token_hash` NOT NULL because the device always supplies them when a `cameras` row is created via the register path, and pre-register-first will populate them at register time without ever inserting a partial row (see Task 4's `upsertCameraByClaimCode` for the merge logic). Add `claim_code` to `cameras` for fast setup-status lookups.

**Files:**
- Create: `database/migrations/20260516_cameras_either_order_registration.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Either-order registration: a cameras row may now arrive populated from
-- pre-register (with placement, awaiting device) OR from register (with
-- device, awaiting placement). Relax NOT NULL on location fields; the
-- application enforces "ready" via app/lib/cameraRegistration.ts.
--
-- Forward-only. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260516_cameras_either_order_registration.sql

ALTER TABLE cameras ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE cameras ALTER COLUMN lng DROP NOT NULL;
ALTER TABLE cameras ALTER COLUMN timezone DROP NOT NULL;

ALTER TABLE cameras ADD COLUMN IF NOT EXISTS claim_code TEXT;
CREATE INDEX IF NOT EXISTS cameras_claim_code_idx ON cameras (claim_code);
```

- [ ] **Step 2: Apply against a scratch/dev DB and verify**

Run:
```bash
psql "$DATABASE_URL" -f database/migrations/20260516_cameras_either_order_registration.sql
psql "$DATABASE_URL" -c "\d cameras" | grep -E "lat|lng|timezone|claim_code"
```

Expected output: `lat`, `lng`, `timezone` listed *without* `not null`; `claim_code` listed as `text` with no constraint. Index `cameras_claim_code_idx` exists (verify with `\di cameras_claim_code_idx`).

If using prod Neon, do not apply yet — that happens in Task 10. This step uses a local or branch DB only.

- [ ] **Step 3: Commit**

```bash
git add database/migrations/20260516_cameras_either_order_registration.sql
git commit -m "db: cameras either-order registration schema"
```

---

## Task 2: Claim-code helper library

A typed wrapper over the existing `camera_claim_codes` table — mint, lookup, consume — so endpoints stay thin.

**Files:**
- Create: `app/lib/cameraClaimCode.ts`
- Test: `app/lib/cameraClaimCode.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/lib/cameraClaimCode.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  mintClaimCode,
  getClaimCode,
  consumeClaimCode,
  CLAIM_CODE_PATTERN,
} from './cameraClaimCode';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('mintClaimCode', () => {
  it('generates a code matching SUNSET-XXXX-XXXX and inserts it', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        code: 'SUNSET-7K3M-9XQ2',
        expires_at: new Date('2026-06-15T00:00:00Z'),
      },
    ]);

    const result = await mintClaimCode({ label: 'rooftop-1' });

    expect(result.code).toMatch(CLAIM_CODE_PATTERN);
    expect(result.expires_at).toBeInstanceOf(Date);
    expect(sqlMock).toHaveBeenCalledOnce();
  });

  it('uses an unambiguous alphabet (no O/0/I/1/L)', async () => {
    sqlMock.mockResolvedValue([
      { code: 'ignored', expires_at: new Date() },
    ]);
    for (let i = 0; i < 50; i++) {
      const r = await mintClaimCode({ label: null });
      expect(r.code).not.toMatch(/[0O1IL]/);
    }
  });
});

describe('getClaimCode', () => {
  it('returns the row when it exists', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        code: 'SUNSET-AAAA-BBBB',
        label: 'test',
        expires_at: new Date('2099-01-01'),
        consumed_at: null,
        consumed_by_camera_id: null,
      },
    ]);
    const row = await getClaimCode('SUNSET-AAAA-BBBB');
    expect(row?.code).toBe('SUNSET-AAAA-BBBB');
    expect(row?.consumed_at).toBeNull();
  });

  it('returns null when the code does not exist', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const row = await getClaimCode('SUNSET-XXXX-XXXX');
    expect(row).toBeNull();
  });
});

describe('consumeClaimCode', () => {
  it('marks the code consumed and returns the updated row', async () => {
    sqlMock.mockResolvedValueOnce([
      {
        code: 'SUNSET-AAAA-BBBB',
        consumed_at: new Date(),
        consumed_by_camera_id: 42,
      },
    ]);
    const row = await consumeClaimCode('SUNSET-AAAA-BBBB', 42);
    expect(row?.consumed_by_camera_id).toBe(42);
    expect(sqlMock).toHaveBeenCalledOnce();
  });

  it('returns null when the code is already consumed', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const row = await consumeClaimCode('SUNSET-AAAA-BBBB', 42);
    expect(row).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run app/lib/cameraClaimCode.test.ts`
Expected: FAIL — `cameraClaimCode` module does not exist.

- [ ] **Step 3: Implement the helpers**

Create `app/lib/cameraClaimCode.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { sql } from '@/app/lib/db';

export const CLAIM_CODE_PATTERN = /^SUNSET-[A-HJKMNPQRTUVWXYZ2-9]{4}-[A-HJKMNPQRTUVWXYZ2-9]{4}$/;

// Unambiguous alphabet — excludes 0/O/1/I/L for sticker legibility.
const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ23456789';

export type ClaimCodeRow = {
  code: string;
  label: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  consumed_by_camera_id: number | null;
};

function randomGroup(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function generateClaimCode(): string {
  return `SUNSET-${randomGroup(4)}-${randomGroup(4)}`;
}

export async function mintClaimCode(opts: {
  label: string | null;
  ttlDays?: number;
}): Promise<{ code: string; expires_at: Date }> {
  const code = generateClaimCode();
  const ttl = opts.ttlDays ?? 30;
  const rows = (await sql`
    INSERT INTO camera_claim_codes (code, label, expires_at)
    VALUES (${code}, ${opts.label}, NOW() + (${ttl} || ' days')::interval)
    RETURNING code, expires_at
  `) as { code: string; expires_at: Date }[];
  return rows[0];
}

export async function getClaimCode(code: string): Promise<ClaimCodeRow | null> {
  const rows = (await sql`
    SELECT code, label, expires_at, consumed_at, consumed_by_camera_id
    FROM camera_claim_codes
    WHERE code = ${code}
    LIMIT 1
  `) as ClaimCodeRow[];
  return rows[0] ?? null;
}

export async function consumeClaimCode(
  code: string,
  cameraId: number
): Promise<ClaimCodeRow | null> {
  const rows = (await sql`
    UPDATE camera_claim_codes
    SET consumed_at = NOW(),
        consumed_by_camera_id = ${cameraId}
    WHERE code = ${code}
      AND consumed_at IS NULL
      AND expires_at > NOW()
    RETURNING code, label, expires_at, consumed_at, consumed_by_camera_id
  `) as ClaimCodeRow[];
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run app/lib/cameraClaimCode.test.ts`
Expected: PASS, all assertions green.

- [ ] **Step 5: Commit**

```bash
git add app/lib/cameraClaimCode.ts app/lib/cameraClaimCode.test.ts
git commit -m "feat(cameras): claim-code mint/lookup/consume helpers"
```

---

## Task 3: Admin claim-codes endpoint

Mirror the cron-secret bearer pattern from `app/api/cron/update-cameras/lib/auth.ts`. POST mints a code; no GET in v1.

**Files:**
- Create: `app/api/admin/claim-codes/route.ts`
- Test: `app/api/admin/claim-codes/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/admin/claim-codes/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mintClaimCodeMock = vi.fn();
vi.mock('@/app/lib/cameraClaimCode', () => ({
  mintClaimCode: (...args: unknown[]) => mintClaimCodeMock(...args),
}));

import { POST } from './route';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  mintClaimCodeMock.mockReset();
  process.env.CRON_SECRET = 'test-secret-12345';
});

function makeRequest(body: unknown, bearer?: string) {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  return new Request('http://test/api/admin/claim-codes', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/claim-codes', () => {
  it('mints a claim code when authorized', async () => {
    mintClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2026-06-15T00:00:00Z'),
    });
    const res = await POST(makeRequest({ label: 'rooftop-1' }, 'test-secret-12345'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe('SUNSET-AAAA-BBBB');
    expect(typeof body.expires_at).toBe('string');
    expect(mintClaimCodeMock).toHaveBeenCalledWith({ label: 'rooftop-1' });
  });

  it('rejects when bearer is missing', async () => {
    const res = await POST(makeRequest({ label: 'rooftop-1' }));
    expect(res.status).toBe(401);
    expect(mintClaimCodeMock).not.toHaveBeenCalled();
  });

  it('rejects when bearer is wrong', async () => {
    const res = await POST(makeRequest({ label: 'rooftop-1' }, 'wrong'));
    expect(res.status).toBe(401);
    expect(mintClaimCodeMock).not.toHaveBeenCalled();
  });

  it('accepts a missing label (label is optional)', async () => {
    mintClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-XXXX-YYYY',
      expires_at: new Date('2026-06-15T00:00:00Z'),
    });
    const res = await POST(makeRequest({}, 'test-secret-12345'));
    expect(res.status).toBe(200);
    expect(mintClaimCodeMock).toHaveBeenCalledWith({ label: null });
  });

  it('returns 400 when body is not valid JSON', async () => {
    const req = new Request('http://test/api/admin/claim-codes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-secret-12345',
      },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run app/api/admin/claim-codes/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the route**

Create `app/api/admin/claim-codes/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { mintClaimCode } from '@/app/lib/cameraClaimCode';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return Boolean(process.env.CRON_SECRET) && header === expected;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const label =
    typeof body.label === 'string' && body.label.trim() !== ''
      ? body.label.trim()
      : null;

  try {
    const minted = await mintClaimCode({ label });
    return NextResponse.json({
      code: minted.code,
      expires_at: minted.expires_at.toISOString(),
    });
  } catch (error) {
    console.error('[admin/claim-codes] mint failed:', error);
    return NextResponse.json(
      { error: 'mint failed', details: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run app/api/admin/claim-codes/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/claim-codes/route.ts app/api/admin/claim-codes/route.test.ts
git commit -m "feat(api): admin claim-codes mint endpoint"
```

---

## Task 4: Registration helper library

The brain of either-order registration. One function (`upsertCameraByClaimCode`) does the merge logic for both pre-register and register. One function (`derivePlacementStatus`) computes pending/ready from the row shape. One function (`mintDeviceToken`) generates a high-entropy token and returns plaintext + hash.

**Files:**
- Create: `app/lib/cameraRegistration.ts`
- Test: `app/lib/cameraRegistration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/lib/cameraRegistration.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  derivePlacementStatus,
  mintDeviceToken,
  upsertCameraByClaimCode,
} from './cameraRegistration';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('derivePlacementStatus', () => {
  it('returns "ready" when all required placement fields are populated', () => {
    expect(
      derivePlacementStatus({
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: 5,
      })
    ).toBe('ready');
  });

  it('returns "pending" when lat is null', () => {
    expect(
      derivePlacementStatus({
        lat: null,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: 5,
      })
    ).toBe('pending');
  });

  it('returns "pending" when azimuth_deg is null', () => {
    expect(
      derivePlacementStatus({
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: null,
        tilt_deg: 5,
      })
    ).toBe('pending');
  });

  it('returns "pending" when tilt_deg is null', () => {
    expect(
      derivePlacementStatus({
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: null,
      })
    ).toBe('pending');
  });
});

describe('mintDeviceToken', () => {
  it('returns a hex token and its SHA-256 hash', () => {
    const { plaintext, hash } = mintDeviceToken();
    expect(plaintext).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(plaintext).not.toBe(hash);
  });

  it('generates a different token each call', () => {
    const a = mintDeviceToken();
    const b = mintDeviceToken();
    expect(a.plaintext).not.toBe(b.plaintext);
  });
});

describe('upsertCameraByClaimCode', () => {
  it('inserts a new row when no camera exists for the claim code', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // SELECT existing — none
      .mockResolvedValueOnce([
        {
          id: 17,
          claim_code: 'SUNSET-AAAA-BBBB',
          lat: 47.6,
          lng: -122.3,
          azimuth_deg: 270,
          tilt_deg: 5,
        },
      ]); // INSERT RETURNING

    const row = await upsertCameraByClaimCode('SUNSET-AAAA-BBBB', {
      lat: 47.6,
      lng: -122.3,
      timezone: 'America/Los_Angeles',
      azimuth_deg: 270,
      tilt_deg: 5,
      horizon_altitude_deg: 2.5,
      horizon_profile: [{ azimuth_deg: 0, altitude_deg: 1.2 }],
      phase_preference: 'sunset',
      delivery_preferences: { type: 'email', target: 'a@b.c', cadence: 'daily' },
    });

    expect(row.id).toBe(17);
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });

  it('updates the existing row when a camera already exists for the claim code', async () => {
    sqlMock
      .mockResolvedValueOnce([
        { id: 17, claim_code: 'SUNSET-AAAA-BBBB' },
      ]) // SELECT existing — found
      .mockResolvedValueOnce([
        {
          id: 17,
          claim_code: 'SUNSET-AAAA-BBBB',
          lat: 47.6,
          lng: -122.3,
          azimuth_deg: 270,
          tilt_deg: 5,
        },
      ]); // UPDATE RETURNING

    const row = await upsertCameraByClaimCode('SUNSET-AAAA-BBBB', {
      lat: 47.6,
      lng: -122.3,
      timezone: 'America/Los_Angeles',
      azimuth_deg: 270,
      tilt_deg: 5,
      horizon_altitude_deg: 2.5,
      horizon_profile: null,
      phase_preference: 'sunset',
      delivery_preferences: null,
    });

    expect(row.id).toBe(17);
    expect(sqlMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run app/lib/cameraRegistration.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helpers**

Create `app/lib/cameraRegistration.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '@/app/lib/db';

export type PlacementStatus = 'pending' | 'ready';

export type PlacementShape = {
  lat: number | null;
  lng: number | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
};

export function derivePlacementStatus(row: PlacementShape): PlacementStatus {
  if (row.lat == null) return 'pending';
  if (row.lng == null) return 'pending';
  if (row.azimuth_deg == null) return 'pending';
  if (row.tilt_deg == null) return 'pending';
  return 'ready';
}

export function mintDeviceToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(plaintext, 'utf8').digest('hex');
  return { plaintext, hash };
}

export type CameraUpsertInput = {
  lat: number | null;
  lng: number | null;
  elevation_m?: number | null;
  timezone: string | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  horizon_altitude_deg: number | null;
  horizon_profile: unknown;
  phase_preference: 'sunrise' | 'sunset' | 'both';
  delivery_preferences: unknown;
};

export type CameraRow = {
  id: number;
  claim_code: string;
  lat: number | null;
  lng: number | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
};

export async function upsertCameraByClaimCode(
  claimCode: string,
  input: CameraUpsertInput
): Promise<CameraRow> {
  const existing = (await sql`
    SELECT id FROM cameras WHERE claim_code = ${claimCode} LIMIT 1
  `) as { id: number }[];

  if (existing[0]) {
    const rows = (await sql`
      UPDATE cameras SET
        lat = ${input.lat},
        lng = ${input.lng},
        elevation_m = ${input.elevation_m ?? null},
        timezone = ${input.timezone},
        azimuth_deg = ${input.azimuth_deg},
        tilt_deg = ${input.tilt_deg},
        horizon_altitude_deg = ${input.horizon_altitude_deg},
        horizon_profile = ${JSON.stringify(input.horizon_profile)}::jsonb,
        phase_preference = ${input.phase_preference},
        delivery_preferences = ${JSON.stringify(input.delivery_preferences)}::jsonb
      WHERE id = ${existing[0].id}
      RETURNING id, claim_code, lat, lng, azimuth_deg, tilt_deg
    `) as CameraRow[];
    return rows[0];
  }

  // Pre-register-first: insert a row with placement + sentinel device fields.
  // hardware_id and device_token_hash are filled in by the device's later
  // register call (Task 6). We use sentinel placeholders so the existing
  // NOT NULL constraint holds; register replaces them atomically.
  const sentinelToken = `pending-${claimCode}`;
  const rows = (await sql`
    INSERT INTO cameras (
      hardware_id, device_token_hash, claim_code,
      lat, lng, elevation_m, timezone,
      azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
      phase_preference, delivery_preferences
    )
    VALUES (
      ${sentinelToken}, ${sentinelToken}, ${claimCode},
      ${input.lat}, ${input.lng}, ${input.elevation_m ?? null}, ${input.timezone},
      ${input.azimuth_deg}, ${input.tilt_deg}, ${input.horizon_altitude_deg}, ${JSON.stringify(input.horizon_profile)}::jsonb,
      ${input.phase_preference}, ${JSON.stringify(input.delivery_preferences)}::jsonb
    )
    RETURNING id, claim_code, lat, lng, azimuth_deg, tilt_deg
  `) as CameraRow[];
  return rows[0];
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run app/lib/cameraRegistration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/cameraRegistration.ts app/lib/cameraRegistration.test.ts
git commit -m "feat(cameras): placement-status + either-order upsert helpers"
```

---

## Task 5: Pre-register endpoint

POST `/api/cameras/pre-register`. No device auth — the claim code in the body is the bearer. Stores placement on the cameras row, creating or updating based on whether the device has registered yet.

**Files:**
- Create: `app/api/cameras/pre-register/route.ts`
- Test: `app/api/cameras/pre-register/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/cameras/pre-register/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaimCodeMock = vi.fn();
const upsertCameraByClaimCodeMock = vi.fn();
vi.mock('@/app/lib/cameraClaimCode', () => ({
  getClaimCode: (...args: unknown[]) => getClaimCodeMock(...args),
}));
vi.mock('@/app/lib/cameraRegistration', () => ({
  upsertCameraByClaimCode: (...args: unknown[]) =>
    upsertCameraByClaimCodeMock(...args),
}));

import { POST } from './route';

beforeEach(() => {
  getClaimCodeMock.mockReset();
  upsertCameraByClaimCodeMock.mockReset();
});

const VALID_BODY = {
  claim_code: 'SUNSET-AAAA-BBBB',
  lat: 47.6062,
  lng: -122.3321,
  elevation_m: 30,
  timezone: 'America/Los_Angeles',
  placement: {
    azimuth_deg: 270,
    tilt_deg: 5,
    horizon_altitude_deg: 2.5,
    horizon_profile: [{ azimuth_deg: 0, altitude_deg: 1.2 }],
  },
  operator_preferences: {
    phase_preference: 'sunset',
    delivery: { type: 'email', target: 'op@example.com', cadence: 'daily' },
  },
};

function makeRequest(body: unknown) {
  return new Request('http://test/api/cameras/pre-register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/cameras/pre-register', () => {
  it('accepts a valid pre-register call and calls upsert', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 17,
      claim_code: 'SUNSET-AAAA-BBBB',
      lat: 47.6062,
      lng: -122.3321,
      azimuth_deg: 270,
      tilt_deg: 5,
    });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.camera_id).toBe(17);
    expect(body.placement_status).toBe('ready');
    expect(upsertCameraByClaimCodeMock).toHaveBeenCalledOnce();
  });

  it('rejects when claim code is unknown', async () => {
    getClaimCodeMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(404);
    expect(upsertCameraByClaimCodeMock).not.toHaveBeenCalled();
  });

  it('rejects when claim code is expired', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2020-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(410);
    expect(upsertCameraByClaimCodeMock).not.toHaveBeenCalled();
  });

  it('accepts when the device has already registered (either-order)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 17,
    });
    upsertCameraByClaimCodeMock.mockResolvedValueOnce({
      id: 17,
      claim_code: 'SUNSET-AAAA-BBBB',
      lat: 47.6062,
      lng: -122.3321,
      azimuth_deg: 270,
      tilt_deg: 5,
    });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(202);
    expect(upsertCameraByClaimCodeMock).toHaveBeenCalledOnce();
  });

  it('rejects when required fields are missing', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const bad = { ...VALID_BODY, lat: undefined };
    const res = await POST(makeRequest(bad));
    expect(res.status).toBe(400);
    expect(upsertCameraByClaimCodeMock).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON body', async () => {
    const req = new Request('http://test/api/cameras/pre-register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run app/api/cameras/pre-register/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the route**

Create `app/api/cameras/pre-register/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getClaimCode } from '@/app/lib/cameraClaimCode';
import {
  upsertCameraByClaimCode,
  derivePlacementStatus,
} from '@/app/lib/cameraRegistration';

export const dynamic = 'force-dynamic';

type Body = {
  claim_code?: unknown;
  lat?: unknown;
  lng?: unknown;
  elevation_m?: unknown;
  timezone?: unknown;
  placement?: {
    azimuth_deg?: unknown;
    tilt_deg?: unknown;
    horizon_altitude_deg?: unknown;
    horizon_profile?: unknown;
  };
  operator_preferences?: {
    phase_preference?: unknown;
    delivery?: unknown;
  };
};

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const claimCode = asString(body.claim_code);
  if (!claimCode) {
    return NextResponse.json({ error: 'claim_code is required' }, { status: 400 });
  }

  const lat = asNumber(body.lat);
  const lng = asNumber(body.lng);
  const timezone = asString(body.timezone);
  const azimuth = asNumber(body.placement?.azimuth_deg);
  const tilt = asNumber(body.placement?.tilt_deg);
  if (lat == null || lng == null || !timezone || azimuth == null || tilt == null) {
    return NextResponse.json(
      { error: 'lat, lng, timezone, placement.azimuth_deg and placement.tilt_deg are required' },
      { status: 400 }
    );
  }

  const phaseRaw = asString(body.operator_preferences?.phase_preference);
  const phase =
    phaseRaw === 'sunrise' || phaseRaw === 'sunset' || phaseRaw === 'both'
      ? phaseRaw
      : null;
  if (!phase) {
    return NextResponse.json(
      { error: 'operator_preferences.phase_preference must be sunrise|sunset|both' },
      { status: 400 }
    );
  }

  const claim = await getClaimCode(claimCode);
  if (!claim) {
    return NextResponse.json({ error: 'unknown claim code' }, { status: 404 });
  }
  if (claim.expires_at.getTime() < Date.now()) {
    return NextResponse.json({ error: 'claim code expired' }, { status: 410 });
  }

  try {
    const camera = await upsertCameraByClaimCode(claimCode, {
      lat,
      lng,
      elevation_m: asNumber(body.elevation_m),
      timezone,
      azimuth_deg: azimuth,
      tilt_deg: tilt,
      horizon_altitude_deg: asNumber(body.placement?.horizon_altitude_deg) ?? 0,
      horizon_profile: body.placement?.horizon_profile ?? null,
      phase_preference: phase,
      delivery_preferences: body.operator_preferences?.delivery ?? null,
    });

    return NextResponse.json(
      {
        camera_id: camera.id,
        placement_status: derivePlacementStatus(camera),
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('[cameras/pre-register] failed:', error);
    return NextResponse.json(
      { error: 'internal server error', details: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run app/api/cameras/pre-register/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cameras/pre-register/route.ts app/api/cameras/pre-register/route.test.ts
git commit -m "feat(api): pre-register endpoint with either-order semantics"
```

---

## Task 6: Register endpoint

POST `/api/cameras/register`. Claim-code-authenticated. Consumes the claim, mints a device token, returns the token + placement_status. If pre-register populated placement first, the response includes the full placement block; otherwise placement_status is 'pending' and the device idles.

**Files:**
- Create: `app/api/cameras/register/route.ts`
- Test: `app/api/cameras/register/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/cameras/register/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaimCodeMock = vi.fn();
const consumeClaimCodeMock = vi.fn();
const sqlMock = vi.fn();
const mintDeviceTokenMock = vi.fn();
const derivePlacementStatusMock = vi.fn();

vi.mock('@/app/lib/cameraClaimCode', () => ({
  getClaimCode: (...a: unknown[]) => getClaimCodeMock(...a),
  consumeClaimCode: (...a: unknown[]) => consumeClaimCodeMock(...a),
}));
vi.mock('@/app/lib/cameraRegistration', () => ({
  mintDeviceToken: (...a: unknown[]) => mintDeviceTokenMock(...a),
  derivePlacementStatus: (...a: unknown[]) => derivePlacementStatusMock(...a),
}));
vi.mock('@/app/lib/db', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v),
}));

import { POST } from './route';

beforeEach(() => {
  getClaimCodeMock.mockReset();
  consumeClaimCodeMock.mockReset();
  sqlMock.mockReset();
  mintDeviceTokenMock.mockReset();
  derivePlacementStatusMock.mockReset();
  mintDeviceTokenMock.mockReturnValue({
    plaintext: 'plain-token-abc',
    hash: 'hash-abc',
  });
});

function makeRequest(body: unknown) {
  return new Request('http://test/api/cameras/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const REGISTER_BODY = {
  claim_code: 'SUNSET-AAAA-BBBB',
  hardware_id: 'rpi-serial-12345',
  capabilities: { mjpeg: false, edge_score: false },
  firmware_version: 'sunset-cam@0.1.0',
};

describe('POST /api/cameras/register', () => {
  it('returns placement=ready when pre-register populated placement first', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    // SELECT existing camera by claim_code → found (pre-register created it)
    sqlMock.mockResolvedValueOnce([
      {
        id: 17,
        lat: 47.6,
        lng: -122.3,
        elevation_m: 30,
        timezone: 'America/Los_Angeles',
        azimuth_deg: 270,
        tilt_deg: 5,
        horizon_altitude_deg: 2.5,
        horizon_profile: [{ azimuth_deg: 0, altitude_deg: 1.2 }],
        phase_preference: 'sunset',
        delivery_preferences: { type: 'email' },
      },
    ]);
    // UPDATE cameras: fill in hardware_id, device_token_hash, capabilities
    sqlMock.mockResolvedValueOnce([{ id: 17 }]);
    consumeClaimCodeMock.mockResolvedValueOnce({ consumed_by_camera_id: 17 });
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.camera_id).toBe(17);
    expect(body.device_token).toBe('plain-token-abc');
    expect(body.placement_status).toBe('ready');
    expect(body.placement).toMatchObject({
      azimuth_deg: 270,
      tilt_deg: 5,
    });
  });

  it('returns placement=pending when device registers first (no prior pre-register)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    // SELECT existing camera by claim_code → none
    sqlMock.mockResolvedValueOnce([]);
    // INSERT cameras with sentinel placement
    sqlMock.mockResolvedValueOnce([{ id: 18 }]);
    consumeClaimCodeMock.mockResolvedValueOnce({ consumed_by_camera_id: 18 });
    derivePlacementStatusMock.mockReturnValueOnce('pending');

    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.camera_id).toBe(18);
    expect(body.device_token).toBe('plain-token-abc');
    expect(body.placement_status).toBe('pending');
    expect(body.placement).toBeUndefined();
  });

  it('rejects unknown claim codes with 404', async () => {
    getClaimCodeMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(404);
  });

  it('rejects expired claim codes with 410', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2020-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(410);
  });

  it('rejects already-consumed claim codes with 409', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 1,
    });
    const res = await POST(makeRequest(REGISTER_BODY));
    expect(res.status).toBe(409);
  });

  it('rejects missing hardware_id with 400', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    const res = await POST(makeRequest({ ...REGISTER_BODY, hardware_id: '' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run app/api/cameras/register/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the route**

Create `app/api/cameras/register/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { getClaimCode, consumeClaimCode } from '@/app/lib/cameraClaimCode';
import {
  mintDeviceToken,
  derivePlacementStatus,
} from '@/app/lib/cameraRegistration';

export const dynamic = 'force-dynamic';

type Body = {
  claim_code?: unknown;
  hardware_id?: unknown;
  capabilities?: unknown;
  firmware_version?: unknown;
};

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

type ExistingCameraRow = {
  id: number;
  lat: number | null;
  lng: number | null;
  elevation_m: number | null;
  timezone: string | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  horizon_altitude_deg: number | null;
  horizon_profile: unknown;
  phase_preference: string;
  delivery_preferences: unknown;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const claimCode = asString(body.claim_code);
  const hardwareId = asString(body.hardware_id);
  if (!claimCode || !hardwareId) {
    return NextResponse.json(
      { error: 'claim_code and hardware_id are required' },
      { status: 400 }
    );
  }

  const claim = await getClaimCode(claimCode);
  if (!claim) {
    return NextResponse.json({ error: 'unknown claim code' }, { status: 404 });
  }
  if (claim.expires_at.getTime() < Date.now()) {
    return NextResponse.json({ error: 'claim code expired' }, { status: 410 });
  }
  if (claim.consumed_at) {
    return NextResponse.json({ error: 'claim code already consumed' }, { status: 409 });
  }

  const { plaintext, hash } = mintDeviceToken();
  const firmwareVersion = asString(body.firmware_version);
  const capabilities = JSON.stringify(body.capabilities ?? {});

  try {
    const existingRows = (await sql`
      SELECT id, lat, lng, elevation_m, timezone,
             azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
             phase_preference, delivery_preferences
      FROM cameras WHERE claim_code = ${claimCode} LIMIT 1
    `) as ExistingCameraRow[];

    let cameraId: number;
    let placementRow: ExistingCameraRow;

    if (existingRows[0]) {
      // Pre-register-first path: row exists with placement; fill in device fields.
      const r = existingRows[0];
      const updated = (await sql`
        UPDATE cameras SET
          hardware_id = ${hardwareId},
          device_token_hash = ${hash},
          firmware_version = ${firmwareVersion},
          capabilities = ${capabilities}::jsonb,
          registered_at = NOW()
        WHERE id = ${r.id}
        RETURNING id
      `) as { id: number }[];
      cameraId = updated[0].id;
      placementRow = r;
    } else {
      // Register-first path: insert a row with no placement; pre-register
      // will fill it in later.
      const inserted = (await sql`
        INSERT INTO cameras (
          hardware_id, device_token_hash, claim_code,
          firmware_version, capabilities,
          phase_preference
        )
        VALUES (
          ${hardwareId}, ${hash}, ${claimCode},
          ${firmwareVersion}, ${capabilities}::jsonb,
          'both'
        )
        RETURNING id, lat, lng, elevation_m, timezone,
                  azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
                  phase_preference, delivery_preferences
      `) as ExistingCameraRow[];
      cameraId = inserted[0].id;
      placementRow = inserted[0];
    }

    await consumeClaimCode(claimCode, cameraId);

    const status = derivePlacementStatus(placementRow);
    const responseBody: Record<string, unknown> = {
      camera_id: cameraId,
      device_token: plaintext,
      placement_status: status,
    };
    if (status === 'ready') {
      responseBody.placement = {
        lat: placementRow.lat,
        lng: placementRow.lng,
        elevation_m: placementRow.elevation_m,
        timezone: placementRow.timezone,
        azimuth_deg: placementRow.azimuth_deg,
        tilt_deg: placementRow.tilt_deg,
        horizon_altitude_deg: placementRow.horizon_altitude_deg,
        horizon_profile: placementRow.horizon_profile,
        phase_preference: placementRow.phase_preference,
        delivery_preferences: placementRow.delivery_preferences,
      };
    }
    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('[cameras/register] failed:', error);
    return NextResponse.json(
      { error: 'internal server error', details: error instanceof Error ? error.message : 'unknown' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run app/api/cameras/register/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/cameras/register/route.ts app/api/cameras/register/route.test.ts
git commit -m "feat(api): register endpoint with either-order claim consumption"
```

---

## Task 7: Heartbeat endpoint with placement delivery

POST `/api/cameras/[id]/heartbeat`. Device-auth via `verifyDeviceToken`. Updates `last_heartbeat_at`. Response carries placement if the row is now `ready` and the device requested it. We use a request flag `request_placement: true` so the device only takes the bandwidth hit when it's actually idling waiting for placement.

**Files:**
- Create: `app/api/cameras/[id]/heartbeat/route.ts`
- Test: `app/api/cameras/[id]/heartbeat/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/cameras/[id]/heartbeat/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyDeviceTokenMock = vi.fn();
const sqlMock = vi.fn();
const derivePlacementStatusMock = vi.fn();

vi.mock('@/app/lib/cameraAuth', () => ({
  verifyDeviceToken: (...a: unknown[]) => verifyDeviceTokenMock(...a),
}));
vi.mock('@/app/lib/cameraRegistration', () => ({
  derivePlacementStatus: (...a: unknown[]) => derivePlacementStatusMock(...a),
}));
vi.mock('@/app/lib/db', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v),
}));

import { POST } from './route';

beforeEach(() => {
  verifyDeviceTokenMock.mockReset();
  sqlMock.mockReset();
  derivePlacementStatusMock.mockReset();
});

function makeRequest(opts: { id?: string; bearer?: string; body?: unknown }) {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Request(`http://test/api/cameras/${opts.id ?? '42'}/heartbeat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? { uptime_s: 600 }),
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/cameras/[id]/heartbeat', () => {
  it('rejects unauthenticated requests with 401', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce(null);
    const res = await POST(
      makeRequest({ id: '42', bearer: 'bad' }),
      makeContext('42')
    );
    expect(res.status).toBe(401);
  });

  it('updates last_heartbeat_at and returns 200 with no placement when not requested', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    sqlMock.mockResolvedValueOnce([]); // UPDATE last_heartbeat_at (returns nothing meaningful here)
    const res = await POST(
      makeRequest({ id: '42', bearer: 'good', body: { uptime_s: 600 } }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placement).toBeUndefined();
    expect(body.placement_status).toBeUndefined();
  });

  it('returns placement when device requests it and row is ready', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    sqlMock.mockResolvedValueOnce([]); // UPDATE
    sqlMock.mockResolvedValueOnce([
      {
        lat: 47.6,
        lng: -122.3,
        elevation_m: 30,
        timezone: 'America/Los_Angeles',
        azimuth_deg: 270,
        tilt_deg: 5,
        horizon_altitude_deg: 2.5,
        horizon_profile: [{ azimuth_deg: 0, altitude_deg: 1.2 }],
        phase_preference: 'sunset',
        delivery_preferences: null,
      },
    ]);
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(
      makeRequest({
        id: '42',
        bearer: 'good',
        body: { uptime_s: 600, request_placement: true },
      }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placement_status).toBe('ready');
    expect(body.placement).toMatchObject({ azimuth_deg: 270, tilt_deg: 5 });
  });

  it('returns placement_status=pending without placement when not yet ready', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42, status: 'active' });
    sqlMock.mockResolvedValueOnce([]); // UPDATE
    sqlMock.mockResolvedValueOnce([
      {
        lat: null,
        lng: null,
        elevation_m: null,
        timezone: null,
        azimuth_deg: null,
        tilt_deg: null,
        horizon_altitude_deg: null,
        horizon_profile: null,
        phase_preference: 'both',
        delivery_preferences: null,
      },
    ]);
    derivePlacementStatusMock.mockReturnValueOnce('pending');

    const res = await POST(
      makeRequest({
        id: '42',
        bearer: 'good',
        body: { uptime_s: 600, request_placement: true },
      }),
      makeContext('42')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.placement_status).toBe('pending');
    expect(body.placement).toBeUndefined();
  });

  it('returns 400 on invalid camera id', async () => {
    const res = await POST(
      makeRequest({ id: 'abc', bearer: 'good' }),
      makeContext('abc')
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run app/api/cameras/[id]/heartbeat/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the route**

Create `app/api/cameras/[id]/heartbeat/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { verifyDeviceToken } from '@/app/lib/cameraAuth';
import { derivePlacementStatus } from '@/app/lib/cameraRegistration';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

type Body = {
  uptime_s?: unknown;
  request_placement?: unknown;
};

type PlacementRow = {
  lat: number | null;
  lng: number | null;
  elevation_m: number | null;
  timezone: string | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
  horizon_altitude_deg: number | null;
  horizon_profile: unknown;
  phase_preference: string;
  delivery_preferences: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const cameraId = Number.parseInt(id, 10);
  if (!Number.isFinite(cameraId) || cameraId <= 0) {
    return NextResponse.json({ error: 'invalid camera id' }, { status: 400 });
  }

  const camera = await verifyDeviceToken(cameraId, request.headers.get('authorization'));
  if (!camera) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // Empty body is acceptable for heartbeat — treat as {}.
  }

  await sql`
    UPDATE cameras SET last_heartbeat_at = NOW() WHERE id = ${cameraId}
  `;

  if (body.request_placement !== true) {
    return NextResponse.json({ acknowledged_at: new Date().toISOString() });
  }

  const rows = (await sql`
    SELECT lat, lng, elevation_m, timezone,
           azimuth_deg, tilt_deg, horizon_altitude_deg, horizon_profile,
           phase_preference, delivery_preferences
    FROM cameras WHERE id = ${cameraId} LIMIT 1
  `) as PlacementRow[];

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: 'camera vanished' }, { status: 404 });
  }

  const status = derivePlacementStatus(row);
  if (status === 'pending') {
    return NextResponse.json({
      acknowledged_at: new Date().toISOString(),
      placement_status: 'pending',
    });
  }

  return NextResponse.json({
    acknowledged_at: new Date().toISOString(),
    placement_status: 'ready',
    placement: {
      lat: row.lat,
      lng: row.lng,
      elevation_m: row.elevation_m,
      timezone: row.timezone,
      azimuth_deg: row.azimuth_deg,
      tilt_deg: row.tilt_deg,
      horizon_altitude_deg: row.horizon_altitude_deg,
      horizon_profile: row.horizon_profile,
      phase_preference: row.phase_preference,
      delivery_preferences: row.delivery_preferences,
    },
  });
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run app/api/cameras/[id]/heartbeat/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'app/api/cameras/[id]/heartbeat/route.ts' 'app/api/cameras/[id]/heartbeat/route.test.ts'
git commit -m "feat(api): heartbeat endpoint with placement delivery"
```

---

## Task 8: Setup-status endpoint

GET `/api/cameras/setup-status/[claim_code]`. Polled by the cloud wizard during onboarding. No device-token auth — the claim code in the URL is the bearer. Returns one of `awaiting_wifi`, `registered`, `ready`.

**Files:**
- Create: `app/api/cameras/setup-status/[claim_code]/route.ts`
- Test: `app/api/cameras/setup-status/[claim_code]/route.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/api/cameras/setup-status/[claim_code]/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getClaimCodeMock = vi.fn();
const sqlMock = vi.fn();
const derivePlacementStatusMock = vi.fn();

vi.mock('@/app/lib/cameraClaimCode', () => ({
  getClaimCode: (...a: unknown[]) => getClaimCodeMock(...a),
}));
vi.mock('@/app/lib/cameraRegistration', () => ({
  derivePlacementStatus: (...a: unknown[]) => derivePlacementStatusMock(...a),
}));
vi.mock('@/app/lib/db', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v),
}));

import { GET } from './route';

beforeEach(() => {
  getClaimCodeMock.mockReset();
  sqlMock.mockReset();
  derivePlacementStatusMock.mockReset();
});

function makeRequest(code: string) {
  return new Request(`http://test/api/cameras/setup-status/${code}`, { method: 'GET' });
}

function makeContext(claim_code: string) {
  return { params: Promise.resolve({ claim_code }) };
}

describe('GET /api/cameras/setup-status/[claim_code]', () => {
  it('returns 404 when the claim code does not exist', async () => {
    getClaimCodeMock.mockResolvedValueOnce(null);
    const res = await GET(makeRequest('SUNSET-XXXX-YYYY'), makeContext('SUNSET-XXXX-YYYY'));
    expect(res.status).toBe(404);
  });

  it('returns awaiting_wifi when no cameras row exists for the claim code yet', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    sqlMock.mockResolvedValueOnce([]); // SELECT cameras → none
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('awaiting_wifi');
  });

  it('returns awaiting_wifi when a pre-register-only row exists (no real device_token_hash)', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: null,
      consumed_by_camera_id: null,
    });
    sqlMock.mockResolvedValueOnce([
      {
        id: 17,
        hardware_id: 'pending-SUNSET-AAAA-BBBB',
        device_token_hash: 'pending-SUNSET-AAAA-BBBB',
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: 5,
      },
    ]);
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('awaiting_wifi');
  });

  it('returns registered when device has registered but placement is still pending', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 17,
    });
    sqlMock.mockResolvedValueOnce([
      {
        id: 17,
        hardware_id: 'rpi-real-serial',
        device_token_hash: 'real-hash-abc',
        lat: null,
        lng: null,
        azimuth_deg: null,
        tilt_deg: null,
      },
    ]);
    derivePlacementStatusMock.mockReturnValueOnce('pending');
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('registered');
  });

  it('returns ready when device is registered AND placement is populated', async () => {
    getClaimCodeMock.mockResolvedValueOnce({
      code: 'SUNSET-AAAA-BBBB',
      expires_at: new Date('2099-01-01'),
      consumed_at: new Date(),
      consumed_by_camera_id: 17,
    });
    sqlMock.mockResolvedValueOnce([
      {
        id: 17,
        hardware_id: 'rpi-real-serial',
        device_token_hash: 'real-hash-abc',
        lat: 47.6,
        lng: -122.3,
        azimuth_deg: 270,
        tilt_deg: 5,
      },
    ]);
    derivePlacementStatusMock.mockReturnValueOnce('ready');
    const res = await GET(makeRequest('SUNSET-AAAA-BBBB'), makeContext('SUNSET-AAAA-BBBB'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ready');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run app/api/cameras/setup-status/[claim_code]/route.test.ts`
Expected: FAIL — `./route` does not exist.

- [ ] **Step 3: Implement the route**

Create `app/api/cameras/setup-status/[claim_code]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { getClaimCode } from '@/app/lib/cameraClaimCode';
import { derivePlacementStatus } from '@/app/lib/cameraRegistration';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ claim_code: string }> };

type StatusRow = {
  id: number;
  hardware_id: string;
  device_token_hash: string;
  lat: number | null;
  lng: number | null;
  azimuth_deg: number | null;
  tilt_deg: number | null;
};

export async function GET(_request: Request, context: RouteContext) {
  const { claim_code } = await context.params;
  const claim = await getClaimCode(claim_code);
  if (!claim) {
    return NextResponse.json({ error: 'unknown claim code' }, { status: 404 });
  }

  const rows = (await sql`
    SELECT id, hardware_id, device_token_hash, lat, lng, azimuth_deg, tilt_deg
    FROM cameras WHERE claim_code = ${claim_code} LIMIT 1
  `) as StatusRow[];

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ status: 'awaiting_wifi' });
  }

  // A pre-register-first row is identifiable by the sentinel placeholder
  // (see Task 4's upsert). Treat such rows as "device hasn't called register yet."
  const sentinel = `pending-${claim_code}`;
  if (row.hardware_id === sentinel || row.device_token_hash === sentinel) {
    return NextResponse.json({ status: 'awaiting_wifi' });
  }

  const placement = derivePlacementStatus(row);
  return NextResponse.json({
    status: placement === 'ready' ? 'ready' : 'registered',
  });
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run app/api/cameras/setup-status/[claim_code]/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'app/api/cameras/setup-status/[claim_code]/route.ts' 'app/api/cameras/setup-status/[claim_code]/route.test.ts'
git commit -m "feat(api): setup-status endpoint for wizard polling"
```

---

## Task 9: Run the full test suite

Confirm no regressions across the existing tests when the new endpoints land.

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: all green. If anything in `app/api/cameras/[id]/snapshot/route.test.ts` or `app/lib/customCameraState.test.ts` regresses, investigate before continuing — the new code should not touch those paths.

- [ ] **Step 2: Run the type checker**

Run: `npx tsc --noEmit`
Expected: 0 errors. Fix any type bleed-over before committing.

- [ ] **Step 3: No commit** — this is a verification step only.

---

## Task 10: Document the amendments in the protocol

Update `docs/device-protocol.md` so the wire contract reflects the either-order semantics, the `placement_status` field on the register response, and the optional `placement` block on heartbeat responses. The text changes are local — Amendments A, B, and C from the spec at `2026-05-15-wifi-onboarding-and-provisioning-design.md` §5.4.

**Files:**
- Modify: `docs/device-protocol.md`

- [ ] **Step 1: Locate the relevant sections**

The three locations:
- §6.2a (`/api/cameras/pre-register`) — currently says "submits placement + operator preferences before the device exists." Needs the either-order clarification.
- §6.2 (`/api/cameras/register`) — currently doesn't mention `placement_status` in the response shape. Needs adding.
- §6.4 (`/api/cameras/:id/heartbeat`) — needs the optional `placement` field on the response, gated on a `request_placement: true` flag in the request body.

Read the file to confirm exact line numbers in your working copy: `grep -n '^### 6\.' docs/device-protocol.md`.

- [ ] **Step 2: Update §6.2a (pre-register) — Amendment A**

Find the paragraph in §6.2a beginning "Called by the AR placement portal" and append:

```markdown
**Either-order semantics.** Pre-register may arrive either before or after the device's own `register` call. If pre-register arrives first, the server creates a `cameras` row with the placement and operator-preferences fields populated; `hardware_id` and `device_token_hash` are filled in atomically when `register` later runs. If `register` arrives first, the server creates a `cameras` row with the device fields populated and no placement; a subsequent `pre-register` call with the same `claim_code` matches that row and fills in placement. The device's next heartbeat returns the now-populated placement (see §6.4's `request_placement` flag).
```

- [ ] **Step 3: Update §6.2 (register) — Amendment B**

Find the response body example for `/api/cameras/register` and replace it with:

````markdown
```json
{
  "camera_id": 17,
  "device_token": "<64-char hex>",
  "placement_status": "ready",
  "placement": {
    "lat": 47.6062,
    "lng": -122.3321,
    "elevation_m": 30,
    "timezone": "America/Los_Angeles",
    "azimuth_deg": 270,
    "tilt_deg": 5,
    "horizon_altitude_deg": 2.5,
    "horizon_profile": [...],
    "phase_preference": "sunset",
    "delivery_preferences": { "type": "email", ... }
  }
}
```

`placement_status` is `"ready"` iff pre-register populated placement for this `claim_code` before this call. Otherwise it is `"pending"` and the `placement` field is omitted — the device should idle, heartbeat with `request_placement: true`, and start its capture loop once a heartbeat response delivers placement.
````

- [ ] **Step 4: Update §6.4 (heartbeat) — Amendment C**

In the §6.4 request body example, add the optional flag:

```json
{
  "uptime_s": 600,
  "request_placement": true
}
```

In the §6.4 response shape, document the new fields:

````markdown
**Optional placement delivery.** When the request includes `"request_placement": true`, the response carries `placement_status` and (if `ready`) the full `placement` block from §6.2's response. Devices in the `IDLE` post-register state set this flag on every heartbeat; devices in `ACTIVE` should omit it to save bandwidth.

```json
{
  "acknowledged_at": "2026-05-16T01:32:14.000Z",
  "placement_status": "ready",
  "placement": { ... }
}
```
````

- [ ] **Step 5: Commit**

```bash
git add docs/device-protocol.md
git commit -m "docs(protocol): amend register, pre-register, and heartbeat for either-order onboarding"
```

---

## Task 11: Manual end-to-end smoke test

Verify the endpoints work against a real local Next dev server and the dev/scratch DB. Not a unit test — a sanity ritual to confirm the pieces compose.

**Files:** none modified. This task captures evidence only.

- [ ] **Step 1: Apply the migration to your dev DB**

Run:
```bash
psql "$DATABASE_URL" -f database/migrations/20260516_cameras_either_order_registration.sql
```
Expected: no errors. `\d cameras` confirms the relaxed NOT NULLs.

- [ ] **Step 2: Start the Next dev server**

Run: `npm run dev`
Expected: listening on `http://localhost:3000`.

- [ ] **Step 3: Mint a claim code**

Run:
```bash
CRON_SECRET=<your value> curl -X POST http://localhost:3000/api/admin/claim-codes \
  -H "authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"label":"smoke-test"}'
```
Expected: `{"code":"SUNSET-XXXX-YYYY","expires_at":"..."}`. Capture the code into shell var `CODE`.

- [ ] **Step 4: Exercise the pre-register-first path**

```bash
curl -X POST http://localhost:3000/api/cameras/pre-register \
  -H "content-type: application/json" \
  -d "{\"claim_code\":\"$CODE\",\"lat\":47.6062,\"lng\":-122.3321,\"timezone\":\"America/Los_Angeles\",\"placement\":{\"azimuth_deg\":270,\"tilt_deg\":5,\"horizon_altitude_deg\":2.5,\"horizon_profile\":[]},\"operator_preferences\":{\"phase_preference\":\"sunset\",\"delivery\":null}}"
```
Expected: `202` with `{"camera_id":N,"placement_status":"ready"}`.

```bash
curl http://localhost:3000/api/cameras/setup-status/$CODE
```
Expected: `{"status":"awaiting_wifi"}` (the row exists but uses the pending sentinel for hardware_id/token).

```bash
curl -X POST http://localhost:3000/api/cameras/register \
  -H "content-type: application/json" \
  -d "{\"claim_code\":\"$CODE\",\"hardware_id\":\"smoke-rpi-1\",\"capabilities\":{}}"
```
Expected: `200` with `{"camera_id":N,"device_token":"...","placement_status":"ready","placement":{...}}`.

```bash
curl http://localhost:3000/api/cameras/setup-status/$CODE
```
Expected: `{"status":"ready"}`.

- [ ] **Step 5: Exercise the register-first path**

Mint a second claim code as in Step 3, save into `CODE2`. Then:

```bash
curl -X POST http://localhost:3000/api/cameras/register \
  -H "content-type: application/json" \
  -d "{\"claim_code\":\"$CODE2\",\"hardware_id\":\"smoke-rpi-2\",\"capabilities\":{}}"
```
Expected: `200` with `{"camera_id":M,"device_token":"...","placement_status":"pending"}`. Capture `device_token` into shell var `TOKEN`.

```bash
curl http://localhost:3000/api/cameras/setup-status/$CODE2
```
Expected: `{"status":"registered"}`.

```bash
curl -X POST http://localhost:3000/api/cameras/$M/heartbeat \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"uptime_s":600,"request_placement":true}'
```
Expected: `200` with `{"acknowledged_at":"...","placement_status":"pending"}`.

```bash
curl -X POST http://localhost:3000/api/cameras/pre-register \
  -H "content-type: application/json" \
  -d "{\"claim_code\":\"$CODE2\",\"lat\":47.6062,\"lng\":-122.3321,\"timezone\":\"America/Los_Angeles\",\"placement\":{\"azimuth_deg\":270,\"tilt_deg\":5,\"horizon_altitude_deg\":2.5,\"horizon_profile\":[]},\"operator_preferences\":{\"phase_preference\":\"sunset\",\"delivery\":null}}"
```
Expected: `202`.

```bash
curl -X POST http://localhost:3000/api/cameras/$M/heartbeat \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"uptime_s":700,"request_placement":true}'
```
Expected: `200` with `{"acknowledged_at":"...","placement_status":"ready","placement":{"azimuth_deg":270,...}}`.

- [ ] **Step 6: No commit** — this task is verification only.

If any step fails, halt and diagnose before continuing.

---

## Self-Review Notes

- **Spec coverage:**
  - Spec §5.4 Amendment A (either-order pre-register) — Tasks 4, 5, 6, plus Task 10 docs.
  - Spec §5.4 Amendment B (`placement_status` in register response) — Task 6, Task 10 docs.
  - Spec §5.4 Amendment C (heartbeat carries placement) — Task 7, Task 10 docs.
  - Spec §5.6 setup-status endpoint — Task 8.
  - Spec §5.2 sender-side provisioning, §5.3 device state machine, §5.5 captive portal mechanism — out of scope for this plan; deferred to firmware plan.
- **Placeholder scan:** every code step contains complete TypeScript or SQL. No "implement X later" steps. Each task has a commit step.
- **Type consistency:** `CameraRow` in `cameraRegistration.ts` vs `CameraRow` in `cameraAuth.ts` use different shapes — both modules export their own type. To avoid name collision in importers, anyone consuming both should alias on import.
- **Scope check:** all changes are in the parent repo, all built with Next/Vitest/Postgres, all testable together. Plan satisfies "produces working, testable software on its own" — the endpoints can be deployed and exercised independently of any firmware changes.
