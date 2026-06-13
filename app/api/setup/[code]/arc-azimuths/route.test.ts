// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/setupCamera', () => ({ getCameraByClaimCode: vi.fn() }));
import { getCameraByClaimCode } from '@/app/lib/setupCamera';
import { GET } from './route';

beforeEach(() => vi.mocked(getCameraByClaimCode).mockReset());

const params = (code: string) => ({ params: Promise.resolve({ code }) });

describe('GET /api/setup/[code]/arc-azimuths', () => {
  it('404s for an unknown code', async () => {
    vi.mocked(getCameraByClaimCode).mockResolvedValueOnce(null);
    const res = await GET(new Request('http://x'), params('SUNSET-X-Y'));
    expect(res.status).toBe(404);
  });

  it('returns the sunset arc + facing for a west camera', async () => {
    vi.mocked(getCameraByClaimCode).mockResolvedValueOnce({
      cameraId: 1, lat: 48.75, lng: -122.48, phase: 'sunset', azimuthDeg: null,
    });
    const res = await GET(new Request('http://x'), params('SUNSET-X-Y'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facing).toBe('west');
    expect(body.equinox).toBeCloseTo(270, 0);
  });

  it('mirrors to sunrise/east for a sunrise camera', async () => {
    vi.mocked(getCameraByClaimCode).mockResolvedValueOnce({
      cameraId: 2, lat: 48.75, lng: -122.48, phase: 'sunrise', azimuthDeg: null,
    });
    const res = await GET(new Request('http://x'), params('SUNSET-X-Y'));
    const body = await res.json();
    expect(body.facing).toBe('east');
    expect(body.equinox).toBeCloseTo(90, 0);
  });
});
