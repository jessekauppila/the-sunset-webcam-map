// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
}));

import { POST } from './route';

beforeEach(() => {
  sqlMock.mockReset();
});

function makeReq(body: Record<string, unknown>): Request {
  return new Request('http://test/api/snapshots/1/rate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/snapshots/[id]/rate', () => {
  it('accepts star-only rating (back-compat with existing UX)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 1 }])           // snapshot exists check
      .mockResolvedValueOnce(undefined)              // upsert rating
      .mockResolvedValueOnce([{ avg_rating: 4.5 }]) // avg recompute
      .mockResolvedValueOnce(undefined)              // update calculated_rating
      .mockResolvedValueOnce([{ majority: null }])  // verdict majority recompute
      .mockResolvedValueOnce(undefined)              // update human_sunset_majority
      .mockResolvedValueOnce([{ rating_count: 3 }]);// count
    const res = await POST(
      makeReq({ userSessionId: 's1', rating: 5 }),
      makeContext('1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.calculatedRating).toBe(4.5);
  });

  it('accepts verdict-only submit (No path — no rating allowed)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ avg_rating: null }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ majority: false }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ rating_count: 1 }]);
    const res = await POST(
      makeReq({ userSessionId: 's1', isSunsetVerdict: false }),
      makeContext('1'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('accepts verdict + rating together (Yes path)', async () => {
    sqlMock
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ avg_rating: 4.0 }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ majority: true }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ rating_count: 1 }]);
    const res = await POST(
      makeReq({ userSessionId: 's1', isSunsetVerdict: true, rating: 4 }),
      makeContext('1'),
    );
    expect(res.status).toBe(200);
  });

  it('rejects rating without verdict=true', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);
    const res = await POST(
      makeReq({ userSessionId: 's1', isSunsetVerdict: false, rating: 4 }),
      makeContext('1'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/can't rate non-sunsets|cannot rate/i);
  });

  it('rejects an empty submit (neither rating nor verdict)', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);
    const res = await POST(
      makeReq({ userSessionId: 's1' }),
      makeContext('1'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required|provide/i);
  });

  it('rejects missing userSessionId', async () => {
    const res = await POST(makeReq({ rating: 5 }), makeContext('1'));
    expect(res.status).toBe(400);
  });
});
