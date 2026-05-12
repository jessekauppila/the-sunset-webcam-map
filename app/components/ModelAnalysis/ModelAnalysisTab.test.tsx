// app/components/ModelAnalysis/ModelAnalysisTab.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelAnalysisTab } from './ModelAnalysisTab';
import type { ManifestEntry } from '@/app/lib/modelRuns.types';

const runs: ManifestEntry[] = [{
  slug: 'r1', display_name: 'r1',
  published_at: '2026-05-11T00:00:00Z',
  target_type: 'regression',
  binary_metrics: { val_f1: 0.8 },
  regression_metrics: { pearson_r: 0.8 },
  best_metric_name: 'val_f1', best_metric_value: 0.8,
  best_epoch: 5, epochs_total: 10, early_stopped: false,
  status: 'healthy', status_note: '',
}];

describe('ModelAnalysisTab', () => {
  it('shows the leaderboard by default', () => {
    render(<ModelAnalysisTab runs={runs} />);
    expect(screen.getByText(/leaderboard/i)).toBeInTheDocument();
  });

  it('switches to summary card when a run is clicked', async () => {
    const user = userEvent.setup();
    render(<ModelAnalysisTab runs={runs} />);
    // 'r1' appears in both the sidebar and the leaderboard table — click the
    // sidebar entry (first in DOM order).
    await user.click(screen.getAllByText('r1')[0]);
    expect(screen.getByRole('link', { name: /open full view/i })).toBeInTheDocument();
  });

  it('renders an empty state with the "What is this?" plaque when there are no runs', () => {
    render(<ModelAnalysisTab runs={[]} />);
    expect(screen.getByText(/no published runs yet/i)).toBeInTheDocument();
    expect(screen.getByText(/what is this\?/i)).toBeInTheDocument();
  });
});
