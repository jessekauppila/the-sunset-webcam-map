import { describe, it, expect } from 'vitest';
import { parsePanelPreview, fitScale } from './panelPreview';

const parse = (qs: string) => parsePanelPreview(new URLSearchParams(qs));

describe('parsePanelPreview', () => {
  it('returns null when no panel is requested, so the kiosk fills the window', () => {
    expect(parse('')).toBeNull();
    expect(parse('setup=1&floor=120')).toBeNull();
  });

  it('resolves the dell preset to its portrait dimensions', () => {
    expect(parse('panel=dell')).toEqual({ width: 1080, height: 1920 });
  });

  it('resolves the ktc preset to its portrait dimensions', () => {
    expect(parse('panel=ktc')).toEqual({ width: 1440, height: 2560 });
  });

  it('accepts a preset regardless of case', () => {
    expect(parse('panel=KTC')).toEqual({ width: 1440, height: 2560 });
  });

  it('accepts explicit WxH dimensions', () => {
    expect(parse('panel=900x1600')).toEqual({ width: 900, height: 1600 });
  });

  it('accepts an uppercase X separator', () => {
    expect(parse('panel=900X1600')).toEqual({ width: 900, height: 1600 });
  });

  it('returns null for an unknown preset name', () => {
    expect(parse('panel=samsung')).toBeNull();
  });

  it('returns null for malformed dimensions', () => {
    expect(parse('panel=1080')).toBeNull();
    expect(parse('panel=1080x')).toBeNull();
    expect(parse('panel=axb')).toBeNull();
  });

  it('returns null for dimensions outside the supported range', () => {
    expect(parse('panel=0x1920')).toBeNull();
    expect(parse('panel=99999x1920')).toBeNull();
  });
});

describe('fitScale', () => {
  it('shrinks a panel to fit a smaller window', () => {
    expect(fitScale(1080, 1920, 540, 1920)).toBe(0.5);
  });

  it('fits by whichever axis is tighter', () => {
    expect(fitScale(1000, 2000, 900, 1000)).toBe(0.5);
  });

  it('never scales beyond 1:1 when the window is larger than the panel', () => {
    expect(fitScale(1080, 1920, 3000, 4000)).toBe(1);
  });

  it('stays positive when the window has not been measured yet', () => {
    expect(fitScale(1080, 1920, 0, 0)).toBeGreaterThan(0);
  });
});
