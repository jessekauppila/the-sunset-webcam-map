'use client';

import type { ReactNode } from 'react';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from '@/app/lib/solo/settingsSchema';
import { SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import type { KnobDescriptor } from '@/app/lib/settings/schema';
import type { StudioSettingsApi } from '../useStudioSettings';
import { RulesBox } from './RulesBox';

const GROUPS = [
  { section: 'glass', title: 'Glass · what the screen draws', color: '#f5a344',
    hint: 'These change what the screens draw. They never change which frame comes next.' },
  { section: 'bins', title: 'Bins · the ordering algorithm', color: '#4fd1c5',
    hint: 'These change which frame comes next. The queue re-runs the moment one moves.' },
] as const;

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

function Control({ knob, value, differs, onChange }: {
  knob: KnobDescriptor;
  value: number | boolean | string;
  differs: boolean;
  onChange: (v: number | boolean) => void;
}) {
  const id = `solo-${knob.key}`;
  const labelStyle = { color: '#c3cad6', fontSize: 12, fontWeight: differs ? 700 : 400, cursor: 'help' } as const;
  if (knob.kind === 'boolean') {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 4px' }}>
        <label htmlFor={id} title={knob.description} style={labelStyle}>{knob.label}</label>
        <input id={id} type="checkbox" checked={value as boolean} onChange={(e) => onChange(e.target.checked)} />
      </div>
    );
  }
  if (knob.kind === 'number') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 48px', gap: 6, alignItems: 'center', padding: '3px 4px' }}>
        <label htmlFor={id} title={knob.description} style={labelStyle}>{knob.label}</label>
        <span style={{ fontFamily: mono, fontSize: 12, color: '#e5e7eb', textAlign: 'right' }}>{value}</span>
        <input id={id} type="range" min={knob.min} max={knob.max} step={knob.step} value={value as number}
          onChange={(e) => onChange(Number(e.target.value))} style={{ gridColumn: '1 / 2', width: '100%' }} />
      </div>
    );
  }
  return null; // no enum knobs in the solo schema
}

/**
 * The solo studio's dial rail. Two colour-coded groups straight from the
 * schema's sections, a bold label wherever the studio value differs from
 * the glass, and the rules box stating §4 with the values in force.
 */
export function SoloRail({ api, deploySlot }: { api: StudioSettingsApi; deploySlot: ReactNode }) {
  const values = api.effective(SOLO_NAMESPACE);
  const shared = api.effective(SHARED_NAMESPACE);
  const diff = new Set(api.diffByNamespace[SOLO_NAMESPACE] ?? []);
  return (
    <div style={{ fontSize: 12 }}>
      {deploySlot}
      <div style={{ fontFamily: mono, color: '#8b95a7', padding: '6px 4px' }}
        title="Which version the glass runs and the panel geometry. Both are shared dials, set on /studio.">
        glass {String(shared.activeVersion)} · panel {String(shared.panelPreset)}
      </div>
      {GROUPS.map((g) => (
        <section key={g.section}>
          <h4 title={g.hint} style={{
            margin: '10px 0 6px', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase',
            padding: '4px 8px', borderRadius: 4, background: `${g.color}22`, color: g.color,
            borderLeft: `3px solid ${g.color}`, display: 'flex', justifyContent: 'space-between', cursor: 'help',
          }}>
            <span>{g.title}</span>
            <button type="button" onClick={() => api.resetSection(SOLO_NAMESPACE, g.section)}
              title={`Put every ${g.section} dial back to its code default`}
              style={{ background: 'transparent', border: 0, color: g.color, fontSize: 10, cursor: 'pointer' }}>
              reset {g.section}
            </button>
          </h4>
          {SOLO_SETTINGS_SCHEMA.filter((k) => k.section === g.section).map((k) => (
            <Control key={k.key} knob={k} value={values[k.key]} differs={diff.has(k.key)}
              onChange={(v) => api.setKnob(SOLO_NAMESPACE, k.key, v)} />
          ))}
        </section>
      ))}
      <RulesBox dials={dialsFrom(values)} />
    </div>
  );
}
