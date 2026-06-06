import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMock = vi.fn();
const batchMock = vi.fn();

// Keep the real computeDisagreementKind; mock only the DB layer.
vi.mock('./dbOperations', () => ({
  findSnapshotsNeedingDisagreementRecompute: (...a: unknown[]) => findMock(...a),
  updateSnapshotDisagreementsBatch: (...a: unknown[]) => batchMock(...a),
}));

import { recomputeDisagreements } from './recomputeDisagreements';

beforeEach(() => {
  findMock.mockReset();
  batchMock.mockReset().mockResolvedValue(undefined);
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
    expect(batchMock).toHaveBeenCalledWith([
      { snapshotId: 1, kind: 'model_low_claude_sunset' },
    ]);
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
    expect(batchMock).toHaveBeenCalledWith([{ snapshotId: 2, kind: null }]);
  });

  it('batches all rows into a SINGLE write call (no N+1 per-row UPDATEs)', async () => {
    findMock.mockResolvedValue([
      {
        snapshotId: 1,
        aiRegressionScore: 0.2,
        binaryIsSunset: null,
        llmQuality: 0.85,
        llmIsSunset: true,
      },
      {
        snapshotId: 2,
        aiRegressionScore: 0.8,
        binaryIsSunset: null,
        llmQuality: 0.9,
        llmIsSunset: true,
      },
      {
        snapshotId: 3,
        aiRegressionScore: 0.1,
        binaryIsSunset: null,
        llmQuality: 0.95,
        llmIsSunset: true,
      },
    ]);
    const r = await recomputeDisagreements({ limit: 100 });
    expect(r.recomputed).toBe(3);
    expect(r.flagged).toBe(2); // ids 1 and 3 are misses; id 2 agrees
    // The whole point of the fix: one round-trip for the page, not one per row.
    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock).toHaveBeenCalledWith([
      { snapshotId: 1, kind: 'model_low_claude_sunset' },
      { snapshotId: 2, kind: null },
      { snapshotId: 3, kind: 'model_low_claude_sunset' },
    ]);
  });

  it('does no writes when nothing needs recompute', async () => {
    findMock.mockResolvedValue([]);
    const r = await recomputeDisagreements({ limit: 100 });
    expect(r).toEqual({ recomputed: 0, flagged: 0 });
    expect(batchMock).toHaveBeenCalledWith([]);
  });
});
