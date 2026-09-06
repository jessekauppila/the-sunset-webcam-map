# One Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `/studio`, `/studio/solo` and `/studio/solo2` into one `/studio` page whose version select drives the rail, the preview and the panel; add saved takes; make the solo preview play through the projected queue.

**Architecture:** A data-only `STUDIO_SURFACES` table maps a version name to its dial schema and its kind (`mosaic` | `solo`). `StudioClient` reads `shared.activeVersion` from the studio profile, looks up the surface, and mounts one of two previews and one of two panels. One hand-rolled `Rail` renders any schema. One `Header` owns the version and panel selects, the status line, Deploy and the nav toggle. Everything below the fold (`FeedColumn`, `EntryRow`, `Tape`, `FrameModal`, scenes) is moved, not rewritten.

**Tech Stack:** Next.js app router, React 19, vitest + @testing-library/react (jsdom), SWR, Neon Postgres via `sql` tagged templates.

**Spec:** `docs/superpowers/specs/2026-09-05-one-studio-design.md` (§ numbers below refer to it). Appendix A of the spec is the solo2 audit.

## Global Constraints

- Branch `feat/one-studio` in worktree `~/GitHub/the-sunset-webcam-map.worktrees/feat-one-studio`. Verify the branch in the same command as every commit. Stage explicit paths, never `git add -A`.
- Three stacked PRs: phase A → `main`; phase B → `feat/one-studio` (branch `feat/one-studio-takes`); phase C → `feat/one-studio-takes` (branch `feat/one-studio-preview`). Jesse merges; never merge or deploy.
- Nothing about what the glass draws changes in phase A or C. No solo/solo2 engine, schema or default changes anywhere in this plan. In particular do **not** change the `timeStyle` default (Appendix A concern 3): the live profile may have no deviation stored, and changing the default would change the glass.
- Phase B's migration is production. **Do not run `--apply`.** Write the file, run `node scripts/apply-migration.mjs <file>` (dry) once to prove it parses, and put the apply command in the PR description for Jesse.
- Colours and fonts: reuse the studio's existing literals (`#0b0e14` page, `#10141d` rail, `#0e1119` strip, `#1d2432` border, `#f5a344` glass orange, `#4fd1c5` bins teal, `#c4a7f7` picture purple, `#4a90d9` blue, `#8b95a7` dim, `#e5e7eb` text, mono `ui-monospace, SFMono-Regular, Menlo, monospace`).
- Tests: `npx vitest run <path>` per task; the full suite (`npm run test`) plus `npm run build` and `npm run lint` before each PR.
- `node_modules` in the worktree is a symlink to the main checkout's. Removing `leva` edits `package.json` and `package-lock.json` only (`npm uninstall leva --package-lock-only`); do not run a full install.
- Push after every commit: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin <branch>` (the plain push can hang on the keychain).

---

# Phase A — collapse

### Task A1: `STUDIO_SURFACES`

**Files:**
- Create: `app/studio/surfaces.ts`
- Test: `app/studio/surfaces.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SurfaceKind = 'mosaic' | 'solo';
  export interface StudioSurface {
    name: string;                // the version name, a key of MOSAIC_VERSIONS
    kind: SurfaceKind;
    namespace: string;           // the settings namespace the rail edits
    schema: SettingsSchema;      // that namespace's schema
    solo: SoloVersionSpec | null; // the engine descriptor for solo kinds, else null
    hasPicturePage: boolean;     // the shared caption page (solo kinds only)
  }
  export const STUDIO_SURFACES: Record<string, StudioSurface>;
  export function surfaceFor(version: string | null | undefined): StudioSurface; // resolveMosaicName rules: unknown → v1
  ```

- [ ] **Step 1: Write the failing test**

```ts
// app/studio/surfaces.test.ts
import { describe, it, expect } from 'vitest';
import { STUDIO_SURFACES, surfaceFor } from './surfaces';
import { MOSAIC_VERSIONS } from '@/app/components/mosaic/registry';
import { schemaFor } from '@/app/lib/settings/knownSchemas';
import { SOLO_VERSIONS } from '@/app/lib/solo/versions';

describe('STUDIO_SURFACES', () => {
  it('has one row per registered version, with that version\'s schema', () => {
    for (const name of Object.keys(MOSAIC_VERSIONS)) {
      const s = STUDIO_SURFACES[name];
      expect(s, name).toBeDefined();
      expect(s.name).toBe(name);
      expect(s.namespace).toBe(name);
      expect(s.schema).toBe(schemaFor(name));
    }
    expect(Object.keys(STUDIO_SURFACES).sort()).toEqual(Object.keys(MOSAIC_VERSIONS).sort());
  });
  it('solo versions carry their engine descriptor and the picture page; mosaic versions carry neither', () => {
    expect(STUDIO_SURFACES.solo).toMatchObject({ kind: 'solo', solo: SOLO_VERSIONS.solo, hasPicturePage: true });
    expect(STUDIO_SURFACES.solo2).toMatchObject({ kind: 'solo', solo: SOLO_VERSIONS.solo2, hasPicturePage: true });
    for (const v of ['v1', 'v2', 'v3', 'v4']) expect(STUDIO_SURFACES[v]).toMatchObject({ kind: 'mosaic', solo: null, hasPicturePage: false });
  });
  it('surfaceFor falls back to v1 like resolveMosaicName', () => {
    expect(surfaceFor('solo2').name).toBe('solo2');
    expect(surfaceFor('nope').name).toBe('v1');
    expect(surfaceFor(undefined).name).toBe('v1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/studio/surfaces.test.ts`
Expected: FAIL, cannot find module `./surfaces`.

- [ ] **Step 3: Write the implementation**

```ts
// app/studio/surfaces.ts
import { MOSAIC_SETTINGS_SCHEMAS, MOSAIC_VERSIONS, resolveMosaicName } from '@/app/components/mosaic/registry';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import type { SettingsSchema } from '@/app/lib/settings/schema';

export type SurfaceKind = 'mosaic' | 'solo';

/**
 * What the studio shows for one version (one-studio spec §2.2): the schema
 * its rail edits, and whether the page below the header is the mosaic
 * surface (pool, gate, scenes) or the solo surface (bins, queue, tape).
 * Data only, so the client can switch on `kind` without this file importing
 * a component. Adding `solo3` is one row here and one in SOLO_VERSIONS.
 */
export interface StudioSurface {
  name: string;
  kind: SurfaceKind;
  namespace: string;
  schema: SettingsSchema;
  solo: SoloVersionSpec | null;
  hasPicturePage: boolean;
}

const soloFor = (name: string): SoloVersionSpec | null =>
  name in SOLO_VERSIONS ? (SOLO_VERSIONS[name as keyof typeof SOLO_VERSIONS] as SoloVersionSpec) : null;

export const STUDIO_SURFACES: Record<string, StudioSurface> = Object.fromEntries(
  Object.keys(MOSAIC_VERSIONS).map((name) => {
    const solo = soloFor(name);
    return [name, {
      name, kind: solo ? 'solo' : 'mosaic', namespace: name,
      schema: MOSAIC_SETTINGS_SCHEMAS[name], solo, hasPicturePage: solo !== null,
    } satisfies StudioSurface];
  }),
);

export function surfaceFor(version: string | null | undefined): StudioSurface {
  return STUDIO_SURFACES[resolveMosaicName(version)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/studio/surfaces.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-one-studio && test "$(git rev-parse --abbrev-ref HEAD)" = "feat/one-studio" && git add app/studio/surfaces.ts app/studio/surfaces.test.ts && git commit -m "feat(studio): STUDIO_SURFACES — one row per version: schema, kind, engine descriptor"
```

---

### Task A2: `pollAge.ts` (keep `formatPollAge`, drop the rest of `stripState`)

**Files:**
- Create: `app/studio/pollAge.ts`, `app/studio/pollAge.test.ts`
- (Deletion of `stripState.ts` + test happens in A8, once nothing imports it.)

**Interfaces:**
- Produces: `export function formatPollAge(lastPollAtMs: number | null, nowMs: number): string` — identical behaviour to `app/studio/stripState.ts:55-62` (`'never'`, `'32s ago'`, `'6m ago'`).

- [ ] **Step 1: Write the failing test**

```ts
// app/studio/pollAge.test.ts
import { describe, it, expect } from 'vitest';
import { formatPollAge } from './pollAge';

describe('formatPollAge', () => {
  const now = 1_000_000;
  it('never when there is no poll', () => expect(formatPollAge(null, now)).toBe('never'));
  it('seconds under a minute', () => expect(formatPollAge(now - 32_000, now)).toBe('32s ago'));
  it('minutes from a minute up', () => expect(formatPollAge(now - 6 * 60_000 - 5_000, now)).toBe('6m ago'));
  it('clamps a poll from the future to 0s', () => expect(formatPollAge(now + 5_000, now)).toBe('0s ago'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/studio/pollAge.test.ts` — FAIL, module not found.

- [ ] **Step 3: Write the implementation**

Copy the function body verbatim from `app/studio/stripState.ts:55-62` into `app/studio/pollAge.ts` with the doc comment "How long since the settings poll last heard from the kiosk, for the header's status line."

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run app/studio/pollAge.test.ts`, PASS (4).

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-one-studio && test "$(git rev-parse --abbrev-ref HEAD)" = "feat/one-studio" && git add app/studio/pollAge.ts app/studio/pollAge.test.ts && git commit -m "feat(studio): formatPollAge in its own file for the header status line"
```

---

### Task A3: `Rail` — one renderer for every schema

**Files:**
- Create: `app/studio/Rail.tsx`, `app/studio/Rail.test.tsx`
- Read (lift from): `app/studio/solo/SoloRail.tsx` (`Control`, `PictureReadout`, `GROUPS`, tabs), `app/studio/solo/DwellBudget.tsx`

**Interfaces:**
- Consumes: `StudioSurface` (A1), `StudioSettingsApi` (`app/studio/useStudioSettings.ts:30-60`), `CAPTION_SCHEMA`/`CAPTION_SECTION`/`withCaption` (`app/lib/solo/captionSchema.ts`), `SHARED_NAMESPACE`, `PANEL_PRESETS`, `pictureRect`/`drawFactor`/`SOURCE_FRAME` (`app/lib/solo/caption.ts`), `DwellBudget` (`app/studio/solo/DwellBudget.tsx`: `{ dials: PlanDials; frames?: number }`).
- Produces:
  ```ts
  export type RailTab = 'play' | 'picture';
  export function Rail({ api, surface, tab, onTab, runFrames, children }: {
    api: StudioSettingsApi; surface: StudioSurface;
    tab: RailTab; onTab: (t: RailTab) => void;
    /** solo2: frames in the on-glass camera's run, for the dwell readout. */
    runFrames?: number;
    /** The takes list, rendered under the dials. */
    children?: ReactNode;
  })
  ```

Behaviour (spec §2.3):
- No `deploySlot`, no `glass … · dials …` line, no cross-links, no `RulesBox`, no hint paragraphs (hints stay as `title` on section headers and tabs).
- Tabs `Play` / `Picture` render only when `surface.hasPicturePage`; otherwise only the play page renders, no tablist.
- Play page, solo kind: two coloured groups exactly as `SoloRail`'s `GROUPS` for `glass` (`#f5a344`, title `Glass · what the screen draws`) and `bins` (`#4fd1c5`, `Bins · the ordering algorithm`), knobs from `surface.schema` filtered by section. After the `cameraRun` knob (when the schema has one) render `<DwellBudget dials={dials} frames={runFrames} />` where `dials = surface.solo.dialsFrom(withCaption(values, shared))`.
- Play page, mosaic kind: one group per distinct `section` in schema order, colour `#4a90d9`, title = the section name capitalised (e.g. `Visibility`), rendered as `<details>` with `<summary>` carrying the header; the first section `open`, the rest closed. The `reset <section>` button lives in the summary (stop propagation so a reset click does not toggle).
- Picture page: the shared caption group (`#c4a7f7`, `Picture · the frame and its words`) bound to `SHARED_NAMESPACE`, `CAPTION_SCHEMA` knobs, `PictureReadout` under `pictureHeight` (lift `PictureReadout` and its `data-testid="picture-readout"`).
- Every knob: `Control` lifted verbatim (ids `rail-${knob.key}`), bold when `api.diffByNamespace[ns]` contains the key, `title={knob.description}`.
- `children` rendered last, after the groups, inside a `<div style={{ marginTop: 'auto' }}>` so it sits at the bottom of a flex-column rail.

- [ ] **Step 1: Write the failing tests**

```tsx
// app/studio/Rail.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Rail } from './Rail';
import { STUDIO_SURFACES } from './surfaces';
import { SOLO2_SETTINGS_SCHEMA } from '@/app/lib/solo2/settingsSchema';
import { V4_SETTINGS_SCHEMA } from '@/app/components/mosaic/v4/settingsSchema';
import { CAPTION_SCHEMA } from '@/app/lib/solo/captionSchema';
import { SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { mergeSettings } from '@/app/lib/settings/schema';
import { MOSAIC_SETTINGS_SCHEMAS } from '@/app/components/mosaic/registry';
import type { StudioSettingsApi } from './useStudioSettings';

function api(over: Partial<StudioSettingsApi> = {}): StudioSettingsApi {
  return {
    loading: false, studio: undefined, live: undefined, lastPollAt: null, liveRevision: 3,
    effective: (ns) => ns === 'shared'
      ? mergeSettings(SHARED_SCHEMA, { activeVersion: 'solo2', panelPreset: 'dell' })
      : mergeSettings(MOSAIC_SETTINGS_SCHEMAS[ns], {}),
    setKnob: vi.fn(), resetSection: vi.fn(), applyNamespace: () => [],
    diffByNamespace: {}, diffCount: 0,
    deploy: async () => {}, revert: async () => {}, deployedAtMs: null, droppedKeys: [],
    deploys: [], loadDeploy: async () => [], relabelDeploy: async () => {}, lastDeployRecorded: null,
    ...over,
  };
}
const noop = () => {};

describe('Rail, solo kind', () => {
  it('play page: every glass and bins knob under its group, bold when it differs; caption knobs wait on the picture tab', () => {
    const a = api({ diffByNamespace: { solo2: ['valleys'] } });
    render(<Rail api={a} surface={STUDIO_SURFACES.solo2} tab="play" onTab={noop}><span>TAKES</span></Rail>);
    for (const k of SOLO2_SETTINGS_SCHEMA) expect(screen.getByLabelText(k.label)).toBeInTheDocument();
    for (const k of CAPTION_SCHEMA) expect(screen.queryByLabelText(k.label)).toBeNull();
    expect(screen.getByText('valleys per peak')).toHaveStyle({ fontWeight: 700 });
    expect(screen.getByText('dwell (s)')).toHaveStyle({ fontWeight: 400 });
    expect(screen.getByRole('tab', { name: 'Play' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('TAKES')).toBeInTheDocument();
    expect(screen.queryByText(/glass .* · dials/)).toBeNull();
  });
  it('picture page: every caption knob bound to the shared namespace, with the readout; reset clears that section', () => {
    const a = api({ diffByNamespace: { shared: ['titleGray'] } });
    render(<Rail api={a} surface={STUDIO_SURFACES.solo} tab="picture" onTab={noop} />);
    for (const k of CAPTION_SCHEMA) expect(screen.getByLabelText(k.label)).toBeInTheDocument();
    expect(screen.getByText('title gray (%)')).toHaveStyle({ fontWeight: 700 });
    expect(screen.getByTestId('picture-readout')).toHaveTextContent(/draws \d+ × \d+/);
    fireEvent.click(screen.getByText('reset caption'));
    expect(a.resetSection).toHaveBeenCalledWith('shared', 'caption');
  });
  it('a knob change writes the surface namespace; a caption change writes shared', () => {
    const a = api();
    const { rerender } = render(<Rail api={a} surface={STUDIO_SURFACES.solo2} tab="play" onTab={noop} />);
    fireEvent.change(screen.getByLabelText('valleys per peak'), { target: { value: '2' } });
    expect(a.setKnob).toHaveBeenCalledWith('solo2', 'valleys', 2);
    rerender(<Rail api={a} surface={STUDIO_SURFACES.solo2} tab="picture" onTab={noop} />);
    fireEvent.change(screen.getByLabelText('title size (px)'), { target: { value: '30' } });
    expect(a.setKnob).toHaveBeenCalledWith('shared', 'titleSize', 30);
  });
  it('solo2 shows the dwell readout after the camera-run knob', () => {
    render(<Rail api={api()} surface={STUDIO_SURFACES.solo2} tab="play" onTab={noop} runFrames={3} />);
    expect(screen.getByTestId('dwell-budget')).toBeInTheDocument();
  });
  it('the tab click reports the other page', () => {
    const onTab = vi.fn();
    render(<Rail api={api()} surface={STUDIO_SURFACES.solo} tab="play" onTab={onTab} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    expect(onTab).toHaveBeenCalledWith('picture');
  });
});

describe('Rail, mosaic kind', () => {
  it('renders every v4 knob grouped by section, first section open, no tabs, no caption', () => {
    render(<Rail api={api()} surface={STUDIO_SURFACES.v4} tab="play" onTab={noop} />);
    for (const k of V4_SETTINGS_SCHEMA) expect(screen.getByLabelText(k.label)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    for (const k of CAPTION_SCHEMA) expect(screen.queryByLabelText(k.label)).toBeNull();
    const sections = [...new Set(V4_SETTINGS_SCHEMA.map((k) => k.section))];
    const details = screen.getAllByRole('group');
    expect(details).toHaveLength(sections.length);
    expect(details[0]).toHaveAttribute('open');
    expect(details[1]).not.toHaveAttribute('open');
  });
  it('reset on a mosaic section clears that section only and does not toggle the group', () => {
    const a = api();
    render(<Rail api={a} surface={STUDIO_SURFACES.v4} tab="play" onTab={noop} />);
    const first = [...new Set(V4_SETTINGS_SCHEMA.map((k) => k.section))][0];
    fireEvent.click(screen.getByText(`reset ${first}`));
    expect(a.resetSection).toHaveBeenCalledWith('v4', first);
    expect(screen.getAllByRole('group')[0]).toHaveAttribute('open');
  });
});
```

Note: jsdom exposes `<details>` as role `group`. `DwellBudget` must render `data-testid="dwell-budget"` on its root — add that attribute to `app/studio/solo/DwellBudget.tsx` in this task (one-line change; its existing test still passes).

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run app/studio/Rail.test.tsx`, FAIL: module not found.

- [ ] **Step 3: Write the implementation**

Start from a copy of `app/studio/solo/SoloRail.tsx`. Keep `Control` (rename ids to `rail-${knob.key}`), `PictureReadout`, the group header styling. Replace the props and the body:

```tsx
'use client';

import { Fragment, type ReactNode } from 'react';
import type { StudioSettingsApi } from './useStudioSettings';
import type { StudioSurface } from './surfaces';
import { SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import { CAPTION_SCHEMA, CAPTION_SECTION, withCaption } from '@/app/lib/solo/captionSchema';
import { PANEL_PRESETS } from '@/app/kiosk/panelPreview';
import type { KnobDescriptor, KnobValue, SettingsSchema } from '@/app/lib/settings/schema';
import type { SoloDials } from '@/app/lib/solo/types';
import { DwellBudget } from './solo/DwellBudget';
// … Control and PictureReadout lifted from SoloRail …

export type RailTab = 'play' | 'picture';
const TABS: { id: RailTab; label: string; hint: string }[] = [
  { id: 'play', label: 'Play', hint: 'Timing, overlays and the ordering algorithm: what plays and when.' },
  { id: 'picture', label: 'Picture', hint: 'The picture\'s size on black and the words beneath it. The screens above draw them as you move.' },
];
const SOLO_GROUPS = {
  glass: { title: 'Glass · what the screen draws', color: '#f5a344', hint: 'These change what the screens draw. They never change which frame comes next.' },
  bins: { title: 'Bins · the ordering algorithm', color: '#4fd1c5', hint: 'These change which frame comes next. The queue re-runs the moment one moves.' },
} as const;
const CAPTION_GROUP = { title: 'Picture · the frame and its words', color: '#c4a7f7', hint: 'Sizes are glass pixels; grays are percent of white. Shared by every solo version.' };
const MOSAIC_COLOR = '#4a90d9';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sectionsOf = (schema: SettingsSchema) => [...new Set(schema.map((k) => k.section))];

function GroupHeader({ title, color, hint, onReset, section, asSummary }: { … }) { /* the h4 from SoloRail; when asSummary, render as <summary> and the reset button calls e.preventDefault(); e.stopPropagation() before onReset */ }

export function Rail({ api, surface, tab, onTab, runFrames = 1, children }: {
  api: StudioSettingsApi; surface: StudioSurface; tab: RailTab; onTab: (t: RailTab) => void;
  runFrames?: number; children?: ReactNode;
}) {
  const ns = surface.namespace;
  const values = api.effective(ns);
  const shared = api.effective(SHARED_NAMESPACE);
  const diff = new Set(api.diffByNamespace[ns] ?? []);
  const sharedDiff = new Set(api.diffByNamespace[SHARED_NAMESPACE] ?? []);
  const panel = PANEL_PRESETS[String(shared.panelPreset)] ?? PANEL_PRESETS['dell-l'];
  const soloDials = surface.solo ? surface.solo.dialsFrom(withCaption(values, shared)) : null;
  const page: RailTab = surface.hasPicturePage ? tab : 'play';

  const knob = (k: KnobDescriptor, target: { ns: string; values: Record<string, KnobValue>; diff: Set<string> }) => (
    <Fragment key={k.key}>
      <Control knob={k} value={target.values[k.key]} differs={target.diff.has(k.key)} onChange={(v) => api.setKnob(target.ns, k.key, v)} />
      {k.key === 'pictureHeight' && soloDials && <PictureReadout dials={soloDials as SoloDials} panel={panel} />}
      {k.key === 'cameraRun' && soloDials && <DwellBudget dials={soloDials as { dwellS: number; leadS: number }} frames={runFrames} />}
    </Fragment>
  );

  return (
    <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {surface.hasPicturePage && (
        <div role="tablist" aria-label="Rail pages" style={{ display: 'flex', gap: 4, margin: '0 0 6px' }}>
          {TABS.map((t) => (/* the tab button from SoloRail */))}
        </div>
      )}
      {page === 'play' && surface.kind === 'solo' && (['glass', 'bins'] as const).map((section) => (
        <section key={section}>
          <GroupHeader {...SOLO_GROUPS[section]} section={section} onReset={() => api.resetSection(ns, section)} />
          {surface.schema.filter((k) => k.section === section).map((k) => knob(k, { ns, values, diff }))}
        </section>
      ))}
      {page === 'play' && surface.kind === 'mosaic' && sectionsOf(surface.schema).map((section, i) => (
        <details key={section} open={i === 0}>
          <GroupHeader asSummary title={cap(section)} color={MOSAIC_COLOR} hint={`The ${section} dials.`} section={section} onReset={() => api.resetSection(ns, section)} />
          {surface.schema.filter((k) => k.section === section).map((k) => knob(k, { ns, values, diff }))}
        </details>
      ))}
      {page === 'picture' && (
        <section>
          <GroupHeader {...CAPTION_GROUP} section={CAPTION_SECTION} onReset={() => api.resetSection(SHARED_NAMESPACE, CAPTION_SECTION)} />
          {CAPTION_SCHEMA.map((k) => knob(k, { ns: SHARED_NAMESPACE, values: shared, diff: sharedDiff }))}
        </section>
      )}
      <div style={{ marginTop: 'auto', paddingTop: 10 }}>{children}</div>
    </div>
  );
}
```

Fill in `GroupHeader` and the tab button from `SoloRail.tsx` lines 128-147 and 149-161; the reset button text is `reset {section}`.

- [ ] **Step 4: Run tests** — `npx vitest run app/studio/Rail.test.tsx app/studio/solo/DwellBudget.test.tsx`, PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-one-studio && test "$(git rev-parse --abbrev-ref HEAD)" = "feat/one-studio" && git add app/studio/Rail.tsx app/studio/Rail.test.tsx app/studio/solo/DwellBudget.tsx && git commit -m "feat(studio): one Rail renders any version's schema — solo groups, collapsible mosaic sections, shared picture page"
```

---

### Task A4: `Header` — version, panel, status line, deploy, nav toggle

**Files:**
- Create: `app/studio/Header.tsx`, `app/studio/Header.test.tsx`
- Read: `app/studio/solo/countdown.ts` (`nextCronMs`, `formatCountdown`), `app/studio/pollAge.ts` (A2), `app/studio/DeployButton.tsx` (`{ diffCount, onDeploy, onRevert, compact }`), `app/components/MapMosaicModeToggle.tsx`, `app/studio/StatusStrip.tsx:128-140` (dropped keys rendering).

**Interfaces:**
- Consumes: `StudioSettingsApi`, `SHARED_SCHEMA`/`SHARED_NAMESPACE`, `mergeSettings`, `resolveMosaicName`, `PANEL_PRESETS`.
- Produces:
  ```ts
  export function Header({ api, nowMs, extra }: {
    api: StudioSettingsApi;
    nowMs: number;
    /** Phase B puts the save-take button here, left of Deploy. */
    extra?: ReactNode;
  })
  ```

Behaviour (spec §2.1):
- Left: `STUDIO` wordmark (mono, letter-spaced, dim), then `version` select (`<select aria-label="version">`, options `Object.keys(MOSAIC_VERSIONS)`, value `api.effective('shared').activeVersion`, `onChange → api.setKnob('shared','activeVersion', v)`), then `panel` select (options `Object.keys(PANEL_PRESETS)`, writes `shared.panelPreset`). The version `<label>` is bold (`fontWeight: 700`) when `api.diffByNamespace.shared` includes `activeVersion`; same for panel.
- Status line (`data-testid="status-line"`, mono, dim, `minWidth: 0; overflow: hidden; textOverflow: ellipsis; whiteSpace: nowrap; marginLeft: auto`), text in this order joined by ` · `:
  `glass <liveVersion>` where `liveVersion = resolveMosaicName(mergeSettings(SHARED_SCHEMA, api.live?.namespaces?.shared).activeVersion)` (the LIVE profile, never the studio one);
  `rev <api.liveRevision>`;
  `<api.diffCount> differ` or `dials match glass`;
  `next pull <formatCountdown(nextCronMs(nowMs) - nowMs)>`;
  `polled <formatPollAge(api.lastPollAt ? Date.parse(api.lastPollAt) : null, nowMs)>`;
  and when `api.droppedKeys.length > 0`, a red span `data-testid="status-dropped"` with `⚠ <n> dropped` and the StatusStrip title text as its `title`.
- Then `{extra}`, then `<DeployButton compact diffCount onDeploy={api.deploy} onRevert={api.revert} />`, then a divider (`borderLeft: 1px solid #2a3242; paddingLeft: 12px; marginLeft: 4px`) wrapping `<MapMosaicModeToggle mode="studio" />`, in a `data-testid="nav-slot"` div. Each of `extra`, the deploy button wrapper and the nav slot gets `flex: 'none'`.
- Root: `<header>` with `display: flex; alignItems: center; gap: 14px; padding: 0 10px; height: 100%; background: #0e1119; borderBottom: 1px solid #1d2432`.

- [ ] **Step 1: Write the failing tests**

```tsx
// app/studio/Header.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from './Header';
import { SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { mergeSettings } from '@/app/lib/settings/schema';
import type { StudioSettingsApi } from './useStudioSettings';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function api(over: Partial<StudioSettingsApi> = {}): StudioSettingsApi {
  return {
    loading: false, studio: undefined,
    live: { profile: 'live', revision: 41, namespaces: { shared: { activeVersion: 'solo' } } } as StudioSettingsApi['live'],
    lastPollAt: new Date(1_000_000 - 38_000).toISOString(), liveRevision: 41,
    effective: () => mergeSettings(SHARED_SCHEMA, { activeVersion: 'solo2', panelPreset: 'dell-l' }),
    setKnob: vi.fn(), resetSection: vi.fn(), applyNamespace: () => [],
    diffByNamespace: { shared: ['activeVersion'] }, diffCount: 3,
    deploy: async () => {}, revert: async () => {}, deployedAtMs: null, droppedKeys: [],
    deploys: [], loadDeploy: async () => [], relabelDeploy: async () => {}, lastDeployRecorded: null,
    ...over,
  };
}
const NOW = 1_000_000;

describe('Header', () => {
  it('the version select shows the studio version, bold because it differs from glass, and writes shared.activeVersion', () => {
    const a = api();
    render(<Header api={a} nowMs={NOW} />);
    const sel = screen.getByLabelText('version') as HTMLSelectElement;
    expect(sel.value).toBe('solo2');
    expect(screen.getByText('version')).toHaveStyle({ fontWeight: 700 });
    fireEvent.change(sel, { target: { value: 'v4' } });
    expect(a.setKnob).toHaveBeenCalledWith('shared', 'activeVersion', 'v4');
    fireEvent.change(screen.getByLabelText('panel'), { target: { value: 'dell' } });
    expect(a.setKnob).toHaveBeenCalledWith('shared', 'panelPreset', 'dell');
  });
  it('the status line reads the LIVE version, not the studio one, and carries rev, differ, next pull and poll age in order', () => {
    render(<Header api={api()} nowMs={NOW} />);
    const line = screen.getByTestId('status-line').textContent ?? '';
    expect(line).toMatch(/^glass solo · rev 41 · 3 differ · next pull \d+:\d\d · polled 38s ago$/);
  });
  it('dials match glass when nothing differs; dropped keys append with a count', () => {
    render(<Header api={api({ diffCount: 0, diffByNamespace: {}, droppedKeys: [{ key: 'x', reason: 'unknown' }, { key: 'y', reason: 'invalid' }] })} nowMs={NOW} />);
    expect(screen.getByTestId('status-line')).toHaveTextContent('dials match glass');
    expect(screen.getByTestId('status-dropped')).toHaveTextContent('2 dropped');
  });
  it('renders deploy, the nav toggle in its slot and the extra slot, all unshrinkable, with the status line the only flexible member', () => {
    render(<Header api={api()} nowMs={NOW} extra={<button>save take</button>} />);
    expect(screen.getByText('save take')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deploy/i })).toBeInTheDocument();
    const nav = screen.getByTestId('nav-slot');
    expect(nav).toHaveStyle({ flex: 'none' });
    expect(nav).toContainElement(screen.getByRole('button', { name: 'Studio' }));
    expect(screen.getByTestId('status-line')).toHaveStyle({ minWidth: '0px', overflow: 'hidden' });
  });
});
```

Check the DeployButton's accessible name in `app/studio/DeployButton.test.tsx` before asserting `/deploy/i`; use whatever name that test uses.

- [ ] **Step 2: Run tests** — FAIL, module not found.
- [ ] **Step 3: Write the implementation** per the behaviour list above.
- [ ] **Step 4: Run tests** — `npx vitest run app/studio/Header.test.tsx`, PASS.
- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-one-studio && test "$(git rev-parse --abbrev-ref HEAD)" = "feat/one-studio" && git add app/studio/Header.tsx app/studio/Header.test.tsx && git commit -m "feat(studio): Header — version and panel selects, one status line, deploy, nav toggle in the corner slot"
```

---

### Task A5: `MosaicPreview` (the two mosaic screens, lifted from `PreviewPane`)

**Files:**
- Create: `app/studio/MosaicPreview.tsx`, `app/studio/MosaicPreview.test.tsx`
- Read: `app/studio/PreviewPane.tsx:93-96, 300-413` and `app/studio/PreviewPane.test.tsx` (lift the tests that cover the preview body and the tile card; drop the ones about the view control and scene chrome).

**Interfaces:**
- Consumes: `resolveMosaic`, `StudioPanelFrame`, `poolFor` (`app/studio/previewPool.ts`), `useTerminatorStore`, `FrameLabelCard`, `CameraHealthHeader` (whatever `PreviewPane.tsx` imports for the tile card), `SceneSource`, `SceneState`.
- Produces:
  ```ts
  export function MosaicPreview({ versionName, panel, settings, shared, sceneSource, sceneState, at }: {
    versionName: string; panel: PanelSize;
    settings?: SettingsValues; shared?: SettingsValues;
    sceneSource: SceneSource; sceneState: SceneState | null; at?: string;
  })
  ```
  Renders a 2-column grid of `sunrise` | `sunset`, each `StudioPanelFrame` → `resolveMosaic(versionName)` with the props from `PreviewPane.tsx:344-357` (`webcams={poolFor(feed, sceneSource, sceneState, live)}`, `peerWebcams` = the other feed's pool, `driveSchedule={false}`, `onSelect`). A selected tile shows the detail card exactly as `PreviewPane.tsx:361-410` (`data-testid="studio-tile-detail"`, close button, `allowCapture={sceneSource.kind === 'live'}`). When `sceneSource.kind === 'scene' && !sceneState`, render `loading scene…` instead of tiles (PreviewPane's `sceneUnresolved` rule).

- [ ] **Step 1: Write the failing tests** — port from `PreviewPane.test.tsx` the cases: renders both feeds with the resolved version; tile select opens the detail card and close hides it; capture allowed on live and not on a scene; unresolved scene renders no tiles. Mock `resolveMosaic` the way `PreviewPane.test.tsx` does.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** by lifting the code.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(studio): MosaicPreview — the two mosaic screens without the pane chrome`.

---

### Task A6: `MosaicPanel` (gate readout + scenes)

**Files:**
- Create: `app/studio/panels/MosaicPanel.tsx`, `app/studio/panels/MosaicPanel.test.tsx`
- Read: `app/studio/PreviewPane.tsx:37-40, 116, 215-281` (scene select, `SaveSceneButton`, notes + restore-dials row), `app/studio/StudioClient.tsx:120-150` (gate pass memos), `app/studio/StatusStrip.tsx` (how gate passes were shown: `sunrise 18/24`).

**Interfaces:**
- Consumes: `countGatePasses`, `resolveGate` (`app/components/mosaic/gate`), `poolFor`, `useSceneWebcams` return fields (`scenes, sceneState, sceneRepresentsAt, sceneNotes, sceneProvenance, error, refreshScenes`), `restoreSceneDials(api, provenance)`, `describeRestore`.
- Produces:
  ```ts
  export function MosaicPanel({ versionName, settings, sceneSource, onSceneSourceChange, scenes, sceneState, sceneNotes, sceneProvenance, sceneError, onRestoreDials, onSceneSaved }: {
    versionName: string; settings: SettingsValues;
    sceneSource: SceneSource; onSceneSourceChange: (s: SceneSource) => void;
    scenes: SceneSummary[]; sceneState: SceneState | null; sceneNotes: string | null;
    sceneProvenance: SceneProvenance | null; sceneError: string | null;
    onRestoreDials?: () => RestoreReport; onSceneSaved: (id: number) => void;
  })
  ```
  Layout: a 2-column grid, one column per feed. Column header `↑ sunrise` / `↓ sunset`; three stat tiles: `pool <n>`, `pass gate <pass> / <maxTiles or total>`, and for versions whose schema has `bandCount`, `bands <bandCount> × <floorPx>`; else omit the third tile. The right column's header carries the scene chrome: `pool [live | scene ▾]` select (options as `PreviewPane.tsx:215-241` with `sceneOptionLabel`) and `<SaveSceneButton onSaved={onSceneSaved} />`. Under the grid, when a scene is selected and it has notes or provenance, the notes + `restore dials` row from `PreviewPane.tsx:260-281`.

- [ ] **Step 1: Tests** — scene select changes source; save button present; restore row appears only with provenance and calls `onRestoreDials`, showing its report; pass counts render from a fixture pool (use a two-webcam fixture that `countGatePasses` accepts; check `app/components/mosaic/gate.test.ts` for a fixture shape).
- [ ] **Step 2–5** as above. Commit `feat(studio): MosaicPanel — pool and gate readout with the scene selector`.

---

### Task A7: `SoloPanel` + `useSoloState` `enabled`

**Files:**
- Create: `app/studio/panels/SoloPanel.tsx`, `app/studio/panels/SoloPanel.test.tsx`
- Modify: `app/studio/solo/useSoloState.ts` (add `enabled = true` fourth parameter: when false, pass `null` as the SWR key so nothing is fetched; return `{ server: undefined, projected: undefined, error: undefined }`), `app/studio/solo/useSoloState.test.tsx` (one new case: disabled fetches nothing), `app/studio/solo/FeedColumn.tsx` (drop the dead `studioDials` prop and its type; update `FeedColumn.test.tsx` if it passes it).
- Read: `app/studio/solo/SoloStudioClient.tsx:86-113` (the columns + FrameModal state).

**Interfaces:**
- Consumes: `FeedColumn`, `FrameModal`, `useSoloState` results.
- Produces:
  ```ts
  export interface SoloFeedState { server: StateView | undefined; projected: StateView | undefined; error: string | undefined }
  export function SoloPanel({ version, liveDials, nowMs, sunrise, sunset }: {
    version: SoloVersionSpec; liveDials: SoloDials; nowMs: number;
    sunrise: SoloFeedState; sunset: SoloFeedState;
  })
  ```
  Renders the two `FeedColumn`s (or the `loading sunrise…` / error line) in a 2-column grid, owns `selected: { list; index; feed } | null` and mounts `FrameModal` exactly as `SoloStudioClient.tsx:92-113` does.

- [ ] **Step 1: Tests** — with two fixture `StateView`s (borrow the fixture from `FeedColumn.test.tsx`), both columns render; clicking a row opens `FrameModal` (assert the modal's close button from `FrameModal.test.tsx`); an errored feed shows its error text. `useSoloState` disabled: `fetch` is not called.
- [ ] **Step 2–5.** Commit `feat(studio): SoloPanel — the two feed columns and the frame pop-up, lifted from the solo studio`.

---

### Task A8: `StudioClient` rewrite, redirects, deletions, leva removal

**Files:**
- Rewrite: `app/studio/StudioClient.tsx`
- Create: `app/studio/StudioClient.test.tsx`
- Rewrite: `app/studio/solo/page.tsx`, `app/studio/solo2/page.tsx` → server components: `import { redirect } from 'next/navigation'; export default function Page() { redirect('/studio'); }`
- Modify: `app/studio/page.tsx` — wrap `StudioClient` in `<div className={soloFontClassName} style={{ display: 'contents' }}>` (lift from `app/studio/solo/page.tsx`) so the solo preview keeps its font.
- Delete: `app/studio/StudioRail.tsx`, `app/studio/levaConfig.ts`, `app/studio/levaConfig.test.ts`, `app/studio/railWidth.ts`, `app/studio/railWidth.test.ts`, `app/studio/PreviewPane.tsx`, `app/studio/PreviewPane.test.tsx`, `app/studio/StatusStrip.tsx`, `app/studio/StatusStrip.test.tsx`, `app/studio/stripState.ts`, `app/studio/stripState.test.ts`, `app/studio/solo/SoloStudioClient.tsx`, `app/studio/solo/SoloRail.tsx`, `app/studio/solo/SoloRail.test.tsx`, `app/studio/solo/SoloStatusStrip.tsx`, `app/studio/solo/SoloStatusStrip.test.tsx`, `app/studio/solo/RulesBox.tsx`, `app/studio/solo/RulesBox.test.tsx`.
- Modify: `package.json`, `package-lock.json` via `npm uninstall leva --package-lock-only`.
- Grep before deleting: `grep -rn "stripState\|StatusStrip\|PreviewPane\|SoloRail\|RulesBox\|railWidth\|levaConfig\|SoloStudioClient" app --include=*.ts --include=*.tsx` must return only the files being deleted.

**Interfaces:**
- Consumes: everything from A1–A7, `useStudioSettings`, `useSceneWebcams`, `useLoadTerminatorWebcams({ paused })`, `GlassPreview` (`app/studio/solo/GlassPreview.tsx`: `{ screens, dials, panel, version }`), `runOf` (`app/lib/solo2/run`), `withCaption`, `mergeSettings`.

`StudioClient` body:

```tsx
export function StudioClient() {
  const api = useStudioSettings();
  const shared = api.effective(SHARED_NAMESPACE);
  const surface = surfaceFor(shared.activeVersion as string | undefined);
  const panel = PANEL_PRESETS[String(shared.panelPreset)] ?? PANEL_PRESETS[DEFAULT_PANEL_PRESET];
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [tab, setTab] = useState<RailTab>('play');
  const [sceneSource, setSceneSource] = useState<SceneSource>({ kind: 'live' });
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(t); }, []);

  // mosaic surface inputs (hooks always run; they idle on the solo surface)
  useLoadTerminatorWebcams({ paused: surface.kind !== 'mosaic' || sceneSource.kind === 'scene' });
  const scene = useSceneWebcams(surface.kind === 'mosaic' ? sceneSource : { kind: 'live' });
  const settings = api.effective(surface.namespace);

  // solo surface inputs
  const solo = surface.solo;
  const studioDials = solo ? solo.dialsFrom(withCaption(settings, shared)) : null;
  const liveDials = solo ? solo.dialsFrom(withCaption(
    mergeSettings(solo.schema, api.live?.namespaces?.[solo.namespace]), api.live?.namespaces?.[SHARED_NAMESPACE])) : null;
  const fallback = SOLO_VERSIONS.solo as SoloVersionSpec;
  const sunrise = useSoloState('sunrise', studioDials ?? fallback.dialsFrom({}), solo ?? fallback, solo !== null);
  const sunset = useSoloState('sunset', studioDials ?? fallback.dialsFrom({}), solo ?? fallback, solo !== null);
  const runFrames = solo?.name === 'solo2' && studioDials
    ? Math.max(1, ...[sunset, sunrise].map((s) => s.server?.current
        ? runOf(s.server.current.entry, s.server.entries, (studioDials as { cameraRun?: boolean }).cameraRun !== false).length : 0))
    : 1;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gridTemplateRows: '34px 1fr', height: '100vh', background: '#0b0e14', color: '#e5e7eb', overflow: 'hidden' }}>
      <div style={{ gridColumn: '1 / -1' }}><Header api={api} nowMs={nowMs} /></div>
      <aside style={{ background: '#10141d', borderRight: '1px solid #1d2432', padding: 10, overflowY: 'auto' }}>
        <Rail api={api} surface={surface} tab={tab} onTab={setTab} runFrames={runFrames}>
          <DeployHistory api={api} />
        </Rail>
      </aside>
      <main data-testid={`surface-${surface.kind}`} style={{ display: 'grid', gridTemplateRows: 'clamp(220px, 36vh, 520px) auto', gap: 12, padding: 12, overflowY: 'auto', minWidth: 0 }}>
        {solo && studioDials && liveDials ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
              <GlassPreview dials={studioDials} panel={panel} version={solo} screens={[
                { feed: 'sunrise', server: sunrise.server ?? null, error: sunrise.error },
                { feed: 'sunset', server: sunset.server ?? null, error: sunset.error },
              ]} />
            </div>
            <SoloPanel version={solo} liveDials={liveDials} nowMs={nowMs} sunrise={sunrise} sunset={sunset} />
          </>
        ) : (
          <>
            <MosaicPreview versionName={surface.name} panel={panel} settings={settings} shared={shared}
              sceneSource={sceneSource} sceneState={scene.sceneState} at={scene.sceneRepresentsAt ?? undefined} />
            <MosaicPanel versionName={surface.name} settings={settings} sceneSource={sceneSource} onSceneSourceChange={setSceneSource}
              scenes={scene.scenes} sceneState={scene.sceneState} sceneNotes={scene.sceneNotes} sceneProvenance={scene.sceneProvenance}
              sceneError={scene.error} onSceneSaved={scene.refreshScenes}
              onRestoreDials={scene.sceneProvenance ? () => restoreSceneDials(api, scene.sceneProvenance!) : undefined} />
          </>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 1: Write the failing test** `app/studio/StudioClient.test.tsx`: mock `./useStudioSettings` to return the `api()` helper from `Rail.test.tsx` with `effective('shared')` giving `activeVersion: 'solo2'` in one case and `'v4'` in another; mock `./solo/useSoloState`, `./useSceneWebcams`, `@/app/store/useLoadTerminatorWebcams`, `@/app/store/useTerminatorStore` and `next/navigation`. Assert: with `solo2`, `screen.getByTestId('surface-solo')` exists, the tablist renders, and `getByLabelText('valleys per peak')` is in the rail; with `v4`, `getByTestId('surface-mosaic')`, no tablist, `getByLabelText('band count')`. In both, the header's version select and `nav-slot` render, and `DeployHistory`'s `deploys` heading is inside the `aside`.
- [ ] **Step 2: Run** — FAIL (old client).
- [ ] **Step 3: Rewrite `StudioClient.tsx`, the three pages, delete the files, uninstall leva.**
- [ ] **Step 4: Run** `npx vitest run app/studio` then `npm run test`, `npm run lint`, `npm run build`. All must pass. If the build complains that `leva` is still referenced anywhere, grep and fix.
- [ ] **Step 5: Commit**

```bash
cd ~/GitHub/the-sunset-webcam-map.worktrees/feat-one-studio && test "$(git rev-parse --abbrev-ref HEAD)" = "feat/one-studio" && git add app/studio package.json package-lock.json && git status --short && git commit -m "feat(studio): one /studio — version select drives rail, preview and panel; solo routes redirect; leva, both strips, rules box and the second client removed"
```

(`git add app/studio` is acceptable here because every path under it is this task's; confirm with `git status --short` that nothing outside the task is staged.)

---

### Task A9: docs + PR A

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-one-studio-design.md` — status line → `phase A built (PR …), B and C follow`; §8 file list corrected to what A8 actually did (add `MosaicPreview.tsx`, `pollAge.ts`, `Tape.tsx` under kept).
- Modify: `docs/superpowers/specs/2026-09-04-solo2-rhythm-design.md` §4.5 — change the stated `timeStyle` default to `12h-there` with a one-line note "(the caption schema's default; the spec said 12h, the built default was kept because the glass runs it)".
- Modify: `docs/ops/pushing-an-update-to-the-glass.md` — the "Solo → solo2 (and back)" section: replace any `/studio/solo2` link with `/studio` + "pick the version at the top".
- Modify: `CLAUDE.md` if it names `/studio/solo` anywhere (grep).

- [ ] Steps: grep `studio/solo` across `docs/` and `CLAUDE.md`, fix each mention, commit `docs(studio): one studio — spec status, solo2 timeStyle default, runbook links`, push, open the PR:

```bash
gh pr create --base main --head feat/one-studio --title "feat(studio): one /studio — version select drives rail, preview and panel (phase A)" --body-file /tmp/pr-a.md
```

PR body: what changed (one page, what was deleted, what was kept verbatim), the mockup link, "no glass change", the test/build/lint counts, the signed-in smoke list for Jesse (pick solo2 → bins + playing preview; pick v4 → pool/gate + scenes; move a dial → bold; deploy history loads), and the two follow-up PRs. End with the generated-with footer from the session guidance.

---

# Phase B — saved takes (branch `feat/one-studio-takes` off `feat/one-studio`)

### Task B1: migration + `deploys.ts`

**Files:**
- Create: `database/migrations/20260906_kiosk_takes.sql`
- Modify: `app/lib/settings/deploys.ts`, `app/lib/settings/deploys.test.ts` (find the existing test; if none, create with the `sql` mock pattern used in `app/api/kiosk/deploys/*.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  export interface DeployRow { id: number; label: string | null; namespaces: Record<string, SettingsValues>;
    deployedAt: string | null; createdAt: string }
  export async function saveTake(studio: ProfileSettings, label?: string | null): Promise<DeployRow | null>
  // listDeploys: ORDER BY created_at DESC, id DESC; selects created_at and deployed_at
  ```

- [ ] **Step 1: Migration file** (spec §4.1, header comment in the style of `20260905_kiosk_deploys.sql`, apply commands in the comment):

```sql
ALTER TABLE kiosk_deploys ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE kiosk_deploys SET created_at = deployed_at WHERE created_at > deployed_at;
ALTER TABLE kiosk_deploys ALTER COLUMN deployed_at DROP NOT NULL;
```

Run `node scripts/apply-migration.mjs database/migrations/20260906_kiosk_takes.sql` (dry) and paste its output into the commit message body. **Never `--apply`.**

- [ ] **Step 2: Failing tests** — `saveTake` inserts with `deployed_at` NULL and returns `deployedAt: null`; `recordDeploy` still returns an ISO `deployedAt`; `toRow` maps `created_at`; `listDeploys` query text orders by `created_at DESC, id DESC`. Mock `@/app/lib/db`'s `sql` as the existing route tests do and assert on the captured query strings/params.
- [ ] **Step 3: Implement** (`Row` gains `created_at`, `deployed_at: string | Date | null`; `toRow` maps `deployedAt: r.deployed_at ? new Date(r.deployed_at).toISOString() : null`; `saveTake` = `INSERT INTO kiosk_deploys (label, namespaces, deployed_at) VALUES (…, NULL) RETURNING id, label, namespaces, deployed_at, created_at`, never throws, like `recordDeploy`).
- [ ] **Step 4: Run** `npx vitest run app/lib/settings app/api/kiosk/deploys app/studio/deploySummary.test.ts` — PASS (fix `deploySummary` and `DeployHistory` type errors from the nullable field as they surface: `when(row.deployedAt ?? row.createdAt)`).
- [ ] **Step 5: Commit** `feat(takes): kiosk_deploys rows can be saved without deploying — nullable deployed_at, created_at, saveTake` and push.

### Task B2: `POST /api/kiosk/deploys`

**Files:** Modify `app/api/kiosk/deploys/route.ts`, its test.

- [ ] Test: POST without owner → the `requireOwner` denial; POST `{label:'x'}` → 201 `{ take }` where `take.deployedAt === null`; label over 60 chars → 400 (reuse `LABEL_MAX` from the `[id]` route — export it from `parseId.ts` or a shared `labels.ts`). The route calls `getProfileSettings('studio')` then `saveTake(studio, label)`; when `saveTake` returns null respond 503 `{ error: 'take not recorded' }`.
- [ ] Implement, run, commit `feat(takes): POST /api/kiosk/deploys saves the studio profile as a take`.

### Task B3: `useStudioSettings.saveTake`

**Files:** Modify `app/studio/useStudioSettings.ts` (+ `.test.tsx`).

- [ ] Add to `StudioSettingsApi`: `saveTake: (label?: string | null) => Promise<DeployRow | null>`. Implementation: `await flushPending()` (so the take holds the latest edits), `fetch(DEPLOYS_URL, { method: 'POST', body: JSON.stringify({ label }) })`, throw on `!res.ok`, `void mutateDeploys()`, return `json.take`. Test with the file's existing `fetchMock` pattern: the POST is sent after a pending PATCH flushes; the deploys list refetches.
- [ ] Update every `api()` test helper that builds a `StudioSettingsApi` literal (`Rail.test.tsx`, `Header.test.tsx`, `DeployHistory.test.tsx`, `StudioClient.test.tsx`, `DeployButton.test.tsx` if any) to include `saveTake: async () => null`.
- [ ] Commit `feat(takes): useStudioSettings.saveTake`.

### Task B4: Takes list + save-take button

**Files:** Modify `app/studio/DeployHistory.tsx` (+ test), `app/studio/StudioClient.tsx` (+ test), `app/studio/Header.tsx` is unchanged (the button arrives through `extra`).

**Interfaces:**
- `DeployHistory` props become `{ api, saving, onSavingChange }: { api: StudioSettingsApi; saving: boolean; onSavingChange: (v: boolean) => void }`.
- `StudioClient` holds `const [saving, setSaving] = useState(false)` and passes `extra={<button type="button" onClick={() => setSaving(true)} …>save take</button>}` to `Header` and `saving`/`onSavingChange` to `DeployHistory`.

- [ ] Tests (`DeployHistory.test.tsx`): heading reads `takes`; rows order as given; badges: `saved` when `deployedAt === null`, `deployed` otherwise, plus the existing `live` (rename from `glass`) and `in studio` (rename from `studio`) when equal; with `saving`, an input `aria-label="label for the new take"` autofocuses; Enter calls `api.saveTake(label)` and `onSavingChange(false)`; Escape calls `onSavingChange(false)` without saving; when the newest row's namespaces equal the studio profile, saving still saves and the row shows `same as #<id>` for a moment (assert the text right after the save resolves).
- [ ] Implement, run `npx vitest run app/studio`, `npm run test`, `npm run lint`, `npm run build`.
- [ ] Commit `feat(takes): takes list with saved/deployed badges and the save-take button` and open PR B:

```bash
gh pr create --base feat/one-studio --head feat/one-studio-takes --title "feat(studio): saved takes (phase B)" --body-file /tmp/pr-b.md
```

PR body must open with: **Apply before merge:** `node scripts/apply-migration.mjs database/migrations/20260906_kiosk_takes.sql --apply` then `npm run migrate:status`.

---

# Phase C — the solo preview plays the projected queue (branch `feat/one-studio-preview` off `feat/one-studio-takes`)

### Task C1: `useSoloPreview`

**Files:**
- Create: `app/studio/solo/useSoloPreview.ts`, `app/studio/solo/useSoloPreview.test.ts`
- Read: `app/studio/solo/useLoopingStage.ts`, `app/components/solo2/index.tsx:25-60` (the `Dwell` pattern: entry, previous and start in one state update).

**Interfaces:**
- Produces:
  ```ts
  export interface PreviewDwell { entry: EntryView | null; previous: EntryView | null; startMs: number; index: number }
  /**
   * A local clock through `order` (the on-glass frame first, then the projected queue) at `dwellS`
   * per frame, wrapping at the end. `entry`, `previous` and `startMs` change in ONE state update
   * (Appendix A concern 1 and 2). When `order[0]` changes (the server advanced), the clock restarts at index 0.
   */
  export function useSoloPreview(order: EntryView[], dwellS: number, tickMs = 250): PreviewDwell
  ```

- [ ] **Step 1: Failing tests** (fake timers):
  - starts at `order[0]` with `previous: null`;
  - after `dwellS` seconds, `entry` is `order[1]`, `previous` is `order[0]`, and `startMs` moved forward by `dwellS*1000` — assert all three from a single rerender by reading the hook result once (`renderHook`, `act(() => vi.advanceTimersByTime(...))`, then one `result.current` read; also spy with a `useEffect` counter in a wrapper to prove there was exactly one render with the new entry, i.e. no render where `entry` is new and `previous` is stale);
  - wraps: after `order.length * dwellS` seconds, `entry` is `order[0]` and `previous` is the last;
  - when `order[0].snapshotId` changes, index resets to 0 and `previous` is the prior entry;
  - empty `order` → `entry: null`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: state `PreviewDwell`; an interval at `tickMs` computes `elapsed = Date.now() - startMs`; when `elapsed >= dwellS*1000` set `{ index: (index+1) % order.length, entry: order[next], previous: entry, startMs: startMs + dwellS*1000 }` in one `setState`; a render-phase check like `PlayingScreen`'s resets when `order[0]?.snapshotId` differs from the tracked head.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(studio): useSoloPreview — a local clock through the projected queue, entry/previous/start in one update`.

### Task C2: `GlassPreview` plays for both versions

**Files:** Modify `app/studio/solo/GlassPreview.tsx` (+ `.test.tsx`), `app/studio/StudioClient.tsx` (pass `next`).

**Interfaces:**
- `GlassPreview`'s `screens` entries gain `projected: StateView | null` so the preview has `projected.next`. `order = [current, ...projected.next]`.
- solo: `<SoloFrame entry={dwell.entry} previous={dwell.previous} fadeS={dials.fadeS} …/>` keyed by `dwell.index`.
- solo2: `run = runOf(dwell.entry, entries, dials.cameraRun)`, `plan = fitPlan(dials, run.length)`, `stage = useLoopingStage(plan, dwell.index)` (the stage clock restarts with the index, in step with `useSoloPreview`), `<Solo2Frame … previous={dwell.previous} stage plan />`.
- The header line reads `on glass now · frame N` when `dwell.index === 0` and `preview · frame N · next in <s> s` otherwise, so the live truth stays visible.

- [ ] Tests: solo screen advances to `next[0]` after `dwellS` seconds and passes `previous`; solo2 screen mounts `Solo2Frame` with the right `run` length after advancing; a `null` server renders `no frame to preview`; the header line flips between `on glass now` and `preview`.
- [ ] Implement; `npx vitest run app/studio`, `npm run test`, `npm run lint`, `npm run build`.
- [ ] Commit `feat(studio): the solo preview plays the projected queue on the studio dials for solo and solo2` and open PR C:

```bash
gh pr create --base feat/one-studio-takes --head feat/one-studio-preview --title "feat(studio): solo preview plays the projected queue (phase C)" --body-file /tmp/pr-c.md
```

---

## Self-review

- **Spec coverage:** §2.1 header → A4; §2.2 surfaces → A1, A8; §2.3 rail → A3; §2.4 deletions → A8 (every row: dials line, cross-links, RulesBox, DwellBudget folded, hints, mini caption is already gone since #145, both strips, PreviewPane chrome; the nav toggle is kept per the corrected §2.1); §2.5 kept list → untouched files; §4 takes → B1–B4; §5 preview → C1–C2 (with #145's `useLoopingStage` reused); §6 routes → A8; §7 scenes → A6; §9 phases → three PRs; §10 reconcile → this plan was written against `952501840`; §12 tests → each task's test file. Appendix A concern 3 → A9 doc change, not a default change.
- **Placeholders:** A3's `GroupHeader` and the tab button say "lift from SoloRail lines …" with the exact lines; A5/A6/A7 lift from named line ranges. No TBDs.
- **Type consistency:** `RailTab = 'play' | 'picture'` everywhere (not `queue`); `SoloFeedState` is the shape `useSoloState` returns; `DeployRow.deployedAt` becomes `string | null` in B1 and `DeployHistory` reads `deployedAt ?? createdAt` for the time; `saveTake` added to every `StudioSettingsApi` literal in B3.
