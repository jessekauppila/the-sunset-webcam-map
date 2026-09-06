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
  it('a solo knob in a section beyond glass and bins still lands under a group of its own', () => {
    const extra = {
      key: 'zzz', kind: 'boolean', default: false,
      label: 'zzz dial', section: 'extra', description: 'a knob the rail has no colour for',
    } as const;
    const schema = [...STUDIO_SURFACES.solo.schema, extra];
    const surface = { ...STUDIO_SURFACES.solo, schema };
    const a = api({
      effective: (ns) => ns === 'shared'
        ? mergeSettings(SHARED_SCHEMA, { activeVersion: 'solo2', panelPreset: 'dell' })
        : mergeSettings(schema, {}),
    });
    render(<Rail api={a} surface={surface} tab="play" onTab={noop} />);
    expect(screen.getByText('Extra')).toBeInTheDocument();
    expect(screen.getByLabelText('zzz dial')).toBeInTheDocument();
    fireEvent.click(screen.getByText('reset extra'));
    expect(a.resetSection).toHaveBeenCalledWith('solo', 'extra');
  });
  it('the tab click reports the other page', () => {
    const onTab = vi.fn();
    render(<Rail api={api()} surface={STUDIO_SURFACES.solo} tab="play" onTab={onTab} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Picture' }));
    expect(onTab).toHaveBeenCalledWith('picture');
  });
  it('every play-page knob label carries a hint glyph whose title is its schema description', () => {
    const { container } = render(<Rail api={api()} surface={STUDIO_SURFACES.solo2} tab="play" onTab={noop} />);
    for (const k of SOLO2_SETTINGS_SCHEMA) {
      // The glyph is a sibling of the <label>, not a child of it: nesting it
      // inside the label would make getByLabelText(k.label) see "label?" and
      // stop matching (see the Hint doc comment in Rail.tsx).
      const hint = container.querySelector(`label[for="rail-${k.key}"] + [data-testid="hint"]`);
      expect(hint).toHaveAttribute('title', k.description);
    }
  });
  it('the play-page section headers carry a hint glyph matching their own hint', () => {
    const { container } = render(<Rail api={api()} surface={STUDIO_SURFACES.solo2} tab="play" onTab={noop} />);
    const headers = container.querySelectorAll('h4');
    expect(headers.length).toBeGreaterThan(0);
    headers.forEach((h) => {
      expect(h.querySelector('[data-testid="hint"]')).toHaveAttribute('title', h.getAttribute('title'));
    });
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
  it('a closed section opens on a click of its summary, and its caret turns down', () => {
    render(<Rail api={api()} surface={STUDIO_SURFACES.v4} tab="play" onTab={noop} />);
    const summaryOf = (i: number) => screen.getAllByRole('group')[i].querySelector('summary')!;
    expect(summaryOf(0)).toHaveTextContent('▾');
    expect(summaryOf(1)).toHaveTextContent('▸');
    fireEvent.click(summaryOf(1));
    expect(screen.getAllByRole('group')[1]).toHaveAttribute('open');
    // jsdom opens the <details> on the click but queues its `toggle` event as
    // a task, so nothing has reached React yet; a browser fires the same
    // event a tick later. Deliver it here so the caret's source is asserted.
    fireEvent(screen.getAllByRole('group')[1], new Event('toggle', { bubbles: true }));
    expect(summaryOf(1)).toHaveTextContent('▾');
    expect(summaryOf(0)).toHaveTextContent('▾');
  });
});
