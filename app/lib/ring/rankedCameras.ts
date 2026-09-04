import { fetchTerminatorWebcams } from '@/app/lib/terminatorPayload';
import {
  getCachedTerminatorPayload,
  setCachedTerminatorPayload,
} from '@/app/lib/cache';
import type { WindyWebcam } from '@/app/lib/types';
import type { RingCamera } from './ringLogic';

function normalize(w: WindyWebcam): RingCamera | null {
  const imageUrl = w.images?.current?.preview;
  if (!imageUrl) return null;
  return {
    id: w.webcamId,
    lng: w.location.longitude,
    title: w.title ? w.title : null,
    imageUrl,
  };
}

/**
 * The same 300s terminator cache `/api/db-terminator-webcams` reads, for the
 * same reason. `/api/ring/sync` is unauthenticated and every phone calls it
 * on a 20s heartbeat, so without this a ring of N phones is 3N Neon reads a
 * minute, and anyone who finds the URL can run the bill up alone. With it,
 * the ring costs the database at most one read per five minutes no matter
 * how many phones join — the same ceiling the map already lives under.
 *
 * Cache write is fire-and-forget, as in the route: a failed write must not
 * fail a heartbeat.
 */
async function loadWebcams(): Promise<WindyWebcam[]> {
  const cached = await getCachedTerminatorPayload<WindyWebcam[]>();
  if (cached) return cached;
  const webcams = await fetchTerminatorWebcams();
  setCachedTerminatorPayload(webcams).catch((error) => {
    console.error('Failed to populate terminator cache from ring sync:', error);
  });
  return webcams;
}

export async function getRankedCameras(): Promise<RingCamera[]> {
  const webcams = await loadWebcams();
  return webcams
    .map((w) => ({ ring: normalize(w), rank: w.rank ?? Number.MAX_SAFE_INTEGER }))
    .filter((x): x is { ring: RingCamera; rank: number } => x.ring !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.ring);
}
