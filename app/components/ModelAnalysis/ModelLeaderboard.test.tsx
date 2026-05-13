import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelLeaderboard } from './ModelLeaderboard';
import type { ManifestEntry } from '@/app/lib/modelRuns.types';

const runs: ManifestEntry[] = [
  {
    slug: 'reg_a',
    display_name: 'reg_a',
    published_at: '2026-05-11T00:00:00Z',
    target_type: 'regression',
    binary_metrics: { val_f1: 0.85 },
    regression_metrics: { pearson_r: 0.82, val_mse: 0.04 },
    best_metric_name: 'val_f1',
    best_metric_value: 0.85,
    best_epoch: 7, epochs_total: 12, early_stopped: true,
    status: 'healthy', status_note: '',
  },
  {
    slug: 'bin_b',
    display_name: 'bin_b',
    published_at: '2026-05-09T00:00:00Z',
    target_type: 'binary',
    binary_metrics: { val_f1: 0.78, val_precision: 0.75, val_recall: 0.82 },
    regression_metrics: {},
    best_metric_name: 'val_f1',
    best_metric_value: 0.78,
    best_epoch: 9, epochs_total: 10, early_stopped: false,
    status: 'overfit', status_note: '',
  },
];

beforeEach(() => localStorage.clear());

describe('ModelLeaderboard', () => {
  it('shows binary columns by default and sorts by F1', () => {
    render(<ModelLeaderboard runs={runs} onSelect={() => {}} />);
    const rows = screen.getAllByRole('row');
    // header + 2 data rows
    expect(rows).toHaveLength(3);
    const first = within(rows[1]).getAllByRole('cell');
    expect(first[1].textContent).toContain('reg_a');
  });

  it('switches columns when regression toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<ModelLeaderboard runs={runs} onSelect={() => {}} />);
    await user.click(screen.getByRole('button', { name: /regression/i }));
    expect(screen.getByText(/pearson/i)).toBeInTheDocument();
  });

  it('grays out runs missing the selected metric group', async () => {
    const user = userEvent.setup();
    render(<ModelLeaderboard runs={runs} onSelect={() => {}} />);
    await user.click(screen.getByRole('button', { name: /regression/i }));
    expect(screen.getByText('bin_b').closest('tr')!.className).toMatch(/dimmed/);
  });

  it('persists the active group in localStorage', async () => {
    const user = userEvent.setup();
    render(<ModelLeaderboard runs={runs} onSelect={() => {}} />);
    await user.click(screen.getByRole('button', { name: /regression/i }));
    expect(localStorage.getItem('model-analysis-metric-group')).toBe('regression');
  });
});
