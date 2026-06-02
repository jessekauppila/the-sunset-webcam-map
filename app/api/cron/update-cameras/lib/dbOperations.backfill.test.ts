import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  findCustomSnapshotsNeedingScore,
  updateSnapshotAiRegressionScore,
  updateWebcamRegressionScoreFromLatestCustomSnapshot,
} from './dbOperations';

beforeEach(() => sqlMock.mockReset());

describe('findCustomSnapshotsNeedingScore', () => {
  it('selects snapshots with NULL ai_regression_score for custom-source webcams', async () => {
    sqlMock.mockResolvedValue([
      { snapshot_id: 1, webcam_id: 42, firebase_url: 'https://x/1.jpg' },
    ]);
    const rows = await findCustomSnapshotsNeedingScore(50);
    expect(rows).toEqual([
      { snapshotId: 1, webcamId: 42, firebaseUrl: 'https://x/1.jpg' },
    ]);
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/ai_regression_score\s+is\s+null/i);
    expect(q).toMatch(/source\s*=\s*'custom'/i);
    expect(q).toMatch(/limit/i);
  });
});

describe('updateSnapshotAiRegressionScore', () => {
  it('writes ai_regression_score + ai_model_version_regression for a snapshot id', async () => {
    sqlMock.mockResolvedValue([]);
    await updateSnapshotAiRegressionScore(7, 0.812, 'v4', 'onnx', null);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+webcam_snapshots/i);
    expect(q).toMatch(/ai_regression_score/);
    expect(q).toMatch(/ai_model_version_regression/);
    expect(q).toMatch(/model_disagreement_kind/);
    expect(values).toContain(7);
    expect(values).toContain(0.812);
    expect(values).toContain('v4');
  });

  it('also writes scoring_path so contaminated rows are queryable later', async () => {
    sqlMock.mockResolvedValue([]);
    await updateSnapshotAiRegressionScore(7, 0.812, 'v4', 'onnx', null);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/scoring_path/);
    expect(values).toContain('onnx');
  });

  it('persists baseline-fallback when the scoring path was a fallback', async () => {
    sqlMock.mockResolvedValue([]);
    await updateSnapshotAiRegressionScore(7, 0.5, 'v4', 'baseline-fallback', null);
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain('baseline-fallback');
  });

  it('writes the disagreement kind when one is provided', async () => {
    sqlMock.mockResolvedValue([]);
    await updateSnapshotAiRegressionScore(
      7,
      0.812,
      'v4',
      'onnx',
      'binary_negative_regression_high',
    );
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain('binary_negative_regression_high');
  });
});

describe('updateWebcamRegressionScoreFromLatestCustomSnapshot', () => {
  it('writes the latest snapshot score into webcams.ai_rating_regression', async () => {
    sqlMock.mockResolvedValue([]);
    await updateWebcamRegressionScoreFromLatestCustomSnapshot(42);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+webcams/i);
    expect(q).toMatch(/ai_rating_regression/);
    expect(q).toMatch(/order\s+by\s+captured_at\s+desc/i);
    expect(values).toContain(42);
  });

  it('maps the raw [0,1] snapshot score to the 1-5 display scale (1 + raw*4)', async () => {
    sqlMock.mockResolvedValue([]);
    await updateWebcamRegressionScoreFromLatestCustomSnapshot(42);
    const [strings] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    // The display column must be set from the mapping formula, not the
    // raw score. Catches regressions like the 0.21/5 popup display bug.
    expect(q).toMatch(/ai_rating_regression\s*=\s*1\s*\+\s*ls\.ai_regression_score\s*\*\s*4/i);
    expect(q).not.toMatch(/ai_rating_regression\s*=\s*ls\.ai_regression_score\s*,/i);
  });
});
