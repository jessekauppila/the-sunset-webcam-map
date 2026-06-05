import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMock = vi.fn();
const writeMock = vi.fn();

// Keep the real computeDisagreementKind; mock only the DB layer.
vi.mock('./dbOperations', () => ({
  findSnapshotsNeedingDisagreementRecompute: (...a: unknown[]) => findMock(...a),
  updateSnapshotDisagreement: (...a: unknown[]) => writeMock(...a),
}));

import { recomputeDisagreements } from './recomputeDisagreements';

beforeEach(() => {
  findMock.mockReset();
  writeMock.mockReset().mockResolvedValue(undefined);
});

describe('recomputeDisagreements', () => {
  it('re-derives a model-vs-Claude miss from stored scores and writes it', async () => {
    // ai_regression_score 0.2 → aiRating 1.8 (low); Claude confident-good sunset.
    findMock.mockResolvedValue([
      {
        snapshotId: 1,
        aiRegressionScore: 0.2,
        binaryIsSunset: null,
        llmQuality: 0.85,
        llmIsSunset: true,
      },
    ]);
    const r = await recomputeDisagreements({ limit: 100 });
    expect(r.recomputed).toBe(1);
    expect(r.flagged).toBe(1);
    expect(writeMock).toHaveBeenCalledWith(1, 'model_low_claude_sunset');
  });

  it('clears a stale kind to null when the scores now agree', async () => {
    // ai_regression_score 0.8 → aiRating 4.2 (high); Claude also says sunset → no disagreement.
    findMock.mockResolvedValue([
      {
        snapshotId: 2,
        aiRegressionScore: 0.8,
        binaryIsSunset: null,
        llmQuality: 0.9,
        llmIsSunset: true,
      },
    ]);
    const r = await recomputeDisagreements({ limit: 100 });
    expect(r.recomputed).toBe(1);
    expect(r.flagged).toBe(0);
    expect(writeMock).toHaveBeenCalledWith(2, null);
  });

  it('does no writes when nothing needs recompute', async () => {
    findMock.mockResolvedValue([]);
    const r = await recomputeDisagreements({ limit: 100 });
    expect(r).toEqual({ recomputed: 0, flagged: 0 });
    expect(writeMock).not.toHaveBeenCalled();
  });
});
