import type { PlacedRow, Row, V2Config } from './types';

/** Latitude to a y centre, north at the top, clamped to the configured window. */
export function mapLatToY(
  lat: number,
  cfg: V2Config,
  viewportHeight: number
): number {
  const span = cfg.latNorth - cfg.latSouth;
  if (span <= 0) return viewportHeight / 2;
  const t = (cfg.latNorth - lat) / span;
  return Math.max(0, Math.min(1, t)) * viewportHeight;
}

/**
 * Each row gets two candidate centres — its true latitude (yAnchor) and its
 * position in a contiguous, vertically centred stack (yPacked) — and
 * geographicFidelity interpolates between them. 1 keeps gaps as gaps, so an
 * ocean under the terminator reads as emptiness; 0 packs densely and leaves
 * geography as ordering only.
 *
 * A relax pass then pushes any overlapping row down. Order is preserved and
 * y only ever increases, so north never falls below south. `extent` is the
 * unclamped height, which is what the overflow stage scales against.
 */
export function placeRowsVertically(
  rows: Row[],
  viewportHeight: number,
  cfg: V2Config
): { rows: PlacedRow[]; extent: number } {
  if (rows.length === 0) return { rows: [], extent: 0 };

  const gap = cfg.tileGapPx;
  const stackHeight =
    rows.reduce((sum, r) => sum + r.height, 0) + gap * (rows.length - 1);

  let packedTop = Math.max(0, (viewportHeight - stackHeight) / 2);
  const fidelity = Math.max(0, Math.min(1, cfg.geographicFidelity));

  const placed: PlacedRow[] = rows.map((r) => {
    const packedCenter = packedTop + r.height / 2;
    packedTop += r.height + gap;
    const anchorCenter = mapLatToY(r.meanLat, cfg, viewportHeight);
    return { ...r, centerY: packedCenter + (anchorCenter - packedCenter) * fidelity };
  });

  // Relax downward. Input is already north-to-south, so index order is the
  // order we must keep — do NOT sort by centerY here.
  for (let i = 1; i < placed.length; i++) {
    const minCenter =
      placed[i - 1].centerY + placed[i - 1].height / 2 + gap + placed[i].height / 2;
    if (placed[i].centerY < minCenter) placed[i].centerY = minCenter;
  }

  const top = placed[0].centerY - placed[0].height / 2;
  const last = placed[placed.length - 1];
  const bottom = last.centerY + last.height / 2;

  // Pull the whole block up into any slack above before declaring overflow.
  if (bottom > viewportHeight && top > 0) {
    const shift = Math.min(top, bottom - viewportHeight);
    for (const r of placed) r.centerY -= shift;
  }

  return { rows: placed, extent: bottom - top };
}
