import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { preprocessJpegToImagenetTensor } from './imagePreprocess';

async function makeRedJpeg(width = 300, height = 200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('preprocessJpegToImagenetTensor', () => {
  it('returns a Float32Array of length 3*224*224 in CHW layout', async () => {
    const jpeg = await makeRedJpeg();
    const tensor = await preprocessJpegToImagenetTensor(jpeg);
    expect(tensor).toBeInstanceOf(Float32Array);
    expect(tensor.length).toBe(3 * 224 * 224);
  });

  it('normalizes with ImageNet mean/std (red image -> R channel ≈ (1 - 0.485) / 0.229)', async () => {
    const jpeg = await makeRedJpeg();
    const tensor = await preprocessJpegToImagenetTensor(jpeg);

    // R channel is the first 224*224 slice (CHW layout).
    const rPlane = tensor.subarray(0, 224 * 224);
    const avg = rPlane.reduce((s, v) => s + v, 0) / rPlane.length;

    const expected = (1.0 - 0.485) / 0.229; // ≈ 2.249
    // JPEG is lossy; allow a generous tolerance.
    expect(avg).toBeGreaterThan(expected - 0.3);
    expect(avg).toBeLessThan(expected + 0.3);
  });

  it('throws on non-image bytes', async () => {
    await expect(
      preprocessJpegToImagenetTensor(Buffer.from('not an image'))
    ).rejects.toThrow();
  });
});
