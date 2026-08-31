import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (...args: unknown[]) => sqlMock(...args) }));

import { rowsToSceneState, reconstructScene, type HistoricalSnapshotRow } from './reconstruct';

const row = (over: Partial<HistoricalSnapshotRow>): HistoricalSnapshotRow => ({
  webcam_id: 1, phase: 'sunset', rank: 3,
  firebase_url: 'https://firebasestorage.googleapis.com/x.jpg',
  snapshot_captured_at: '2026-06-21T11:40:00Z',
  llm_quality: '0.8125', llm_is_sunset: true, llm_model: 'claude-sonnet-4-5',
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
