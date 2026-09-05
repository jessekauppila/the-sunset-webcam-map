import { it, expect, vi } from 'vitest';
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

it('renders every solo knob under its group and marks the differing one', () => {
  render(<SoloRail api={api()} deploySlot={<span>DEPLOY</span>} />);
  expect(screen.getByText('DEPLOY')).toBeInTheDocument();
  for (const k of SOLO_SETTINGS_SCHEMA) expect(screen.getByLabelText(k.label)).toBeInTheDocument();
  expect(screen.getByText('mix (sunsets per non-sunset)')).toHaveStyle({ fontWeight: 700 });
  expect(screen.getByText('dwell (s)')).toHaveStyle({ fontWeight: 400 });
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
