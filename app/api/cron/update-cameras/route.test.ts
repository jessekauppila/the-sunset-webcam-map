// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchTerminatorWebcamsMock = vi.fn();
const setCachedMock = vi.fn();
const fetchBatchesMock = vi.fn();
const upsertWebcamsMock = vi.fn();
const classifyMock = vi.fn();
const getIdMapMock = vi.fn();
const upsertStateMock = vi.fn();
const deactivateMock = vi.fn();
const updateAiFieldsMock = vi.fn();
const downloadMock = vi.fn();
const scoreMock = vi.fn();
const getHashMock = vi.fn();
const setHashMock = vi.fn();
const backfillMock = vi.fn();
const customClassifyMock = vi.fn();
const upsertStatsMock = vi.fn();
const verifyAuthMock = vi.fn(() => true);
const computeTickStatsMock = vi.fn();

vi.mock('@/app/lib/terminatorPayload', () => ({
  fetchTerminatorWebcams: () => fetchTerminatorWebcamsMock(),
}));
vi.mock('@/app/lib/cache', () => ({
  setCachedTerminatorPayload: (...a: unknown[]) => setCachedMock(...a),
  getCameraImageHash: (...a: unknown[]) => getHashMock(...a),
  setCameraImageHash: (...a: unknown[]) => setHashMock(...a),
}));
vi.mock('@/app/lib/webcamSnapshot', () => ({
  downloadImage: (...a: unknown[]) => downloadMock(...a),
}));
vi.mock('./lib/auth', () => ({ verifyCronAuth: () => verifyAuthMock() }));
vi.mock('./lib/windyApi', () => ({
  dedupeCoords: (x: unknown) => x,
  dedupeWebcams: (webcams: Array<{ webcamId: number | string; [k: string]: unknown }>) => {
    const m = new Map<string, typeof webcams[number]>();
    for (const w of webcams) m.set(String(w.webcamId), w);
    return m;
  },
  fetchWebcamsInBatches: (...a: unknown[]) => fetchBatchesMock(...a),
}));
vi.mock('./lib/webcamClassification', () => ({
  classifyWebcamsByPhase: (...a: unknown[]) => classifyMock(...a),
}));
vi.mock('./lib/dbOperations', () => ({
  upsertWebcams: (...a: unknown[]) => upsertWebcamsMock(...a),
  getWebcamIdMap: (...a: unknown[]) => getIdMapMock(...a),
  upsertTerminatorState: (...a: unknown[]) => upsertStateMock(...a),
  deactivateMissingTerminatorState: (...a: unknown[]) => deactivateMock(...a),
  updateWebcamAiFields: (...a: unknown[]) => updateAiFieldsMock(...a),
}));
vi.mock('./lib/aiScoring', () => ({
  scoreImage: (...a: unknown[]) => scoreMock(...a),
}));
vi.mock('./lib/customBackfill', () => ({
  backfillCustomSnapshotScores: (...a: unknown[]) => backfillMock(...a),
}));
vi.mock('./lib/customClassification', () => ({
  classifyCustomCamerasForTick: (...a: unknown[]) => customClassifyMock(...a),
}));
vi.mock('./lib/dailyStats', () => ({
  computeTickStats: (...a: unknown[]) => computeTickStatsMock(...a),
  upsertDailyStats: (...a: unknown[]) => upsertStatsMock(...a),
}));
vi.mock('@/app/components/Map/lib/subsolarLocation', () => ({
  subsolarPoint: () => ({ raHours: 0, gmstHours: 0 }),
}));
vi.mock('@/app/components/Map/lib/terminatorRing', () => ({
  createTerminatorQueryRing: () => ({ sunriseCoords: [], sunsetCoords: [] }),
}));

import { GET } from './route';

beforeEach(() => {
  fetchBatchesMock.mockReset().mockResolvedValue([[{
    webcamId: 7, location: { latitude: 0, longitude: 0 },
    images: { current: { preview: 'https://x/p.jpg' } },
    viewCount: 1, rating: 3,
  }]]);
  classifyMock.mockReset().mockReturnValue({ sunrise: [], sunset: [] });
  getIdMapMock.mockReset().mockResolvedValue(new Map([['7', 700]]));
  upsertWebcamsMock.mockReset().mockResolvedValue(undefined);
  upsertStateMock.mockReset().mockResolvedValue(undefined);
  deactivateMock.mockReset().mockResolvedValue(undefined);
  updateAiFieldsMock.mockReset().mockResolvedValue(undefined);
  downloadMock.mockReset().mockResolvedValue(Buffer.from('jpg'));
  getHashMock.mockReset().mockResolvedValue(null);
  setHashMock.mockReset().mockResolvedValue(undefined);
  scoreMock.mockReset().mockResolvedValue({
    rawScore: 0.6, aiRating: 3.0, modelVersion: 'v4',
    imageHash: 'newhash', source: 'windy', pathTaken: 'onnx',
  });
  backfillMock.mockReset().mockResolvedValue({ scored: 0, failed: 0, modelVersion: null, scores: [] });
  customClassifyMock.mockReset().mockResolvedValue({ sunrise: [], sunset: [] });
  upsertStatsMock.mockReset().mockResolvedValue(undefined);
  setCachedMock.mockReset().mockResolvedValue(undefined);
  fetchTerminatorWebcamsMock.mockReset().mockResolvedValue([]);
  computeTickStatsMock.mockReset().mockReturnValue({ modelVersion: 'v4', webcamsScored: 1, cacheHits: 0, fallbacks: 0, scoreAvg: 0.5, scoreP50: 0.5, scoreP90: 0.5, scoreP99: 0.5, aboveMinScoreToWinCount: 0, sourceBreakdown: { windy: { scored: 1, avg: 0.5 }, custom: { scored: 0, avg: null } } });
  verifyAuthMock.mockReset().mockReturnValue(true);
});

function makeReq(): Request {
  return new Request('http://test/api/cron/update-cameras');
}

describe('GET /api/cron/update-cameras', () => {
  it('scores a Windy webcam via scoreImage and writes the new hash', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(scoreMock).toHaveBeenCalledTimes(1);
    expect(setHashMock).toHaveBeenCalledWith('windy', 700, 'newhash');
    expect(updateAiFieldsMock).toHaveBeenCalledTimes(1);
  });

  it('skips Neon writes when the image hash matches Redis', async () => {
    getHashMock.mockResolvedValueOnce('newhash');
    scoreMock.mockResolvedValueOnce({
      rawScore: 0, aiRating: 0, modelVersion: 'v4',
      imageHash: 'newhash', source: 'windy', pathTaken: 'cache-hit',
    });
    await GET(makeReq());
    expect(updateAiFieldsMock).not.toHaveBeenCalled();
    expect(setHashMock).not.toHaveBeenCalled();
  });

  it('calls the custom-snapshot backfill once per tick', async () => {
    await GET(makeReq());
    expect(backfillMock).toHaveBeenCalledTimes(1);
  });

  it('UPSERTs daily_sunset_stats at end of tick', async () => {
    await GET(makeReq());
    expect(upsertStatsMock).toHaveBeenCalledTimes(1);
  });

  it('handles download failure gracefully and skips Neon + Redis writes', async () => {
    downloadMock.mockRejectedValueOnce(new Error('network'));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cacheHits).toBe(0);
    expect(scoreMock).not.toHaveBeenCalled();
    expect(updateAiFieldsMock).not.toHaveBeenCalled();
    expect(setHashMock).not.toHaveBeenCalled();
  });

  it('returns 401 when auth fails', async () => {
    verifyAuthMock.mockReturnValueOnce(false);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(scoreMock).not.toHaveBeenCalled();
    expect(backfillMock).not.toHaveBeenCalled();
  });

  it('unions custom cams into the upsert active set', async () => {
    classifyMock.mockReturnValue({
      sunrise: [{ webcamId: 'wA', location: { latitude: 0, longitude: 0 } }],
      sunset: [],
    });
    getIdMapMock.mockResolvedValue(new Map([['wA', 1]]));
    customClassifyMock.mockResolvedValue({
      sunrise: [{ webcamId: 999 }],
      sunset: [],
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const sunriseUpsertCall = upsertStateMock.mock.calls.find(
      (c) => c[1] === 'sunrise',
    );
    expect(sunriseUpsertCall).toBeDefined();
    const rows = sunriseUpsertCall![0] as Array<{ webcamId: number }>;
    expect(rows.map((r) => r.webcamId).sort()).toEqual([1, 999]);
  });

  it('passes the union of ids to deactivateMissingTerminatorState', async () => {
    classifyMock.mockReturnValue({
      sunrise: [{ webcamId: 'wA', location: { latitude: 0, longitude: 0 } }],
      sunset: [],
    });
    getIdMapMock.mockResolvedValue(new Map([['wA', 1]]));
    customClassifyMock.mockResolvedValue({
      sunrise: [{ webcamId: 999 }],
      sunset: [],
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const sunriseDeactCall = deactivateMock.mock.calls.find(
      (c) => c[0] === 'sunrise',
    );
    expect(sunriseDeactCall).toBeDefined();
    expect((sunriseDeactCall![1] as number[]).sort()).toEqual([1, 999]);
  });

  it('skips upsert/deactivate for empty buckets gracefully', async () => {
    classifyMock.mockReturnValue({ sunrise: [], sunset: [] });
    getIdMapMock.mockResolvedValue(new Map());
    customClassifyMock.mockResolvedValue({ sunrise: [], sunset: [] });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    // Empty buckets must still flow through upsert + deactivate — otherwise a
    // future "optimize away empty arrays" change would silently break the
    // deactivation contract (rows would never get flipped to active=false
    // when the active set is empty).
    const sunriseUpsertCall = upsertStateMock.mock.calls.find((c) => c[1] === 'sunrise');
    expect(sunriseUpsertCall).toBeDefined();
    expect(sunriseUpsertCall![0]).toEqual([]);

    const sunriseDeactCall = deactivateMock.mock.calls.find((c) => c[0] === 'sunrise');
    expect(sunriseDeactCall).toBeDefined();
    expect(sunriseDeactCall![1]).toEqual([]);
  });

  it('returns a scoringPaths breakdown counted from scored.pathTaken', async () => {
    // Three webcams: one onnx, one cache-hit, one baseline-fallback.
    fetchBatchesMock.mockResolvedValueOnce([[
      { webcamId: 7, location: { latitude: 0, longitude: 0 },
        images: { current: { preview: 'https://x/a.jpg' } }, viewCount: 1, rating: 3 },
      { webcamId: 8, location: { latitude: 0, longitude: 0 },
        images: { current: { preview: 'https://x/b.jpg' } }, viewCount: 1, rating: 3 },
      { webcamId: 9, location: { latitude: 0, longitude: 0 },
        images: { current: { preview: 'https://x/c.jpg' } }, viewCount: 1, rating: 3 },
    ]]);
    getIdMapMock.mockResolvedValueOnce(new Map([['7', 700], ['8', 800], ['9', 900]]));
    scoreMock
      .mockResolvedValueOnce({ rawScore: 0.6, aiRating: 3.4, modelVersion: 'v4', imageHash: 'h1', source: 'windy', pathTaken: 'onnx' })
      .mockResolvedValueOnce({ rawScore: 0, aiRating: 0, modelVersion: 'v4', imageHash: 'h2', source: 'windy', pathTaken: 'cache-hit' })
      .mockResolvedValueOnce({ rawScore: 0.4, aiRating: 2.6, modelVersion: 'v4', imageHash: 'h3', source: 'windy', pathTaken: 'baseline-fallback' });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.scoringPaths).toEqual({
      onnx: 1,
      'cache-hit': 1,
      'baseline-fallback': 1,
      baseline: 0,
    });
  });
});
