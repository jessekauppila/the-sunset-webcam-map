import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findCalibrationEvidenceByCamera: vi.fn(),
  updateCameraCalibrationBatch: vi.fn(),
  insertCalibrationHistoryBatch: vi.fn(),
}));

vi.mock('./dbOperations', () => mocks);

import { recomputeCameraCalibration } from './recomputeCameraCalibration';

const MODEL = '20260829_062437_v5_binary_gold';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateCameraCalibrationBatch.mockResolvedValue(undefined);
  mocks.insertCalibrationHistoryBatch.mockResolvedValue(undefined);
});

describe('recomputeCameraCalibration', () => {
  it('tempers a camera clearing the recurrence bar and records history', async () => {
    mocks.findCalibrationEvidenceByCamera.mockResolvedValue([
      {
        webcamId: 4057187,
        falseShows: 11,
        negativeFrames: 11,
        falseShowDays: 9,
        rawFalseShows: 11,
        previousMultiplier: null,
      },
    ]);

    const result = await recomputeCameraCalibration({ modelVersion: MODEL });

    expect(result).toEqual({ camerasEvaluated: 1, tempered: 1, changed: 1 });

    const [updates] = mocks.updateCameraCalibrationBatch.mock.calls[0];
    expect(updates[0].webcamId).toBe(4057187);
    expect(updates[0].multiplier).toBeCloseTo(0.577, 3);

    const [history] = mocks.insertCalibrationHistoryBatch.mock.calls[0];
    expect(history).toHaveLength(1);
    expect(history[0].previousMultiplier).toBeNull();
    expect(history[0].modelVersion).toBe(MODEL);
  });

  it('writes NO history row when the multiplier is unchanged (clause 8)', async () => {
    mocks.findCalibrationEvidenceByCamera.mockResolvedValue([
      {
        webcamId: 4057187,
        falseShows: 11,
        negativeFrames: 11,
        falseShowDays: 9,
        rawFalseShows: 11,
        previousMultiplier: 0.577,
      },
    ]);

    const result = await recomputeCameraCalibration({ modelVersion: MODEL });

    expect(result.changed).toBe(0);
    const [history] = mocks.insertCalibrationHistoryBatch.mock.calls[0];
    expect(history).toHaveLength(0);
  });

  it('writes a history row carrying the previous value when it changes', async () => {
    mocks.findCalibrationEvidenceByCamera.mockResolvedValue([
      {
        webcamId: 4057187,
        falseShows: 4,
        negativeFrames: 15,
        falseShowDays: 4,
        rawFalseShows: 4,
        previousMultiplier: 0.577,
      },
    ]);

    await recomputeCameraCalibration({ modelVersion: MODEL });

    const [history] = mocks.insertCalibrationHistoryBatch.mock.calls[0];
    expect(history).toHaveLength(1);
    expect(history[0].previousMultiplier).toBe(0.577);
    expect(history[0].multiplier).toBeCloseTo(0.882, 3);
  });

  it('heals a camera back to 1.0 and records that as a change', async () => {
    mocks.findCalibrationEvidenceByCamera.mockResolvedValue([
      {
        webcamId: 4057187,
        falseShows: 0,
        negativeFrames: 0,
        falseShowDays: 0,
        rawFalseShows: 0,
        previousMultiplier: 0.577,
      },
    ]);

    const result = await recomputeCameraCalibration({ modelVersion: MODEL });

    expect(result.tempered).toBe(0);
    const [updates] = mocks.updateCameraCalibrationBatch.mock.calls[0];
    expect(updates[0].multiplier).toBe(1);
    const [history] = mocks.insertCalibrationHistoryBatch.mock.calls[0];
    expect(history[0].multiplier).toBe(1);
  });

  it('handles an empty fleet without writing anything', async () => {
    mocks.findCalibrationEvidenceByCamera.mockResolvedValue([]);

    const result = await recomputeCameraCalibration({ modelVersion: MODEL });

    expect(result).toEqual({ camerasEvaluated: 0, tempered: 0, changed: 0 });
  });
});
