import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { StudioSettingsApi } from './useStudioSettings';
import type { DeployRow } from '@/app/lib/settings/deploys';

vi.mock('@/app/components/mosaic/registry', () => ({
  MOSAIC_VERSIONS: { v1: {} },
  DEFAULT_MOSAIC_VERSION: 'v1',
  MOSAIC_SETTINGS_SCHEMAS: {
    v1: [{ key: 'floorPx', kind: 'number', min: 20, max: 800, step: 10, default: 100, label: 'floor', description: '', section: 's' }],
  },
}));

import { DeployHistory } from './DeployHistory';

const deploys: DeployRow[] = [
  { id: 2, label: 'opening night', namespaces: { v1: { floorPx: 140 } }, deployedAt: '2026-09-05T18:30:00.000Z' },
  { id: 1, label: null, namespaces: {}, deployedAt: '2026-09-05T17:00:00.000Z' },
];

function api(over: Partial<StudioSettingsApi> = {}): StudioSettingsApi {
  return {
    loading: false,
    studio: { namespaces: { v1: { floorPx: 140 } }, revision: 1 },
    live: { namespaces: {}, revision: 1 },
    lastPollAt: null, liveRevision: 1,
    effective: () => ({}), setKnob: vi.fn(), resetSection: vi.fn(), applyNamespace: () => [],
    diffByNamespace: {}, diffCount: 1,
    deploy: async () => {}, revert: async () => {}, deployedAtMs: null, droppedKeys: [],
    deploys, loadDeploy: vi.fn(async () => []), relabelDeploy: vi.fn(async () => {}), lastDeployRecorded: null,
    ...over,
  };
}

describe('DeployHistory', () => {
  it('lists deploys newest first with number, label, summary, and the glass/studio badges', () => {
    render(<DeployHistory api={api()} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('#2');
    expect(rows[0]).toHaveTextContent('opening night');
    expect(rows[0]).toHaveTextContent('floorPx 140');
    expect(rows[0]).toHaveTextContent('studio');
    expect(rows[1]).toHaveTextContent('#1');
    expect(rows[1]).toHaveTextContent('first recorded');
    expect(rows[1]).toHaveTextContent('glass');
    expect(rows[0]).not.toHaveTextContent('glass');
  });

  it('clicking a row loads it into the studio and reports a partial fit', async () => {
    const loadDeploy = vi.fn(async () => [{ namespace: 'v1', key: 'ghost', reason: 'unknown' as const }]);
    render(<DeployHistory api={api({ loadDeploy, deploys: [{ ...deploys[0], namespaces: { v1: { floorPx: 140, ghost: 1 } } }] })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load deploy #2/i })); });
    expect(loadDeploy).toHaveBeenCalledWith(2);
    expect(screen.getByText('loaded, 1 of 2 keys fit the current schema')).toBeInTheDocument();
  });

  it('a 404 on load reads as gone', async () => {
    const loadDeploy = vi.fn(async () => { throw new Error('load deploy failed: 404'); });
    render(<DeployHistory api={api({ loadDeploy })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load deploy #1/i })); });
    expect(screen.getByText('gone')).toBeInTheDocument();
  });

  it('the label is edited inline: Enter saves, Escape cancels', async () => {
    const relabelDeploy = vi.fn(async () => {});
    render(<DeployHistory api={api({ relabelDeploy })} />);
    fireEvent.click(screen.getByRole('button', { name: /label deploy #1/i }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'before the show' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(relabelDeploy).toHaveBeenCalledWith(1, 'before the show');
    fireEvent.click(screen.getByRole('button', { name: /label deploy #2/i }));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(relabelDeploy).toHaveBeenCalledTimes(1);
  });

  it('says when the last deploy was not recorded', () => {
    render(<DeployHistory api={api({ lastDeployRecorded: false })} />);
    expect(screen.getByText(/history not recorded/)).toBeInTheDocument();
  });

  it('renders nothing but the heading when there are no deploys', () => {
    render(<DeployHistory api={api({ deploys: [] })} />);
    expect(screen.getByText('deploys')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
