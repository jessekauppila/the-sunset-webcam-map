// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { NextResponse } from 'next/server';

const sqlMock = vi.fn();
const requireOwnerMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
}));
// Mock the owner guard so the test doesn't pull in real Auth.js/Google at import.
vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));

import { POST } from './route';

beforeEach(() => {
  sqlMock.mockReset();
  requireOwnerMock.mockReset();
  requireOwnerMock.mockResolvedValue(null); // default: authorized owner
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

  it('returns 401 when the caller is not the owner (gated, before any write)', async () => {
    requireOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    );
    const res = await POST(
      makeReq({ userSessionId: 's1', rating: 5 }),
      makeContext('1'),
    );
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
