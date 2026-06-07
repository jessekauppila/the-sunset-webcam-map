import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMock = vi.fn();
const batchMock = vi.fn();

// Keep the real computeDisagreementKind; mock only the DB layer.
vi.mock('./dbOperations', () => ({
  findExternalImagesNeedingDisagreementRecompute: (...a: unknown[]) =>
    findMock(...a),
  updateExternalImageDisagreementsBatch: (...a: unknown[]) => batchMock(...a),
}));

import { recomputeExternalDisagreements } from './recomputeExternalDisagreements';

beforeEach(() => {
  findMock.mockReset();
  batchMock.mockReset().mockResolvedValue(undefined);
});

describe('recomputeExternalDisagreements', () => {
  it('re-derives a model-vs-Claude miss for a Flickr row and batches it', async () => {
    findMock.mockResolvedValue([
      {
        externalImageId: 1,
        aiRegressionScore: 0.2, // → aiRating 1.8 (low); Claude confident-good sunset
        binaryIsSunset: null,
        llmQuality: 0.85,
        llmIsSunset: true,
      },
    ]);
    const r = await recomputeExternalDisagreements({ limit: 100 });
    expect(r.recomputed).toBe(1);
    expect(r.flagged).toBe(1);
    expect(batchMock).toHaveBeenCalledWith([
      { externalImageId: 1, kind: 'model_low_claude_sunset' },
    ]);
  });

  it('batches all rows into a single write call', async () => {
    findMock.mockResolvedValue([
      { externalImageId: 1, aiRegressionScore: 0.2, binaryIsSunset: null, llmQuality: 0.85, llmIsSunset: true },
      { externalImageId: 2, aiRegressionScore: 0.8, binaryIsSunset: null, llmQuality: 0.9, llmIsSunset: true },
    ]);
    const r = await recomputeExternalDisagreements({ limit: 100 });
    expect(r.recomputed).toBe(2);
    expect(r.flagged).toBe(1); // id 1 is a miss; id 2 agrees
    expect(batchMock).toHaveBeenCalledTimes(1);
  });

  it('does no writes when nothing needs recompute', async () => {
    findMock.mockResolvedValue([]);
    const r = await recomputeExternalDisagreements({ limit: 100 });
    expect(r).toEqual({ recomputed: 0, flagged: 0 });
    expect(batchMock).toHaveBeenCalledWith([]);
  });
});
