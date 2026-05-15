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
const upsertStatsMock = vi.fn();
const verifyAuthMock = vi.fn(() => true);

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
vi.mock('./lib/dailyStats', () => ({
  computeTickStats: vi.fn(() => ({ modelVersion: 'v4', webcamsScored: 1, cacheHits: 0, fallbacks: 0, scoreAvg: 0.5, scoreP50: 0.5, scoreP90: 0.5, scoreP99: 0.5, aboveMinScoreToWinCount: 0, sourceBreakdown: { windy: { scored: 1, avg: 0.5 }, custom: { scored: 0, avg: null } } })),
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
  upsertStatsMock.mockReset().mockResolvedValue(undefined);
  setCachedMock.mockReset().mockResolvedValue(undefined);
  fetchTerminatorWebcamsMock.mockReset().mockResolvedValue([]);
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
});
