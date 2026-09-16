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
 * 200 at the measured 63 ms/HEAD amortized (concurrency 10) is ~12.6 s of
 * listing, which still fits beside the 25 s sweep budget inside
 * TICK_DEADLINE_MS. The scoring loop is deadline-bounded and scores Windy
 * first, so a slow tick costs this source's tail, never Windy's.
 *
 * **This is a SURVEY setting, deliberately above what the pool needs.** The
 * cap does not decide how many cameras are seen -- 120 already surfaces 2,250
 * of Digitraffic's 2,258 presets in a day. It decides how OFTEN each one is
 * seen: 3.9 looks per camera per day at 120, 6.3 at 200. Every look already
 * falls inside that camera's sunrise or sunset window, because the band test
 * only admits it while the terminator is crossing.
 *
 * The extra looks are here to judge which cameras are worth keeping (framing,
 * aim, obstruction), and that judgement is the point of running wide first.
 *
 * **It is expected to come back down, and the cost compounds until it does.**
 * Frames are kept forever -- CLEANUP_ENABLED is false and the cleanup route
 * has never run -- so each month's frames are paid for every month after.
 * Measured at 200 with storage compression: ~14,113 frames/day, ~2.85 GB/day,
 * about $5.94 in month 1, $14.49 by month 6, $24.75 by month 12. At 120 those
 * are $3.66 / $8.91 / $15.21. Pruning to a 90-day window would flatten 200 to
 * a steady ~$9.36/mo instead of climbing.
 *
 * Revisit when the survey has answered its question. Issue #235.
 */
export const SOURCE_MAX_CAMERAS_PER_TICK = 200;

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
