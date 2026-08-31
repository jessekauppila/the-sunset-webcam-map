'use client';

import { useMemo, type ReactNode } from 'react';
import { LevaPanel, useCreateStore, useControls, folder, button } from 'leva';
import { SHARED_NAMESPACE, SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { MOSAIC_SETTINGS_SCHEMAS } from '@/app/components/mosaic/registry';
import { buildFolderSpecs, type LevaFolderSpec } from './levaConfig';
import type { KnobValue, SettingsSchema } from '@/app/lib/settings/schema';
import type { StudioSettingsApi } from './useStudioSettings';

const dim = '#8b95a7';
const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const railBorder = '#1d2432';

const CHIP_BG = '#17351f';
const CHIP_FG = '#4cc38a';

/**
 * Dusk-palette leva theme: dark elevations, blue-family accents, a bright
 * highlight for readable labels/values against the near-black panel.
 * Typed structurally against leva's `theme` prop at the JSX call site below
 * (leva doesn't publicly export its `LevaCustomTheme` type).
 */
const DUSK_THEME = {
  colors: {
    elevation1: '#10141d',
    elevation2: '#141a26',
    elevation3: '#1a2130',
    accent1: '#4a90d9',
    accent2: '#3f7cc0',
    accent3: '#5aa3ec',
    highlight1: '#8b95a7',
    highlight2: '#b7c0d1',
    highlight3: '#d7dce6',
    vivid1: '#5aa3ec',
    folderTextColor: '#b7c0d1',
    folderWidgetColor: '#8b95a7',
    toolTipBackground: '#1a2130',
    toolTipText: '#d7dce6',
  },
  radii: { xs: '2px', sm: '3px', lg: '6px' },
};

function prettify(section: string): string {
  return section.charAt(0).toUpperCase() + section.slice(1);
}

/** Plain leva control descriptor built from a LevaFolderSpec entry. */
type LevaControl = {
  value: KnobValue;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  onChange: (value: KnobValue) => void;
};

function controlsForSpec(
  ns: string,
  spec: LevaFolderSpec,
  setKnob: StudioSettingsApi['setKnob']
): Record<string, LevaControl> {
  const controls: Record<string, LevaControl> = {};
  for (const [key, ctrl] of Object.entries(spec.controls)) {
    controls[key] = {
      value: ctrl.value,
      label: ctrl.label,
      ...(ctrl.min !== undefined ? { min: ctrl.min } : {}),
      ...(ctrl.max !== undefined ? { max: ctrl.max } : {}),
      ...(ctrl.step !== undefined ? { step: ctrl.step } : {}),
      ...(ctrl.options !== undefined ? { options: [...ctrl.options] } : {}),
      onChange: (value: KnobValue) => setKnob(ns, key, value),
    };
  }
  return controls;
}

export function StudioRail({
  api,
  onCollapse,
  deploySlot,
}: {
  api: StudioSettingsApi;
  onCollapse: () => void;
  deploySlot?: ReactNode;
}) {
  const store = useCreateStore();

  const sharedValues = api.effective(SHARED_NAMESPACE);
  const activeVersionKnob = SHARED_SCHEMA.find((k) => k.key === 'activeVersion');
  const versionOptions = activeVersionKnob?.kind === 'enum' ? activeVersionKnob.options : [];
  const activeVersion = (sharedValues.activeVersion as string) ?? versionOptions[0] ?? 'v1';

  // The top <select> owns activeVersion — everything else in SHARED_SCHEMA
  // (currently just panelPreset, both in section 'glass') is dial-controlled.
  const sharedSchema = useMemo(
    () => SHARED_SCHEMA.filter((k) => k.key !== 'activeVersion'),
    []
  );
  const versionSchema: SettingsSchema = MOSAIC_SETTINGS_SCHEMAS[activeVersion] ?? [];

  const versionValues = api.effective(activeVersion);
  const sharedDiff = api.diffByNamespace[SHARED_NAMESPACE] ?? [];
  const versionDiff = api.diffByNamespace[activeVersion] ?? [];

  const sharedSpecs = buildFolderSpecs(sharedSchema, sharedValues, sharedDiff);
  const versionSpecs = buildFolderSpecs(versionSchema, versionValues, versionDiff);

  // Precomputed so useMemo/useControls deps arrays below stay simple
  // expressions leva-eslint's exhaustive-deps check can verify statically.
  const sharedValuesKey = JSON.stringify(sharedValues);
  const versionValuesKey = JSON.stringify(versionValues);
  const sharedDiffKey = sharedDiff.join(',');
  const versionDiffKey = versionDiff.join(',');

  // resetSection('shared', 'glass') would also clear activeVersion, since
  // both knobs share that section in SHARED_SCHEMA — but the top <select>
  // owns activeVersion, so the shared folder's reset button must not touch
  // it. resetSection has no per-key exclusion, so instead we reset each
  // non-activeVersion knob in that section directly via setKnob back to its
  // schema default (currently just panelPreset).
  const resetSharedFolder = () => {
    for (const knob of sharedSchema) {
      api.setKnob(SHARED_NAMESPACE, knob.key, knob.default);
    }
  };

  const schema = useMemo(() => {
    // Dynamically assembled from the schema, so its shape can't be known
    // statically — cast each folder's entries to leva's own (privately
    // typed) Schema at the folder() call site, matching the shape folder()
    // itself declares its parameter as.
    const out: Record<string, ReturnType<typeof folder>> = {};
    for (const spec of sharedSpecs) {
      const controls: Record<string, LevaControl | ReturnType<typeof button>> =
        controlsForSpec(SHARED_NAMESPACE, spec, api.setKnob);
      controls[`reset ${spec.section}`] = button(resetSharedFolder);
      out[spec.section] = folder(controls as Parameters<typeof folder>[0]);
    }
    for (const spec of versionSpecs) {
      const controls: Record<string, LevaControl | ReturnType<typeof button>> =
        controlsForSpec(activeVersion, spec, api.setKnob);
      controls[`reset ${spec.section}`] = button(() =>
        api.resetSection(activeVersion, spec.section)
      );
      out[prettify(spec.section)] = folder(controls as Parameters<typeof folder>[0]);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersion, sharedValuesKey, versionValuesKey, sharedDiffKey, versionDiffKey]);

  // Deps array leva uses to re-sync control values from `effective()` when
  // they change from outside this panel (e.g. a revert()).
  useControls(schema, { store }, [activeVersion, sharedValuesKey, versionValuesKey]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.1em',
            color: CHIP_FG,
            background: CHIP_BG,
            borderRadius: 999,
            padding: '3px 10px',
          }}
        >
          STUDIO
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="collapse dials"
          style={{
            background: 'transparent',
            border: `1px solid ${railBorder}`,
            borderRadius: 4,
            color: dim,
            fontSize: 12,
            padding: '2px 8px',
            cursor: 'pointer',
          }}
        >
          «
        </button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label
          htmlFor="studio-version-select"
          style={{
            display: 'block',
            fontSize: 11,
            color: dim,
            fontFamily: mono,
            marginBottom: 4,
          }}
        >
          version
        </label>
        <select
          id="studio-version-select"
          value={activeVersion}
          onChange={(e) => api.setKnob(SHARED_NAMESPACE, 'activeVersion', e.target.value)}
          style={{
            width: '100%',
            background: '#1a2130',
            color: '#d7dce6',
            border: `1px solid ${railBorder}`,
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 13,
            fontFamily: mono,
          }}
        >
          {versionOptions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        {deploySlot ?? (
          <p style={{ fontSize: 11, color: dim, fontFamily: mono, margin: 0 }}>
            · deploy controls land in Task 12 ·
          </p>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <LevaPanel store={store} theme={DUSK_THEME} fill flat titleBar={false} />
      </div>
    </div>
  );
}
