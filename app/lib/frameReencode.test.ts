// @vitest-environment node
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  reencodeForStorage,
  REENCODE_MIN_BYTES,
  STORAGE_MAX_LONG_EDGE,
} from './frameReencode';

/** A photo-like JPEG with gradients, so it compresses the way a sky does. */
async function fakeFrame(width: number, height: number, quality = 100): Promise<Buffer> {
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      px[i] = (x * 255) / width;
      px[i + 1] = (y * 255) / height;
      px[i + 2] = ((x + y) * 255) / (width + height);
    }
  }
  return sharp(px, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

describe('reencodeForStorage', () => {
  it('shrinks a large high-quality frame', async () => {
    const input = await fakeFrame(1280, 720, 100);
    expect(input.length).toBeGreaterThan(REENCODE_MIN_BYTES);
    const r = await reencodeForStorage(input);
    expect(r.outcome).toBe('reencoded');
    expect(r.bytes.length).toBeLessThan(input.length);
    expect(r.originalBytes).toBe(input.length);
  });

  it('leaves a frame that is already small alone', async () => {
    const input = await fakeFrame(400, 224, 80);
    expect(input.length).toBeLessThanOrEqual(REENCODE_MIN_BYTES);
    const r = await reencodeForStorage(input);
    expect(r.outcome).toBe('too_small');
    expect(r.bytes).toBe(input);
  });

  it('never returns a buffer bigger than the original', async () => {
    // An already-hard-compressed large frame: re-encoding it can only inflate.
    const input = await fakeFrame(1600, 1200, 12);
    const r = await reencodeForStorage(input, 95);
    expect(r.bytes.length).toBeLessThanOrEqual(input.length);
    if (r.outcome === 'kept_original') expect(r.bytes).toBe(input);
  });

  it('keeps the frame rather than losing it when the bytes are not an image', async () => {
    const junk = Buffer.alloc(REENCODE_MIN_BYTES + 1, 7);
    const r = await reencodeForStorage(junk);
    expect(r.outcome).toBe('failed');
    expect(r.bytes).toBe(junk);
  });

  it('does not resize a frame within the guard, so the glass keeps its pixels', async () => {
    const input = await fakeFrame(1280, 720, 100);
    const r = await reencodeForStorage(input);
    const meta = await sharp(r.bytes).metadata();
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);
  });

  it('caps a pathologically large frame at the long-edge guard', async () => {
    const input = await fakeFrame(3000, 2000, 100);
    const r = await reencodeForStorage(input);
    const meta = await sharp(r.bytes).metadata();
    expect(meta.width).toBe(STORAGE_MAX_LONG_EDGE);
  });

  it('never enlarges a small frame up to the guard', async () => {
    const input = await fakeFrame(800, 600, 100);
    const r = await reencodeForStorage(input);
    const meta = await sharp(r.bytes).metadata();
    expect(meta.width).toBe(800);
  });

  it('still produces a decodable JPEG', async () => {
    const input = await fakeFrame(1280, 720, 100);
    const r = await reencodeForStorage(input);
    const meta = await sharp(r.bytes).metadata();
    expect(meta.format).toBe('jpeg');
  });
});
