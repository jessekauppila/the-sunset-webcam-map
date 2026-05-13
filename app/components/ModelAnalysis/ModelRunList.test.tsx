import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelRunList } from './ModelRunList';
import type { ManifestEntry } from '@/app/lib/modelRuns.types';

const runs: ManifestEntry[] = [
  {
    slug: 'newest',
    display_name: 'newest',
    published_at: '2026-05-11T00:00:00Z',
    target_type: 'regression',
    binary_metrics: { val_f1: 0.85 },
    regression_metrics: { pearson_r: 0.82 },
    best_metric_name: 'val_f1',
    best_metric_value: 0.85,
    best_epoch: 7,
    epochs_total: 12,
    early_stopped: true,
    status: 'healthy',
    status_note: 'ok',
  },
  {
    slug: 'older',
    display_name: 'older',
    published_at: '2026-05-01T00:00:00Z',
    target_type: 'binary',
    binary_metrics: { val_f1: 0.78 },
    regression_metrics: {},
    best_metric_name: 'val_f1',
    best_metric_value: 0.78,
    best_epoch: 9,
    epochs_total: 10,
    early_stopped: false,
    status: 'overfit',
    status_note: 'late drift',
  },
];

describe('ModelRunList', () => {
  it('renders one row per run with display name', () => {
    render(<ModelRunList runs={runs} selectedSlug={null} onSelect={() => {}} />);
    expect(screen.getByText('newest')).toBeInTheDocument();
    expect(screen.getByText('older')).toBeInTheDocument();
  });

  it('shows status emoji', () => {
    render(<ModelRunList runs={runs} selectedSlug={null} onSelect={() => {}} />);
    expect(screen.getByText(/🟢/)).toBeInTheDocument();
    expect(screen.getByText(/🟠/)).toBeInTheDocument();
  });

  it('highlights selected run and calls onSelect when another row is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ModelRunList runs={runs} selectedSlug="newest" onSelect={onSelect} />);
    await user.click(screen.getByText('older'));
    expect(onSelect).toHaveBeenCalledWith('older');
  });
});
