import sharp from 'sharp';

const TARGET_SIZE = 224;

/**
 * Decode a JPEG buffer, resize to 224×224, and return a Float32Array in
 * CHW layout (channel-major), scaled to [0,1]. The returned array is the
 * raw input the ONNX session expects — wrap it in a Tensor at call site.
 *
 * MUST MATCH TRAINING (`ml/train.py:360`: Resize((224,224)) + ToTensor):
 *  - plain /255 scaling, NO ImageNet mean/std. Until 2026-08-30 this file
 *    normalized with ImageNet stats, so every deployed model ran on inputs
 *    shifted up to ~2σ from its training distribution (v5's measured F1 vs
 *    the operator was 0.533 through that path vs 0.816 through the correct
 *    one). The offline scorer `ml/score_manifest.py` had — and fixed — the
 *    identical bug the same day.
 *  - `fit: 'fill'` (squash the full frame), not 'cover' (center-crop):
 *    torchvision's Resize distorts aspect rather than cropping, and the
 *    model has only ever seen squashed frames.
 */
export async function preprocessJpegToModelTensor(
  jpegBytes: Buffer
): Promise<Float32Array> {
  const { data, info } = await sharp(jpegBytes)
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 3) {
    throw new Error(
      `Expected 3 channels after preprocessing, got ${info.channels}`
    );
  }

  const pixels = TARGET_SIZE * TARGET_SIZE;
  const out = new Float32Array(3 * pixels);

  // sharp's raw output is HWC, byte-per-channel. Convert to CHW float.
  for (let i = 0; i < pixels; i++) {
    out[i] = data[i * 3] / 255;
    out[pixels + i] = data[i * 3 + 1] / 255;
    out[2 * pixels + i] = data[i * 3 + 2] / 255;
  }

  return out;
}
