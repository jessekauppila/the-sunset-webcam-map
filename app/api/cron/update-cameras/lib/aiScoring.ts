/**
 * Real-image scoring for the update-cameras cron.
 *
 * scoreImage() takes pre-fetched JPEG bytes and returns a regression score
 * via the v4 ResNet18 ONNX model. A SHA-256 of the bytes lets callers
 * short-circuit re-scoring identical frames (Redis-backed at call site).
 * On any ONNX failure, falls back to the metadata-only baseline so the
 * cron never crashes.
 */

import path from 'node:path';
import {
  AI_REGRESSION_MODEL_VERSION_DEFAULT,
  AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT,
  AI_SCORING_MODE_DEFAULT,
} from '@/app/lib/masterConfig';
import { sha256Hex } from './imageHash';
import { preprocessJpegToImagenetTensor } from './imagePreprocess';

export type WebcamSource = 'windy' | 'custom';

export interface ScoreImageInput {
  webcamId: number;
  imageBytes: Buffer;
  source: WebcamSource;
  /** From Redis. When equal to the new hash, returns cache-hit without scoring. */
  lastImageHash?: string;
  /** Used only when ONNX fails. Optional. */
  fallbackMeta?: { viewCount?: number; manualRating?: number };
}

export type ScorePath = 'onnx' | 'cache-hit' | 'baseline' | 'baseline-fallback';

export interface ScoreImageResult {
  rawScore: number;   // 0..1
  aiRating: number;   // 0..5 (display)
  modelVersion: string;
  imageHash: string;
  source: WebcamSource;
  pathTaken: ScorePath;
}

const cachedSessions = new Map<string, unknown>();
let cachedOrt: unknown | null = null;

export function __resetScoreImageCacheForTests(): void {
  cachedSessions.clear();
  cachedOrt = null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function resolveModelPath(): string {
  const ref =
    process.env.AI_ONNX_REGRESSION_MODEL_PATH?.trim() ||
    AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT;
  return path.isAbsolute(ref) ? ref : path.join(process.cwd(), ref);
}

function resolveModelVersion(): string {
  return (
    process.env.AI_REGRESSION_MODEL_VERSION?.trim() ||
    AI_REGRESSION_MODEL_VERSION_DEFAULT
  );
}

async function getOrt(): Promise<unknown> {
  if (cachedOrt) return cachedOrt;
  const moduleName = 'onnxruntime-node';
  cachedOrt = await import(moduleName);
  return cachedOrt;
}

async function getSession(modelPath: string): Promise<unknown> {
  const hit = cachedSessions.get(modelPath);
  if (hit) return hit;
  const ort = (await getOrt()) as {
    InferenceSession: { create: (p: string) => Promise<unknown> };
  };
  const session = await ort.InferenceSession.create(modelPath);
  cachedSessions.set(modelPath, session);
  return session;
}

function baselineRaw(input: ScoreImageInput): number {
  const views = input.fallbackMeta?.viewCount ?? 0;
  const manual = input.fallbackMeta?.manualRating ?? 3;
  const normViews = clamp(Math.log10(views + 1) / 6, 0, 1);
  const normManual = clamp(manual / 5, 0, 1);
  return clamp(normViews * 0.65 + normManual * 0.35, 0, 1);
}

function ratingFromRaw(raw: number): number {
  return Number((raw * 5).toFixed(2));
}

/** Map an ONNX output number to a normalized {rawScore, aiRating} pair. */
function normalizeOnnxOutput(value: number): {
  rawScore: number;
  aiRating: number;
} {
  // Regression model emits a 0..1 normalized value (training labels are
  // mapped (rating-1)/4 in ml/export_dataset.py). Multiply by 5 for the
  // display rating.
  const rawScore = clamp(value, 0, 1);
  const aiRating = clamp(rawScore * 5, 0, 5);
  return {
    rawScore: Number(rawScore.toFixed(6)),
    aiRating: Number(aiRating.toFixed(2)),
  };
}

/**
 * Score a single image. Caller is responsible for fetching bytes and
 * for the Redis hash lookup/write — this function is pure on its inputs
 * apart from the ONNX session cache.
 */
export async function scoreImage(
  input: ScoreImageInput
): Promise<ScoreImageResult> {
  const modelVersion = resolveModelVersion();
  const imageHash = sha256Hex(input.imageBytes);

  if (input.lastImageHash && input.lastImageHash === imageHash) {
    return {
      rawScore: 0, // ignored by caller on cache-hit
      aiRating: 0,
      modelVersion,
      imageHash,
      source: input.source,
      pathTaken: 'cache-hit',
    };
  }

  const mode =
    process.env.AI_SCORING_MODE?.trim() || AI_SCORING_MODE_DEFAULT;

  if (mode !== 'onnx') {
    const raw = baselineRaw(input);
    return {
      rawScore: raw,
      aiRating: ratingFromRaw(raw),
      modelVersion,
      imageHash,
      source: input.source,
      pathTaken: 'baseline',
    };
  }

  try {
    const ort = (await getOrt()) as {
      Tensor: new (t: string, d: Float32Array, dims: number[]) => unknown;
    };
    const session = (await getSession(resolveModelPath())) as {
      inputNames: string[];
      outputNames: string[];
      run: (feeds: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };

    const tensorData = await preprocessJpegToImagenetTensor(input.imageBytes);
    const tensor = new ort.Tensor('float32', tensorData, [1, 3, 224, 224]);
    const outputs = await session.run({ [session.inputNames[0]]: tensor });
    const raw = outputs[session.outputNames[0]] as { data?: ArrayLike<number> };
    const value = Number(raw?.data?.[0] ?? 0.5);
    const normalized = normalizeOnnxOutput(value);

    return {
      rawScore: normalized.rawScore,
      aiRating: normalized.aiRating,
      modelVersion,
      imageHash,
      source: input.source,
      pathTaken: 'onnx',
    };
  } catch (error) {
    console.warn(
      `[scoreImage] ONNX failed for webcam ${input.webcamId}, falling back:`,
      error
    );
    const raw = baselineRaw(input);
    return {
      rawScore: raw,
      aiRating: ratingFromRaw(raw),
      modelVersion,
      imageHash,
      source: input.source,
      pathTaken: 'baseline-fallback',
    };
  }
}
