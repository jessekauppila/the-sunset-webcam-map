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

import { scoreImage, __resetScoreImageCacheForTests } from './aiScoring';

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
});
