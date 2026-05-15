# Custom Camera Popup Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mosaic-pin popups render the latest snapshot for `source='custom'` cameras (Tier 0 Pi at `camera_id=1` and any future custom cameras), instead of the emoji fallback they show today because `webcams.images` is `NULL` for that source.

**Architecture:** Read-time `LEFT JOIN LATERAL` on `webcam_snapshots` inside the existing `fetchTerminatorWebcams` query. Backend synthesizes a minimal Windy-shaped `images` blob from the latest `firebase_url` for custom rows. New `LiveAssetKind` discriminator and per-camera traceability fields (`deviceClass`, `firmwareVersion`, `hardwareId`, `latestSnapshotCapturedAt`) ride along on the payload. A new helper module exposes the same data shape to the future admin / fleet status view. Popup gains a "Captured Nm ago" freshness label for custom snapshots; otherwise unchanged.

**Tech Stack:** Next.js (app router), TypeScript, Neon Postgres (via `@/app/lib/db` `sql` template tag), Vitest for tests, vanilla DOM strings for the Mapbox popup (no React).

**Spec:** `docs/superpowers/specs/2026-05-14-custom-camera-popup-image-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `database/migrations/20260514_webcam_snapshots_latest_idx.sql` | Create | Non-partial composite index supporting `ORDER BY captured_at DESC LIMIT 1` per webcam_id. |
| `app/lib/types.ts` | Modify | Widen `WindyWebcam.images` (Windy-rich fields become optional). Add `LiveAssetKind` type. Add five new optional fields on `WindyWebcam`. |
| `app/lib/terminatorPayload.ts` | Modify | Extend SQL with `LEFT JOIN cameras` and `LEFT JOIN LATERAL` over `webcam_snapshots`. Add `imagesFromCustomSnapshot()` helper. Map new columns into the payload. |
| `app/lib/terminatorPayload.test.ts` | Create | Unit tests for `imagesFromCustomSnapshot()` (pure) and `fetchTerminatorWebcams()` (mocked `sql`, asserts query + mapping). |
| `app/lib/customCameraState.ts` | Create | `getCustomCameraLiveState()` and `getCustomCameraLiveStatesByWebcamId()` for the future admin view. Shares vocabulary with terminator query. |
| `app/lib/customCameraState.test.ts` | Create | Unit tests for both helper functions. |
| `app/components/Map/lib/webcamPopup.tsx` | Modify | Render relative-time "Captured Nm ago" label when `liveAssetKind === 'custom_snapshot'` and `latestSnapshotCapturedAt` is present. |
| `app/components/Map/lib/webcamPopup.test.ts` | Create | Unit tests asserting the popup HTML string contains the label only for custom-snapshot rows. |

---

### Task 1: Add the non-partial index for "latest snapshot per webcam"

**Files:**
- Create: `database/migrations/20260514_webcam_snapshots_latest_idx.sql`

The existing partial index `webcam_snapshots_winners_idx (webcam_id, captured_at DESC) WHERE is_window_winner = TRUE` only serves winner queries. The new `LEFT JOIN LATERAL` from Task 6 needs the non-partial form.

- [ ] **Step 1: Verify the parent directory exists**

Run: `ls database/migrations/`
Expected: prior migration files including `20260503_cameras_schema.sql` and `20260507_add_extended_llm_fields.sql`.

- [ ] **Step 2: Create the migration file**

Create `database/migrations/20260514_webcam_snapshots_latest_idx.sql` with this exact content:

```sql
-- Non-partial composite index supporting "latest snapshot per webcam_id"
-- queries used by the terminator payload's LEFT JOIN LATERAL. The existing
-- webcam_snapshots_winners_idx is partial (is_window_winner = TRUE only) and
-- does not serve queries that read the latest capture regardless of winner
-- status, which is what the custom-camera popup needs.
--
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260514_webcam_snapshots_latest_idx.sql

CREATE INDEX IF NOT EXISTS webcam_snapshots_latest_idx
  ON webcam_snapshots (webcam_id, captured_at DESC);
```

- [ ] **Step 3: Verify file content**

Run: `cat database/migrations/20260514_webcam_snapshots_latest_idx.sql`
Expected: the file content above (4 lines of SQL plus header comments).

- [ ] **Step 4: Apply the migration to prod Neon**

Run: `psql "$DATABASE_URL" -f database/migrations/20260514_webcam_snapshots_latest_idx.sql`
Expected: `CREATE INDEX` (or no output if the index already existed; `IF NOT EXISTS` makes it idempotent).

If `DATABASE_URL` is not in the shell, source `.env` first: `source .env && psql "$DATABASE_URL" -f database/migrations/20260514_webcam_snapshots_latest_idx.sql`.

- [ ] **Step 5: Verify the index landed**

Run:

```bash
psql "$DATABASE_URL" -c "\d webcam_snapshots" | grep latest_idx
```

Expected output (one line): `"webcam_snapshots_latest_idx" btree (webcam_id, captured_at DESC)`.

- [ ] **Step 6: Commit**

```bash
git add database/migrations/20260514_webcam_snapshots_latest_idx.sql
git commit -m "feat(db): add non-partial index for latest-snapshot-per-webcam queries"
```

---

### Task 2: Widen `WindyWebcam.images` so Windy-rich fields are optional

**Files:**
- Modify: `app/lib/types.ts:15-82`

Today every nested field on `images` is required. After this change, only `current.preview` is required — everything else is optional. This is the type honesty the spec calls for and prevents fabricating values for `source='custom'` cameras.

- [ ] **Step 1: Read the current type definition**

Run: `sed -n '15,82p' app/lib/types.ts` (or open in editor).
Expected: `WindyWebcam` interface with `images?` having required `sizes`, `current` (icon+preview+thumbnail), `daylight`.

- [ ] **Step 2: Apply the type widening**

In `app/lib/types.ts`, replace the `images` block (currently lines 20–36) with:

```ts
  images?: {
    sizes?: {
      icon: { width: number; height: number };
      preview: { width: number; height: number };
      thumbnail: { width: number; height: number };
    };
    current: {
      preview: string;
      icon?: string;
      thumbnail?: string;
    };
    daylight?: {
      icon: string;
      preview: string;
      thumbnail: string;
    };
  };
```

Keep the trailing semicolon and the blank line that follows.

- [ ] **Step 3: Verify TypeScript still compiles repo-wide**

Run: `npx tsc --noEmit`
Expected: no new errors. If errors appear referring to `images.sizes.preview` or `images.daylight.icon` etc., those call sites need a `?.` chain — note their locations and fix them in this same task before committing. The Windy import pipeline writes the full nested object so those values still exist at runtime; the type change only makes consumers acknowledge optionality.

- [ ] **Step 4: Commit**

```bash
git add app/lib/types.ts
git commit -m "refactor(types): widen WindyWebcam.images to make Windy-only fields optional"
```

If Step 3 required fixes at call sites, include those files in the same commit.

---

### Task 3: Add `LiveAssetKind` and new payload-row optional fields to `WindyWebcam`

**Files:**
- Modify: `app/lib/types.ts:15-82`

Adds the format discriminator (`liveAssetKind`) and the four traceability fields (`deviceClass`, `firmwareVersion`, `hardwareId`, `latestSnapshotCapturedAt`) that ride along with `source='custom'` payload rows.

- [ ] **Step 1: Add the LiveAssetKind type**

In `app/lib/types.ts`, immediately after the `Orientation` type (around line 13) and before `WindyWebcam`, add:

```ts
/**
 * Format discriminator for what kind of live asset a webcam row carries.
 * Use this to decide HOW to render (img vs video), not WHAT hardware produced
 * the asset — hardware traceability lives in dedicated fields on the row.
 */
export type LiveAssetKind =
  | 'windy_bundle'
  | 'custom_snapshot'
  | 'custom_stream';
```

- [ ] **Step 2: Add the new optional fields to `WindyWebcam`**

In the `WindyWebcam` interface, immediately after the `aiModelVersionRegression?: string;` field (the current last field of the interface, around line 81) and before the closing `}`, add:

```ts

  // Live-asset format discriminator. Tells the popup/renderer what KIND of
  // asset is on screen. Omitted when no asset is available (no snapshot, no
  // Windy images).
  liveAssetKind?: LiveAssetKind;

  // Per-camera traceability — populated only for source='custom' rows.
  // The cameras row joined via webcams.custom_camera_id.
  deviceClass?: string;            // e.g. 'rpi-zero-2w'
  firmwareVersion?: string;        // e.g. '0.1.0'
  hardwareId?: string;             // e.g. 'pi-zero-2w-tier0-jesse-house'

  // ISO8601 UTC timestamp of the snapshot whose firebase_url is in
  // images.current.preview. Only set when liveAssetKind === 'custom_snapshot'.
  latestSnapshotCapturedAt?: string;
```

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/types.ts
git commit -m "feat(types): add LiveAssetKind and custom-camera traceability fields to WindyWebcam"
```

---

### Task 4: Write failing tests for `imagesFromCustomSnapshot()`

**Files:**
- Create: `app/lib/terminatorPayload.test.ts`

The helper is a pure function (URL → `WebcamImages | undefined`). Test it independently before changing `terminatorPayload.ts`.

- [ ] **Step 1: Create the test file with the failing tests**

Create `app/lib/terminatorPayload.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';

import { imagesFromCustomSnapshot } from './terminatorPayload';

describe('imagesFromCustomSnapshot', () => {
  it('returns undefined when url is null', () => {
    expect(imagesFromCustomSnapshot(null)).toBeUndefined();
  });

  it('returns undefined when url is an empty string', () => {
    expect(imagesFromCustomSnapshot('')).toBeUndefined();
  });

  it('synthesizes a minimal images object with only current.preview populated', () => {
    const url = 'https://storage.googleapis.com/bucket/snapshots/custom/1/x.jpg';
    const result = imagesFromCustomSnapshot(url);

    expect(result).toEqual({
      current: { preview: url },
    });
  });

  it('does not synthesize fabricated sizes, icon, thumbnail, or daylight', () => {
    const url = 'https://example.com/x.jpg';
    const result = imagesFromCustomSnapshot(url);

    expect(result?.sizes).toBeUndefined();
    expect(result?.daylight).toBeUndefined();
    expect(result?.current.icon).toBeUndefined();
    expect(result?.current.thumbnail).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run app/lib/terminatorPayload.test.ts`
Expected: FAIL with an import error like `does not provide an export named 'imagesFromCustomSnapshot'`. (The function does not exist yet.)

- [ ] **Step 3: Commit the failing test**

```bash
git add app/lib/terminatorPayload.test.ts
git commit -m "test(terminator): add failing tests for imagesFromCustomSnapshot helper"
```

---

### Task 5: Implement `imagesFromCustomSnapshot()` to make the tests pass

**Files:**
- Modify: `app/lib/terminatorPayload.ts`

- [ ] **Step 1: Add the helper to terminatorPayload.ts**

In `app/lib/terminatorPayload.ts`, immediately after the existing `toMaybeNumber` helper (around line 43) and before `export async function fetchTerminatorWebcams`, add:

```ts
/**
 * For source='custom' rows: synthesize a minimal Windy-shaped `images`
 * payload from a single snapshot URL. Only `current.preview` is populated —
 * we don't have icon/thumbnail/sizes/daylight assets for custom snapshots
 * and refuse to fabricate them.
 */
export function imagesFromCustomSnapshot(
  url: string | null
): WindyWebcam['images'] | undefined {
  if (!url) return undefined;
  return { current: { preview: url } };
}
```

- [ ] **Step 2: Run the tests and confirm they pass**

Run: `npx vitest run app/lib/terminatorPayload.test.ts`
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/lib/terminatorPayload.ts
git commit -m "feat(terminator): add imagesFromCustomSnapshot helper for custom-source rows"
```

---

### Task 6: Write the failing test for `fetchTerminatorWebcams` SQL + row mapping

**Files:**
- Modify: `app/lib/terminatorPayload.test.ts`

These tests assert (a) the SQL string contains the new joins and selects, (b) the row mapping populates the new optional fields correctly per source.

- [ ] **Step 1: Append the new test block to the existing test file**

In `app/lib/terminatorPayload.test.ts`, **above** the existing `describe('imagesFromCustomSnapshot', ...)`, add the `sqlMock` setup and the new `describe` blocks. The final file structure looks like:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  fetchTerminatorWebcams,
  imagesFromCustomSnapshot,
} from './terminatorPayload';

describe('fetchTerminatorWebcams query shape', () => {
  beforeEach(() => sqlMock.mockReset().mockResolvedValue([]));

  it('selects firebase_url and captured_at via LEFT JOIN LATERAL', async () => {
    await fetchTerminatorWebcams();

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?').toLowerCase();
    expect(fullQuery).toMatch(/left join lateral/);
    expect(fullQuery).toMatch(/ls\.firebase_url/);
    expect(fullQuery).toMatch(/ls\.captured_at/);
    expect(fullQuery).toMatch(/order by captured_at desc/);
    expect(fullQuery).toMatch(/limit 1/);
  });

  it('joins the cameras table for device traceability', async () => {
    await fetchTerminatorWebcams();

    const [strings] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?').toLowerCase();
    expect(fullQuery).toMatch(/left join cameras c on c\.id = w\.custom_camera_id/);
    expect(fullQuery).toMatch(/c\.device_class/);
    expect(fullQuery).toMatch(/c\.firmware_version/);
    expect(fullQuery).toMatch(/c\.hardware_id/);
  });

  it('gates the lateral subquery on source=custom inside its WHERE clause', async () => {
    await fetchTerminatorWebcams();

    const [strings] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?').toLowerCase();
    // Both halves of the gate must be present within the lateral subquery.
    expect(fullQuery).toMatch(/webcam_id\s*=\s*w\.id\s+and\s+w\.source\s*=\s*'custom'/);
  });
});

describe('fetchTerminatorWebcams row mapping', () => {
  const baseRow = {
    webcam_id: 100, phase: 'sunset', rank: 1,
    id: 100, source: 'windy', external_id: 'ext-100', title: 'A cam',
    status: 'active', view_count: 10,
    lat: 10, lng: 20,
    city: 'X', region: 'Y', country: 'Z', continent: 'NA',
    images: { current: { preview: 'https://windy/p.jpg', icon: 'https://windy/i.jpg', thumbnail: 'https://windy/t.jpg' } },
    urls: null, player: null, categories: null,
    last_fetched_at: '2026-05-14T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-05-14T00:00:00Z',
    rating: null, orientation: null,
    ai_rating: null, ai_model_version: null,
    ai_rating_binary: null, ai_model_version_binary: null,
    ai_rating_regression: null, ai_model_version_regression: null,
    latest_snapshot_url: null,
    latest_snapshot_captured_at: null,
    device_class: null, firmware_version: null, hardware_id: null,
  };

  beforeEach(() => sqlMock.mockReset());

  it('windy row: liveAssetKind = "windy_bundle", no device fields, no latestSnapshotCapturedAt', async () => {
    sqlMock.mockResolvedValue([{ ...baseRow, source: 'windy' }]);

    const result = await fetchTerminatorWebcams();

    expect(result).toHaveLength(1);
    expect(result[0].liveAssetKind).toBe('windy_bundle');
    expect(result[0].deviceClass).toBeUndefined();
    expect(result[0].firmwareVersion).toBeUndefined();
    expect(result[0].hardwareId).toBeUndefined();
    expect(result[0].latestSnapshotCapturedAt).toBeUndefined();
  });

  it('custom row with snapshot: synthesizes images, sets liveAssetKind, populates device fields and captured_at', async () => {
    sqlMock.mockResolvedValue([{
      ...baseRow,
      source: 'custom',
      images: null,
      latest_snapshot_url: 'https://fb/snap.jpg',
      latest_snapshot_captured_at: '2026-05-14T03:30:00Z',
      device_class: 'rpi-zero-2w',
      firmware_version: '0.1.0',
      hardware_id: 'pi-zero-2w-tier0-jesse-house',
    }]);

    const result = await fetchTerminatorWebcams();

    expect(result[0].images).toEqual({ current: { preview: 'https://fb/snap.jpg' } });
    expect(result[0].liveAssetKind).toBe('custom_snapshot');
    expect(result[0].deviceClass).toBe('rpi-zero-2w');
    expect(result[0].firmwareVersion).toBe('0.1.0');
    expect(result[0].hardwareId).toBe('pi-zero-2w-tier0-jesse-house');
    expect(result[0].latestSnapshotCapturedAt).toBe('2026-05-14T03:30:00Z');
  });

  it('custom row, no snapshot ever: images undefined, liveAssetKind undefined, device fields still populated', async () => {
    sqlMock.mockResolvedValue([{
      ...baseRow,
      source: 'custom',
      images: null,
      latest_snapshot_url: null,
      latest_snapshot_captured_at: null,
      device_class: 'rpi-zero-2w',
      firmware_version: '0.1.0',
      hardware_id: 'pi-zero-2w-tier0-jesse-house',
    }]);

    const result = await fetchTerminatorWebcams();

    expect(result[0].images).toBeUndefined();
    expect(result[0].liveAssetKind).toBeUndefined();
    expect(result[0].deviceClass).toBe('rpi-zero-2w');
    expect(result[0].firmwareVersion).toBe('0.1.0');
    expect(result[0].hardwareId).toBe('pi-zero-2w-tier0-jesse-house');
    expect(result[0].latestSnapshotCapturedAt).toBeUndefined();
  });

  it('windy row with empty webcams.images falls back to undefined images (no synthesis on windy source)', async () => {
    sqlMock.mockResolvedValue([{ ...baseRow, source: 'windy', images: null }]);

    const result = await fetchTerminatorWebcams();

    expect(result[0].images).toBeUndefined();
    expect(result[0].liveAssetKind).toBe('windy_bundle');
  });
});

describe('imagesFromCustomSnapshot', () => {
  // ... existing tests from Task 4 stay here ...
});
```

Keep the existing `describe('imagesFromCustomSnapshot', ...)` block from Task 4 at the bottom — only the new code goes above it. Replace the existing `import { imagesFromCustomSnapshot } from './terminatorPayload';` line with the combined import shown above.

- [ ] **Step 2: Run the tests and confirm the new ones fail**

Run: `npx vitest run app/lib/terminatorPayload.test.ts`
Expected: the four `imagesFromCustomSnapshot` tests still pass. The three "query shape" and four "row mapping" tests fail because (a) the SQL doesn't yet contain `LEFT JOIN LATERAL`, (b) the row mapper doesn't yet output `liveAssetKind`, `deviceClass`, etc.

- [ ] **Step 3: Commit the failing tests**

```bash
git add app/lib/terminatorPayload.test.ts
git commit -m "test(terminator): add failing tests for SQL joins and custom-row mapping"
```

---

### Task 7: Update `fetchTerminatorWebcams` SQL and row mapping

**Files:**
- Modify: `app/lib/terminatorPayload.ts`

- [ ] **Step 1: Extend the `TerminatorRow` type**

In `app/lib/terminatorPayload.ts`, locate the `TerminatorRow` type (currently lines 4–35). Replace its closing brace (`};`) and the lines just above with this extended form:

```ts
  ai_rating_regression: number | string | null;
  ai_model_version_regression: string | null;
  // From LEFT JOIN LATERAL on webcam_snapshots (only populated for source='custom')
  latest_snapshot_url: string | null;
  latest_snapshot_captured_at: string | null;
  // From LEFT JOIN cameras (only populated for source='custom')
  device_class: string | null;
  firmware_version: string | null;
  hardware_id: string | null;
};
```

The four lines above the closing brace (`ai_rating_regression`, `ai_model_version_regression`) already exist — keep them. Only the six new fields and the comment lines are additions.

- [ ] **Step 2: Update the SQL query in `fetchTerminatorWebcams`**

Replace the entire SQL template literal (currently lines 46–60) with:

```ts
  const rows = (await sql`
    select s.webcam_id, s.phase, s.rank,
           w.id, w.source, w.external_id, w.title, w.status, w.view_count,
           w.lat, w.lng, w.city, w.region, w.country, w.continent,
           w.images, w.urls, w.player, w.categories,
           w.last_fetched_at, w.created_at, w.updated_at,
           w.rating, w.orientation, w.ai_rating, w.ai_model_version,
           w.ai_rating_binary, w.ai_model_version_binary,
           w.ai_rating_regression, w.ai_model_version_regression,
           ls.firebase_url      as latest_snapshot_url,
           ls.captured_at       as latest_snapshot_captured_at,
           c.device_class,
           c.firmware_version,
           c.hardware_id
    from terminator_webcam_state s
    join webcams w on w.id = s.webcam_id
    left join cameras c on c.id = w.custom_camera_id
    left join lateral (
      select firebase_url, captured_at
      from webcam_snapshots
      where webcam_id = w.id and w.source = 'custom'
      order by captured_at desc
      limit 1
    ) ls on true
    where s.active = true
    order by case s.phase when 'sunrise' then 0 else 1 end, s.rank
    limit 2000
  `) as TerminatorRow[];
```

- [ ] **Step 3: Update the row mapping to populate new fields**

Replace the entire `return rows.map((row) => ({ ... }));` block (currently lines 62–96) with:

```ts
  return rows.map((row) => {
    const hasCustomSnapshot =
      row.source === 'custom' && !!row.latest_snapshot_url;

    const liveAssetKind: WindyWebcam['liveAssetKind'] =
      row.source === 'windy'
        ? 'windy_bundle'
        : hasCustomSnapshot
        ? 'custom_snapshot'
        : undefined;

    return {
      webcamId: row.webcam_id,
      title: row.title ?? '',
      viewCount: row.view_count ?? 0,
      status: row.status ?? 'unknown',
      images:
        row.images ??
        (row.source === 'custom'
          ? imagesFromCustomSnapshot(row.latest_snapshot_url)
          : undefined),
      urls: row.urls ?? undefined,
      player: row.player ?? undefined,
      location: {
        city: row.city ?? '',
        region: row.region ?? '',
        longitude: row.lng,
        latitude: row.lat,
        country: row.country ?? '',
        continent: row.continent ?? '',
      },
      categories: row.categories ?? [],
      lastUpdatedOn: row.last_fetched_at,
      phase: row.phase,
      rank: row.rank,
      source: row.source,
      externalId: row.external_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rating: row.rating ?? undefined,
      orientation:
        (row.orientation as WindyWebcam['orientation']) ?? undefined,
      aiRating: toMaybeNumber(row.ai_rating),
      aiModelVersion: row.ai_model_version ?? undefined,
      aiRatingBinary: toMaybeNumber(row.ai_rating_binary),
      aiModelVersionBinary: row.ai_model_version_binary ?? undefined,
      aiRatingRegression: toMaybeNumber(row.ai_rating_regression),
      aiModelVersionRegression:
        row.ai_model_version_regression ?? undefined,
      liveAssetKind,
      deviceClass: row.device_class ?? undefined,
      firmwareVersion: row.firmware_version ?? undefined,
      hardwareId: row.hardware_id ?? undefined,
      latestSnapshotCapturedAt: hasCustomSnapshot
        ? row.latest_snapshot_captured_at ?? undefined
        : undefined,
    };
  });
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run app/lib/terminatorPayload.test.ts`
Expected: all 11 tests pass (4 helper + 3 query-shape + 4 row-mapping).

- [ ] **Step 5: Run the full type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/lib/terminatorPayload.ts
git commit -m "feat(terminator): join latest snapshot and cameras for custom rows; populate liveAssetKind and traceability fields"
```

---

### Task 8: Write failing tests for `customCameraState` helper

**Files:**
- Create: `app/lib/customCameraState.test.ts`

The helper exposes the same vocabulary (`device_class`, `firmware_version`, `hardware_id`, latest snapshot) to single-camera / batched lookups that the future admin view will use.

- [ ] **Step 1: Create the test file**

Create `app/lib/customCameraState.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  getCustomCameraLiveState,
  getCustomCameraLiveStatesByWebcamId,
} from './customCameraState';

describe('getCustomCameraLiveState', () => {
  beforeEach(() => sqlMock.mockReset());

  it('returns null when no rows match the cameraId', async () => {
    sqlMock.mockResolvedValue([]);

    const result = await getCustomCameraLiveState(999);

    expect(result).toBeNull();
  });

  it('returns full state with latest_snapshot when both camera and snapshot exist', async () => {
    sqlMock.mockResolvedValue([{
      device_class: 'rpi-zero-2w',
      firmware_version: '0.1.0',
      hardware_id: 'pi-zero-2w-tier0-jesse-house',
      latest_snapshot_url: 'https://fb/snap.jpg',
      latest_snapshot_captured_at: new Date('2026-05-14T03:30:00Z'),
    }]);

    const result = await getCustomCameraLiveState(1);

    expect(result).not.toBeNull();
    expect(result!.device_class).toBe('rpi-zero-2w');
    expect(result!.firmware_version).toBe('0.1.0');
    expect(result!.hardware_id).toBe('pi-zero-2w-tier0-jesse-house');
    expect(result!.latest_snapshot).toEqual({
      firebase_url: 'https://fb/snap.jpg',
      captured_at: new Date('2026-05-14T03:30:00Z'),
    });
  });

  it('returns state with null latest_snapshot when camera exists but no snapshots yet', async () => {
    sqlMock.mockResolvedValue([{
      device_class: 'rpi-zero-2w',
      firmware_version: null,
      hardware_id: 'pi-zero-2w-new-build',
      latest_snapshot_url: null,
      latest_snapshot_captured_at: null,
    }]);

    const result = await getCustomCameraLiveState(2);

    expect(result).not.toBeNull();
    expect(result!.firmware_version).toBeNull();
    expect(result!.latest_snapshot).toBeNull();
  });

  it('passes the cameraId as a SQL parameter', async () => {
    sqlMock.mockResolvedValue([]);

    await getCustomCameraLiveState(42);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain(42);
  });
});

describe('getCustomCameraLiveStatesByWebcamId', () => {
  beforeEach(() => sqlMock.mockReset());

  it('returns an empty Map when called with an empty array (no SQL hit)', async () => {
    const result = await getCustomCameraLiveStatesByWebcamId([]);

    expect(result.size).toBe(0);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns a Map keyed by webcam_id for each row returned by SQL', async () => {
    sqlMock.mockResolvedValue([
      {
        webcam_id: 100,
        device_class: 'rpi-zero-2w',
        firmware_version: '0.1.0',
        hardware_id: 'pi-A',
        latest_snapshot_url: 'https://fb/a.jpg',
        latest_snapshot_captured_at: new Date('2026-05-14T03:00:00Z'),
      },
      {
        webcam_id: 200,
        device_class: 'rpi-zero-2w',
        firmware_version: '0.1.0',
        hardware_id: 'pi-B',
        latest_snapshot_url: null,
        latest_snapshot_captured_at: null,
      },
    ]);

    const result = await getCustomCameraLiveStatesByWebcamId([100, 200, 300]);

    expect(result.size).toBe(2);
    expect(result.get(100)?.hardware_id).toBe('pi-A');
    expect(result.get(100)?.latest_snapshot?.firebase_url).toBe('https://fb/a.jpg');
    expect(result.get(200)?.hardware_id).toBe('pi-B');
    expect(result.get(200)?.latest_snapshot).toBeNull();
    expect(result.has(300)).toBe(false);
  });

  it('passes the webcamIds array to SQL', async () => {
    sqlMock.mockResolvedValue([]);

    await getCustomCameraLiveStatesByWebcamId([1, 2, 3]);

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContainEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run app/lib/customCameraState.test.ts`
Expected: FAIL with import error — file doesn't exist yet.

- [ ] **Step 3: Commit the failing tests**

```bash
git add app/lib/customCameraState.test.ts
git commit -m "test(customCameraState): add failing tests for single + batched live-state helpers"
```

---

### Task 9: Implement `customCameraState` helper

**Files:**
- Create: `app/lib/customCameraState.ts`

- [ ] **Step 1: Create the helper file**

Create `app/lib/customCameraState.ts` with:

```ts
import { sql } from '@/app/lib/db';

/**
 * Live operational state for a single custom camera. Combines the cameras-row
 * metadata (immutable per-device fields) with the latest webcam_snapshots row
 * (most-recent capture, may be null for brand-new cameras).
 *
 * Shared by the public terminator-payload (popup image source) and the future
 * admin / fleet status view (per-row state). Both consumers want the same
 * atomic facts about a custom camera.
 */
export interface CustomCameraLiveState {
  device_class: string;
  firmware_version: string | null;
  hardware_id: string;
  latest_snapshot: {
    firebase_url: string;
    captured_at: Date;
  } | null;
}

type SingleRow = {
  device_class: string;
  firmware_version: string | null;
  hardware_id: string;
  latest_snapshot_url: string | null;
  latest_snapshot_captured_at: Date | null;
};

type BatchRow = SingleRow & { webcam_id: number };

function rowToState(row: SingleRow): CustomCameraLiveState {
  return {
    device_class: row.device_class,
    firmware_version: row.firmware_version,
    hardware_id: row.hardware_id,
    latest_snapshot:
      row.latest_snapshot_url && row.latest_snapshot_captured_at
        ? {
            firebase_url: row.latest_snapshot_url,
            captured_at: row.latest_snapshot_captured_at,
          }
        : null,
  };
}

/**
 * Fetch the live state for a single custom camera by cameras.id.
 * Returns null when no camera with that id exists.
 */
export async function getCustomCameraLiveState(
  cameraId: number
): Promise<CustomCameraLiveState | null> {
  const rows = (await sql`
    select c.device_class,
           c.firmware_version,
           c.hardware_id,
           ls.firebase_url   as latest_snapshot_url,
           ls.captured_at    as latest_snapshot_captured_at
    from cameras c
    left join lateral (
      select firebase_url, captured_at
      from webcam_snapshots
      where webcam_id = c.webcam_id
      order by captured_at desc
      limit 1
    ) ls on true
    where c.id = ${cameraId}
    limit 1
  `) as SingleRow[];

  if (rows.length === 0) return null;
  return rowToState(rows[0]);
}

/**
 * Fetch the live state for many custom cameras at once, keyed by webcam_id
 * (not camera_id) because the most common consumer — the terminator-payload
 * call site — joins through webcams. Returns a Map; webcam_ids with no
 * matching custom camera are absent from the result.
 */
export async function getCustomCameraLiveStatesByWebcamId(
  webcamIds: number[]
): Promise<Map<number, CustomCameraLiveState>> {
  const out = new Map<number, CustomCameraLiveState>();
  if (webcamIds.length === 0) return out;

  const rows = (await sql`
    select c.webcam_id,
           c.device_class,
           c.firmware_version,
           c.hardware_id,
           ls.firebase_url   as latest_snapshot_url,
           ls.captured_at    as latest_snapshot_captured_at
    from cameras c
    left join lateral (
      select firebase_url, captured_at
      from webcam_snapshots
      where webcam_id = c.webcam_id
      order by captured_at desc
      limit 1
    ) ls on true
    where c.webcam_id = any(${webcamIds})
  `) as BatchRow[];

  for (const row of rows) {
    out.set(row.webcam_id, rowToState(row));
  }
  return out;
}
```

- [ ] **Step 2: Run the tests and confirm they pass**

Run: `npx vitest run app/lib/customCameraState.test.ts`
Expected: 7 tests pass.

- [ ] **Step 3: Run the type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/customCameraState.ts
git commit -m "feat(customCameraState): add single + batched helpers for custom-camera live state"
```

---

### Task 10: Write failing test for popup "Captured Nm ago" label

**Files:**
- Create: `app/components/Map/lib/webcamPopup.test.ts`

The popup is a function that returns an HTML string. Tests assert the string contains the freshness label only when `liveAssetKind === 'custom_snapshot'` and `latestSnapshotCapturedAt` is set.

- [ ] **Step 1: Create the test file**

Create `app/components/Map/lib/webcamPopup.test.ts` with:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WindyWebcam } from '../../../lib/types';

import { createWebcamPopupContent } from './webcamPopup';

const baseWebcam: WindyWebcam = {
  webcamId: 1,
  title: 'Test cam',
  viewCount: 0,
  status: 'active',
  images: { current: { preview: 'https://example.com/img.jpg' } },
  location: { latitude: 10, longitude: 20 },
  categories: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-14T03:30:30Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createWebcamPopupContent — freshness label', () => {
  it('omits the "Captured ... ago" label for windy_bundle rows', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'windy_bundle',
      latestSnapshotCapturedAt: '2026-05-14T03:30:00Z',
    });

    expect(html).not.toMatch(/Captured\s+\d+s\s+ago/);
    expect(html).not.toMatch(/Captured\s+\d+m\s+ago/);
  });

  it('omits the label when latestSnapshotCapturedAt is missing', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'custom_snapshot',
      // latestSnapshotCapturedAt deliberately absent
    });

    expect(html).not.toMatch(/Captured/);
  });

  it('renders "Captured 30s ago" for a custom_snapshot captured 30s ago', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'custom_snapshot',
      latestSnapshotCapturedAt: '2026-05-14T03:30:00Z', // 30s before now
    });

    expect(html).toMatch(/Captured\s+30s\s+ago/);
  });

  it('renders "Captured 4m ago" for a custom_snapshot captured 4 minutes ago', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'custom_snapshot',
      latestSnapshotCapturedAt: '2026-05-14T03:26:30Z',
    });

    expect(html).toMatch(/Captured\s+4m\s+ago/);
  });

  it('renders "Captured 2h ago" for a custom_snapshot captured 2 hours ago', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'custom_snapshot',
      latestSnapshotCapturedAt: '2026-05-14T01:30:30Z',
    });

    expect(html).toMatch(/Captured\s+2h\s+ago/);
  });

  it('renders an absolute date for a custom_snapshot captured >=24h ago', () => {
    const html = createWebcamPopupContent({
      ...baseWebcam,
      liveAssetKind: 'custom_snapshot',
      latestSnapshotCapturedAt: '2026-05-10T03:30:30Z',
    });

    expect(html).toMatch(/Captured\s+2026-05-10/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run app/components/Map/lib/webcamPopup.test.ts`
Expected: the three "renders 'Captured ... ago'" tests fail (no such text in current popup HTML). The "omits" tests pass trivially because the current popup never emits "Captured" — that's a pre-existing absence, not a real assertion of our new logic; the tests still serve to lock in the omission cases after we add the label.

- [ ] **Step 3: Commit the failing tests**

```bash
git add app/components/Map/lib/webcamPopup.test.ts
git commit -m "test(webcamPopup): add failing tests for custom-snapshot freshness label"
```

---

### Task 11: Implement the "Captured Nm ago" label in the popup

**Files:**
- Modify: `app/components/Map/lib/webcamPopup.tsx`

- [ ] **Step 1: Add the relative-time formatter helper at the top of the file**

In `app/components/Map/lib/webcamPopup.tsx`, immediately after the `import type` line at the top (line 1), add:

```ts

/**
 * Format an ISO timestamp as a short relative-time label for the popup.
 * Thresholds: <60s → "Ns ago", <60min → "Nm ago", <24h → "Nh ago",
 * else absolute YYYY-MM-DD date.
 */
function formatCapturedAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const deltaSec = Math.max(0, Math.floor((now - then) / 1000));

  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 60 * 60) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 24 * 60 * 60) return `${Math.floor(deltaSec / 3600)}h ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Build the captured-ago HTML snippet inside the function**

Inside `createWebcamPopupContent`, immediately after the `hasImage` const declaration (currently line 19) and before the `formatLocation` helper, add:

```ts

  const capturedSection =
    webcam.liveAssetKind === 'custom_snapshot' && webcam.latestSnapshotCapturedAt
      ? `<p style="margin: 0 0 4px 0; font-size: 10px; color: #9ca3af;line-height: 1;">Captured ${formatCapturedAgo(webcam.latestSnapshotCapturedAt)}</p>`
      : '';
```

- [ ] **Step 3: Render the snippet in BOTH popup branches**

The popup function has two return paths (the `if (hasImage) { return ... }` block and the bottom `return` for the fallback). In **both** templates, insert `${capturedSection}` immediately after the `<!-- Last Updated -->` paragraph and before `${aiSection}`.

For the hasImage branch (currently around lines 105–108), the relevant region changes from:

```
          <p style="margin: 0 0 4px 0; font-size: 10px; color: #9ca3af;line-height: 1;">
            Updated: ${formatLastUpdated()}
          </p>
          ${aiSection}
```

to:

```
          <p style="margin: 0 0 4px 0; font-size: 10px; color: #9ca3af;line-height: 1;">
            Updated: ${formatLastUpdated()}
          </p>
          ${capturedSection}
          ${aiSection}
```

Apply the identical change in the bottom fallback branch (currently around lines 141–144).

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run app/components/Map/lib/webcamPopup.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Run the type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/components/Map/lib/webcamPopup.tsx
git commit -m "feat(webcamPopup): render 'Captured Nm ago' label for custom-snapshot rows"
```

---

### Task 12: Run the full test suite and the type-check

**Files:** none (verification only)

- [ ] **Step 1: Run the entire vitest suite**

Run: `npm test -- run`
Expected: all tests pass. If anything pre-existing was already failing, note it separately; nothing in this plan should introduce a new failure.

- [ ] **Step 2: Run the full type-check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Run the linter if one is configured**

Run: `npm run lint 2>/dev/null || echo "no lint script"`
Expected: passes if a lint script exists, otherwise the echo fallback fires and we move on.

---

### Task 13: Manual end-to-end verification

**Files:** none (manual verification)

Per the spec's §7.3 verification checklist. Run these against `https://www.sunrisesunset.studio` after deploying the changes (or against `localhost:3000` if testing locally with `DATABASE_URL` pointed at prod).

- [ ] **Step 1: Confirm migration was applied**

Run:

```bash
psql "$DATABASE_URL" -c "\d webcam_snapshots" | grep latest_idx
```

Expected: `"webcam_snapshots_latest_idx" btree (webcam_id, captured_at DESC)`. If this is missing, repeat Task 1 Step 4.

- [ ] **Step 2: Confirm `/api/db-terminator-webcams` returns the new fields for the Tier 0 camera**

Run (from any shell):

```bash
curl -s "https://www.sunrisesunset.studio/api/db-terminator-webcams" \
  | jq '.[] | select(.source == "custom") | {webcamId, source, liveAssetKind, deviceClass, hardwareId, latestSnapshotCapturedAt, images}'
```

Expected: at least one row appears (the Tier 0 Pi), with `source: "custom"`, `liveAssetKind: "custom_snapshot"` if the Pi recently uploaded, `deviceClass: "rpi-zero-2w"`, `hardwareId: "pi-zero-2w-tier0-jesse-house"`, and `images.current.preview` populated. If the Pi has no snapshots in the DB right now, `liveAssetKind` may be absent and `images` may be `null` — that's the correct empty-state behavior; proceed to Step 3 anyway.

- [ ] **Step 3: Click the live Tier 0 Pi pin on the production mosaic**

Open `https://www.sunrisesunset.studio` during a capture window (sunrise or sunset for Bellingham WA). Locate the Tier 0 Pi pin on the mosaic (camera_id=1, in Bellingham). Click it.

Expected: the popup shows the actual camera image (not the emoji fallback) and a "Captured Ns ago" or "Captured Nm ago" label between the "Updated" line and the AI rating box.

- [ ] **Step 4: Click any Windy pin**

Click any non-Tier-0 (Windy-sourced) pin on the mosaic.

Expected: popup renders exactly as before. The "Captured" line is absent. No regression.

- [ ] **Step 5: Confirm the index is used by the production query**

Run:

```bash
psql "$DATABASE_URL" -c "
EXPLAIN ANALYZE
select firebase_url, captured_at
from webcam_snapshots
where webcam_id = (select id from webcams where source = 'custom' limit 1)
order by captured_at desc
limit 1;"
```

Expected: the plan includes a line like `Index Scan using webcam_snapshots_latest_idx on webcam_snapshots`. If it shows `Seq Scan`, the index is present but the planner didn't use it — usually a row-count issue at small scale. Acceptable for Tier 0 (single camera); flag for re-check once Tier 1 lands.

- [ ] **Step 6: Final commit (if any verification adjustments were needed)**

If Steps 1–5 surfaced any fixes (typos, formatting), commit them now. Otherwise nothing to do.

---

## Open coordination points (not in scope for this plan, but watch for them)

- **Terminator-endpoint Redis cache TTL** — if the parallel `model-mosaic-integration` plan ships a `terminator:current` Redis cache with a 300s TTL, custom-camera popup freshness will be capped at ~5 minutes. Coordinate with that plan's implementer to drop TTL for custom-bearing payloads or invalidate on snapshot insert. Flagged in spec §6.3.

## Files changed (final count)

- New: `database/migrations/20260514_webcam_snapshots_latest_idx.sql`
- New: `app/lib/customCameraState.ts`
- New: `app/lib/customCameraState.test.ts`
- New: `app/lib/terminatorPayload.test.ts`
- New: `app/components/Map/lib/webcamPopup.test.ts`
- Modified: `app/lib/types.ts`
- Modified: `app/lib/terminatorPayload.ts`
- Modified: `app/components/Map/lib/webcamPopup.tsx`

8 files total: 5 new, 3 modified.
