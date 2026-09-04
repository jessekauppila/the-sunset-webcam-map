import type { SizedTile, TileInput, V4Config } from './types';

/**
 * Percentile of each passer within the passers alone, ties sharing the mean
 * of their ranks. Scoped to passers on purpose: v1 ranked across the whole
 * pool, so on a normal night the handful of real sunsets were dragged into
 * the middle of a distribution made almost entirely of floored night frames.
 */
function percentilesAmongPassers(passers: TileInput[]): Map<number, number> {
  const out = new Map<number, number>();
  const scored = passers.filter(
    (t): t is TileInput & { score: number } => t.score !== null
  );
  const n = scored.length;
  if (n === 1) {
    out.set(scored[0].id, 1);
    return out;
  }
  const sorted = [...scored].sort((a, b) => a.score - b.score);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && sorted[j].score === sorted[i].score) j++;
    let sum = 0;
    for (let k = i; k < j; k++) sum += k / (n - 1);
    const mean = sum / (j - i);
    for (let k = i; k < j; k++) out.set(sorted[k].id, mean);
    i = j;
  }
  return out;
}

/**
 * Maps a raw score onto [0, 1] through the absolute score window. This is
 * what makes sunrise and sunset comparable: the same score is the same
 * height on either panel, regardless of what else is on that panel. A
 * degenerate window (ceiling at or below floor) becomes a hard step.
 */
export function normalizeScore(score: number, cfg: V4Config): number {
  const span = cfg.scoreCeiling - cfg.scoreFloor;
  if (span <= 0) return score >= cfg.scoreCeiling ? 1 : 0;
  return Math.min(1, Math.max(0, (score - cfg.scoreFloor) / span));
}

/**
 * Sizes every tile by height, then derives width from the source aspect
 * ratio. Two rules are fixed directives, not knobs:
 *   - gate-failers pin to the EXACT floor, never spreading across the curve
 *   - there is no upscale clamp (v1's upscaleMax), because a clamp would
 *     silently push small sources below the floor
 *
 * `linear` and `easeIn` are ABSOLUTE: height is a function of the score
 * alone, so a mediocre night looks mediocre instead of promoting its own
 * best frame to the ceiling. `percentileAmongPassers` is relative and is
 * kept only for comparison — it cannot agree across two panels.
 */
export function sizeTiles(tiles: TileInput[], cfg: V4Config): SizedTile[] {
  const span = cfg.ceilingPx - cfg.floorPx;
  const percentiles =
    cfg.curve === 'percentileAmongPassers'
      ? percentilesAmongPassers(tiles.filter((t) => t.passes))
      : null;

  return tiles.map((t) => {
    let height = cfg.floorPx;
    if (t.passes && t.score !== null) {
      let unit: number;
      if (percentiles) unit = percentiles.get(t.id) ?? 0;
      else {
        const norm = normalizeScore(t.score, cfg);
        unit = cfg.curve === 'easeIn' ? norm * norm : norm;
      }
      height = cfg.floorPx + span * unit;
    }
    const aspect = t.srcHeight > 0 ? t.srcWidth / t.srcHeight : 4 / 3;
    return { ...t, height, width: height * aspect, pinnedToFloor: !(t.passes && t.score !== null) };
  });
}
