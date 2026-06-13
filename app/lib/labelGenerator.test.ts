// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildSetupUrl, labelDimensionsPx } from './labelGenerator';
import sharp from 'sharp';
import { generateLabelPng } from './labelGenerator';

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

describe('generateLabelPng', () => {
  it('produces a PNG of the tape dimensions', async () => {
    const png = await generateLabelPng({
      claimCode: 'SUNSET-7K3M-9XQ2',
      name: 'Backyard West',
      tape: { widthMm: 14, lengthMm: 75 },
      dpi: 300,
    });
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(886);
    expect(meta.height).toBe(165);
  });
});
