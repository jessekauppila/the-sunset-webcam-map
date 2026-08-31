import { describe, it, expect } from 'vitest';
import {
  COMPOSITION_TILE_FLOOR_PX,
  COMPOSITION_TILE_CEIL_PX,
  COMPOSITION_UPSCALE_MAX,
  COMPOSITION_LAT_WINDOW,
  COMPOSITION_MAX_GROWTH,
  COMPOSITION_CULL_OVERFLOW,
  COMPOSITION_CONFIG,
} from './config';

describe('composition config constants', () => {
  it('COMPOSITION_TILE_FLOOR_PX is exactly 100', () => {
    expect(COMPOSITION_TILE_FLOOR_PX).toEqual(100);
  });

  it('COMPOSITION_TILE_CEIL_PX is exactly 300', () => {
    expect(COMPOSITION_TILE_CEIL_PX).toEqual(300);
  });

  it('COMPOSITION_UPSCALE_MAX is exactly 1.5', () => {
    expect(COMPOSITION_UPSCALE_MAX).toEqual(1.5);
  });

  it('COMPOSITION_LAT_WINDOW is [70, -60]', () => {
    expect(COMPOSITION_LAT_WINDOW).toEqual([70, -60]);
  });

  it('COMPOSITION_MAX_GROWTH is exactly 2.0', () => {
    expect(COMPOSITION_MAX_GROWTH).toEqual(2.0);
  });

  it('COMPOSITION_CULL_OVERFLOW is true', () => {
    expect(COMPOSITION_CULL_OVERFLOW).toBe(true);
  });

  it('COMPOSITION_CONFIG.floorPx equals COMPOSITION_TILE_FLOOR_PX', () => {
    expect(COMPOSITION_CONFIG.floorPx).toEqual(COMPOSITION_TILE_FLOOR_PX);
  });

  it('COMPOSITION_CONFIG.padding is exactly 2', () => {
    expect(COMPOSITION_CONFIG.padding).toEqual(2);
  });
});
