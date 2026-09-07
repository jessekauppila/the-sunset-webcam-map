/**
 * One scale for time across the solo studio.
 *
 * Size means **time on glass** everywhere in this studio, and it is drawn on
 * whichever axis the surface has spare: width on the tape, height in the
 * queue. Until 2026-09-06 those were two different rates, 3 px/s on the tape
 * and 4 px/s in the queue, which made a twenty second dwell a different
 * length in two surfaces sitting inches apart. They share this constant now,
 * so one dwell is one length wherever it is drawn.
 *
 * Worth keeping straight, because it is the other half of the same question:
 * on the **glass**, size means quality, since the mosaic sizes a tile by its
 * score. In the **studio**, size means time. `SCALE_NOTE` says so on the
 * surfaces themselves rather than leaving it to be inferred.
 */
export const PX_PER_S = 4;

/** The short label a surface prints so its scale is readable without hovering. */
export const SCALE_LABEL = `${PX_PER_S} px/s`;

/** The long form, for the title of any surface that draws time as size. */
export const SCALE_NOTE =
  `Size is time on glass at ${PX_PER_S} px per second: width on the tape, height in the queue. `
  + 'In the studio size means time; on the glass it means quality.';
