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
  it('defaults to overall / all-time, ranks by llm_quality, filters to sunsets', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grouping).toBe('overall');
    expect(body.window).toBe('all-time');
    const [text, params] = sqlQueryMock.mock.calls[0];
    expect(text).toMatch(/ORDER BY s\.llm_quality DESC/i);
    expect(text).toMatch(/llm_quality IS NOT NULL/i);
    expect(text).toMatch(/llm_is_sunset = true/i);
    expect(params).toEqual([60]);
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
});
