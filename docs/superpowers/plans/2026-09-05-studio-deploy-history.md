# Studio Deploy History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every studio Deploy records a numbered snapshot of the whole profile; the rail lists them, and any one can be loaded back into the studio for preview and redeploy.

**Architecture:** One new table (`kiosk_deploys`) written by the existing deploy route; a small server store module; three owner-gated routes; four additions to `useStudioSettings`; one pure summary helper; one `DeployHistory` component rendered under the Deploy button in both studios. Loading a deploy touches only the studio profile. The glass changes only on Deploy.

**Tech Stack:** Next.js 15 app router, Neon `sql` tag (`@/app/lib/db`), SWR, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-05-studio-deploy-history-and-solo-preview-design.md` (Part A only; Part B waits for PR #134 and gets its own plan).

## Global Constraints

- Worktree: `~/GitHub/the-sunset-webcam-map.worktrees/feat-deploy-history`, branch `feat/deploy-history`. Verify the branch in the same command as every commit. Stage explicit paths.
- These are **deploys** numbered `#n`, never "versions".
- Label max 60 characters.
- History failing to write must never fail Deploy, and must never be hidden: the response carries `deploy: null` and the rail says so.
- Migration `database/migrations/20260905_kiosk_deploys.sql` is applied by Jesse (`--apply` is classifier-blocked) **before** the PR merges.
- Run tests with `npx vitest run <path>`; the whole suite with `npm run test`; lint with `npm run lint`.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UBj3NHsZ13Cw7aWr2sQaRt
  ```

---

## File map

| file | responsibility |
|---|---|
| `database/migrations/20260905_kiosk_deploys.sql` | create `kiosk_deploys`, seed deploy #1 from live |
| `app/lib/settings/knownSchemas.ts` | `schemaFor(namespace)` + `KNOWN_NAMESPACES`, shared by store, hook, summary |
| `app/lib/settings/deploys.ts` (+ test) | record / list / load-into-studio / relabel |
| `app/api/kiosk/settings/deploy/route.ts` (+ test) | records the snapshot after the copy |
| `app/api/kiosk/deploys/route.ts` (+ test) | GET list |
| `app/api/kiosk/deploys/[id]/route.ts` (+ test) | PATCH label |
| `app/api/kiosk/deploys/[id]/load/route.ts` (+ test) | POST load into studio |
| `app/studio/useStudioSettings.ts` (+ test) | `deploys`, `deploy(label?)`, `loadDeploy`, `relabelDeploy`, `lastDeployRecorded` |
| `app/studio/deploySummary.ts` (+ test) | `summarize(row, previous)`, `profileEquals(a, b)`, `formatValue` |
| `app/studio/DeployHistory.tsx` (+ test) | the list under the Deploy button |
| `app/studio/DeployButton.tsx` | "↩ revert to glass" → "↩ discard changes" |
| `app/studio/StudioClient.tsx`, `app/studio/solo/SoloStudioClient.tsx` | render `DeployHistory` in the deploy slot |
| `app/studio/solo/SoloRail.test.tsx` | fixture gains the new api fields |

---

### Task 1: Migration

**Files:**
- Create: `database/migrations/20260905_kiosk_deploys.sql`

- [ ] **Step 1: Write the migration**

```sql
-- kiosk_deploys: one row per studio Deploy (spec:
-- docs/superpowers/specs/2026-09-05-studio-deploy-history-and-solo-preview-design.md §2.1).
-- `namespaces` is { namespace: deviations }, the same deviations-only blobs
-- kiosk_settings.data holds, captured exactly as they were copied to live.
-- Loading a row back sanitizes each namespace through its current schema, so
-- adding/renaming/removing knobs never needs a migration here either.
--
-- Seeds deploy #1 from the current live profile when the table is empty, so
-- "what was on the glass before deploy history" is recoverable from day one.
--
-- Forward-only, idempotent. Apply via:
--   node scripts/apply-migration.mjs database/migrations/20260905_kiosk_deploys.sql
--   node scripts/apply-migration.mjs database/migrations/20260905_kiosk_deploys.sql --apply

CREATE TABLE IF NOT EXISTS kiosk_deploys (
  id           SERIAL PRIMARY KEY,
  label        TEXT,
  namespaces   JSONB NOT NULL,
  deployed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO kiosk_deploys (label, namespaces)
SELECT 'before deploy history', COALESCE(jsonb_object_agg(namespace, data), '{}'::jsonb)
FROM kiosk_settings
WHERE profile = 'live'
  AND NOT EXISTS (SELECT 1 FROM kiosk_deploys);
```

- [ ] **Step 2: Dry-run it (prints statements, applies nothing)**

Run: `node scripts/apply-migration.mjs database/migrations/20260905_kiosk_deploys.sql`
Expected: `2 statement(s)` listed, no errors. Note: `npm run migrate:status` will now list it as PENDING; that is correct until Jesse applies it.

- [ ] **Step 3: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/deploy-history ] && \
git add database/migrations/20260905_kiosk_deploys.sql && \
git commit -m "feat(settings): kiosk_deploys table, seeded from the live profile"
```

---

### Task 2: Shared schema lookup

**Files:**
- Create: `app/lib/settings/knownSchemas.ts`

**Interfaces:**
- Produces: `schemaFor(namespace: string): SettingsSchema | null`, `KNOWN_NAMESPACES: string[]`

- [ ] **Step 1: Write the module**

```ts
import type { SettingsSchema } from './schema';
import { SHARED_NAMESPACE, SHARED_SCHEMA } from './sharedSchema';
import { MOSAIC_SETTINGS_SCHEMAS } from '@/app/components/mosaic/registry';

/** The schema a namespace's deviations are read through, or null for a namespace this build does not know. */
export function schemaFor(namespace: string): SettingsSchema | null {
  if (namespace === SHARED_NAMESPACE) return SHARED_SCHEMA;
  return MOSAIC_SETTINGS_SCHEMAS[namespace] ?? null;
}

export const KNOWN_NAMESPACES: string[] = [SHARED_NAMESPACE, ...Object.keys(MOSAIC_SETTINGS_SCHEMAS)];
```

- [ ] **Step 2: Type-check and commit**

Run: `npx tsc --noEmit -p . 2>&1 | head -5`
Expected: no output.

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/deploy-history ] && \
git add app/lib/settings/knownSchemas.ts && \
git commit -m "refactor(settings): one schemaFor for every namespace reader"
```

---

### Task 3: Deploys store

**Files:**
- Create: `app/lib/settings/deploys.ts`
- Test: `app/lib/settings/deploys.test.ts`

**Interfaces:**
- Consumes: `schemaFor` (Task 2), `getProfileSettings`, `sql`
- Produces:
  ```ts
  interface DeployRow { id: number; label: string | null; namespaces: Record<string, SettingsValues>; deployedAt: string }
  type DroppedDeployKey = DroppedKey & { namespace: string }
  recordDeploy(live: ProfileSettings, label?: string | null): Promise<DeployRow | null>
  listDeploys(limit?: number): Promise<DeployRow[]>
  loadDeployIntoStudio(id: number): Promise<{ studio: ProfileSettings; dropped: DroppedDeployKey[] } | null>
  relabelDeploy(id: number, label: string | null): Promise<boolean>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): unknown;
  transaction: unknown;
  __sqlMock: ReturnType<typeof vi.fn>;
  __txnMock: ReturnType<typeof vi.fn>;
};

vi.mock('@/app/lib/db', async () => {
  const sqlMockFn = vi.fn();
  const txnMockFn = vi.fn();
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => sqlMockFn(strings, ...values);
  const t = tag as unknown as SqlTag;
  t.transaction = txnMockFn;
  t.__sqlMock = sqlMockFn;
  t.__txnMock = txnMockFn;
  return { sql: tag };
});

vi.mock('@/app/components/mosaic/registry', () => ({
  MOSAIC_SETTINGS_SCHEMAS: {
    v1: [{ key: 'floorPx', kind: 'number', min: 20, max: 800, step: 10, default: 100, label: 'floor', description: '', section: 's' }],
  },
}));

import { recordDeploy, listDeploys, loadDeployIntoStudio, relabelDeploy } from './deploys';
import { sql } from '@/app/lib/db';

const sqlMock = (sql as unknown as SqlTag).__sqlMock;
const txnMock = (sql as unknown as SqlTag).__txnMock;
const text = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  sqlMock.mockReset();
  txnMock.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('recordDeploy', () => {
  it('inserts the whole profile and returns the row', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 7, label: null, namespaces: { v1: { floorPx: 140 } }, deployed_at: '2026-09-05T18:30:00.000Z' }]);
    const row = await recordDeploy({ namespaces: { v1: { floorPx: 140 } }, revision: 3 }, null);
    expect(row).toEqual({ id: 7, label: null, namespaces: { v1: { floorPx: 140 } }, deployedAt: '2026-09-05T18:30:00.000Z' });
    expect(text(sqlMock.mock.calls[0])).toContain('INSERT INTO kiosk_deploys');
    expect(sqlMock.mock.calls[0][2]).toBe(JSON.stringify({ v1: { floorPx: 140 } }));
  });
  it('returns null instead of throwing when the table is missing', async () => {
    sqlMock.mockRejectedValueOnce(new Error('relation "kiosk_deploys" does not exist'));
    expect(await recordDeploy({ namespaces: {}, revision: 1 })).toBeNull();
  });
});

describe('listDeploys', () => {
  it('maps rows newest first and defaults the limit to 50', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 2, label: 'b', namespaces: {}, deployed_at: 'B' }, { id: 1, label: null, namespaces: {}, deployed_at: 'A' }]);
    const rows = await listDeploys();
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(text(sqlMock.mock.calls[0])).toContain('ORDER BY id DESC');
    expect(sqlMock.mock.calls[0][1]).toBe(50);
  });
  it('returns [] when the read fails', async () => {
    sqlMock.mockRejectedValueOnce(new Error('nope'));
    expect(await listDeploys()).toEqual([]);
  });
});

describe('loadDeployIntoStudio', () => {
  it('returns null for an unknown id', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await loadDeployIntoStudio(99)).toBeNull();
    expect(txnMock).not.toHaveBeenCalled();
  });
  it('replaces the studio profile wholesale, sanitizing through the current schema and naming what it dropped', async () => {
    sqlMock.mockResolvedValueOnce([{ namespaces: { v1: { floorPx: 140, ghost: 1 }, gone: { x: 2 } } }]);
    sqlMock.mockResolvedValueOnce([{ namespace: 'v1', data: { floorPx: 140 }, revision: 1 }]); // getProfileSettings after the write
    const out = await loadDeployIntoStudio(7);
    expect(out?.studio).toEqual({ namespaces: { v1: { floorPx: 140 } }, revision: 1 });
    expect(out?.dropped).toEqual([
      { namespace: 'v1', key: 'ghost', reason: 'unknown' },
      { namespace: 'gone', key: 'x', reason: 'unknown' },
    ]);
    const [statements] = txnMock.mock.calls[0];
    expect(statements).toHaveLength(2); // DELETE every studio row, then one INSERT per surviving namespace
    const deleteCall = sqlMock.mock.calls.find((c) => text(c).includes("DELETE FROM kiosk_settings WHERE profile = 'studio'"));
    expect(deleteCall).toBeDefined();
    const insertCall = sqlMock.mock.calls.find((c) => text(c).includes('INSERT INTO kiosk_settings'));
    expect(insertCall?.[1]).toBe('v1');
    expect(insertCall?.[2]).toBe(JSON.stringify({ floorPx: 140 }));
  });
  it('a namespace whose every value is at default is not written back', async () => {
    sqlMock.mockResolvedValueOnce([{ namespaces: { v1: { floorPx: 100 } } }]);
    sqlMock.mockResolvedValueOnce([]);
    const out = await loadDeployIntoStudio(3);
    expect(out?.studio).toEqual({ namespaces: {}, revision: 0 });
    expect(txnMock.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('relabelDeploy', () => {
  it('true when a row changed, false when none did', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 7 }]);
    expect(await relabelDeploy(7, 'opening night')).toBe(true);
    sqlMock.mockResolvedValueOnce([]);
    expect(await relabelDeploy(8, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/lib/settings/deploys.test.ts`
Expected: FAIL, cannot resolve `./deploys`.

- [ ] **Step 3: Write the store**

```ts
import 'server-only';
import { sql } from '@/app/lib/db';
import { getProfileSettings, type ProfileSettings } from './store';
import { droppedKeys, sanitizeValues, stripDefaults, type DroppedKey, type SettingsValues } from './schema';
import { schemaFor } from './knownSchemas';

/** One studio Deploy, the whole profile as it was copied to live (spec §2.1). */
export interface DeployRow {
  id: number;
  label: string | null;
  namespaces: Record<string, SettingsValues>;
  deployedAt: string;
}

export type DroppedDeployKey = DroppedKey & { namespace: string };

interface Row { id: number; label: string | null; namespaces: Record<string, SettingsValues>; deployed_at: string | Date }

function toRow(r: Row): DeployRow {
  return { id: Number(r.id), label: r.label, namespaces: r.namespaces, deployedAt: new Date(r.deployed_at).toISOString() };
}

/**
 * Record the profile Deploy just copied. Never throws: history failing to
 * write must not fail the deploy, and the null return is how the route says
 * so instead of hiding it.
 */
export async function recordDeploy(live: ProfileSettings, label?: string | null): Promise<DeployRow | null> {
  try {
    const rows = (await sql`
      INSERT INTO kiosk_deploys (label, namespaces)
      VALUES (${label ?? null}, ${JSON.stringify(live.namespaces)}::jsonb)
      RETURNING id, label, namespaces, deployed_at
    `) as unknown as Row[];
    return toRow(rows[0]);
  } catch (error) {
    console.warn('[deploys] recordDeploy failed:', error);
    return null;
  }
}

export async function listDeploys(limit = 50): Promise<DeployRow[]> {
  try {
    const rows = (await sql`
      SELECT id, label, namespaces, deployed_at FROM kiosk_deploys ORDER BY id DESC LIMIT ${limit}
    `) as unknown as Row[];
    return rows.map(toRow);
  } catch (error) {
    console.warn('[deploys] listDeploys failed:', error);
    return [];
  }
}

/**
 * Replace the studio profile with a snapshot. Wholesale: a studio namespace
 * the snapshot never had is deleted, otherwise a stale deviation would
 * survive underneath the restore. Every namespace is read through its
 * current schema and the casualties are returned by name (schemas drift).
 * Delete-all-then-insert rather than a NOT IN list so no array parameter
 * crosses the driver; studio revisions restart at 1, which nothing reads.
 */
export async function loadDeployIntoStudio(
  id: number,
): Promise<{ studio: ProfileSettings; dropped: DroppedDeployKey[] } | null> {
  const rows = (await sql`SELECT namespaces FROM kiosk_deploys WHERE id = ${id}`) as unknown as Pick<Row, 'namespaces'>[];
  if (!rows[0]) return null;

  const dropped: DroppedDeployKey[] = [];
  const clean: Record<string, SettingsValues> = {};
  for (const [namespace, values] of Object.entries(rows[0].namespaces ?? {})) {
    const schema = schemaFor(namespace);
    if (!schema) {
      for (const key of Object.keys(values ?? {})) dropped.push({ namespace, key, reason: 'unknown' });
      continue;
    }
    for (const d of droppedKeys(schema, values)) dropped.push({ namespace, ...d });
    const deviations = stripDefaults(schema, sanitizeValues(schema, values));
    if (Object.keys(deviations).length > 0) clean[namespace] = deviations;
  }

  await sql.transaction([
    sql`DELETE FROM kiosk_settings WHERE profile = 'studio'`,
    ...Object.entries(clean).map(
      ([namespace, deviations]) => sql`
        INSERT INTO kiosk_settings (profile, namespace, data)
        VALUES ('studio', ${namespace}, ${JSON.stringify(deviations)}::jsonb)
        ON CONFLICT (profile, namespace)
        DO UPDATE SET data = EXCLUDED.data, revision = kiosk_settings.revision + 1, updated_at = now()
      `,
    ),
  ]);
  return { studio: await getProfileSettings('studio'), dropped };
}

export async function relabelDeploy(id: number, label: string | null): Promise<boolean> {
  const rows = (await sql`
    UPDATE kiosk_deploys SET label = ${label} WHERE id = ${id} RETURNING id
  `) as unknown as { id: number }[];
  return rows.length > 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/lib/settings/deploys.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/deploy-history ] && \
git add app/lib/settings/deploys.ts app/lib/settings/deploys.test.ts && \
git commit -m "feat(settings): deploys store — record, list, load into studio, relabel"
```

---

### Task 4: Deploy route records the snapshot

**Files:**
- Modify: `app/api/kiosk/settings/deploy/route.ts`
- Test: `app/api/kiosk/settings/deploy/route.test.ts`

**Interfaces:**
- Consumes: `recordDeploy` (Task 3)
- Produces: response `{ live: ProfileSettings; deploy: DeployRow | null }`; `POST(request?: Request)` accepts an optional JSON body `{ label?: string }`.

- [ ] **Step 1: Add the failing tests**

Add to the existing mocks at the top of the test file:

```ts
const recordDeployMock = vi.fn();
vi.mock('@/app/lib/settings/deploys', () => ({
  recordDeploy: (live: unknown, label: unknown) => recordDeployMock(live, label),
}));
```

Add `recordDeployMock.mockReset();` to the `beforeEach`, then append these cases inside the `describe`:

```ts
  it('records the copied profile and returns the deploy row', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const live = { namespaces: { v1: { floorPx: 140 } }, revision: 4 };
    copyProfileMock.mockResolvedValueOnce(live);
    recordDeployMock.mockResolvedValueOnce({ id: 7, label: 'opening night', namespaces: live.namespaces, deployedAt: 'T' });
    const res = await POST(new Request('http://test/api/kiosk/settings/deploy', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'opening night' }),
    }));
    expect(res.status).toBe(200);
    expect(recordDeployMock).toHaveBeenCalledWith(live, 'opening night');
    expect(await res.json()).toEqual({ live, deploy: { id: 7, label: 'opening night', namespaces: live.namespaces, deployedAt: 'T' } });
  });

  it('a bodiless POST still deploys, with no label, and a failed record comes back as null', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const live = { namespaces: {}, revision: 5 };
    copyProfileMock.mockResolvedValueOnce(live);
    recordDeployMock.mockResolvedValueOnce(null);
    const res = await POST();
    expect(recordDeployMock).toHaveBeenCalledWith(live, null);
    expect(await res.json()).toEqual({ live, deploy: null });
  });

  it('clips a label to 60 characters', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    copyProfileMock.mockResolvedValueOnce({ namespaces: {}, revision: 6 });
    recordDeployMock.mockResolvedValueOnce(null);
    await POST(new Request('http://test/x', { method: 'POST', body: JSON.stringify({ label: 'x'.repeat(80) }) }));
    expect(recordDeployMock.mock.calls[0][1]).toHaveLength(60);
  });
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx vitest run app/api/kiosk/settings/deploy/route.test.ts`
Expected: the three new cases FAIL (`recordDeployMock` not called / `deploy` missing); the existing ones still pass.

- [ ] **Step 3: Update the route**

```ts
import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { copyProfile } from '@/app/lib/settings/store';
import { recordDeploy } from '@/app/lib/settings/deploys';
import { setKioskLiveSettingsCache } from '@/app/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LABEL_MAX = 60;

/** Optional `{ label }`. No body, or a malformed one, is a deploy with no label. */
async function labelOf(request?: Request): Promise<string | null> {
  if (!request) return null;
  try {
    const body = (await request.json()) as { label?: unknown };
    return typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, LABEL_MAX) : null;
  } catch {
    return null;
  }
}

export async function POST(request?: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const label = await labelOf(request);
  const live = await copyProfile('studio', 'live');
  await setKioskLiveSettingsCache(live);
  // History is bookkeeping: it must not fail the deploy, and `null` is how
  // the studio learns it was not written instead of assuming it was.
  const deploy = await recordDeploy(live, label);
  return NextResponse.json({ live, deploy });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/api/kiosk/settings/deploy/route.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/deploy-history ] && \
git add app/api/kiosk/settings/deploy/route.ts app/api/kiosk/settings/deploy/route.test.ts && \
git commit -m "feat(settings): Deploy records a kiosk_deploys snapshot and returns it"
```

---

### Task 5: Deploys routes — list, relabel, load

**Files:**
- Create: `app/api/kiosk/deploys/route.ts`, `app/api/kiosk/deploys/route.test.ts`
- Create: `app/api/kiosk/deploys/[id]/route.ts`, `app/api/kiosk/deploys/[id]/route.test.ts`
- Create: `app/api/kiosk/deploys/[id]/load/route.ts`, `app/api/kiosk/deploys/[id]/load/route.test.ts`
- Create: `app/api/kiosk/deploys/parseId.ts`

**Interfaces:**
- Consumes: `listDeploys`, `relabelDeploy`, `loadDeployIntoStudio` (Task 3)
- Produces: `GET /api/kiosk/deploys → { deploys }`; `PATCH /api/kiosk/deploys/:id { label } → { ok: true }`; `POST /api/kiosk/deploys/:id/load → { studio, dropped }`.

- [ ] **Step 1: Write the failing tests**

`app/api/kiosk/deploys/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwnerMock() }));
const listDeploysMock = vi.fn();
vi.mock('@/app/lib/settings/deploys', () => ({ listDeploys: () => listDeploysMock() }));

import { GET } from './route';

describe('GET /api/kiosk/deploys', () => {
  beforeEach(() => { requireOwnerMock.mockReset(); listDeploysMock.mockReset(); });
  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await GET()).status).toBe(403);
    expect(listDeploysMock).not.toHaveBeenCalled();
  });
  it('returns the list', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    listDeploysMock.mockResolvedValueOnce([{ id: 1, label: null, namespaces: {}, deployedAt: 'T' }]);
    expect(await (await GET()).json()).toEqual({ deploys: [{ id: 1, label: null, namespaces: {}, deployedAt: 'T' }] });
  });
});
```

`app/api/kiosk/deploys/[id]/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwnerMock() }));
const relabelMock = vi.fn();
vi.mock('@/app/lib/settings/deploys', () => ({ relabelDeploy: (id: number, l: unknown) => relabelMock(id, l) }));

import { PATCH } from './route';

const req = (body: unknown) => new NextRequest('http://test/api/kiosk/deploys/7', {
  method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('PATCH /api/kiosk/deploys/[id]', () => {
  beforeEach(() => { requireOwnerMock.mockReset(); relabelMock.mockReset(); requireOwnerMock.mockResolvedValue(null); });
  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await PATCH(req({ label: 'x' }), params('7'))).status).toBe(403);
  });
  it('400 on a bad id, a non-string label, or a label over 60 chars', async () => {
    expect((await PATCH(req({ label: 'x' }), params('seven'))).status).toBe(400);
    expect((await PATCH(req({ label: 5 }), params('7'))).status).toBe(400);
    expect((await PATCH(req({ label: 'x'.repeat(61) }), params('7'))).status).toBe(400);
    expect(relabelMock).not.toHaveBeenCalled();
  });
  it('renames, and null clears the label', async () => {
    relabelMock.mockResolvedValueOnce(true);
    const res = await PATCH(req({ label: ' opening night ' }), params('7'));
    expect(relabelMock).toHaveBeenCalledWith(7, 'opening night');
    expect(await res.json()).toEqual({ ok: true });
    relabelMock.mockResolvedValueOnce(true);
    await PATCH(req({ label: null }), params('7'));
    expect(relabelMock).toHaveBeenLastCalledWith(7, null);
  });
  it('404 when the deploy does not exist', async () => {
    relabelMock.mockResolvedValueOnce(false);
    expect((await PATCH(req({ label: 'x' }), params('99'))).status).toBe(404);
  });
});
```

`app/api/kiosk/deploys/[id]/load/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({ requireOwner: () => requireOwnerMock() }));
const loadMock = vi.fn();
vi.mock('@/app/lib/settings/deploys', () => ({ loadDeployIntoStudio: (id: number) => loadMock(id) }));

import { POST } from './route';

const req = () => new NextRequest('http://test/api/kiosk/deploys/7/load', { method: 'POST' });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/kiosk/deploys/[id]/load', () => {
  beforeEach(() => { requireOwnerMock.mockReset(); loadMock.mockReset(); requireOwnerMock.mockResolvedValue(null); });
  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await POST(req(), params('7'))).status).toBe(403);
    expect(loadMock).not.toHaveBeenCalled();
  });
  it('400 on a bad id', async () => {
    expect((await POST(req(), params('0'))).status).toBe(400);
  });
  it('404 when the deploy does not exist', async () => {
    loadMock.mockResolvedValueOnce(null);
    expect((await POST(req(), params('99'))).status).toBe(404);
  });
  it('loads into the studio and reports the dropped keys', async () => {
    const out = { studio: { namespaces: { v1: { floorPx: 140 } }, revision: 2 }, dropped: [{ namespace: 'v1', key: 'ghost', reason: 'unknown' }] };
    loadMock.mockResolvedValueOnce(out);
    const res = await POST(req(), params('7'));
    expect(loadMock).toHaveBeenCalledWith(7);
    expect(await res.json()).toEqual(out);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run app/api/kiosk/deploys`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the routes**

`app/api/kiosk/deploys/parseId.ts`:

```ts
/** A deploy id from the URL: a positive integer, or null. Route files may only export handler fields, so this lives beside them. */
export function parseDeployId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
```

`app/api/kiosk/deploys/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { listDeploys } from '@/app/lib/settings/deploys';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Every recorded Deploy, newest first (spec §2.3). */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  return NextResponse.json({ deploys: await listDeploys() });
}
```

`app/api/kiosk/deploys/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { relabelDeploy } from '@/app/lib/settings/deploys';
import { parseDeployId } from '../parseId';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LABEL_MAX = 60;

/** Rename a deploy. `{ label: null }` clears it. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = parseDeployId((await params).id);
  if (id === null) return NextResponse.json({ error: 'id must be a positive integer' }, { status: 400 });
  let body: { label?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const raw = body?.label;
  if (raw !== null && typeof raw !== 'string') {
    return NextResponse.json({ error: 'label must be a string or null' }, { status: 400 });
  }
  if (typeof raw === 'string' && raw.length > LABEL_MAX) {
    return NextResponse.json({ error: `label must be at most ${LABEL_MAX} characters` }, { status: 400 });
  }
  const label = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  const found = await relabelDeploy(id, label);
  if (!found) return NextResponse.json({ error: 'no such deploy' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

`app/api/kiosk/deploys/[id]/load/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { loadDeployIntoStudio } from '@/app/lib/settings/deploys';
import { parseDeployId } from '../../parseId';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Put a recorded deploy into the STUDIO profile so it can be previewed and
 * then deployed. The glass is untouched: only Deploy changes live.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = parseDeployId((await params).id);
  if (id === null) return NextResponse.json({ error: 'id must be a positive integer' }, { status: 400 });
  const out = await loadDeployIntoStudio(id);
  if (!out) return NextResponse.json({ error: 'no such deploy' }, { status: 404 });
  return NextResponse.json(out);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run app/api/kiosk/deploys`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/deploy-history ] && \
git add app/api/kiosk/deploys && \
git commit -m "feat(api): kiosk deploys — list, relabel, load into studio"
```

---

### Task 6: Hook additions

**Files:**
- Modify: `app/studio/useStudioSettings.ts`
- Test: `app/studio/useStudioSettings.test.tsx`
- Modify: `app/studio/solo/SoloRail.test.tsx` (fixture gains the new fields)

**Interfaces:**
- Consumes: `schemaFor`, `KNOWN_NAMESPACES` (Task 2); types `DeployRow`, `DroppedDeployKey` (Task 3)
- Produces, on `StudioSettingsApi`:
  ```ts
  deploys: DeployRow[];
  deploy: (label?: string) => Promise<void>;
  loadDeploy: (id: number) => Promise<DroppedDeployKey[]>;
  relabelDeploy: (id: number, label: string | null) => Promise<void>;
  lastDeployRecorded: boolean | null;
  ```

- [ ] **Step 1: Add the failing tests**

Append inside the `describe('useStudioSettings')` block. `settingsResponse` and `wrapper` already exist in the file.

```ts
  it('exposes the deploy list from /api/kiosk/deploys and [] before it loads', async () => {
    const deploys = [{ id: 2, label: null, namespaces: { v1: { floorPx: 140 } }, deployedAt: 'T' }];
    fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url === '/api/kiosk/deploys' ? { deploys } : settingsResponse({}, {})),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    expect(result.current.deploys).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.deploys).toEqual(deploys);
  });

  it('loadDeploy replaces the studio profile, drops the local overlay, and returns the dropped keys', async () => {
    const loaded = { namespaces: { v1: { floorPx: 200 } }, revision: 9 };
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/kiosk/deploys/7/load') {
        return { ok: true, json: async () => ({ studio: loaded, dropped: [{ namespace: 'v1', key: 'ghost', reason: 'unknown' }] }) };
      }
      if (url === '/api/kiosk/deploys') return { ok: true, json: async () => ({ deploys: [] }) };
      if (init?.method === 'PATCH') return { ok: true, json: async () => ({ revision: 2 }) };
      return { ok: true, json: async () => settingsResponse({}, {}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { result.current.setKnob('v1', 'floorPx', 140); }); // a pending, un-flushed edit
    let dropped: unknown;
    await act(async () => { dropped = await result.current.loadDeploy(7); });
    expect(dropped).toEqual([{ namespace: 'v1', key: 'ghost', reason: 'unknown' }]);
    expect(result.current.effective('v1').floorPx).toBe(200);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
  });

  it('deploy(label) posts the label and remembers whether history was recorded', async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/kiosk/settings/deploy') {
        return { ok: true, json: async () => ({ live: { namespaces: {}, revision: 3 }, deploy: null }) };
      }
      if (url === '/api/kiosk/deploys') return { ok: true, json: async () => ({ deploys: [] }) };
      return { ok: true, json: async () => settingsResponse({ floorPx: 140 }, {}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.lastDeployRecorded).toBeNull();
    await act(async () => { await result.current.deploy('opening night'); });
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/kiosk/settings/deploy');
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ label: 'opening night' });
    expect(result.current.lastDeployRecorded).toBe(false);
  });

  it('relabelDeploy PATCHes the label', async () => {
    fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/kiosk/deploys') return { ok: true, json: async () => ({ deploys: [] }) };
      if (url === '/api/kiosk/deploys/7') return { ok: true, json: async () => ({ ok: true }) };
      return { ok: true, json: async () => settingsResponse({}, {}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useStudioSettings(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await result.current.relabelDeploy(7, 'opening night'); });
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/kiosk/deploys/7');
    expect((call?.[1] as RequestInit).method).toBe('PATCH');
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ label: 'opening night' });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run app/studio/useStudioSettings.test.tsx`
Expected: the four new cases FAIL (`deploys` undefined, `loadDeploy is not a function`, …). If an EXISTING deploy test asserts the fetch init is exactly `{ method: 'POST' }`, it will start failing in Step 3; loosen it to check `method` only.

- [ ] **Step 3: Update the hook**

Replace the private `schemaFor` and `KNOWN_NAMESPACES` in the hook with:

```ts
import { schemaFor, KNOWN_NAMESPACES } from '@/app/lib/settings/knownSchemas';
import type { DeployRow, DroppedDeployKey } from '@/app/lib/settings/deploys';
```

(delete the local `function schemaFor` and `const KNOWN_NAMESPACES`; keep the `SHARED_NAMESPACE`/`MOSAIC_SETTINGS_SCHEMAS` imports only if something else in the file still uses them, otherwise remove them so lint stays clean).

Add to `StudioSettingsApi`, after `revert`:

```ts
  /** Recorded deploys, newest first. [] until the first fetch lands. */
  deploys: DeployRow[];
  /** Put a recorded deploy into the studio profile (the glass is untouched). Returns the keys the current schema could not take. */
  loadDeploy: (id: number) => Promise<DroppedDeployKey[]>;
  relabelDeploy: (id: number, label: string | null) => Promise<void>;
  /** Whether the last deploy this session was written to history; null before any deploy. */
  lastDeployRecorded: boolean | null;
```

and change `deploy`'s type to `deploy: (label?: string) => Promise<void>;`.

Add the constant `const DEPLOYS_URL = '/api/kiosk/deploys';` next to `SETTINGS_URL`, and inside the hook, after the settings `useSWR`:

```ts
  const { data: deploysData, mutate: mutateDeploys } = useSWR<{ deploys: DeployRow[] }>(DEPLOYS_URL, fetcher, {
    refreshInterval: 30_000,
  });
  const [lastDeployRecorded, setLastDeployRecorded] = useState<boolean | null>(null);
```

Replace `deploy`:

```ts
  const deploy = useCallback(
    async (label?: string) => {
      await flushPending();
      const res = await fetch('/api/kiosk/settings/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(label ? { label } : {}),
      });
      if (!res.ok) {
        throw new Error(`deploy failed: ${res.status}`);
      }
      const json = (await res.json()) as { live: ProfileSettings; deploy: DeployRow | null };
      await mutate(
        (current) => (current ? { ...current, live: json.live } : current),
        { revalidate: false }
      );
      setDeployedAtMs(Date.now());
      setLastDeployRecorded(json.deploy != null);
      void mutateDeploys();
    },
    [flushPending, mutate, mutateDeploys]
  );
```

Add after `revert`:

```ts
  // Same shape as revert(): the studio profile is replaced by the server,
  // so pending debounced edits are discarded, not sent on top of it.
  const loadDeploy = useCallback(
    async (id: number): Promise<DroppedDeployKey[]> => {
      cancelPending();
      const res = await fetch(`${DEPLOYS_URL}/${id}/load`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`load deploy failed: ${res.status}`);
      }
      const json = (await res.json()) as { studio: ProfileSettings; dropped: DroppedDeployKey[] };
      await mutate(
        (current) => (current ? { ...current, studio: json.studio } : current),
        { revalidate: false }
      );
      overlayRef.current = {};
      setOverlay({});
      return json.dropped;
    },
    [cancelPending, mutate]
  );

  const relabelDeploy = useCallback(
    async (id: number, label: string | null) => {
      const res = await fetch(`${DEPLOYS_URL}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        throw new Error(`relabel failed: ${res.status}`);
      }
      void mutateDeploys();
    },
    [mutateDeploys]
  );
```

Return the new fields: `deploys: deploysData?.deploys ?? [], loadDeploy, relabelDeploy, lastDeployRecorded`.

Then in `app/studio/solo/SoloRail.test.tsx`, extend the `api()` fixture:

```ts
    deploy: async () => {}, revert: async () => {}, deployedAtMs: null, droppedKeys: [],
    deploys: [], loadDeploy: async () => [], relabelDeploy: async () => {}, lastDeployRecorded: null,
```

- [ ] **Step 4: Run to verify they pass, plus the type check**

Run: `npx vitest run app/studio/useStudioSettings.test.tsx app/studio/solo/SoloRail.test.tsx && npx tsc --noEmit -p . 2>&1 | head -5`
Expected: all passed; tsc silent. (`import type` from a `server-only` module is erased at compile time, exactly as the existing `ProfileSettings` import is.)

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/deploy-history ] && \
git add app/studio/useStudioSettings.ts app/studio/useStudioSettings.test.tsx app/studio/solo/SoloRail.test.tsx && \
git commit -m "feat(studio): useStudioSettings learns deploys, loadDeploy, relabelDeploy"
```

---

### Task 7: Summary helper

**Files:**
- Create: `app/studio/deploySummary.ts`
- Test: `app/studio/deploySummary.test.ts`

**Interfaces:**
- Consumes: `schemaFor`, `KNOWN_NAMESPACES` (Task 2), `DeployRow` (Task 3)
- Produces:
  ```ts
  formatValue(v: KnobValue): string
  summarize(row: DeployRow, previous: DeployRow | undefined): string
  profileEquals(a: Record<string, SettingsValues> | undefined, b: Record<string, SettingsValues> | undefined): boolean
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/app/components/mosaic/registry', () => ({
  MOSAIC_SETTINGS_SCHEMAS: {
    v1: [
      { key: 'floorPx', kind: 'number', min: 20, max: 800, step: 10, default: 100, label: 'floor', description: '', section: 's' },
      { key: 'gate', kind: 'number', min: 0, max: 1, step: 0.01, default: 0.5, label: 'gate', description: '', section: 's' },
      { key: 'label', kind: 'boolean', default: false, label: 'label', description: '', section: 's' },
      { key: 'ceilingPx', kind: 'number', min: 100, max: 2000, step: 10, default: 1000, label: 'ceiling', description: '', section: 's' },
    ],
  },
}));

import { summarize, profileEquals, formatValue } from './deploySummary';

const row = (id: number, namespaces: Record<string, Record<string, number | boolean | string>>) =>
  ({ id, label: null, namespaces, deployedAt: 'T' });

describe('formatValue', () => {
  it('integers plain, fractions to two places, booleans on/off, strings as-is', () => {
    expect(formatValue(140)).toBe('140');
    expect(formatValue(0.549999)).toBe('0.55');
    expect(formatValue(true)).toBe('on');
    expect(formatValue('solo')).toBe('solo');
  });
});

describe('summarize', () => {
  it('the first recorded deploy says so', () => {
    expect(summarize(row(1, { v1: { floorPx: 140 } }), undefined)).toBe('first recorded');
  });
  it('lists what changed against the previous deploy with the new values', () => {
    expect(summarize(row(2, { v1: { floorPx: 140, gate: 0.18 } }), row(1, { v1: { floorPx: 140 } }))).toBe('gate 0.18');
  });
  it('a namespace going back to defaults reads as its keys returning to default values', () => {
    expect(summarize(row(2, {}), row(1, { v1: { floorPx: 140 } }))).toBe('floorPx 100');
  });
  it('caps at three and counts the rest', () => {
    expect(summarize(row(2, { v1: { floorPx: 140, gate: 0.18, label: true, ceilingPx: 1100 } }), row(1, {}))).toBe('floorPx 140 · gate 0.18 · label on · +1');
  });
  it('an identical redeploy says no dial changes', () => {
    expect(summarize(row(2, { v1: { floorPx: 140 } }), row(1, { v1: { floorPx: 140 } }))).toBe('no dial changes');
  });
});

describe('profileEquals', () => {
  it('compares effective values per known namespace, so defaults and absent rows are equal', () => {
    expect(profileEquals({ v1: { floorPx: 100 } }, {})).toBe(true);
    expect(profileEquals({ v1: { floorPx: 140 } }, { v1: { floorPx: 140 } })).toBe(true);
    expect(profileEquals({ v1: { floorPx: 140 } }, undefined)).toBe(false);
  });
  it('ignores namespaces this build does not know', () => {
    expect(profileEquals({ gone: { x: 1 } }, {})).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/studio/deploySummary.test.ts`
Expected: FAIL, cannot resolve `./deploySummary`.

- [ ] **Step 3: Write the helper**

```ts
import { diffKeys, mergeSettings, type KnobValue, type SettingsValues } from '@/app/lib/settings/schema';
import { KNOWN_NAMESPACES, schemaFor } from '@/app/lib/settings/knownSchemas';
import type { DeployRow } from '@/app/lib/settings/deploys';

const SUMMARY_MAX = 3;

export function formatValue(v: KnobValue): string {
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return v;
}

/**
 * What a deploy changed against the one before it: up to three `key value`
 * pairs then `+n`. Read through the current schemas, so a namespace that
 * vanished reads as its keys returning to their defaults.
 */
export function summarize(row: DeployRow, previous: DeployRow | undefined): string {
  if (!previous) return 'first recorded';
  const changes: string[] = [];
  for (const namespace of KNOWN_NAMESPACES) {
    const schema = schemaFor(namespace);
    if (!schema) continue;
    const now = mergeSettings(schema, row.namespaces[namespace]);
    for (const key of diffKeys(schema, previous.namespaces[namespace], row.namespaces[namespace])) {
      changes.push(`${key} ${formatValue(now[key])}`);
    }
  }
  if (changes.length === 0) return 'no dial changes';
  const shown = changes.slice(0, SUMMARY_MAX);
  if (changes.length > SUMMARY_MAX) shown.push(`+${changes.length - SUMMARY_MAX}`);
  return shown.join(' · ');
}

/** Effective-value equality over every namespace this build knows. */
export function profileEquals(
  a: Record<string, SettingsValues> | undefined,
  b: Record<string, SettingsValues> | undefined,
): boolean {
  if (!a || !b) return false;
  for (const namespace of KNOWN_NAMESPACES) {
    const schema = schemaFor(namespace);
    if (!schema) continue;
    if (diffKeys(schema, a[namespace], b[namespace]).length > 0) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/studio/deploySummary.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/deploy-history ] && \
git add app/studio/deploySummary.ts app/studio/deploySummary.test.ts && \
git commit -m "feat(studio): deploy summary — what changed since the previous deploy"
```

---

### Task 8: DeployHistory component, wired into both studios

**Files:**
- Create: `app/studio/DeployHistory.tsx`
- Test: `app/studio/DeployHistory.test.tsx`
- Modify: `app/studio/DeployButton.tsx` (label rename)
- Modify: `app/studio/StudioClient.tsx:190-197` and `app/studio/solo/SoloStudioClient.tsx:58` (deploy slot)

**Interfaces:**
- Consumes: `StudioSettingsApi` (Task 6), `summarize`/`profileEquals` (Task 7)
- Produces: `DeployHistory({ api }: { api: StudioSettingsApi })`

- [ ] **Step 1: Write the failing tests**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { StudioSettingsApi } from './useStudioSettings';
import type { DeployRow } from '@/app/lib/settings/deploys';

vi.mock('@/app/components/mosaic/registry', () => ({
  MOSAIC_SETTINGS_SCHEMAS: {
    v1: [{ key: 'floorPx', kind: 'number', min: 20, max: 800, step: 10, default: 100, label: 'floor', description: '', section: 's' }],
  },
}));

import { DeployHistory } from './DeployHistory';

const deploys: DeployRow[] = [
  { id: 2, label: 'opening night', namespaces: { v1: { floorPx: 140 } }, deployedAt: '2026-09-05T18:30:00.000Z' },
  { id: 1, label: null, namespaces: {}, deployedAt: '2026-09-05T17:00:00.000Z' },
];

function api(over: Partial<StudioSettingsApi> = {}): StudioSettingsApi {
  return {
    loading: false,
    studio: { namespaces: { v1: { floorPx: 140 } }, revision: 1 },
    live: { namespaces: {}, revision: 1 },
    lastPollAt: null, liveRevision: 1,
    effective: () => ({}), setKnob: vi.fn(), resetSection: vi.fn(), applyNamespace: () => [],
    diffByNamespace: {}, diffCount: 1,
    deploy: async () => {}, revert: async () => {}, deployedAtMs: null, droppedKeys: [],
    deploys, loadDeploy: vi.fn(async () => []), relabelDeploy: vi.fn(async () => {}), lastDeployRecorded: null,
    ...over,
  };
}

describe('DeployHistory', () => {
  it('lists deploys newest first with number, label, summary, and the glass/studio badges', () => {
    render(<DeployHistory api={api()} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('#2');
    expect(rows[0]).toHaveTextContent('opening night');
    expect(rows[0]).toHaveTextContent('floorPx 140');
    expect(rows[0]).toHaveTextContent('studio');
    expect(rows[1]).toHaveTextContent('#1');
    expect(rows[1]).toHaveTextContent('first recorded');
    expect(rows[1]).toHaveTextContent('glass');
    expect(rows[0]).not.toHaveTextContent('glass');
  });

  it('clicking a row loads it into the studio and reports a partial fit', async () => {
    const loadDeploy = vi.fn(async () => [{ namespace: 'v1', key: 'ghost', reason: 'unknown' as const }]);
    render(<DeployHistory api={api({ loadDeploy, deploys: [{ ...deploys[0], namespaces: { v1: { floorPx: 140, ghost: 1 } } }] })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load deploy #2/i })); });
    expect(loadDeploy).toHaveBeenCalledWith(2);
    expect(screen.getByText('loaded, 1 of 2 keys fit the current schema')).toBeInTheDocument();
  });

  it('a 404 on load reads as gone', async () => {
    const loadDeploy = vi.fn(async () => { throw new Error('load deploy failed: 404'); });
    render(<DeployHistory api={api({ loadDeploy })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load deploy #1/i })); });
    expect(screen.getByText('gone')).toBeInTheDocument();
  });

  it('the label is edited inline: Enter saves, Escape cancels', async () => {
    const relabelDeploy = vi.fn(async () => {});
    render(<DeployHistory api={api({ relabelDeploy })} />);
    fireEvent.click(screen.getByRole('button', { name: /label deploy #1/i }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'before the show' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(relabelDeploy).toHaveBeenCalledWith(1, 'before the show');
    fireEvent.click(screen.getByRole('button', { name: /label deploy #2/i }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(relabelDeploy).toHaveBeenCalledTimes(1);
  });

  it('says when the last deploy was not recorded', () => {
    render(<DeployHistory api={api({ lastDeployRecorded: false })} />);
    expect(screen.getByText(/history not recorded/)).toBeInTheDocument();
  });

  it('renders nothing but the heading when there are no deploys', () => {
    render(<DeployHistory api={api({ deploys: [] })} />);
    expect(screen.getByText('deploys')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/studio/DeployHistory.test.tsx`
Expected: FAIL, cannot resolve `./DeployHistory`.

- [ ] **Step 3: Write the component**

```tsx
'use client';

import { useState } from 'react';
import type { StudioSettingsApi } from './useStudioSettings';
import type { DeployRow } from '@/app/lib/settings/deploys';
import { profileEquals, summarize } from './deploySummary';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const LABEL_MAX = 60;

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function keyCount(row: DeployRow): number {
  return Object.values(row.namespaces).reduce((n, values) => n + Object.keys(values ?? {}).length, 0);
}

function Badge({ children, color }: { children: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 999, marginLeft: 4,
      border: `1px solid ${color}`, color, textTransform: 'uppercase', letterSpacing: '.04em',
    }}>{children}</span>
  );
}

/**
 * Every recorded Deploy, newest first, under the Deploy button (spec §2.5).
 * Click a row to put that deploy into the studio; Deploy then sends it to
 * the glass. Nothing here touches live.
 */
export function DeployHistory({ api }: { api: StudioSettingsApi }) {
  const { deploys, studio, live, loadDeploy, relabelDeploy, lastDeployRecorded } = api;
  const [editing, setEditing] = useState<{ id: number; draft: string } | null>(null);
  const [note, setNote] = useState<{ id: number; text: string } | null>(null);

  const load = async (row: DeployRow) => {
    setNote(null);
    try {
      const dropped = await loadDeploy(row.id);
      if (dropped.length > 0) {
        const total = keyCount(row);
        setNote({ id: row.id, text: `loaded, ${total - dropped.length} of ${total} keys fit the current schema` });
      }
    } catch (e) {
      setNote({ id: row.id, text: /404/.test(String(e)) ? 'gone' : 'load failed' });
    }
  };

  const saveLabel = async () => {
    if (!editing) return;
    const label = editing.draft.trim().slice(0, LABEL_MAX) || null;
    setEditing(null);
    try {
      await relabelDeploy(editing.id, label);
    } catch {
      setNote({ id: editing.id, text: 'rename failed' });
    }
  };

  return (
    <section style={{ marginTop: 10, fontFamily: mono, fontSize: 11 }}>
      <h4 style={{ margin: '0 0 4px', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8b95a7' }}
        title="Every Deploy, newest first. Click one to load it into the studio; Deploy then sends it to the glass.">
        deploys
      </h4>
      {lastDeployRecorded === false && (
        <div style={{ color: '#e5484d', marginBottom: 4 }}>history not recorded (table missing?)</div>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 260, overflowY: 'auto' }}>
        {deploys.map((row, i) => {
          const onGlass = profileEquals(row.namespaces, live?.namespaces);
          const inStudio = profileEquals(row.namespaces, studio?.namespaces);
          const isEditing = editing?.id === row.id;
          return (
            <li key={row.id} style={{ borderTop: '1px solid #1d2432', padding: '4px 0' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <button type="button" onClick={() => void load(row)} aria-label={`load deploy #${row.id} into the studio`}
                  title="Load into the studio (undeployed studio edits are discarded)"
                  style={{ background: 'transparent', border: 0, padding: 0, color: '#e5e7eb', fontFamily: mono, fontSize: 11, cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: 0 }}>
                  <b style={{ color: '#f5a344' }}>#{row.id}</b>
                  <span style={{ color: '#6b7280', marginLeft: 6 }}>{when(row.deployedAt)}</span>
                  <span style={{ display: 'block', color: '#9aa3b2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {summarize(row, deploys[i + 1])}
                  </span>
                </button>
                <span style={{ whiteSpace: 'nowrap' }}>
                  {onGlass && <Badge color="#7ee2ac">glass</Badge>}
                  {inStudio && <Badge color="#f5a344">studio</Badge>}
                </span>
              </div>
              {isEditing ? (
                <input autoFocus value={editing.draft} maxLength={LABEL_MAX} aria-label={`label for deploy #${row.id}`}
                  onChange={(e) => setEditing({ id: row.id, draft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveLabel();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={() => setEditing(null)}
                  style={{ width: '100%', marginTop: 2, background: '#0b0e14', color: '#e5e7eb', border: '1px solid #2a3242', borderRadius: 4, fontFamily: mono, fontSize: 11, padding: '2px 4px' }} />
              ) : (
                <button type="button" onClick={() => setEditing({ id: row.id, draft: row.label ?? '' })}
                  aria-label={`label deploy #${row.id}`} title="Click to rename"
                  style={{ background: 'transparent', border: 0, padding: 0, color: row.label ? '#c3cad6' : '#4b5568', fontFamily: mono, fontSize: 11, cursor: 'text', fontStyle: row.label ? 'normal' : 'italic' }}>
                  {row.label ?? 'add a label'}
                </button>
              )}
              {note?.id === row.id && <div style={{ color: '#f5a344', marginTop: 2 }}>{note.text}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app/studio/DeployHistory.test.tsx`
Expected: 6 passed. If the Escape case fails because `onBlur` fired first, that is fine behaviour but the test asserts `relabelDeploy` was called once, which still holds; if the textbox lingers, remove the `onBlur` handler (Escape and Enter are the two exits the spec names).

- [ ] **Step 5: Rename the revert button and wire the component in**

In `app/studio/DeployButton.tsx`, change the last button's text:

```tsx
        {revertFailed ? 'revert failed — try again' : '↩ discard changes'}
```

Run: `grep -rn "revert to glass" app --include='*.tsx' --include='*.ts'` and update any test string to `discard changes`.

In `app/studio/StudioClient.tsx`, the full-rail deploy slot (around line 190) becomes:

```tsx
            deploySlot={
              <>
                <DeployButton
                  diffCount={settingsApi.diffCount}
                  onDeploy={settingsApi.deploy}
                  onRevert={settingsApi.revert}
                />
                <DeployHistory api={settingsApi} />
              </>
            }
```

with `import { DeployHistory } from './DeployHistory';` beside the `DeployButton` import. Leave the compact pill (around line 285) alone.

In `app/studio/solo/SoloStudioClient.tsx` line 58:

```tsx
        <SoloRail api={api} deploySlot={<><DeployButton diffCount={api.diffCount} onDeploy={api.deploy} onRevert={api.revert} /><DeployHistory api={api} /></>} />
```

with `import { DeployHistory } from '../DeployHistory';`.

- [ ] **Step 6: Run the whole suite, lint, and type-check**

Run: `npm run test 2>&1 | tail -6 && npm run lint 2>&1 | tail -3 && npx tsc --noEmit -p . 2>&1 | head -5`
Expected: all tests pass, lint clean, tsc silent.

- [ ] **Step 7: Commit**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/deploy-history ] && \
git add app/studio/DeployHistory.tsx app/studio/DeployHistory.test.tsx app/studio/DeployButton.tsx app/studio/StudioClient.tsx app/studio/solo/SoloStudioClient.tsx && \
git commit -m "feat(studio): deploy history under the Deploy button; revert reads as discard changes"
```

---

### Task 9: Smoke on a dev server, spec touch-up, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-studio-deploy-history-and-solo-preview-design.md` §2.5 (two wording fixes below)

- [ ] **Step 1: Spec wording matches what was built**

In §2.5 replace the sentence about namespaces appearing/disappearing (`… is listed as \`v4 reset\``) with: "A namespace that disappears reads as its keys returning to their default values." Replace "the row shows `gone` and the list revalidates" in §4 with "the row shows `gone`; the list refreshes within 30 s."

- [ ] **Step 2: Dev-server smoke (the table does not exist yet in prod, so this exercises the null path)**

Run: `npm run dev` (it picks a free port; note it), then in another command:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:<port>/api/kiosk/deploys
```

Expected: `403` (owner gate), which proves the route mounts. Open `/studio` signed in: the rail shows the `deploys` heading with no rows and the button reads "↩ discard changes". Stop the dev server.

- [ ] **Step 3: Commit, push, open the PR**

```bash
[ "$(git rev-parse --abbrev-ref HEAD)" = feat/deploy-history ] && \
git add docs/superpowers/specs/2026-09-05-studio-deploy-history-and-solo-preview-design.md && \
git commit -m "docs(spec): deploy history wording matches the build" && \
git push -u origin feat/deploy-history
```

PR title: `feat(studio): deploy history — every Deploy is a numbered snapshot you can load back`. Body: the spec's §1 in three sentences, the migration line Jesse must run before merging (`node scripts/apply-migration.mjs database/migrations/20260905_kiosk_deploys.sql --apply`), and a note that Part B (solo preview) follows PR #134 in its own PR.
