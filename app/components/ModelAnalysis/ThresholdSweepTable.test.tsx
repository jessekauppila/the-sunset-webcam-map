// app/components/ModelAnalysis/ThresholdSweepTable.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThresholdSweepTable } from './ThresholdSweepTable';
import type { RunIndex } from '@/app/lib/modelRuns.types';

const baseIndex: RunIndex = {
  schema_version: 1,
  slug: 'r',
  display_name: 'r',
  published_at: '2026-05-12T00:00:00Z',
  config_summary: {
    model: 'resnet18',
    target_type: 'regression',
    epochs_configured: 30,
    lr_schedule: 'cosine',
    early_stopping_patience: 5,
    head_dropout: 0.3,
    class_weighting: 'none',
    label_source: 'llm',
  },
  metrics: { best_epoch: 1, epochs_completed: 1, early_stopped_epoch: null },
  diagnosis: { status: 'healthy', note: '' },
  data: {
    train_samples: 1, val_samples: 1, test_samples: 1,
    class_balance: { negative: null, positive: null, ratio: null },
  },
  assets: {
    loss_curves_png: 'plots/loss_curves.png',
    label_distribution_png: 'plots/label_distribution.png',
    config_yaml: 'config.yaml',
    failure_gallery_json: 'failure_gallery.json',
  },
};

describe('ThresholdSweepTable', () => {
  it('renders nothing when no sweep is present', () => {
    const { container } = render(<ThresholdSweepTable index={baseIndex} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a row per threshold with best/deployed badges', () => {
    const idx: RunIndex = {
      ...baseIndex,
      threshold_sweep: [
        { threshold: 0.30, precision: 0.90, recall: 0.66, f1: 0.76 },
        { threshold: 0.45, precision: 0.96, recall: 0.35, f1: 0.52 },
      ],
      best_threshold: { threshold: 0.30, precision: 0.90, recall: 0.66, f1: 0.76 },
      decision_threshold: 0.45,
    };
    render(<ThresholdSweepTable index={idx} />);
    expect(screen.getAllByText('0.30').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.45').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/best f1/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/deployed/i).length).toBeGreaterThan(0);
  });
});
