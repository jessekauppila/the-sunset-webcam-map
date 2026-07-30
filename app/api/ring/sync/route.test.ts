import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/app/lib/ring/ringStore', () => ({
  loadSession: vi.fn(),
  saveSession: vi.fn(),
}));
vi.mock('@/app/lib/ring/rankedCameras', () => ({
  getRankedCameras: vi.fn(),
}));

import { loadSession, saveSession } from '@/app/lib/ring/ringStore';
import { getRankedCameras } from '@/app/lib/ring/rankedCameras';
import { POST } from './route';

const mockLoad = vi.mocked(loadSession);
const mockSave = vi.mocked(saveSession);
const mockCams = vi.mocked(getRankedCameras);

function req(body: unknown): NextRequest {
  return new NextRequest('http://test/api/ring/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockLoad.mockReset();
  mockSave.mockReset().mockResolvedValue(undefined);
  mockCams.mockReset();
});

describe('POST /api/ring/sync', () => {
  it('400s when phoneId is missing', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('assigns the best camera to a new phone and returns a slot', async () => {
    mockLoad.mockResolvedValue({ claims: {} });
    mockCams.mockResolvedValue([
      { id: 10, lng: -120, title: 'A', imageUrl: 'a.jpg' },
      { id: 20, lng: 30, title: 'B', imageUrl: 'b.jpg' },
    ]);
    const res = await POST(req({ phoneId: 'p1' }));
    const json = await res.json();
    expect(json.assigned).toBe(true);
    expect(json.camera).toEqual({ id: 10, title: 'A', imageUrl: 'a.jpg' });
    expect(json.slot).toEqual({ index: 0, total: 1, angleDeg: 0 });
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('reports no_camera_available when the ring is saturated', async () => {
    mockLoad.mockResolvedValue({
      claims: { other: { cameraId: 10, claimedAt: 1, lastHeartbeat: Date.now() } },
    });
    mockCams.mockResolvedValue([{ id: 10, lng: 0, title: 'A', imageUrl: 'a.jpg' }]);
    const res = await POST(req({ phoneId: 'p1' }));
    const json = await res.json();
    expect(json.assigned).toBe(false);
    expect(json.reason).toBe('no_camera_available');
  });

  it('releases the phone when leave is true', async () => {
    mockLoad.mockResolvedValue({
      claims: { p1: { cameraId: 10, claimedAt: 1, lastHeartbeat: Date.now() } },
    });
    mockCams.mockResolvedValue([{ id: 10, lng: 0, title: 'A', imageUrl: 'a.jpg' }]);
    const res = await POST(req({ phoneId: 'p1', leave: true }));
    const json = await res.json();
    expect(json.left).toBe(true);
    expect(mockSave).toHaveBeenCalledOnce();
  });
});
