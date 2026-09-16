/**
 * The per-source ceiling on how many cameras one tick will take.
 *
 * The band test in band.ts cuts a source to the same shape Windy is swept
 * with, and for a source spread over a hemisphere that is the whole bound it
 * needs. It is NOT a bound for a source concentrated inside one query box.
 * Measured 2026-09-15 against the live Digitraffic list: Finland's 2,258
 * presets all sit inside a single SEARCH_RADIUS_DEG box, so the band test
 * admits the entire catalogue for hours at a stretch (108,622 in-band
 * preset-ticks per day), and its HEAD pass alone would run ~142 s against a
 * 60 s route ceiling -- the Windy tick would die before scoring a frame.
 *
 * So the ceiling is a count, applied by each adapter BEFORE it does any
 * per-camera network work. A cap applied after the fact would bound the
 * scoring loop while leaving the listing cost that actually breaks the tick.
 *
 * The window ROTATES rather than truncating. Taking the first N every tick
 * would pin the pool to the same N presets forever and never show the rest of
 * a source; advancing the window by N each tick walks the whole in-band list
 * in ceil(n / N) ticks and lets every camera take a turn.
 */

/** The cron's cadence, and so the step between one window and the next. */
const TICK_MS = 10 * 60 * 1000;

/**
 * Cameras one source may contribute to one tick.
 *
 * 120 at the measured 63 ms/HEAD amortized (concurrency 10) is ~7.6 s of
 * listing, which fits beside the 25 s sweep budget inside TICK_DEADLINE_MS.
 * It also puts a source at roughly Windy's own ~97 scored frames per tick,
 * which is the point: a source joins the pool as a peer, not as 20x of it.
 *
 * This is a dial, not a discovery. Raising it costs storage linearly -- a
 * Digitraffic frame is ~277 KB against a Windy frame's ~14 KB, and nothing
 * downstream re-encodes before upload.
 */
export const SOURCE_MAX_CAMERAS_PER_TICK = 120;

export interface CapResult<T> {
  cameras: T[];
  /** How many in-band cameras this tick set aside for a later window. */
  dropped: number;
}

/**
 * At most `max` cameras, taken from a window that advances one `max`-sized
 * step per tick and wraps. Sorted by externalId first so the walk is over a
 * stable order rather than whatever order the source listed them in.
 */
export function capCamerasPerTick<T extends { externalId: string }>(
  cameras: T[],
  now: Date,
  max: number = SOURCE_MAX_CAMERAS_PER_TICK,
): CapResult<T> {
  if (max <= 0) return { cameras: [], dropped: cameras.length };
  if (cameras.length <= max) return { cameras, dropped: 0 };

  const ordered = [...cameras].sort((a, b) => (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0));
  const window = Math.floor(now.getTime() / TICK_MS);
  const start = ((window * max) % ordered.length + ordered.length) % ordered.length;
  const taken: T[] = [];
  for (let i = 0; i < max; i++) taken.push(ordered[(start + i) % ordered.length]);
  return { cameras: taken, dropped: ordered.length - max };
}
