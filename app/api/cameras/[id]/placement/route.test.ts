// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyDeviceTokenMock = vi.fn();
const sqlMock = vi.fn();
const derivePlacementStatusMock = vi.fn();

vi.mock('@/app/lib/cameraAuth', () => ({ verifyDeviceToken: (...a: unknown[]) => verifyDeviceTokenMock(...a) }));
vi.mock('@/app/lib/db', () => ({ sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v) }));
vi.mock('@/app/lib/cameraDeployment', () => ({ derivePlacementStatus: (...a: unknown[]) => derivePlacementStatusMock(...a) }));

import { POST } from './route';

beforeEach(() => {
  verifyDeviceTokenMock.mockReset();
  sqlMock.mockReset();
  derivePlacementStatusMock.mockReset();
});

function req(opts: { id?: string; bearer?: string; body?: unknown }) {
  const headers: HeadersInit = { 'content-type': 'application/json' };
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Request(`http://test/api/cameras/${opts.id ?? '42'}/placement`, {
    method: 'POST', headers, body: JSON.stringify(opts.body ?? {}),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST /api/cameras/[id]/placement', () => {
  it('401 when unauthenticated', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce(null);
    const res = await POST(req({ bearer: 'bad', body: { azimuth_deg: 270, tilt_deg: 2 } }), ctx('42'));
    expect(res.status).toBe(401);
  });

  it('saves the aim to the active deployment and reports ready', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42 });
    sqlMock.mockResolvedValueOnce([{ lat: 48.7, lng: -122.4, azimuth_deg: 270, tilt_deg: 2 }]);
    derivePlacementStatusMock.mockReturnValueOnce('ready');

    const res = await POST(req({ bearer: 'good', body: { azimuth_deg: 270, tilt_deg: 2, confirmed_at: '2026-06-07T00:00:00Z' } }), ctx('42'));

    expect(res.status).toBe(200);
    expect((await res.json()).placement_status).toBe('ready');

    // The SQL must target webcams (the active deployment), not cameras
    const [sqlTemplate] = sqlMock.mock.calls[0];
    const query = sqlTemplate.join('$');
    expect(query).toMatch(/UPDATE\s+webcams/i);
    expect(query).toMatch(/coarse\s*=\s*FALSE/i);
    expect(query).toMatch(/custom_camera_id/i);
    expect(query).toMatch(/ended_at\s+IS\s+NULL/i);
  });

  it('404 when no active deployment exists for camera', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42 });
    sqlMock.mockResolvedValueOnce([]); // 0 rows = no active deployment
    const res = await POST(req({ bearer: 'good', body: { azimuth_deg: 270, tilt_deg: 2 } }), ctx('42'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('no active deployment for camera');
  });

  it('400 on non-numeric aim', async () => {
    verifyDeviceTokenMock.mockResolvedValueOnce({ id: 42 });
    const res = await POST(req({ bearer: 'good', body: { azimuth_deg: 'x' } }), ctx('42'));
    expect(res.status).toBe(400);
  });
});
