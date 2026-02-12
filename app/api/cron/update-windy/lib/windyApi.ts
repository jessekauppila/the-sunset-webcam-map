/**
 * Windy API fetching module
 * Handles fetching webcams from Windy API with rate limiting and batching
 */

import type { Location, WindyWebcam } from '@/app/lib/types';
import {
  SEARCH_RADIUS_DEG,
  WINDY_FETCH_STAGGER_WITHIN_BATCH_MS,
} from '@/app/lib/masterConfig';

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

  const url = `https://api.windy.com/webcams/api/v3/map/clusters?lang=en&northLat=${
    loc.lat + SEARCH_RADIUS_DEG
  }&southLat=${loc.lat - SEARCH_RADIUS_DEG}&eastLon=${loc.lng + SEARCH_RADIUS_DEG}&westLon=${
    loc.lng - SEARCH_RADIUS_DEG
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

