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
