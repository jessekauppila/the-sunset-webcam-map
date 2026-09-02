// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchTerminatorWebcamsMock = vi.fn();
const setCachedMock = vi.fn();
const markKioskTickRanMock = vi.fn();
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
const captureProviderUsageDailyMock = vi.fn();
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
  markKioskTickRan: () => markKioskTickRanMock(),
}));
vi.mock('@/app/lib/webcamSnapshot', () => ({
  downloadImage: (...a: unknown[]) => downloadMock(...a),
  uploadToFirebase: (...a: unknown[]) => uploadToFirebaseMock(...a),
}));
vi.mock('./lib/auth', () => ({ verifyCronAuth: () => verifyAuthMock() }));
vi.mock('./lib/windyApi', () => ({
  dedupeCoords: (x: unknown) => x,
  // Mirrors the real fetchCoordsCounted (lib/windyApi.ts): an empty coord
  // list short-circuits to zero webcams without calling the batch fetcher.
  fetchCoordsCounted: async (coords: unknown[], ...rest: unknown[]) => {
    if (!Array.isArray(coords) || coords.length === 0) {
      return { webcams: [], attempted: 0, empty: 0 };
    }
    const batches = (await fetchBatchesMock(coords, ...rest)) as Array<
      Array<{ webcamId: number | string; [k: string]: unknown }>
    >;
    return {
      webcams: batches.flat(),
      attempted: coords.length,
      empty: batches.filter((b) => b.length === 0).length,
    };
  },
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
vi.mock('./lib/archiveBackfill', () => ({
  backfillArchiveSnapshotScores: (...a: unknown[]) => backfillMock(...a),
}));
vi.mock('./lib/customClassification', () => ({
  classifyCustomCamerasForTick: (...a: unknown[]) => customClassifyMock(...a),
}));
vi.mock('./lib/dailyStats', () => ({
  computeTickStats: (...a: unknown[]) => computeTickStatsMock(...a),
  upsertDailyStats: (...a: unknown[]) => upsertStatsMock(...a),
}));
vi.mock('./lib/providerUsage', () => ({
  captureProviderUsageDaily: (...a: unknown[]) =>
    captureProviderUsageDailyMock(...a),
}));
// sweepStats is only partially mocked below, so importOriginal pulls in the
// real module -- and with it @/app/lib/db, which calls neon() at import time
// and throws without DATABASE_URL. Nothing in this file uses sql directly.
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));

const upsertSweepStatsMock = vi.fn();
// Only the write is stubbed. computeSweepTickStats and ringOffsetByWebcamId
// stay real so this file exercises the actual telemetry -> row mapping.
vi.mock('./lib/sweepStats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/sweepStats')>()),
  upsertSweepStats: (...a: unknown[]) => upsertSweepStatsMock(...a),
}));
const sendDailyUsageDigestMock = vi.fn();
vi.mock('./lib/dailyDigest', () => ({
  sendDailyUsageDigest: (...a: unknown[]) => sendDailyUsageDigestMock(...a),
}));
vi.mock('@/app/components/Map/lib/subsolarLocation', () => ({
  subsolarPoint: () => ({ raHours: 0, gmstHours: 0 }),
}));
vi.mock('@/app/components/Map/lib/terminatorRing', () => ({
  // One coordinate per feed so fetchCoords actually receives non-empty
  // input — an all-empty ring would make fetchCoordsCounted's real
  // short-circuit fire on every call and never exercise the fetch seam.
  createTerminatorQueryRing: () => ({
    sunriseCoords: [{ lat: 0, lng: 0 }],
    sunsetCoords: [{ lat: 1, lng: 1 }],
  }),
}));

// Mutable capture toggles — keep the real masterConfig values, override only
// the two flags so each test can flip them (getters re-read per access).
const toggles = vi.hoisted(() => ({ high: false, all: false, trickleRate: 0 }));
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
    // Defaults to 0 in tests. A live 0.02 here would fire on ~2% of runs and
    // make every "does not persist" assertion in this file randomly flaky —
    // the trickle arm is the one gate driven by Math.random().
    get SAVE_RANDOM_TRICKLE_RATE() {
      return toggles.trickleRate;
    },
  };
});

import { TERMINATOR_CAMERA_FLOOR } from '@/app/lib/masterConfig';
import { GET } from './route';

// A classify result at/above the floor for both feeds, so the default tick
// in this file is the common, non-escalating case — the sweep should not
// widen when neither feed is thin. Escalation gets its own explicit test
// below (see 'escalates to the widen offsets when a feed is thin').
const HEALTHY_CLASSIFY_RESULT = {
  sunrise: Array.from({ length: TERMINATOR_CAMERA_FLOOR }, (_, i) => ({
    webcamId: `sunrise-${i}`,
  })),
  sunset: Array.from({ length: TERMINATOR_CAMERA_FLOOR }, (_, i) => ({
    webcamId: `sunset-${i}`,
  })),
};

beforeEach(() => {
  fetchBatchesMock.mockReset().mockResolvedValue([[{
    webcamId: 7, location: { latitude: 0, longitude: 0 },
    images: { current: { preview: 'https://x/p.jpg' } },
    viewCount: 1, rating: 3,
  }]]);
  classifyMock.mockReset().mockReturnValue(HEALTHY_CLASSIFY_RESULT);
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
  backfillMock.mockReset().mockResolvedValue({ scored: 0, failed: 0, deadUrls: 0, fallbacks: 0, abortedOnFallback: false, modelVersion: null, scores: [] });
  customClassifyMock.mockReset().mockResolvedValue({ sunrise: [], sunset: [] });
  upsertStatsMock.mockReset().mockResolvedValue(undefined);
  captureProviderUsageDailyMock.mockReset().mockResolvedValue({ captured: 0 });
  sendDailyUsageDigestMock.mockReset().mockResolvedValue({ sent: true });
  upsertSweepStatsMock.mockReset().mockResolvedValue(undefined);
  setCachedMock.mockReset().mockResolvedValue(undefined);
  markKioskTickRanMock.mockReset().mockResolvedValue(undefined);
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
  toggles.trickleRate = 0;
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

  it('stamps the kiosk tick lock after a successful authed GET', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(markKioskTickRanMock).toHaveBeenCalled();
  });

  // The next three tests override classifyMock with sub-floor counts, so the
  // sweep escalates through all three rings as a side effect. Harmless here —
  // they assert on upsertStateMock/deactivateMock, not on sweep-derived
  // values. But a `fetchBatchesMock.mockResolvedValueOnce` added to any of
  // them applies to ring 0 only; rings 1 and 2 fall back to the beforeEach
  // default.
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
    // Three webcams: one onnx, one cache-hit, one unscored.
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
      .mockResolvedValueOnce({ rawScore: null, aiRating: null, modelVersion: 'v4', imageHash: 'h3', source: 'windy', pathTaken: 'unscored' });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.scoringPaths).toEqual({
      onnx: 1,
      'cache-hit': 1,
      unscored: 1,
    });
  });

  it('does NOT write AI fields for an unscored webcam (leaves columns null)', async () => {
    scoreMock.mockReset().mockResolvedValue({
      rawScore: null, aiRating: null, modelVersion: 'v4',
      imageHash: 'h', source: 'windy', pathTaken: 'unscored',
    });
    updateAiFieldsMock.mockClear();

    const res = await GET(makeReq());
    const body = await res.json();

    expect(updateAiFieldsMock).not.toHaveBeenCalled();
    expect(body.scoringPaths.unscored).toBeGreaterThan(0);
    expect(body.scoringPaths.onnx).toBe(0);
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

  it('passes the binary head evidence through to the persisted snapshot', async () => {
    computeDisagreementKindMock.mockReturnValueOnce(
      'binary_negative_regression_high',
    );
    scoreMock.mockReset().mockResolvedValue({
      rawScore: 0.82, aiRating: 4.28, modelVersion: 'v4-regression',
      imageHash: 'h', source: 'windy', pathTaken: 'onnx',
      binaryRawScore: 0.12, binaryIsSunset: false,
      binaryModelVersion: 'v4-binary', binaryPathTaken: 'onnx',
    });
    await GET(makeReq());
    expect(insertWindyDisagreementSnapshotMock).toHaveBeenCalledTimes(1);
    expect(insertWindyDisagreementSnapshotMock.mock.calls[0][0]).toMatchObject({
      aiBinaryScore: 0.12,
      aiBinaryIsSunset: false,
      aiModelVersionBinary: 'v4-binary',
    });
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

  // The random trickle-save arm (roadmap side item 1): the archive is otherwise
  // model-gated, so every generation trains on a distribution its predecessor
  // chose. These tests pin the two properties that make the arm a control:
  // it ignores the score, and it stays separable afterwards.
  it('persists a LOW-scoring frame when the trickle draw hits', async () => {
    toggles.trickleRate = 1; // draw always hits
    scoreMock.mockResolvedValue({
      rawScore: 0.01, aiRating: 1.04, modelVersion: 'v4',
      imageHash: 'h', source: 'windy', pathTaken: 'onnx',
    });
    await GET(makeReq());
    expect(insertWindyDisagreementSnapshotMock).toHaveBeenCalledTimes(1);
    expect(insertWindyDisagreementSnapshotMock.mock.calls[0][0]).toMatchObject({
      disagreementKind: null,
      intakeReason: 'trickle',
      aiRating: 1.04,
    });
  });

  it('does not persist when the trickle draw misses', async () => {
    toggles.trickleRate = 0;
    scoreMock.mockResolvedValue({
      rawScore: 0.01, aiRating: 1.04, modelVersion: 'v4',
      imageHash: 'h', source: 'windy', pathTaken: 'onnx',
    });
    await GET(makeReq());
    expect(insertWindyDisagreementSnapshotMock).not.toHaveBeenCalled();
  });

  it('does not label a frame "trickle" when a gated reason already caught it', async () => {
    // A frame the incumbent model already likes is not part of the unbiased
    // arm, even when the coin also comes up heads. If precedence inverted, the
    // control arm would silently fill with high-rated frames — exactly the
    // bias it exists to measure.
    toggles.trickleRate = 1;
    toggles.high = true;
    scoreMock.mockResolvedValue({
      rawScore: 0.95, aiRating: 4.8, modelVersion: 'v4',
      imageHash: 'h', source: 'windy', pathTaken: 'onnx',
    });
    await GET(makeReq());
    expect(insertWindyDisagreementSnapshotMock.mock.calls[0][0]).toMatchObject({
      intakeReason: 'high_rated',
    });
  });

  it('samples at roughly the configured rate, independent of score', async () => {
    // Drives the real Math.random() gate through a fixed sequence so the rate
    // is asserted rather than assumed. 0.02 keeps draws below the threshold
    // only for the values seeded under it.
    toggles.trickleRate = 0.02;
    scoreMock.mockResolvedValue({
      rawScore: 0.01, aiRating: 1.04, modelVersion: 'v4',
      imageHash: 'h', source: 'windy', pathTaken: 'onnx',
    });
    const draws = [0.5, 0.019, 0.9, 0.021, 0.001];
    let i = 0;
    const randomSpy = vi
      .spyOn(Math, 'random')
      .mockImplementation(() => draws[i++ % draws.length]);
    try {
      // Each GET scores the single mocked webcam once, so one draw per call.
      for (let call = 0; call < draws.length; call += 1) {
        i = call;
        insertWindyDisagreementSnapshotMock.mockClear();
        await GET(makeReq());
        const hit = draws[call] < 0.02;
        expect(insertWindyDisagreementSnapshotMock.mock.calls.length > 0).toBe(hit);
      }
    } finally {
      randomSpy.mockRestore();
    }
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

  it('captures provider usage without failing the tick when it errors', async () => {
    captureProviderUsageDailyMock.mockRejectedValueOnce(new Error('neon down'));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(captureProviderUsageDailyMock).toHaveBeenCalled();
  });

  it('sends the daily digest only on the tick that landed a fresh capture', async () => {
    captureProviderUsageDailyMock.mockResolvedValueOnce({ captured: 4 });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(sendDailyUsageDigestMock).toHaveBeenCalledTimes(1);
  });

  it('skips the digest when the capture was skipped', async () => {
    captureProviderUsageDailyMock.mockResolvedValueOnce({ skipped: 'already-captured' });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(sendDailyUsageDigestMock).not.toHaveBeenCalled();
    expect(body.digest).toEqual({ skipped: 'no-fresh-capture' });
  });

  it('a digest failure never fails the tick', async () => {
    captureProviderUsageDailyMock.mockResolvedValueOnce({ captured: 4 });
    sendDailyUsageDigestMock.mockRejectedValueOnce(new Error('resend down'));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect((await res.json()).digest).toEqual({ skipped: 'send-failed' });
  });

  describe('terminator sweep telemetry', () => {
    it('does not escalate on a healthy tick (both feeds at/above the floor)', async () => {
      // Default beforeEach classifyMock already returns a healthy split
      // (HEALTHY_CLASSIFY_RESULT); this pins that the base ring alone is
      // enough, so a future refactor that widens by default fails loudly.
      const res = await GET(makeReq());
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.sweep.escalations).toBe(0);
      expect(body.sweep.rings).toHaveLength(1);
      expect(body.sweep.rings[0].offsetDeg).toBe(0);
    });

    it('escalates to the widen offsets, day side first, when a feed is thin', async () => {
      classifyMock.mockReturnValue({
        sunrise: Array.from(
          { length: TERMINATOR_CAMERA_FLOOR - 1 },
          (_, i) => ({ webcamId: `thin-${i}` }),
        ),
        sunset: HEALTHY_CLASSIFY_RESULT.sunset,
      });
      const res = await GET(makeReq());
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.sweep.escalations).toBe(2);
      expect(body.sweep.rings).toHaveLength(3);
      // Day side (+15.75) before night side (-15.75) — the escalation
      // priority order, not just membership.
      expect(body.sweep.rings.map((r: { offsetDeg: number }) => r.offsetDeg)).toEqual([
        0, 15.75, -15.75,
      ]);
      // Only the thin feed's half of each escalation ring is swept.
      expect(body.sweep.rings[1].feedsSwept).toEqual(['sunrise']);
      expect(body.sweep.rings[2].feedsSwept).toEqual(['sunrise']);
    });

    it('persists the tick to daily_sunset_stats, split base vs escalation', async () => {
      classifyMock.mockReturnValue({
        sunrise: Array.from(
          { length: TERMINATOR_CAMERA_FLOOR - 1 },
          (_, i) => ({ webcamId: `thin-${i}` }),
        ),
        sunset: HEALTHY_CLASSIFY_RESULT.sunset,
      });
      const res = await GET(makeReq());
      expect(res.status).toBe(200);

      expect(upsertSweepStatsMock).toHaveBeenCalledTimes(1);
      const [, stats, modelVersion] = upsertSweepStatsMock.mock.calls[0] as [
        Date,
        {
          ticks: number;
          escalatedTicks: number;
          sunriseThinTicks: number;
          sunsetThinTicks: number;
          sunriseShortTicks: number;
          baseBoxes: number;
          escalationBoxes: number;
          rings: Array<{ offsetDeg: number }>;
        },
        string,
      ];
      expect(stats.ticks).toBe(1);
      expect(stats.escalatedTicks).toBe(1);
      expect(stats.sunriseThinTicks).toBe(1);
      expect(stats.sunsetThinTicks).toBe(0);
      // The classify mock is fixed, so widening never lifts sunrise over the
      // floor: thin and short are both set, which is the "widening did not
      // recover the feed" case the digest calls out.
      expect(stats.sunriseShortTicks).toBe(1);
      expect(stats.baseBoxes).toBe(2);
      expect(stats.escalationBoxes).toBe(2);
      expect(stats.rings.map((r) => r.offsetDeg)).toEqual([0, 15.75, -15.75]);
      // Shares daily_sunset_stats.model_version with the rollup writer;
      // either call may be the one that creates the day's row.
      expect(modelVersion).toBe('v4');
    });

    it('attributes a gate verdict to the ring that first saw the camera', async () => {
      scoreMock.mockResolvedValue({
        rawScore: 0.6,
        aiRating: 3.0,
        modelVersion: 'v4',
        imageHash: 'newhash',
        source: 'windy',
        pathTaken: 'onnx',
        binaryIsSunset: true,
      });
      const res = await GET(makeReq());
      expect(res.status).toBe(200);

      const [, stats] = upsertSweepStatsMock.mock.calls[0] as [
        Date,
        { rings: Array<{ offsetDeg: number; framesScored: number; framesGatePassed: number }> },
      ];
      const base = stats.rings.find((r) => r.offsetDeg === 0)!;
      expect(base.framesScored).toBe(1);
      expect(base.framesGatePassed).toBe(1);
    });

    it('leaves gate counts empty when the binary head produced no verdict', async () => {
      // Default scoreMock omits binaryIsSunset. A scored-but-ungated frame
      // must not land in framesScored, or the per-ring rate reads as a gate
      // failure when in fact no gate ran.
      const res = await GET(makeReq());
      expect(res.status).toBe(200);
      const [, stats] = upsertSweepStatsMock.mock.calls[0] as [
        Date,
        { rings: Array<{ framesScored: number }> },
      ];
      expect(stats.rings.every((r) => r.framesScored === 0)).toBe(true);
    });
  });
});
