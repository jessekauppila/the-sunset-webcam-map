import { describe, it, expect } from 'vitest';
import { parseCompositionOverrides } from './compositionOverrides';

const parse = (qs: string) => parseCompositionOverrides(new URLSearchParams(qs));

describe('parseCompositionOverrides', () => {
  it('returns no overrides for an empty query string', () => {
    expect(parse('')).toEqual({});
  });

  it('reads every numeric tunable under its short param name', () => {
    expect(parse('floor=120&ceil=340&upscale=1.8&growth=2.5&pad=6')).toEqual({
      floorPx: 120,
      ceilPx: 340,
      upscaleMax: 1.8,
      maxGrowth: 2.5,
      padding: 6,
    });
  });

  it('omits a param that is not a number so the default survives', () => {
    expect(parse('floor=wide')).toEqual({});
  });

  it('omits a param that is present but empty', () => {
    expect(parse('floor=')).toEqual({});
  });

  it('clamps a numeric param to its supported range', () => {
    expect(parse('floor=99999')).toEqual({ floorPx: 1000 });
    expect(parse('pad=-5')).toEqual({ padding: 0 });
  });

  it('reads cull as a 0/1 boolean', () => {
    expect(parse('cull=0')).toEqual({ cullOverflow: false });
    expect(parse('cull=1')).toEqual({ cullOverflow: true });
  });

  it('omits cull when it is not 0 or 1', () => {
    expect(parse('cull=maybe')).toEqual({});
  });

  it('reads lat as a north,south pair', () => {
    expect(parse('lat=70,-60')).toEqual({ latWindow: [70, -60] });
  });

  it('omits lat when north is not above south', () => {
    expect(parse('lat=-60,70')).toEqual({});
  });

  it('omits lat when it is not a well-formed pair', () => {
    expect(parse('lat=70')).toEqual({});
    expect(parse('lat=70,abc')).toEqual({});
  });

  it('omits lat when a bound is outside the poles', () => {
    expect(parse('lat=200,-60')).toEqual({});
  });

  it('ignores unrelated params such as the setup flag', () => {
    expect(parse('setup=1&floor=120')).toEqual({ floorPx: 120 });
  });
});
