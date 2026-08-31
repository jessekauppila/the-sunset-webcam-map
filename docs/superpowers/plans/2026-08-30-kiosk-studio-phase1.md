# Kiosk Studio Phase 1 — Settings Plumbing + /studio Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the studio/live settings pipeline (schema → Postgres → API → kiosk) and the owner-gated `/studio` control page with leva dial rail, live dual-feed preview, hold-to-deploy button, and status strip — proven end-to-end against v1's existing knobs before any v2 mosaic exists.

**Architecture:** Typed knob schemas live in code (per mosaic version + a `shared` namespace); Postgres `kiosk_settings` stores only deviations-from-default per `(profile, namespace)`; dials edit the `studio` profile, one deliberate Deploy copies `studio → live`; the kiosk receives merged `live` values on its existing 60s `/api/kiosk/state` poll via a Redis mirror (the hot path never touches Neon). Precedence everywhere: **URL param → profile value → code default**.

**Tech Stack:** Next.js 15 app router, React 19, `@neondatabase/serverless` raw SQL, Upstash Redis (existing `app/lib/cache.ts`), NextAuth v5 owner gate (`requireOwner`), SWR + zustand, leva 0.10.1 (new dep, /studio only), vitest 3 + testing-library.

**Spec:** `docs/superpowers/specs/2026-08-30-kiosk-studio-control-and-mosaic-v2-design.md` — including the "Mockup decisions (2026-08-30)" addendum, which is binding for all UI treatments (layout A, floating collapse pill, hold-to-deploy, three-way feed toggle, single shared panel geometry, status strip states, owner tag CUT).

## Global Constraints

- Work on branch `feat/kiosk-studio-phase1`, created from `main`. Plain branch in the main checkout — **no worktrees** in this repo.
- Jesse merges PRs in parallel sessions: run `git rev-parse --abbrev-ref HEAD` before **every** commit; if it prints anything other than `feat/kiosk-studio-phase1`, STOP and report — never switch branches silently.
- Stage explicit paths only. **Never `git add -A` or `git add .`**
- TDD: every task writes its failing test first. Tests are colocated (`foo.test.ts` next to `foo.ts`). Route/server tests start with `// @vitest-environment node`. Test names are behavior-and-reason sentences (see `app/kiosk/panelPreview.test.ts`).
- `/api/kiosk/state` hot path must remain Neon-free: live settings come from Redis; Neon is touched only on a cold cache miss (and the code comment must say so).
- Storage is deviations-only: values equal to the code default are never written to the DB; unknown keys are ignored on read.
- Precedence is always URL param → server profile value → code default.
- Migrations are forward-only, idempotent, hand-applied `.sql` files in `database/migrations/` named `YYYYMMDD_snake_name.sql`, with a "why" header comment and the psql apply command.
- Palette (from mockup addendum, for all /studio chrome): grounds `#0b0e14`/`#10141d`, text `#d7dce6`/muted `#7a8497`, drift amber `#f5a344`, deploy red `#c93a3f`, pass green `#4cc38a`, borders `#1d2432`/`#232a38`; monospace (`ui-monospace, SF Mono, Menlo`) for all telemetry values.
- Run `npm run test` (or targeted `npx vitest run <path>`) — never claim pass without output. `npm run lint` and `npm run build` before the final PR.

**One deliberate deviation from the spec, decided here:** the kiosk pages do NOT apply the shared panel-geometry setting to their own rendering — the Pi's browser window physically *is* the panel, so window-fill stays the default there and `?panel=` keeps working as an explicit override. The shared geometry setting drives the `/studio` preview (and stays readable by anything else later). Per-knob reset-to-default inside leva rows is deferred (leva has no native per-row reset); each folder gets a `reset <section>` leva button instead, and per-knob bold-when-differs is rendered as a `●`-prefixed label. Note both in the PR description.

---

### Task 0: Branch setup

**Files:** none (git only)

- [ ] **Step 1: Verify checkout state and create the branch**

```bash
git rev-parse --abbrev-ref HEAD   # note current branch
git status --porcelain            # must be clean; if not, STOP and report
git checkout main && git pull
git checkout -b feat/kiosk-studio-phase1
```

Expected: clean tree, new branch `feat/kiosk-studio-phase1` at origin/main.
If the checkout was mid-work on another branch (dirty tree), STOP and ask Jesse.

---

### Task 1: Settings schema core (pure functions)

**Files:**
- Create: `app/lib/settings/schema.ts`
- Test: `app/lib/settings/schema.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports beyond types).
- Produces (later tasks import all of these from `@/app/lib/settings/schema`):

```ts
export type KnobValue = number | boolean | string;
export type SettingsValues = Record<string, KnobValue>;

export interface KnobBase {
  key: string;
  label: string;
  description: string;
  section: string; // folder name in the rail: 'sizing' | 'arrangement' | 'overlays' | 'glass' | ...
}
export interface NumberKnob extends KnobBase {
  kind: 'number'; min: number; max: number; step: number; default: number;
}
export interface BooleanKnob extends KnobBase { kind: 'boolean'; default: boolean; }
export interface EnumKnob extends KnobBase {
  kind: 'enum'; options: readonly string[]; default: string;
}
export type KnobDescriptor = NumberKnob | BooleanKnob | EnumKnob;
export type SettingsSchema = readonly KnobDescriptor[];

export function schemaDefaults(schema: SettingsSchema): SettingsValues;
export function sanitizeValues(schema: SettingsSchema, input: unknown): SettingsValues;
export function stripDefaults(schema: SettingsSchema, values: SettingsValues): SettingsValues;
export function mergeSettings(
  schema: SettingsSchema,
  deviations?: SettingsValues,
  overrides?: SettingsValues
): SettingsValues;
export function diffKeys(
  schema: SettingsSchema,
  a?: SettingsValues,
  b?: SettingsValues
): string[];
```

Semantics to implement exactly:
- `schemaDefaults`: `{ [k.key]: k.default }` for every knob.
- `sanitizeValues`: non-object input → `{}`. Drops keys not in the schema. Number knobs: rejects non-finite / wrong-type values, clamps into `[min, max]`. Boolean knobs: accepts only `true`/`false`. Enum knobs: accepts only listed options. Rejected values are omitted (never coerced).
- `stripDefaults`: removes entries strictly equal to the knob's default.
- `mergeSettings`: starts from defaults, applies sanitized `deviations`, then sanitized `overrides` — iterates the **schema**, so unknown keys in either blob are ignored (the spec's "unknown keys are ignored on read").
- `diffKeys`: compares `mergeSettings(schema, a)` vs `mergeSettings(schema, b)` and returns the keys whose effective values differ, in schema order.

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/settings/schema.test.ts
import { describe, it, expect } from 'vitest';
import {
  schemaDefaults, sanitizeValues, stripDefaults, mergeSettings, diffKeys,
  type SettingsSchema,
} from './schema';

const SCHEMA: SettingsSchema = [
  { key: 'floorPx', kind: 'number', min: 20, max: 800, step: 10, default: 100,
    label: 'floor', description: 'min tile px', section: 'sizing' },
  { key: 'cullOverflow', kind: 'boolean', default: true,
    label: 'cull', description: 'drop overflow', section: 'arrangement' },
  { key: 'activeVersion', kind: 'enum', options: ['v1', 'v2'], default: 'v1',
    label: 'version', description: 'mosaic on glass', section: 'glass' },
];

describe('schemaDefaults', () => {
  it('returns every knob at its code default', () => {
    expect(schemaDefaults(SCHEMA)).toEqual({
      floorPx: 100, cullOverflow: true, activeVersion: 'v1',
    });
  });
});

describe('sanitizeValues', () => {
  it('drops unknown keys so removed knobs never poison a stored blob', () => {
    expect(sanitizeValues(SCHEMA, { floorPx: 140, ghost: 9 })).toEqual({ floorPx: 140 });
  });
  it('clamps numbers into their declared range', () => {
    expect(sanitizeValues(SCHEMA, { floorPx: 5000 })).toEqual({ floorPx: 800 });
  });
  it('omits wrong-typed and non-finite values instead of coercing', () => {
    expect(sanitizeValues(SCHEMA, {
      floorPx: 'big', cullOverflow: 'yes', activeVersion: 'v9',
    })).toEqual({});
    expect(sanitizeValues(SCHEMA, { floorPx: NaN })).toEqual({});
  });
  it('returns empty for non-object input', () => {
    expect(sanitizeValues(SCHEMA, null)).toEqual({});
    expect(sanitizeValues(SCHEMA, [1, 2])).toEqual({});
  });
});

describe('stripDefaults', () => {
  it('keeps only deviations so the DB stores nothing redundant', () => {
    expect(stripDefaults(SCHEMA, { floorPx: 100, cullOverflow: false }))
      .toEqual({ cullOverflow: false });
  });
});

describe('mergeSettings', () => {
  it('applies default, then profile deviation, then URL override, in that order', () => {
    expect(mergeSettings(SCHEMA, { floorPx: 140 }, { floorPx: 60 }).floorPx).toBe(60);
    expect(mergeSettings(SCHEMA, { floorPx: 140 }).floorPx).toBe(140);
    expect(mergeSettings(SCHEMA).floorPx).toBe(100);
  });
  it('ignores unknown keys from stored blobs', () => {
    expect(mergeSettings(SCHEMA, { retired: 1 })).toEqual(schemaDefaults(SCHEMA));
  });
});

describe('diffKeys', () => {
  it('reports keys whose effective values differ — the diff badge count', () => {
    expect(diffKeys(SCHEMA, { floorPx: 140 }, {})).toEqual(['floorPx']);
  });
  it('treats an explicit default and an absent key as identical', () => {
    expect(diffKeys(SCHEMA, { floorPx: 100 }, {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/lib/settings/schema.test.ts`
Expected: FAIL — cannot resolve `./schema`.

- [ ] **Step 3: Implement `app/lib/settings/schema.ts`**

Write the module exactly to the interface + semantics above. Reference implementation for the two non-obvious functions:

```ts
export function sanitizeValues(schema: SettingsSchema, input: unknown): SettingsValues {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const out: SettingsValues = {};
  for (const knob of schema) {
    if (!(knob.key in raw)) continue;
    const v = raw[knob.key];
    if (knob.kind === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[knob.key] = Math.min(knob.max, Math.max(knob.min, v));
    } else if (knob.kind === 'boolean') {
      if (typeof v !== 'boolean') continue;
      out[knob.key] = v;
    } else {
      if (typeof v !== 'string' || !knob.options.includes(v)) continue;
      out[knob.key] = v;
    }
  }
  return out;
}

export function mergeSettings(
  schema: SettingsSchema,
  deviations?: SettingsValues,
  overrides?: SettingsValues
): SettingsValues {
  const dev = sanitizeValues(schema, deviations ?? {});
  const ovr = sanitizeValues(schema, overrides ?? {});
  const out: SettingsValues = {};
  for (const knob of schema) {
    out[knob.key] = ovr[knob.key] ?? dev[knob.key] ?? knob.default;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/lib/settings/schema.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/kiosk-studio-phase1
git add app/lib/settings/schema.ts app/lib/settings/schema.test.ts
git commit -m "feat(settings): typed knob schema with sanitize/merge/diff primitives"
```

---

### Task 2: Shared + v1 schemas and the registry export

**Files:**
- Create: `app/lib/settings/sharedSchema.ts`
- Create: `app/components/mosaic/v1/settingsSchema.ts`
- Modify: `app/components/mosaic/registry.ts` (add `MOSAIC_SETTINGS_SCHEMAS`)
- Test: `app/lib/settings/sharedSchema.test.ts`, `app/components/mosaic/v1/settingsSchema.test.ts`

**Interfaces:**
- Consumes: `SettingsSchema`, `SettingsValues`, `mergeSettings` from Task 1; `MOSAIC_VERSIONS`, `DEFAULT_MOSAIC_VERSION` from `@/app/components/mosaic/registry`; `CompositionConfig` from `@/app/components/mosaic/v1/engine/types`; `PRESETS`-compatible names from `app/kiosk/panelPreview.ts`.
- Produces:

```ts
// app/lib/settings/sharedSchema.ts
export const SHARED_NAMESPACE = 'shared';
export const SHARED_SCHEMA: SettingsSchema; // knobs: activeVersion, panelPreset

// app/components/mosaic/v1/settingsSchema.ts
export const V1_SETTINGS_SCHEMA: SettingsSchema;
// knobs (all mirroring COMPOSITION_CONFIG defaults exactly):
//   sizing: floorPx(20..800 step 10, def 100), ceilPx(50..1000 step 10, def 300),
//           upscaleMax(1..3 step 0.1, def 1.5), maxGrowth(1..5 step 0.1, def 2)
//   arrangement: padding(0..20 step 1, def 2), cullOverflow(bool, def true)
//   overlays: showModelReadout(bool, def false)
export function configFromSettings(values?: SettingsValues): Partial<CompositionConfig>;
// picks floorPx/ceilPx/upscaleMax/maxGrowth/padding/cullOverflow from a merged
// values object into CompositionConfig field names (they match 1:1).

// app/components/mosaic/registry.ts (addition)
export const MOSAIC_SETTINGS_SCHEMAS: Record<string, SettingsSchema>; // { v1: V1_SETTINGS_SCHEMA }
```

`SHARED_SCHEMA` contents:
- `activeVersion`: enum, `options: Object.keys(MOSAIC_VERSIONS)`, `default: DEFAULT_MOSAIC_VERSION`, section `'glass'`, label `'active version'`.
- `panelPreset`: enum, `options: ['dell', 'ktc']`, `default: 'dell'`, section `'glass'`, label `'panel'`, description noting dell = 1080×1920, ktc = 1440×2560, and that both physical screens share one geometry (mockup addendum §4).

Import direction (avoids cycles): `sharedSchema.ts` imports from `registry.ts`; `registry.ts` imports `v1/settingsSchema.ts`; `v1/settingsSchema.ts` imports only Task 1 types + `engine/types` + `config.ts` constants. Nothing in `mosaic/` imports `sharedSchema.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// app/components/mosaic/v1/settingsSchema.test.ts
import { describe, it, expect } from 'vitest';
import { V1_SETTINGS_SCHEMA, configFromSettings } from './settingsSchema';
import { schemaDefaults, mergeSettings } from '@/app/lib/settings/schema';
import { COMPOSITION_CONFIG } from './config';

describe('V1_SETTINGS_SCHEMA', () => {
  it('defaults match the frozen v1 COMPOSITION_CONFIG so dials start where code is', () => {
    const d = schemaDefaults(V1_SETTINGS_SCHEMA);
    expect(d.floorPx).toBe(COMPOSITION_CONFIG.floorPx);
    expect(d.ceilPx).toBe(COMPOSITION_CONFIG.ceilPx);
    expect(d.upscaleMax).toBe(COMPOSITION_CONFIG.upscaleMax);
    expect(d.maxGrowth).toBe(COMPOSITION_CONFIG.maxGrowth);
    expect(d.padding).toBe(COMPOSITION_CONFIG.padding);
    expect(d.cullOverflow).toBe(COMPOSITION_CONFIG.cullOverflow);
    expect(d.showModelReadout).toBe(false);
  });
});

describe('configFromSettings', () => {
  it('maps merged knob values onto CompositionConfig fields and nothing else', () => {
    const merged = mergeSettings(V1_SETTINGS_SCHEMA, { floorPx: 140, showModelReadout: true });
    const cfg = configFromSettings(merged);
    expect(cfg.floorPx).toBe(140);
    expect('showModelReadout' in cfg).toBe(false);
  });
  it('returns an empty partial when given nothing, deferring to code defaults', () => {
    expect(configFromSettings(undefined)).toEqual({});
  });
});
```

```ts
// app/lib/settings/sharedSchema.test.ts
import { describe, it, expect } from 'vitest';
import { SHARED_SCHEMA, SHARED_NAMESPACE } from './sharedSchema';
import { schemaDefaults } from './schema';
import { DEFAULT_MOSAIC_VERSION } from '@/app/components/mosaic/registry';

describe('SHARED_SCHEMA', () => {
  it('activeVersion defaults to the registry pin so an empty DB changes nothing', () => {
    expect(schemaDefaults(SHARED_SCHEMA).activeVersion).toBe(DEFAULT_MOSAIC_VERSION);
  });
  it('panelPreset options are the named panelPreview presets', () => {
    const knob = SHARED_SCHEMA.find((k) => k.key === 'panelPreset');
    expect(knob?.kind).toBe('enum');
    expect(knob && 'options' in knob ? [...knob.options] : []).toEqual(['dell', 'ktc']);
  });
  it('exports the namespace constant used by storage rows', () => {
    expect(SHARED_NAMESPACE).toBe('shared');
  });
});
```

Note: `registry.test.tsx` mocks `./v1` — check whether the existing mock also needs `settingsSchema`; the v1 settingsSchema import in `registry.ts` must come from `./v1/settingsSchema` directly (not `./v1` barrel) so that mock stays untouched.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/lib/settings/sharedSchema.test.ts app/components/mosaic/v1/settingsSchema.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three files**

`configFromSettings`:

```ts
const CONFIG_KEYS = ['floorPx', 'ceilPx', 'upscaleMax', 'maxGrowth', 'padding', 'cullOverflow'] as const;

export function configFromSettings(values?: SettingsValues): Partial<CompositionConfig> {
  if (!values) return {};
  const out: Record<string, unknown> = {};
  for (const key of CONFIG_KEYS) {
    if (key in values) out[key] = values[key];
  }
  return out as Partial<CompositionConfig>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/lib/settings/sharedSchema.test.ts app/components/mosaic/v1/settingsSchema.test.ts app/components/mosaic/registry.test.tsx`
Expected: PASS, including the untouched registry test.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/lib/settings/sharedSchema.ts app/lib/settings/sharedSchema.test.ts \
  app/components/mosaic/v1/settingsSchema.ts app/components/mosaic/v1/settingsSchema.test.ts \
  app/components/mosaic/registry.ts
git commit -m "feat(settings): shared + v1 knob schemas, registry schema map"
```

---

### Task 3: `kiosk_settings` table + server store module

**Files:**
- Create: `database/migrations/20260830_kiosk_settings.sql`
- Create: `app/lib/settings/store.ts`
- Test: `app/lib/settings/store.test.ts`

**Interfaces:**
- Consumes: `sql` from `@/app/lib/db`; `SettingsValues` from Task 1.
- Produces:

```ts
// app/lib/settings/store.ts  — starts with: import 'server-only';
export type SettingsProfile = 'studio' | 'live';
export interface ProfileSettings {
  namespaces: Record<string, SettingsValues>; // deviations-only blobs by namespace
  revision: number;                           // max row revision for the profile, 0 if empty
}
export async function getProfileSettings(profile: SettingsProfile): Promise<ProfileSettings>;
export async function putStudioNamespace(
  namespace: string,
  deviations: SettingsValues // ALREADY sanitized+stripped by the caller (the API route)
): Promise<number>; // new studio revision
export async function copyProfile(
  from: SettingsProfile, to: SettingsProfile
): Promise<ProfileSettings>; // returns the new target profile state
```

Behavior:
- `putStudioNamespace` with an **empty** deviations object DELETEs the row (deviations-only invariant), else upserts with `revision = kiosk_settings.revision + 1`.
- `copyProfile` runs two statements via `sql.transaction([...])`: delete target rows whose namespace is absent from source, then `INSERT ... SELECT ... ON CONFLICT (profile, namespace) DO UPDATE SET data = EXCLUDED.data, revision = kiosk_settings.revision + 1, updated_at = now()`. Then reads back via `getProfileSettings(to)`.

- [ ] **Step 1: Write the migration file**

```sql
-- kiosk_settings: dial values for the kiosk studio (spec:
-- docs/superpowers/specs/2026-08-30-kiosk-studio-control-and-mosaic-v2-design.md).
-- One row per (profile, namespace). 'studio' is the editing surface, 'live' is
-- what the glass reads; "Deploy to glass" copies studio -> live. The JSONB blob
-- stores ONLY values that deviate from the code-default in the version's
-- settingsSchema, so adding/renaming/removing knobs never needs a migration.
-- Forward-only, idempotent. Apply manually via:
--   psql "$DATABASE_URL" -f database/migrations/20260830_kiosk_settings.sql

CREATE TABLE IF NOT EXISTS kiosk_settings (
  profile     TEXT NOT NULL CHECK (profile IN ('studio', 'live')),
  namespace   TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision    INT NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile, namespace)
);
```

- [ ] **Step 2: Write the failing store test**

```ts
// app/lib/settings/store.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const txnMock = vi.fn();
vi.mock('@/app/lib/db', () => {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values);
  (tag as unknown as { transaction: typeof txnMock }).transaction = txnMock;
  return { sql: tag };
});

import { getProfileSettings, putStudioNamespace, copyProfile } from './store';

beforeEach(() => { sqlMock.mockReset(); txnMock.mockReset(); });

describe('getProfileSettings', () => {
  it('folds rows into a namespace map with the max revision', async () => {
    sqlMock.mockResolvedValueOnce([
      { namespace: 'shared', data: { activeVersion: 'v1' }, revision: 3 },
      { namespace: 'v1', data: { floorPx: 140 }, revision: 7 },
    ]);
    expect(await getProfileSettings('live')).toEqual({
      namespaces: { shared: { activeVersion: 'v1' }, v1: { floorPx: 140 } },
      revision: 7,
    });
  });
  it('returns an empty profile at revision 0 when no rows exist', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getProfileSettings('studio')).toEqual({ namespaces: {}, revision: 0 });
  });
});

describe('putStudioNamespace', () => {
  it('upserts deviations and returns the bumped revision', async () => {
    sqlMock.mockResolvedValueOnce([{ revision: 8 }]);
    expect(await putStudioNamespace('v1', { floorPx: 140 })).toBe(8);
    const [strings] = sqlMock.mock.calls[0];
    expect(strings.join('?')).toContain('ON CONFLICT');
  });
  it('deletes the row when every knob is back at default, keeping storage deviations-only', async () => {
    sqlMock.mockResolvedValueOnce([]);   // DELETE
    sqlMock.mockResolvedValueOnce([{ max: 5 }]); // revision re-read
    expect(await putStudioNamespace('v1', {})).toBe(5);
    const [strings] = sqlMock.mock.calls[0];
    expect(strings.join('?')).toContain('DELETE FROM kiosk_settings');
  });
});

describe('copyProfile', () => {
  it('runs prune + upsert in one transaction, then returns the new target state', async () => {
    txnMock.mockResolvedValueOnce([[], []]);
    sqlMock.mockResolvedValueOnce([
      { namespace: 'v1', data: { floorPx: 140 }, revision: 15 },
    ]);
    const result = await copyProfile('studio', 'live');
    expect(txnMock).toHaveBeenCalledTimes(1);
    expect(result.revision).toBe(15);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run app/lib/settings/store.test.ts`
Expected: FAIL — `./store` not found.

- [ ] **Step 4: Implement `app/lib/settings/store.ts`**

```ts
import 'server-only';
import { sql } from '@/app/lib/db';
import type { SettingsValues } from './schema';

export type SettingsProfile = 'studio' | 'live';
export interface ProfileSettings {
  namespaces: Record<string, SettingsValues>;
  revision: number;
}

interface Row { namespace: string; data: SettingsValues; revision: number }

export async function getProfileSettings(profile: SettingsProfile): Promise<ProfileSettings> {
  const rows = (await sql`
    SELECT namespace, data, revision FROM kiosk_settings WHERE profile = ${profile}
  `) as unknown as Row[];
  const namespaces: Record<string, SettingsValues> = {};
  let revision = 0;
  for (const r of rows) {
    namespaces[r.namespace] = r.data;
    revision = Math.max(revision, r.revision);
  }
  return { namespaces, revision };
}

export async function putStudioNamespace(
  namespace: string, deviations: SettingsValues
): Promise<number> {
  if (Object.keys(deviations).length === 0) {
    await sql`DELETE FROM kiosk_settings WHERE profile = 'studio' AND namespace = ${namespace}`;
    const rows = (await sql`
      SELECT COALESCE(MAX(revision), 0) AS max FROM kiosk_settings WHERE profile = 'studio'
    `) as unknown as { max: number }[];
    return Number(rows[0]?.max ?? 0);
  }
  const json = JSON.stringify(deviations);
  const rows = (await sql`
    INSERT INTO kiosk_settings (profile, namespace, data)
    VALUES ('studio', ${namespace}, ${json}::jsonb)
    ON CONFLICT (profile, namespace)
    DO UPDATE SET data = ${json}::jsonb,
                  revision = kiosk_settings.revision + 1,
                  updated_at = now()
    RETURNING revision
  `) as unknown as { revision: number }[];
  return Number(rows[0].revision);
}

export async function copyProfile(
  from: SettingsProfile, to: SettingsProfile
): Promise<ProfileSettings> {
  await sql.transaction([
    sql`DELETE FROM kiosk_settings
        WHERE profile = ${to}
          AND namespace NOT IN
            (SELECT namespace FROM kiosk_settings WHERE profile = ${from})`,
    sql`INSERT INTO kiosk_settings (profile, namespace, data)
        SELECT ${to}, namespace, data FROM kiosk_settings WHERE profile = ${from}
        ON CONFLICT (profile, namespace)
        DO UPDATE SET data = EXCLUDED.data,
                      revision = kiosk_settings.revision + 1,
                      updated_at = now()`,
  ]);
  return getProfileSettings(to);
}
```

Note: `sql.transaction` exists on the neon client; TypeScript may need
`import { sql } from '@/app/lib/db'` typed access via
`(sql as unknown as { transaction: (qs: unknown[]) => Promise<unknown> })` —
prefer fixing `app/lib/db.ts` to export the properly-typed client instead of
casting at call sites if the types allow it cleanly.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run app/lib/settings/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Apply the migration — CHECKPOINT**

If `DATABASE_URL` is available in the environment, run:

```bash
psql "$DATABASE_URL" -f database/migrations/20260830_kiosk_settings.sql
psql "$DATABASE_URL" -c "\d kiosk_settings"
```

If it is not available, STOP and hand this command to Jesse to run (suggest he type `! psql "$DATABASE_URL" -f database/migrations/20260830_kiosk_settings.sql` in the Claude prompt), and do not mark this step done until the table is confirmed.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add database/migrations/20260830_kiosk_settings.sql \
  app/lib/settings/store.ts app/lib/settings/store.test.ts
git commit -m "feat(settings): kiosk_settings table and studio/live store module"
```

---

### Task 4: Redis mirror for live settings + kiosk poll timestamp

**Files:**
- Modify: `app/lib/cache.ts` (append four helpers; follow the fail-soft style of `getKioskDoze`/`setKioskDoze` at lines ~88–108)
- Test: `app/lib/cache.kioskSettings.test.ts` (new colocated file; check whether `app/lib/cache.test.ts` exists first — if it does, add to it instead, matching its mock style)

**Interfaces:**
- Consumes: the module's existing Upstash client; `ProfileSettings` type from Task 3 (type-only import — cache.ts must not import `server-only` transitively in a way that breaks existing consumers; use `import type`).
- Produces:

```ts
export async function getKioskLiveSettingsCache(): Promise<ProfileSettings | null>; // null on miss OR redis failure
export async function setKioskLiveSettingsCache(s: ProfileSettings): Promise<void>; // fire-and-forget safe
export async function markKioskPoll(): Promise<void>;            // SET kiosk:lastPoll = new Date().toISOString()
export async function getKioskLastPoll(): Promise<string | null>;
```

Redis keys: `kiosk:liveSettings` (JSON string of ProfileSettings, no TTL) and `kiosk:lastPoll` (ISO string, no TTL). All four fail soft (catch → null/void) exactly like `getKioskDoze` — a Redis outage must never break the kiosk or the studio.

- [ ] **Step 1: Read `app/lib/cache.ts` fully**, note the client import and error-handling idiom, and check for an existing test file to extend.

- [ ] **Step 2: Write the failing test** — mock the redis client the same way existing cache tests do (if none exist, `vi.mock` the client module cache.ts imports — adjust the specifier to whatever Step 1 found). Cases:

```ts
// app/lib/cache.kioskSettings.test.ts
// @vitest-environment node
// (mock scaffold: replace the redis client used by app/lib/cache.ts with
//  getMock/setMock vi.fns before importing the helpers under test)
it('round-trips a ProfileSettings object through kiosk:liveSettings', async () => {
  await setKioskLiveSettingsCache({ namespaces: { v1: { floorPx: 140 } }, revision: 15 });
  getMock.mockResolvedValueOnce(setMock.mock.calls[0][1]);
  expect(await getKioskLiveSettingsCache())
    .toEqual({ namespaces: { v1: { floorPx: 140 } }, revision: 15 });
});
it('returns null on a cache miss', async () => {
  getMock.mockResolvedValueOnce(null);
  expect(await getKioskLiveSettingsCache()).toBeNull();
});
it('fails soft to null when redis rejects, so a cache outage never breaks the kiosk', async () => {
  getMock.mockRejectedValueOnce(new Error('down'));
  expect(await getKioskLiveSettingsCache()).toBeNull();
});
it('markKioskPoll stores an ISO timestamp readable by getKioskLastPoll', async () => {
  await markKioskPoll();
  const written = setMock.mock.calls.at(-1);
  expect(written[0]).toBe('kiosk:lastPoll');
  expect(new Date(String(written[1])).toISOString()).toBe(String(written[1]));
});
```

- [ ] **Step 3: Run test to verify it fails.** `npx vitest run app/lib/cache.kioskSettings.test.ts`

- [ ] **Step 4: Implement the four helpers in `app/lib/cache.ts`.**

- [ ] **Step 5: Run the full cache test suite to verify pass.** `npx vitest run app/lib/cache.kioskSettings.test.ts` plus any existing cache tests.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/lib/cache.ts app/lib/cache.kioskSettings.test.ts
git commit -m "feat(settings): redis mirror for live settings + kiosk poll timestamp"
```

---

### Task 5: `GET`/`PATCH /api/kiosk/settings`

**Files:**
- Create: `app/api/kiosk/settings/route.ts`
- Test: `app/api/kiosk/settings/route.test.ts`

**Interfaces:**
- Consumes: `requireOwner` from `@/app/lib/owner`; `getProfileSettings`, `putStudioNamespace` from Task 3; `getKioskLastPoll` from Task 4; `sanitizeValues`, `stripDefaults` from Task 1; `SHARED_NAMESPACE`, `SHARED_SCHEMA` from Task 2; `MOSAIC_SETTINGS_SCHEMAS` from the registry.
- Produces (consumed by `useStudioSettings` in Task 10):

```ts
// GET response (owner-gated)
interface SettingsResponse {
  studio: ProfileSettings;
  live: ProfileSettings;
  lastPollAt: string | null;
}
// PATCH request body: { namespace: string; values: Record<string, unknown> }
//   - namespace must be 'shared' or a key of MOSAIC_SETTINGS_SCHEMAS → else 400
//   - values are sanitized against that namespace's schema, then stripDefaults'd,
//     then stored as the namespace's COMPLETE deviation set (replace semantics)
// PATCH response: { revision: number }   // new studio revision
```

Route file skeleton (follow `app/api/kiosk/doze/route.ts` exactly for shape):

```ts
import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { getProfileSettings, putStudioNamespace } from '@/app/lib/settings/store';
import { getKioskLastPoll } from '@/app/lib/cache';
import { sanitizeValues, stripDefaults } from '@/app/lib/settings/schema';
import { SHARED_NAMESPACE, SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { MOSAIC_SETTINGS_SCHEMAS } from '@/app/components/mosaic/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function schemaFor(namespace: string) {
  if (namespace === SHARED_NAMESPACE) return SHARED_SCHEMA;
  return MOSAIC_SETTINGS_SCHEMAS[namespace] ?? null;
}

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  const [studio, live, lastPollAt] = await Promise.all([
    getProfileSettings('studio'),
    getProfileSettings('live'),
    getKioskLastPoll(),
  ]);
  return NextResponse.json({ studio, live, lastPollAt });
}

export async function PATCH(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  let body: { namespace?: unknown; values?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const { namespace, values } = body;
  if (typeof namespace !== 'string') {
    return NextResponse.json({ error: 'namespace must be a string' }, { status: 400 });
  }
  const schema = schemaFor(namespace);
  if (!schema) {
    return NextResponse.json({ error: `unknown namespace: ${namespace}` }, { status: 400 });
  }
  const deviations = stripDefaults(schema, sanitizeValues(schema, values));
  const revision = await putStudioNamespace(namespace, deviations);
  return NextResponse.json({ revision });
}
```

- [ ] **Step 1: Write the failing test** — copy the mock scaffold from `app/api/kiosk/doze/route.test.ts` (mock `@/app/lib/owner`, `@/app/lib/settings/store`, `@/app/lib/cache`), with cases:
  - GET returns 403 when `requireOwner` denies (mock returns a `NextResponse` 403).
  - GET returns `{ studio, live, lastPollAt }` from the mocked store/cache.
  - PATCH rejects invalid JSON with 400; unknown namespace with 400.
  - PATCH sanitizes: posting `{ namespace: 'v1', values: { floorPx: 5000, ghost: 1 } }` calls `putStudioNamespace('v1', { floorPx: 800 })` (clamped, unknown dropped).
  - PATCH strips defaults: posting `values: { floorPx: 100 }` calls `putStudioNamespace('v1', {})`.

- [ ] **Step 2: Run test to verify it fails.** `npx vitest run app/api/kiosk/settings/route.test.ts`

- [ ] **Step 3: Implement the route** as above.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/api/kiosk/settings/route.ts app/api/kiosk/settings/route.test.ts
git commit -m "feat(settings): owner-gated GET/PATCH /api/kiosk/settings"
```

---

### Task 6: Deploy and Revert routes

**Files:**
- Create: `app/api/kiosk/settings/deploy/route.ts`
- Create: `app/api/kiosk/settings/revert/route.ts`
- Test: `app/api/kiosk/settings/deploy/route.test.ts`, `app/api/kiosk/settings/revert/route.test.ts`

**Interfaces:**
- Consumes: `requireOwner`; `copyProfile` from Task 3; `setKioskLiveSettingsCache` from Task 4.
- Produces (consumed by Task 10):

```ts
// POST /api/kiosk/settings/deploy  → copies studio → live, refreshes the Redis
//   mirror, returns { live: ProfileSettings }
// POST /api/kiosk/settings/revert  → copies live → studio, returns { studio: ProfileSettings }
```

Deploy route body:

```ts
export async function POST() {
  const denied = await requireOwner();
  if (denied) return denied;
  const live = await copyProfile('studio', 'live');
  await setKioskLiveSettingsCache(live); // kiosk sees it on its next 60s poll
  return NextResponse.json({ live });
}
```

Revert is symmetric (`copyProfile('live', 'studio')`, no cache write — studio is never cached) returning `{ studio }`.

- [ ] **Step 1: Write the failing tests** (doze-route mock pattern): auth-denied case; success case asserting `copyProfile` called with the right direction; deploy additionally asserts `setKioskLiveSettingsCache` received `copyProfile`'s return value; revert asserts the cache helper was NOT called.

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement both routes** (`dynamic = 'force-dynamic'`, `runtime = 'nodejs'`).

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/api/kiosk/settings/deploy/route.ts app/api/kiosk/settings/deploy/route.test.ts \
  app/api/kiosk/settings/revert/route.ts app/api/kiosk/settings/revert/route.test.ts
git commit -m "feat(settings): deploy-to-glass and revert-to-glass routes"
```

---

### Task 7: Ride live settings on `/api/kiosk/state`

**Files:**
- Modify: `app/api/kiosk/state/route.ts`
- Modify: `app/kiosk/useKioskRuntime.ts` (surface settings from the poll)
- Create: `app/lib/settings/liveSettings.ts` (cached read helper)
- Test: `app/lib/settings/liveSettings.test.ts`, extend `app/api/kiosk/state`'s test if one exists (check first), extend `app/kiosk/useKioskRuntime.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–4 helpers.
- Produces:

```ts
// app/lib/settings/liveSettings.ts   (import 'server-only')
export async function getLiveSettingsCached(): Promise<ProfileSettings | null>;
// Redis first; on miss, ONE Neon read via getProfileSettings('live'), then
// setKioskLiveSettingsCache to re-warm. Returns null only if both fail.

// GET /api/kiosk/state response becomes:
//   { doze: boolean; settings: ProfileSettings | null }
// and the route fire-and-forgets markKioskPoll().

// useKioskRuntime return type becomes:
//   { dozing: boolean; liveSettings: ProfileSettings | null }
```

The route comment must be updated to keep telling the truth:

```ts
// Redis-first read: this is the endpoint dozing kiosks poll once a minute, so
// the hot path must never touch Neon. Live settings ride the same response via
// a Redis mirror (written on Deploy); Neon is read ONLY on a cold cache miss,
// and the result immediately re-warms the mirror.
```

- [ ] **Step 1: Write the failing test for `getLiveSettingsCached`** — mock `@/app/lib/cache` and `@/app/lib/settings/store`; cases: cache hit → store never called; cache miss → store read once and `setKioskLiveSettingsCache` re-warms; both fail → `null` without throwing.

- [ ] **Step 2: Run to verify fail; implement; run to verify pass.**

- [ ] **Step 3: Update the state route**

```ts
export async function GET() {
  const [doze, settings] = await Promise.all([getKioskDoze(), getLiveSettingsCached()]);
  void markKioskPoll();
  return NextResponse.json({ doze, settings });
}
```

Update/extend its route test (auth-free route; assert shape and that a settings-fetch failure still returns `{ doze, settings: null }`).

- [ ] **Step 4: Update `useKioskRuntime`** — parse `settings` from the poll response alongside `doze`, keep it in state, return `{ dozing, liveSettings }`. Extend `app/kiosk/useKioskRuntime.test.tsx` with one case: a poll response carrying settings makes them available; a failed poll leaves the previous value.

- [ ] **Step 5: Run the affected suites; verify pass.**

Run: `npx vitest run app/lib/settings/liveSettings.test.ts app/kiosk/useKioskRuntime.test.tsx app/api/kiosk`

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/lib/settings/liveSettings.ts app/lib/settings/liveSettings.test.ts \
  app/api/kiosk/state/route.ts app/kiosk/useKioskRuntime.ts app/kiosk/useKioskRuntime.test.tsx
git commit -m "feat(settings): live settings ride the kiosk state poll via redis mirror"
```

(Also stage the state route's test file if it was created/modified.)

---

### Task 8: Kiosk consumes live settings (v1 + pages)

**Files:**
- Modify: `app/components/mosaic/types.ts` (add `settings` to `MosaicProps`)
- Modify: `app/components/mosaic/v1/index.tsx` (merge settings under URL precedence)
- Modify: `app/kiosk/sunset/page.tsx`, `app/kiosk/sunrise/page.tsx` (activeVersion + settings pass-through)
- Test: `app/components/mosaic/v1/index.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `configFromSettings`, `V1_SETTINGS_SCHEMA` (Task 2); `mergeSettings` (Task 1); `liveSettings` from `useKioskRuntime` (Task 7).
- Produces:

```ts
// app/components/mosaic/types.ts — MosaicProps gains:
//   /** Merged-or-deviation knob values for THIS version's namespace (server profile). */
//   settings?: Record<string, number | boolean | string>;
```

v1 merge logic in `index.tsx` (URL params win over profile values, which win over code defaults — `parseCompositionOverrides` and `?models=` are the URL layer):

```tsx
export function MosaicV1({ search = '', settings, ...rest }: MosaicProps) {
  const params = new URLSearchParams(search);
  const merged = mergeSettings(V1_SETTINGS_SCHEMA, settings);
  const overrides = {
    ...configFromSettings(merged),
    ...parseCompositionOverrides(params), // URL keeps the last word
  };
  const modelsMode = params.has('models')
    ? params.get('models') === '1'
    : merged.showModelReadout === true;
  return <GeoMosaic {...rest} config={overrides} modelsMode={modelsMode} />;
}
```

Kiosk pages (both, keeping them byte-identical except feed):
- version: `const Mosaic = resolveMosaic(searchParams.get('v') ?? liveShared.activeVersion)` where `liveShared = mergeSettings(SHARED_SCHEMA, liveSettings?.namespaces.shared)` — URL `?v=` still wins (on-glass A/B).
- settings pass-through: `settings={liveSettings?.namespaces[versionName]}` where `versionName` is the resolved version's registry key (compute it alongside `resolveMosaic`; add a tiny `resolveMosaicName(version: string | null | undefined): string` export to `registry.ts` returning the resolved KEY, with a test).
- Panel geometry: unchanged on the kiosk (see Global Constraints deviation note) — `parsePanelPreview` URL behavior stays as-is.

- [ ] **Step 1: Write the failing tests**
  - `registry.test.tsx` addition: `resolveMosaicName('nope')` → `'v1'`; `resolveMosaicName('v1')` → `'v1'`.
  - `v1/index.test.tsx` (mock `./GeoMosaic` to capture props, as `registry.test.tsx` mocks `./v1`): profile settings reach config (`settings: { floorPx: 140 }` → `config.floorPx === 140`); URL wins (`search: 'floor=60'`, same settings → `config.floorPx === 60`); `showModelReadout: true` turns `modelsMode` on; `search: 'models=0'` beats `showModelReadout: true`.

- [ ] **Step 2: Run to verify fail.** `npx vitest run app/components/mosaic/v1/index.test.tsx app/components/mosaic/registry.test.tsx`

- [ ] **Step 3: Implement** types.ts + index.tsx + registry `resolveMosaicName` + both kiosk pages.

- [ ] **Step 4: Run the full suite** (`npx vitest run app/components/mosaic app/kiosk`) — existing GeoMosaic/kiosk tests must stay green.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/components/mosaic/types.ts app/components/mosaic/v1/index.tsx \
  app/components/mosaic/v1/index.test.tsx app/components/mosaic/registry.ts \
  app/components/mosaic/registry.test.tsx app/kiosk/sunset/page.tsx app/kiosk/sunrise/page.tsx
git commit -m "feat(kiosk): mosaic + pages consume live settings under URL precedence"
```

---

### Task 9: `/studio` route skeleton, container-fit preview, drawer link

**Files:**
- Create: `app/studio/page.tsx`, `app/studio/StudioClient.tsx`
- Create: `app/studio/StudioPanelFrame.tsx`
- Create: `app/studio/PreviewPane.tsx`
- Modify: `app/components/Kiosk/KioskTab.tsx` (add a `/studio` link near the existing preview links)
- Test: `app/studio/StudioPanelFrame.test.tsx`, `app/studio/PreviewPane.test.tsx`

**Interfaces:**
- Consumes: `fitScale`, `PanelSize` from `@/app/kiosk/panelPreview`; `useIsOperator` from `@/app/components/auth/useIsOperator`; `useLoadTerminatorWebcams` + `useTerminatorStore` from `app/store/`; `resolveMosaic`/`resolveMosaicName` from the registry.
- Produces (consumed by Tasks 10–13):

```tsx
// StudioPanelFrame.tsx — PanelFrame's container-measured sibling
export function StudioPanelFrame(props: {
  panel: PanelSize;
  children: React.ReactNode;
}): React.ReactNode;
// Measures its own wrapper via ResizeObserver, scale = fitScale(panel.width,
// panel.height, boxW, boxH), renders data-testid="studio-panel-stage" at true
// panel px with transform: scale(scale), transformOrigin 'top left',
// background '#000'. (Copy PanelFrame.tsx's stage markup; only the measuring
// differs. Do not modify PanelFrame — the kiosk owns it.)

// PreviewPane.tsx
export type FeedView = 'sunrise' | 'sunset' | 'both';
export function PreviewPane(props: {
  view: FeedView;
  onViewChange: (v: FeedView) => void;
  panel: PanelSize;                   // from shared panelPreset (studio profile)
  panelPresetLabel: string;           // e.g. 'dell · 1080×1920'
  versionName: string;                // resolved studio activeVersion
  settings?: SettingsValues;          // studio deviations for versionName
}): React.ReactNode;
// Renders the three-way segmented toggle (sunrise | sunset | both, mockup §4),
// the single shared geometry chip, and one StudioPanelFrame per visible feed,
// each containing <Mosaic webcams={...} width={panel.width} height={panel.height}
// feed={f} search="" settings={settings} /> with webcams from useTerminatorStore
// (t.sunrise / t.sunset).
```

`page.tsx`: `'use client'` wrapper in `<Suspense fallback={null}>`; if `useIsOperator()` → not operator and not loading, render a plain dark page saying "Owner sign-in required" with the existing sign-in affordance used by HomeClient (writes are separately server-gated, so client gating here is presentational, same trust model as the Ops tab). Otherwise render `StudioClient`.

`StudioClient.tsx` (this task = static skeleton; rail content arrives in Task 11): CSS grid per mockup layout A — left rail `320px` (placeholder `<aside>` with the dusk ground `#10141d`), main preview area, bottom status strip placeholder (28px, `#0e1119`). A `railCollapsed` boolean state: when true, the rail column is removed and a floating pill (`» dials` button only, for now — Deploy joins it in Task 12) renders over the preview area's letterbox, absolutely positioned bottom-left per mockup §2. Page background `#0b0e14`; suppress any global light chrome (the route brings its own full-page styles).

KioskTab link: next to the existing preview `MuiLink`s, add `<MuiLink href="/studio" target="_blank">🎛 Studio</MuiLink>` (visible only in this operator-only tab already — no extra gating needed).

- [ ] **Step 1: Write the failing tests**
  - `StudioPanelFrame.test.tsx`: mock `ResizeObserver` (jsdom lacks it) with a stub that immediately calls back with a chosen content size; assert the stage renders at true panel px and the wrapper applies the `fitScale` transform for a 1440×2560 panel in a 700×900 box (`scale(0.3515625)` — `700/1440 > 900/2560`, so `900/2560`); assert scale caps at 1 in an oversized box.
  - `PreviewPane.test.tsx` (mock the registry's mosaic with a spy component, seed `useTerminatorStore` directly): `view='both'` renders two stages with feeds sunrise+sunset; `view='sunset'` renders one; clicking the `sunrise` segment calls `onViewChange('sunrise')`; the geometry chip text renders `panelPresetLabel`.

- [ ] **Step 2: Run to verify fail.** `npx vitest run app/studio`

- [ ] **Step 3: Implement** the four files + KioskTab link.

- [ ] **Step 4: Run to verify pass**, plus `npx vitest run app/components/Kiosk/KioskTab.test.tsx` (existing test must stay green; extend it with a one-liner asserting the Studio link exists).

- [ ] **Step 5: Manual smoke** — `npm run dev`, open `http://localhost:3000/studio` signed in: dark page, rail placeholder, both panels rendering the live v1 mosaic, toggle works, collapse pill appears.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/studio/page.tsx app/studio/StudioClient.tsx app/studio/StudioPanelFrame.tsx \
  app/studio/StudioPanelFrame.test.tsx app/studio/PreviewPane.tsx app/studio/PreviewPane.test.tsx \
  app/components/Kiosk/KioskTab.tsx app/components/Kiosk/KioskTab.test.tsx
git commit -m "feat(studio): /studio skeleton with dual-feed container-fit preview"
```

---

### Task 10: `useStudioSettings` hook

**Files:**
- Create: `app/studio/useStudioSettings.ts`
- Test: `app/studio/useStudioSettings.test.tsx`

**Interfaces:**
- Consumes: SWR; Task 1 (`mergeSettings`, `diffKeys`, `stripDefaults`, `sanitizeValues`); Task 2 schemas + `MOSAIC_SETTINGS_SCHEMAS`; the Task 5/6 API contract.
- Produces (consumed by Tasks 11–13):

```ts
export interface StudioSettingsApi {
  loading: boolean;
  studio: ProfileSettings | undefined;   // server truth incl. optimistic local edits
  live: ProfileSettings | undefined;
  lastPollAt: string | null;
  liveRevision: number;                  // 0 while loading
  effective: (namespace: string) => SettingsValues; // mergeSettings over studio deviations
  setKnob: (namespace: string, key: string, value: KnobValue) => void;
  resetSection: (namespace: string, section: string) => void; // clears that section's deviations
  diffByNamespace: Record<string, string[]>; // diffKeys(schema, studio[ns], live[ns]) per known ns
  diffCount: number;                     // total across namespaces — the badge number
  deploy: () => Promise<void>;
  revert: () => Promise<void>;
  deployedAtMs: number | null;           // Date.now() at last successful deploy this session
}
export function useStudioSettings(): StudioSettingsApi;
```

Behavior:
- `useSWR('/api/kiosk/settings', fetcher, { refreshInterval: 30_000 })`.
- `setKnob`: updates a local optimistic overlay immediately (dials must feel live), and debounce-PATCHes the namespace's full deviation set 400ms after the last change (`stripDefaults(schema, sanitize({...currentDeviations, [key]: value}))`). One timer per namespace.
- `deploy`: POST `/api/kiosk/settings/deploy`, then `mutate` the SWR key with the returned `live`, set `deployedAtMs = Date.now()`.
- `revert`: POST `.../revert`, `mutate` with returned `studio`, clear the optimistic overlay.
- Known namespaces for diffing = `['shared', ...Object.keys(MOSAIC_SETTINGS_SCHEMAS)]`.

- [ ] **Step 1: Write the failing test** — `renderHook` with a mocked global `fetch` (`vi.stubGlobal('fetch', fetchMock)`) and fake timers; cases:
  - `diffCount` is 1 when studio has `{ v1: { floorPx: 140 } }` and live is empty.
  - `setKnob('v1', 'floorPx', 200)` updates `effective('v1').floorPx` synchronously and fires exactly one PATCH with the full deviation set after the debounce window (advance timers; assert `fetchMock` body).
  - Setting a knob back to its default results in a PATCH with that key absent.
  - `deploy()` POSTs to the deploy route and zeroes `diffCount` from the mutated response.

- [ ] **Step 2: Run to verify fail.** `npx vitest run app/studio/useStudioSettings.test.tsx`

- [ ] **Step 3: Implement the hook.**

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/studio/useStudioSettings.ts app/studio/useStudioSettings.test.tsx
git commit -m "feat(studio): useStudioSettings hook — optimistic dials, debounced PATCH, deploy/revert"
```

---

### Task 11: Leva rail rendered from the schema

**Files:**
- Modify: `package.json` (add leva)
- Create: `app/studio/levaConfig.ts` (pure builder)
- Create: `app/studio/StudioRail.tsx`
- Modify: `app/studio/StudioClient.tsx` (mount the rail in the `<aside>`)
- Test: `app/studio/levaConfig.test.ts`

**Interfaces:**
- Consumes: Task 1 types; Task 10 `StudioSettingsApi`; leva's `useControls`/`folder`/`button`/`LevaPanel`/`useCreateStore`.
- Produces:

```ts
// app/studio/levaConfig.ts — PURE, fully unit-testable (no leva imports needed
// beyond types; build plain objects leva accepts).
export interface LevaFolderSpec {
  section: string;
  controls: Record<string, {
    value: KnobValue;
    label: string;          // '● floorPx' when the knob differs from live, else 'floorPx'
    min?: number; max?: number; step?: number;   // number knobs
    options?: readonly string[];                 // enum knobs
  }>;
}
export function buildFolderSpecs(
  schema: SettingsSchema,
  effective: SettingsValues,
  differingKeys: string[]
): LevaFolderSpec[]; // one spec per distinct section, schema order preserved
```

`StudioRail.tsx` composition:
- Top block (plain MUI/JSX, NOT leva): version `<Select>` bound to `effective('shared').activeVersion` via `setKnob('shared', 'activeVersion', v)`; a `STUDIO` chip (green `#4cc38a` on `#17351f`); placeholders where `DeployButton` (Task 12) will mount — pass a `deploySlot?: React.ReactNode` prop so Task 12 plugs in without rewriting the rail.
- One `LevaPanel` with a `useCreateStore()` store, `fill flat titleBar={false}`, themed to the dusk palette (leva `theme` prop: `colors: { elevation1/2/3, accent1/2/3, highlight1/2/3 }` mapped to the Global Constraints palette).
- Controls declared via `useControls` per section folder from `buildFolderSpecs(schema, effective(ns), diffByNamespace[ns])`, with `onChange` handlers calling `setKnob(ns, key, value)` (leva `transient: false` not needed; use the `onChange` option per control so leva doesn't own state). Rebuild control values when `effective(ns)` changes from outside (revert) — pass leva the values each render via the spec and a `deps` array.
- Rail shows the `shared` folder (from `SHARED_SCHEMA`, minus `activeVersion` which the top Select owns — filter it out) followed by the active version's folders.
- Each folder appends `button('reset ' + section)` calling `resetSection(ns, section)`.
- The `» / «` collapse toggle at the rail's top-right sets `railCollapsed` in StudioClient.

- [ ] **Step 1: Install leva**

```bash
npm install leva@0.10.1
```

Verify `npm run build` still succeeds before writing code (peer-dep sanity for React 19).

- [ ] **Step 2: Write the failing test for `buildFolderSpecs`** — with a 3-knob schema spanning 2 sections: folder grouping and order; `●`-prefixed label only for differing keys; min/max/step present on number knobs, options on enums, neither on booleans; values come from `effective`.

- [ ] **Step 3: Run to verify fail; implement `levaConfig.ts`; run to verify pass.**

- [ ] **Step 4: Implement `StudioRail.tsx` and mount it.** No new unit test for the leva wiring itself (leva's DOM is third-party); the pure builder carries the logic. Manual smoke: dials move the preview live (floorPx slider visibly resizes tiles), version select works, reset buttons clear a section.

- [ ] **Step 5: Run the studio suite + build.** `npx vitest run app/studio && npm run build`

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add package.json package-lock.json app/studio/levaConfig.ts app/studio/levaConfig.test.ts \
  app/studio/StudioRail.tsx app/studio/StudioClient.tsx
git commit -m "feat(studio): leva dial rail rendered from settings schema"
```

---

### Task 12: Hold-to-deploy button, revert, diff badge, collapse pill

**Files:**
- Create: `app/studio/useHoldToFire.ts`
- Create: `app/studio/DeployButton.tsx`
- Modify: `app/studio/StudioClient.tsx` (mount in rail `deploySlot` AND in the collapsed floating pill)
- Test: `app/studio/useHoldToFire.test.tsx`, `app/studio/DeployButton.test.tsx`

**Interfaces:**
- Consumes: Task 10 `StudioSettingsApi` (`diffCount`, `deploy`, `revert`).
- Produces:

```ts
export function useHoldToFire(options: { ms: number; onFire: () => void; disabled?: boolean }): {
  holding: boolean;
  handlers: {
    onPointerDown: () => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
  };
};
// pointerdown starts a setTimeout(ms); pointerup/leave before it fires clears it
// (no-op); firing calls onFire exactly once and ends the hold. disabled ignores input.

export function DeployButton(props: {
  diffCount: number;
  onDeploy: () => Promise<void>;
  onRevert: () => Promise<void>;
  compact?: boolean; // pill variant for the collapsed state
}): React.ReactNode;
```

DeployButton rendering (mockup §3, binding):
- Armed (`diffCount > 0`): red gradient (`#c93a3f` family) glow, text `HOLD TO DEPLOY`, sub-line `▲ N settings differ` inside the button face. While `holding`, a lighter fill sweeps left→right over the hold duration (CSS `width` transition `600ms linear`, driven by the `holding` class — respect `prefers-reduced-motion` by jumping the fill).
- In sync (`diffCount === 0`): dark inert face (`#141a26`, border `#1e2635`, text `#5a6375`) reading `IN SYNC WITH GLASS ✓`, sub-line `dials match the deployed state`; hold disabled.
- Below: `↩ revert to glass` text button — calls `onRevert`, `opacity: .35` and disabled when in sync.
- `compact` variant: single-row pill content (`DEPLOY` + `N differ` chip) for the collapsed floating pill; same hold behavior.
- Hold duration: export `const DEPLOY_HOLD_MS = 600`.

StudioClient collapsed pill (mockup §2): floating bottom-left of the preview area — `» dials` (expands the rail) + `<DeployButton compact ...>` — translucent ground `rgba(16,20,29,.85)`, border `#232a38`. Status strip remains visible when collapsed.

- [ ] **Step 1: Write the failing tests**
  - `useHoldToFire.test.tsx` (`renderHook` + `vi.useFakeTimers()`): fires exactly once after `ms`; releasing at `ms - 1` never fires; `disabled` ignores pointerdown; a second hold after firing works.
  - `DeployButton.test.tsx` (fake timers + user-event pointer): armed face shows the diff count; completing a hold calls `onDeploy` once; early release does not; `diffCount === 0` face shows `IN SYNC WITH GLASS ✓` and a completed hold does NOT call `onDeploy`; revert button disabled in sync.

- [ ] **Step 2: Run to verify fail.** `npx vitest run app/studio/useHoldToFire.test.tsx app/studio/DeployButton.test.tsx`

- [ ] **Step 3: Implement hook + component + StudioClient wiring.**

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Manual smoke** — change a dial, watch the badge count, hold Deploy, confirm: badge zeroes, kiosk page (open `/kiosk/sunset` in another tab) picks the value up within a poll cycle, Revert pulls a dead-end experiment back.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/studio/useHoldToFire.ts app/studio/useHoldToFire.test.tsx \
  app/studio/DeployButton.tsx app/studio/DeployButton.test.tsx app/studio/StudioClient.tsx
git commit -m "feat(studio): hold-to-deploy take button, revert, diff badge, collapse pill"
```

---

### Task 13: Status strip

**Files:**
- Create: `app/studio/stripState.ts` (pure)
- Create: `app/studio/StatusStrip.tsx`
- Modify: `app/components/mosaic/v1/qualitySignal.ts` (export `passesGate`)
- Modify: `app/studio/StudioClient.tsx` (mount)
- Test: `app/studio/stripState.test.ts`, `app/components/mosaic/v1/qualitySignal.test.ts` (extend if exists, else create)

**Interfaces:**
- Consumes: Task 10 (`live`, `lastPollAt`, `deployedAtMs`, `diffCount`, `liveRevision`); `useTerminatorStore` webcams; `KIOSK_TICK_INTERVAL_MS` from `@/app/lib/masterConfig`.
- Produces:

```ts
// app/studio/stripState.ts
export type StripKind = 'insync' | 'drift' | 'deploying' | 'stale';
export function stripState(args: {
  diffCount: number;
  lastPollAtMs: number | null;
  deployedAtMs: number | null;
  nowMs: number;
  pollIntervalMs: number; // pass KIOSK_TICK_INTERVAL_MS
}): { kind: StripKind; secondsToGlass?: number };
// Rules, in priority order:
//   stale     — lastPollAtMs null OR nowMs - lastPollAtMs > 3 * pollIntervalMs
//   deploying — deployedAtMs set AND (lastPollAtMs < deployedAtMs)
//               secondsToGlass = max(0, ceil((lastPollAtMs + pollIntervalMs - nowMs)/1000))
//   drift     — diffCount > 0
//   insync    — otherwise
export function formatPollAge(lastPollAtMs: number | null, nowMs: number): string;
// '32s ago' | '6m ago' | 'never'

// app/components/mosaic/v1/qualitySignal.ts — new export alongside getQualityScore:
export function passesGate(webcam: WindyWebcam): boolean; // score !== null && score >= the gate

// StatusStrip.tsx
export function StatusStrip(props: {
  glassVersion: string;        // effective live activeVersion
  liveRevision: number;
  lastPollAt: string | null;
  deployedAtMs: number | null;
  diffCount: number;
  sunrisePass: { pass: number; total: number };
  sunsetPass: { pass: number; total: number };
}): React.ReactNode;
```

Strip rendering (mockup §5, binding): 28px, monospace, ground `#0e1119`, top border `#1d2432`; left-to-right — liveness dot (green `#4cc38a` / amber `#f5a344` / red `#e5484d` by state) · `glass v1` · `rev 14` · `polled 32s ago` · amber `↑1/39 ↓3/42 pass` · right-aligned state word (`in sync` dim / `deploying · on glass within 19s` amber / `stale` red, with `polled Xm ago — kiosk unreachable?` in red when stale). A 1s interval tick drives `nowMs` so ages and the countdown move.

- [ ] **Step 1: Write the failing tests**
  - `stripState.test.ts`: each of the four kinds from crafted timestamps; the deploying countdown value; stale beats deploying when both hold; `formatPollAge` seconds/minutes/never cases.
  - `qualitySignal.test.ts`: a webcam whose score sits at the gate passes; below fails; null score fails. (Build minimal `WindyWebcam` fixtures the way existing engine tests do — read one for the fixture shape first.)

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** `stripState.ts`, `passesGate`, `StatusStrip.tsx`; mount in StudioClient with counts computed as `webcams.filter(passesGate).length` per feed from the terminator store.

- [ ] **Step 4: Run to verify pass.** `npx vitest run app/studio/stripState.test.ts app/components/mosaic/v1/qualitySignal.test.ts`

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add app/studio/stripState.ts app/studio/stripState.test.ts app/studio/StatusStrip.tsx \
  app/components/mosaic/v1/qualitySignal.ts app/components/mosaic/v1/qualitySignal.test.ts \
  app/studio/StudioClient.tsx
git commit -m "feat(studio): status strip with poll freshness, deploy countdown, gate counts"
```

---

### Task 14: Full verification + PR

**Files:** none new.

- [ ] **Step 1: Full test suite.** `npx vitest run` — everything green.

- [ ] **Step 2: Lint + build.** `npm run lint && npm run build` — both clean. (Remember `next.config.test.ts` guards the ML bundling whitelist; nothing here should touch it, but a build failure there means an accidental config edit — investigate, don't bypass.)

- [ ] **Step 3: End-to-end smoke against dev** (`npm run dev`, signed in as owner):
  1. `/studio` renders: rail, both feeds, strip.
  2. Move `floorPx` — preview updates immediately; badge shows `1 settings differ`; reload the page — the dial value survives (studio profile persisted).
  3. Hold Deploy — badge zeroes; `/kiosk/sunset` (separate tab) shows the new floor within 60s.
  4. Move a dial again, press Revert — dial returns to deployed value.
  5. `/kiosk/sunset?floor=60` — URL still beats the deployed profile value.
  6. Toggle sunrise/sunset/both; collapse the rail — floating pill + strip remain; `» dials` restores.
- [ ] **Step 4: Update ops docs.** Add a short section to `docs/ops/kiosk-composition-tuning.md`: dials now live at `/studio`; URL params remain as overrides; deploy/revert semantics; one line on the Redis mirror. Commit it (explicit path).

- [ ] **Step 5: Push and open the PR**

```bash
git rev-parse --abbrev-ref HEAD
git push -u origin feat/kiosk-studio-phase1
```

PR body: what shipped (Phase 1 of the spec), the two recorded deviations (kiosk pages don't self-apply panel geometry; per-knob reset deferred in favor of per-section reset buttons + `●` differs markers), the migration that must be applied before merge (`database/migrations/20260830_kiosk_settings.sql` — note whether Step 6 of Task 3 already applied it), and the smoke checklist results. End with the standard footer:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01FhSrLmoaqHe2miFjCYGUYa
```
