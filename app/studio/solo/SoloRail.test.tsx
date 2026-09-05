import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SoloRail } from './SoloRail';
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { mergeSettings } from '@/app/lib/settings/schema';
import type { StudioSettingsApi } from '../useStudioSettings';

function api(over: Partial<StudioSettingsApi> = {}): StudioSettingsApi {
  return {
    loading: false, studio: undefined, live: undefined, lastPollAt: null, liveRevision: 3,
    effective: (ns) => (ns === 'solo' ? mergeSettings(SOLO_SETTINGS_SCHEMA, {}) : { activeVersion: 'v1', panelPreset: 'dell' }),
    setKnob: vi.fn(), resetSection: vi.fn(), applyNamespace: () => [],
    diffByNamespace: { solo: ['mix'] }, diffCount: 1,
    deploy: async () => {}, revert: async () => {}, deployedAtMs: null, droppedKeys: [],
    deploys: [], loadDeploy: async () => [], relabelDeploy: async () => {}, lastDeployRecorded: null,
    ...over,
  };
}

it('the dials tab renders every glass and bins knob under its group and marks the differing one; caption knobs wait on their tab', () => {
  render(<SoloRail api={api()} deploySlot={<span>DEPLOY</span>} />);
  expect(screen.getByText('DEPLOY')).toBeInTheDocument();
  for (const k of SOLO_SETTINGS_SCHEMA) {
    if (k.section === 'caption') expect(screen.queryByLabelText(k.label)).toBeNull();
    else expect(screen.getByLabelText(k.label)).toBeInTheDocument();
  }
  expect(screen.getByText('mix (sunsets per non-sunset)')).toHaveStyle({ fontWeight: 700 });
  expect(screen.getByText('dwell (s)')).toHaveStyle({ fontWeight: 400 });
  expect(screen.getByRole('tab', { name: 'Dials' })).toHaveAttribute('aria-selected', 'true');
});

it('the caption tab renders every caption knob and nothing else; selects write strings; reset clears the section', () => {
  const a = api({ diffByNamespace: { solo: ['titleGray'] } });
  render(<SoloRail api={a} deploySlot={null} tab="caption" />);
  for (const k of SOLO_SETTINGS_SCHEMA) {
    if (k.section === 'caption') expect(screen.getByLabelText(k.label)).toBeInTheDocument();
    else expect(screen.queryByLabelText(k.label)).toBeNull();
  }
  expect(screen.getByText('title gray (%)')).toHaveStyle({ fontWeight: 700 });
  fireEvent.change(screen.getByLabelText('font'), { target: { value: 'serif' } });
  expect(a.setKnob).toHaveBeenCalledWith('solo', 'font', 'serif');
  fireEvent.change(screen.getByLabelText('title size (px)'), { target: { value: '14' } });
  expect(a.setKnob).toHaveBeenCalledWith('solo', 'titleSize', 14);
  fireEvent.click(screen.getByText('reset caption'));
  expect(a.resetSection).toHaveBeenCalledWith('solo', 'caption');
  expect(screen.queryByText(/reset glass/)).toBeNull();
});

it('clicking a tab reports it', () => {
  const onTab = vi.fn();
  render(<SoloRail api={api()} deploySlot={null} onTab={onTab} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Caption' }));
  expect(onTab).toHaveBeenCalledWith('caption');
});

it('a range change calls setKnob with a number; a checkbox with a boolean', () => {
  const a = api();
  render(<SoloRail api={a} deploySlot={null} />);
  fireEvent.change(screen.getByLabelText('dwell (s)'), { target: { value: '30' } });
  expect(a.setKnob).toHaveBeenCalledWith('solo', 'dwellS', 30);
  fireEvent.click(screen.getByLabelText('scores'));
  expect(a.setKnob).toHaveBeenCalledWith('solo', 'showScores', true);
});

it('reset buttons clear one section each', () => {
  const a = api();
  render(<SoloRail api={a} deploySlot={null} />);
  fireEvent.click(screen.getByText('reset glass'));
  expect(a.resetSection).toHaveBeenCalledWith('solo', 'glass');
});

describe('solo2', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA } = await import('@/app/lib/solo2/settingsSchema');
  const api2 = () => api({
    effective: (ns) => (ns === 'solo2' ? mergeSettings(SOLO2_SETTINGS_SCHEMA, { prelude: true, leadS: 4 }) : { activeVersion: 'solo2', panelPreset: 'ktc-l' }),
    diffByNamespace: { solo2: ['valleys'] },
  });
  it('renders every solo2 knob, selects write strings, and the budget line reads the dials', () => {
    const a = api2();
    const { rerender } = render(<SoloRail api={a} deploySlot={null} version={SOLO_VERSIONS.solo2} />);
    for (const k of SOLO2_SETTINGS_SCHEMA) {
      if (k.section !== 'caption') expect(screen.getByLabelText(k.label)).toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText('camera change'), { target: { value: 'crossfade' } });
    expect(a.setKnob).toHaveBeenCalledWith('solo2', 'transition', 'crossfade');
    fireEvent.change(screen.getByLabelText('valleys per peak'), { target: { value: '2' } });
    expect(a.setKnob).toHaveBeenCalledWith('solo2', 'valleys', 2);
    expect(screen.getByText('prelude 4.5 s + lead 4 s + hold 11.5 s')).toBeInTheDocument();
    expect(screen.getByText(/dials solo2/)).toBeInTheDocument();
    rerender(<SoloRail api={a} deploySlot={null} version={SOLO_VERSIONS.solo2} tab="caption" />);
    for (const k of SOLO2_SETTINGS_SCHEMA) {
      if (k.section === 'caption') expect(screen.getByLabelText(k.label)).toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText('time'), { target: { value: '24h' } });
    expect(a.setKnob).toHaveBeenCalledWith('solo2', 'timeStyle', '24h');
  });
});
