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
const getImageHashMapMock = vi.fn();
const downloadMock = vi.fn();
const scoreMock = vi.fn();
const backfillMock = vi.fn();
const customClassifyMock = vi.fn();
const upsertStatsMock = vi.fn();
const verifyAuthMock = vi.fn(() => true);
const computeTickStatsMock = vi.fn();
const computeDisagreementKindMock = vi.fn(() => null);
const uploadToFirebaseMock = vi.fn(() => ({
  url: 'https://stub-firebase/test.jpg',
  path: 'snapshots/0/test.jpg',
}));
const insertWindyDisagreementSnapshotMock = vi.fn(() => 999);

vi.mock('@/app/lib/terminatorPayload', () => ({
  fetchTerminatorWebcams: () => fetchTerminatorWebcamsMock(),
}));
vi.mock('@/app/lib/cache', () => ({
  setCachedTerminatorPayload: (...a: unknown[]) => setCachedMock(...a),
}));
vi.mock('@/app/lib/webcamSnapshot', () => ({
  downloadImage: (...a: unknown[]) => downloadMock(...a),
  uploadToFirebase: (...a: unknown[]) => uploadToFirebaseMock(...a),
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
  getWebcamImageHashMap: (...a: unknown[]) => getImageHashMapMock(...a),
  upsertTerminatorState: (...a: unknown[]) => upsertStateMock(...a),
  deactivateMissingTerminatorState: (...a: unknown[]) => deactivateMock(...a),
  updateWebcamAiFields: (...a: unknown[]) => updateAiFieldsMock(...a),
  insertWindyDisagreementSnapshot: (...a: unknown[]) =>
    insertWindyDisagreementSnapshotMock(...a),
}));
vi.mock('./lib/aiScoring', () => ({
  scoreImage: (...a: unknown[]) => scoreMock(...a),
  computeDisagreementKind: (...a: unknown[]) =>
    computeDisagreementKindMock(...a),
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

// Mutable capture toggles — keep the real masterConfig values, override only
// the two flags so each test can flip them (getters re-read per access).
const toggles = vi.hoisted(() => ({ high: false, all: false }));
vi.mock('@/app/lib/masterConfig', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/lib/masterConfig')>();
  return {
    ...actual,
    get SAVE_HIGH_RATED_SNAPSHOTS() {
      return toggles.high;
    },
    get SAVE_ALL_RATED_SNAPSHOTS() {
      return toggles.all;
    },
  };
});

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
  getImageHashMapMock.mockReset().mockResolvedValue(new Map());
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
  computeDisagreementKindMock.mockReset().mockReturnValue(null);
  uploadToFirebaseMock.mockReset().mockReturnValue({
    url: 'https://stub-firebase/test.jpg',
    path: 'snapshots/0/test.jpg',
  });
  insertWindyDisagreementSnapshotMock.mockReset().mockReturnValue(999);
  toggles.high = false;
  toggles.all = false;
});

function makeReq(): Request {
  return new Request('http://test/api/cron/update-cameras');
}

describe('GET /api/cron/update-cameras', () => {
  it('scores a Windy webcam via scoreImage and writes the new hash to Neon', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(scoreMock).toHaveBeenCalledTimes(1);
    expect(updateAiFieldsMock).toHaveBeenCalledTimes(1);
    // The new image hash is persisted via the same webcam AI-fields UPDATE
    // (no separate Redis write).
    const [updates] = updateAiFieldsMock.mock.calls[0];
    expect(updates[0]).toMatchObject({ webcamId: 700, lastImageHash: 'newhash' });
  });

  it('passes the prior image hash from Neon into scoreImage', async () => {
    getImageHashMapMock.mockResolvedValueOnce(new Map([[700, 'priorhash']]));
    await GET(makeReq());
    expect(scoreMock).toHaveBeenCalledTimes(1);
    expect(scoreMock.mock.calls[0][0]).toMatchObject({ lastImageHash: 'priorhash' });
  });

  it('skips Neon writes when the image hash is unchanged (cache-hit)', async () => {
    getImageHashMapMock.mockResolvedValueOnce(new Map([[700, 'newhash']]));
    scoreMock.mockResolvedValueOnce({
      rawScore: 0, aiRating: 0, modelVersion: 'v4',
      imageHash: 'newhash', source: 'windy', pathTaken: 'cache-hit',
    });
    await GET(makeReq());
    expect(updateAiFieldsMock).not.toHaveBeenCalled();
  });

  it('calls the custom-snapshot backfill once per tick', async () => {
    await GET(makeReq());
    expect(backfillMock).toHaveBeenCalledTimes(1);
  });

  it('UPSERTs daily_sunset_stats at end of tick', async () => {
    await GET(makeReq());
    expect(upsertStatsMock).toHaveBeenCalledTimes(1);
  });

  it('handles download failure gracefully and skips Neon writes', async () => {
    downloadMock.mockRejectedValueOnce(new Error('network'));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cacheHits).toBe(0);
    expect(scoreMock).not.toHaveBeenCalled();
    expect(updateAiFieldsMock).not.toHaveBeenCalled();
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

  it('persists a Windy snapshot when computeDisagreementKind flags the score', async () => {
    // Mock the disagreement helper to return a non-null kind for this tick.
    computeDisagreementKindMock.mockReturnValueOnce(
      'binary_negative_regression_high',
    );
    await GET(makeReq());
    expect(uploadToFirebaseMock).toHaveBeenCalledTimes(1);
    expect(insertWindyDisagreementSnapshotMock).toHaveBeenCalledTimes(1);
    const insertArgs = insertWindyDisagreementSnapshotMock.mock.calls[0][0] as {
      disagreementKind: string;
      firebaseUrl: string;
    };
    expect(insertArgs.disagreementKind).toBe('binary_negative_regression_high');
    expect(insertArgs.firebaseUrl).toContain('https://');
  });

  it('does not persist a Windy snapshot when models agree (disagreementKind=null)', async () => {
    // Default mock returns null (agreement) — no persist.
    await GET(makeReq());
    expect(uploadToFirebaseMock).not.toHaveBeenCalled();
    expect(insertWindyDisagreementSnapshotMock).not.toHaveBeenCalled();
  });

  it('persists a high-scoring frame when SAVE_HIGH_RATED_SNAPSHOTS is on (no disagreement)', async () => {
    toggles.high = true;
    scoreMock.mockResolvedValue({
      rawScore: 0.95, aiRating: 4.8, modelVersion: 'v4',
      imageHash: 'h', source: 'windy', pathTaken: 'onnx',
    });
    await GET(makeReq());
    expect(insertWindyDisagreementSnapshotMock).toHaveBeenCalledTimes(1);
    expect(insertWindyDisagreementSnapshotMock.mock.calls[0][0]).toMatchObject({
      disagreementKind: null,
      aiRating: 4.8,
    });
  });

  it('does NOT persist a high-scoring frame when the toggle is off', async () => {
    scoreMock.mockResolvedValue({
      rawScore: 0.95, aiRating: 4.8, modelVersion: 'v4',
      imageHash: 'h', source: 'windy', pathTaken: 'onnx',
    });
    await GET(makeReq());
    expect(insertWindyDisagreementSnapshotMock).not.toHaveBeenCalled();
  });

  it('persists every scored frame when SAVE_ALL_RATED_SNAPSHOTS is on, even a low score', async () => {
    toggles.all = true;
    scoreMock.mockResolvedValue({
      rawScore: 0.1, aiRating: 1.4, modelVersion: 'v4',
      imageHash: 'h', source: 'windy', pathTaken: 'onnx',
    });
    await GET(makeReq());
    expect(insertWindyDisagreementSnapshotMock).toHaveBeenCalledTimes(1);
  });
});
