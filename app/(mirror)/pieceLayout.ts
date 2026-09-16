import type { PanelSize } from '@/app/kiosk/panelPreview';

/**
 * Fitting BOTH panels into one browser window (mirror spec §3, extended).
 *
 * `/sunrise` and `/sunset` each scale one panel to the window with
 * `PanelFrame`. The piece scales the PAIR — two panels and the seam between
 * them — as one object, so the two pictures keep their true relative size
 * and neither is judged against a window edge the other does not share.
 */

/**
 * The seam between the two pictures, as a fraction of one panel's width.
 *
 * Deliberately NOT the wall. The gallery's real gap is about 37 mm between
 * the two active areas — 19 mm of wall at 25" arm centres plus a 9 mm bezel
 * each side — which is 6.2% of a panel's width. Reproduced literally in a
 * browser it reads as two screenshots with a corridor between them, because
 * the page supplies none of the cues that make the real gap disappear in the
 * room: depth, the light on the wall, the wall itself. What survives the
 * change of medium is a seam — enough to say "two screens", not enough to
 * become a third shape competing with the pictures.
 */
export const PANEL_GAP_FRACTION = 0.015;

/**
 * Breathing room around the pair, as a fraction of the SHORTER viewport edge.
 *
 * Measured off the shorter edge so the margin stays the same on all four
 * sides. The piece is very wide and very short, so it is almost always
 * width-limited; a margin derived from the width alone would grow into a
 * band above and below the pictures on a tall window.
 */
export const PIECE_MARGIN_FRACTION = 0.04;

export interface PieceLayout {
  /** Applied to both panels and to the seam, so the pair scales as one object. */
  scale: number;
  /** The seam, in scaled px — what the flex row puts between the two panels. */
  gap: number;
  /** The pair's scaled footprint, margins excluded. */
  width: number;
  height: number;
}

/**
 * The scale that fits two panels and their seam inside `viewport`, with
 * `PIECE_MARGIN_FRACTION` of the shorter edge left clear on every side.
 *
 * Capped at 1:1, as `fitScale` is: the frames are archived JPEGs at the
 * panel's own resolution, so drawing them larger than the panel only
 * enlarges their artefacts.
 *
 * Returns a zero scale for an unmeasured window rather than guessing 1. The
 * piece is two panels wide, so a guess would paint something several times
 * the window for one frame; the caller holds the dark box until the numbers
 * are real, which it is doing anyway while the first projection is in flight.
 */
export function fitPiece(panel: PanelSize, viewportWidth: number, viewportHeight: number): PieceLayout {
  const gap = panel.width * PANEL_GAP_FRACTION;
  const contentWidth = panel.width * 2 + gap;
  const contentHeight = panel.height;
  const margin = Math.min(viewportWidth, viewportHeight) * PIECE_MARGIN_FRACTION;
  const availableWidth = viewportWidth - margin * 2;
  const availableHeight = viewportHeight - margin * 2;
  if (availableWidth <= 0 || availableHeight <= 0) {
    return { scale: 0, gap: 0, width: 0, height: 0 };
  }
  const scale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1);
  return {
    scale,
    gap: gap * scale,
    width: contentWidth * scale,
    height: contentHeight * scale,
  };
}
