// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildSetupUrl, labelDimensionsPx } from './labelGenerator';

describe('buildSetupUrl', () => {
  it('builds the www setup URL with the claim code', () => {
    expect(buildSetupUrl('SUNSET-7K3M-9XQ2'))
      .toBe('https://www.sunrisesunset.studio/setup/SUNSET-7K3M-9XQ2');
  });
});

describe('labelDimensionsPx', () => {
  it('converts 14x75mm at 300dpi to landscape px (length x width)', () => {
    const d = labelDimensionsPx({ widthMm: 14, lengthMm: 75 }, 300);
    expect(d.width).toBe(886);
    expect(d.height).toBe(165);
  });
});
