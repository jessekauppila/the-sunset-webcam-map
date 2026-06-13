// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/lib/recordAim', () => ({ recordAim: vi.fn() }));
import { recordAim } from '@/app/lib/recordAim';
import { POST } from './route';

beforeEach(() => vi.mocked(recordAim).mockReset());

function post(body: unknown) {
  return new Request('http://x', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
const params = (code: string) => ({ params: Promise.resolve({ code }) });

describe('POST /api/setup/[code]/record-aim', () => {
  it('400s when heading_deg is missing or not a number', async () => {
    const res = await POST(post({ source: 'phone' }), params('SUNSET-X-Y'));
    expect(res.status).toBe(400);
    expect(recordAim).not.toHaveBeenCalled();
  });

  it('404s when the code resolves to no camera', async () => {
    vi.mocked(recordAim).mockResolvedValueOnce(null);
    const res = await POST(post({ heading_deg: 247, source: 'phone' }), params('SUNSET-X-Y'));
    expect(res.status).toBe(404);
  });

  it('writes the aim and returns it', async () => {
    vi.mocked(recordAim).mockResolvedValueOnce({ cameraId: 1, azimuthDeg: 247 });
    const res = await POST(
      post({ heading_deg: 247, source: 'phone', lat: 48.75, lng: -122.48 }),
      params('SUNSET-X-Y')
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cameraId: 1, azimuthDeg: 247 });
    expect(recordAim).toHaveBeenCalledWith('SUNSET-X-Y', {
      headingDeg: 247, source: 'phone', lat: 48.75, lng: -122.48,
    });
  });
});
