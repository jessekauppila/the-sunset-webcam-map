import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { preprocessJpegToModelTensor } from './imagePreprocess';

async function makeJpeg(
  width: number,
  height: number,
  background: { r: number; g: number; b: number }
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer();
}

describe('preprocessJpegToModelTensor', () => {
  it('returns a Float32Array of length 3*224*224 in CHW layout', async () => {
    const jpeg = await makeJpeg(300, 200, { r: 255, g: 0, b: 0 });
    const tensor = await preprocessJpegToModelTensor(jpeg);
    expect(tensor).toBeInstanceOf(Float32Array);
    expect(tensor.length).toBe(3 * 224 * 224);
  });

  it('scales to [0,1] with NO ImageNet normalization (training parity)', async () => {
    // ml/train.py:360 preprocesses with Resize + ToTensor only. Until
    // 2026-08-30 this module normalized with ImageNet mean/std, feeding
    // every deployed model inputs ~2σ off its training distribution.
    const jpeg = await makeJpeg(300, 200, { r: 255, g: 0, b: 0 });
    const tensor = await preprocessJpegToModelTensor(jpeg);
    const plane = 224 * 224;
    const avg = (p: Float32Array) =>
      p.reduce((s: number, v: number) => s + v, 0) / p.length;
    // Red frame → R ≈ 1.0, G/B ≈ 0.0. ImageNet normalize would give ≈2.25/-2.0.
    expect(avg(tensor.subarray(0, plane))).toBeGreaterThan(0.9);
    expect(avg(tensor.subarray(0, plane))).toBeLessThanOrEqual(1.0);
    expect(avg(tensor.subarray(plane, 2 * plane))).toBeLessThan(0.1);
    expect(avg(tensor.subarray(2 * plane, 3 * plane))).toBeLessThan(0.1);
  });

  it('squashes the full frame (fit:fill) rather than center-cropping', async () => {
    // torchvision Resize distorts aspect; the model has only ever seen
    // squashed frames. Build a wide red image with a blue stripe on the far
    // right edge — 'cover' would crop the stripe away, 'fill' keeps it.
    const stripe = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 30, height: 200, channels: 3, background: { r: 0, g: 0, b: 255 } },
          }).png().toBuffer(),
          left: 270,
          top: 0,
        },
      ])
      .jpeg()
      .toBuffer();
    const tensor = await preprocessJpegToModelTensor(stripe);
    const plane = 224 * 224;
    // Rightmost column of the blue plane must be blue (≈1), not red-cropped.
    let rightBlue = 0;
    for (let row = 0; row < 224; row++) rightBlue += tensor[2 * plane + row * 224 + 223];
    expect(rightBlue / 224).toBeGreaterThan(0.8);
  });

  it('throws on non-image bytes', async () => {
    await expect(
      preprocessJpegToModelTensor(Buffer.from('not an image'))
    ).rejects.toThrow();
  });
});
