# Tier 0 Cameras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the minimum end-to-end path from one Raspberry Pi Zero 2 W camera to the live mosaic on `sunrisesunset.studio` — schema, server endpoint, hand-created test camera, and firmware skeleton — so a single image captured by the Pi appears in the live mosaic within seconds.

**Architecture:** The Pi captures JPEGs at 1 fps inside a hardcoded UTC time window, attaches a static `device_token` from `config.json`, and POSTs each frame as `multipart/form-data` to `POST /api/cameras/:id/snapshot`. The Next.js endpoint authenticates the token against `cameras.device_token_hash`, uploads the bytes to Firebase Storage via `firebase-admin`, and writes a `webcam_snapshots` row. A paired `webcams` row (created by the seed script with `source='custom'` and `custom_camera_id` linkage) plus a `terminator_webcam_state` row with `active=true` make the camera visible to the existing mosaic query path with no frontend changes. None of the protocol's optional surfaces (registration, claim codes, heartbeat, edge ML, MJPEG, OTA, AR portal, operator delivery, signed-URL direct uploads) are built — the schema lands their columns but the code paths are deferred to Tier 1+.

**Tech Stack:** Next.js 15 App Router (TypeScript), Neon Postgres via `@neondatabase/serverless`, Firebase Storage via `firebase-admin`, Vitest for server tests. Firmware: Python 3.11+, `picamera2`, `requests`, `astral` (reserved for Tier 1; not used in v0), `pytest`. Systemd unit for auto-start. Two repos: parent (`the-sunset-webcam-map`) for server work, new repo `sunset-cam-firmware` for Pi work.

**Reference docs:**
- `docs/device-protocol.md` — wire contract (especially §6.4 snapshot endpoint, §10 schema)
- `pi-webcam-mvp.md` — hardware list and software stack
- `~/Documents/Claude Sessions/ongoing/sunset-pi-cameras.md` — decisions log

---

## File Structure

### Parent repo (`the-sunset-webcam-map`)

| File | Responsibility |
|---|---|
| `database/migrations/20260503_cameras_schema.sql` | Full §10 schema: `cameras`, `camera_claim_codes`, `webcams.source`, `webcams.custom_camera_id`, `webcam_snapshots.{edge_score,edge_model_version,window_id,is_window_winner}`. Single forward-only migration. |
| `database/seeds/tier0-test-camera.sql` | Idempotent SQL that hand-creates one custom camera row + paired webcams row + active terminator state row. Operator runs once, copies token + camera_id to firmware config. |
| `scripts/tier0-create-camera.sh` | Wrapper that generates a fresh random token, runs the seed SQL with placeholders substituted, and prints the plaintext token + camera_id for copy-paste into firmware config. |
| `app/lib/cameraAuth.ts` | `verifyDeviceToken(cameraId, bearerHeader)` — looks up `cameras.device_token_hash`, compares SHA-256 of the bearer to the stored hash, returns the camera row or null. |
| `app/lib/cameraAuth.test.ts` | Unit tests against a mocked `sql` template. |
| `app/lib/cameraSnapshot.ts` | `uploadCameraSnapshot(cameraId, imageBuffer, capturedAt)` — uploads to Firebase under `snapshots/custom/<cameraId>/<ts>.jpg`, returns `{url, path}`. `insertCameraSnapshotRow(...)` — writes one `webcam_snapshots` row with `edge_score`, `window_id`, etc. |
| `app/lib/cameraSnapshot.test.ts` | Unit tests with mocked Firebase + mocked sql. |
| `app/api/cameras/[id]/snapshot/route.ts` | Next.js App Router route: parses multipart, calls `verifyDeviceToken`, calls `uploadCameraSnapshot`, calls `insertCameraSnapshotRow`, returns `202 {snapshot_id, accepted_at}`. |
| `app/api/cameras/[id]/snapshot/route.test.ts` | Vitest tests with mocked deps for 401 / 404 / 413 / 202 / 400 paths. |
| `app/api/cron/update-windy/lib/dbOperations.ts` | **Modify only:** `deactivateMissingTerminatorState` JOINs to `webcams` and only deactivates rows where `webcams.source = 'windy'`, so custom cameras stay active across cron runs. |
| `app/api/cron/update-windy/lib/dbOperations.test.ts` | New file (none exists today). One unit test asserting the SQL excludes non-Windy webcams. |

### Firmware repo (`sunset-cam-firmware`, brand new)

| File | Responsibility |
|---|---|
| `README.md` | Quickstart: flash Pi, copy `config.json`, install systemd unit, watch logs. |
| `pyproject.toml` | Project metadata + dev deps for `pytest`, `responses`. |
| `requirements.txt` | Runtime deps: `requests`, `picamera2` (Pi-only — install via apt on device, skip on dev mac via `pip install --no-deps` strategy noted in README). |
| `config/config.example.json` | Template config. |
| `src/sunset_cam/__init__.py` | Empty package marker. |
| `src/sunset_cam/config.py` | `load_config(path)` → typed dict; validates required keys. |
| `src/sunset_cam/window.py` | `is_active_now(config, now_utc)` → bool. v0 reads hardcoded `capture_window_start_utc`/`capture_window_end_utc` ISO timestamps from config; no solar math (deferred to Tier 1). |
| `src/sunset_cam/capture.py` | `capture_jpeg() -> bytes`. Wraps `picamera2`. Importable on dev mac via lazy import; `picamera2` only loaded when `capture_jpeg()` runs. |
| `src/sunset_cam/upload.py` | `upload_snapshot(config, jpeg_bytes, captured_at)` → POST multipart to `{api_base}/api/cameras/{camera_id}/snapshot` with Bearer token. |
| `src/sunset_cam/main.py` | Main loop: load config, every second check window, capture + upload, log result. SIGINT → clean exit. |
| `tests/__init__.py` | Empty. |
| `tests/test_config.py` | Pure-function tests against fixture JSON. |
| `tests/test_window.py` | Pure-function tests of time-window math. |
| `tests/test_upload.py` | Uses `responses` to stub HTTP, asserts multipart shape + Bearer header. |
| `systemd/sunset-cam.service` | Systemd unit, restart-on-failure, runs as `pi` user with venv path baked in. |
| `scripts/install.sh` | Idempotent installer for a fresh Pi: apt deps, venv, systemd enable. |

---

## Task 1: Schema migration

**Files:**
- Create: `database/migrations/20260503_cameras_schema.sql`

- [ ] **Step 1: Write the migration SQL**

Create `database/migrations/20260503_cameras_schema.sql`:

```sql
-- Tier 0 cameras schema. Implements docs/device-protocol.md §10 in full so
-- later tiers (claim codes, heartbeat, edge ML, winner selection) do not
-- require additional migrations against the same tables.
--
-- Forward-only. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260503_cameras_schema.sql

-- 1. Single-use claim codes (table created now; admin endpoint is Tier 1).
CREATE TABLE IF NOT EXISTS camera_claim_codes (
  code TEXT PRIMARY KEY,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_camera_id INTEGER
);

CREATE INDEX IF NOT EXISTS camera_claim_codes_unconsumed_idx
  ON camera_claim_codes (code)
  WHERE consumed_at IS NULL;

-- 2. Custom edge cameras (the device-side primary key).
CREATE TABLE IF NOT EXISTS cameras (
  id SERIAL PRIMARY KEY,
  hardware_id TEXT NOT NULL UNIQUE,
  device_token_hash TEXT NOT NULL,
  webcam_id INTEGER,
  device_class TEXT NOT NULL DEFAULT 'rpi-zero-2w',
  firmware_version TEXT,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,

  lat NUMERIC(9,6) NOT NULL,
  lng NUMERIC(9,6) NOT NULL,
  elevation_m NUMERIC,
  timezone TEXT NOT NULL,
  location_source TEXT,

  azimuth_deg NUMERIC,
  tilt_deg NUMERIC,
  horizon_altitude_deg NUMERIC DEFAULT 0,
  horizon_profile JSONB,

  phase_preference TEXT NOT NULL DEFAULT 'both',
  delivery_preferences JSONB,

  status TEXT NOT NULL DEFAULT 'active',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cameras_status_idx ON cameras (status);
CREATE INDEX IF NOT EXISTS cameras_last_heartbeat_idx
  ON cameras (last_heartbeat_at DESC);

-- 3. Now that cameras exists, wire the FK from claim codes back to it.
ALTER TABLE camera_claim_codes
  DROP CONSTRAINT IF EXISTS camera_claim_codes_camera_fk;

ALTER TABLE camera_claim_codes
  ADD CONSTRAINT camera_claim_codes_camera_fk
  FOREIGN KEY (consumed_by_camera_id) REFERENCES cameras(id);

-- 4. Extend webcams with source discriminator + back-pointer.
ALTER TABLE webcams
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'windy';

ALTER TABLE webcams
  ADD COLUMN IF NOT EXISTS custom_camera_id INTEGER REFERENCES cameras(id);

CREATE INDEX IF NOT EXISTS webcams_source_idx ON webcams (source);

-- 5. Wire the cameras.webcam_id back-pointer (cycle resolved by adding it
--    after both tables exist).
ALTER TABLE cameras
  DROP CONSTRAINT IF EXISTS cameras_webcam_fk;

ALTER TABLE cameras
  ADD CONSTRAINT cameras_webcam_fk
  FOREIGN KEY (webcam_id) REFERENCES webcams(id);

-- 6. Extend webcam_snapshots with edge ML + window fields. Tier 0 only writes
--    edge_score (NULL for v0 firmware) and window_id; the rest are reserved.
ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS edge_score NUMERIC;

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS edge_model_version TEXT;

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS window_id TEXT;

ALTER TABLE webcam_snapshots
  ADD COLUMN IF NOT EXISTS is_window_winner BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS webcam_snapshots_window_id_idx
  ON webcam_snapshots (window_id);

CREATE INDEX IF NOT EXISTS webcam_snapshots_winners_idx
  ON webcam_snapshots (webcam_id, captured_at DESC)
  WHERE is_window_winner = TRUE;
```

- [ ] **Step 2: Apply against dev DB and verify tables**

Run:
```bash
psql "$DATABASE_URL" -f database/migrations/20260503_cameras_schema.sql
```

Expected: each `CREATE` / `ALTER` prints `CREATE TABLE`, `ALTER TABLE`, or `CREATE INDEX` (or `NOTICE` if already exists due to `IF NOT EXISTS`). No errors.

Verify:
```bash
psql "$DATABASE_URL" -c "\d cameras" -c "\d camera_claim_codes" -c "\d+ webcams" -c "\d+ webcam_snapshots"
```

Expected: `cameras` and `camera_claim_codes` tables exist with the columns above; `webcams` shows `source` and `custom_camera_id` columns; `webcam_snapshots` shows `edge_score`, `edge_model_version`, `window_id`, `is_window_winner` columns.

- [ ] **Step 3: Commit**

```bash
git add database/migrations/20260503_cameras_schema.sql
git commit -m "feat(db): add cameras schema (Tier 0)"
```

---

## Task 2: Source-scope the cron deactivation so custom cameras survive

**Why this task exists:** `update-windy` calls `deactivateMissingTerminatorState`, which today deactivates *every* `terminator_webcam_state` row not in the current Windy result set — regardless of `source`. Without this fix, the first Windy cron run after we seed our custom camera would set its `active = false` and remove it from the mosaic.

**Files:**
- Modify: `app/api/cron/update-windy/lib/dbOperations.ts`
- Create: `app/api/cron/update-windy/lib/dbOperations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/cron/update-windy/lib/dbOperations.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { deactivateMissingTerminatorState } from './dbOperations';

describe('deactivateMissingTerminatorState', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
  });

  it('only touches windy-sourced rows when active list is empty', async () => {
    await deactivateMissingTerminatorState('sunset', []);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?');
    expect(fullQuery).toMatch(/source\s*=\s*'windy'/);
  });

  it('only touches windy-sourced rows when an active list is provided', async () => {
    await deactivateMissingTerminatorState('sunrise', [42, 99]);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?');
    expect(fullQuery).toMatch(/source\s*=\s*'windy'/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/cron/update-windy/lib/dbOperations.test.ts`
Expected: FAIL — both assertions fail because the current SQL does not contain `source = 'windy'`.

- [ ] **Step 3: Apply the source filter**

Edit `app/api/cron/update-windy/lib/dbOperations.ts`. Replace the body of `deactivateMissingTerminatorState` with:

```ts
export async function deactivateMissingTerminatorState(
  phase: 'sunrise' | 'sunset',
  activeWebcamIds: number[]
): Promise<void> {
  if (activeWebcamIds.length === 0) {
    await sql`
      update terminator_webcam_state s
      set active = false, updated_at = now()
      from webcams w
      where s.webcam_id = w.id
        and w.source = 'windy'
        and s.phase = ${phase}
        and s.active = true
    `;
    return;
  }

  await sql`
    update terminator_webcam_state s
    set active = false, updated_at = now()
    from webcams w
    where s.webcam_id = w.id
      and w.source = 'windy'
      and s.phase = ${phase}
      and s.active = true
      and s.webcam_id <> all(${activeWebcamIds})
  `;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/api/cron/update-windy/lib/dbOperations.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-windy/lib/dbOperations.ts \
        app/api/cron/update-windy/lib/dbOperations.test.ts
git commit -m "fix(cron): scope terminator deactivation to windy-sourced webcams"
```

---

## Task 3: Bearer-token verification helper

**Files:**
- Create: `app/lib/cameraAuth.ts`
- Create: `app/lib/cameraAuth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/lib/cameraAuth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { verifyDeviceToken, hashDeviceToken } from './cameraAuth';

describe('hashDeviceToken', () => {
  it('produces a 64-char lowercase hex SHA-256', () => {
    const out = hashDeviceToken('hello');
    expect(out).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });
});

describe('verifyDeviceToken', () => {
  beforeEach(() => sqlMock.mockReset());

  it('returns null when authorization header is missing', async () => {
    const result = await verifyDeviceToken(42, null);
    expect(result).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns null when header does not start with Bearer', async () => {
    const result = await verifyDeviceToken(42, 'Basic abc');
    expect(result).toBeNull();
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns null when no camera row matches', async () => {
    sqlMock.mockResolvedValue([]);
    const result = await verifyDeviceToken(42, 'Bearer plaintext-token');
    expect(result).toBeNull();
  });

  it('returns null when camera is revoked', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 42,
        status: 'revoked',
        device_token_hash: hashDeviceToken('plaintext-token'),
      },
    ]);
    const result = await verifyDeviceToken(42, 'Bearer plaintext-token');
    expect(result).toBeNull();
  });

  it('returns the camera row when token hash matches and status is active', async () => {
    const row = {
      id: 42,
      status: 'active',
      device_token_hash: hashDeviceToken('plaintext-token'),
    };
    sqlMock.mockResolvedValue([row]);
    const result = await verifyDeviceToken(42, 'Bearer plaintext-token');
    expect(result).toEqual(row);
  });

  it('returns null when token hash mismatches', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 42,
        status: 'active',
        device_token_hash: hashDeviceToken('different-token'),
      },
    ]);
    const result = await verifyDeviceToken(42, 'Bearer plaintext-token');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/cameraAuth.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `cameraAuth.ts`**

Create `app/lib/cameraAuth.ts`:

```ts
import { createHash } from 'node:crypto';
import { sql } from '@/app/lib/db';

export type CameraRow = {
  id: number;
  status: string;
  device_token_hash: string;
};

export function hashDeviceToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

export async function verifyDeviceToken(
  cameraId: number,
  authorizationHeader: string | null
): Promise<CameraRow | null> {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  const expectedHash = hashDeviceToken(token);

  const rows = (await sql`
    SELECT id, status, device_token_hash
    FROM cameras
    WHERE id = ${cameraId}
    LIMIT 1
  `) as CameraRow[];

  const row = rows[0];
  if (!row) return null;
  if (row.status !== 'active') return null;
  if (row.device_token_hash !== expectedHash) return null;

  return row;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/cameraAuth.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add app/lib/cameraAuth.ts app/lib/cameraAuth.test.ts
git commit -m "feat(api): device-token verification helper for cameras"
```

---

## Task 4: Camera snapshot helpers (Firebase upload + DB insert)

**Files:**
- Create: `app/lib/cameraSnapshot.ts`
- Create: `app/lib/cameraSnapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/lib/cameraSnapshot.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const saveMock = vi.fn();
const makePublicMock = vi.fn();
const fileMock = vi.fn(() => ({ save: saveMock, makePublic: makePublicMock }));
const bucketMock = { name: 'sunrisesunset-32a25.firebasestorage.app', file: fileMock };

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

vi.mock('@/app/lib/firebase', () => ({
  getFirebaseBucket: () => bucketMock,
}));

import {
  uploadCameraSnapshot,
  insertCameraSnapshotRow,
} from './cameraSnapshot';

describe('uploadCameraSnapshot', () => {
  beforeEach(() => {
    saveMock.mockReset().mockResolvedValue(undefined);
    makePublicMock.mockReset().mockResolvedValue(undefined);
    fileMock.mockClear();
  });

  it('uploads to snapshots/custom/<id>/<ts>.jpg and returns public url', async () => {
    const buf = Buffer.from('fake-jpeg');
    const ts = new Date('2026-05-03T01:32:14.000Z');
    const result = await uploadCameraSnapshot(42, buf, ts);

    expect(fileMock).toHaveBeenCalledWith(
      `snapshots/custom/42/${ts.getTime()}.jpg`
    );
    expect(saveMock).toHaveBeenCalledWith(
      buf,
      expect.objectContaining({
        metadata: expect.objectContaining({ contentType: 'image/jpeg' }),
      })
    );
    expect(makePublicMock).toHaveBeenCalled();
    expect(result.path).toBe(`snapshots/custom/42/${ts.getTime()}.jpg`);
    expect(result.url).toBe(
      `https://storage.googleapis.com/${bucketMock.name}/${result.path}`
    );
  });
});

describe('insertCameraSnapshotRow', () => {
  beforeEach(() => sqlMock.mockReset());

  it('inserts a webcam_snapshots row and returns the id', async () => {
    sqlMock.mockResolvedValue([{ id: 12345 }]);

    const id = await insertCameraSnapshotRow({
      webcamId: 10042,
      phase: 'sunset',
      capturedAt: new Date('2026-05-03T01:32:14.000Z'),
      firebaseUrl: 'https://example.com/x.jpg',
      firebasePath: 'snapshots/custom/42/1.jpg',
      windowId: '2026-05-03-sunset-cam42',
      edgeScore: null,
      edgeModelVersion: null,
    });

    expect(id).toBe(12345);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?');
    expect(fullQuery).toMatch(/INSERT INTO webcam_snapshots/i);
    expect(values).toContain(10042);
    expect(values).toContain('sunset');
    expect(values).toContain('2026-05-03-sunset-cam42');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/lib/cameraSnapshot.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `cameraSnapshot.ts`**

Create `app/lib/cameraSnapshot.ts`:

```ts
import { sql } from '@/app/lib/db';
import { getFirebaseBucket } from '@/app/lib/firebase';

export async function uploadCameraSnapshot(
  cameraId: number,
  imageBuffer: Buffer,
  capturedAt: Date
): Promise<{ url: string; path: string }> {
  const bucket = getFirebaseBucket();
  const path = `snapshots/custom/${cameraId}/${capturedAt.getTime()}.jpg`;
  const file = bucket.file(path);

  await file.save(imageBuffer, {
    metadata: {
      contentType: 'image/jpeg',
      metadata: {
        cameraId: String(cameraId),
        capturedAt: capturedAt.toISOString(),
        source: 'custom',
      },
    },
  });

  await file.makePublic();

  const url = `https://storage.googleapis.com/${bucket.name}/${path}`;
  return { url, path };
}

export interface InsertCameraSnapshotInput {
  webcamId: number;
  phase: 'sunrise' | 'sunset';
  capturedAt: Date;
  firebaseUrl: string;
  firebasePath: string;
  windowId: string;
  edgeScore: number | null;
  edgeModelVersion: string | null;
}

export async function insertCameraSnapshotRow(
  input: InsertCameraSnapshotInput
): Promise<number> {
  const rows = (await sql`
    INSERT INTO webcam_snapshots (
      webcam_id,
      phase,
      firebase_url,
      firebase_path,
      captured_at,
      window_id,
      edge_score,
      edge_model_version
    )
    VALUES (
      ${input.webcamId},
      ${input.phase},
      ${input.firebaseUrl},
      ${input.firebasePath},
      ${input.capturedAt.toISOString()},
      ${input.windowId},
      ${input.edgeScore},
      ${input.edgeModelVersion}
    )
    RETURNING id
  `) as { id: number }[];

  return rows[0].id;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/lib/cameraSnapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/cameraSnapshot.ts app/lib/cameraSnapshot.test.ts
git commit -m "feat(api): firebase upload + db insert helpers for camera snapshots"
```

---

## Task 5: `POST /api/cameras/[id]/snapshot` route

**Files:**
- Create: `app/api/cameras/[id]/snapshot/route.ts`
- Create: `app/api/cameras/[id]/snapshot/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/api/cameras/[id]/snapshot/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyDeviceTokenMock = vi.fn();
const uploadCameraSnapshotMock = vi.fn();
const insertCameraSnapshotRowMock = vi.fn();
const sqlMock = vi.fn();

vi.mock('@/app/lib/cameraAuth', () => ({
  verifyDeviceToken: verifyDeviceTokenMock,
}));
vi.mock('@/app/lib/cameraSnapshot', () => ({
  uploadCameraSnapshot: uploadCameraSnapshotMock,
  insertCameraSnapshotRow: insertCameraSnapshotRowMock,
}));
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { POST } from './route';

const MAX_BYTES = 5 * 1024 * 1024;

function makeRequest(opts: {
  bearer?: string;
  imageBytes?: Buffer;
  fields?: Record<string, string>;
}) {
  const form = new FormData();
  const fields = {
    captured_at: '2026-05-03T01:32:14.000Z',
    phase: 'sunset',
    window_id: '2026-05-03-sunset-cam42',
    ...(opts.fields ?? {}),
  };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  if (opts.imageBytes) {
    form.append(
      'image',
      new Blob([opts.imageBytes], { type: 'image/jpeg' }),
      'frame.jpg'
    );
  }
  const headers: HeadersInit = {};
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Request('http://test/api/cameras/42/snapshot', {
    method: 'POST',
    body: form,
    headers,
  });
}

describe('POST /api/cameras/[id]/snapshot', () => {
  beforeEach(() => {
    verifyDeviceTokenMock.mockReset();
    uploadCameraSnapshotMock.mockReset();
    insertCameraSnapshotRowMock.mockReset();
    sqlMock.mockReset();
  });

  it('returns 401 when token verification fails', async () => {
    verifyDeviceTokenMock.mockResolvedValue(null);
    const req = makeRequest({
      bearer: 'bad',
      imageBytes: Buffer.from('jpeg'),
    });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });
    expect(res.status).toBe(401);
  });

  it('returns 400 when image field is missing', async () => {
    verifyDeviceTokenMock.mockResolvedValue({ id: 42, status: 'active' });
    sqlMock.mockResolvedValue([{ webcam_id: 10042 }]);
    const req = makeRequest({ bearer: 'good' });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });
    expect(res.status).toBe(400);
  });

  it('returns 413 when image exceeds 5MB', async () => {
    verifyDeviceTokenMock.mockResolvedValue({ id: 42, status: 'active' });
    sqlMock.mockResolvedValue([{ webcam_id: 10042 }]);
    const big = Buffer.alloc(MAX_BYTES + 1, 0);
    const req = makeRequest({ bearer: 'good', imageBytes: big });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });
    expect(res.status).toBe(413);
  });

  it('returns 404 when camera has no paired webcam_id', async () => {
    verifyDeviceTokenMock.mockResolvedValue({ id: 42, status: 'active' });
    sqlMock.mockResolvedValue([{ webcam_id: null }]);
    const req = makeRequest({
      bearer: 'good',
      imageBytes: Buffer.from('jpeg'),
    });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });
    expect(res.status).toBe(404);
  });

  it('returns 202 with snapshot_id on success', async () => {
    verifyDeviceTokenMock.mockResolvedValue({ id: 42, status: 'active' });
    sqlMock.mockResolvedValue([{ webcam_id: 10042 }]);
    uploadCameraSnapshotMock.mockResolvedValue({
      url: 'https://example.com/x.jpg',
      path: 'snapshots/custom/42/1.jpg',
    });
    insertCameraSnapshotRowMock.mockResolvedValue(78901);

    const req = makeRequest({
      bearer: 'good',
      imageBytes: Buffer.from('jpeg-bytes'),
    });
    const res = await POST(req, { params: Promise.resolve({ id: '42' }) });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.snapshot_id).toBe(78901);
    expect(body.accepted_at).toBeTruthy();

    expect(uploadCameraSnapshotMock).toHaveBeenCalledWith(
      42,
      expect.any(Buffer),
      expect.any(Date)
    );
    expect(insertCameraSnapshotRowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        webcamId: 10042,
        phase: 'sunset',
        windowId: '2026-05-03-sunset-cam42',
        firebaseUrl: 'https://example.com/x.jpg',
        firebasePath: 'snapshots/custom/42/1.jpg',
      })
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/api/cameras/[id]/snapshot/route.test.ts`
Expected: FAIL — route module does not exist.

- [ ] **Step 3: Implement `route.ts`**

Create `app/api/cameras/[id]/snapshot/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';
import { verifyDeviceToken } from '@/app/lib/cameraAuth';
import {
  uploadCameraSnapshot,
  insertCameraSnapshotRow,
} from '@/app/lib/cameraSnapshot';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const cameraId = Number.parseInt(id, 10);
  if (!Number.isFinite(cameraId) || cameraId <= 0) {
    return NextResponse.json({ error: 'invalid camera id' }, { status: 400 });
  }

  const camera = await verifyDeviceToken(
    cameraId,
    request.headers.get('authorization')
  );
  if (!camera) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'expected multipart/form-data' },
      { status: 400 }
    );
  }

  const imageEntry = form.get('image');
  if (!(imageEntry instanceof Blob)) {
    return NextResponse.json(
      { error: 'image field is required' },
      { status: 400 }
    );
  }
  if (imageEntry.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: 'image exceeds 5MB cap' },
      { status: 413 }
    );
  }

  const phaseRaw = String(form.get('phase') ?? '');
  if (phaseRaw !== 'sunrise' && phaseRaw !== 'sunset') {
    return NextResponse.json(
      { error: 'phase must be sunrise or sunset' },
      { status: 400 }
    );
  }
  const phase = phaseRaw as 'sunrise' | 'sunset';

  const capturedAtRaw = String(form.get('captured_at') ?? '');
  const capturedAt = new Date(capturedAtRaw);
  if (Number.isNaN(capturedAt.getTime())) {
    return NextResponse.json(
      { error: 'captured_at must be ISO8601' },
      { status: 400 }
    );
  }

  const windowId = String(form.get('window_id') ?? '');
  if (!windowId) {
    return NextResponse.json(
      { error: 'window_id is required' },
      { status: 400 }
    );
  }

  const edgeScoreRaw = form.get('edge_score');
  const edgeScore =
    edgeScoreRaw == null || edgeScoreRaw === ''
      ? null
      : Number.parseFloat(String(edgeScoreRaw));
  const edgeModelVersionRaw = form.get('edge_model_ver');
  const edgeModelVersion =
    edgeModelVersionRaw == null || edgeModelVersionRaw === ''
      ? null
      : String(edgeModelVersionRaw);

  const rows = (await sql`
    SELECT webcam_id FROM cameras WHERE id = ${cameraId} LIMIT 1
  `) as { webcam_id: number | null }[];
  const webcamId = rows[0]?.webcam_id ?? null;
  if (!webcamId) {
    return NextResponse.json(
      { error: 'camera has no paired webcam row' },
      { status: 404 }
    );
  }

  const arrayBuffer = await imageEntry.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const uploaded = await uploadCameraSnapshot(cameraId, buffer, capturedAt);
  const snapshotId = await insertCameraSnapshotRow({
    webcamId,
    phase,
    capturedAt,
    firebaseUrl: uploaded.url,
    firebasePath: uploaded.path,
    windowId,
    edgeScore: Number.isFinite(edgeScore as number) ? (edgeScore as number) : null,
    edgeModelVersion,
  });

  await sql`
    UPDATE cameras
    SET last_seen_at = NOW()
    WHERE id = ${cameraId}
  `;

  return NextResponse.json(
    {
      snapshot_id: snapshotId,
      accepted_at: new Date().toISOString(),
    },
    { status: 202 }
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/api/cameras/[id]/snapshot/route.test.ts`
Expected: PASS — all five tests green.

- [ ] **Step 5: Run the full vitest suite to verify no regressions**

Run: `npx vitest run`
Expected: All previously passing tests still pass; the four new test files pass too.

- [ ] **Step 6: Commit**

```bash
git add app/api/cameras
git commit -m "feat(api): POST /api/cameras/:id/snapshot endpoint (Tier 0)"
```

---

## Task 6: Hand-create test camera SQL + helper script

**Files:**
- Create: `database/seeds/tier0-test-camera.sql`
- Create: `scripts/tier0-create-camera.sh`

- [ ] **Step 1: Write the seed SQL**

Create `database/seeds/tier0-test-camera.sql`:

```sql
-- Tier 0 hand-create: one custom camera + paired webcams row + active
-- terminator state row. Idempotent: re-running with the same :hardware_id
-- updates the device_token_hash and resets active=true.
--
-- Required psql variables (set by the wrapper script):
--   :hardware_id              text  e.g. 'pi-zero-2w-tier0-jesse-house'
--   :device_token_hash        text  64-char lowercase hex SHA-256
--   :lat                      numeric
--   :lng                      numeric
--   :timezone                 text
--   :title                    text  human-readable camera name (used in mosaic)
--   :phase                    text  'sunrise' or 'sunset'
--
-- Example direct invocation (without the wrapper):
--   psql "$DATABASE_URL" \
--     -v hardware_id="'pi-zero-2w-tier0-jesse-house'" \
--     -v device_token_hash="'2cf2...9824'" \
--     -v lat="47.6062" -v lng="-122.3321" \
--     -v timezone="'America/Los_Angeles'" \
--     -v title="'Tier 0 Test Camera'" -v phase="'sunset'" \
--     -f database/seeds/tier0-test-camera.sql

BEGIN;

-- 1. cameras row (upsert by hardware_id).
INSERT INTO cameras (
  hardware_id, device_token_hash, device_class, lat, lng, timezone,
  phase_preference, status
)
VALUES (
  :hardware_id, :device_token_hash, 'rpi-zero-2w', :lat, :lng, :timezone,
  :phase, 'active'
)
ON CONFLICT (hardware_id) DO UPDATE SET
  device_token_hash = EXCLUDED.device_token_hash,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  timezone = EXCLUDED.timezone,
  status = 'active';

-- 2. paired webcams row (source='custom', external_id=hardware_id).
INSERT INTO webcams (
  source, external_id, title, status, lat, lng,
  custom_camera_id, last_fetched_at, created_at, updated_at
)
SELECT 'custom', c.hardware_id, :title, 'active', c.lat, c.lng,
       c.id, NOW(), NOW(), NOW()
FROM cameras c
WHERE c.hardware_id = :hardware_id
ON CONFLICT (source, external_id) DO UPDATE SET
  title = EXCLUDED.title,
  status = 'active',
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  updated_at = NOW();

-- 3. cameras.webcam_id back-pointer.
UPDATE cameras c
SET webcam_id = w.id
FROM webcams w
WHERE c.hardware_id = :hardware_id
  AND w.source = 'custom'
  AND w.external_id = c.hardware_id;

-- 4. terminator_webcam_state row (active=true so the mosaic surfaces it).
INSERT INTO terminator_webcam_state (
  webcam_id, phase, rank, last_seen_at, updated_at, active
)
SELECT c.webcam_id, :phase, 0, NOW(), NOW(), true
FROM cameras c
WHERE c.hardware_id = :hardware_id
ON CONFLICT (webcam_id, phase) DO UPDATE SET
  active = true,
  rank = 0,
  last_seen_at = NOW(),
  updated_at = NOW();

COMMIT;

-- Final: print the camera_id so the wrapper script can echo it.
SELECT id AS camera_id
FROM cameras
WHERE hardware_id = :hardware_id;
```

- [ ] **Step 2: Write the wrapper script**

Create `scripts/tier0-create-camera.sh`:

```bash
#!/usr/bin/env bash
# Tier 0: create one custom camera and print the device token + camera_id.
#
# Usage:
#   DATABASE_URL=... ./scripts/tier0-create-camera.sh \
#     --hardware-id pi-zero-2w-tier0-jesse-house \
#     --lat 47.6062 --lng -122.3321 \
#     --timezone America/Los_Angeles \
#     --title "Tier 0 Test Camera" \
#     --phase sunset
#
# Outputs the plaintext device_token (64 hex chars) and camera_id.
# Copy both into sunset-cam-firmware/config/config.json.

set -euo pipefail

HARDWARE_ID=""
LAT=""
LNG=""
TIMEZONE=""
TITLE="Tier 0 Test Camera"
PHASE="sunset"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hardware-id) HARDWARE_ID="$2"; shift 2 ;;
    --lat) LAT="$2"; shift 2 ;;
    --lng) LNG="$2"; shift 2 ;;
    --timezone) TIMEZONE="$2"; shift 2 ;;
    --title) TITLE="$2"; shift 2 ;;
    --phase) PHASE="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

for v in HARDWARE_ID LAT LNG TIMEZONE; do
  if [[ -z "${!v}" ]]; then
    echo "missing required flag for $v" >&2
    exit 2
  fi
done

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be set" >&2
  exit 2
fi

# Generate a 32-byte hex token and its SHA-256 hash.
TOKEN="$(openssl rand -hex 32)"
TOKEN_HASH="$(printf '%s' "$TOKEN" | openssl dgst -sha256 -hex \
  | awk '{print $NF}')"

CAMERA_ID="$(psql "$DATABASE_URL" -At \
  -v hardware_id="'$HARDWARE_ID'" \
  -v device_token_hash="'$TOKEN_HASH'" \
  -v lat="$LAT" -v lng="$LNG" \
  -v timezone="'$TIMEZONE'" \
  -v title="'$TITLE'" -v phase="'$PHASE'" \
  -f database/seeds/tier0-test-camera.sql \
  | tail -n 1)"

if ! [[ "$CAMERA_ID" =~ ^[0-9]+$ ]]; then
  echo "failed to read camera_id from psql output" >&2
  exit 1
fi

cat <<EOF

Tier 0 camera created.

  camera_id:     $CAMERA_ID
  device_token:  $TOKEN

Paste these into sunset-cam-firmware/config/config.json under
"camera_id" and "device_token". The token is shown ONCE — store it now.
EOF
```

- [ ] **Step 3: Make the script executable and dry-run-verify the SQL parses**

Run:
```bash
chmod +x scripts/tier0-create-camera.sh
psql "$DATABASE_URL" -c "EXPLAIN (FORMAT TEXT) SELECT 1" >/dev/null
```

Expected: psql connects without error. (Actual seed run happens in Task 12.)

- [ ] **Step 4: Commit**

```bash
git add database/seeds scripts/tier0-create-camera.sh
git commit -m "feat(db): tier0 seed SQL + create-camera wrapper script"
```

---

## Task 7: Initialize the firmware repo

> Work below this line happens in a brand-new git repo named `sunset-cam-firmware`, **not** in `the-sunset-webcam-map`. Initialize it next to the parent on disk so the two are siblings.

**Files:**
- Create: `sunset-cam-firmware/.gitignore`
- Create: `sunset-cam-firmware/pyproject.toml`
- Create: `sunset-cam-firmware/requirements.txt`
- Create: `sunset-cam-firmware/README.md`
- Create: `sunset-cam-firmware/src/sunset_cam/__init__.py`
- Create: `sunset-cam-firmware/tests/__init__.py`

- [ ] **Step 1: Create the directory and init git**

Run:
```bash
cd "$HOME/Documents/GitHub"
mkdir sunset-cam-firmware
cd sunset-cam-firmware
git init -b main
mkdir -p src/sunset_cam tests config systemd scripts
```

Expected: empty repo with the expected directory tree.

- [ ] **Step 2: Write `pyproject.toml`**

Create `pyproject.toml`:

```toml
[project]
name = "sunset-cam"
version = "0.0.1"
description = "Firmware for the sunrise/sunset custom edge cameras (Tier 0)."
requires-python = ">=3.11"
dependencies = [
  "requests>=2.31",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.0",
  "responses>=0.25",
]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

- [ ] **Step 3: Write `requirements.txt`**

Create `requirements.txt`:

```
requests>=2.31
# picamera2 is provided by Raspberry Pi OS via apt:
#   sudo apt install -y python3-picamera2
# Do NOT pip install picamera2 — its native deps come from apt.
```

- [ ] **Step 4: Write `.gitignore`**

Create `.gitignore`:

```
__pycache__/
*.pyc
.venv/
venv/
.pytest_cache/
config/config.json
*.egg-info/
build/
dist/
```

- [ ] **Step 5: Write the package markers**

Create `src/sunset_cam/__init__.py` (empty file).
Create `tests/__init__.py` (empty file).

- [ ] **Step 6: Write the README**

Create `README.md`:

```markdown
# sunset-cam-firmware

Firmware for the custom Raspberry Pi Zero 2 W edge cameras feeding the
sunrise/sunset map. Tier 0 scope: capture JPEGs at 1 fps inside a
hardcoded UTC capture window and POST them to
`POST /api/cameras/<id>/snapshot` on the parent app.

See `the-sunset-webcam-map/docs/device-protocol.md` for the wire spec.

## Quickstart on a fresh Pi

1. Flash Raspberry Pi OS Lite (64-bit, headless). Enable SSH + Wi-Fi
   in the imager.
2. SSH in. Then:
   ```bash
   sudo apt update
   sudo apt install -y python3-picamera2 python3-venv git
   git clone <this repo> /opt/sunset-cam
   cd /opt/sunset-cam
   python3 -m venv --system-site-packages .venv
   .venv/bin/pip install -r requirements.txt
   .venv/bin/pip install -e .
   ```
   `--system-site-packages` is required so the venv can see the
   apt-installed `picamera2`.
3. Copy `config/config.example.json` to `config/config.json` and fill
   in `camera_id`, `device_token`, `api_base`,
   `capture_window_start_utc`, and `capture_window_end_utc`. Get
   `camera_id` and `device_token` from the parent repo's
   `scripts/tier0-create-camera.sh`.
4. Install and start the systemd unit:
   ```bash
   sudo cp systemd/sunset-cam.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now sunset-cam.service
   journalctl -u sunset-cam -f
   ```

## Local dev (no Pi)

```bash
python3.11 -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest
```

`tests/` is fully runnable on a Mac. The `capture` module is the only
piece that needs a real Pi — it lazy-imports `picamera2` so the rest of
the package imports cleanly without it.
```

- [ ] **Step 7: Initial commit**

```bash
git add .
git commit -m "chore: initial sunset-cam-firmware scaffold"
```

---

## Task 8: `config.py` — load `config.json`

**Files:**
- Create: `sunset-cam-firmware/config/config.example.json`
- Create: `sunset-cam-firmware/src/sunset_cam/config.py`
- Create: `sunset-cam-firmware/tests/test_config.py`

- [ ] **Step 1: Write the example config**

Create `config/config.example.json`:

```json
{
  "camera_id": 0,
  "device_token": "REPLACE_ME_WITH_TOKEN_FROM_TIER0_SCRIPT",
  "api_base": "https://sunrisesunset.studio",
  "phase": "sunset",
  "window_id": "2026-05-03-sunset-cam0",
  "capture_window_start_utc": "2026-05-03T01:00:00Z",
  "capture_window_end_utc": "2026-05-03T02:30:00Z",
  "capture_interval_s": 1.0,
  "log_level": "INFO"
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_config.py`:

```python
import json
from pathlib import Path

import pytest

from sunset_cam.config import load_config, ConfigError


def write_cfg(tmp_path: Path, overrides: dict | None = None) -> Path:
    base = {
        "camera_id": 42,
        "device_token": "abcd" * 16,
        "api_base": "https://sunrisesunset.studio",
        "phase": "sunset",
        "window_id": "2026-05-03-sunset-cam42",
        "capture_window_start_utc": "2026-05-03T01:00:00Z",
        "capture_window_end_utc": "2026-05-03T02:30:00Z",
        "capture_interval_s": 1.0,
    }
    if overrides:
        base.update(overrides)
    p = tmp_path / "config.json"
    p.write_text(json.dumps(base))
    return p


def test_load_config_returns_typed_dict(tmp_path: Path) -> None:
    cfg = load_config(write_cfg(tmp_path))
    assert cfg["camera_id"] == 42
    assert cfg["api_base"] == "https://sunrisesunset.studio"
    assert cfg["capture_interval_s"] == 1.0


def test_load_config_rejects_missing_keys(tmp_path: Path) -> None:
    p = tmp_path / "config.json"
    p.write_text(json.dumps({"camera_id": 42}))
    with pytest.raises(ConfigError):
        load_config(p)


def test_load_config_rejects_bad_phase(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        load_config(write_cfg(tmp_path, {"phase": "noon"}))


def test_load_config_rejects_non_iso_window(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        load_config(
            write_cfg(tmp_path, {"capture_window_start_utc": "yesterday"})
        )
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `.venv/bin/pytest tests/test_config.py -v`
Expected: FAIL — `sunset_cam.config` module does not exist.

- [ ] **Step 4: Implement `config.py`**

Create `src/sunset_cam/config.py`:

```python
"""Load and validate the firmware config.json."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import TypedDict


class ConfigError(ValueError):
    """Raised when config.json is missing or invalid."""


class Config(TypedDict):
    camera_id: int
    device_token: str
    api_base: str
    phase: str  # 'sunrise' | 'sunset'
    window_id: str
    capture_window_start_utc: str  # ISO8601 with 'Z' suffix
    capture_window_end_utc: str
    capture_interval_s: float
    log_level: str


_REQUIRED = (
    "camera_id",
    "device_token",
    "api_base",
    "phase",
    "window_id",
    "capture_window_start_utc",
    "capture_window_end_utc",
    "capture_interval_s",
)


def _parse_iso(value: str) -> datetime:
    # Python's fromisoformat accepts '+00:00' but not 'Z' (until 3.11+ does).
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_config(path: str | Path) -> Config:
    p = Path(path)
    if not p.exists():
        raise ConfigError(f"config not found: {p}")

    try:
        raw = json.loads(p.read_text())
    except json.JSONDecodeError as exc:
        raise ConfigError(f"config is not valid JSON: {exc}") from exc

    for key in _REQUIRED:
        if key not in raw:
            raise ConfigError(f"missing required key: {key}")

    if raw["phase"] not in ("sunrise", "sunset"):
        raise ConfigError(f"phase must be sunrise or sunset, got {raw['phase']!r}")

    try:
        _parse_iso(raw["capture_window_start_utc"])
        _parse_iso(raw["capture_window_end_utc"])
    except ValueError as exc:
        raise ConfigError(f"capture_window_*_utc must be ISO8601: {exc}") from exc

    raw.setdefault("log_level", "INFO")
    return raw  # type: ignore[return-value]
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `.venv/bin/pytest tests/test_config.py -v`
Expected: PASS — all four tests green.

- [ ] **Step 6: Commit**

```bash
git add src/sunset_cam/config.py config/config.example.json tests/test_config.py
git commit -m "feat(config): typed config.json loader with validation"
```

---

## Task 9: `window.py` — hardcoded capture-window check

**Files:**
- Create: `sunset-cam-firmware/src/sunset_cam/window.py`
- Create: `sunset-cam-firmware/tests/test_window.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_window.py`:

```python
from datetime import datetime, timezone

from sunset_cam.window import is_active_now


def cfg(start: str, end: str) -> dict:
    return {
        "capture_window_start_utc": start,
        "capture_window_end_utc": end,
    }


def test_returns_false_before_window() -> None:
    c = cfg("2026-05-03T01:00:00Z", "2026-05-03T02:00:00Z")
    now = datetime(2026, 5, 3, 0, 59, 59, tzinfo=timezone.utc)
    assert is_active_now(c, now) is False


def test_returns_true_inside_window() -> None:
    c = cfg("2026-05-03T01:00:00Z", "2026-05-03T02:00:00Z")
    now = datetime(2026, 5, 3, 1, 30, 0, tzinfo=timezone.utc)
    assert is_active_now(c, now) is True


def test_returns_false_after_window() -> None:
    c = cfg("2026-05-03T01:00:00Z", "2026-05-03T02:00:00Z")
    now = datetime(2026, 5, 3, 2, 0, 1, tzinfo=timezone.utc)
    assert is_active_now(c, now) is False


def test_window_endpoints_are_inclusive_at_start_exclusive_at_end() -> None:
    c = cfg("2026-05-03T01:00:00Z", "2026-05-03T02:00:00Z")
    start = datetime(2026, 5, 3, 1, 0, 0, tzinfo=timezone.utc)
    end = datetime(2026, 5, 3, 2, 0, 0, tzinfo=timezone.utc)
    assert is_active_now(c, start) is True
    assert is_active_now(c, end) is False


def test_naive_datetime_is_rejected() -> None:
    c = cfg("2026-05-03T01:00:00Z", "2026-05-03T02:00:00Z")
    naive = datetime(2026, 5, 3, 1, 30, 0)
    try:
        is_active_now(c, naive)
    except ValueError:
        return
    raise AssertionError("expected ValueError for naive datetime")
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `.venv/bin/pytest tests/test_window.py -v`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `window.py`**

Create `src/sunset_cam/window.py`:

```python
"""Tier 0 capture-window check.

v0 reads two hardcoded UTC ISO timestamps from config and answers
'is now between them'. Solar geometry (astral, NOAA SPA) is reserved
for Tier 1.
"""

from __future__ import annotations

from datetime import datetime


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def is_active_now(config: dict, now: datetime) -> bool:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    start = _parse(config["capture_window_start_utc"])
    end = _parse(config["capture_window_end_utc"])
    return start <= now < end
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `.venv/bin/pytest tests/test_window.py -v`
Expected: PASS — all five tests green.

- [ ] **Step 5: Commit**

```bash
git add src/sunset_cam/window.py tests/test_window.py
git commit -m "feat(window): hardcoded capture-window check (Tier 0)"
```

---

## Task 10: `upload.py` — POST snapshot to API

**Files:**
- Create: `sunset-cam-firmware/src/sunset_cam/upload.py`
- Create: `sunset-cam-firmware/tests/test_upload.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_upload.py`:

```python
from datetime import datetime, timezone

import responses

from sunset_cam.upload import upload_snapshot


def base_cfg() -> dict:
    return {
        "camera_id": 42,
        "device_token": "tok-abc",
        "api_base": "https://sunrisesunset.studio",
        "phase": "sunset",
        "window_id": "2026-05-03-sunset-cam42",
    }


@responses.activate
def test_upload_posts_to_correct_url_with_bearer() -> None:
    responses.add(
        responses.POST,
        "https://sunrisesunset.studio/api/cameras/42/snapshot",
        json={"snapshot_id": 78901, "accepted_at": "2026-05-03T01:32:14Z"},
        status=202,
    )

    captured_at = datetime(2026, 5, 3, 1, 32, 14, tzinfo=timezone.utc)
    result = upload_snapshot(base_cfg(), b"jpeg-bytes", captured_at)

    assert result["snapshot_id"] == 78901
    assert len(responses.calls) == 1
    call = responses.calls[0]
    assert call.request.headers["Authorization"] == "Bearer tok-abc"
    body = call.request.body
    if isinstance(body, bytes):
        body = body.decode("latin-1")
    assert "captured_at" in body
    assert "phase" in body
    assert "window_id" in body
    assert "image" in body
    assert "jpeg-bytes" in body


@responses.activate
def test_upload_raises_on_http_error() -> None:
    responses.add(
        responses.POST,
        "https://sunrisesunset.studio/api/cameras/42/snapshot",
        json={"error": "unauthorized"},
        status=401,
    )

    captured_at = datetime(2026, 5, 3, 1, 32, 14, tzinfo=timezone.utc)
    try:
        upload_snapshot(base_cfg(), b"jpeg-bytes", captured_at)
    except RuntimeError:
        return
    raise AssertionError("expected RuntimeError on 401")
```

- [ ] **Step 2: Install dev dependencies in the venv if not already**

Run:
```bash
.venv/bin/pip install -e ".[dev]"
```

Expected: `pytest` and `responses` installed.

- [ ] **Step 3: Run the tests and verify they fail**

Run: `.venv/bin/pytest tests/test_upload.py -v`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `upload.py`**

Create `src/sunset_cam/upload.py`:

```python
"""POST a captured JPEG to the parent app's snapshot endpoint."""

from __future__ import annotations

from datetime import datetime
from typing import TypedDict

import requests


class SnapshotAck(TypedDict):
    snapshot_id: int
    accepted_at: str


def upload_snapshot(
    config: dict,
    jpeg_bytes: bytes,
    captured_at: datetime,
    timeout_s: float = 10.0,
) -> SnapshotAck:
    if captured_at.tzinfo is None:
        raise ValueError("captured_at must be timezone-aware")

    url = f"{config['api_base'].rstrip('/')}/api/cameras/{config['camera_id']}/snapshot"

    files = {
        "image": ("frame.jpg", jpeg_bytes, "image/jpeg"),
    }
    data = {
        "captured_at": captured_at.isoformat().replace("+00:00", "Z"),
        "phase": config["phase"],
        "window_id": config["window_id"],
    }
    headers = {"Authorization": f"Bearer {config['device_token']}"}

    response = requests.post(
        url, data=data, files=files, headers=headers, timeout=timeout_s
    )
    if response.status_code >= 400:
        raise RuntimeError(
            f"snapshot upload failed: HTTP {response.status_code} {response.text}"
        )
    body = response.json()
    return SnapshotAck(
        snapshot_id=int(body["snapshot_id"]),
        accepted_at=str(body["accepted_at"]),
    )
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `.venv/bin/pytest tests/test_upload.py -v`
Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add src/sunset_cam/upload.py tests/test_upload.py
git commit -m "feat(upload): POST snapshot multipart with bearer auth"
```

---

## Task 11: `capture.py` + `main.py` + systemd unit

**Files:**
- Create: `sunset-cam-firmware/src/sunset_cam/capture.py`
- Create: `sunset-cam-firmware/src/sunset_cam/main.py`
- Create: `sunset-cam-firmware/systemd/sunset-cam.service`
- Create: `sunset-cam-firmware/scripts/install.sh`

> No automated tests for `capture.py` — `picamera2` requires real Pi hardware. The Pi-side smoke test in Task 12 is the verification.

- [ ] **Step 1: Implement `capture.py`**

Create `src/sunset_cam/capture.py`:

```python
"""picamera2 wrapper. Lazy-imports the C library so non-Pi dev machines
can still import the package.
"""

from __future__ import annotations

import io
from typing import Any


_camera: Any | None = None


def _get_camera() -> Any:
    global _camera
    if _camera is not None:
        return _camera

    from picamera2 import Picamera2  # noqa: WPS433 (lazy import)

    cam = Picamera2()
    cfg = cam.create_still_configuration(main={"size": (1920, 1080)})
    cam.configure(cfg)
    cam.start()
    _camera = cam
    return cam


def capture_jpeg() -> bytes:
    cam = _get_camera()
    buf = io.BytesIO()
    cam.capture_file(buf, format="jpeg")
    return buf.getvalue()


def shutdown() -> None:
    global _camera
    if _camera is not None:
        try:
            _camera.stop()
        except Exception:  # noqa: BLE001
            pass
        _camera = None
```

- [ ] **Step 2: Implement `main.py`**

Create `src/sunset_cam/main.py`:

```python
"""Entry point. Run with: python -m sunset_cam.main /etc/sunset-cam/config.json"""

from __future__ import annotations

import logging
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from sunset_cam.config import load_config
from sunset_cam.window import is_active_now
from sunset_cam.upload import upload_snapshot


_running = True


def _handle_sigterm(_signum: int, _frame: object) -> None:
    global _running
    _running = False


def run(config_path: str | Path) -> int:
    config = load_config(config_path)

    logging.basicConfig(
        level=getattr(logging, config["log_level"], logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    log = logging.getLogger("sunset_cam")
    log.info("starting; camera_id=%s api_base=%s", config["camera_id"], config["api_base"])

    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    interval = float(config["capture_interval_s"])

    while _running:
        now = datetime.now(timezone.utc)
        if not is_active_now(config, now):
            log.debug("outside window; sleeping %.2fs", interval)
            time.sleep(interval)
            continue

        try:
            from sunset_cam.capture import capture_jpeg

            jpeg = capture_jpeg()
        except Exception as exc:  # noqa: BLE001
            log.error("capture failed: %s", exc)
            time.sleep(interval)
            continue

        try:
            ack = upload_snapshot(config, jpeg, now)
            log.info(
                "uploaded snapshot_id=%s bytes=%d", ack["snapshot_id"], len(jpeg)
            )
        except Exception as exc:  # noqa: BLE001
            log.error("upload failed: %s", exc)

        time.sleep(interval)

    log.info("shutdown signal received; exiting cleanly")
    try:
        from sunset_cam.capture import shutdown

        shutdown()
    except Exception:  # noqa: BLE001
        pass
    return 0


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python -m sunset_cam.main /path/to/config.json", file=sys.stderr)
        sys.exit(2)
    sys.exit(run(sys.argv[1]))


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Write the systemd unit**

Create `systemd/sunset-cam.service`:

```ini
[Unit]
Description=Sunset Cam edge-camera firmware
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/sunset-cam
ExecStart=/opt/sunset-cam/.venv/bin/python -m sunset_cam.main /opt/sunset-cam/config/config.json
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Write `scripts/install.sh`**

Create `scripts/install.sh`:

```bash
#!/usr/bin/env bash
# Idempotent installer for a fresh Raspberry Pi OS Lite system.
# Run via: curl -sSL <raw url> | bash, or after `git clone /opt/sunset-cam`.

set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/sunset-cam}"

echo "==> apt deps"
sudo apt update
sudo apt install -y python3-picamera2 python3-venv git

echo "==> venv at $REPO_DIR/.venv"
if [[ ! -d "$REPO_DIR/.venv" ]]; then
  python3 -m venv --system-site-packages "$REPO_DIR/.venv"
fi
"$REPO_DIR/.venv/bin/pip" install --upgrade pip
"$REPO_DIR/.venv/bin/pip" install -r "$REPO_DIR/requirements.txt"
"$REPO_DIR/.venv/bin/pip" install -e "$REPO_DIR"

echo "==> systemd unit"
sudo cp "$REPO_DIR/systemd/sunset-cam.service" /etc/systemd/system/sunset-cam.service
sudo systemctl daemon-reload

if [[ ! -f "$REPO_DIR/config/config.json" ]]; then
  echo "==> NOTE: $REPO_DIR/config/config.json does not exist."
  echo "    Copy config/config.example.json there and fill in"
  echo "    camera_id, device_token, api_base, capture_window_*."
  echo "    Then: sudo systemctl enable --now sunset-cam"
else
  sudo systemctl enable --now sunset-cam
  echo "==> started; tail logs with: journalctl -u sunset-cam -f"
fi
```

Run:
```bash
chmod +x scripts/install.sh
```

- [ ] **Step 5: Run the full firmware test suite**

Run: `.venv/bin/pytest -v`
Expected: PASS — all `test_config.py`, `test_window.py`, `test_upload.py` tests green. (No test for `capture.py` or `main.py` — they need real hardware or a real network round-trip.)

- [ ] **Step 6: Commit**

```bash
git add src/sunset_cam/capture.py src/sunset_cam/main.py \
        systemd/sunset-cam.service scripts/install.sh
git commit -m "feat(firmware): capture, main loop, systemd unit"
```

---

## Task 12: End-to-end smoke test

> This is the integration moment. Both repos have been built; now we wire them together against a real Pi and the production parent app.

**Files (no code changes; this task is verification):**
- Apply migration against the live DB
- Seed one test camera
- Flash one Pi with the firmware
- Watch one image appear in the live mosaic

- [ ] **Step 1: Apply the migration against the production Neon DB**

In `the-sunset-webcam-map`:

Run:
```bash
psql "$DATABASE_URL" -f database/migrations/20260503_cameras_schema.sql
```

Expected: each statement succeeds; no errors. Verify:
```bash
psql "$DATABASE_URL" -c "\d cameras"
```

- [ ] **Step 2: Seed one test camera**

Run (from `the-sunset-webcam-map`):
```bash
./scripts/tier0-create-camera.sh \
  --hardware-id pi-zero-2w-tier0-jesse-house \
  --lat <YOUR_LAT> --lng <YOUR_LNG> \
  --timezone America/Los_Angeles \
  --title "Tier 0 Test Camera (Jesse house)" \
  --phase sunset
```

Expected output (last lines):
```
Tier 0 camera created.

  camera_id:     <some integer>
  device_token:  <64 hex chars>
```

Save both values. The token will not be shown again.

- [ ] **Step 3: Verify the seed worked**

Run:
```bash
psql "$DATABASE_URL" -c "
  SELECT c.id AS camera_id, c.hardware_id, c.status,
         w.id AS webcam_id, w.source, w.title,
         s.active AS terminator_active, s.phase
  FROM cameras c
  JOIN webcams w ON w.id = c.webcam_id
  JOIN terminator_webcam_state s ON s.webcam_id = w.id
  WHERE c.hardware_id = 'pi-zero-2w-tier0-jesse-house';
"
```

Expected: one row, `status = active`, `source = custom`, `terminator_active = t`.

- [ ] **Step 4: Flash and provision the Pi**

On a blank microSD (Raspberry Pi OS Lite 64-bit, headless, Wi-Fi pre-configured), boot the Pi, SSH in, and:

```bash
sudo git clone https://github.com/jessekauppila/sunset-cam-firmware.git /opt/sunset-cam
sudo chown -R pi:pi /opt/sunset-cam
cd /opt/sunset-cam
./scripts/install.sh
```

Then create `config/config.json`:

```bash
cp config/config.example.json config/config.json
nano config/config.json
```

Fill in:
- `camera_id` — from Step 2
- `device_token` — from Step 2
- `api_base` — `https://sunrisesunset.studio`
- `phase` — `sunset`
- `window_id` — `<YYYY-MM-DD>-sunset-cam<id>` for today
- `capture_window_start_utc` — a UTC time ~5 minutes from now
- `capture_window_end_utc` — start time + 10 minutes

Then:
```bash
sudo systemctl enable --now sunset-cam
journalctl -u sunset-cam -f
```

- [ ] **Step 5: Watch a frame land**

In the journalctl tail, expect to see (once the window opens):
```
INFO sunset_cam starting; camera_id=<id> api_base=https://sunrisesunset.studio
INFO sunset_cam uploaded snapshot_id=<n> bytes=<some>
INFO sunset_cam uploaded snapshot_id=<n+1> bytes=<some>
...
```

Then verify server-side:
```bash
psql "$DATABASE_URL" -c "
  SELECT id, webcam_id, phase, window_id, captured_at, firebase_url
  FROM webcam_snapshots
  WHERE webcam_id = <webcam_id from Step 3>
  ORDER BY captured_at DESC
  LIMIT 5;
"
```

Expected: at least one row per second of the capture window. Open one of the `firebase_url` values in a browser — see the JPEG.

- [ ] **Step 6: Verify it appears on the mosaic**

Open `https://sunrisesunset.studio` in a browser. Locate the camera's pin (it'll be at the lat/lng from Step 2 with the title from Step 2). The mosaic refreshes every 60s. Within one refresh, the latest custom-camera snapshot should appear among the tiles.

If it does **not** appear, debug in this order:
1. `terminator_webcam_state.active` for the webcam_id is `true`.
2. The `webcams` row's `lat`/`lng` is inside the active terminator ring at the current time.
3. The snapshot's `firebase_url` opens in a browser (Firebase ACL).
4. The mosaic query (in `app/api/db-terminator-webcams/route.ts`) returns the row.

- [ ] **Step 7: Stop the Pi and update the decisions log**

Once verified, edit `~/Documents/Claude Sessions/ongoing/sunset-pi-cameras.md` and add a line under "Status" recording the date Tier 0 went live, plus the camera_id and any observations from the run.

Tier 0 is complete when one image captured by the Pi is visible on `sunrisesunset.studio`.

---

## Open items deferred to Tier 1+

These are intentionally **not** in this plan and should not be added during implementation:

- `POST /api/cameras/register` (claim-code → token exchange)
- `POST /api/cameras/pre-register` (AR portal entry point)
- `POST /api/cameras/:id/heartbeat`
- Edge ML scoring on the device
- Window-winner selection job
- MJPEG streaming upgrade (§8)
- Signed-URL direct upload path (§6.4a)
- OTA firmware/model updates (§11A)
- Operator daily delivery (give-back emails)
- Tailscale install on the Pi (Tier 1)
- Captive portal Wi-Fi onboarding (Tier 2)
- Solar-geometry active-window computation (`astral` integration)
- Admin claim-code-generation UI

If you find yourself reaching for any of these, stop and ship Tier 0 first.
