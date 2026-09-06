'use client';

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { StudioSettingsApi } from './useStudioSettings';
import type { StudioSurface } from './surfaces';
import { SHARED_NAMESPACE } from '@/app/lib/settings/sharedSchema';
import { CAPTION_SCHEMA, CAPTION_SECTION, withCaption } from '@/app/lib/solo/captionSchema';
import { SOURCE_FRAME, drawFactor, pictureRect } from '@/app/lib/solo/caption';
import { PANEL_PRESETS, type PanelSize } from '@/app/kiosk/panelPreview';
import type { KnobDescriptor, KnobValue, SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type { SoloDials } from '@/app/lib/solo/types';
import type { Solo2Dials } from '@/app/lib/solo2/types';
import type { PlanDials } from '@/app/lib/solo2/plan';
import { DwellBudget } from './solo/DwellBudget';

/** The rail's two pages: what plays and when, and how the picture and its words are drawn. */
export type RailTab = 'play' | 'picture';

const TABS: { id: RailTab; label: string; hint: string }[] = [
  { id: 'play', label: 'Play', hint: 'Timing, overlays and the ordering algorithm: what plays and when.' },
  { id: 'picture', label: 'Picture', hint: 'The picture\'s size on black and the words beneath it. The screens above draw them as you move.' },
];

/**
 * A solo version's two coloured groups. Every solo schema sorts its knobs
 * into these two sections, and the colours are what the rail teaches: orange
 * changes what is drawn, teal changes what comes next.
 */
const SOLO_GROUPS = {
  glass: {
    title: 'Glass · what the screen draws', color: '#f5a344',
    hint: 'These change what the screens draw. They never change which frame comes next.',
  },
  bins: {
    title: 'Bins · the ordering algorithm', color: '#4fd1c5',
    hint: 'These change which frame comes next. The queue re-runs the moment one moves.',
  },
} as const;

const CAPTION_GROUP = {
  title: 'Picture · the frame and its words', color: '#c4a7f7',
  hint: 'Sizes are glass pixels; grays are percent of white. Shared by every solo version.',
};

/** A mosaic version has as many sections as its schema names, all one colour. */
const MOSAIC_COLOR = '#4a90d9';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sectionsOf = (schema: SettingsSchema) => [...new Set(schema.map((k) => k.section))];

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
  const id = `rail-${knob.key}`;
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
 * A group's coloured bar: its name, its hint, and the reset for its section.
 * `asSummary` makes it a collapsible group's `<summary>` — the reset button
 * inside one has to swallow its click, or resetting a section would fold it.
 */
function GroupHeader({ title, color, hint, section, onReset, asSummary = false }: {
  title: string;
  color: string;
  hint: string;
  section: string;
  onReset: () => void;
  asSummary?: boolean;
}) {
  const style: CSSProperties = {
    margin: '10px 0 6px', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase',
    padding: '4px 8px', borderRadius: 4, background: `${color}22`, color,
    borderLeft: `3px solid ${color}`, display: 'flex', justifyContent: 'space-between',
    cursor: asSummary ? 'pointer' : 'help',
  };
  const body = (
    <>
      <span title={hint}>{title}</span>
      <button type="button"
        onClick={(e) => {
          if (asSummary) {
            e.preventDefault();
            e.stopPropagation();
          }
          onReset();
        }}
        title={`Put every ${section} dial back to its code default`}
        style={{ background: 'transparent', border: 0, color, fontSize: 10, cursor: 'pointer' }}>
        reset {section}
      </button>
    </>
  );
  return asSummary
    ? <summary title={hint} style={style}>{body}</summary>
    : <h4 title={hint} style={style}>{body}</h4>;
}

/**
 * The one dial rail (one-studio spec §2.3). It renders whatever schema the
 * surface hands it: a solo version's two coloured groups plus the shared
 * picture page, or a mosaic version's sections as collapsible groups. No
 * version names, no deploy slot, no cross-links — the header above owns
 * those, so this file only ever grows a row when a schema does.
 */
export function Rail({ api, surface, tab, onTab, runFrames = 1, children }: {
  api: StudioSettingsApi;
  surface: StudioSurface;
  tab: RailTab;
  onTab: (t: RailTab) => void;
  /** solo2: frames in the on-glass camera's run, for the dwell readout. */
  runFrames?: number;
  /** The takes list, rendered under the dials. */
  children?: ReactNode;
}) {
  const ns = surface.namespace;
  const values = api.effective(ns);
  const shared = api.effective(SHARED_NAMESPACE);
  const diff = new Set(api.diffByNamespace[ns] ?? []);
  const sharedDiff = new Set(api.diffByNamespace[SHARED_NAMESPACE] ?? []);
  const panel = PANEL_PRESETS[String(shared.panelPreset)] ?? PANEL_PRESETS['dell-l'];
  const soloDials = surface.solo ? surface.solo.dialsFrom(withCaption(values, shared)) : null;
  // leadS is solo2's; a version without it leads for no time at all.
  const planDials: PlanDials | null = soloDials
    ? { dwellS: soloDials.dwellS, leadS: (soloDials as Partial<Solo2Dials>).leadS ?? 0 }
    : null;
  const page: RailTab = surface.hasPicturePage ? tab : 'play';

  const knob = (k: KnobDescriptor, target: { ns: string; values: SettingsValues; diff: Set<string> }) => (
    <Fragment key={k.key}>
      <Control knob={k} value={target.values[k.key]} differs={target.diff.has(k.key)}
        onChange={(v) => api.setKnob(target.ns, k.key, v)} />
      {k.key === 'pictureHeight' && soloDials && <PictureReadout dials={soloDials} panel={panel} />}
      {k.key === 'cameraRun' && planDials && <DwellBudget dials={planDials} frames={runFrames} />}
    </Fragment>
  );

  return (
    <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {surface.hasPicturePage && (
        <div role="tablist" aria-label="Rail pages" style={{ display: 'flex', gap: 4, margin: '0 0 6px' }}>
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={page === t.id} title={t.hint}
              onClick={() => onTab(t.id)} style={{
                flex: 1, padding: '5px 0', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', cursor: 'pointer',
                background: page === t.id ? '#1d2432' : 'transparent', color: page === t.id ? '#e5e7eb' : '#8b95a7',
                border: '1px solid #1d2432', borderRadius: 4,
              }}>
              {t.label}
            </button>
          ))}
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
          <GroupHeader asSummary title={cap(section)} color={MOSAIC_COLOR} hint={`The ${section} dials.`}
            section={section} onReset={() => api.resetSection(ns, section)} />
          {surface.schema.filter((k) => k.section === section).map((k) => knob(k, { ns, values, diff }))}
        </details>
      ))}
      {page === 'picture' && (
        <section>
          <GroupHeader {...CAPTION_GROUP} section={CAPTION_SECTION}
            onReset={() => api.resetSection(SHARED_NAMESPACE, CAPTION_SECTION)} />
          {CAPTION_SCHEMA.map((k) => knob(k, { ns: SHARED_NAMESPACE, values: shared, diff: sharedDiff }))}
        </section>
      )}
      <div style={{ marginTop: 'auto', paddingTop: 10 }}>{children}</div>
    </div>
  );
}
