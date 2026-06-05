import { describe, it, expect, vi, beforeEach } from 'vitest';

const downloadImageMock = vi.fn();
const scoreImageMock = vi.fn();
const findRowsMock = vi.fn();
const writeScoresMock = vi.fn();
const syncWebcamMock = vi.fn();
const markDeadUrlMock = vi.fn();

vi.mock('@/app/lib/webcamSnapshot', () => ({
  downloadImage: (...a: unknown[]) => downloadImageMock(...a),
}));

// Keep the real computeDisagreementKind; mock only scoreImage.
vi.mock('./aiScoring', async (importActual) => {
  const actual = await importActual<typeof import('./aiScoring')>();
  return { ...actual, scoreImage: (...a: unknown[]) => scoreImageMock(...a) };
});

vi.mock('./dbOperations', () => ({
  findArchiveSnapshotsNeedingScore: (...a: unknown[]) => findRowsMock(...a),
  updateSnapshotModelScores: (...a: unknown[]) => writeScoresMock(...a),
  updateWebcamRegressionScoreFromLatestCustomSnapshot: (...a: unknown[]) =>
    syncWebcamMock(...a),
  markSnapshotDeadUrl: (...a: unknown[]) => markDeadUrlMock(...a),
}));

import { backfillArchiveSnapshotScores } from './archiveBackfill';

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  snapshotId: 1,
  webcamId: 42,
  firebaseUrl: 'https://x/1.jpg',
  source: 'windy',
  llmQuality: null,
  llmIsSunset: null,
  ...over,
});

const onnxResult = (over: Partial<Record<string, unknown>> = {}) => ({
  rawScore: 0.7,
  aiRating: 3.8,
  modelVersion: 'v4_reg',
  imageHash: 'h',
  source: 'windy',
  pathTaken: 'onnx',
  binaryRawScore: 0.9,
  binaryIsSunset: true,
  binaryModelVersion: 'v4_bin',
  ...over,
});

beforeEach(() => {
  downloadImageMock.mockReset().mockResolvedValue(Buffer.from('jpg'));
  scoreImageMock.mockReset().mockResolvedValue(onnxResult());
  findRowsMock.mockReset();
  writeScoresMock.mockReset().mockResolvedValue(undefined);
  syncWebcamMock.mockReset().mockResolvedValue(undefined);
  markDeadUrlMock.mockReset().mockResolvedValue(undefined);
});

describe('backfillArchiveSnapshotScores', () => {
  it('returns zeros and does no work when nothing needs scoring', async () => {
    findRowsMock.mockResolvedValue([]);
    const r = await backfillArchiveSnapshotScores({ limit: 50 });
    expect(r.scored).toBe(0);
    expect(writeScoresMock).not.toHaveBeenCalled();
  });

  it('scores a row via the real ONNX path and persists all judge columns', async () => {
    findRowsMock.mockResolvedValue([row()]);
    const r = await backfillArchiveSnapshotScores({ limit: 50 });
    expect(r.scored).toBe(1);
    expect(writeScoresMock).toHaveBeenCalledTimes(1);
    expect(writeScoresMock.mock.calls[0][0]).toMatchObject({
      snapshotId: 1,
      regressionScore: 0.7,
      binaryScore: 0.9,
      binaryIsSunset: true,
    });
  });

  it('computes the model-vs-Claude disagreement from the row’s Claude fields', async () => {
    findRowsMock.mockResolvedValue([
      row({ llmQuality: 0.8, llmIsSunset: true }),
    ]);
    // model rated it low → miss vs a confident-good Claude verdict.
    scoreImageMock.mockResolvedValue(onnxResult({ aiRating: 2.0, binaryIsSunset: undefined }));
    await backfillArchiveSnapshotScores({ limit: 50 });
    expect(writeScoresMock.mock.calls[0][0].disagreementKind).toBe(
      'model_low_claude_sunset',
    );
  });

  it('ABORTS without writing when scoreImage falls back off the ONNX path', async () => {
    findRowsMock.mockResolvedValue([row(), row({ snapshotId: 2 })]);
    scoreImageMock.mockResolvedValue(onnxResult({ pathTaken: 'baseline-fallback' }));
    const r = await backfillArchiveSnapshotScores({ limit: 50 });
    expect(r.abortedOnFallback).toBe(true);
    expect(r.fallbacks).toBe(1);
    expect(r.scored).toBe(0);
    expect(writeScoresMock).not.toHaveBeenCalled();
  });

  it('marks a permanently-dead URL and keeps going', async () => {
    findRowsMock.mockResolvedValue([row(), row({ snapshotId: 2 })]);
    downloadImageMock
      .mockRejectedValueOnce(new Error('404 Not Found'))
      .mockResolvedValueOnce(Buffer.from('jpg'));
    const r = await backfillArchiveSnapshotScores({ limit: 50 });
    expect(markDeadUrlMock).toHaveBeenCalledWith(1);
    expect(r.deadUrls).toBe(1);
    expect(r.scored).toBe(1); // the second row still scored
  });

  it('does NOT mark dead-url on a transient download error (retried next pass)', async () => {
    findRowsMock.mockResolvedValue([row()]);
    downloadImageMock.mockRejectedValue(new Error('ETIMEDOUT socket hang up'));
    const r = await backfillArchiveSnapshotScores({ limit: 50 });
    expect(markDeadUrlMock).not.toHaveBeenCalled();
    expect(r.failed).toBe(1);
    expect(r.deadUrls).toBe(0);
  });

  it('syncs the webcam score for custom rows but not for windy rows', async () => {
    findRowsMock.mockResolvedValue([
      row({ snapshotId: 1, webcamId: 10, source: 'custom' }),
      row({ snapshotId: 2, webcamId: 20, source: 'windy' }),
    ]);
    scoreImageMock.mockImplementation((input: { source: string }) =>
      Promise.resolve(onnxResult({ source: input.source })),
    );
    await backfillArchiveSnapshotScores({ limit: 50, includeAllSources: true });
    expect(syncWebcamMock).toHaveBeenCalledTimes(1);
    expect(syncWebcamMock).toHaveBeenCalledWith(10);
  });

  it('passes includeAllSources through to the finder', async () => {
    findRowsMock.mockResolvedValue([]);
    await backfillArchiveSnapshotScores({ limit: 25, includeAllSources: true });
    expect(findRowsMock).toHaveBeenCalledWith(25, { includeAllSources: true });
  });
});
