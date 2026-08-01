# Gallery Cadence + Cost Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner-only Ops tab (cron health + provider cost curve + change markers + remote doze), plus presence-driven kiosk scoring: every-minute ticks while a gallery screen is watching, quiet hours, and doze controls.

**Architecture:** Three additive slices on the existing Next.js app. (C) Ops: an owner-gated `/api/admin/ops-stats` route reads `daily_sunset_stats` + two new tables (`provider_usage_daily`, `cost_events`); a new drawer tab renders them. Provider counters are captured once/UTC-day inside the existing `update-cameras` cron via the Neon API. (B) Kiosk: `/api/kiosk/tick` re-invokes the cron route's handler behind a Redis `NX PX` lock so at most one tick runs per minute regardless of how many screens poll; kiosk pages gain a runtime hook (visibility + quiet hours + local/remote doze) and a fade overlay. Spec: `docs/superpowers/specs/2026-07-31-gallery-cadence-and-cost-monitoring-design.md`.

**Tech Stack:** Next.js App Router (route handlers + client components), `@neondatabase/serverless` tagged-template `sql`, `@upstash/redis` via `app/lib/cache.ts`, MUI drawer tabs, inline SVG (no chart deps), vitest (jsdom default, `// @vitest-environment node` for routes).

## Global Constraints

- **No new npm dependencies.** Charts/sparklines are inline SVG.
- **TDD every code task**: failing test → implement → pass → commit. Runner is `vitest` (`npm test -- <file>` runs one file; `npx vitest run <file>` also works).
- Tests are **co-located** (`foo.test.ts` next to `foo.ts`); route tests start with `// @vitest-environment node`.
- **Migrations are manual, forward-only, idempotent** SQL in `database/migrations/YYYYMMDD_*.sql`, applied via `psql "$DATABASE_URL" -f <file>` BEFORE deploying code that uses them.
- **The dashboard must not create cost**: external Neon API called at most once per UTC day, from the cron tick; Ops tab reads only our own tables.
- **Redis budget**: kiosk adds ≤2 commands per poll-minute per screen; tick lock TTL `55_000` ms.
- Kiosk tick route: `maxDuration = 60`, and it MUST be added to `outputFileTracingIncludes` in `next.config.ts` AND to `MODEL_ROUTES` in `next.config.test.ts` (guard test fails otherwise).
- Quiet hours default **01:00–08:00 local**, URL-overridable (`?quiet=off`, `?quiet=23-9`); wake-on-interaction window **30 min**.
- The kiosk `d` key toggles **local-only** doze (kiosk URLs are public; local doze must not write shared state). Remote doze is the Redis flag, owner-gated writes only.
- Config constants live in `app/lib/masterConfig.ts`, SCREAMING_SNAKE_CASE with unit suffix and a why-comment (file is client+server importable — no secrets in it).
- Commit style: conventional commits (`feat:`, `chore:`, `docs:` …), matching repo history.

---

### Task 1: Owner-gated ops-stats API (daily stats slice)

**Files:**
- Create: `app/lib/opsTypes.ts`
- Create: `app/api/admin/ops-stats/route.ts`
- Test: `app/api/admin/ops-stats/route.test.ts`

**Interfaces:**
- Consumes: `requireOwner()` from `@/app/lib/owner` (returns `NextResponse | null`); `sql` from `@/app/lib/db`.
- Produces: `GET /api/admin/ops-stats` → `200 { dailyStats: DailyStatsRow[], providerUsage: [], costEvents: [] }` (the two empty arrays are filled by Task 8). `DailyStatsRow` type exported from `app/lib/opsTypes.ts`:

```ts
export interface DailyStatsRow {
  date: string; // 'YYYY-MM-DD'
  model_version: string;
  webcams_scored: number;
  cache_hits: number;
  fallbacks: number;
  score_p50: number | null;
  score_p90: number | null;
  source_breakdown: Record<string, { scored: number; avg: number | null }> | null;
}
```

- [ ] **Step 1: Write the failing test**

`app/api/admin/ops-stats/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { GET } from './route';

describe('GET /api/admin/ops-stats', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    sqlMock.mockReset();
  });

  it('returns 403 when requireOwner denies', async () => {
    requireOwnerMock.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await GET();
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns last daily stats rows for the owner', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    sqlMock.mockResolvedValueOnce([
      {
        date: '2026-07-30',
        model_version: 'v4',
        webcams_scored: 500,
        cache_hits: 400,
        fallbacks: 2,
        score_p50: 0.31,
        score_p90: 0.71,
        source_breakdown: { windy: { scored: 480, avg: 0.4 } },
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dailyStats).toHaveLength(1);
    expect(body.dailyStats[0].date).toBe('2026-07-30');
    expect(body.providerUsage).toEqual([]);
    expect(body.costEvents).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/admin/ops-stats/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Write the implementation**

`app/lib/opsTypes.ts`:

```ts
// Shared shapes for the owner-only Ops tab. Kept out of the route file so the
// client component can import types without pulling server code.
export interface DailyStatsRow {
  date: string; // 'YYYY-MM-DD'
  model_version: string;
  webcams_scored: number;
  cache_hits: number;
  fallbacks: number;
  score_p50: number | null;
  score_p90: number | null;
  source_breakdown: Record<
    string,
    { scored: number; avg: number | null }
  > | null;
}

export interface ProviderUsageRow {
  day: string; // 'YYYY-MM-DD'
  project_id: string;
  compute_time_s: number;
}

export interface CostEventRow {
  occurred_on: string; // 'YYYY-MM-DD'
  sha: string | null;
  description: string;
}

export interface OpsStatsResponse {
  dailyStats: DailyStatsRow[];
  providerUsage: ProviderUsageRow[];
  costEvents: CostEventRow[];
}
```

`app/api/admin/ops-stats/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { sql } from '@/app/lib/db';
import { OPS_STATS_DAYS } from '@/app/lib/masterConfig';
import type { DailyStatsRow, OpsStatsResponse } from '@/app/lib/opsTypes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const rows = (await sql`
    SELECT date::text AS date, model_version, webcams_scored, cache_hits,
           fallbacks, score_p50::float, score_p90::float, source_breakdown
    FROM daily_sunset_stats
    ORDER BY date DESC
    LIMIT ${OPS_STATS_DAYS}
  `) as unknown as DailyStatsRow[];

  const body: OpsStatsResponse = {
    dailyStats: rows.reverse(), // oldest → newest for charting
    providerUsage: [],
    costEvents: [],
  };
  return NextResponse.json(body);
}
```

Add to `app/lib/masterConfig.ts` (new banner section at the end):

```ts
// ---------------------------------------------------------------------------
// Ops tab (owner-only cost/health panel in the drawer)
// ---------------------------------------------------------------------------
// How many daily_sunset_stats rows the Ops tab shows. Two weeks reads well as
// sparklines; the query is one cheap indexed scan on the PK.
export const OPS_STATS_DAYS = 14;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/admin/ops-stats/route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/lib/opsTypes.ts app/api/admin/ops-stats/ app/lib/masterConfig.ts
git commit -m "feat(ops): owner-gated ops-stats API returning daily_sunset_stats"
```

---

### Task 2: Pure ops math helpers

**Files:**
- Create: `app/components/Ops/opsMath.ts`
- Test: `app/components/Ops/opsMath.test.ts`

**Interfaces:**
- Produces:
  - `pct(numerator: number, denominator: number): number | null` — percentage 0–100 rounded to 1 decimal; `null` when denominator is 0.
  - `deriveDailyDeltas(rows: ProviderUsageRow[]): { day: string; project_id: string; computeHours: number }[]` — per-project day-over-day delta of the month-to-date `compute_time_s` counter, in hours. First row per project is skipped (no baseline). A negative delta means the counter reset at month start — use the raw value instead.

- [ ] **Step 1: Write the failing test**

`app/components/Ops/opsMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pct, deriveDailyDeltas } from './opsMath';

describe('pct', () => {
  it('computes a rounded percentage', () => {
    expect(pct(400, 500)).toBe(80);
    expect(pct(1, 3)).toBe(33.3);
  });
  it('returns null for a zero denominator', () => {
    expect(pct(5, 0)).toBeNull();
  });
});

describe('deriveDailyDeltas', () => {
  const P = 'noisy-leaf-96391119';
  it('derives per-day compute hours from month-to-date counters', () => {
    const out = deriveDailyDeltas([
      { day: '2026-08-01', project_id: P, compute_time_s: 36000 }, // 10h MTD
      { day: '2026-08-02', project_id: P, compute_time_s: 72000 }, // 20h MTD
    ]);
    expect(out).toEqual([
      { day: '2026-08-02', project_id: P, computeHours: 10 },
    ]);
  });
  it('uses the raw value on month rollover (counter reset)', () => {
    const out = deriveDailyDeltas([
      { day: '2026-08-31', project_id: P, compute_time_s: 900000 },
      { day: '2026-09-01', project_id: P, compute_time_s: 18000 }, // reset, 5h
    ]);
    expect(out).toEqual([
      { day: '2026-09-01', project_id: P, computeHours: 5 },
    ]);
  });
  it('keeps projects independent', () => {
    const out = deriveDailyDeltas([
      { day: '2026-08-01', project_id: 'a', compute_time_s: 3600 },
      { day: '2026-08-01', project_id: 'b', compute_time_s: 7200 },
      { day: '2026-08-02', project_id: 'a', compute_time_s: 7200 },
      { day: '2026-08-02', project_id: 'b', compute_time_s: 7200 },
    ]);
    expect(out).toEqual([
      { day: '2026-08-02', project_id: 'a', computeHours: 1 },
      { day: '2026-08-02', project_id: 'b', computeHours: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/Ops/opsMath.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

`app/components/Ops/opsMath.ts`:

```ts
import type { ProviderUsageRow } from '@/app/lib/opsTypes';

export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// provider_usage_daily stores Neon's month-to-date counters (that is all the
// non-Scale API exposes), so per-day usage is the day-over-day delta. A
// negative delta means the month rolled over and the counter reset — the raw
// value IS that day's usage.
export function deriveDailyDeltas(
  rows: ProviderUsageRow[],
): { day: string; project_id: string; computeHours: number }[] {
  const byProject = new Map<string, ProviderUsageRow[]>();
  for (const row of rows) {
    const list = byProject.get(row.project_id) ?? [];
    list.push(row);
    byProject.set(row.project_id, list);
  }
  const out: { day: string; project_id: string; computeHours: number }[] = [];
  for (const list of byProject.values()) {
    const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
    for (let i = 1; i < sorted.length; i++) {
      const delta = sorted[i].compute_time_s - sorted[i - 1].compute_time_s;
      const seconds = delta < 0 ? sorted[i].compute_time_s : delta;
      out.push({
        day: sorted[i].day,
        project_id: sorted[i].project_id,
        computeHours: Math.round((seconds / 3600) * 100) / 100,
      });
    }
  }
  return out.sort(
    (a, b) => a.day.localeCompare(b.day) || a.project_id.localeCompare(b.project_id),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/components/Ops/opsMath.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add app/components/Ops/opsMath.ts app/components/Ops/opsMath.test.ts
git commit -m "feat(ops): pure helpers — pct and provider-usage daily deltas"
```

---

### Task 3: Sparkline + OpsPanels (daily stats UI)

**Files:**
- Create: `app/components/Ops/Sparkline.tsx`
- Create: `app/components/Ops/OpsPanels.tsx`
- Create: `app/components/Ops/OpsTab.tsx`
- Test: `app/components/Ops/OpsPanels.test.tsx`

**Interfaces:**
- Consumes: `DailyStatsRow`, `OpsStatsResponse` from `@/app/lib/opsTypes`; `pct` from `./opsMath`.
- Produces:
  - `Sparkline({ values, width = 120, height = 28 }: { values: (number | null)[]; width?: number; height?: number })` — inline SVG polyline; null values are skipped.
  - `OpsPanels({ data }: { data: OpsStatsResponse })` — presentational; Task 9 extends it with the usage chart.
  - `OpsTab()` — thin container: `useSWR('/api/admin/ops-stats', …)` → `<OpsPanels data={…}/>`; loading/error states. (Deliberately untested; all logic lives in OpsPanels/opsMath.)

- [ ] **Step 1: Write the failing test**

`app/components/Ops/OpsPanels.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpsPanels } from './OpsPanels';
import type { OpsStatsResponse } from '@/app/lib/opsTypes';

const data: OpsStatsResponse = {
  dailyStats: [
    {
      date: '2026-07-29',
      model_version: 'v4',
      webcams_scored: 500,
      cache_hits: 400,
      fallbacks: 5,
      score_p50: 0.3,
      score_p90: 0.7,
      source_breakdown: { windy: { scored: 480, avg: 0.4 } },
    },
    {
      date: '2026-07-30',
      model_version: 'v4',
      webcams_scored: 0, // null-score day, like 2026-06-03
      cache_hits: 0,
      fallbacks: 0,
      score_p50: null,
      score_p90: null,
      source_breakdown: null,
    },
  ],
  providerUsage: [],
  costEvents: [],
};

describe('OpsPanels', () => {
  it('renders fallback % and cache-hit % from the latest full day', () => {
    render(<OpsPanels data={data} />);
    // latest day with webcams_scored > 0 is 2026-07-29: 5/500 = 1%, 400/500 = 80%
    expect(screen.getByText(/fallbacks/i).parentElement!.textContent).toContain('1%');
    expect(screen.getByText(/cache hits/i).parentElement!.textContent).toContain('80%');
    expect(screen.getByText('v4')).toBeInTheDocument();
  });

  it('renders an empty state when there is no data', () => {
    render(<OpsPanels data={{ dailyStats: [], providerUsage: [], costEvents: [] }} />);
    expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/Ops/OpsPanels.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

`app/components/Ops/Sparkline.tsx`:

```tsx
export function Sparkline({
  values,
  width = 120,
  height = 28,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
}) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) =>
      v === null ? null : `${i * step},${height - ((v - min) / span) * (height - 2) - 1}`,
    )
    .filter(Boolean)
    .join(' ');
  return (
    <svg width={width} height={height} role="img" aria-label="sparkline">
      <polyline points={points} fill="none" stroke="#60a5fa" strokeWidth={1.5} />
    </svg>
  );
}
```

`app/components/Ops/OpsPanels.tsx`:

```tsx
import { Box, Typography } from '@mui/material';
import type { OpsStatsResponse } from '@/app/lib/opsTypes';
import { pct } from './opsMath';
import { Sparkline } from './Sparkline';

function Stat({
  label,
  value,
  spark,
}: {
  label: string;
  value: string;
  spark?: (number | null)[];
}) {
  return (
    <Box sx={{ minWidth: 160, p: 1.5, borderRadius: 2, backgroundColor: '#374151' }}>
      <Typography variant="caption" sx={{ color: '#9ca3af' }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ color: 'white' }}>
        {value}
      </Typography>
      {spark && <Sparkline values={spark} />}
    </Box>
  );
}

export function OpsPanels({ data }: { data: OpsStatsResponse }) {
  const days = data.dailyStats;
  const latest = [...days].reverse().find((d) => d.webcams_scored > 0);
  if (!latest) {
    return (
      <Typography sx={{ color: '#9ca3af', p: 2 }}>No data yet.</Typography>
    );
  }
  const fallbackPct = pct(latest.fallbacks, latest.webcams_scored);
  const cachePct = pct(latest.cache_hits, latest.webcams_scored);
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      <Stat
        label="fallbacks (spike = scoring broke)"
        value={fallbackPct === null ? '—' : `${fallbackPct}%`}
        spark={days.map((d) => pct(d.fallbacks, d.webcams_scored))}
      />
      <Stat
        label="cache hits (dedup working)"
        value={cachePct === null ? '—' : `${cachePct}%`}
        spark={days.map((d) => pct(d.cache_hits, d.webcams_scored))}
      />
      <Stat
        label="webcams scored"
        value={String(latest.webcams_scored)}
        spark={days.map((d) => d.webcams_scored)}
      />
      <Stat
        label="score p50 / p90"
        value={`${latest.score_p50 ?? '—'} / ${latest.score_p90 ?? '—'}`}
        spark={days.map((d) => d.score_p50)}
      />
      <Stat label="model" value={latest.model_version} />
    </Box>
  );
}
```

`app/components/Ops/OpsTab.tsx`:

```tsx
'use client';

import useSWR from 'swr';
import { Typography } from '@mui/material';
import type { OpsStatsResponse } from '@/app/lib/opsTypes';
import { OpsPanels } from './OpsPanels';

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`ops-stats ${r.status}`);
    return r.json() as Promise<OpsStatsResponse>;
  });

export function OpsTab() {
  const { data, error, isLoading } = useSWR('/api/admin/ops-stats', fetcher);
  if (isLoading) return <Typography sx={{ color: '#9ca3af', p: 2 }}>Loading…</Typography>;
  if (error || !data)
    return <Typography sx={{ color: '#f87171', p: 2 }}>Failed to load ops stats.</Typography>;
  return <OpsPanels data={data} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/components/Ops/OpsPanels.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/components/Ops/
git commit -m "feat(ops): OpsTab with sparkline stat tiles for daily_sunset_stats"
```

---

### Task 4: Wire the Ops tab into the drawer

**Files:**
- Modify: `app/HomeClient.tsx` (tab list ~L42-52; tab bodies ~L245-249)

**Interfaces:**
- Consumes: `OpsTab` from `./components/Ops/OpsTab`; existing `isOperator` from `useIsOperator()` and `visibleTabs = ALL_TABS.filter((t) => isOperator || !t.operatorOnly)`.
- Produces: drawer tab key `'ops'`, owner-only.

- [ ] **Step 1: Add the tab entry**

In `app/HomeClient.tsx`, add to `ALL_TABS` (after the `'models'` entry):

```ts
  { key: 'ops', label: '📊 Ops', operatorOnly: true },
```

Add the import at the top with the other component imports:

```ts
import { OpsTab } from './components/Ops/OpsTab';
```

Add the tab body after the `{tabKey === 'models' && …}` block:

```tsx
              {tabKey === 'ops' && (
                <Box>
                  <OpsTab />
                </Box>
              )}
```

- [ ] **Step 2: Verify the full suite still passes**

Run: `npx vitest run`
Expected: PASS (no HomeClient unit test exists; the type-level check is `ALL_TABS` being `as const` — TypeScript will flag a malformed entry). Also run `npx tsc --noEmit` if fast, or rely on `npm run build` at the end of the phase.

- [ ] **Step 3: Manual smoke check**

Run `npm run dev`, sign in as owner, open the drawer → the "📊 Ops" tab appears and renders stat tiles (or "No data yet." locally). Signed out, the tab must NOT appear.

- [ ] **Step 4: Commit**

```bash
git add app/HomeClient.tsx
git commit -m "feat(ops): owner-only Ops tab in the home drawer"
```

---

### Task 5: Migration — provider_usage_daily + cost_events (+ seed)

**Files:**
- Create: `database/migrations/20260731_provider_usage_and_cost_events.sql`

**Interfaces:**
- Produces: tables `provider_usage_daily` and `cost_events` exactly as below; seeded `cost_events` rows for the two known cost changes.

- [ ] **Step 1: Write the migration**

```sql
-- Provider usage snapshots + cost change log for the owner-only Ops tab.
-- Neon's daily consumption-history API is Scale-plan gated, so we snapshot the
-- month-to-date counters from GET /projects/{id} once per UTC day and derive
-- daily deltas at read time.
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260731_provider_usage_and_cost_events.sql

CREATE TABLE IF NOT EXISTS provider_usage_daily (
  day             DATE        NOT NULL,
  project_id      TEXT        NOT NULL,
  compute_time_s  BIGINT      NOT NULL DEFAULT 0,
  active_time_s   BIGINT      NOT NULL DEFAULT 0,
  data_transfer_b BIGINT      NOT NULL DEFAULT 0,
  storage_b       BIGINT      NOT NULL DEFAULT 0,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, project_id)
);

CREATE TABLE IF NOT EXISTS cost_events (
  id          SERIAL PRIMARY KEY,
  occurred_on DATE NOT NULL,
  sha         TEXT,
  description TEXT NOT NULL
);

-- Seed known cost-relevant changes (idempotent via the WHERE NOT EXISTS guard).
INSERT INTO cost_events (occurred_on, sha, description)
SELECT d::date, s, t FROM (VALUES
  ('2026-06-04', NULL,
   'cron */1 -> */15; image-hash dedup moved from Upstash to Neon column'),
  ('2026-07-31', NULL,
   'webcam endpoint autoscale 0.25-1 CU; nwac 0.25 CU + clustered crons; stale 9 CU branch deleted')
) AS seed(d, s, t)
WHERE NOT EXISTS (
  SELECT 1 FROM cost_events e WHERE e.occurred_on = seed.d::date AND e.description = seed.t
);
```

- [ ] **Step 2: Verify idempotency locally (if a dev DATABASE_URL is configured)**

Run twice: `psql "$DATABASE_URL" -f database/migrations/20260731_provider_usage_and_cost_events.sql`
Expected: second run makes no changes (`INSERT 0 0`), no errors. If no dev DB is available, review-only — the guard clauses are the idempotency mechanism.

- [ ] **Step 3: Commit**

```bash
git add database/migrations/20260731_provider_usage_and_cost_events.sql
git commit -m "feat(db): provider_usage_daily + cost_events tables with seeded history"
```

**Deploy note (for the human):** apply this to the production Neon DB via psql BEFORE merging Tasks 6–9.

---

### Task 6: Provider usage capture lib

**Files:**
- Create: `app/api/cron/update-cameras/lib/providerUsage.ts`
- Test: `app/api/cron/update-cameras/lib/providerUsage.test.ts`
- Modify: `app/lib/masterConfig.ts` (add project-id list)

**Interfaces:**
- Consumes: `sql` from `@/app/lib/db`; global `fetch`; env `NEON_COST_API` (server-only — read via `process.env` inside the lib, NOT via masterConfig).
- Produces: `captureProviderUsageDaily(now: Date): Promise<{ captured: number } | { skipped: string }>` — Task 7 calls this from the cron route. Skips (cheap, one SELECT) when today's rows already exist or the env var is missing.

- [ ] **Step 1: Write the failing test**

`app/api/cron/update-cameras/lib/providerUsage.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import { captureProviderUsageDaily } from './providerUsage';

const NOW = new Date('2026-08-02T00:20:00Z');

describe('captureProviderUsageDaily', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    sqlMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.NEON_COST_API = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEON_COST_API;
  });

  it('skips when today already has rows', async () => {
    sqlMock.mockResolvedValueOnce([{ count: 4 }]);
    const result = await captureProviderUsageDaily(NOW);
    expect(result).toEqual({ skipped: 'already-captured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips without the API key', async () => {
    delete process.env.NEON_COST_API;
    const result = await captureProviderUsageDaily(NOW);
    expect(result).toEqual({ skipped: 'no-api-key' });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('fetches each project and upserts counters', async () => {
    sqlMock.mockResolvedValueOnce([{ count: 0 }]); // guard
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        project: {
          compute_time_seconds: 3600,
          active_time_seconds: 7200,
          data_transfer_bytes: 10,
          synthetic_storage_size: 20,
        },
      }),
    });
    sqlMock.mockResolvedValue([]); // upserts
    const result = await captureProviderUsageDaily(NOW);
    expect(result).toEqual({ captured: 4 }); // 4 configured projects
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain('https://console.neon.tech/api/v2/projects/');
  });

  it('tolerates one project failing (partial rows are fine)', async () => {
    sqlMock.mockResolvedValueOnce([{ count: 0 }]);
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          project: {
            compute_time_seconds: 1,
            active_time_seconds: 1,
            data_transfer_bytes: 1,
            synthetic_storage_size: 1,
          },
        }),
      });
    sqlMock.mockResolvedValue([]);
    const result = await captureProviderUsageDaily(NOW);
    expect(result).toEqual({ captured: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/lib/providerUsage.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Add to `app/lib/masterConfig.ts` under the Ops banner from Task 1:

```ts
// Neon projects in the Vercel-managed org whose month-to-date usage counters
// the cron snapshots daily into provider_usage_daily. Project ids are not
// secrets (the API key NEON_COST_API is, and lives only in env).
export const NEON_USAGE_PROJECT_IDS = [
  'noisy-leaf-96391119', // sunrise-sunset-webcams (this app)
  'rough-resonance-57753560', // nwac-observations (Weather_Web_App)
  'holy-shadow-28821259', // land_buyback (idle)
  'small-tree-05551811', // nextjs-dashboard-postgres (idle)
];
```

`app/api/cron/update-cameras/lib/providerUsage.ts`:

```ts
import { sql } from '@/app/lib/db';
import { NEON_USAGE_PROJECT_IDS } from '@/app/lib/masterConfig';

const NEON_API = 'https://console.neon.tech/api/v2';

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Snapshot Neon month-to-date usage counters once per UTC day. Called from the
// update-cameras cron; every failure path returns instead of throwing so the
// scoring tick can never be broken by the cost dashboard.
export async function captureProviderUsageDaily(
  now: Date,
): Promise<{ captured: number } | { skipped: string }> {
  const apiKey = process.env.NEON_COST_API;
  if (!apiKey) return { skipped: 'no-api-key' };

  const day = utcDateString(now);
  const existing = (await sql`
    SELECT COUNT(*)::int AS count FROM provider_usage_daily WHERE day = ${day}
  `) as unknown as { count: number }[];
  if ((existing[0]?.count ?? 0) > 0) return { skipped: 'already-captured' };

  let captured = 0;
  for (const projectId of NEON_USAGE_PROJECT_IDS) {
    try {
      const res = await fetch(`${NEON_API}/projects/${projectId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        console.warn(`[providerUsage] ${projectId} -> ${res.status}`);
        continue;
      }
      const { project } = (await res.json()) as {
        project: {
          compute_time_seconds?: number;
          active_time_seconds?: number;
          data_transfer_bytes?: number;
          synthetic_storage_size?: number;
        };
      };
      await sql`
        INSERT INTO provider_usage_daily
          (day, project_id, compute_time_s, active_time_s, data_transfer_b, storage_b)
        VALUES (${day}, ${projectId},
          ${project.compute_time_seconds ?? 0}, ${project.active_time_seconds ?? 0},
          ${project.data_transfer_bytes ?? 0}, ${project.synthetic_storage_size ?? 0})
        ON CONFLICT (day, project_id) DO NOTHING
      `;
      captured++;
    } catch (error) {
      console.warn(`[providerUsage] ${projectId} failed:`, error);
    }
  }
  return { captured };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/cron/update-cameras/lib/providerUsage.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/lib/providerUsage.ts app/api/cron/update-cameras/lib/providerUsage.test.ts app/lib/masterConfig.ts
git commit -m "feat(ops): daily Neon usage snapshot lib (guarded, non-fatal)"
```

---

### Task 7: Call the capture from the cron route

**Files:**
- Modify: `app/api/cron/update-cameras/route.ts` (after the `upsertDailyStats` block, ~L387)
- Modify: `app/api/cron/update-cameras/route.test.ts` (add the new lib mock)

**Interfaces:**
- Consumes: `captureProviderUsageDaily(now)` from Task 6.
- Produces: cron response JSON gains `providerUsage: { captured: number } | { skipped: string } | { error: true }`.

- [ ] **Step 1: Extend the route test (failing first)**

In `app/api/cron/update-cameras/route.test.ts`, add alongside the existing lib mocks (same `vi.mock` style used for `./lib/dailyStats`):

```ts
const captureProviderUsageDailyMock = vi.fn();
vi.mock('./lib/providerUsage', () => ({
  captureProviderUsageDaily: (...a: unknown[]) =>
    captureProviderUsageDailyMock(...a),
}));
```

And a test case (following the file's existing happy-path setup helpers):

```ts
it('captures provider usage without failing the tick when it errors', async () => {
  captureProviderUsageDailyMock.mockRejectedValueOnce(new Error('neon down'));
  const res = await GET(authorizedRequest()); // reuse the file's existing helper for an authed request
  expect(res.status).toBe(200);
  expect(captureProviderUsageDailyMock).toHaveBeenCalled();
});
```

(If the file has no `authorizedRequest()` helper, use the same request-construction pattern its other tests use — do not invent a new one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts`
Expected: the new case FAILS (`captureProviderUsageDailyMock` not called); pre-existing cases PASS.

- [ ] **Step 3: Implement**

In `app/api/cron/update-cameras/route.ts`, import at top:

```ts
import { captureProviderUsageDaily } from './lib/providerUsage';
```

After the existing `upsertDailyStats` try/catch block, add:

```ts
  // Once per UTC day, snapshot Neon usage counters for the Ops tab. Never
  // allowed to fail the tick.
  let providerUsage: Awaited<ReturnType<typeof captureProviderUsageDaily>> | { error: true };
  try {
    providerUsage = await captureProviderUsageDaily(new Date());
  } catch (error) {
    console.warn('[update-cameras] provider usage capture failed:', error);
    providerUsage = { error: true };
  }
```

And add `providerUsage` to the final `NextResponse.json({ ... })` object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/update-cameras/route.ts app/api/cron/update-cameras/route.test.ts
git commit -m "feat(ops): cron snapshots Neon usage daily (non-fatal)"
```

**Deploy note (for the human):** add `NEON_COST_API` (the key already in `.env.local`) to the Vercel project env (Production; server-only) before this deploys, or the capture no-ops with `skipped: 'no-api-key'`.

---

### Task 8: Extend ops-stats with provider usage + cost events

**Files:**
- Modify: `app/api/admin/ops-stats/route.ts`
- Modify: `app/api/admin/ops-stats/route.test.ts`
- Modify: `app/lib/masterConfig.ts` (lookback constant)

**Interfaces:**
- Consumes: tables from Task 5.
- Produces: `providerUsage: ProviderUsageRow[]` (raw counters, oldest→newest, last `PROVIDER_USAGE_LOOKBACK_DAYS` days) and `costEvents: CostEventRow[]` in the response. Delta math stays client-side in `deriveDailyDeltas` (Task 2).

- [ ] **Step 1: Extend the test (failing first)**

Replace the second test's sql mocking with three sequential results and assert the new fields:

```ts
  it('returns daily stats, provider usage, and cost events for the owner', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    sqlMock
      .mockResolvedValueOnce([
        { date: '2026-07-30', model_version: 'v4', webcams_scored: 500,
          cache_hits: 400, fallbacks: 2, score_p50: 0.31, score_p90: 0.71,
          source_breakdown: null },
      ])
      .mockResolvedValueOnce([
        { day: '2026-07-30', project_id: 'noisy-leaf-96391119', compute_time_s: 36000 },
      ])
      .mockResolvedValueOnce([
        { occurred_on: '2026-07-31', sha: null, description: 'autoscale 0.25-1 CU' },
      ]);
    const res = await GET();
    const body = await res.json();
    expect(body.providerUsage).toHaveLength(1);
    expect(body.providerUsage[0].project_id).toBe('noisy-leaf-96391119');
    expect(body.costEvents[0].description).toContain('autoscale');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/admin/ops-stats/route.test.ts`
Expected: new case FAILS (`providerUsage` is `[]`)

- [ ] **Step 3: Implement**

Add to `app/lib/masterConfig.ts` (Ops banner):

```ts
// How far back the Ops usage chart reaches. 60 days spans two billing cycles
// so month-rollover deltas are visible and testable.
export const PROVIDER_USAGE_LOOKBACK_DAYS = 60;
```

In `app/api/admin/ops-stats/route.ts`, after the dailyStats query:

```ts
  const providerUsage = (await sql`
    SELECT day::text AS day, project_id, compute_time_s::bigint AS compute_time_s
    FROM provider_usage_daily
    WHERE day > CURRENT_DATE - ${PROVIDER_USAGE_LOOKBACK_DAYS}
    ORDER BY day ASC, project_id ASC
  `) as unknown as ProviderUsageRow[];

  const costEvents = (await sql`
    SELECT occurred_on::text AS occurred_on, sha, description
    FROM cost_events
    ORDER BY occurred_on ASC
  `) as unknown as CostEventRow[];
```

Import the two types from `@/app/lib/opsTypes` and `PROVIDER_USAGE_LOOKBACK_DAYS` from masterConfig; put the arrays in the response body. Note: `@neondatabase/serverless` returns BIGINT as string — coerce in the route: `providerUsage.map(r => ({ ...r, compute_time_s: Number(r.compute_time_s) }))`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/admin/ops-stats/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/ops-stats/ app/lib/masterConfig.ts
git commit -m "feat(ops): ops-stats returns provider usage + cost events"
```

---

### Task 9: Usage chart with cost-event markers

**Files:**
- Create: `app/components/Ops/UsageChart.tsx`
- Modify: `app/components/Ops/OpsPanels.tsx` (render the chart under the tiles)
- Test: `app/components/Ops/UsageChart.test.tsx`

**Interfaces:**
- Consumes: `deriveDailyDeltas` (Task 2), `ProviderUsageRow`, `CostEventRow`.
- Produces: `UsageChart({ usage, events }: { usage: ProviderUsageRow[]; events: CostEventRow[] })` — inline SVG line chart of compute-hours/day for `noisy-leaf-96391119` (bold) and the sum of the other projects (thin), with a vertical dashed marker + `<title>` tooltip per cost event.

- [ ] **Step 1: Write the failing test**

`app/components/Ops/UsageChart.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { UsageChart } from './UsageChart';

const P = 'noisy-leaf-96391119';

describe('UsageChart', () => {
  it('renders a point per derived day and a marker per event', () => {
    const { container } = render(
      <UsageChart
        usage={[
          { day: '2026-08-01', project_id: P, compute_time_s: 36000 },
          { day: '2026-08-02', project_id: P, compute_time_s: 72000 },
          { day: '2026-08-03', project_id: P, compute_time_s: 90000 },
        ]}
        events={[{ occurred_on: '2026-08-02', sha: null, description: 'autoscale' }]}
      />,
    );
    // 2 derived days (deltas skip the baseline day) -> polyline with 2 points
    const polyline = container.querySelector('polyline');
    expect(polyline?.getAttribute('points')?.split(' ')).toHaveLength(2);
    // 1 event marker line with its description in a <title>
    expect(container.querySelectorAll('line.cost-event')).toHaveLength(1);
    expect(container.querySelector('title')?.textContent).toContain('autoscale');
  });

  it('renders an empty state with fewer than 2 snapshot days', () => {
    const { getByText } = render(<UsageChart usage={[]} events={[]} />);
    expect(getByText(/usage snapshots will appear/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/Ops/UsageChart.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

`app/components/Ops/UsageChart.tsx`:

```tsx
import { Box, Typography } from '@mui/material';
import type { ProviderUsageRow, CostEventRow } from '@/app/lib/opsTypes';
import { deriveDailyDeltas } from './opsMath';

const WEBCAM_PROJECT = 'noisy-leaf-96391119';
const W = 560;
const H = 140;

export function UsageChart({
  usage,
  events,
}: {
  usage: ProviderUsageRow[];
  events: CostEventRow[];
}) {
  const deltas = deriveDailyDeltas(usage);
  const days = [...new Set(deltas.map((d) => d.day))].sort();
  if (days.length === 0) {
    return (
      <Typography sx={{ color: '#9ca3af', p: 2 }}>
        Usage snapshots will appear after two daily captures.
      </Typography>
    );
  }
  const webcam = days.map(
    (day) =>
      deltas.find((d) => d.day === day && d.project_id === WEBCAM_PROJECT)
        ?.computeHours ?? 0,
  );
  const others = days.map((day) =>
    deltas
      .filter((d) => d.day === day && d.project_id !== WEBCAM_PROJECT)
      .reduce((sum, d) => sum + d.computeHours, 0),
  );
  const max = Math.max(...webcam, ...others, 1);
  const x = (i: number) => (days.length === 1 ? W / 2 : (i / (days.length - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 10) - 5;
  const line = (vals: number[]) => vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  return (
    <Box sx={{ mt: 2, overflowX: 'auto' }}>
      <Typography variant="caption" sx={{ color: '#9ca3af' }}>
        Neon compute hours/day — webcams (bold) vs other projects (thin), markers = cost changes
      </Typography>
      <svg width={W} height={H} role="img" aria-label="compute hours per day">
        <polyline points={line(webcam)} fill="none" stroke="#60a5fa" strokeWidth={2} />
        {days.length > 1 && (
          <polyline points={line(others)} fill="none" stroke="#9ca3af" strokeWidth={1} />
        )}
        {events
          .filter((e) => days.includes(e.occurred_on))
          .map((e) => (
            <line
              key={`${e.occurred_on}-${e.description}`}
              className="cost-event"
              x1={x(days.indexOf(e.occurred_on))}
              x2={x(days.indexOf(e.occurred_on))}
              y1={0}
              y2={H}
              stroke="#f59e0b"
              strokeDasharray="4 3"
            >
              <title>{`${e.occurred_on}: ${e.description}`}</title>
            </line>
          ))}
      </svg>
    </Box>
  );
}
```

In `OpsPanels.tsx`, import and render under the tiles (inside the outer fragment — wrap the current `Box` and the chart in `<>…</>`):

```tsx
      <UsageChart usage={data.providerUsage} events={data.costEvents} />
```

Update `OpsPanels.test.tsx` expectations only if the added chart breaks a selector (it shouldn't — the empty-state text differs).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/components/Ops/`
Expected: PASS (all Ops tests)

- [ ] **Step 5: Commit**

```bash
git add app/components/Ops/
git commit -m "feat(ops): compute-hours chart with cost-event markers"
```

---

### Task 10: Redis kiosk helpers in cache.ts

**Files:**
- Modify: `app/lib/cache.ts`
- Modify: `app/lib/cache.test.ts`
- Modify: `app/lib/masterConfig.ts` (lock TTL)

**Interfaces:**
- Consumes: existing private `getClient(): Redis | null` in `cache.ts`.
- Produces (all safe when Redis is unavailable — mirror the file's try/catch style):
  - `acquireKioskTickLock(): Promise<boolean>` — `SET kiosk:tick:lock '1' NX PX KIOSK_TICK_LOCK_TTL_MS`; `true` iff acquired; `false` on missing client or error (fail-closed: no lock → no tick).
  - `markKioskTickRan(): Promise<void>` — same key, same PX, **without** NX (the cron stamps it unconditionally).
  - `getKioskDoze(): Promise<boolean>` — `GET kiosk:doze` truthy check; `false` on error.
  - `setKioskDoze(on: boolean): Promise<void>` — `SET kiosk:doze '1'` / `DEL kiosk:doze`.

- [ ] **Step 1: Write the failing tests**

Append to `app/lib/cache.test.ts` (reuse the file's existing `@upstash/redis` mock and env setup; the mocked client object gains `set`, `get`, `del` — extend the existing mock if those exist already):

```ts
describe('kiosk helpers', () => {
  it('acquireKioskTickLock passes NX+PX and reports acquisition', async () => {
    setMock.mockResolvedValueOnce('OK');
    const { acquireKioskTickLock } = await import('./cache');
    await expect(acquireKioskTickLock()).resolves.toBe(true);
    expect(setMock).toHaveBeenCalledWith(
      'kiosk:tick:lock',
      '1',
      expect.objectContaining({ nx: true, px: 55000 }),
    );
  });

  it('acquireKioskTickLock returns false when the lock is held', async () => {
    setMock.mockResolvedValueOnce(null); // upstash returns null when NX fails
    const { acquireKioskTickLock } = await import('./cache');
    await expect(acquireKioskTickLock()).resolves.toBe(false);
  });

  it('markKioskTickRan sets the lock without NX', async () => {
    const { markKioskTickRan } = await import('./cache');
    await markKioskTickRan();
    expect(setMock).toHaveBeenCalledWith(
      'kiosk:tick:lock',
      '1',
      expect.objectContaining({ px: 55000 }),
    );
    expect(setMock.mock.calls.at(-1)![2]).not.toHaveProperty('nx');
  });

  it('doze flag round-trips', async () => {
    const { setKioskDoze, getKioskDoze } = await import('./cache');
    await setKioskDoze(true);
    expect(setMock).toHaveBeenCalledWith('kiosk:doze', '1');
    getMock.mockResolvedValueOnce('1');
    await expect(getKioskDoze()).resolves.toBe(true);
    await setKioskDoze(false);
    expect(delMock).toHaveBeenCalledWith('kiosk:doze');
    getMock.mockResolvedValueOnce(null);
    await expect(getKioskDoze()).resolves.toBe(false);
  });
});
```

(Match the existing file's import/reset conventions — it already mocks `Redis.fromEnv` returning `{ get: getMock, set: setMock, del: delMock }` and sets `KV_REST_API_URL`/`KV_REST_API_TOKEN`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/cache.test.ts`
Expected: new cases FAIL (exports missing); old cases PASS

- [ ] **Step 3: Implement**

Add to `app/lib/masterConfig.ts` (new banner):

```ts
// ---------------------------------------------------------------------------
// Kiosk gallery mode (presence-driven scoring cadence + doze)
// ---------------------------------------------------------------------------
// Tick lock TTL: slightly under the 60s poll interval so the next poll can
// re-acquire even if clocks drift. One global lock = at most ~1 tick/minute
// regardless of how many kiosk screens are open.
export const KIOSK_TICK_LOCK_TTL_MS = 55_000;
```

Add to `app/lib/cache.ts`:

```ts
import { KIOSK_TICK_LOCK_TTL_MS } from '@/app/lib/masterConfig';

const KIOSK_TICK_LOCK_KEY = 'kiosk:tick:lock';
const KIOSK_DOZE_KEY = 'kiosk:doze';

// True iff this caller won the right to run a scoring tick this minute.
// Fail-closed: no Redis -> no kiosk ticks (the */15 cron remains the floor).
export async function acquireKioskTickLock(): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const result = await c.set(KIOSK_TICK_LOCK_KEY, '1', {
      nx: true,
      px: KIOSK_TICK_LOCK_TTL_MS,
    });
    return result === 'OK';
  } catch (error) {
    console.warn('[cache] acquireKioskTickLock failed:', error);
    return false;
  }
}

// The cron stamps the lock unconditionally so a kiosk poll right after a cron
// tick is a no-op.
export async function markKioskTickRan(): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(KIOSK_TICK_LOCK_KEY, '1', { px: KIOSK_TICK_LOCK_TTL_MS });
  } catch (error) {
    console.warn('[cache] markKioskTickRan failed:', error);
  }
}

export async function getKioskDoze(): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    return Boolean(await c.get(KIOSK_DOZE_KEY));
  } catch (error) {
    console.warn('[cache] getKioskDoze failed:', error);
    return false;
  }
}

export async function setKioskDoze(on: boolean): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    if (on) await c.set(KIOSK_DOZE_KEY, '1');
    else await c.del(KIOSK_DOZE_KEY);
  } catch (error) {
    console.warn('[cache] setKioskDoze failed:', error);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/lib/cache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/lib/cache.ts app/lib/cache.test.ts app/lib/masterConfig.ts
git commit -m "feat(kiosk): Redis tick lock + doze flag helpers"
```

---

### Task 11: `/api/kiosk/tick` route + model bundling + cron lock stamp

**Files:**
- Create: `app/api/kiosk/tick/route.ts`
- Test: `app/api/kiosk/tick/route.test.ts`
- Modify: `app/api/cron/update-cameras/route.ts` (stamp the lock)
- Modify: `app/api/cron/update-cameras/route.test.ts` (mock `@/app/lib/cache` gains `markKioskTickRan`)
- Modify: `next.config.ts` (`outputFileTracingIncludes` new key)
- Modify: `next.config.test.ts` (`MODEL_ROUTES` gains the new route)

**Interfaces:**
- Consumes: `acquireKioskTickLock` (Task 10); `GET` handler exported by `@/app/api/cron/update-cameras/route` (re-invoked in-process with an internally-authed Request); env `CRON_SECRET`.
- Produces: `POST /api/kiosk/tick` → `202 { throttled: true }` when the lock is held, else `200 { ok: true, tick: <cron response body> }`. Unauthenticated by design — the lock caps abuse at gallery-mode cost (spec Part B).

- [ ] **Step 1: Write the failing test**

`app/api/kiosk/tick/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const acquireKioskTickLockMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  acquireKioskTickLock: () => acquireKioskTickLockMock(),
}));

const cronGetMock = vi.fn();
vi.mock('@/app/api/cron/update-cameras/route', () => ({
  GET: (req: Request) => cronGetMock(req),
}));

import { POST } from './route';

describe('POST /api/kiosk/tick', () => {
  beforeEach(() => {
    acquireKioskTickLockMock.mockReset();
    cronGetMock.mockReset();
    process.env.CRON_SECRET = 'shh';
  });

  it('throttles when the lock is held', async () => {
    acquireKioskTickLockMock.mockResolvedValueOnce(false);
    const res = await POST();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ throttled: true });
    expect(cronGetMock).not.toHaveBeenCalled();
  });

  it('runs a tick with internal cron auth when the lock is acquired', async () => {
    acquireKioskTickLockMock.mockResolvedValueOnce(true);
    cronGetMock.mockResolvedValueOnce(
      NextResponse.json({ ok: true, windyScored: 3 }),
    );
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tick.windyScored).toBe(3);
    const forwarded = cronGetMock.mock.calls[0][0] as Request;
    expect(forwarded.headers.get('authorization')).toBe('Bearer shh');
  });

  it('returns 500 when the tick itself fails', async () => {
    acquireKioskTickLockMock.mockResolvedValueOnce(true);
    cronGetMock.mockRejectedValueOnce(new Error('boom'));
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/kiosk/tick/route.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the route**

`app/api/kiosk/tick/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { acquireKioskTickLock } from '@/app/lib/cache';
import { GET as runCronTick } from '@/app/api/cron/update-cameras/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Presence-driven scoring: gallery kiosk screens POST here every minute while
// visible. Unauthenticated by design (the kiosk page is public and cannot hold
// a secret) — the Redis NX lock caps the worst case at ~1 tick/minute
// globally, i.e. gallery-mode cost. The */15 cron remains the baseline.
export async function POST() {
  const acquired = await acquireKioskTickLock();
  if (!acquired) {
    return NextResponse.json({ throttled: true }, { status: 202 });
  }
  try {
    // Re-invoke the cron handler in-process with internal auth. This keeps
    // one source of truth for what "a tick" is (see spec Part B).
    const req = new Request('http://kiosk.internal/api/cron/update-cameras', {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
    });
    const tickRes = await runCronTick(req);
    const tick = await tickRes.json();
    return NextResponse.json({ ok: true, tick }, { status: tickRes.status });
  } catch (error) {
    console.error('[kiosk/tick] failed:', error);
    return NextResponse.json({ error: 'tick failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/kiosk/tick/route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Stamp the lock from the cron (failing test first)**

In `app/api/cron/update-cameras/route.test.ts`, the file already mocks `@/app/lib/cache` (for `setCachedTerminatorPayload`) — add `markKioskTickRan` to that same mock factory:

```ts
const markKioskTickRanMock = vi.fn();
// inside the existing vi.mock('@/app/lib/cache', ...) factory, add:
//   markKioskTickRan: () => markKioskTickRanMock(),
```

New case: `expect(markKioskTickRanMock).toHaveBeenCalled()` after a successful authed GET. Run — FAILS. Then in `app/api/cron/update-cameras/route.ts`, import `markKioskTickRan` from `@/app/lib/cache` and call it right after auth succeeds (before the tick body):

```ts
  // Stamp the kiosk tick lock so a kiosk poll immediately after this cron
  // tick is a no-op (shared once-per-minute budget).
  void markKioskTickRan();
```

Run: `npx vitest run app/api/cron/update-cameras/route.test.ts` — PASS.

- [ ] **Step 6: Model bundling (guard test first)**

In `next.config.test.ts`, add `'/api/kiosk/tick'` to `MODEL_ROUTES`. Run `npx vitest run next.config.test.ts` — FAILS (route not configured). Then in `next.config.ts`, add to `outputFileTracingIncludes` (same two globs as the cron route, verbatim):

```ts
  '/api/kiosk/tick': [
    './ml/artifacts/models/regression_resnet18/20260513_113243_v4_regression_llm_with_flickr/**/*',
    './ml/artifacts/models/binary_resnet18/20260601_063518_v4_binary_llm_with_flickr/**/*',
  ],
```

Run `npx vitest run next.config.test.ts` — PASS. (This grows the already ~264 MB bundle only by tracing metadata — the model files are shared — but keep the guard test's <120 MB per-route assertion green.)

- [ ] **Step 7: Commit**

```bash
git add app/api/kiosk/tick/ app/api/cron/update-cameras/route.ts app/api/cron/update-cameras/route.test.ts next.config.ts next.config.test.ts
git commit -m "feat(kiosk): lock-guarded /api/kiosk/tick re-invoking the cron tick"
```

**Deploy note (for the human):** after the first deploy, verify ONNX works on the new route via the smoke endpoint pattern — a real tick shows `latencyMs` 100–500 ms per image; 10–20 ms means baseline fallback (silent-fallback gotcha).

---

### Task 12: `/api/kiosk/state` + `/api/kiosk/doze` routes

**Files:**
- Create: `app/api/kiosk/state/route.ts`
- Create: `app/api/kiosk/doze/route.ts`
- Test: `app/api/kiosk/state/route.test.ts`
- Test: `app/api/kiosk/doze/route.test.ts`

**Interfaces:**
- Consumes: `getKioskDoze` / `setKioskDoze` (Task 10); `requireOwner` (doze only).
- Produces:
  - `GET /api/kiosk/state` → `200 { doze: boolean }`. Unauthenticated, Redis-only read (no Neon touch — this is what dozing kiosks poll).
  - `POST /api/kiosk/doze` with JSON `{ doze: boolean }` → owner-gated; sets the flag; returns `200 { doze }`.

- [ ] **Step 1: Write the failing tests**

`app/api/kiosk/state/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getKioskDozeMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  getKioskDoze: () => getKioskDozeMock(),
}));

import { GET } from './route';

describe('GET /api/kiosk/state', () => {
  beforeEach(() => getKioskDozeMock.mockReset());
  it('returns the doze flag', async () => {
    getKioskDozeMock.mockResolvedValueOnce(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ doze: true });
  });
});
```

`app/api/kiosk/doze/route.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const requireOwnerMock = vi.fn();
vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));
const setKioskDozeMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  setKioskDoze: (on: boolean) => setKioskDozeMock(on),
}));

import { POST } from './route';

function req(body: unknown): Request {
  return new Request('http://test/api/kiosk/doze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/kiosk/doze', () => {
  beforeEach(() => {
    requireOwnerMock.mockReset();
    setKioskDozeMock.mockReset();
  });

  it('rejects non-owners', async () => {
    requireOwnerMock.mockResolvedValueOnce(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await POST(req({ doze: true }));
    expect(res.status).toBe(403);
    expect(setKioskDozeMock).not.toHaveBeenCalled();
  });

  it('sets the flag for the owner', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const res = await POST(req({ doze: true }));
    expect(res.status).toBe(200);
    expect(setKioskDozeMock).toHaveBeenCalledWith(true);
    expect(await res.json()).toEqual({ doze: true });
  });

  it('400s on a malformed body', async () => {
    requireOwnerMock.mockResolvedValueOnce(null);
    const res = await POST(req({ doze: 'maybe' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/api/kiosk/state/route.test.ts app/api/kiosk/doze/route.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement**

`app/api/kiosk/state/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getKioskDoze } from '@/app/lib/cache';

export const dynamic = 'force-dynamic';

// Redis-only read: this is the endpoint dozing kiosks poll once a minute to
// hear the wake command, so it must never touch Neon.
export async function GET() {
  return NextResponse.json({ doze: await getKioskDoze() });
}
```

`app/api/kiosk/doze/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { setKioskDoze } from '@/app/lib/cache';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  let doze: unknown;
  try {
    ({ doze } = await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof doze !== 'boolean') {
    return NextResponse.json({ error: 'doze must be boolean' }, { status: 400 });
  }
  await setKioskDoze(doze);
  return NextResponse.json({ doze });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/kiosk/state/route.test.ts app/api/kiosk/doze/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/kiosk/state/ app/api/kiosk/doze/
git commit -m "feat(kiosk): state read + owner-gated doze toggle routes"
```

---

### Task 13: Pure kiosk schedule logic

**Files:**
- Create: `app/kiosk/kioskSchedule.ts`
- Test: `app/kiosk/kioskSchedule.test.ts`
- Modify: `app/lib/masterConfig.ts` (quiet/wake constants)

**Interfaces:**
- Produces (all pure — the hook in Task 14 is a thin shell around these):

```ts
export type QuietWindow = { start: number; end: number } | null;
export function parseQuietParam(raw: string | null): QuietWindow;
// raw null/'' -> default from KIOSK_QUIET_DEFAULT ('1-8'); 'off' -> null;
// 'H-H' -> {start,end}; unparseable -> default.
export function isInQuietHours(hourLocal: number, quiet: QuietWindow): boolean;
// half-open [start, end); handles windows crossing midnight (e.g. 23-9).
export interface KioskGate {
  visible: boolean;
  localDoze: boolean;
  remoteDoze: boolean;
  quiet: QuietWindow;
  hourLocal: number;
  msSinceInteraction: number | null; // null = never interacted
  wakeMinutes: number;
}
export function isDozing(gate: KioskGate): boolean;
export function shouldRunTick(gate: KioskGate): boolean;
```

Semantics (from the spec): `awakeByInteraction = msSinceInteraction !== null && msSinceInteraction < wakeMinutes * 60_000`. `isDozing = localDoze || remoteDoze || (inQuiet && !awakeByInteraction)`. `shouldRunTick = visible && !isDozing`. Local doze is sticky: interaction does NOT clear it (only the `d` key does, in the hook).

- [ ] **Step 1: Write the failing test**

`app/kiosk/kioskSchedule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseQuietParam,
  isInQuietHours,
  isDozing,
  shouldRunTick,
  type KioskGate,
} from './kioskSchedule';

describe('parseQuietParam', () => {
  it('defaults to 1-8', () => {
    expect(parseQuietParam(null)).toEqual({ start: 1, end: 8 });
  });
  it('parses off and custom windows', () => {
    expect(parseQuietParam('off')).toBeNull();
    expect(parseQuietParam('23-9')).toEqual({ start: 23, end: 9 });
  });
  it('falls back to default on garbage', () => {
    expect(parseQuietParam('banana')).toEqual({ start: 1, end: 8 });
  });
});

describe('isInQuietHours', () => {
  it('handles a simple window', () => {
    expect(isInQuietHours(3, { start: 1, end: 8 })).toBe(true);
    expect(isInQuietHours(8, { start: 1, end: 8 })).toBe(false); // half-open
    expect(isInQuietHours(12, { start: 1, end: 8 })).toBe(false);
  });
  it('handles a window crossing midnight', () => {
    expect(isInQuietHours(23, { start: 23, end: 9 })).toBe(true);
    expect(isInQuietHours(2, { start: 23, end: 9 })).toBe(true);
    expect(isInQuietHours(10, { start: 23, end: 9 })).toBe(false);
  });
  it('is always false when disabled', () => {
    expect(isInQuietHours(3, null)).toBe(false);
  });
});

const base: KioskGate = {
  visible: true,
  localDoze: false,
  remoteDoze: false,
  quiet: { start: 1, end: 8 },
  hourLocal: 12,
  msSinceInteraction: null,
  wakeMinutes: 30,
};

describe('isDozing / shouldRunTick', () => {
  it('runs normally in the day', () => {
    expect(isDozing(base)).toBe(false);
    expect(shouldRunTick(base)).toBe(true);
  });
  it('dozes during quiet hours with no interaction', () => {
    const g = { ...base, hourLocal: 3 };
    expect(isDozing(g)).toBe(true);
    expect(shouldRunTick(g)).toBe(false);
  });
  it('a recent interaction wakes it through quiet hours', () => {
    const g = { ...base, hourLocal: 3, msSinceInteraction: 5 * 60_000 };
    expect(isDozing(g)).toBe(false);
    expect(shouldRunTick(g)).toBe(true);
  });
  it('the wake window expires', () => {
    const g = { ...base, hourLocal: 3, msSinceInteraction: 31 * 60_000 };
    expect(isDozing(g)).toBe(true);
  });
  it('local and remote doze are sticky regardless of interaction', () => {
    expect(isDozing({ ...base, localDoze: true, msSinceInteraction: 0 })).toBe(true);
    expect(isDozing({ ...base, remoteDoze: true, msSinceInteraction: 0 })).toBe(true);
  });
  it('never ticks while hidden', () => {
    expect(shouldRunTick({ ...base, visible: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/kiosk/kioskSchedule.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Add to `app/lib/masterConfig.ts` (kiosk banner from Task 10):

```ts
// Quiet hours default: gallery-local hours during which the kiosk dozes
// (no scoring ticks). Override per install with ?quiet=off or ?quiet=23-9.
export const KIOSK_QUIET_DEFAULT = '1-8';
// How long one interaction keeps a quiet-hours kiosk awake.
export const KIOSK_WAKE_MINUTES = 30;
// Poll cadences (tick + doze-state check). Two cheap requests per minute.
export const KIOSK_TICK_INTERVAL_MS = 60_000;
```

`app/kiosk/kioskSchedule.ts`:

```ts
import { KIOSK_QUIET_DEFAULT, } from '@/app/lib/masterConfig';

export type QuietWindow = { start: number; end: number } | null;

export function parseQuietParam(raw: string | null): QuietWindow {
  const value = raw?.trim() || KIOSK_QUIET_DEFAULT;
  if (value === 'off') return null;
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!match) return parseQuietParam(KIOSK_QUIET_DEFAULT);
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > 23 || end > 23) return parseQuietParam(KIOSK_QUIET_DEFAULT);
  return { start, end };
}

// Half-open [start, end); a window crossing midnight (23-9) wraps.
export function isInQuietHours(hourLocal: number, quiet: QuietWindow): boolean {
  if (!quiet) return false;
  const { start, end } = quiet;
  if (start === end) return false;
  if (start < end) return hourLocal >= start && hourLocal < end;
  return hourLocal >= start || hourLocal < end;
}

export interface KioskGate {
  visible: boolean;
  localDoze: boolean;
  remoteDoze: boolean;
  quiet: QuietWindow;
  hourLocal: number;
  msSinceInteraction: number | null;
  wakeMinutes: number;
}

export function isDozing(gate: KioskGate): boolean {
  if (gate.localDoze || gate.remoteDoze) return true;
  const awakeByInteraction =
    gate.msSinceInteraction !== null &&
    gate.msSinceInteraction < gate.wakeMinutes * 60_000;
  return isInQuietHours(gate.hourLocal, gate.quiet) && !awakeByInteraction;
}

export function shouldRunTick(gate: KioskGate): boolean {
  return gate.visible && !isDozing(gate);
}
```

(Remove the stray trailing comma in the import if the linter complains — import only `KIOSK_QUIET_DEFAULT`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/kiosk/kioskSchedule.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add app/kiosk/kioskSchedule.ts app/kiosk/kioskSchedule.test.ts app/lib/masterConfig.ts
git commit -m "feat(kiosk): pure schedule logic — quiet hours, wake window, doze gating"
```

---

### Task 14: Kiosk runtime hook + doze overlay + page integration

**Files:**
- Create: `app/kiosk/useKioskRuntime.ts`
- Create: `app/kiosk/KioskDozeOverlay.tsx`
- Modify: `app/kiosk/sunset/page.tsx`
- Modify: `app/kiosk/sunrise/page.tsx`
- Test: `app/kiosk/useKioskRuntime.test.tsx`
- Modify: `app/kiosk/sunset/page.test.tsx`, `app/kiosk/sunrise/page.test.tsx` (mock the new hook)

**Interfaces:**
- Consumes: Task 13 pure functions; `KIOSK_TICK_INTERVAL_MS`, `KIOSK_WAKE_MINUTES` from masterConfig; `POST /api/kiosk/tick`, `GET /api/kiosk/state`.
- Produces: `useKioskRuntime(): { dozing: boolean }`; `KioskDozeOverlay({ dozing }: { dozing: boolean })`.

Hook behavior:
- On mount, parse `?quiet=` from `window.location.search` via `parseQuietParam`.
- Track: `visible` (visibilitychange), `localDoze` (`d` keydown toggles), `lastInteraction` (pointerdown/keydown except `d`), `remoteDoze` (from state polls).
- One interval at `KIOSK_TICK_INTERVAL_MS` (plus once immediately on mount): always `fetch('/api/kiosk/state')` → set `remoteDoze`; then, if `shouldRunTick(gate)`, fire-and-forget `fetch('/api/kiosk/tick', { method: 'POST' }).catch(() => {})`.
- Returns `dozing = isDozing(gate)` recomputed each render (a 30s `setInterval` re-render tick keeps `hourLocal`/`msSinceInteraction` fresh).

- [ ] **Step 1: Write the failing test**

`app/kiosk/useKioskRuntime.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKioskRuntime } from './useKioskRuntime';

describe('useKioskRuntime', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    // Noon local, outside default quiet hours
    vi.setSystemTime(new Date(2026, 7, 1, 12, 0, 0));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ doze: false }) });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/kiosk/sunset');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('polls state and fires a tick each minute while awake', async () => {
    renderHook(() => useKioskRuntime());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes('/api/kiosk/state')).length).toBeGreaterThanOrEqual(2);
    expect(urls.filter((u) => u.includes('/api/kiosk/tick')).length).toBeGreaterThanOrEqual(1);
  });

  it('the d key toggles sticky local doze and stops ticks', async () => {
    const { result } = renderHook(() => useKioskRuntime());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    });
    expect(result.current.dozing).toBe(true);
    // an ordinary interaction must NOT wake a manual doze
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(result.current.dozing).toBe(true);
    fetchMock.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/kiosk/tick'))).toBe(false);
    expect(urls.some((u) => u.includes('/api/kiosk/state'))).toBe(true); // still listens
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    });
    expect(result.current.dozing).toBe(false);
  });

  it('remote doze from the state poll dozes the kiosk', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ doze: true }) });
    const { result } = renderHook(() => useKioskRuntime());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.dozing).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/kiosk/useKioskRuntime.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`app/kiosk/useKioskRuntime.ts`:

```ts
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  parseQuietParam,
  isDozing,
  shouldRunTick,
  type QuietWindow,
} from './kioskSchedule';
import {
  KIOSK_TICK_INTERVAL_MS,
  KIOSK_WAKE_MINUTES,
} from '@/app/lib/masterConfig';

export function useKioskRuntime(): { dozing: boolean } {
  const [visible, setVisible] = useState(true);
  const [localDoze, setLocalDoze] = useState(false);
  const [remoteDoze, setRemoteDoze] = useState(false);
  const [, forceRender] = useState(0);
  const quietRef = useRef<QuietWindow>(null);
  const lastInteractionRef = useRef<number | null>(null);
  const localDozeRef = useRef(false);
  const remoteDozeRef = useRef(false);
  const visibleRef = useRef(true);
  localDozeRef.current = localDoze;
  remoteDozeRef.current = remoteDoze;
  visibleRef.current = visible;

  const gate = useCallback(
    () => ({
      visible: visibleRef.current,
      localDoze: localDozeRef.current,
      remoteDoze: remoteDozeRef.current,
      quiet: quietRef.current,
      hourLocal: new Date().getHours(),
      msSinceInteraction:
        lastInteractionRef.current === null
          ? null
          : Date.now() - lastInteractionRef.current,
      wakeMinutes: KIOSK_WAKE_MINUTES,
    }),
    [],
  );

  useEffect(() => {
    quietRef.current = parseQuietParam(
      new URLSearchParams(window.location.search).get('quiet'),
    );

    const onVisibility = () =>
      setVisible(document.visibilityState === 'visible');
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'd') {
        setLocalDoze((v) => !v);
        return; // the toggle itself is not a wake interaction
      }
      lastInteractionRef.current = Date.now();
    };
    const onInteraction = () => {
      lastInteractionRef.current = Date.now();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('pointerdown', onInteraction);
    window.addEventListener('pointermove', onInteraction);

    const poll = async () => {
      try {
        const res = await fetch('/api/kiosk/state');
        if (res.ok) {
          const { doze } = (await res.json()) as { doze: boolean };
          setRemoteDoze(doze);
          remoteDozeRef.current = doze;
        }
      } catch {
        /* state poll failures are non-fatal */
      }
      if (shouldRunTick(gate())) {
        fetch('/api/kiosk/tick', { method: 'POST' }).catch(() => {});
      }
    };
    void poll();
    const interval = setInterval(poll, KIOSK_TICK_INTERVAL_MS);
    // Cheap re-render so hourLocal / wake-window expiry are reflected in UI.
    const renderTick = setInterval(() => forceRender((n) => n + 1), 30_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('pointermove', onInteraction);
      clearInterval(interval);
      clearInterval(renderTick);
    };
  }, [gate]);

  return { dozing: isDozing(gate()) };
}
```

`app/kiosk/KioskDozeOverlay.tsx`:

```tsx
'use client';

// Dim "dozing" state — a slow 2s fade so a deliberate doze reads as
// intentional, per the spec ("the pause is visible").
export function KioskDozeOverlay({ dozing }: { dozing: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        opacity: dozing ? 0.97 : 0,
        pointerEvents: 'none',
        transition: 'opacity 2s ease',
        zIndex: 50,
      }}
    />
  );
}
```

In `app/kiosk/sunset/page.tsx` (and the sunrise mirror), add:

```tsx
import { useKioskRuntime } from '../useKioskRuntime';
import { KioskDozeOverlay } from '../KioskDozeOverlay';
```

Inside the component: `const { dozing } = useKioskRuntime();` and render `<KioskDozeOverlay dozing={dozing} />` as a sibling after `<MosaicCanvas …/>` (wrap in a fragment if needed).

Update `app/kiosk/sunset/page.test.tsx` / `sunrise/page.test.tsx`: add

```ts
vi.mock('../useKioskRuntime', () => ({
  useKioskRuntime: () => ({ dozing: false }),
}));
```

(matching the files' existing mock style for `useLoadTerminatorWebcams`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/kiosk/`
Expected: PASS (runtime hook + both page tests + schedule tests)

- [ ] **Step 5: Commit**

```bash
git add app/kiosk/
git commit -m "feat(kiosk): presence runtime — minute ticks, quiet hours, d-key doze, fade overlay"
```

---

### Task 15: Doze toggle in the Ops tab

**Files:**
- Create: `app/components/Ops/DozeControl.tsx`
- Modify: `app/components/Ops/OpsPanels.tsx` (render it above the tiles)
- Test: `app/components/Ops/DozeControl.test.tsx`

**Interfaces:**
- Consumes: `GET /api/kiosk/state`, `POST /api/kiosk/doze`.
- Produces: `DozeControl()` — shows current remote doze state, one MUI `Button` toggling it.

- [ ] **Step 1: Write the failing test**

`app/components/Ops/DozeControl.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DozeControl } from './DozeControl';

describe('DozeControl', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows awake state and dozes on click', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ doze: false }) }) // initial GET
      .mockResolvedValueOnce({ ok: true, json: async () => ({ doze: true }) }); // POST
    render(<DozeControl />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /doze kiosks/i })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: /doze kiosks/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /wake kiosks/i })).toBeInTheDocument(),
    );
    const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(String(postCall![0])).toContain('/api/kiosk/doze');
    expect(JSON.parse(postCall![1].body as string)).toEqual({ doze: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/Ops/DozeControl.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`app/components/Ops/DozeControl.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';

export function DozeControl() {
  const [doze, setDoze] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/kiosk/state')
      .then((r) => r.json())
      .then((b: { doze: boolean }) => setDoze(b.doze))
      .catch(() => setDoze(null));
  }, []);

  const toggle = async () => {
    if (doze === null || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/kiosk/doze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ doze: !doze }),
      });
      if (res.ok) setDoze(((await res.json()) as { doze: boolean }).doze);
    } finally {
      setBusy(false);
    }
  };

  if (doze === null) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
      <Typography sx={{ color: '#9ca3af' }}>
        Gallery kiosks: {doze ? 'dozing 🌙' : 'awake ☀️'}
      </Typography>
      <Button variant="outlined" size="small" disabled={busy} onClick={toggle}>
        {doze ? 'Wake kiosks' : 'Doze kiosks'}
      </Button>
    </Box>
  );
}
```

In `OpsPanels.tsx`, render `<DozeControl />` first (before the stat tiles). It hides itself (`null`) if the state fetch fails, so the "No data yet." empty-state test still passes — verify.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/components/Ops/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/components/Ops/
git commit -m "feat(ops): remote kiosk doze toggle in the Ops tab"
```

---

### Task 16: Docs — GALLERY_DISPLAY + deploy checklist

**Files:**
- Modify: `GALLERY_DISPLAY.md` (append a "Gallery mode runtime" section)

- [ ] **Step 1: Append the section**

```markdown
## Gallery mode runtime (2026-07)

**Cadence:** kiosk pages POST `/api/kiosk/tick` every 60s while visible; a Redis
lock caps the whole fleet at ~1 tick/minute. The `*/15` cron is the baseline
when no screen is watching. Scoring re-ranks every minute; individual webcam
images refresh on their upstream cadence (Windy ≈ 5–15 min).

**Quiet hours:** default 01:00–08:00 local. Override per screen in the kiosk
URL: `?quiet=off`, `?quiet=23-9`. Any interaction wakes a quiet-hours doze for
30 minutes.

**Doze controls:**
- Remote (primary): Ops tab in the site drawer → "Doze kiosks" (owner-only).
- Local: the `d` key toggles a sticky per-screen doze (only `d` wakes it).
- Pi case button (Argon ONE, future firmware task): a short single press is
  unused by the stock argonone daemon — extend it to inject `d` into both
  Chromium windows via xdotool. Double-tap=reboot / 3s hold=shutdown /
  5s=hard cut / press-from-off=boot are case-level and unchanged.

**Button card (print and stick on the case):**

| Press                | Does            |
|----------------------|-----------------|
| (off) short press    | power on        |
| short press          | doze / wake     |
| double tap           | reboot          |
| hold 3 s             | safe shutdown   |
| hold 5 s             | force power off |

**Display power** is separate from doze: schedule DPMS off on the Pi (or a TV
timer / smart plug) to save electricity; doze saves database compute.

**Deploy checklist for this feature set:**
1. Apply `database/migrations/20260731_provider_usage_and_cost_events.sql` via psql.
2. Add `NEON_COST_API` to Vercel env (Production).
3. After deploy, confirm ONNX on `/api/kiosk/tick` (real tick latencyMs 100–500 ms
   per image; 10–20 ms = silent baseline fallback).
```

- [ ] **Step 2: Commit**

```bash
git add GALLERY_DISPLAY.md
git commit -m "docs(kiosk): gallery mode runtime, doze controls, button card, deploy checklist"
```

---

## Final verification (after all tasks)

- [ ] `npx vitest run` — full suite green
- [ ] `npm run build` — compiles; `next.config.test.ts` guard green
- [ ] Manual: dev server → owner drawer shows Ops tab with tiles; `/kiosk/sunset?quiet=off` ticks (network tab shows `/api/kiosk/state` + `/api/kiosk/tick` per minute, second screen gets `{throttled:true}`); `d` fades the screen
- [ ] Deploy checklist from Task 16 executed (migration → env var → smoke check)
