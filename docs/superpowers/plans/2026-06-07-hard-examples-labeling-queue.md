# Hard Examples — Unified Labeling Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One fast, keyboard-driven labeling queue over webcam + Flickr disagreement frames that writes an operator gold-label set (`manual_labels`) for v5 training, with blind-then-reveal, a queue/grid view toggle, a source filter, and a provenance badge.

**Architecture:** A new `manual_labels` table is the single gold-label store (replacing the use of `webcam_snapshot_ratings.is_sunset_verdict` for operator verdicts). The existing union disagreements read (`mode=verification` in `app/api/snapshots/route.ts`) becomes the queue data source — upgraded to exclude already-labeled frames, expose provenance, and accept a source filter. A new owner-gated `POST/DELETE /api/manual-labels` route persists labels. A new `HardExamplesQueue` client component reuses `SnapshotQueueCard` for the blind rating UI, adds the three controls + reveal panel, and writes labels. The old webcam-only Hard Examples tab and the read-only Verification tab are retired into this one tab.

**Tech Stack:** Next.js (app router), TypeScript, `@neondatabase/serverless` (`sql` tagged template), Postgres (Neon), Vitest (mocking `sql`), MUI, `requireOwner` (Auth.js).

**Spec:** `docs/superpowers/specs/2026-06-07-hard-examples-labeling-queue-design.md`

**Branch:** Implement on a fresh branch off `main` after PR #47 merges (so it's a clean PR). Use the `superpowers:using-git-worktrees` skill at execution time.

---

## File structure

- **Create** `database/migrations/20260608_manual_labels.sql` — gold-label table + verdict backfill.
- **Create** `app/lib/provenance.ts` (+ test) — derive `flickr | archive_trained | archive_new` from source + captured_at.
- **Create** `app/lib/manualLabels.ts` (+ test) — `upsertManualLabel`, `deleteManualLabel`, `fetchLabeledKeys`.
- **Create** `app/api/manual-labels/route.ts` (+ test) — owner-gated POST (upsert) / DELETE (undo).
- **Modify** `app/lib/masterConfig.ts` — add `V4_TRAINING_CUTOFF`.
- **Modify** `app/api/snapshots/route.ts` (+ `route.test.ts`) — verification read: manual_labels exclusion (both legs), `provenance` in response, `source` filter param.
- **Create** `app/components/HardExamples/HardExamplesQueue.tsx` — the unified queue (data + controls + SnapshotQueueCard + reveal + manual_labels write).
- **Modify** `app/HomeClient.tsx` — point the "Hard Examples" tab at `HardExamplesQueue`; remove the `verify` tab + `VerificationTab` import.
- **Delete** `app/components/Verification/VerificationTab.tsx` — folded into HardExamplesQueue.

---

## Task 1: `manual_labels` migration + verdict backfill

**Files:**
- Create: `database/migrations/20260608_manual_labels.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Operator gold-label set for v5 training (plan: hard-examples labeling queue).
-- One row per (source, image_id) — the operator's adjudication of a hard /
-- disagreement frame. Distinct from webcam_snapshot_ratings (public crowd
-- ratings); that idea is retired. Forward-only, idempotent.
--   psql "$DATABASE_URL" -f database/migrations/20260608_manual_labels.sql

CREATE TABLE IF NOT EXISTS manual_labels (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('webcam', 'flickr')),
  image_id    BIGINT NOT NULL,
  is_sunset   BOOLEAN NOT NULL,
  rating      INT CHECK (rating BETWEEN 1 AND 5),
  origin      TEXT NOT NULL DEFAULT 'hard_example',
  labeled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, image_id)
);

-- Carry over existing operator verdicts from the old blind Hard Examples queue.
INSERT INTO manual_labels (source, image_id, is_sunset, rating, origin, labeled_at)
SELECT 'webcam', snapshot_id, is_sunset_verdict, rating, 'hard_example', created_at
FROM webcam_snapshot_ratings
WHERE is_sunset_verdict IS NOT NULL
ON CONFLICT (source, image_id) DO NOTHING;
```

- [ ] **Step 2: Validate against prod in a rolled-back transaction**

Run:
```bash
DB=$(grep -E '^DATABASE_URL=' .env.production.local | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')
( echo 'BEGIN;'; cat database/migrations/20260608_manual_labels.sql; cat database/migrations/20260608_manual_labels.sql; echo 'ROLLBACK;' ) | psql "$DB" -v ON_ERROR_STOP=1
```
Expected: `CREATE TABLE` / `INSERT 0 N` then on the 2nd pass `NOTICE: relation "manual_labels" already exists, skipping` and `ROLLBACK`; exit 0 (idempotent, no error).

- [ ] **Step 3: Commit**

```bash
git add database/migrations/20260608_manual_labels.sql
git commit -m "feat(db): manual_labels gold-label table + verdict backfill"
```

*(Apply to prod with explicit owner approval at execution time — additive/idempotent, same pattern as prior migrations.)*

---

## Task 2: `V4_TRAINING_CUTOFF` + provenance helper

**Files:**
- Modify: `app/lib/masterConfig.ts`
- Create: `app/lib/provenance.ts`
- Test: `app/lib/provenance.test.ts`

- [ ] **Step 1: Add the cutoff constant**

In `app/lib/masterConfig.ts`, add near the other AI constants:
```ts
// v4 training data export date. Webcam frames captured after this were NOT in
// v4 training (highest-value new labels); before is the trained-era archive.
// Approximate: exact membership would require the v4 manifest (deferred).
export const V4_TRAINING_CUTOFF = '2026-05-13';
```

- [ ] **Step 2: Write the failing test**

`app/lib/provenance.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deriveProvenance } from './provenance';

describe('deriveProvenance', () => {
  it('returns flickr for external rows regardless of date', () => {
    expect(deriveProvenance('flickr', '2026-04-01T00:00:00Z')).toBe('flickr');
    expect(deriveProvenance('flickr', null)).toBe('flickr');
  });
  it('returns archive_new for webcam frames captured after the v4 cutoff', () => {
    expect(deriveProvenance('windy', '2026-06-01T00:00:00Z')).toBe('archive_new');
  });
  it('returns archive_trained for webcam frames captured on/before the cutoff', () => {
    expect(deriveProvenance('windy', '2026-05-01T00:00:00Z')).toBe('archive_trained');
  });
  it('treats a null captured_at as trained-era (conservative)', () => {
    expect(deriveProvenance('windy', null)).toBe('archive_trained');
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `npx vitest run app/lib/provenance.test.ts`
Expected: FAIL — `deriveProvenance` is not exported / module missing.

- [ ] **Step 4: Implement**

`app/lib/provenance.ts`:
```ts
import { V4_TRAINING_CUTOFF } from './masterConfig';

export type Provenance = 'flickr' | 'archive_trained' | 'archive_new';

/**
 * Where a queued frame came from, for the operator badge:
 *  - flickr           → external_images
 *  - archive_new      → webcam frame captured AFTER v4 training (untrained)
 *  - archive_trained  → webcam frame from the v4 training era (approx; see cutoff)
 */
export function deriveProvenance(
  source: string,
  capturedAt: string | null,
): Provenance {
  if (source === 'flickr') return 'flickr';
  if (capturedAt && new Date(capturedAt) > new Date(V4_TRAINING_CUTOFF)) {
    return 'archive_new';
  }
  return 'archive_trained';
}
```

- [ ] **Step 5: Run it — verify it passes**

Run: `npx vitest run app/lib/provenance.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/lib/masterConfig.ts app/lib/provenance.ts app/lib/provenance.test.ts
git commit -m "feat(labels): V4_TRAINING_CUTOFF + deriveProvenance helper"
```

---

## Task 3: `manual_labels` DB helpers

**Files:**
- Create: `app/lib/manualLabels.ts`
- Test: `app/lib/manualLabels.test.ts`

- [ ] **Step 1: Write the failing test**

`app/lib/manualLabels.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { upsertManualLabel, deleteManualLabel } from './manualLabels';

beforeEach(() => sqlMock.mockReset().mockResolvedValue([]));

describe('upsertManualLabel', () => {
  it('upserts on (source, image_id) and stamps labeled_at', async () => {
    await upsertManualLabel({ source: 'flickr', imageId: 7, isSunset: true, rating: 4 });
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/insert\s+into\s+manual_labels/i);
    expect(q).toMatch(/on\s+conflict\s*\(source,\s*image_id\)\s+do\s+update/i);
    expect(q).toMatch(/labeled_at\s*=\s*now\(\)/i);
    expect(values).toContain('flickr');
    expect(values).toContain(7);
    expect(values).toContain(true);
    expect(values).toContain(4);
  });
  it('passes null rating when omitted', async () => {
    await upsertManualLabel({ source: 'webcam', imageId: 9, isSunset: false });
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain(null);
  });
});

describe('deleteManualLabel', () => {
  it('deletes the (source, image_id) row', async () => {
    await deleteManualLabel('webcam', 9);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/delete\s+from\s+manual_labels/i);
    expect(values).toContain('webcam');
    expect(values).toContain(9);
  });
});

```

*(Queue exclusion is done in SQL in the read — Task 5 — via `NOT IN (SELECT image_id FROM manual_labels WHERE source = …)`, so no JS key-set helper is needed here.)*

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run app/lib/manualLabels.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

`app/lib/manualLabels.ts`:
```ts
import { sql } from '@/app/lib/db';

export type LabelSource = 'webcam' | 'flickr';

export async function upsertManualLabel(opts: {
  source: LabelSource;
  imageId: number;
  isSunset: boolean;
  rating?: number | null;
}): Promise<void> {
  await sql`
    INSERT INTO manual_labels (source, image_id, is_sunset, rating)
    VALUES (${opts.source}, ${opts.imageId}, ${opts.isSunset}, ${opts.rating ?? null})
    ON CONFLICT (source, image_id) DO UPDATE
      SET is_sunset = EXCLUDED.is_sunset,
          rating = EXCLUDED.rating,
          labeled_at = now()
  `;
}

export async function deleteManualLabel(
  source: LabelSource,
  imageId: number,
): Promise<void> {
  await sql`
    DELETE FROM manual_labels WHERE source = ${source} AND image_id = ${imageId}
  `;
}

```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run app/lib/manualLabels.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/manualLabels.ts app/lib/manualLabels.test.ts
git commit -m "feat(labels): manual_labels DB helpers (upsert/delete/fetchKeys)"
```

---

## Task 4: `POST/DELETE /api/manual-labels` route

**Files:**
- Create: `app/api/manual-labels/route.ts`
- Test: `app/api/manual-labels/route.test.ts`

- [ ] **Step 1: Write the failing test**

`app/api/manual-labels/route.test.ts`:
```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
const upsertMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));
vi.mock('@/app/lib/manualLabels', () => ({
  upsertManualLabel: (...a: unknown[]) => upsertMock(...a),
  deleteManualLabel: (...a: unknown[]) => deleteMock(...a),
}));

import { POST, DELETE } from './route';

const post = (body: unknown) =>
  new Request('http://test/api/manual-labels', {
    method: 'POST',
    body: JSON.stringify(body),
  });

beforeEach(() => {
  requireOwnerMock.mockReset().mockResolvedValue(null); // owner
  upsertMock.mockReset().mockResolvedValue(undefined);
  deleteMock.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/manual-labels', () => {
  it('gates on owner before writing', async () => {
    requireOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'no' }, { status: 401 }),
    );
    const res = await POST(post({ source: 'flickr', imageId: 1, isSunset: true }));
    expect(res.status).toBe(401);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('upserts a valid label', async () => {
    const res = await POST(
      post({ source: 'flickr', imageId: 7, isSunset: true, rating: 4 }),
    );
    expect(res.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith({
      source: 'flickr',
      imageId: 7,
      isSunset: true,
      rating: 4,
    });
  });

  it('rejects a bad source', async () => {
    const res = await POST(post({ source: 'nope', imageId: 1, isSunset: true }));
    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range rating', async () => {
    const res = await POST(
      post({ source: 'webcam', imageId: 1, isSunset: true, rating: 9 }),
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/manual-labels', () => {
  it('removes a label (owner-gated)', async () => {
    const req = new Request('http://test/api/manual-labels', {
      method: 'DELETE',
      body: JSON.stringify({ source: 'webcam', imageId: 9 }),
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalledWith('webcam', 9);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run app/api/manual-labels/route.test.ts`
Expected: FAIL — `./route` missing.

- [ ] **Step 3: Implement**

`app/api/manual-labels/route.ts`:
```ts
import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import {
  upsertManualLabel,
  deleteManualLabel,
  type LabelSource,
} from '@/app/lib/manualLabels';

export const dynamic = 'force-dynamic';

const SOURCES: LabelSource[] = ['webcam', 'flickr'];

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { source, imageId, isSunset, rating } = await request.json();
    if (!SOURCES.includes(source)) {
      return NextResponse.json({ error: 'bad source' }, { status: 400 });
    }
    if (typeof imageId !== 'number' || !Number.isInteger(imageId)) {
      return NextResponse.json({ error: 'bad imageId' }, { status: 400 });
    }
    if (typeof isSunset !== 'boolean') {
      return NextResponse.json({ error: 'isSunset required' }, { status: 400 });
    }
    if (
      rating != null &&
      (typeof rating !== 'number' || rating < 1 || rating > 5)
    ) {
      return NextResponse.json({ error: 'bad rating' }, { status: 400 });
    }
    await upsertManualLabel({ source, imageId, isSunset, rating: rating ?? null });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    const { source, imageId } = await request.json();
    if (!SOURCES.includes(source) || typeof imageId !== 'number') {
      return NextResponse.json({ error: 'bad request' }, { status: 400 });
    }
    await deleteManualLabel(source, imageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run app/api/manual-labels/route.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/manual-labels/route.ts app/api/manual-labels/route.test.ts
git commit -m "feat(api): owner-gated POST/DELETE /api/manual-labels"
```

---

## Task 5: Upgrade the verification read (exclusion + provenance + source filter)

**Files:**
- Modify: `app/api/snapshots/route.ts` (the `mode === 'verification'` branch)
- Modify: `app/api/snapshots/route.test.ts`

- [ ] **Step 1: Write the failing tests** (append to the verification describe block in `route.test.ts`)

```ts
  it('excludes frames already in manual_labels (per leg)', async () => {
    await GET(req('?mode=verification&disagreements_only=true'));
    const text = allText();
    expect(
      text.some((q) => /not in\s*\(\s*select image_id from manual_labels where source\s*=\s*'webcam'/i.test(q)),
    ).toBe(true);
    expect(
      text.some((q) => /not in\s*\(\s*select image_id from manual_labels where source\s*=\s*'flickr'/i.test(q)),
    ).toBe(true);
  });

  it('source=flickr filter queries only the external leg', async () => {
    await GET(req('?mode=verification&source=flickr'));
    const text = allText();
    expect(text.some((q) => /from\s+external_images\s+e/i.test(q))).toBe(true);
    expect(text.some((q) => /from\s+webcam_snapshots\s+s\b/i.test(q))).toBe(false);
  });

  it('attaches a provenance field to each returned snapshot', async () => {
    sqlMock.mockResolvedValue([
      { snapshot_id: 1, source: 'flickr', firebase_url: 'x', captured_at: '2026-04-01', snapshot: {} },
    ]);
    const res = await GET(req('?mode=verification'));
    const body = await res.json();
    expect(body.snapshots[0]).toHaveProperty('provenance');
  });
```

- [ ] **Step 2: Run them — verify they fail**

Run: `npx vitest run app/api/snapshots/route.test.ts`
Expected: FAIL — exclusion still references `webcam_snapshot_ratings`; no `source` filter; no `provenance` field.

- [ ] **Step 3: Implement** in the `mode === 'verification'` branch of `app/api/snapshots/route.ts`

3a. Parse the source filter near the top of the branch:
```ts
const sourceFilter = searchParams.get('source'); // 'webcam' | 'flickr' | null
```

3b. Replace the webcam-leg verdict exclusion (was `webcam_snapshot_ratings ... is_sunset_verdict`) and add the external-leg exclusion:
```ts
const webcamFilter = disagreementsOnly
  ? sql`AND s.model_disagreement_kind IS NOT NULL
        AND s.id NOT IN (SELECT image_id FROM manual_labels WHERE source = 'webcam')`
  : sql`AND s.id NOT IN (SELECT image_id FROM manual_labels WHERE source = 'webcam')`;
const externalFilter = disagreementsOnly
  ? sql`AND e.model_disagreement_kind IS NOT NULL
        AND e.id NOT IN (SELECT image_id FROM manual_labels WHERE source = 'flickr')`
  : sql`AND e.id NOT IN (SELECT image_id FROM manual_labels WHERE source = 'flickr')`;
```

3c. Gate each leg on the source filter (only run/merge the requested leg):
```ts
const webcamRows = sourceFilter === 'flickr' ? [] : (await sql`... existing webcam query ...`) as ...;
const externalRows = sourceFilter === 'webcam' ? [] : (await sql`... existing external query ...`) as ...;
```
Apply the same guard to the two COUNT queries (skip the suppressed leg's count, treat as 0).

3d. Attach provenance after transform. Add the import at the top of `route.ts`:
```ts
import { deriveProvenance } from '@/app/lib/provenance';
```
Then build the merged list with provenance:
```ts
const merged = [...webcamRows, ...externalRows]
  .sort((a, b) => Number(b.sort_key) - Number(a.sort_key))
  .slice(offset, offset + limit)
  .map((row) => {
    const snap = transformSnapshot(row);
    return {
      ...snap,
      provenance: deriveProvenance(row.source, row.captured_at ?? null),
    };
  });
```

- [ ] **Step 4: Run the suite — verify pass**

Run: `npx vitest run app/api/snapshots/route.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add app/api/snapshots/route.ts app/api/snapshots/route.test.ts
git commit -m "feat(api): verification read — manual_labels exclusion, provenance, source filter"
```

---

## Task 6: `HardExamplesQueue` component

**Files:**
- Create: `app/components/HardExamples/HardExamplesQueue.tsx`

This component is the unified queue. It reuses `SnapshotQueueCard` (blind rating UI), `RatingCard` (reveal panel), and writes via `/api/manual-labels`. There are no component tests in this repo; verify via tsc + lint + the manual run in Task 8. Keep logic (provenance badge label, label→leave) trivial and obvious.

- [ ] **Step 1: Implement the component**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Box, Typography, Switch, FormControlLabel, CircularProgress, Button,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { SnapshotQueueCard } from '@/app/components/SnapshotQueueCard';
import RatingCard from '@/app/components/Webcam/RatingCard';
import type { Snapshot, WindyWebcam } from '@/app/lib/types';
import type { Provenance } from '@/app/lib/provenance';

type QueuedSnapshot = Snapshot & { provenance: Provenance };

const PROVENANCE_LABEL: Record<Provenance, string> = {
  flickr: 'Flickr',
  archive_trained: 'Archive · trained',
  archive_new: 'Archive · new',
};

const labelSource = (s: Snapshot): 'webcam' | 'flickr' =>
  s.source === 'flickr' ? 'flickr' : 'webcam';

const frameToCard = (s: Snapshot): WindyWebcam =>
  ({ ...s, images: { current: { preview: s.snapshot.firebaseUrl } } } as unknown as WindyWebcam);

export function HardExamplesQueue({ hotkeysEnabled = true }: { hotkeysEnabled?: boolean }) {
  const [blind, setBlind] = useState(true);          // blind-then-reveal default
  const [view, setView] = useState<'queue' | 'grid'>('queue');
  const [source, setSource] = useState<'all' | 'webcam' | 'flickr'>('all');

  const [snapshots, setSnapshots] = useState<QueuedSnapshot[]>([]);
  const [total, setTotal] = useState(0);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);   // post-submit reveal in blind mode
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch (disagreements only — this IS the labeling queue).
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const srcParam = source === 'all' ? '' : `&source=${source}`;
    fetch(`/api/snapshots?mode=verification&disagreements_only=true&limit=200&offset=0${srcParam}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Owner sign-in required' : `Failed (${r.status})`);
        return r.json();
      })
      .then((d) => { if (!cancelled) { setSnapshots(d.snapshots ?? []); setTotal(d.total ?? 0); setIdx(0); setRevealed(false); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source]);

  const current = snapshots[idx];

  const advance = useCallback(() => { setRevealed(false); setIdx((i) => i + 1); }, []);

  const submitLabel = useCallback(async (rating: number, isSunset: boolean) => {
    if (!current) return;
    await fetch('/api/manual-labels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: labelSource(current),
        imageId: current.snapshot.id,
        isSunset,
        rating: isSunset ? rating : null,
      }),
    });
    if (blind && !revealed) { setRevealed(true); return; } // reveal first, then advance on next key
    advance();
  }, [current, blind, revealed, advance]);

  // SnapshotQueueCard contract: onRate(rating, { isSunsetVerdict }).
  const onRate = useCallback(async (rating: number, opts?: { isSunsetVerdict?: boolean }) => {
    await submitLabel(rating, opts?.isSunsetVerdict ?? rating > 0);
  }, [submitLabel]);

  const onSkip = useCallback(() => advance(), [advance]);
  const onUndo = useCallback(async () => {
    const prev = snapshots[idx - 1];
    if (!prev) return;
    await fetch('/api/manual-labels', {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: labelSource(prev), imageId: prev.snapshot.id }),
    });
    setRevealed(false); setIdx((i) => Math.max(0, i - 1));
  }, [snapshots, idx]);

  // Hotkeys (mirror SnapshotConsole): 1-5 rate, space skip, z undo. In blind mode
  // after a reveal, the next key advances.
  useEffect(() => {
    if (!hotkeysEnabled || view !== 'queue') return;
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (blind && revealed) { e.preventDefault(); advance(); return; }
      if (/^[1-5]$/.test(e.key)) { e.preventDefault(); void onRate(Number(e.key), { isSunsetVerdict: true }); }
      else if (e.key === '0' || e.key.toLowerCase() === 'n') { e.preventDefault(); void onRate(0, { isSunsetVerdict: false }); }
      else if (e.key === ' ') { e.preventDefault(); onSkip(); }
      else if (e.key.toLowerCase() === 'z') { e.preventDefault(); void onUndo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hotkeysEnabled, view, blind, revealed, onRate, onSkip, onUndo, advance]);

  const Badge = ({ s }: { s: QueuedSnapshot }) => (
    <Box sx={{ position: 'absolute', top: 18, left: 18, zIndex: 2, px: 1, py: 0.25,
      borderRadius: 1, fontSize: 11, fontWeight: 700, color: 'white',
      backgroundColor: s.provenance === 'flickr' ? 'rgba(124,58,237,0.85)' : 'rgba(0,0,0,0.72)' }}>
      {PROVENANCE_LABEL[s.provenance]}
    </Box>
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1, alignItems: 'center' }}>
        <FormControlLabel sx={{ color: 'white' }}
          control={<Switch checked={blind} onChange={(e) => setBlind(e.target.checked)} />}
          label="Blind (reveal after rating)" />
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
          <ToggleButton value="queue">Queue</ToggleButton>
          <ToggleButton value="grid">Grid</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup size="small" exclusive value={source} onChange={(_, v) => v && setSource(v)}>
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="webcam">Archive</ToggleButton>
          <ToggleButton value="flickr">Flickr</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" sx={{ color: '#9ca3af' }}>{total} flagged</Typography>
      </Box>

      {error ? <Typography sx={{ color: '#f87171' }}>{error}</Typography>
       : loading ? <CircularProgress size={20} sx={{ color: 'white' }} />
       : view === 'grid' ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {snapshots.map((s) => (
            <Box key={`${labelSource(s)}-${s.snapshot.id}`} sx={{ position: 'relative', width: 256 }}>
              <Badge s={s} />
              <RatingCard webcam={frameToCard(s)} readOnly onRate={async () => {}} />
            </Box>
          ))}
        </Box>
       ) : !current ? (
        <Typography sx={{ color: '#9ca3af' }}>No more flagged frames — all caught up.</Typography>
       ) : (
        <Box sx={{ position: 'relative', maxWidth: 420 }}>
          <Badge s={current} />
          {blind && !revealed ? (
            <SnapshotQueueCard snapshot={current} onRate={onRate} onSkip={onSkip} onUndo={onUndo} />
          ) : (
            // Reveal (blind→after submit) OR inspect mode (blind off): show the judges.
            <>
              <RatingCard webcam={frameToCard(current)} readOnly onRate={async () => {}} />
              {blind && revealed && (
                <Button sx={{ mt: 1, color: 'white' }} onClick={advance}>Next (any key)</Button>
              )}
              {!blind && (
                <SnapshotQueueCard snapshot={current} onRate={onRate} onSkip={onSkip} onUndo={onUndo} />
              )}
            </>
          )}
        </Box>
       )}
    </Box>
  );
}

export default HardExamplesQueue;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep HardExamplesQueue || echo clean`
Expected: `clean`. Fix any type errors (e.g. confirm `SnapshotQueueCard` is a named export; adjust import if it is default).

- [ ] **Step 3: Commit**

```bash
git add app/components/HardExamples/HardExamplesQueue.tsx
git commit -m "feat(ui): HardExamplesQueue — unified labeling queue (blind reveal, controls, manual_labels)"
```

---

## Task 7: Wire the tab; retire Verification

**Files:**
- Modify: `app/HomeClient.tsx`
- Delete: `app/components/Verification/VerificationTab.tsx`

- [ ] **Step 1: Swap the imports**

In `app/HomeClient.tsx`, replace:
```ts
import { VerificationTab } from './components/Verification/VerificationTab';
```
with:
```ts
import { HardExamplesQueue } from './components/HardExamples/HardExamplesQueue';
```

- [ ] **Step 2: Remove the `verify` tab entry**

In `ALL_TABS`, delete the line:
```ts
    { key: 'verify', label: '🔎 Verification', operatorOnly: true },
```

- [ ] **Step 3: Point the Hard Examples tab at the new queue + remove the verify block**

Replace the `{tabKey === 'hard' && (...)}` block body with:
```tsx
              {tabKey === 'hard' && (
                <Box>
                  <HardExamplesQueue hotkeysEnabled={drawerOpen} />
                </Box>
              )}
```
And delete the entire `{tabKey === 'verify' && ( ... )}` block.

- [ ] **Step 4: Delete the retired component**

```bash
git rm app/components/Verification/VerificationTab.tsx
```

- [ ] **Step 5: Typecheck + lint**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "HomeClient|HardExamplesQueue|VerificationTab" || echo clean
npx next lint --file app/HomeClient.tsx --file app/components/HardExamples/HardExamplesQueue.tsx
```
Expected: `clean`; no ESLint errors.

- [ ] **Step 6: Commit**

```bash
git add app/HomeClient.tsx
git commit -m "feat(ui): Hard Examples tab uses unified queue; retire Verification tab"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full suite + tsc**

Run: `npx vitest run` → all green. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → not higher than the pre-feature baseline.

- [ ] **Step 2: Manual run** (per the `run` skill)

Apply the migration to a dev DB (or prod with approval), `npm run dev`, sign in as owner, open the drawer → **Hard Examples**:
- A flagged frame shows blind with a provenance badge; press `1–5` (sunset+quality) or `N`/`0` (not sunset) → judges reveal → next key advances → frame is gone on reload (excluded via `manual_labels`).
- Toggle **Blind off** → judges show immediately (inspect); **Grid** → many at once; **source filter** narrows.
Confirm a row landed: `psql "$DATABASE_URL" -c "SELECT * FROM manual_labels ORDER BY labeled_at DESC LIMIT 3;"`

- [ ] **Step 3: Commit any fixes, push, open PR.**

---

## Notes for the implementer
- `sql` is the `@neondatabase/serverless` tagged template from `@/app/lib/db`; tests mock it (see `app/api/snapshots/route.test.ts` for the pattern).
- `requireOwner()` returns a `NextResponse` to return early, or `null` for the owner.
- Confirm whether `SnapshotQueueCard` is a named or default export and match the import (Task 6 Step 2).
- The migration is forward-only/manual; apply to prod only with explicit owner approval (additive + idempotent).
