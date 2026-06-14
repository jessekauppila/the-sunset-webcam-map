// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { GET } from './route';

describe('GET /api/setup/declination', () => {
  it('400s when lat/lng are missing or non-numeric', async () => {
    expect((await GET(new Request('http://x/api/setup/declination'))).status).toBe(400);
    expect((await GET(new Request('http://x/api/setup/declination?lat=foo&lng=bar'))).status).toBe(400);
  });

  it('returns declination for a lat/lng (Bellingham ~+15°)', async () => {
    const res = await GET(new Request('http://x/api/setup/declination?lat=48.75&lng=-122.48'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.declinationDeg).toBeGreaterThan(13);
    expect(body.declinationDeg).toBeLessThan(17);
  });
});
