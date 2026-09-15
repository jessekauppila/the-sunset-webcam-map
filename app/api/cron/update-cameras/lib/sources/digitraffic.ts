/**
 * Finland Digitraffic road weather cameras — the second adapter behind the
 * source port (issue #221; the port is issue #204).
 *
 * Why second (docs/image-source-register.md, "The second adapter"): 810
 * stations / 2,276 presets at 60–70 N, 1280×720 JPEG about 277 KB, a stated
 * ten-minute collection interval, and CC BY 4.0 with a fixed credit line.
 * It also proves the port in ways FAA cannot: string preset ids, a
 * station→preset listing, and a credit that must reach the glass.
 *
 * Verified 2026-09-15:
 * - GET /api/weathercam/v1/stations answers 406 unless the request accepts
 *   gzip, and the service asks callers to name themselves in a
 *   Digitraffic-User header. One 38 KB GeoJSON for all stations, fetched
 *   through Next's data cache with a ten-minute revalidate.
 * - The list carries coordinates and preset ids but not image URLs; the
 *   image URL is `https://weathercam.digitraffic.fi/{presetId}.jpg`, so no
 *   per-station call is needed in the hot path.
 * - `dataUpdatedTime` is the LIST's time (identical on all 810 stations),
 *   not the image's, and the image URL never changes. So "is this a new
 *   frame" is answered by one HEAD per in-band preset per tick: the ETag
 *   becomes `imageVersion`, which the tick compares instead of the URL.
 *   A failed HEAD leaves imageVersion undefined and the frame is fetched.
 * - Direction per preset (in the station detail, not the list) is
 *   road-relative (INCREASING_DIRECTION / DECREASING_DIRECTION), not a
 *   bearing, so azimuthDeg stays null.
 *
 * Licence: CC BY 4.0. Required credit, verbatim from the terms of service:
 * "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY".
 */

import { SOURCE_DIGITRAFFIC } from '@/app/lib/runtimeFlags';
import {
  emptyListResult,
  type Source,
  type SourceCamera,
  type SourceListOptions,
  type SourceListResult,
} from './types';

export const DIGITRAFFIC_STATIONS_URL = 'https://tie.digitraffic.fi/api/weathercam/v1/stations';
export const DIGITRAFFIC_IMAGE_BASE = 'https://weathercam.digitraffic.fi/';
/** The service asks every caller to identify itself. */
export const DIGITRAFFIC_USER = 'sunrisesunset.studio';
export const DIGITRAFFIC_CREDIT = 'Source: Fintraffic / digitraffic.fi, license CC 4.0 BY';
/** Next data-cache lifetime for the station list. Stations rarely change. */
export const DIGITRAFFIC_LIST_REVALIDATE_S = 600;
/** HEADs in flight at once when versioning the in-band presets. */
export const DIGITRAFFIC_HEAD_CONCURRENCY = 10;

interface DtPreset {
  id: string;
  inCollection?: boolean;
}

interface DtStation {
  type?: string;
  id: string;
  geometry?: { type?: string; coordinates?: number[] };
  properties?: {
    id?: string;
    name?: string;
    collectionStatus?: string;
    presets?: DtPreset[] | null;
  };
}

export interface DigitrafficParseOptions {
  within: (lat: number, lng: number) => boolean;
}

export interface DigitrafficParseResult {
  cameras: SourceCamera[];
  stations: number;
  skipped: Record<string, number>;
}

export function digitrafficImageUrl(presetId: string): string {
  return `${DIGITRAFFIC_IMAGE_BASE}${presetId}.jpg`;
}

/**
 * The stations GeoJSON → SourceCameras, one per preset in collection at a
 * gathering station inside the band. Pure; the fixture test runs it against
 * a real (trimmed) response. imageVersion is left for `withImageVersions`.
 */
export function parseDigitrafficStations(body: unknown, opts: DigitrafficParseOptions): DigitrafficParseResult {
  const b = body as { type?: string; features?: unknown } | null;
  if (!b || !Array.isArray(b.features)) {
    throw new Error('digitraffic: unexpected payload shape (expected a FeatureCollection)');
  }
  const stations = b.features as DtStation[];
  const skipped: Record<string, number> = {};
  const skip = (reason: string, n = 1) => {
    skipped[reason] = (skipped[reason] ?? 0) + n;
  };
  const cameras: SourceCamera[] = [];

  for (const st of stations) {
    const props = st.properties ?? {};
    const presets = props.presets ?? [];
    const stationId = props.id ?? st.id;
    const coords = st.geometry?.coordinates;
    const lng = coords?.[0];
    const lat = coords?.[1];
    if (typeof lat !== 'number' || typeof lng !== 'number') { skip('no_location', presets.length); continue; }
    if (props.collectionStatus !== 'GATHERING') { skip('station_not_gathering', presets.length); continue; }
    if (!opts.within(lat, lng)) { skip('out_of_band', presets.length); continue; }
    const name = stationNames(props.name ?? stationId);
    for (const preset of presets) {
      if (!preset.id) { skip('no_preset_id'); continue; }
      if (preset.inCollection === false) { skip('preset_not_in_collection'); continue; }
      cameras.push({
        source: 'digitraffic',
        externalId: preset.id,
        // "kt51_Inkoo" + "C0150301" → "kt51 Inkoo 01": the road and place the
        // station names itself by, and the preset's number at that station.
        title: `${name.title} ${preset.id.slice(-2)}`.trim(),
        lat,
        lng,
        imageUrl: digitrafficImageUrl(preset.id),
        imageAt: null,
        azimuthDeg: null,
        hfovDeg: null,
        country: 'FI',
        region: null,
        city: name.place,
        attribution: DIGITRAFFIC_CREDIT,
        operator: 'Fintraffic',
      });
    }
  }
  return { cameras, stations: stations.length, skipped };
}

/** "kt51_Inkoo" → { title: "kt51 Inkoo", place: "Inkoo" }; "VUO_SAT" → place "SAT". */
function stationNames(raw: string): { title: string; place: string | null } {
  const parts = raw.split('_').filter(Boolean);
  const title = parts.join(' ');
  const place = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return { title, place };
}

/**
 * One HEAD per camera, `concurrency` at a time. The ETag (or, failing that,
 * Last-Modified) becomes imageVersion, and Last-Modified fills imageAt. A
 * HEAD that fails or answers without either header leaves imageVersion
 * undefined, so the tick treats the frame as changed and fetches it: the
 * failure mode is a download, never a frame that silently stops updating.
 */
export async function withImageVersions(
  cameras: SourceCamera[],
  fetchImpl: typeof fetch = fetch,
  concurrency = DIGITRAFFIC_HEAD_CONCURRENCY,
): Promise<{ cameras: SourceCamera[]; headFailed: number }> {
  const out: SourceCamera[] = new Array(cameras.length);
  let headFailed = 0;
  let next = 0;
  async function worker() {
    while (next < cameras.length) {
      const i = next++;
      const cam = cameras[i];
      try {
        const res = await fetchImpl(cam.imageUrl, { method: 'HEAD', cache: 'no-store' });
        const etag = res.ok ? res.headers.get('etag') : null;
        const lastModified = res.ok ? res.headers.get('last-modified') : null;
        const version = etag ?? lastModified ?? undefined;
        if (!version) headFailed += 1;
        const at = lastModified ? Date.parse(lastModified) : NaN;
        out[i] = {
          ...cam,
          ...(version ? { imageVersion: version } : {}),
          imageAt: Number.isFinite(at) ? new Date(at).toISOString() : cam.imageAt,
        };
      } catch {
        headFailed += 1;
        out[i] = cam;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, cameras.length)) }, worker));
  return { cameras: out, headFailed };
}

export const digitrafficSource: Source = {
  name: 'digitraffic',
  flag: SOURCE_DIGITRAFFIC,
  async listCameras(opts: SourceListOptions): Promise<SourceListResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(DIGITRAFFIC_STATIONS_URL, {
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip',
          'digitraffic-user': DIGITRAFFIC_USER,
        },
        next: { revalidate: DIGITRAFFIC_LIST_REVALIDATE_S },
      });
      if (!res.ok) {
        return {
          ...emptyListResult(Date.now() - t0),
          attempted: 1,
          failed: 1,
          failedByStatus: { [String(res.status)]: 1 },
        };
      }
      const parsed = parseDigitrafficStations(await res.json(), { within: opts.within });
      const versioned = await withImageVersions(parsed.cameras);
      return {
        cameras: versioned.cameras,
        attempted: 1 + parsed.cameras.length,
        failed: versioned.headFailed,
        failedByStatus: versioned.headFailed ? { head: versioned.headFailed } : {},
        skipped: parsed.skipped,
        elapsedMs: Date.now() - t0,
      };
    } catch (error) {
      console.warn('[sources/digitraffic] list failed:', error);
      return {
        ...emptyListResult(Date.now() - t0),
        attempted: 1,
        failed: 1,
        failedByStatus: { error: 1 },
      };
    }
  },
};
