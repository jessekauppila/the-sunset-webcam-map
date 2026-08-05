import { describe, it, expect } from 'vitest';
import {
  KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX,
  KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX,
  KIOSK_CANVAS_MAX_IMAGES,
  COMPOSITION_TILE_FLOOR_PX,
  COMPOSITION_TILE_CEIL_PX,
  COMPOSITION_UPSCALE_MAX,
  COMPOSITION_LAT_WINDOW,
  COMPOSITION_MAX_GROWTH,
  COMPOSITION_CULL_OVERFLOW,
  COMPOSITION_CONFIG,
} from './masterConfig';

describe('kiosk portrait config constants', () => {
  it('KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX is a positive number larger than the default 128', () => {
    expect(typeof KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX).toBe('number');
    expect(KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX).toBeGreaterThan(128);
  });

  it('KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX is a positive number', () => {
    expect(typeof KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX).toBe('number');
    expect(KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX).toBeGreaterThan(0);
  });

  it('KIOSK_CANVAS_MAX_IMAGES is a positive integer', () => {
    expect(typeof KIOSK_CANVAS_MAX_IMAGES).toBe('number');
    expect(KIOSK_CANVAS_MAX_IMAGES).toBeGreaterThan(0);
    expect(Number.isInteger(KIOSK_CANVAS_MAX_IMAGES)).toBe(true);
  });

  it('min height is less than max height', () => {
    expect(KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX).toBeLessThan(
      KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX
    );
  });
});

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
