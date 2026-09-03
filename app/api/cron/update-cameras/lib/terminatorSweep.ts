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
  /**
   * The ids behind `newWebcams`, in the order the ring returned them.
   *
   * Carried so the spec's open question is answerable from telemetry alone:
   * do golden-hour frames (the +15.75 ring) actually pass the detection gate,
   * or does the day-side ring only add tiles that get floored? Answering that
   * means comparing gate-pass rates for cameras first seen on ring 1 against
   * ring 0, which needs the ids and not just the count. `newWebcams` stays as
   * the cheap scalar for logs and dashboards.
   */
  newWebcamIds: number[];
}

export interface SweepTelemetry {
  rings: RingTelemetry[];
  counts: Record<Feed, number>;
  /**
   * Feeds under the floor once the base ring was in, before any widening.
   *
   * This, not `rings[1].feedsSwept`, is the honest "a feed went thin today"
   * signal the daily digest counts: a tick that ran out of sweep budget
   * before the first escalation ring had a thin feed and no escalation ring
   * to record it.
   */
  thinAfterBase: Feed[];
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
  /**
   * Offsets to sweep on every tick regardless of the camera floor, both feeds.
   *
   * The floor-based trigger asks "is a panel too empty to look at". This asks
   * a different question: "does the pool reach the altitudes where sunsets
   * actually happen". Good frames peak at 0 to +6 degrees solar altitude and
   * the base ring at -13 never sees them, so the day-side ring is worth
   * paying for even when nothing is thin. Additive to the floor trigger,
   * never a replacement for it.
   *
   * Empty or absent means today's behaviour exactly.
   */
  forcedOffsets?: readonly number[];
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
    // Record the ids this ring is first to see, before inserting them, so the
    // delta is against every EARLIER ring rather than against this one.
    const newWebcamIds: number[] = [];
    for (const w of res.webcams) {
      if (!byId.has(w.webcamId)) newWebcamIds.push(w.webcamId);
      byId.set(w.webcamId, w);
    }
    rings.push({
      offsetDeg,
      feedsSwept: feeds,
      attempted: res.attempted,
      empty: res.empty,
      newWebcams: byId.size - before,
      newWebcamIds,
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

  // Copy FEEDS: `sweep` stores the array it is handed straight into the
  // returned telemetry, so passing the module-level constant would make
  // `telemetry.rings[0].feedsSwept` an alias of FEEDS. Any caller that sorted
  // or otherwise mutated the telemetry would permanently reorder FEEDS and
  // flip escalation priority for the rest of the process.
  await sweep(0, [...FEEDS]);
  let counts = currentCounts();
  const thinAfterBase = feedsBelowFloor(counts, opts.floor);

  for (const offsetDeg of opts.offsets) {
    const forced = opts.forcedOffsets?.includes(offsetDeg) ?? false;
    const thin = feedsBelowFloor(counts, opts.floor);
    // Forced rings sweep both feeds; floor-triggered rings sweep only the
    // thin half, which is what halves the cost of the common case.
    const feeds: Feed[] = forced ? [...FEEDS] : thin;
    // `continue`, not `break`. With no forced offsets the two are observably
    // identical -- feedsBelowFloor is pure, counts have not changed, and
    // neither path pushes a ring or sets budgetExhausted -- but `break` would
    // skip a forced offset that sat after a non-forced one in the list.
    if (feeds.length === 0) continue;
    if (!opts.hasBudget()) {
      budgetExhausted = true;
      break;
    }
    await sweep(offsetDeg, feeds);
    counts = currentCounts();
  }

  return {
    webcams: [...byId.values()],
    coords: { sunriseCoords, sunsetCoords },
    telemetry: {
      rings,
      counts,
      thinAfterBase,
      escalations: rings.length - 1,
      budgetExhausted,
    },
  };
}
