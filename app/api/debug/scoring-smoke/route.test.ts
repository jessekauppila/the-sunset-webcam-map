// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyAuthMock = vi.fn(() => true);
const scoreMock = vi.fn();
const readFileMock = vi.fn();

vi.mock('@/app/api/cron/update-cameras/lib/auth', () => ({
  verifyCronAuth: () => verifyAuthMock(),
}));
vi.mock('@/app/api/cron/update-cameras/lib/aiScoring', () => ({
  scoreImage: (...a: unknown[]) => scoreMock(...a),
}));
vi.mock('node:fs/promises', () => ({
  readFile: (...a: unknown[]) => readFileMock(...a),
}));

import { GET } from './route';

beforeEach(() => {
  verifyAuthMock.mockReset().mockReturnValue(true);
  readFileMock.mockReset().mockResolvedValue(Buffer.from('fake-jpeg-bytes'));
  scoreMock.mockReset().mockResolvedValue({
    rawScore: 0.72, aiRating: 3.88, modelVersion: 'v4_test',
    imageHash: 'abc', source: 'windy', pathTaken: 'onnx',
  });
});

function makeReq(): Request {
  return new Request('http://test/api/debug/scoring-smoke');
}

describe('GET /api/debug/scoring-smoke', () => {
  it('returns 401 when auth fails', async () => {
    verifyAuthMock.mockReturnValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(scoreMock).not.toHaveBeenCalled();
  });

  it('reads the test image, scores it, returns pathTaken + rating + latency', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      pathTaken: 'onnx',
      rawScore: 0.72,
      aiRating: 3.88,
      modelVersion: 'v4_test',
    });
    expect(typeof body.latencyMs).toBe('number');
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('forces real scoring by passing lastImageHash: undefined', async () => {
    await GET(makeReq());
    expect(scoreMock).toHaveBeenCalledTimes(1);
    const call = scoreMock.mock.calls[0][0];
    expect(call.lastImageHash).toBeUndefined();
    expect(call.source).toBe('windy');
  });

  it('returns 500 with the underlying error when scoreImage throws', async () => {
    scoreMock.mockRejectedValueOnce(new Error('onnx load failed'));
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('onnx load failed');
  });
});
