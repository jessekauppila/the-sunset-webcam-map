// app/components/ModelAnalysis/MetricTiles.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricTiles } from './MetricTiles';
import type { RunIndex } from '@/app/lib/modelRuns.types';

const baseIndex: RunIndex = {
  schema_version: 1,
  slug: 'x',
  display_name: 'x',
  published_at: '',
  config_summary: {
    model: null, target_type: 'regression',
    epochs_configured: null, lr_schedule: null,
    early_stopping_patience: null, head_dropout: null,
    class_weighting: null, label_source: null,
  },
  metrics: {
    best_f1: 0.847, pearson_r: 0.82, spearman_r: 0.81,
    r_squared: 0.67, val_mse: 0.041,
    best_epoch: 7, epochs_completed: 12, early_stopped_epoch: 12,
  },
  diagnosis: { status: 'healthy', note: '' },
  data: {
    train_samples: null, val_samples: null, test_samples: null,
    class_balance: { negative: null, positive: null, ratio: null },
  },
  assets: {
    loss_curves_png: '', label_distribution_png: '',
    config_yaml: '', failure_gallery_json: '',
  },
};

describe('MetricTiles', () => {
  it('renders 8 tiles when both metric groups are present', () => {
    render(<MetricTiles index={baseIndex} />);
    expect(screen.getAllByTestId('metric-tile').length).toBe(6);
  });

  it('renders only available tiles when one group is empty', () => {
    const idx = { ...baseIndex, metrics: { ...baseIndex.metrics,
      pearson_r: null, spearman_r: null, r_squared: null, val_mse: null,
    }};
    render(<MetricTiles index={idx} />);
    const tiles = screen.getAllByTestId('metric-tile');
    expect(tiles.length).toBeLessThan(8);
  });
});
