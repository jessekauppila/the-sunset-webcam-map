// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TERMINATOR_POOL_COVERAGE_DEG } from '@/app/lib/masterConfig';

const getSweptZone = vi.fn();
const isFlagEnabled = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/app/lib/db', () => ({ sql: vi.fn() }));
vi.mock('@/app/lib/solo/store', () => ({ getSweptZone: () => getSweptZone() }));
vi.mock('@/app/lib/runtimeFlags', () => ({
  isFlagEnabled: () => isFlagEnabled(),
  SWEEP_FORCE_DAY_RING: 'sweep_force_day_ring',
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  isFlagEnabled.mockResolvedValue(false);
});

describe('GET /api/sweep-zone', () => {
  it('returns the zone the cron last recorded', async () => {
    getSweptZone.mockResolvedValue({ minDeg: -16, maxDeg: 21.75 });
    const body = await (await GET()).json();
    expect(body).toEqual({ zone: { minDeg: -16, maxDeg: 21.75 }, recorded: true, forcedDayRing: false });
  });

  it('falls back to the guaranteed rings and says so when nothing is recorded', async () => {
    getSweptZone.mockResolvedValue(null);
    const body = await (await GET()).json();
    expect(body.zone).toEqual({ minDeg: TERMINATOR_POOL_COVERAGE_DEG.min, maxDeg: TERMINATOR_POOL_COVERAGE_DEG.max });
    expect(body.recorded).toBe(false);
  });

  it('widens the fallback to the day ring when the force flag is on', async () => {
    getSweptZone.mockResolvedValue(null);
    isFlagEnabled.mockResolvedValue(true);
    const body = await (await GET()).json();
    expect(body.forcedDayRing).toBe(true);
    expect(body.zone.maxDeg).toBeGreaterThan(TERMINATOR_POOL_COVERAGE_DEG.max);
  });
});
