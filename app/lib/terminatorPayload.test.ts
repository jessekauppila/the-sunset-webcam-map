import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();

vi.mock('@/app/lib/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    sqlMock(strings, ...values),
}));

import {
  fetchTerminatorWebcams,
  imagesFromCustomSnapshot,
} from './terminatorPayload';

describe('fetchTerminatorWebcams query shape', () => {
  beforeEach(() => sqlMock.mockReset().mockResolvedValue([]));

  it('selects firebase_url and captured_at via LEFT JOIN LATERAL', async () => {
    await fetchTerminatorWebcams();

    expect(sqlMock).toHaveBeenCalledTimes(1);
    const [strings] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?').toLowerCase();
    expect(fullQuery).toMatch(/left join lateral/);
    expect(fullQuery).toMatch(/ls\.firebase_url/);
    expect(fullQuery).toMatch(/ls\.captured_at/);
    expect(fullQuery).toMatch(/order by captured_at desc/);
    expect(fullQuery).toMatch(/limit 1/);
  });

  it('joins the cameras table for device traceability', async () => {
    await fetchTerminatorWebcams();

    const [strings] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?').toLowerCase();
    expect(fullQuery).toMatch(/left join cameras c on c\.id = w\.custom_camera_id/);
    expect(fullQuery).toMatch(/c\.device_class/);
    expect(fullQuery).toMatch(/c\.firmware_version/);
    expect(fullQuery).toMatch(/c\.hardware_id/);
  });

  it('gates the lateral subquery on source=custom inside its WHERE clause', async () => {
    await fetchTerminatorWebcams();

    const [strings] = sqlMock.mock.calls[0];
    const fullQuery = strings.join('?').toLowerCase();
    // Both halves of the gate must be present within the lateral subquery.
    expect(fullQuery).toMatch(/webcam_id\s*=\s*w\.id\s+and\s+w\.source\s*=\s*'custom'/);
  });
});

describe('fetchTerminatorWebcams row mapping', () => {
  const baseRow = {
    webcam_id: 100, phase: 'sunset', rank: 1,
    id: 100, source: 'windy', external_id: 'ext-100', title: 'A cam',
    status: 'active', view_count: 10,
    lat: 10, lng: 20,
    city: 'X', region: 'Y', country: 'Z', continent: 'NA',
    images: { current: { preview: 'https://windy/p.jpg', icon: 'https://windy/i.jpg', thumbnail: 'https://windy/t.jpg' } },
    urls: null, player: null, categories: null,
    last_fetched_at: '2026-05-14T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-05-14T00:00:00Z',
    rating: null, orientation: null,
    ai_rating: null, ai_model_version: null,
    ai_rating_binary: null, ai_model_version_binary: null,
    ai_rating_regression: null, ai_model_version_regression: null,
    latest_snapshot_url: null,
    latest_snapshot_captured_at: null,
    device_class: null, firmware_version: null, hardware_id: null,
  };

  beforeEach(() => sqlMock.mockReset());

  it('windy row: liveAssetKind = "windy_bundle", no device fields, no latestSnapshotCapturedAt', async () => {
    sqlMock.mockResolvedValue([{ ...baseRow, source: 'windy' }]);

    const result = await fetchTerminatorWebcams();

    expect(result).toHaveLength(1);
    expect(result[0].liveAssetKind).toBe('windy_bundle');
    expect(result[0].deviceClass).toBeUndefined();
    expect(result[0].firmwareVersion).toBeUndefined();
    expect(result[0].hardwareId).toBeUndefined();
    expect(result[0].latestSnapshotCapturedAt).toBeUndefined();
  });

  it('custom row with snapshot: synthesizes images, sets liveAssetKind, populates device fields and captured_at', async () => {
    sqlMock.mockResolvedValue([{
      ...baseRow,
      source: 'custom',
      images: null,
      latest_snapshot_url: 'https://fb/snap.jpg',
      latest_snapshot_captured_at: '2026-05-14T03:30:00Z',
      device_class: 'rpi-zero-2w',
      firmware_version: '0.1.0',
      hardware_id: 'pi-zero-2w-tier0-jesse-house',
    }]);

    const result = await fetchTerminatorWebcams();

    expect(result[0].images).toEqual({ current: { preview: 'https://fb/snap.jpg' } });
    expect(result[0].liveAssetKind).toBe('custom_snapshot');
    expect(result[0].deviceClass).toBe('rpi-zero-2w');
    expect(result[0].firmwareVersion).toBe('0.1.0');
    expect(result[0].hardwareId).toBe('pi-zero-2w-tier0-jesse-house');
    expect(result[0].latestSnapshotCapturedAt).toBe('2026-05-14T03:30:00Z');
  });

  it('custom row, no snapshot ever: images undefined, liveAssetKind undefined, device fields still populated', async () => {
    sqlMock.mockResolvedValue([{
      ...baseRow,
      source: 'custom',
      images: null,
      latest_snapshot_url: null,
      latest_snapshot_captured_at: null,
      device_class: 'rpi-zero-2w',
      firmware_version: '0.1.0',
      hardware_id: 'pi-zero-2w-tier0-jesse-house',
    }]);

    const result = await fetchTerminatorWebcams();

    expect(result[0].images).toBeUndefined();
    expect(result[0].liveAssetKind).toBeUndefined();
    expect(result[0].deviceClass).toBe('rpi-zero-2w');
    expect(result[0].firmwareVersion).toBe('0.1.0');
    expect(result[0].hardwareId).toBe('pi-zero-2w-tier0-jesse-house');
    expect(result[0].latestSnapshotCapturedAt).toBeUndefined();
  });

  it('windy row with empty webcams.images falls back to undefined images (no synthesis on windy source)', async () => {
    sqlMock.mockResolvedValue([{ ...baseRow, source: 'windy', images: null }]);

    const result = await fetchTerminatorWebcams();

    expect(result[0].images).toBeUndefined();
    expect(result[0].liveAssetKind).toBe('windy_bundle');
  });
});

describe('imagesFromCustomSnapshot', () => {
  it('returns undefined when url is null', () => {
    expect(imagesFromCustomSnapshot(null)).toBeUndefined();
  });

  it('returns undefined when url is an empty string', () => {
    expect(imagesFromCustomSnapshot('')).toBeUndefined();
  });

  it('synthesizes a minimal images object with only current.preview populated', () => {
    const url = 'https://storage.googleapis.com/bucket/snapshots/custom/1/x.jpg';
    const result = imagesFromCustomSnapshot(url);

    expect(result).toEqual({
      current: { preview: url },
    });
  });

  it('does not synthesize fabricated sizes, icon, thumbnail, or daylight', () => {
    const url = 'https://example.com/x.jpg';
    const result = imagesFromCustomSnapshot(url);

    expect(result?.sizes).toBeUndefined();
    expect(result?.daylight).toBeUndefined();
    expect(result?.current.icon).toBeUndefined();
    expect(result?.current.thumbnail).toBeUndefined();
  });
});
