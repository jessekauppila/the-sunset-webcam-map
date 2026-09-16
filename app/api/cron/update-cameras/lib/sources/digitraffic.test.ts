// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';

// The adapter names its flag from runtimeFlags, which opens the Neon client
// at import time; nothing here touches a database.
vi.mock('@/app/lib/runtimeFlags', () => ({ SOURCE_DIGITRAFFIC: 'source_digitraffic' }));
import fixture from './__fixtures__/digitraffic-stations.json';
import {
  DIGITRAFFIC_CREDIT,
  DIGITRAFFIC_STATIONS_URL,
  digitrafficSource,
  parseDigitrafficStations,
  withImageVersions,
} from './digitraffic';
import type { SourceCamera } from './types';

// The fixture is a trimmed real /api/weathercam/v1/stations response read
// 2026-09-15: Inkoo (gathering, 3 presets), Utsjoki Nuorgam (gathering, 4
// presets, 70 N), Loviisa (gathering, 1 of 3 presets in collection), and one
// station REMOVED_TEMPORARILY.
const everywhere = () => true;

describe('parseDigitrafficStations', () => {
  it('lists every preset in collection at a gathering station and says why it set the rest aside', () => {
    const r = parseDigitrafficStations(fixture, { within: everywhere });
    expect(r.stations).toBe(4);
    expect(r.cameras).toHaveLength(8);
    expect(r.skipped).toEqual({ station_not_gathering: 1, preset_not_in_collection: 2 });
  });

  it('maps one preset onto the canonical shape: derived image URL, the CC BY credit, no bearing', () => {
    const r = parseDigitrafficStations(fixture, { within: everywhere });
    const cam = r.cameras.find((c) => c.externalId === 'C0150301');
    expect(cam).toEqual({
      source: 'digitraffic',
      externalId: 'C0150301',
      title: 'kt51 Inkoo 01',
      lat: 60.05374,
      lng: 23.99616,
      imageUrl: 'https://weathercam.digitraffic.fi/C0150301.jpg',
      imageAt: null,
      azimuthDeg: null,
      hfovDeg: null,
      country: 'FI',
      region: null,
      city: 'Inkoo',
      attribution: DIGITRAFFIC_CREDIT,
      operator: 'Fintraffic',
    });
    expect(cam?.imageVersion).toBeUndefined();
  });

  it('cuts to the swept band with the same test the Windy sweep uses', () => {
    const arcticOnly = (lat: number) => lat > 65;
    const r = parseDigitrafficStations(fixture, { within: arcticOnly });
    expect(r.cameras.map((c) => c.city)).toEqual(['Utsjoki Nuorgam', 'Utsjoki Nuorgam', 'Utsjoki Nuorgam', 'Utsjoki Nuorgam']);
    // Out-of-band stations are set aside whole, presets not in collection included: Inkoo 3 + Loviisa 3.
    expect(r.skipped.out_of_band).toBe(6);
    expect(r.skipped.preset_not_in_collection).toBeUndefined();
  });

  it('refuses a payload that is not a FeatureCollection', () => {
    expect(() => parseDigitrafficStations({ features: null }, { within: everywhere })).toThrow(/shape/);
    expect(() => parseDigitrafficStations([], { within: everywhere })).toThrow(/shape/);
  });
});

describe('withImageVersions', () => {
  const cam = (id: string): SourceCamera => ({
    source: 'digitraffic', externalId: id, title: id, lat: 60, lng: 24,
    imageUrl: `https://weathercam.digitraffic.fi/${id}.jpg`, imageAt: null,
    azimuthDeg: null, hfovDeg: null, country: 'FI', region: null, city: null,
    attribution: DIGITRAFFIC_CREDIT, operator: 'Fintraffic',
  });
  const headOk = (etag: string | null, lastModified: string | null) => ({
    ok: true,
    status: 200,
    headers: new Headers({ ...(etag ? { etag } : {}), ...(lastModified ? { 'last-modified': lastModified } : {}) }),
  });

  it('sends one HEAD per camera and takes the ETag as the version and Last-Modified as the time', async () => {
    const fetchMock = vi.fn(async () => headOk('"abc"', 'Tue, 15 Sep 2026 15:28:13 GMT'));
    const r = await withImageVersions([cam('C1'), cam('C2')], fetchMock as unknown as typeof fetch, 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual(['https://weathercam.digitraffic.fi/C1.jpg', { method: 'HEAD', cache: 'no-store' }]);
    expect(r.cameras.map((c) => c.imageVersion)).toEqual(['"abc"', '"abc"']);
    expect(r.cameras[0].imageAt).toBe('2026-09-15T15:28:13.000Z');
    expect(r.headFailed).toBe(0);
  });

  it('falls back to Last-Modified when there is no ETag', async () => {
    const fetchMock = vi.fn(async () => headOk(null, 'Tue, 15 Sep 2026 15:28:13 GMT'));
    const r = await withImageVersions([cam('C1')], fetchMock as unknown as typeof fetch);
    expect(r.cameras[0].imageVersion).toBe('Tue, 15 Sep 2026 15:28:13 GMT');
  });

  it('leaves imageVersion undefined, and counts it, when the HEAD fails or carries no marker', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers() })
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(headOk(null, null));
    const r = await withImageVersions([cam('C1'), cam('C2'), cam('C3')], fetchMock as unknown as typeof fetch, 1);
    expect(r.cameras.map((c) => c.imageVersion)).toEqual([undefined, undefined, undefined]);
    expect(r.cameras.map((c) => c.externalId)).toEqual(['C1', 'C2', 'C3']);
    expect(r.headFailed).toBe(3);
  });

  it('keeps every camera in order under bounded concurrency', async () => {
    const fetchMock = vi.fn(async (url: string) => headOk(`"${url.slice(-6, -4)}"`, null));
    const cams = Array.from({ length: 25 }, (_, i) => cam(`C${String(i).padStart(2, '0')}`));
    const r = await withImageVersions(cams, fetchMock as unknown as typeof fetch, 10);
    expect(r.cameras.map((c) => c.externalId)).toEqual(cams.map((c) => c.externalId));
    expect(r.cameras[7].imageVersion).toBe('"07"');
  });
});

describe('digitrafficSource.listCameras', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the stations endpoint once with gzip and the caller header, then HEADs each in-band preset', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return { ok: true, status: 200, headers: new Headers({ etag: `"v-${url.slice(-12, -4)}"` }) };
      }
      return { ok: true, status: 200, json: async () => fixture };
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await digitrafficSource.listCameras({ now: new Date(), within: everywhere });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { next?: { revalidate?: number } }];
    expect(url).toBe(DIGITRAFFIC_STATIONS_URL);
    expect(init.headers).toMatchObject({ 'accept-encoding': 'gzip', 'digitraffic-user': 'sunrisesunset.studio' });
    expect(init.next?.revalidate).toBe(600);
    expect(fetchMock).toHaveBeenCalledTimes(1 + 8);
    expect(r.cameras).toHaveLength(8);
    expect(r.cameras.find((c) => c.externalId === 'C0150301')?.imageVersion).toBe('"v-C0150301"');
    expect(r).toMatchObject({ attempted: 9, failed: 0, skipped: { station_not_gathering: 1, preset_not_in_collection: 2 } });
  });

  it('caps the in-band presets BEFORE the HEAD pass, so listing cost is bounded', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return { ok: true, status: 200, headers: new Headers({ etag: '"v"' }) };
      return { ok: true, status: 200, json: async () => fixture };
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await digitrafficSource.listCameras({ now: new Date(), within: everywhere, maxCameras: 3 });
    // One stations GET plus at most `maxCameras` HEADs -- not one per in-band
    // preset. This is the bound that keeps a dense source inside the tick.
    expect(fetchMock).toHaveBeenCalledTimes(1 + 3);
    expect(r.cameras).toHaveLength(3);
    expect(r.attempted).toBe(4);
    expect(r.skipped).toMatchObject({ over_cap: 5 });
  });

  it('walks a different window of a capped source on the next tick', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return { ok: true, status: 200, headers: new Headers({ etag: '"v"' }) };
      return { ok: true, status: 200, json: async () => fixture };
    });
    vi.stubGlobal('fetch', fetchMock);
    const t0 = new Date('2026-09-16T00:00:00Z');
    const a = await digitrafficSource.listCameras({ now: t0, within: everywhere, maxCameras: 3 });
    const b = await digitrafficSource.listCameras({
      now: new Date(t0.getTime() + 10 * 60 * 1000), within: everywhere, maxCameras: 3,
    });
    expect(a.cameras.map((c) => c.externalId)).not.toEqual(b.cameras.map((c) => c.externalId));
  });

  it('counts a non-OK station list by status instead of throwing, and HEADs nothing', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 406, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await digitrafficSource.listCameras({ now: new Date(), within: everywhere });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ cameras: [], attempted: 1, failed: 1, failedByStatus: { '406': 1 } });
  });

  it('counts a network error instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const r = await digitrafficSource.listCameras({ now: new Date(), within: everywhere });
    expect(r).toMatchObject({ cameras: [], failed: 1, failedByStatus: { error: 1 } });
  });
});
