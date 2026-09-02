import type { SizedTile, TileInput, V2Config } from './types';

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
 * Sizes every tile by height, then derives width from the source aspect
 * ratio. Two rules are fixed directives, not knobs:
 *   - gate-failers pin to the EXACT floor, never spreading across the curve
 *   - there is no upscale clamp (v1's upscaleMax), because a clamp would
 *     silently push small sources below the floor
 */
export function sizeTiles(tiles: TileInput[], cfg: V2Config): SizedTile[] {
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
      else if (cfg.curve === 'easeIn') unit = t.score * t.score;
      else unit = t.score;
      height = cfg.floorPx + span * unit;
    }
    const aspect = t.srcHeight > 0 ? t.srcWidth / t.srcHeight : 4 / 3;
    return { ...t, height, width: height * aspect, pinnedToFloor: !t.passes };
  });
}
