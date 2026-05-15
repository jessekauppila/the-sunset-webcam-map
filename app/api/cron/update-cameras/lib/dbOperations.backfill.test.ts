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
    await updateSnapshotAiRegressionScore(7, 0.812, 'v4');
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+webcam_snapshots/i);
    expect(q).toMatch(/ai_regression_score/);
    expect(q).toMatch(/ai_model_version_regression/);
    expect(values).toContain(7);
    expect(values).toContain(0.812);
    expect(values).toContain('v4');
  });
});

describe('updateWebcamRegressionScoreFromLatestCustomSnapshot', () => {
  it('copies the latest snapshot score into webcams.ai_rating_regression', async () => {
    sqlMock.mockResolvedValue([]);
    await updateWebcamRegressionScoreFromLatestCustomSnapshot(42);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+webcams/i);
    expect(q).toMatch(/ai_rating_regression/);
    expect(q).toMatch(/order\s+by\s+captured_at\s+desc/i);
    expect(values).toContain(42);
  });
});
