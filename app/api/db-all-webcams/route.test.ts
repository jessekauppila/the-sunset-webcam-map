// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v),
}));

import { GET } from './route';

beforeEach(() => sqlMock.mockReset());

const windyRow = {
  id: 1,
  source: 'windy',
  external_id: 'w1',
  title: 'Windy Cam',
  status: 'active',
  view_count: 42,
  lat: 10,
  lng: 20,
  city: 'Seattle',
  region: 'WA',
  country: 'US',
  continent: 'NA',
  images: null,
  urls: null,
  player: null,
  categories: null,
  last_fetched_at: '2026-01-01T00:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  rating: null,
  orientation: null,
  ai_rating: null,
  ai_model_version: null,
  ai_rating_binary: null,
  ai_model_version_binary: null,
  ai_rating_regression: null,
  ai_model_version_regression: null,
};

const customRow = {
  id: 2,
  source: 'custom',
  external_id: 'custom-1-123',
  title: 'Camera 1',
  status: 'active',
  view_count: null,
  lat: 47.6,
  lng: -122.3,
  city: 'Bellingham',
  region: 'WA',
  country: 'US',
  continent: 'NA',
  images: null,
  urls: null,
  player: null,
  categories: null,
  last_fetched_at: '2026-01-01T00:00:00Z',
  created_at: '2025-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
  rating: null,
  orientation: null,
  ai_rating: null,
  ai_model_version: null,
  ai_rating_binary: null,
  ai_model_version_binary: null,
  ai_rating_regression: null,
  ai_model_version_regression: null,
};

describe('GET /api/db-all-webcams', () => {
  it('SQL contains live-custom guard (state, deployed, ended_at, paused, source)', async () => {
    sqlMock.mockResolvedValueOnce([windyRow]);
    await GET();
    const q: string = sqlMock.mock.calls[0][0].join('');
    expect(q).toContain('state');
    expect(q).toContain("'deployed'");
    expect(q).toContain('ended_at');
    expect(q).toContain('paused');
    expect(q).toContain('source');
  });

  it('maps Windy and custom rows correctly when both pass the SQL filter', async () => {
    sqlMock.mockResolvedValueOnce([windyRow, customRow]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);

    const windy = body.find((w: { source: string }) => w.source === 'windy');
    expect(windy).toBeDefined();
    expect(windy.location.latitude).toBe(10);
    expect(windy.location.longitude).toBe(20);

    const custom = body.find((w: { source: string }) => w.source === 'custom');
    expect(custom).toBeDefined();
    expect(custom.location.latitude).toBe(47.6);
    expect(custom.location.longitude).toBe(-122.3);
    expect(custom.externalId).toBe('custom-1-123');
  });
});
