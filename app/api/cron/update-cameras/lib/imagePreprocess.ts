import sharp from 'sharp';

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
const TARGET_SIZE = 224;

/**
 * Decode a JPEG buffer, resize to 224×224, and return a Float32Array in
 * CHW layout (channel-major) with ImageNet mean/std normalization. The
 * returned array is the raw input the ONNX session expects — wrap it in
 * a Tensor at call site.
 */
export async function preprocessJpegToImagenetTensor(
  jpegBytes: Buffer
): Promise<Float32Array> {
  const { data, info } = await sharp(jpegBytes)
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'cover' })
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
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    out[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    out[pixels + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    out[2 * pixels + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }

  return out;
}
