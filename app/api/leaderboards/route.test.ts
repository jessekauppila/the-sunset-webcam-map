// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlQueryMock = vi.fn();
vi.mock('@/app/lib/db', () => ({
  sql: { query: (...a: unknown[]) => sqlQueryMock(...a) },
}));

import { GET } from './route';

beforeEach(() => {
  sqlQueryMock.mockReset().mockResolvedValue([]);
});

const req = (qs = '') => new Request(`http://test/api/leaderboards${qs}`);

describe('GET /api/leaderboards', () => {
  it('defaults to overall / all-time, ranks Claude-primary with a real-model fallback', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grouping).toBe('overall');
    expect(body.window).toBe('all-time');
    const [text, params] = sqlQueryMock.mock.calls[0];
    // Unified [0,1] rank key: Claude when present, else the real model score.
    expect(text).toMatch(/ORDER BY COALESCE\(s\.llm_quality, s\.ai_regression_score\) DESC/i);
    // Claude-judged sunsets still qualify.
    expect(text).toMatch(/llm_quality IS NOT NULL AND s\.llm_is_sunset = true/i);
    expect(params).toEqual([60]);
  });

  it('admits Claude-null frames only with a real regression score above the model floor', async () => {
    await GET(req());
    const [text] = sqlQueryMock.mock.calls[0];
    // Fallback clause: Claude-null + real model score >= MODEL_SUNSET_MIN.
    expect(text).toMatch(
      /s\.llm_quality IS NULL AND s\.ai_regression_score IS NOT NULL AND s\.ai_regression_score >= 0\.6/i,
    );
  });

  it('never ranks by the junk legacy ai_rating column', async () => {
    await GET(req());
    const [text] = sqlQueryMock.mock.calls[0];
    // ai_rating may be SELECTed for comparison, but must not drive ordering.
    const orderByClause = text.slice(text.search(/ORDER BY/i));
    expect(orderByClause).not.toMatch(/ai_rating\b/i);
  });

  it('excludes Flickr structurally — never joins external_images', async () => {
    await GET(req());
    const [text] = sqlQueryMock.mock.calls[0];
    expect(text).not.toMatch(/external_images/i);
  });

  it('never selects sensitive columns (allow-list is structural)', async () => {
    await GET(req());
    const [text] = sqlQueryMock.mock.calls[0];
    expect(text).not.toMatch(/user_session_id/i);
    expect(text).not.toMatch(/device_token_hash/i);
    expect(text).not.toMatch(/select\s+\*\s+from\s+webcam_snapshots/i);
  });

  it('uses DISTINCT ON for per-webcam grouping (best frame per webcam)', async () => {
    await GET(req('?grouping=webcam'));
    const [text] = sqlQueryMock.mock.calls[0];
    expect(text).toMatch(/DISTINCT ON \(s\.webcam_id\)/i);
  });

  it('groups per country with an Unknown bucket', async () => {
    await GET(req('?grouping=country'));
    const [text] = sqlQueryMock.mock.calls[0];
    expect(text).toMatch(/DISTINCT ON \(w\.country\)/i);
    expect(text).toMatch(/COALESCE\(w\.country, 'Unknown'\)/i);
  });

  it('applies the today window filter', async () => {
    await GET(req('?window=today'));
    const [text] = sqlQueryMock.mock.calls[0];
    expect(text).toMatch(/date_trunc\('day', NOW\(\)\)/i);
  });

  it('ignores invalid grouping/window and clamps limit to 500', async () => {
    const res = await GET(req('?grouping=bogus&window=bogus&limit=9999'));
    const body = await res.json();
    expect(body.grouping).toBe('overall');
    expect(body.window).toBe('all-time');
    const [, params] = sqlQueryMock.mock.calls[0];
    expect(params).toEqual([500]);
  });

  it('sets a CDN cache header', async () => {
    const res = await GET(req());
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=60/);
  });

  it('filters to a single webcam when webcam_id is provided (bound param)', async () => {
    await GET(req('?webcam_id=42'));
    const [text, params] = sqlQueryMock.mock.calls[0];
    expect(text).toMatch(/AND s\.webcam_id = \$2/i);
    expect(params).toEqual([60, 42]);
  });

  it('ignores a non-numeric webcam_id and adds no filter', async () => {
    await GET(req('?webcam_id=abc'));
    const [text, params] = sqlQueryMock.mock.calls[0];
    expect(text).not.toMatch(/s\.webcam_id = /i);
    expect(params).toEqual([60]);
  });

  // Kasane: Chobe Savanna Lodge, the camera whose board entry announced itself
  // as a sunrise. Coordinates and capture times are the real archive rows.
  const kasane = (over: Record<string, unknown>) => ({
    id: 82891,
    llmQuality: '0.820',
    llmIsSunset: true,
    llmIsSunrise: true,
    firebaseUrl: 'https://storage.googleapis.com/f.jpg',
    webcamId: 2926965,
    webcamTitle: 'Kasane: Chobe Savanna Lodge - Chobe National Park',
    country: 'Botswana',
    lat: -17.8306,
    lng: 25.05327,
    ...over,
  });

  it('reads captured_at as UTC — a naive column read raw is hours off', async () => {
    await GET(req());
    const [text] = sqlQueryMock.mock.calls[0];
    expect(text).toMatch(/\(s\.captured_at AT TIME ZONE 'UTC'\) AS "capturedAt"/i);
  });

  it('selects the coordinates the phase is computed from, as numbers', async () => {
    await GET(req());
    const [text] = sqlQueryMock.mock.calls[0];
    expect(text).toMatch(/w\.lat::float8 AS "lat"/i);
    expect(text).toMatch(/w\.lng::float8 AS "lng"/i);
  });

  it('stamps phase from the sun, not from Claude — a climbing sun is a sunrise', async () => {
    // Claude says sunrise AND sunset here, which is why the frame is on a
    // sunset board at all. The sun was on the horizon and climbing.
    sqlQueryMock.mockResolvedValue([kasane({ capturedAt: '2026-03-14T04:27:24.354Z' })]);
    const body = await (await GET(req())).json();
    expect(body.entries[0].phase).toBe('sunrise');
  });

  it('calls a falling sun a sunset even when Claude called it a sunrise', async () => {
    sqlQueryMock.mockResolvedValue([
      kasane({ capturedAt: '2026-03-14T15:44:35.470Z', llmIsSunrise: true }),
    ]);
    const body = await (await GET(req())).json();
    expect(body.entries[0].phase).toBe('sunset');
  });

  it('leaves phase null when the row has no coordinate to compute from', async () => {
    sqlQueryMock.mockResolvedValue([
      kasane({ capturedAt: '2026-03-14T04:27:24.354Z', lat: null, lng: null }),
    ]);
    const body = await (await GET(req())).json();
    expect(body.entries[0].phase).toBeNull();
  });
});
