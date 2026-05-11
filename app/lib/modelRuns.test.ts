import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readManifest,
  readRunIndex,
  readFailureGallery,
  listRunSlugs,
  __setPublicDirForTesting,
} from './modelRuns';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mlruns-'));
  fs.mkdirSync(path.join(tmpRoot, 'public', 'ml-runs', 'run_a'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(tmpRoot, 'public', 'ml-runs', '_manifest.json'),
    JSON.stringify({
      schema_version: 1,
      generated_at: '2026-05-11T00:00:00Z',
      runs: [
        {
          slug: 'run_a',
          display_name: 'run_a',
          published_at: '2026-05-10T00:00:00Z',
          target_type: 'regression',
          binary_metrics: { val_f1: 0.847 },
          regression_metrics: { pearson_r: 0.82, val_mse: 0.041 },
          best_metric_name: 'val_f1',
          best_metric_value: 0.847,
          best_epoch: 7,
          epochs_total: 12,
          early_stopped: true,
          status: 'healthy',
          status_note: 'fine',
        },
      ],
    })
  );
  fs.writeFileSync(
    path.join(tmpRoot, 'public', 'ml-runs', 'run_a', 'index.json'),
    JSON.stringify({
      schema_version: 1,
      slug: 'run_a',
      display_name: 'run_a',
      published_at: '2026-05-10T00:00:00Z',
      config_summary: { target_type: 'regression' },
      metrics: { best_f1: 0.847, pearson_r: 0.82 },
      diagnosis: { status: 'healthy', note: 'fine' },
      data: {},
      assets: {
        loss_curves_png: 'plots/loss_curves.png',
        label_distribution_png: 'plots/label_distribution.png',
        config_yaml: 'config.yaml',
        failure_gallery_json: 'failure_gallery.json',
      },
    })
  );
  fs.writeFileSync(
    path.join(tmpRoot, 'public', 'ml-runs', 'run_a', 'failure_gallery.json'),
    JSON.stringify({
      schema_version: 1,
      generated_at: '2026-05-10T00:00:00Z',
      split: 'val',
      target_type: 'regression',
      items: [
        {
          snapshot_id: 's1',
          webcam_id: 1,
          image_url: 'https://x/y.jpg',
          true_label: 0.9,
          predicted_score: 0.2,
          absolute_error: 0.7,
          captured_at: null,
          llm_explanation: null,
        },
      ],
    })
  );
  __setPublicDirForTesting(path.join(tmpRoot, 'public'));
});

afterEach(() => {
  __setPublicDirForTesting(null);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('modelRuns data layer', () => {
  it('readManifest parses runs', () => {
    const m = readManifest();
    expect(m.runs).toHaveLength(1);
    expect(m.runs[0].slug).toBe('run_a');
  });

  it('readRunIndex returns the run-specific index', () => {
    const idx = readRunIndex('run_a');
    expect(idx?.slug).toBe('run_a');
    expect(idx?.metrics.best_f1).toBe(0.847);
  });

  it('readRunIndex returns null for missing slug', () => {
    expect(readRunIndex('does_not_exist')).toBeNull();
  });

  it('readFailureGallery parses items', () => {
    const fg = readFailureGallery('run_a');
    expect(fg?.items).toHaveLength(1);
    expect(fg?.items[0].snapshot_id).toBe('s1');
  });

  it('listRunSlugs returns slugs from manifest', () => {
    expect(listRunSlugs()).toEqual(['run_a']);
  });

  it('returns empty manifest when files are missing', () => {
    __setPublicDirForTesting(path.join(tmpRoot, 'does_not_exist'));
    const m = readManifest();
    expect(m.runs).toEqual([]);
  });
});
