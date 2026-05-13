// app/components/ModelAnalysis/ModelRunSummaryCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelRunSummaryCard } from './ModelRunSummaryCard';
import type { ManifestEntry } from '@/app/lib/modelRuns.types';

const run: ManifestEntry = {
  slug: 'reg_a',
  display_name: 'reg_a',
  published_at: '2026-05-11T00:00:00Z',
  target_type: 'regression',
  binary_metrics: { val_f1: 0.85 },
  regression_metrics: { pearson_r: 0.82, val_mse: 0.04 },
  best_metric_name: 'val_f1',
  best_metric_value: 0.85,
  best_epoch: 7, epochs_total: 12, early_stopped: true,
  status: 'healthy', status_note: 'fine',
};

describe('ModelRunSummaryCard', () => {
  it('renders the run name and key metrics', () => {
    render(<ModelRunSummaryCard run={run} />);
    expect(screen.getByText('reg_a')).toBeInTheDocument();
    expect(screen.getByText('0.850')).toBeInTheDocument();
    expect(screen.getByText(/0\.82/)).toBeInTheDocument();
  });

  it('renders a link to /models/<slug>', () => {
    render(<ModelRunSummaryCard run={run} />);
    const link = screen.getByRole('link', { name: /open full view/i });
    expect(link.getAttribute('href')).toBe('/models/reg_a');
  });
});
