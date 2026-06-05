import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  findArchiveSnapshotsNeedingScore,
  countArchiveSnapshotsNeedingScore,
  updateSnapshotModelScores,
  markSnapshotDeadUrl,
  updateWebcamRegressionScoreFromLatestCustomSnapshot,
} from './dbOperations';

beforeEach(() => sqlMock.mockReset());

describe('findArchiveSnapshotsNeedingScore', () => {
  it('selects unscored, non-dead-url snapshots and maps the row shape', async () => {
    sqlMock.mockResolvedValue([
      {
        snapshot_id: 1,
        webcam_id: 42,
        firebase_url: 'https://x/1.jpg',
        source: 'windy',
        llm_quality: '0.812', // NUMERIC comes back as a string
        llm_is_sunset: true,
      },
    ]);
    const rows = await findArchiveSnapshotsNeedingScore(50, {
      includeAllSources: true,
    });
    expect(rows).toEqual([
      {
        snapshotId: 1,
        webcamId: 42,
        firebaseUrl: 'https://x/1.jpg',
        source: 'windy',
        llmQuality: 0.812, // coerced to number
        llmIsSunset: true,
      },
    ]);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/ai_regression_score\s+is\s+null/i);
    expect(q).toMatch(/scoring_state\s+is\s+distinct\s+from\s+'dead-url'/i);
    expect(q).toMatch(/or\s+w\.source\s*=\s*'custom'/i);
    expect(q).toMatch(/limit/i);
    // includeAllSources=true is interpolated as the OR-gate boolean.
    expect(values).toContain(true);
    expect(values).toContain(50);
  });

  it('defaults to custom-only (the OR-gate boolean is false)', async () => {
    sqlMock.mockResolvedValue([]);
    await findArchiveSnapshotsNeedingScore(10);
    const [, ...values] = sqlMock.mock.calls[0];
    expect(values).toContain(false);
  });

  it('coerces a null llm_quality to null, not NaN', async () => {
    sqlMock.mockResolvedValue([
      {
        snapshot_id: 2,
        webcam_id: 7,
        firebase_url: 'https://x/2.jpg',
        source: 'custom',
        llm_quality: null,
        llm_is_sunset: null,
      },
    ]);
    const [row] = await findArchiveSnapshotsNeedingScore(10);
    expect(row.llmQuality).toBeNull();
    expect(row.llmIsSunset).toBeNull();
  });
});

describe('countArchiveSnapshotsNeedingScore', () => {
  it('returns the integer count', async () => {
    sqlMock.mockResolvedValue([{ n: 33099 }]);
    expect(await countArchiveSnapshotsNeedingScore({ includeAllSources: true })).toBe(
      33099,
    );
  });

  it('returns 0 when the result is empty', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await countArchiveSnapshotsNeedingScore()).toBe(0);
  });
});

describe('updateSnapshotModelScores', () => {
  it('writes all three judge columns, the disagreement kind, and stamps disagreement_computed_at', async () => {
    sqlMock.mockResolvedValue([]);
    await updateSnapshotModelScores({
      snapshotId: 7,
      regressionScore: 0.812,
      regressionModelVersion: 'v4_reg',
      binaryScore: 0.91,
      binaryIsSunset: true,
      binaryModelVersion: 'v4_bin',
      scoringPath: 'onnx',
      disagreementKind: 'model_low_claude_sunset',
    });
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+webcam_snapshots/i);
    expect(q).toMatch(/ai_regression_score/);
    expect(q).toMatch(/ai_binary_score/);
    expect(q).toMatch(/ai_binary_is_sunset/);
    expect(q).toMatch(/ai_model_version_binary/);
    expect(q).toMatch(/scoring_path/);
    expect(q).toMatch(/model_disagreement_kind/);
    expect(q).toMatch(/disagreement_computed_at\s*=\s*now\(\)/i);
    // Must NOT overwrite the junk legacy ai_rating column.
    expect(q).not.toMatch(/\bai_rating\s*=/);
    expect(values).toContain(7);
    expect(values).toContain(0.812);
    expect(values).toContain('model_low_claude_sunset');
  });
});

describe('markSnapshotDeadUrl', () => {
  it("sets scoring_state='dead-url' so the finder excludes the row", async () => {
    sqlMock.mockResolvedValue([]);
    await markSnapshotDeadUrl(99);
    const [strings, ...values] = sqlMock.mock.calls[0];
    const q = strings.join('?');
    expect(q).toMatch(/update\s+webcam_snapshots/i);
    expect(q).toMatch(/scoring_state\s*=\s*'dead-url'/i);
    expect(values).toContain(99);
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
    expect(q).toMatch(/ai_rating_regression\s*=\s*1\s*\+\s*ls\.ai_regression_score\s*\*\s*4/i);
    expect(q).not.toMatch(/ai_rating_regression\s*=\s*ls\.ai_regression_score\s*,/i);
  });
});
