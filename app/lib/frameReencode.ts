import sharp from 'sharp';

/**
 * Re-compress a frame before it is stored.
 *
 * Every frame is saved exactly as its source sent it, and sources disagree by
 * more than an order of magnitude about what a JPEG should cost. Measured
 * 2026-09-16 over a 60-preset spread of the live Digitraffic catalogue: mean
 * 282 KB, median 276 KB, p75 366 KB, max 494 KB, almost all 1280x720 --
 * against a Windy frame's ~14 KB at 400x224. At the per-tick cap that is
 * ~2.5 GB/day of new storage against today's ~200 MB.
 *
 * What this does NOT do is resize. It is tempting, since the model only ever
 * sees 224x224 (imagePreprocess.ts), but the glass does not: Windy frames are
 * inset rather than upscaled precisely because 400x224 cannot fill a 27-inch
 * panel, and a 1280x720 source is the first one sharp enough to. Shrinking
 * those would throw away the reason the source was worth adding. So the only
 * lever taken here is compression quality, which is worth a measured 25-40%
 * on a high-quality JPEG and nothing at all on an already-small one.
 *
 * Two properties this must never violate, because it sits on the storage path
 * of every frame the project keeps:
 *
 * 1. **It never returns a bigger buffer than it was given.** Re-encoding an
 *    already-compressed JPEG can inflate it -- measured: Windy frames grow
 *    from 12 KB to 14 KB at quality 90. The original wins any tie.
 * 2. **It never loses a frame.** Any decode or encode failure returns the
 *    original bytes. A frame stored uncompressed is a rounding error; a frame
 *    not stored at all is gone.
 */

/**
 * JPEG quality for stored frames. 82 with mozjpeg was measured at ~25% off a
 * Digitraffic frame with no visible change; 75 buys ~40% and starts to show
 * on gradients, which is exactly what this project photographs. Sunset skies
 * are the worst case for JPEG -- wide smooth gradients band before anything
 * else does -- so this stays conservative.
 */
export const STORAGE_JPEG_QUALITY = 82;

/**
 * Frames at or below this are left alone: there is nothing to win, and
 * re-encoding a small JPEG usually costs more bytes than it saves.
 */
export const REENCODE_MIN_BYTES = 64 * 1024;

/**
 * A guard against a pathological source, not a resize policy. Every source in
 * the register tops out at 1920x1080, so this is a no-op for all of them.
 */
export const STORAGE_MAX_LONG_EDGE = 1920;

export interface ReencodeResult {
  bytes: Buffer;
  /** What happened, for the tick's counters. */
  outcome: 'reencoded' | 'kept_original' | 'too_small' | 'failed';
  originalBytes: number;
}

export async function reencodeForStorage(
  input: Buffer,
  quality: number = STORAGE_JPEG_QUALITY,
): Promise<ReencodeResult> {
  const originalBytes = input.length;
  if (originalBytes <= REENCODE_MIN_BYTES) {
    return { bytes: input, outcome: 'too_small', originalBytes };
  }
  try {
    const out = await sharp(input)
      .resize(STORAGE_MAX_LONG_EDGE, STORAGE_MAX_LONG_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    // Property 1: the original wins a tie. Re-encoding is only ever allowed
    // to make a frame smaller.
    if (out.length >= originalBytes) {
      return { bytes: input, outcome: 'kept_original', originalBytes };
    }
    return { bytes: out, outcome: 'reencoded', originalBytes };
  } catch (error) {
    // Property 2: never lose a frame over a compression decision.
    console.warn('[frameReencode] re-encode failed, storing original:', error);
    return { bytes: input, outcome: 'failed', originalBytes };
  }
}
