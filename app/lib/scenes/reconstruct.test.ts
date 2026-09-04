import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (...args: unknown[]) => sqlMock(...args) }));

import { rowsToSceneState, reconstructScene, type HistoricalSnapshotRow } from './reconstruct';

const row = (over: Partial<HistoricalSnapshotRow>): HistoricalSnapshotRow => ({
  snapshot_id: 8801, webcam_id: 1, phase: 'sunset', rank: 3,
  firebase_url: 'https://firebasestorage.googleapis.com/x.jpg',
  snapshot_captured_at: '2026-06-21T11:40:00Z',
  llm_quality: '0.8125', llm_is_sunset: true, llm_model: 'claude-sonnet-4-5',
  ai_binary_score: null, ai_regression_score: null,
  ai_model_version_binary: null, ai_model_version_regression: null,
  title: 'Cam', status: 'active', view_count: 10,
  lat: '47.606200', lng: '-122.332100',
  city: 'Seattle', region: 'WA', country: 'US', continent: 'NA',
  categories: [], urls: null, player: null,
  rating: 4, orientation: 'W', webcam_source: 'windy', external_id: 'w1',
  ...over,
});

describe('rowsToSceneState', () => {
  it('builds WindyWebcam entries with the durable frame and numeric coords', () => {
    const { state, reconstructed, skipped } = rowsToSceneState([row({})]);
    expect(reconstructed).toBe(1);
    expect(skipped).toBe(0);
    const cam = state.sunset[0];
    expect(cam.images?.current.preview).toBe('https://firebasestorage.googleapis.com/x.jpg');
    expect(cam.location.latitude).toBe(47.6062);   // Neon NUMERIC string → number
    expect(cam.location.longitude).toBe(-122.3321);
    expect(cam.llmQuality).toBe(0.8125);
    expect(cam.phase).toBe('sunset');
    expect(cam.rank).toBe(3);
    // The frame identity a labeling surface needs: every reconstructed tile
    // is an archived row, so it can be labeled without capturing anything.
    expect(cam.frameId).toBe(8801);
  });

  it('splits by recorded phase', () => {
    const { state } = rowsToSceneState([
      row({ webcam_id: 1, phase: 'sunrise' }),
      row({ webcam_id: 2, phase: 'sunset' }),
    ]);
    expect(state.sunrise).toHaveLength(1);
    expect(state.sunset).toHaveLength(1);
  });

  it('skips rows with null phase or empty firebase_url and counts them', () => {
    const { reconstructed, skipped } = rowsToSceneState([
      row({}), row({ webcam_id: 2, phase: null }), row({ webcam_id: 3, firebase_url: '' }),
    ]);
    expect(reconstructed).toBe(1);
    expect(skipped).toBe(2);
  });

  it('orders each feed by rank ascending', () => {
    const { state } = rowsToSceneState([
      row({ webcam_id: 1, rank: 9 }), row({ webcam_id: 2, rank: 2 }),
    ]);
    expect(state.sunset.map((c) => c.rank)).toEqual([2, 9]);
  });

  it('handles null rank and sorts nulls last', () => {
    const { state } = rowsToSceneState([
      row({ webcam_id: 1, rank: 1 }), row({ webcam_id: 2, rank: null }),
    ]);
    expect(state.sunset.map((c) => c.rank)).toEqual([1, undefined]);
  });

  it('preserves null llm fields (quality, is_sunset, model)', () => {
    const { state } = rowsToSceneState([
      row({ llm_quality: null, llm_is_sunset: null, llm_model: null }),
    ]);
    const cam = state.sunset[0];
    expect(cam.llmQuality).toBeNull();
    expect(cam.llmIsSunset).toBeNull();
    expect(cam.llmModel).toBeNull();
  });

  it('returns empty state when given no rows', () => {
    const { state, reconstructed, skipped } = rowsToSceneState([]);
    expect(state.sunrise).toHaveLength(0);
    expect(state.sunset).toHaveLength(0);
    expect(reconstructed).toBe(0);
    expect(skipped).toBe(0);
  });
});

describe('reconstructScene', () => {
  beforeEach(() => sqlMock.mockReset());
  it('queries a window around the timestamp with a nearest-row pick per webcam', async () => {
    sqlMock.mockResolvedValueOnce([row({})]);
    const result = await reconstructScene(new Date('2026-06-21T11:45:00Z'), 45);
    expect(result.reconstructed).toBe(1);
    const query = (sqlMock.mock.calls[0][0] as string[]).join('?');
    expect(query).toContain('DISTINCT ON (s.webcam_id)');
    expect(query).toContain('FROM webcam_snapshots s');
  });
});

describe('rowsToSceneState — both judges', () => {
  it('converts archive probabilities onto the 1-5 rating scale the gate reads', () => {
    // 0.800 as a probability is 1 + 0.8 * 4 = 4.2 as a rating. Passing the
    // raw 0.800 through would sit below every gate setting.
    const [cam] = rowsToSceneState([
      row({ ai_binary_score: '0.800', ai_regression_score: '0.500' }),
    ]).state.sunset;
    expect(cam.aiRatingBinary).toBeCloseTo(4.2, 6);
    expect(cam.aiRatingRegression).toBeCloseTo(3, 6);
  });

  it('leaves the model fields undefined when the archive never scored the frame', () => {
    const [cam] = rowsToSceneState([row({})]).state.sunset;
    expect(cam.aiRatingBinary).toBeUndefined();
    expect(cam.aiRatingRegression).toBeUndefined();
  });

  it('still carries Claude alongside, so auto can fall back', () => {
    const [cam] = rowsToSceneState([row({ ai_binary_score: '0.900' })]).state.sunset;
    expect(cam.aiRatingBinary).toBeCloseTo(4.6, 6);
    expect(cam.llmQuality).toBeCloseTo(0.8125, 6);
  });

  it('records the model versions, so a re-scored scene is traceable', () => {
    const [cam] = rowsToSceneState([
      row({ ai_model_version_binary: 'v5_binary', ai_model_version_regression: 'v5_quality' }),
    ]).state.sunset;
    expect(cam.aiModelVersionBinary).toBe('v5_binary');
    expect(cam.aiModelVersionRegression).toBe('v5_quality');
  });
});
