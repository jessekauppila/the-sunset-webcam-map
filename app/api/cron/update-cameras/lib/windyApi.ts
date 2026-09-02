/**
 * Windy API fetching module
 * Handles fetching webcams from Windy API with rate limiting and batching
 */

import type { Location, WindyWebcam } from '@/app/lib/types';
import {
  SEARCH_RADIUS_DEG,
  WINDY_FETCH_STAGGER_WITHIN_BATCH_MS,
} from '@/app/lib/masterConfig';

export interface BoundingBox {
  northLat: number;
  southLat: number;
  eastLon: number;
  westLon: number;
}

/**
 * Query box for one ring point, clamped to the ranges Windy accepts.
 *
 * Verified live 2026-09-02: the clusters endpoint 400s on northLat > 90,
 * southLat < -90, eastLon > 180 or westLon < -180, and `fetchWebcamsFor`
 * turns that into a silent empty array. The ring genuinely reaches both
 * the pole and the antimeridian, so ~2 of 31 boxes per sweep were being
 * lost that way.
 *
 * Clamping shrinks the box rather than wrapping it, so a box straddling
 * the antimeridian loses the sliver on the far side. Splitting into two
 * boxes would recover it; not done here because that stretch is open
 * ocean and a shrunken box still beats a 400.
 */
export function boundingBox(loc: Location, radiusDeg: number): BoundingBox {
  return {
    northLat: Math.min(90, loc.lat + radiusDeg),
    southLat: Math.max(-90, loc.lat - radiusDeg),
    eastLon: Math.min(180, loc.lng + radiusDeg),
    westLon: Math.max(-180, loc.lng - radiusDeg),
  };
}

/**
 * Fetch webcams from Windy API for a given location
 */
export async function fetchWebcamsFor(
  loc: Location,
  delayMs = 0
): Promise<WindyWebcam[]> {
  // Add delay to avoid rate limiting
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const box = boundingBox(loc, SEARCH_RADIUS_DEG);
  const url = `https://api.windy.com/webcams/api/v3/map/clusters?lang=en&northLat=${
    box.northLat
  }&southLat=${box.southLat}&eastLon=${box.eastLon}&westLon=${
    box.westLon
  }&zoom=4&include=images&include=urls&include=player&include=location&include=categories`;

  console.log(
    `🌐 Fetching webcams for lat:${loc.lat.toFixed(
      2
    )}, lng:${loc.lng.toFixed(2)}`
  );

  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-windy-api-key':
        process.env.NEXT_PUBLIC_WINDY_ACCESS_TOKEN || '',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    console.error(
      `❌ API error for ${loc.lat},${loc.lng}: ${res.status} ${res.statusText}`
    );
    return [] as WindyWebcam[];
  }

  const data: WindyWebcam[] = await res.json();
  console.log(
    `📹 Found ${data.length} webcams at ${loc.lat},${loc.lng}`
  );
  return data ?? [];
}

/**
 * Deduplicate coordinates by rounding to 6 decimal places
 */
export function dedupeCoords(coords: Location[]): Location[] {
  const byKey = new Map<string, Location>();
  for (const coord of coords) {
    const key = `${coord.lat.toFixed(6)},${coord.lng.toFixed(6)}`;
    if (!byKey.has(key)) byKey.set(key, coord);
  }
  return [...byKey.values()];
}

/**
 * Fetch webcams in batches with rate limiting
 */
export async function fetchWebcamsInBatches(
  coords: Location[],
  batchSize = 5,
  delayBetweenBatches = 1000
): Promise<WindyWebcam[][]> {
  const batches: WindyWebcam[][] = [];

  for (let i = 0; i < coords.length; i += batchSize) {
    const batch = coords.slice(i, i + batchSize);
    console.log(
      `📦 Processing batch ${
        Math.floor(i / batchSize) + 1
      }/${Math.ceil(coords.length / batchSize)}`
    );

    const batchResults = await Promise.all(
      batch.map((coord, index) =>
        fetchWebcamsFor(coord, index * WINDY_FETCH_STAGGER_WITHIN_BATCH_MS)
      ) // Stagger requests within batch
    );

    batches.push(...batchResults);

    // Add delay between batches (except for the last one)
    if (i + batchSize < coords.length) {
      await new Promise((resolve) =>
        setTimeout(resolve, delayBetweenBatches)
      );
    }
  }

  return batches;
}

/**
 * Deduplicate webcams by webcamId
 */
export function dedupeWebcams(webcams: WindyWebcam[]): Map<number, WindyWebcam> {
  const windyById = new Map<number, WindyWebcam>();
  for (const w of webcams) {
    windyById.set(w.webcamId, w);
  }
  return windyById;
}

export interface CoordFetchResult {
  webcams: WindyWebcam[];
  /** Boxes we sent to Windy. */
  attempted: number;
  /**
   * Boxes that returned nothing. Conflates "no cameras there" with "the call
   * failed", because `fetchWebcamsFor` swallows non-OK responses. That
   * conflation is the point: a rising `empty` count against a flat camera
   * count is the signature of an API wall, which is the thing we need to be
   * able to see.
   */
  empty: number;
}

/**
 * Batched sweep over ring coordinates that reports coverage, not just
 * results. Wraps `fetchWebcamsInBatches` so rate limiting stays in one place.
 */
export async function fetchCoordsCounted(
  coords: Location[],
  batchSize = 5,
  delayMs = 1000
): Promise<CoordFetchResult> {
  if (coords.length === 0) return { webcams: [], attempted: 0, empty: 0 };
  // One entry per COORDINATE, not per batch: fetchWebcamsInBatches spreads
  // each batch's results back in, so the array is 1:1 with `coords`. That
  // invariant is what makes `attempted` and `empty` correct, and the old
  // `batches` name hid it.
  const perCoord = await fetchWebcamsInBatches(coords, batchSize, delayMs);
  return {
    webcams: perCoord.flat(),
    attempted: coords.length,
    empty: perCoord.filter((r) => r.length === 0).length,
  };
}

