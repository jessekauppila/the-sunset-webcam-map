import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMock = vi.fn();
const updateSnapMock = vi.fn();
const syncWebcamMock = vi.fn();
const downloadMock = vi.fn();
const scoreMock = vi.fn();

vi.mock('./dbOperations', () => ({
  findCustomSnapshotsNeedingScore: (...a: unknown[]) => findMock(...a),
  updateSnapshotAiRegressionScore: (...a: unknown[]) => updateSnapMock(...a),
  updateWebcamRegressionScoreFromLatestCustomSnapshot: (...a: unknown[]) =>
    syncWebcamMock(...a),
}));
vi.mock('@/app/lib/webcamSnapshot', () => ({
  downloadImage: (...a: unknown[]) => downloadMock(...a),
}));
vi.mock('./aiScoring', async (importOriginal) => {
  const real = await importOriginal<typeof import('./aiScoring')>();
  return {
    scoreImage: (...a: unknown[]) => scoreMock(...a),
    computeDisagreementKind: real.computeDisagreementKind,
  };
});

import { backfillCustomSnapshotScores } from './customBackfill';

beforeEach(() => {
  findMock.mockReset();
  updateSnapMock.mockReset().mockResolvedValue(undefined);
  syncWebcamMock.mockReset().mockResolvedValue(undefined);
  downloadMock.mockReset();
  scoreMock.mockReset();
});

describe('backfillCustomSnapshotScores', () => {
  it('returns zero counts when there are no null-score snapshots', async () => {
    findMock.mockResolvedValue([]);
    const result = await backfillCustomSnapshotScores({ limit: 50 });
    expect(result).toEqual({ scored: 0, failed: 0, modelVersion: null, scores: [] });
    expect(downloadMock).not.toHaveBeenCalled();
    expect(updateSnapMock).not.toHaveBeenCalled();
  });

  it('scores each snapshot and syncs the parent webcam', async () => {
    findMock.mockResolvedValue([
      { snapshotId: 11, webcamId: 42, firebaseUrl: 'https://x/1.jpg' },
      { snapshotId: 12, webcamId: 42, firebaseUrl: 'https://x/2.jpg' },
    ]);
    downloadMock.mockResolvedValue(Buffer.from('jpg'));
    scoreMock.mockResolvedValue({
      rawScore: 0.82,
      aiRating: 4.1,
      modelVersion: 'v4',
      imageHash: 'h',
      source: 'custom',
      pathTaken: 'onnx',
    });

    const result = await backfillCustomSnapshotScores({ limit: 50 });

    expect(result.scored).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.modelVersion).toBe('v4');
    expect(result.scores).toEqual([0.82, 0.82]);
    expect(updateSnapMock).toHaveBeenCalledTimes(2);
    expect(updateSnapMock).toHaveBeenCalledWith(11, 0.82, 'v4', 'onnx', null);
    expect(updateSnapMock).toHaveBeenCalledWith(12, 0.82, 'v4', 'onnx', null);
    // Webcam sync runs once per unique webcam_id (42 appears twice -> 1 call).
    expect(syncWebcamMock).toHaveBeenCalledTimes(1);
    expect(syncWebcamMock).toHaveBeenCalledWith(42);
  });

  it('does NOT write a score for an unscored snapshot and does not sync the webcam', async () => {
    findMock.mockResolvedValue([
      { snapshotId: 11, webcamId: 42, firebaseUrl: 'https://x/1.jpg' },
    ]);
    downloadMock.mockResolvedValue(Buffer.from('jpg'));
    scoreMock.mockResolvedValue({
      rawScore: null,
      aiRating: null,
      modelVersion: 'v4',
      imageHash: 'h',
      source: 'custom',
      pathTaken: 'unscored',
    });

    const result = await backfillCustomSnapshotScores({ limit: 10 });

    expect(updateSnapMock).not.toHaveBeenCalled();
    expect(syncWebcamMock).not.toHaveBeenCalled();
    expect(result.scored).toBe(0);
    expect(result.scores).toEqual([]);
  });

  it('counts a download failure as `failed` and continues with other rows', async () => {
    findMock.mockResolvedValue([
      { snapshotId: 11, webcamId: 42, firebaseUrl: 'https://x/1.jpg' },
      { snapshotId: 12, webcamId: 43, firebaseUrl: 'https://x/2.jpg' },
    ]);
    downloadMock
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce(Buffer.from('jpg'));
    scoreMock.mockResolvedValue({
      rawScore: 0.5, aiRating: 2.5, modelVersion: 'v4',
      imageHash: 'h', source: 'custom', pathTaken: 'onnx',
    });

    const result = await backfillCustomSnapshotScores({ limit: 50 });

    expect(result.scored).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.scores).toEqual([0.5]);
    expect(syncWebcamMock).toHaveBeenCalledWith(43);
    expect(syncWebcamMock).not.toHaveBeenCalledWith(42);
  });
});
