import type { Location, WindyWebcam } from '@/app/lib/types';
import type { CoordFetchResult } from './windyApi';

export type Feed = 'sunrise' | 'sunset';

export interface RingCoords {
  sunriseCoords: Location[];
  sunsetCoords: Location[];
}

export interface RingTelemetry {
  offsetDeg: number;
  feedsSwept: Feed[];
  attempted: number;
  empty: number;
  /** Cameras this ring contributed that no earlier ring had seen. */
  newWebcams: number;
}

export interface SweepTelemetry {
  rings: RingTelemetry[];
  counts: Record<Feed, number>;
  escalations: number;
  budgetExhausted: boolean;
}

export interface SweepResult {
  webcams: WindyWebcam[];
  coords: RingCoords;
  telemetry: SweepTelemetry;
}

export interface SweepOptions {
  buildRing: (offsetDeg: number) => RingCoords;
  fetchCoords: (coords: Location[]) => Promise<CoordFetchResult>;
  classify: (
    webcams: WindyWebcam[],
    sunriseCoords: Location[],
    sunsetCoords: Location[]
  ) => { sunrise: WindyWebcam[]; sunset: WindyWebcam[] };
  floor: number;
  offsets: readonly number[];
  hasBudget: () => boolean;
}

const FEEDS: Feed[] = ['sunrise', 'sunset'];

/** Feeds whose camera count is under the floor. Order is stable: sunrise first. */
export function feedsBelowFloor(
  counts: Record<Feed, number>,
  floor: number
): Feed[] {
  return FEEDS.filter((f) => counts[f] < floor);
}

/**
 * Sweep the terminator, widening within THIS tick while any feed is short.
 *
 * The escalation level is never stored. It is re-derived every tick from what
 * the sweep actually returned, so it relaxes on its own the moment the
 * terminator moves back over land. Cross-tick hysteresis was considered and
 * rejected: widening succeeds, the count rises past the high-water mark, the
 * next tick narrows, the count collapses, and it oscillates.
 *
 * Ring order matters. `offsets` is day-side first (positive offset shrinks the
 * ring radius, moving it toward the sun), because the day-side ring lands in
 * golden hour while the night-side one lands ~29 degrees below the horizon,
 * where frames get gated anyway. Measured 2026-09-02: the +15.75 ring returned
 * 100% cameras the base ring had never seen.
 *
 * Only the thin feed's half of an escalation ring is swept. The two feeds are
 * routinely short at different times (4 vs 21 the day this was written), so
 * this halves the cost of the common case.
 */
export async function sweepWithEscalation(
  opts: SweepOptions
): Promise<SweepResult> {
  const byId = new Map<number, WindyWebcam>();
  const sunriseCoords: Location[] = [];
  const sunsetCoords: Location[] = [];
  const rings: RingTelemetry[] = [];
  let budgetExhausted = false;

  const sweep = async (offsetDeg: number, feeds: Feed[]) => {
    const ring = opts.buildRing(offsetDeg);
    const coords: Location[] = [];
    if (feeds.includes('sunrise')) {
      sunriseCoords.push(...ring.sunriseCoords);
      coords.push(...ring.sunriseCoords);
    }
    if (feeds.includes('sunset')) {
      sunsetCoords.push(...ring.sunsetCoords);
      coords.push(...ring.sunsetCoords);
    }
    const before = byId.size;
    const res = await opts.fetchCoords(coords);
    for (const w of res.webcams) byId.set(w.webcamId, w);
    rings.push({
      offsetDeg,
      feedsSwept: feeds,
      attempted: res.attempted,
      empty: res.empty,
      newWebcams: byId.size - before,
    });
  };

  // Classify against the FULL coordinate set gathered so far, never against
  // the triggering feed alone. A day-side box on the sunrise half can hold a
  // camera that genuinely belongs to sunset, and forcing it into the feed that
  // triggered the sweep would corrupt the split.
  const currentCounts = (): Record<Feed, number> => {
    const split = opts.classify(
      [...byId.values()],
      sunriseCoords,
      sunsetCoords
    );
    return { sunrise: split.sunrise.length, sunset: split.sunset.length };
  };

  await sweep(0, FEEDS);
  let counts = currentCounts();

  for (const offsetDeg of opts.offsets) {
    const thin = feedsBelowFloor(counts, opts.floor);
    if (thin.length === 0) break;
    if (!opts.hasBudget()) {
      budgetExhausted = true;
      break;
    }
    await sweep(offsetDeg, thin);
    counts = currentCounts();
  }

  return {
    webcams: [...byId.values()],
    coords: { sunriseCoords, sunsetCoords },
    telemetry: {
      rings,
      counts,
      escalations: rings.length - 1,
      budgetExhausted,
    },
  };
}
