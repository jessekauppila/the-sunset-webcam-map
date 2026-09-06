import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
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
  { id: 2, label: 'opening night', namespaces: { v1: { floorPx: 140 } }, deployedAt: '2026-09-05T18:30:00.000Z', createdAt: '2026-09-05T18:30:00.000Z' },
  { id: 1, label: null, namespaces: {}, deployedAt: '2026-09-05T17:00:00.000Z', createdAt: '2026-09-05T17:00:00.000Z' },
];

function api(over: Partial<StudioSettingsApi> = {}): StudioSettingsApi {
  return {
    loading: false,
    studio: { namespaces: { v1: { floorPx: 140 } }, revision: 1 },
    live: { namespaces: {}, revision: 1 },
    lastPollAt: null, liveRevision: 1,
    effective: () => ({}), setKnob: vi.fn(), resetSection: vi.fn(), applyNamespace: () => [],
    diffByNamespace: {}, diffCount: 1,
    deploy: async () => {}, revert: async () => {}, saveTake: vi.fn(async () => null), deployedAtMs: null, droppedKeys: [],
    deploys, loadDeploy: vi.fn(async () => []), relabelDeploy: vi.fn(async () => {}), lastDeployRecorded: null,
    ...over,
  };
}

/** The list is a controlled surface now: `saving` opens the label field. */
function list(over: Partial<StudioSettingsApi> = {}, saving = false, onSavingChange = vi.fn()) {
  return { onSavingChange, ...render(<DeployHistory api={api(over)} saving={saving} onSavingChange={onSavingChange} />) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DeployHistory', () => {
  it('lists takes newest first with number, label, summary, and the live/in studio badges', () => {
    list();
    expect(screen.getByText('takes')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('#2');
    expect(rows[0]).toHaveTextContent('opening night');
    expect(rows[0]).toHaveTextContent('floorPx 140');
    expect(within(rows[0]).getByText('in studio')).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent('#1');
    expect(rows[1]).toHaveTextContent('first recorded');
    expect(within(rows[1]).getByText('live')).toBeInTheDocument();
    expect(within(rows[0]).queryByText('live')).toBeNull();
  });

  it('badges each of the four states, and live replaces deployed on the row the glass is running', () => {
    const badgeRows: DeployRow[] = [
      // saved, and different from everything
      { id: 4, label: null, namespaces: { v1: { floorPx: 200 } }, deployedAt: null, createdAt: '2026-09-05T19:00:00.000Z' },
      // saved and equal to the studio profile
      { id: 3, label: null, namespaces: { v1: { floorPx: 140 } }, deployedAt: null, createdAt: '2026-09-05T18:45:00.000Z' },
      // deployed, but not what the glass is running
      { id: 2, label: null, namespaces: { v1: { floorPx: 180 } }, deployedAt: '2026-09-05T18:30:00.000Z', createdAt: '2026-09-05T18:30:00.000Z' },
      // deployed and equal to the live profile
      { id: 1, label: null, namespaces: {}, deployedAt: '2026-09-05T17:00:00.000Z', createdAt: '2026-09-05T17:00:00.000Z' },
    ];
    list({ deploys: badgeRows });
    const rows = screen.getAllByRole('listitem');
    const badges = (i: number) => ['live', 'deployed', 'saved', 'in studio']
      .filter((name) => within(rows[i]).queryByText(name) !== null);
    expect(badges(0)).toEqual(['saved']);
    expect(badges(1)).toEqual(['saved', 'in studio']);
    expect(badges(2)).toEqual(['deployed']);
    expect(badges(3)).toEqual(['live']);
  });

  it('clicking a row loads it into the studio and reports a partial fit', async () => {
    const loadDeploy = vi.fn(async () => [{ namespace: 'v1', key: 'ghost', reason: 'unknown' as const }]);
    list({ loadDeploy, deploys: [{ ...deploys[0], namespaces: { v1: { floorPx: 140, ghost: 1 } } }] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load deploy #2/i })); });
    expect(loadDeploy).toHaveBeenCalledWith(2);
    expect(screen.getByText('loaded, 1 of 2 keys fit the current schema')).toBeInTheDocument();
  });

  it('a 404 on load reads as gone', async () => {
    const loadDeploy = vi.fn(async () => { throw new Error('load deploy failed: 404'); });
    list({ loadDeploy });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /load deploy #1/i })); });
    expect(screen.getByText('gone')).toBeInTheDocument();
  });

  it('the label is edited inline: Enter saves, Escape cancels', async () => {
    const relabelDeploy = vi.fn(async () => {});
    list({ relabelDeploy });
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
    list({ lastDeployRecorded: false });
    expect(screen.getByText(/history not recorded/)).toBeInTheDocument();
  });

  it('renders nothing but the heading when there are no takes', () => {
    list({ deploys: [] });
    expect(screen.getByText('takes')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('DeployHistory — saving a take', () => {
  it('shows no label field until the header asks for one', () => {
    list();
    expect(screen.queryByLabelText('label for the new take')).toBeNull();
  });

  it('autofocuses the label field and saves the trimmed label on Enter', async () => {
    const saveTake = vi.fn(async () => deploys[0]);
    const { onSavingChange } = list({ saveTake, studio: { namespaces: {}, revision: 1 } }, true);
    const input = screen.getByLabelText('label for the new take');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('maxLength', '60');
    fireEvent.change(input, { target: { value: '  dusk over the sound  ' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(saveTake).toHaveBeenCalledWith('dusk over the sound');
    expect(onSavingChange).toHaveBeenCalledWith(false);
  });

  it('saves an unlabelled take when the field is left blank', async () => {
    const saveTake = vi.fn(async () => deploys[0]);
    list({ saveTake, studio: { namespaces: {}, revision: 1 } }, true);
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('label for the new take'), { key: 'Enter' }); });
    expect(saveTake).toHaveBeenCalledWith(null);
  });

  it('Escape closes the field without saving', () => {
    const saveTake = vi.fn(async () => deploys[0]);
    const { onSavingChange } = list({ saveTake }, true);
    fireEvent.keyDown(screen.getByLabelText('label for the new take'), { key: 'Escape' });
    expect(saveTake).not.toHaveBeenCalled();
    expect(onSavingChange).toHaveBeenCalledWith(false);
  });

  it('still saves when the dials already equal the newest take, and says so for a few seconds', async () => {
    vi.useFakeTimers();
    // The default api(): studio equals #2's namespaces, so this is the duplicate.
    const saveTake = vi.fn(async () => ({ ...deploys[0], id: 3, deployedAt: null }));
    list({ saveTake }, true);
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('label for the new take'), { key: 'Enter' }); });
    expect(saveTake).toHaveBeenCalledTimes(1);
    expect(screen.getByText('same as #2')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText('same as #2')).toBeNull();
  });

  it('says nothing about duplicates when the dials differ from the newest take', async () => {
    const saveTake = vi.fn(async () => ({ ...deploys[0], id: 3, deployedAt: null }));
    list({ saveTake, studio: { namespaces: { v1: { floorPx: 999 } }, revision: 1 } }, true);
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('label for the new take'), { key: 'Enter' }); });
    expect(screen.queryByText(/same as/)).toBeNull();
  });

  it('reports a take the server did not record', async () => {
    const saveTake = vi.fn(async () => null);
    list({ saveTake }, true);
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('label for the new take'), { key: 'Enter' }); });
    expect(screen.getByText('take not recorded')).toBeInTheDocument();
  });

  it('reports a save that threw', async () => {
    const saveTake = vi.fn(async () => { throw new Error('save take failed: 503'); });
    const { onSavingChange } = list({ saveTake }, true);
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('label for the new take'), { key: 'Enter' }); });
    expect(screen.getByText('take not recorded')).toBeInTheDocument();
    expect(onSavingChange).toHaveBeenCalledWith(false);
  });
});
