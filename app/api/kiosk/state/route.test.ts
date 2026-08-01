// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getKioskDozeMock = vi.fn();
vi.mock('@/app/lib/cache', () => ({
  getKioskDoze: () => getKioskDozeMock(),
}));

import { GET } from './route';

describe('GET /api/kiosk/state', () => {
  beforeEach(() => getKioskDozeMock.mockReset());
  it('returns the doze flag', async () => {
    getKioskDozeMock.mockResolvedValueOnce(true);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ doze: true });
  });
});
