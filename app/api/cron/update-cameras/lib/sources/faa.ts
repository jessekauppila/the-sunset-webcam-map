/**
 * FAA WeatherCams — the first adapter behind the source port (issue #204).
 *
 * Why first (docs/image-source-register.md): 756 US sites, 2,848 cameras,
 * native ten-minute cadence, a published bearing on every camera, and 264
 * sites in Alaska, where civil twilight is longest. Measured 2026-09-15:
 * frame age p50 7 min, p90 11 min; 1920x1080 JPEG about 240 KB; the image
 * host honours If-None-Match with a 304.
 *
 * One call, not one per camera: /api/redistributable/sites returns every US
 * site with each camera's current image URL (2.7 MB). Fetched through Next's
 * data cache with a ten-minute revalidate, so a once-a-minute tick costs at
 * most six calls an hour. The image URL carries the capture timestamp in its
 * filename, so "has this camera got a new frame" is a string compare against
 * the URL stored last tick — no download, no ETag round trip.
 *
 * Access: the API's own description says use is subject to the Weather
 * Camera Program's terms and to contact 9-AJO-WCAM-ProgramOffice@faa.gov for
 * access; requests carry `Authorization: Bearer <token>` from
 * FAA_WEATHERCAMS_TOKEN. Without the token the adapter reports itself
 * unconfigured and lists nothing. (The public site's own browser calls pass
 * with only a Referer header; that is not something this adapter does.)
 *
 * Third-party sites (442 of 756: ALERTWest, state aeronautics divisions, and
 * others) carry an `attribution` the FAA displays beside them. They are
 * excluded until the display shows attribution; FAA-operated sites are US
 * federal work, public domain.
 */

import { SOURCE_FAA } from '@/app/lib/runtimeFlagKeys';
import { capCamerasPerTick } from './capPerTick';
import {
  emptyListResult,
  type Source,
  type SourceCamera,
  type SourceListOptions,
  type SourceListResult,
} from './types';

export const FAA_REDISTRIBUTABLE_URL = 'https://weathercams.faa.gov/api/redistributable/sites';
/** Next data-cache lifetime for the site list. Frames change every ~10 min. */
export const FAA_LIST_REVALIDATE_S = 600;
/** A camera whose last successful frame is older than this is not listed. */
export const FAA_STALE_AFTER_MIN = 30;
export const FAA_INCLUDE_THIRD_PARTY = false;
export const FAA_TOKEN_ENV = 'FAA_WEATHERCAMS_TOKEN';

interface FaaCamera {
  cameraId: number;
  cameraName?: string;
  cameraDirection?: string | null;
  cameraBearing?: number | null;
  cameraLastSuccess?: string | null;
  cameraInMaintenance?: boolean;
  cameraOutOfOrder?: boolean;
  mapWedgeAngle?: number | null;
  currentImageUri?: string | null;
  latitude?: number;
  longitude?: number;
}

interface FaaSite {
  siteId: number;
  siteName: string;
  siteActive?: boolean;
  siteInMaintenance?: boolean;
  thirdParty?: boolean;
  latitude: number;
  longitude: number;
  country?: string | null;
  state?: string | null;
  operatedBy?: string | null;
  attribution?: string | null;
  cameras?: FaaCamera[] | null;
}

export interface FaaParseOptions {
  now: Date;
  within: (lat: number, lng: number) => boolean;
  includeThirdParty?: boolean;
  staleAfterMin?: number;
}

export interface FaaParseResult {
  cameras: SourceCamera[];
  sites: number;
  skipped: Record<string, number>;
}

/**
 * The redistributable payload → SourceCameras. Pure; the fixture test runs
 * it against a real (trimmed) response.
 */
export function parseFaaSites(body: unknown, opts: FaaParseOptions): FaaParseResult {
  const b = body as { success?: boolean; payload?: unknown } | null;
  if (!b || b.success !== true || !Array.isArray(b.payload)) {
    throw new Error('faa: unexpected payload shape (expected { success: true, payload: [] })');
  }
  const sites = b.payload as FaaSite[];
  const includeThirdParty = opts.includeThirdParty ?? FAA_INCLUDE_THIRD_PARTY;
  const staleBefore = opts.now.getTime() - (opts.staleAfterMin ?? FAA_STALE_AFTER_MIN) * 60_000;
  const skipped: Record<string, number> = {};
  const skip = (reason: string, n = 1) => {
    skipped[reason] = (skipped[reason] ?? 0) + n;
  };
  const cameras: SourceCamera[] = [];

  for (const site of sites) {
    const cams = site.cameras ?? [];
    if (site.siteActive === false) { skip('site_inactive', cams.length); continue; }
    if (site.siteInMaintenance) { skip('site_maintenance', cams.length); continue; }
    if (site.thirdParty && !includeThirdParty) { skip('third_party', cams.length); continue; }
    for (const cam of cams) {
      const lat = cam.latitude ?? site.latitude;
      const lng = cam.longitude ?? site.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number') { skip('no_location'); continue; }
      if (!opts.within(lat, lng)) { skip('out_of_band'); continue; }
      if (cam.cameraOutOfOrder) { skip('camera_out_of_order'); continue; }
      if (cam.cameraInMaintenance) { skip('camera_maintenance'); continue; }
      if (!cam.currentImageUri) { skip('no_image'); continue; }
      const at = cam.cameraLastSuccess ? Date.parse(cam.cameraLastSuccess) : NaN;
      if (!Number.isFinite(at) || at < staleBefore) { skip('stale'); continue; }
      cameras.push({
        source: 'faa',
        externalId: String(cam.cameraId),
        title: `${site.siteName} ${cam.cameraDirection || cam.cameraName || ''}`.trim(),
        lat,
        lng,
        imageUrl: cam.currentImageUri,
        imageAt: new Date(at).toISOString(),
        azimuthDeg: typeof cam.cameraBearing === 'number' ? cam.cameraBearing : null,
        hfovDeg: typeof cam.mapWedgeAngle === 'number' ? cam.mapWedgeAngle : null,
        country: site.country ?? null,
        region: site.state ?? null,
        city: site.siteName ?? null,
        attribution: site.attribution ?? null,
        operator: site.operatedBy ?? (site.thirdParty ? null : 'FAA Weather Camera Program'),
      });
    }
  }
  return { cameras, sites: sites.length, skipped };
}

/** The auth header, or null when no token is configured. */
export function faaAuthHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> | null {
  const token = env[FAA_TOKEN_ENV]?.trim();
  return token ? { Authorization: `Bearer ${token}` } : null;
}

export const faaSource: Source = {
  name: 'faa',
  flag: SOURCE_FAA,
  async listCameras(opts: SourceListOptions): Promise<SourceListResult> {
    const t0 = Date.now();
    const auth = faaAuthHeaders();
    if (!auth) {
      return {
        ...emptyListResult(Date.now() - t0),
        attempted: 1,
        failed: 1,
        failedByStatus: { unconfigured: 1 },
      };
    }
    try {
      const res = await fetch(FAA_REDISTRIBUTABLE_URL, {
        headers: { accept: 'application/json', ...auth },
        next: { revalidate: FAA_LIST_REVALIDATE_S },
      });
      if (!res.ok) {
        return {
          ...emptyListResult(Date.now() - t0),
          attempted: 1,
          failed: 1,
          failedByStatus: { [String(res.status)]: 1 },
        };
      }
      const parsed = parseFaaSites(await res.json(), { now: opts.now, within: opts.within });
      // FAA does no per-camera request here -- its URL carries the capture
      // time, so listing is one call however many sites are in band. The cap
      // still applies, because the tick's real cost is downstream: every
      // camera returned is a frame downloaded, scored and stored.
      const capped = capCamerasPerTick(parsed.cameras, opts.now, opts.maxCameras);
      return {
        cameras: capped.cameras,
        attempted: 1,
        failed: 0,
        failedByStatus: {},
        skipped: capped.dropped ? { ...parsed.skipped, over_cap: capped.dropped } : parsed.skipped,
        elapsedMs: Date.now() - t0,
      };
    } catch (error) {
      console.warn('[sources/faa] list failed:', error);
      return {
        ...emptyListResult(Date.now() - t0),
        attempted: 1,
        failed: 1,
        failedByStatus: { error: 1 },
      };
    }
  },
};
