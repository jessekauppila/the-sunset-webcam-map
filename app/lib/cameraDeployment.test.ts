// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
const sqlMock = vi.fn();
vi.mock('@/app/lib/db', () => ({ sql: (s: TemplateStringsArray, ...v: unknown[]) => sqlMock(s, ...v) }));
import { getActiveDeployment, derivePlacementStatus, upsertActiveDeployment, endActiveDeployment, setDeploymentPaused } from './cameraDeployment';

beforeEach(() => sqlMock.mockReset());

describe('getActiveDeployment', () => {
  it('returns the active (ended_at IS NULL) custom row for a camera', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 9, custom_camera_id: 1, state: 'testing', paused: false,
      lat: 47.6, lng: -122.3, azimuth_deg: 270, tilt_deg: 0 }]);
    const d = await getActiveDeployment(1);
    expect(d?.id).toBe(9);
    expect(d?.state).toBe('testing');
  });
  it('returns null when the camera has no active deployment', async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await getActiveDeployment(1)).toBeNull();
  });
});

describe('derivePlacementStatus', () => {
  it('awaiting_location with no deployment', () => {
    expect(derivePlacementStatus(null)).toBe('awaiting_location');
  });
  it('awaiting_aim when placed but no azimuth', () => {
    expect(derivePlacementStatus({ lat: 47.6, lng: -122.3, azimuth_deg: null, tilt_deg: null } as never)).toBe('awaiting_aim');
  });
  it('ready when placed + aimed', () => {
    expect(derivePlacementStatus({ lat: 47.6, lng: -122.3, azimuth_deg: 270, tilt_deg: 0 } as never)).toBe('ready');
  });
});

const PLACEMENT = {
  lat: 47.6, lng: -122.3, elevation_m: 30, timezone: 'America/Los_Angeles',
  azimuth_deg: 270, tilt_deg: 0, horizon_altitude_deg: 0, horizon_profile: null,
  azimuth_source: 'bracket', coarse: true, bracket: { lens: 'wide_120' },
  phase_preference: 'sunset', delivery_preferences: null,
};

describe('upsertActiveDeployment', () => {
  it('creates deployment #1 when none exists and repoints cameras.webcam_id', async () => {
    sqlMock.mockResolvedValueOnce([]);                       // getActive → none
    sqlMock.mockResolvedValueOnce([{ id: 50, state: 'testing' }]); // INSERT deployment
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);              // UPDATE cameras.webcam_id
    const d = await upsertActiveDeployment(1, PLACEMENT, { state: 'testing', mode: 'reaim' });
    expect(d.id).toBe(50);
    expect(sqlMock.mock.calls[2][0].join('')).toContain('webcam_id');
  });

  it('mode=new ends the active deployment then inserts a fresh one', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 40, state: 'deployed' }]); // getActive → exists
    sqlMock.mockResolvedValueOnce([{ id: 40 }]);                    // UPDATE end old
    sqlMock.mockResolvedValueOnce([{ id: 41, state: 'deployed' }]); // INSERT new
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);                     // repoint
    const d = await upsertActiveDeployment(1, PLACEMENT, { state: 'deployed', mode: 'new' });
    expect(d.id).toBe(41);
    expect(sqlMock.mock.calls[1][0].join('')).toContain('ended_at');
    expect(sqlMock.mock.calls[1][0].join('')).toContain("'ended'");
  });

  it('mode=reaim updates the active deployment in place (no new row, state untouched)', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 40, state: 'deployed' }]); // getActive → exists
    sqlMock.mockResolvedValueOnce([{ id: 40, state: 'deployed' }]); // UPDATE in place
    const d = await upsertActiveDeployment(1, PLACEMENT, { state: 'testing', mode: 'reaim' });
    expect(d.id).toBe(40);
    expect(sqlMock.mock.calls.length).toBe(2);
    expect(sqlMock.mock.calls[1][0].join('')).not.toContain('state =');
  });
});

describe('endActiveDeployment', () => {
  it('ends the active deployment, clears webcam_id, sets wifi_wipe when relocating', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 40 }]);  // UPDATE webcams end
    sqlMock.mockResolvedValueOnce([{ id: 1 }]);   // UPDATE cameras (webcam_id NULL + wifi_wipe)
    const r = await endActiveDeployment(1, { relocate: true });
    expect(r.ended).toBe(true);
    expect(sqlMock.mock.calls[1][0].join('')).toContain('wifi_wipe_requested');
  });
  it('returns ended=false when there was no active deployment', async () => {
    sqlMock.mockResolvedValueOnce([]); // UPDATE end → 0 rows
    sqlMock.mockResolvedValueOnce([{ id: 1 }]); // UPDATE cameras still runs
    const r = await endActiveDeployment(1, { relocate: false });
    expect(r.ended).toBe(false);
  });
});

describe('setDeploymentPaused', () => {
  it('flips paused on the active deployment', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 40, paused: true }]);
    const r = await setDeploymentPaused(1, true);
    expect(r?.paused).toBe(true);
  });
});
