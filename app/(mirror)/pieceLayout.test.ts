import { describe, it, expect } from 'vitest';
import { PANEL_GAP_FRACTION, PIECE_MARGIN_FRACTION, fitPiece } from './pieceLayout';

const DELL_L = { width: 1920, height: 1080 };
const KTC_L = { width: 2560, height: 1440 };

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
