'use client';

import { Fragment, type ReactNode } from 'react';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import { DwellBudget } from './DwellBudget';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import type { SoloDials } from '@/app/lib/solo/types';
import { SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import { CAPTION_SCHEMA, CAPTION_SECTION, withCaption } from '@/app/lib/solo/captionSchema';
import { SOURCE_FRAME, drawFactor, pictureRect } from '@/app/lib/solo/caption';
import { PANEL_PRESETS, type PanelSize } from '@/app/kiosk/panelPreview';
import type { KnobDescriptor, KnobValue } from '@/app/lib/settings/schema';
import type { StudioSettingsApi } from '../useStudioSettings';
import { RulesBox } from './RulesBox';

/** The rail's two pages: what plays and when, and how the picture and its words are drawn. */
export type RailTab = 'queue' | 'picture';
const TABS: { id: RailTab; label: string; hint: string }[] = [
  { id: 'queue', label: 'Queue', hint: 'Timing, overlays and the ordering algorithm: what plays and when.' },
  { id: 'picture', label: 'Picture', hint: 'The picture\'s size on black and the words beneath it. The screens above draw them as you move.' },
];

const GROUPS = [
  { section: 'glass', tab: 'queue', title: 'Glass · what the screen draws', color: '#f5a344',
    hint: 'These change what the screens draw. They never change which frame comes next.' },
  { section: 'bins', tab: 'queue', title: 'Bins · the ordering algorithm', color: '#4fd1c5',
    hint: 'These change which frame comes next. The queue re-runs the moment one moves.' },
  { section: CAPTION_SECTION, tab: 'picture', title: 'Picture · the frame and its words', color: '#c4a7f7',
    hint: 'Sizes are glass pixels on a 1920-wide panel; grays are percent of white. Shared by every solo version, so the glass draws one caption whichever engine runs. Deploy sends them to the glass like any other dial.' },
] as const;

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * How big the picture draws on the shared panel preset, against the 400 × 224
 * source every frame arrives at. Sits under the picture-height dial so
 * "smaller" has a number: 1× is pixel-for-pixel.
 */
function PictureReadout({ dials, panel }: { dials: SoloDials; panel: PanelSize }) {
  const r = pictureRect(dials, panel.width, panel.height);
  return (
    <div data-testid="picture-readout" style={{ fontFamily: mono, fontSize: 11, color: '#8b95a7', padding: '0 4px 6px' }}
      title={`Every frame is a ${SOURCE_FRAME.width} × ${SOURCE_FRAME.height} still from Windy. This is how far the panel (${panel.width} × ${panel.height}) blows it up; the softness on glass is that, not compression.`}>
      draws {r.width} × {r.height} · {drawFactor(r).toFixed(1)}× the {SOURCE_FRAME.width} × {SOURCE_FRAME.height} source
    </div>
  );
}

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
 * The solo studio's dial rail. Two tabs: the colour-coded glass and bins
 * groups with the rules box, and the caption group. Every group comes
 * straight from the schema's sections, with a bold label wherever the studio
 * value differs from the glass.
 */
export function SoloRail({ api, deploySlot, version = SOLO_VERSIONS.solo as SoloVersionSpec, tab = 'queue', onTab, runFrames = 1 }: {
  api: StudioSettingsApi;
  deploySlot: ReactNode;
  version?: SoloVersionSpec;
  tab?: RailTab;
  onTab?: (tab: RailTab) => void;
  /** solo2: how many frames the camera on glass plays, for the dwell line. */
  runFrames?: number;
}) {
  const ns = version.namespace;
  const values = api.effective(ns);
  const shared = api.effective(SHARED_NAMESPACE);
  const diff = new Set(api.diffByNamespace[ns] ?? []);
  const sharedDiff = new Set(api.diffByNamespace[SHARED_NAMESPACE] ?? []);
  const dials = version.dialsFrom(withCaption(values, shared));
  const panel = PANEL_PRESETS[String(shared.panelPreset)] ?? PANEL_PRESETS['dell-l'];
  // The caption group is the shared namespace's: one caption for every solo
  // version, whichever the glass runs. The other groups are this version's.
  const groupOf = (section: string) => section === CAPTION_SECTION
    ? { ns: SHARED_NAMESPACE, knobs: CAPTION_SCHEMA, values: shared, diff: sharedDiff }
    : { ns, knobs: version.schema.filter((k) => k.section === section), values, diff };
  return (
    <div style={{ fontSize: 12 }}>
      {deploySlot}
      <div style={{ fontFamily: mono, color: '#8b95a7', padding: '6px 4px' }}
        title="Which version the glass runs and the panel geometry. Both are shared dials, set on /studio.">
        glass {String(shared.activeVersion)} · panel {String(shared.panelPreset)} · dials {version.name}
      </div>
      <div role="tablist" aria-label="Rail pages" style={{ display: 'flex', gap: 4, margin: '4px 0 6px' }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} title={t.hint}
            onClick={() => onTab?.(t.id)} style={{
              flex: 1, padding: '5px 0', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer',
              background: tab === t.id ? '#1d2432' : 'transparent', color: tab === t.id ? '#e5e7eb' : '#8b95a7',
              border: '1px solid #1d2432', borderRadius: 4,
            }}>
            {t.label}
          </button>
        ))}
      </div>
      {GROUPS.filter((g) => g.tab === tab).map((g) => {
        const grp = groupOf(g.section);
        return (
          <section key={g.section}>
            <h4 title={g.hint} style={{
              margin: '10px 0 6px', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase',
              padding: '4px 8px', borderRadius: 4, background: `${g.color}22`, color: g.color,
              borderLeft: `3px solid ${g.color}`, display: 'flex', justifyContent: 'space-between', cursor: 'help',
            }}>
              <span>{g.title}</span>
              <button type="button" onClick={() => api.resetSection(grp.ns, g.section)}
                title={`Put every ${g.section} dial back to its code default`}
                style={{ background: 'transparent', border: 0, color: g.color, fontSize: 10, cursor: 'pointer' }}>
                reset {g.section}
              </button>
            </h4>
            {grp.knobs.map((k) => (
              <Fragment key={k.key}>
                <Control knob={k} value={grp.values[k.key]} differs={grp.diff.has(k.key)}
                  onChange={(v) => api.setKnob(grp.ns, k.key, v)} />
                {k.key === 'pictureHeight' && <PictureReadout dials={dials} panel={panel} />}
              </Fragment>
            ))}
            {g.section === 'glass' && version.name === 'solo2' && <DwellBudget dials={dials as Solo2Dials} frames={runFrames} />}
          </section>
        );
      })}
      {tab === 'queue' && <RulesBox dials={dials} version={version} />}
    </div>
  );
}
