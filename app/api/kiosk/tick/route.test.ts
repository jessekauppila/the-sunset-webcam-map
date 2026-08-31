// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const acquireKioskTickLockMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  acquireKioskTickLock: () => acquireKioskTickLockMock(),
}));

const cronGetMock = vi.fn();
vi.mock('@/app/api/cron/update-cameras/route', () => ({
  GET: (req: Request) => cronGetMock(req),
}));

import { POST } from './route';

describe('POST /api/kiosk/tick', () => {
  beforeEach(() => {
    acquireKioskTickLockMock.mockReset();
    cronGetMock.mockReset();
    process.env.CRON_SECRET = 'shh';
  });

  it('throttles when the lock is held', async () => {
    acquireKioskTickLockMock.mockResolvedValueOnce(false);
    const res = await POST();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ throttled: true });
    expect(cronGetMock).not.toHaveBeenCalled();
  });

  it('runs a tick with internal cron auth when the lock is acquired', async () => {
    acquireKioskTickLockMock.mockResolvedValueOnce(true);
    cronGetMock.mockResolvedValueOnce(
      NextResponse.json({ ok: true, windyScored: 3 }),
    );
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tick.windyScored).toBe(3);
    const forwarded = cronGetMock.mock.calls[0][0] as Request;
    expect(forwarded.headers.get('authorization')).toBe('Bearer shh');
  });

  it('returns 500 when the tick itself fails', async () => {
    acquireKioskTickLockMock.mockResolvedValueOnce(true);
    cronGetMock.mockRejectedValueOnce(new Error('boom'));
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
