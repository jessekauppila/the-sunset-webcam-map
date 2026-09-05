import { describe, it, expect, vi } from 'vitest';
import {
  MOSAIC_VERSIONS,
  DEFAULT_MOSAIC_VERSION,
  resolveMosaic,
  resolveMosaicName,
} from './registry';
import { MosaicV1 } from './v1';

vi.mock('./v1', () => ({
  MosaicV1: () => null,
}));
vi.mock('@/app/components/solo', () => ({
  SoloKiosk: () => null,
}));

describe('mosaic registry', () => {
  it('registers the solo renderer as a version, so the active-version dial can select it', () => {
    expect(MOSAIC_VERSIONS.solo).toBeDefined();
    expect(DEFAULT_MOSAIC_VERSION).not.toBe('solo'); // the public site keeps the mosaic
  });

  it('pins v1 as the default version', () => {
    expect(DEFAULT_MOSAIC_VERSION).toBe('v1');
    expect(MOSAIC_VERSIONS[DEFAULT_MOSAIC_VERSION]).toBeDefined();
  });

  it('resolves a known version by name', () => {
    expect(resolveMosaic('v1')).toBe(MosaicV1);
  });

  it('falls back to the default for null (no ?v= param)', () => {
    expect(resolveMosaic(null)).toBe(
      MOSAIC_VERSIONS[DEFAULT_MOSAIC_VERSION]
    );
  });

  it('falls back to the default for an unknown version name', () => {
    expect(resolveMosaic('v999')).toBe(
      MOSAIC_VERSIONS[DEFAULT_MOSAIC_VERSION]
    );
  });

  it('resolveMosaicName resolves a known version to itself', () => {
    expect(resolveMosaicName('v1')).toBe('v1');
  });

  it('resolveMosaicName falls back to the default name for an unknown version', () => {
    expect(resolveMosaicName('nope')).toBe('v1');
  });
});
