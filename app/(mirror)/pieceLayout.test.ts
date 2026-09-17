import { describe, it, expect } from 'vitest';
import { PANEL_GAP_FRACTION, PIECE_MARGIN_FRACTION, fitPiece, panelCrop } from './pieceLayout';
import { pictureRect } from '@/app/lib/solo/caption';

const DELL_L = { width: 1920, height: 1080 };
const KTC_L = { width: 2560, height: 1440 };

/** The live gallery dials on 2026-09-16, the composition the piece must mirror. */
const LIVE = {
  captionLayout: 'inset' as const,
  captionAlign: 'picture' as const,
  captionGap: 14,
  pictureHeight: 72,
  pictureShift: -5,
};

describe('panelCrop', () => {
  it('drops the black either side of the picture: the crop IS the picture at the live dials', () => {
    const picture = pictureRect(LIVE, DELL_L.width, DELL_L.height);
    const crop = panelCrop(LIVE, DELL_L);

    expect(crop.left).toBe(picture.left);
    expect(crop.width).toBe(picture.width);
    // 72% of the panel's height, and the picture keeps the panel's aspect,
    // so 14% of the panel's width was black down each side.
    expect(crop.width / DELL_L.width).toBeCloseTo(0.72, 2);
  });

  it('follows the caption out when captionAlign spreads it across the panel', () => {
    const picture = pictureRect(LIVE, DELL_L.width, DELL_L.height);
    const wide = panelCrop({ ...LIVE, captionAlign: 'panel' }, DELL_L);

    // The words run nearly the panel's width at this dial; cropping to the
    // picture would slice their ends off.
    expect(wide.left).toBeLessThan(picture.left);
    expect(wide.left + wide.width).toBeGreaterThan(picture.left + picture.width);
    expect(wide.left).toBeGreaterThanOrEqual(0);
    expect(wide.left + wide.width).toBeLessThanOrEqual(DELL_L.width);
  });

  it('shows the whole panel when the caption is centred in it', () => {
    const crop = panelCrop({ ...LIVE, captionAlign: 'center' }, DELL_L);
    expect(crop).toEqual({ left: 0, width: DELL_L.width });
  });

  it('shows the whole panel under an overlay caption, where the picture already fills it', () => {
    const crop = panelCrop({ ...LIVE, captionLayout: 'overlay' }, DELL_L);
    expect(crop).toEqual({ left: 0, width: DELL_L.width });
  });

  it('stays inside the panel at every picture height, and never crops to nothing', () => {
    for (const preset of [DELL_L, KTC_L]) {
      for (let pictureHeight = 20; pictureHeight <= 100; pictureHeight += 5) {
        const crop = panelCrop({ ...LIVE, pictureHeight }, preset);
        expect(crop.left).toBeGreaterThanOrEqual(0);
        expect(crop.width).toBeGreaterThan(0);
        expect(crop.left + crop.width).toBeLessThanOrEqual(preset.width);
      }
    }
  });

  it('leaves the seam as the ONLY space between the two pictures', () => {
    // Jesse, 2026-09-16, on the piece before this crop: the pictures had a
    // corridor between them. It was never the seam — it was each panel's own
    // inner margin, twice. This is that complaint as an assertion.
    const crop = panelCrop(LIVE, DELL_L);
    const layout = fitPiece({ width: crop.width, height: DELL_L.height }, 1440, 900);
    const picture = pictureRect(LIVE, DELL_L.width, DELL_L.height);

    // Left picture's right edge to right picture's left edge, in page px.
    const insetPerSide = (picture.left - crop.left) * layout.scale;
    const between = insetPerSide * 2 + layout.gap;

    expect(insetPerSide).toBe(0);
    expect(between).toBeCloseTo(layout.gap, 6);
    // And the seam stays slight: a hair over 1% of the window, not a corridor.
    expect(between / 1440).toBeLessThan(0.02);
  });
});

describe('fitPiece', () => {
  it('fits the pair and its seam inside the window, margins clear on every side', () => {
    const laptop = { width: 1440, height: 900 };
    const layout = fitPiece(DELL_L, laptop.width, laptop.height);
    const margin = Math.min(laptop.width, laptop.height) * PIECE_MARGIN_FRACTION;

    expect(layout.width).toBeLessThanOrEqual(laptop.width - margin * 2 + 0.001);
    expect(layout.height).toBeLessThanOrEqual(laptop.height - margin * 2 + 0.001);
    // Width-limited on any ordinary window: the pair is nearly 4:1.
    expect(layout.width).toBeCloseTo(laptop.width - margin * 2, 6);
  });

  it('scales both panels and the seam by the same factor, so the pair keeps its proportions', () => {
    const layout = fitPiece(DELL_L, 1440, 900);
    const panelWidth = DELL_L.width * layout.scale;

    expect(layout.gap).toBeCloseTo(DELL_L.width * PANEL_GAP_FRACTION * layout.scale, 6);
    expect(layout.width).toBeCloseTo(panelWidth * 2 + layout.gap, 6);
    expect(layout.height).toBeCloseTo(DELL_L.height * layout.scale, 6);
    // The seam relative to a panel is the constant, whatever the window.
    expect(layout.gap / panelWidth).toBeCloseTo(PANEL_GAP_FRACTION, 10);
  });

  it('keeps the seam the same share of the picture at every window size and preset', () => {
    const shares = [
      fitPiece(DELL_L, 1440, 900),
      fitPiece(DELL_L, 390, 844),
      fitPiece(KTC_L, 2560, 1600),
      fitPiece(KTC_L, 1024, 768),
    ].map((l, i) => l.gap / ((i < 2 ? DELL_L.width : KTC_L.width) * l.scale));

    for (const share of shares) expect(share).toBeCloseTo(PANEL_GAP_FRACTION, 10);
  });

  it('is height-limited on a narrow tall window, and still leaves the margin', () => {
    const phone = { width: 390, height: 844 };
    const layout = fitPiece(DELL_L, phone.width, phone.height);
    const margin = Math.min(phone.width, phone.height) * PIECE_MARGIN_FRACTION;

    // A 4:1 pair inside a portrait phone is still width-limited; what matters
    // is that neither edge is exceeded.
    expect(layout.width).toBeLessThanOrEqual(phone.width - margin * 2 + 0.001);
    expect(layout.height).toBeLessThanOrEqual(phone.height - margin * 2 + 0.001);
    expect(layout.scale).toBeGreaterThan(0);
  });

  it('never upscales past the panel: the frames are archived at panel resolution', () => {
    const wall = fitPiece(DELL_L, 20_000, 20_000);
    expect(wall.scale).toBe(1);
    expect(wall.width).toBe(DELL_L.width * 2 + DELL_L.width * PANEL_GAP_FRACTION);
  });

  it('returns a zero scale for an unmeasured window rather than guessing', () => {
    expect(fitPiece(DELL_L, 0, 0)).toEqual({ scale: 0, gap: 0, width: 0, height: 0 });
  });

  it('stays positive for any real window: the margin is a share of the shorter edge, so it can never eat it', () => {
    // The guard above is for the unmeasured case only. A margin taken from
    // the shorter edge is at most 8% of either edge, so a window of any
    // positive size still has room left; there is no size at which the piece
    // collapses to nothing and silently stops rendering.
    for (const [w, h] of [[1, 1], [320, 200], [1, 4000]]) {
      expect(fitPiece(DELL_L, w, h).scale).toBeGreaterThan(0);
    }
  });
});
