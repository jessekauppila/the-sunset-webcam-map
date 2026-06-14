// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const sqlMock = vi.fn();
const requireOwnerMock = vi.fn();
const computeCameraHealthMock = vi.fn();
const getWindowMock = vi.fn();
const isInWindowNowMock = vi.fn();

vi.mock('@/app/lib/db', () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values);
  return { sql };
});

vi.mock('@/app/lib/owner', () => ({
  requireOwner: (...a: unknown[]) => requireOwnerMock(...a),
}));

vi.mock('@/app/lib/cameraHealth', () => ({
  computeCameraHealth: (...a: unknown[]) => computeCameraHealthMock(...a),
  getMostRecentExpectedWindow: (...a: unknown[]) => getWindowMock(...a),
  isInWindowNow: (...a: unknown[]) => isInWindowNowMock(...a),
}));

import { GET } from './route';

const makeRequest = (search = '') =>
  new Request(`http://test/api/my-cameras${search}`);

beforeEach(() => {
  sqlMock.mockReset().mockResolvedValue([]);
  requireOwnerMock.mockReset().mockResolvedValue(null); // authorized owner
  computeCameraHealthMock.mockReset().mockReturnValue('live');
  getWindowMock.mockReset().mockReturnValue(null);
  isInWindowNowMock.mockReset().mockReturnValue(false);
});

describe('GET /api/my-cameras', () => {
  it('returns 401 before any query when not the owner', async () => {
    requireOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('returns 403 (and runs no query) for a signed-in non-owner', async () => {
    requireOwnerMock.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('default mode: query joins on ended_at is null and excludes retired', async () => {
    await GET(makeRequest());
    const q = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join('');
    expect(q).toMatch(/from cameras c/i);
    expect(q).toMatch(/ended_at is null/i);
    expect(q).toMatch(/status.*<>.*'retired'/i);
  });

  it('includeEnded=1: query does NOT restrict ended_at is null', async () => {
    await GET(makeRequest('?includeEnded=1'));
    const q = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join('');
    expect(q).not.toMatch(/ended_at is null/i);
    expect(q).toMatch(/status.*<>.*'retired'/i);
  });

  it('maps a row with a webcam_id, coercing NUMERIC strings and ISO dates', async () => {
    computeCameraHealthMock.mockReturnValue('stale');
    isInWindowNowMock.mockReturnValue(true);
    sqlMock.mockResolvedValue([
      {
        camera_id: 7,
        webcam_id: 42,
        lat: '40.123456',
        lng: '-74.654321',
        phase_preference: 'sunset',
        last_heartbeat_at: '2026-06-09T04:00:00.000Z',
        title: 'deck-west',
        latest_snapshot_url: 'https://x/y.jpg',
        latest_snapshot_captured_at: '2026-06-09T04:01:00.000Z',
        state: 'active',
        ended_at: null,
      },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      markerId: 42,
      cameraId: 7,
      webcamId: 42,
      title: 'deck-west',
      lat: 40.123456,
      lng: -74.654321,
      health: 'stale',
      isInWindowNow: true,
      lastHeartbeatAt: '2026-06-09T04:00:00.000Z',
      lastSnapshotAt: '2026-06-09T04:01:00.000Z',
      latestSnapshotUrl: 'https://x/y.jpg',
      phase: 'sunset',
      state: 'active',
      ended_at: null,
    });
  });

  it('uses the offset marker id when a camera has no webcam_id, and null timestamps', async () => {
    computeCameraHealthMock.mockReturnValue('never');
    sqlMock.mockResolvedValue([
      {
        camera_id: 3,
        webcam_id: null,
        lat: '10',
        lng: '20',
        phase_preference: 'both',
        last_heartbeat_at: null,
        title: 'barn-cam',
        latest_snapshot_url: null,
        latest_snapshot_captured_at: null,
        state: null,
        ended_at: null,
      },
    ]);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body[0].markerId).toBe(1_000_000_003);
    expect(body[0].webcamId).toBeNull();
    expect(body[0].health).toBe('never');
    expect(body[0].lastHeartbeatAt).toBeNull();
    expect(body[0].lastSnapshotAt).toBeNull();
    expect(body[0].state).toBeNull();
    expect(body[0].ended_at).toBeNull();
  });

  it('includeEnded=1: an ended deployment row maps into the output with state+ended_at', async () => {
    computeCameraHealthMock.mockReturnValue('offline');
    sqlMock.mockResolvedValue([
      {
        camera_id: 5,
        webcam_id: 99,
        lat: '47.6',
        lng: '-122.3',
        phase_preference: 'sunset',
        last_heartbeat_at: '2026-05-01T03:00:00.000Z',
        title: 'old-spot',
        latest_snapshot_url: null,
        latest_snapshot_captured_at: null,
        state: 'ended',
        ended_at: '2026-06-01T00:00:00.000Z',
      },
    ]);
    const res = await GET(makeRequest('?includeEnded=1'));
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      markerId: 99,
      cameraId: 5,
      webcamId: 99,
      state: 'ended',
      ended_at: '2026-06-01T00:00:00.000Z',
      health: 'offline',
    });
  });

  it('lat/lng come from the deployment (webcams) row, not the cameras row', async () => {
    // The deployment row carries the placement; the route should use w.lat / w.lng.
    // We verify this by checking the query joins on webcams aliased as w and selects w.lat.
    await GET(makeRequest());
    const q = (sqlMock.mock.calls[0][0] as TemplateStringsArray).join('');
    // Should join webcams with the deployment condition
    expect(q).toMatch(/join webcams w/i);
    expect(q).toMatch(/w\.custom_camera_id\s*=\s*c\.id/i);
    // Placement columns should come from the deployment row
    expect(q).toMatch(/w\.lat/i);
    expect(q).toMatch(/w\.lng/i);
  });
});
