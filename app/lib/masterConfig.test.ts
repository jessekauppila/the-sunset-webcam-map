import { describe, it, expect } from 'vitest';
import {
  KIOSK_MOSAIC_MAX_IMAGE_HEIGHT_PX,
  KIOSK_MOSAIC_MIN_IMAGE_HEIGHT_PX,
  KIOSK_CANVAS_MAX_IMAGES,
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
