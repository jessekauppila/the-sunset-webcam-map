'use client';

import type { ReactNode } from 'react';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import { DwellBudget } from './DwellBudget';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import { SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import type { KnobDescriptor, KnobValue } from '@/app/lib/settings/schema';
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
  onChange: (v: KnobValue) => void;
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
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '3px 4px' }}>
      <label htmlFor={id} title={knob.description} style={labelStyle}>{knob.label}</label>
      <select id={id} value={value as string} onChange={(e) => onChange(e.target.value)} style={{
        background: '#1a2130', color: '#d7dce6', border: '1px solid #2a3242', borderRadius: 4,
        padding: '2px 6px', fontSize: 12, fontFamily: mono,
      }}>
        {knob.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/**
 * The solo studio's dial rail. Two colour-coded groups straight from the
 * schema's sections, a bold label wherever the studio value differs from
 * the glass, and the rules box stating §4 with the values in force.
 */
export function SoloRail({ api, deploySlot, version = SOLO_VERSIONS.solo as SoloVersionSpec }: {
  api: StudioSettingsApi;
  deploySlot: ReactNode;
  version?: SoloVersionSpec;
}) {
  const ns = version.namespace;
  const values = api.effective(ns);
  const shared = api.effective(SHARED_NAMESPACE);
  const diff = new Set(api.diffByNamespace[ns] ?? []);
  const dials = version.dialsFrom(values);
  return (
    <div style={{ fontSize: 12 }}>
      {deploySlot}
      <div style={{ fontFamily: mono, color: '#8b95a7', padding: '6px 4px' }}
        title="Which version the glass runs and the panel geometry. Both are shared dials, set on /studio.">
        glass {String(shared.activeVersion)} · panel {String(shared.panelPreset)} · dials {version.name}
      </div>
      {GROUPS.map((g) => (
        <section key={g.section}>
          <h4 title={g.hint} style={{
            margin: '10px 0 6px', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase',
            padding: '4px 8px', borderRadius: 4, background: `${g.color}22`, color: g.color,
            borderLeft: `3px solid ${g.color}`, display: 'flex', justifyContent: 'space-between', cursor: 'help',
          }}>
            <span>{g.title}</span>
            <button type="button" onClick={() => api.resetSection(ns, g.section)}
              title={`Put every ${g.section} dial back to its code default`}
              style={{ background: 'transparent', border: 0, color: g.color, fontSize: 10, cursor: 'pointer' }}>
              reset {g.section}
            </button>
          </h4>
          {version.schema.filter((k) => k.section === g.section).map((k) => (
            <Control key={k.key} knob={k} value={values[k.key]} differs={diff.has(k.key)}
              onChange={(v) => api.setKnob(ns, k.key, v)} />
          ))}
          {g.section === 'glass' && version.name === 'solo2' && <DwellBudget dials={dials as Solo2Dials} />}
        </section>
      ))}
      <RulesBox dials={dials} version={version} />
    </div>
  );
}
