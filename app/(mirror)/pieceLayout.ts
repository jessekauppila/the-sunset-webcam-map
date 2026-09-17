import { captionBox, pictureRect } from '@/app/lib/solo/caption';
import type { PanelSize } from '@/app/kiosk/panelPreview';
import type { SoloDials } from '@/app/lib/solo/types';

/**
 * Fitting BOTH panels into one browser window (mirror spec §3, extended).
 *
 * `/sunrise` and `/sunset` each scale one panel to the window with
 * `PanelFrame`. The piece scales the PAIR — two panels and the seam between
 * them — as one object, so the two pictures keep their true relative size
 * and neither is judged against a window edge the other does not share.
 */

/**
 * The seam between the two pictures, as a fraction of one panel's VISIBLE
 * width — the cropped width from `panelCrop`, not the panel's full width.
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
 * The part of a panel the piece actually shows, horizontally.
 *
 * A solo2 panel is mostly not picture. At the live dials the picture is 72%
 * of the panel's height and keeps the panel's aspect, so it is also 72% of
 * its width, centred — leaving 14% of the panel as black down each side. On
 * the wall that black is invisible: it is an unlit part of a screen in a
 * dark room, and the eye reads the lit rectangle as the edge of the work.
 * Side by side in a browser the two inner margins meet and stop being two
 * screens' edges; they add into one bright-free corridor between the
 * pictures, wide enough to become the thing you look at.
 *
 * So the piece crops it. Each panel is drawn at its true pixels and shown
 * through a window the width of its CONTENT, which is why the gap Jesse sees
 * on a laptop is the seam above and nothing else.
 *
 * The mirrors and the wall part company here, on purpose (Jesse, 2026-09-16:
 * "It's ok if they are different. They are different mediums."). `/sunrise`
 * and `/sunset` still show a whole panel, because one screen alone has no
 * facing margin to add up, and the leftover black there reads as ordinary
 * letterboxing against a black page.
 *
 * Content is the union of the picture and the caption, NOT the picture
 * alone. `captionAlign` is a dial: at `picture` (live today) the words are
 * already inside the picture's width, but at `panel` or `center` they run
 * most of the panel, and a crop to the picture would slice the ends off
 * them. Reading the caption's own box means the dial can move without
 * quietly cutting words in half here.
 */
export interface PanelCrop {
  /** Left edge of the visible window, in panel pixels from the panel's left. */
  left: number;
  /** Width of the visible window, in panel pixels. */
  width: number;
}

export function panelCrop(
  dials: Pick<SoloDials, 'captionLayout' | 'captionAlign' | 'captionGap' | 'pictureHeight' | 'pictureShift'>,
  panel: PanelSize,
): PanelCrop {
  const picture = pictureRect(dials, panel.width, panel.height);
  const caption = captionBox(dials, picture, panel.width);
  const captionWidth = caption.width ?? caption.maxWidth ?? 0;
  const left = Math.max(0, Math.min(picture.left, caption.left));
  const right = Math.min(
    panel.width,
    Math.max(picture.left + picture.width, caption.left + captionWidth),
  );
  // A panel whose content somehow measures to nothing falls back to the whole
  // panel rather than to a zero-width window: showing too much black is a
  // blemish, showing none of the picture is a blank page.
  if (!(right > left)) return { left: 0, width: panel.width };
  return { left, width: right - left };
}

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
 * `visible` is what each panel SHOWS — `panelCrop`'s width by the panel's
 * full height — not the panel itself. Fitting the uncropped panel would
 * scale the piece to include black the page then hides, so the pictures
 * would land smaller than the window allows.
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
export function fitPiece(visible: PanelSize, viewportWidth: number, viewportHeight: number): PieceLayout {
  const gap = visible.width * PANEL_GAP_FRACTION;
  const contentWidth = visible.width * 2 + gap;
  const contentHeight = visible.height;
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
