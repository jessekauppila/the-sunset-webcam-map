// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';

// The adapter names its flag from runtimeFlags, which opens the Neon client
// at import time; nothing here touches a database.
vi.mock('@/app/lib/runtimeFlags', () => ({ SOURCE_FAA: 'source_faa' }));
import fixture from './__fixtures__/faa-redistributable.json';
import {
  FAA_REDISTRIBUTABLE_URL,
  FAA_TOKEN_ENV,
  faaAuthHeaders,
  faaSource,
  parseFaaSites,
} from './faa';

// The fixture is a trimmed real /api/redistributable/sites response read
// 2026-09-15 02:50Z: Nyac (FAA-operated, 4 fresh cameras), Kahe (third party,
// ALERTWest attribution, 4 fresh cameras), Mountain Village (in maintenance,
// 4 out-of-order cameras with no image), Chignik Bay (in maintenance, frames
// five hours old), Bermuda Run (a site with no cameras at all).
const NOW = new Date('2026-09-15T02:50:00Z');
const everywhere = () => true;

describe('parseFaaSites', () => {
  it('lists the FAA-operated, fresh, in-band cameras and says why it set the rest aside', () => {
    const r = parseFaaSites(fixture, { now: NOW, within: everywhere });
    expect(r.sites).toBe(5);
    expect(r.cameras.map((c) => c.externalId).sort()).toEqual(['10679', '10680', '10681', '10682']);
    expect(r.skipped).toEqual({ third_party: 4, site_maintenance: 8 });
  });

  it('maps one camera onto the canonical shape, bearing and field of view included', () => {
    const r = parseFaaSites(fixture, { now: NOW, within: everywhere });
    const cam = r.cameras.find((c) => c.externalId === '10679');
    expect(cam).toEqual({
      source: 'faa',
      externalId: '10679',
      title: 'Nyac NorthEast',
      lat: 60.97839,
      lng: -160.0021,
      imageUrl: 'https://images.wcams-static.faa.gov/webimages/206/15/10679-1789440191468.jpg',
      imageAt: '2026-09-15T02:43:35.049Z',
      azimuthDeg: 45,
      hfovDeg: 90,
      country: 'US',
      region: 'AK',
      city: 'Nyac',
      attribution: null,
      operator: 'FAA Weather Camera Program',
    });
  });

  it('cuts to the swept band with the same test the Windy sweep uses', () => {
    const alaskaOnly = (lat: number) => lat > 50;
    const r = parseFaaSites(fixture, { now: NOW, within: alaskaOnly, includeThirdParty: true });
    // Kahe is in Hawaii: admitted as third party, then out of band.
    expect(r.cameras.every((c) => c.region === 'AK')).toBe(true);
    expect(r.skipped.out_of_band).toBe(4);
  });

  it('includes third-party sites only when asked, carrying their attribution and operator', () => {
    const r = parseFaaSites(fixture, { now: NOW, within: everywhere, includeThirdParty: true });
    const kahe = r.cameras.filter((c) => c.city === 'Kahe');
    expect(kahe).toHaveLength(4);
    expect(kahe[0].attribution).toContain('ALERTWest');
    expect(kahe[0].operator).toBe('ALERTWest');
    expect(r.skipped.third_party).toBeUndefined();
  });

  it('drops a camera whose last frame is older than the staleness window', () => {
    const later = new Date('2026-09-15T03:30:00Z'); // 44+ min after Nyac's newest frame
    const r = parseFaaSites(fixture, { now: later, within: everywhere });
    expect(r.cameras).toHaveLength(0);
    expect(r.skipped.stale).toBe(4);
  });

  it('refuses a payload that is not the documented envelope', () => {
    expect(() => parseFaaSites({ success: false, payload: null }, { now: NOW, within: everywhere })).toThrow(/shape/);
    expect(() => parseFaaSites([], { now: NOW, within: everywhere })).toThrow(/shape/);
  });
});

describe('faaAuthHeaders', () => {
  it('is null without a token and a Bearer header with one', () => {
    expect(faaAuthHeaders({})).toBeNull();
    expect(faaAuthHeaders({ [FAA_TOKEN_ENV]: ' abc ' })).toEqual({ Authorization: 'Bearer abc' });
  });
});

describe('faaSource.listCameras', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reports itself unconfigured, and fetches nothing, without a token', async () => {
    vi.stubEnv(FAA_TOKEN_ENV, '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await faaSource.listCameras({ now: NOW, within: everywhere });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ cameras: [], attempted: 1, failed: 1, failedByStatus: { unconfigured: 1 } });
  });

  it('calls the redistributable endpoint once with the bearer token and a ten-minute revalidate', async () => {
    vi.stubEnv(FAA_TOKEN_ENV, 'tok');
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => fixture }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await faaSource.listCameras({ now: NOW, within: everywhere });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { next?: { revalidate?: number } }];
    expect(url).toBe(FAA_REDISTRIBUTABLE_URL);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(init.next?.revalidate).toBe(600);
    expect(r.cameras).toHaveLength(4);
    expect(r).toMatchObject({ attempted: 1, failed: 0, skipped: { third_party: 4, site_maintenance: 8 } });
  });

  it('counts a non-OK response by status instead of throwing', async () => {
    vi.stubEnv(FAA_TOKEN_ENV, 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    const r = await faaSource.listCameras({ now: NOW, within: everywhere });
    expect(r).toMatchObject({ cameras: [], attempted: 1, failed: 1, failedByStatus: { '401': 1 } });
  });

  it('counts a network error instead of throwing', async () => {
    vi.stubEnv(FAA_TOKEN_ENV, 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const r = await faaSource.listCameras({ now: NOW, within: everywhere });
    expect(r).toMatchObject({ cameras: [], failed: 1, failedByStatus: { error: 1 } });
  });
});
