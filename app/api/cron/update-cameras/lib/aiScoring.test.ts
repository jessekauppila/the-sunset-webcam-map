import { describe, it, expect, vi, beforeEach } from 'vitest';

const preprocessMock = vi.fn();
const sha256Mock = vi.fn();
const runMock = vi.fn();

vi.mock('./imagePreprocess', () => ({
  preprocessJpegToImagenetTensor: (...a: unknown[]) => preprocessMock(...a),
}));
vi.mock('./imageHash', () => ({
  sha256Hex: (...a: unknown[]) => sha256Mock(...a),
}));
vi.mock('onnxruntime-node', () => ({
  Tensor: vi.fn().mockImplementation((type, data, dims) => ({ type, data, dims })),
  InferenceSession: {
    create: vi.fn().mockResolvedValue({
      inputNames: ['input'],
      outputNames: ['output'],
      run: (...a: unknown[]) => runMock(...a),
    }),
  },
}));

import {
  scoreImage,
  softmaxBinaryClassOne,
  computeDisagreementKind,
  __resetScoreImageCacheForTests,
} from './aiScoring';

describe('scoreImage', () => {
  beforeEach(() => {
    preprocessMock.mockReset().mockResolvedValue(new Float32Array(3 * 224 * 224));
    sha256Mock.mockReset().mockReturnValue('hash-abc');
    runMock.mockReset().mockResolvedValue({ output: { data: [0.64] } });
    process.env.AI_SCORING_MODE = 'onnx';
    process.env.AI_REGRESSION_MODEL_VERSION = 'test-v4';
    __resetScoreImageCacheForTests();
  });

  it('short-circuits when the new hash matches lastImageHash', async () => {
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
      lastImageHash: 'hash-abc',
    });
    expect(result.pathTaken).toBe('cache-hit');
    expect(result.imageHash).toBe('hash-abc');
    expect(preprocessMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('runs ONNX inference when no matching hash, returns rawScore in [0,1] and aiRating in [1,5]', async () => {
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
      lastImageHash: 'different',
    });
    expect(result.pathTaken).toBe('onnx');
    expect(result.rawScore).toBeGreaterThanOrEqual(0);
    expect(result.rawScore).toBeLessThanOrEqual(1);
    expect(result.aiRating).toBeGreaterThanOrEqual(1);
    expect(result.aiRating).toBeLessThanOrEqual(5);
    // rawScore 0.64 -> 1 + 0.64*4 = 3.56
    expect(result.aiRating).toBeCloseTo(3.56, 2);
    expect(result.modelVersion).toBe('test-v4');
    expect(preprocessMock).toHaveBeenCalledOnce();
  });

  it('clamps ONNX output above 1 to rating=5', async () => {
    runMock.mockResolvedValueOnce({ output: { data: [99] } });
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
    });
    expect(result.aiRating).toBe(5);
    expect(result.rawScore).toBe(1);
  });

  it('clamps ONNX output below 0 to rating=1', async () => {
    runMock.mockResolvedValueOnce({ output: { data: [-0.5] } });
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
    });
    expect(result.aiRating).toBe(1);
    expect(result.rawScore).toBe(0);
  });

  it('mid-rawScore=0.5 maps to aiRating=3', async () => {
    runMock.mockResolvedValueOnce({ output: { data: [0.5] } });
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
    });
    expect(result.rawScore).toBe(0.5);
    expect(result.aiRating).toBe(3);
  });

  it('falls back to baseline when ONNX inference throws', async () => {
    runMock.mockRejectedValueOnce(new Error('boom'));
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
      fallbackMeta: { viewCount: 1000, manualRating: 4 },
    });
    expect(result.pathTaken).toBe('baseline-fallback');
    expect(result.rawScore).toBeGreaterThanOrEqual(0);
    expect(result.rawScore).toBeLessThanOrEqual(1);
    expect(result.aiRating).toBeGreaterThanOrEqual(1);
    expect(result.aiRating).toBeLessThanOrEqual(5);
  });

  it('preserves the source field on the return value', async () => {
    const result = await scoreImage({
      webcamId: 99,
      imageBytes: Buffer.from('jpeg'),
      source: 'custom',
    });
    expect(result.source).toBe('custom');
  });

  it('returns pathTaken=baseline when AI_SCORING_MODE is not onnx', async () => {
    process.env.AI_SCORING_MODE = 'baseline';
    const result = await scoreImage({
      webcamId: 1,
      imageBytes: Buffer.from('jpeg'),
      source: 'windy',
      fallbackMeta: { viewCount: 1000, manualRating: 4 },
    });
    expect(result.pathTaken).toBe('baseline');
    expect(result.rawScore).toBeGreaterThanOrEqual(0);
    expect(result.rawScore).toBeLessThanOrEqual(1);
    expect(result.aiRating).toBeGreaterThanOrEqual(1);
    expect(result.aiRating).toBeLessThanOrEqual(5);
    expect(preprocessMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  describe('binary classifier (opt-in via AI_BINARY_SCORING_ENABLED)', () => {
    beforeEach(() => {
      // Default off so existing tests above keep their old shape.
      delete process.env.AI_BINARY_SCORING_ENABLED;
      delete process.env.AI_BINARY_MODEL_VERSION;
      delete process.env.AI_BINARY_SUNSET_THRESHOLD;
    });

    it('does NOT run the binary head when AI_BINARY_SCORING_ENABLED is unset', async () => {
      const result = await scoreImage({
        webcamId: 1,
        imageBytes: Buffer.from('jpeg'),
        source: 'windy',
      });
      expect(result.binaryRawScore).toBeUndefined();
      expect(result.binaryIsSunset).toBeUndefined();
      expect(result.binaryModelVersion).toBeUndefined();
      // One ONNX call (regression only) — runMock was only invoked once.
      expect(runMock).toHaveBeenCalledTimes(1);
    });

    it('returns binary fields when enabled — high-confidence sunset', async () => {
      process.env.AI_BINARY_SCORING_ENABLED = 'true';
      process.env.AI_BINARY_MODEL_VERSION = 'binary-v4-test';
      // Regression call returns 0.64, then binary call returns logits where
      // class 1 (sunset) dominates strongly.
      runMock
        .mockResolvedValueOnce({ output: { data: [0.64] } })
        .mockResolvedValueOnce({ output: { data: [-5.0, 5.0] } });

      const result = await scoreImage({
        webcamId: 1,
        imageBytes: Buffer.from('jpeg'),
        source: 'windy',
      });

      expect(result.pathTaken).toBe('onnx');
      // Regression result preserved.
      expect(result.aiRating).toBeCloseTo(3.56, 2);
      // Binary softmax(-5, 5) ≈ 0.99995 → sunset.
      expect(result.binaryRawScore).toBeGreaterThan(0.99);
      expect(result.binaryIsSunset).toBe(true);
      expect(result.binaryModelVersion).toBe('binary-v4-test');
      expect(result.binaryPathTaken).toBe('onnx');
      // Both heads ran.
      expect(runMock).toHaveBeenCalledTimes(2);
    });

    it('returns binaryIsSunset=false when softmax probability is below threshold', async () => {
      process.env.AI_BINARY_SCORING_ENABLED = 'true';
      runMock
        .mockResolvedValueOnce({ output: { data: [0.30] } })
        .mockResolvedValueOnce({ output: { data: [3.0, -3.0] } }); // class 0 wins

      const result = await scoreImage({
        webcamId: 1,
        imageBytes: Buffer.from('jpeg'),
        source: 'windy',
      });
      expect(result.binaryRawScore).toBeLessThan(0.01);
      expect(result.binaryIsSunset).toBe(false);
    });

    it('respects a custom AI_BINARY_SUNSET_THRESHOLD env var', async () => {
      process.env.AI_BINARY_SCORING_ENABLED = 'true';
      process.env.AI_BINARY_SUNSET_THRESHOLD = '0.9';
      runMock
        .mockResolvedValueOnce({ output: { data: [0.5] } })
        // softmax(0, 1) ≈ 0.731 — above default 0.5, below custom 0.9.
        .mockResolvedValueOnce({ output: { data: [0.0, 1.0] } });

      const result = await scoreImage({
        webcamId: 1,
        imageBytes: Buffer.from('jpeg'),
        source: 'windy',
      });
      expect(result.binaryRawScore).toBeCloseTo(0.731, 3);
      expect(result.binaryIsSunset).toBe(false);
    });

    it('leaves regression intact when only the binary head throws', async () => {
      process.env.AI_BINARY_SCORING_ENABLED = 'true';
      runMock
        .mockResolvedValueOnce({ output: { data: [0.64] } })
        .mockRejectedValueOnce(new Error('binary model missing'));

      const result = await scoreImage({
        webcamId: 1,
        imageBytes: Buffer.from('jpeg'),
        source: 'windy',
      });
      expect(result.pathTaken).toBe('onnx');
      expect(result.aiRating).toBeCloseTo(3.56, 2);
      expect(result.binaryPathTaken).toBe('baseline-fallback');
      expect(result.binaryIsSunset).toBe(false);
    });
  });
});

describe('softmaxBinaryClassOne', () => {
  it('returns ~0.5 when logits are equal', () => {
    expect(softmaxBinaryClassOne([1, 1])).toBeCloseTo(0.5, 6);
  });

  it('returns ~1 when class 1 logit dominates', () => {
    expect(softmaxBinaryClassOne([-10, 10])).toBeCloseTo(1, 6);
  });

  it('returns ~0 when class 0 logit dominates', () => {
    expect(softmaxBinaryClassOne([10, -10])).toBeCloseTo(0, 6);
  });

  it('is numerically stable for very large logits', () => {
    expect(softmaxBinaryClassOne([1000, 1001])).toBeCloseTo(0.731, 3);
    expect(softmaxBinaryClassOne([1000, 1000])).toBeCloseTo(0.5, 6);
  });

  it('handles non-finite inputs by returning 0', () => {
    expect(softmaxBinaryClassOne([NaN, 1])).toBe(0);
    expect(softmaxBinaryClassOne([Infinity, 1])).toBe(0);
  });
});

describe('computeDisagreementKind', () => {
  it('returns null when there is no extreme disagreement', () => {
    // binary says yes + regression mid → agreement-ish
    expect(computeDisagreementKind({ binaryIsSunset: true, aiRating: 3.5 })).toBeNull();
    // binary says no + regression mid → not extreme enough
    expect(computeDisagreementKind({ binaryIsSunset: false, aiRating: 2.5 })).toBeNull();
  });

  it('returns "binary_negative_regression_high" when binary says no but regression rating crosses the HIGH threshold', () => {
    expect(
      computeDisagreementKind({ binaryIsSunset: false, aiRating: 3.21 }),
    ).toBe('binary_negative_regression_high');
    // boundary — 3.0 is inclusive
    expect(
      computeDisagreementKind({ binaryIsSunset: false, aiRating: 3.0 }),
    ).toBe('binary_negative_regression_high');
  });

  it('returns "binary_positive_regression_low" when binary says yes but regression rating crosses the LOW threshold', () => {
    expect(
      computeDisagreementKind({ binaryIsSunset: true, aiRating: 1.5 }),
    ).toBe('binary_positive_regression_low');
    // boundary — 2.0 is inclusive
    expect(
      computeDisagreementKind({ binaryIsSunset: true, aiRating: 2.0 }),
    ).toBe('binary_positive_regression_low');
  });

  it('returns null when binaryIsSunset is undefined (binary head did not score)', () => {
    expect(
      computeDisagreementKind({ binaryIsSunset: undefined, aiRating: 4.5 }),
    ).toBeNull();
  });

  it('returns null when aiRating is undefined', () => {
    expect(
      computeDisagreementKind({ binaryIsSunset: true, aiRating: undefined }),
    ).toBeNull();
  });
});
