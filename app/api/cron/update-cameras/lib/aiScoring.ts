/**
 * Real-image scoring for the update-cameras cron.
 *
 * scoreImage() takes pre-fetched JPEG bytes and returns up to two ONNX
 * outputs:
 *
 *   1. Regression head — predicts a quality score in [0,1]. Required:
 *      the cron has always run this model and the popup's existing
 *      rating display reads from its DB column.
 *
 *   2. Binary head — predicts is_sunset as a softmax probability in
 *      [0,1]. Optional: only ships when AI_ONNX_BINARY_MODEL_PATH points
 *      at a real file. Adds the binary fields to ScoreImageResult and
 *      lets the popup show a real "Sunset detected" verdict instead of
 *      a regression-threshold proxy. See
 *      `memory/project_two_tier_sunset_classification.md`.
 *
 * A SHA-256 of the bytes lets callers short-circuit re-scoring identical
 * frames (Redis-backed at call site). On any regression-ONNX failure,
 * falls back to the metadata-only baseline so the cron never crashes;
 * binary failures degrade silently (binary fields left undefined).
 */

import path from 'node:path';
import {
  AI_BINARY_DECISION_THRESHOLD,
  AI_BINARY_MODEL_VERSION_DEFAULT,
  AI_ONNX_BINARY_MODEL_PATH_DEFAULT,
  AI_REGRESSION_MODEL_VERSION_DEFAULT,
  AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT,
  AI_SCORING_MODE_DEFAULT,
  SUNSET_DISAGREEMENT_HIGH,
  SUNSET_DISAGREEMENT_LOW,
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
  // Regression (required — always present except cache-hit).
  rawScore: number;   // 0..1 (normalized; matches training label scale)
  aiRating: number;   // 1..5 (display; inverse of (rating-1)/4 used at train time)
  modelVersion: string;
  imageHash: string;
  source: WebcamSource;
  pathTaken: ScorePath;

  // Binary (optional — present when the binary classifier is configured
  // and ran successfully).
  binaryRawScore?: number;       // softmax probability of class 1 (sunset), 0..1
  binaryIsSunset?: boolean;      // binaryRawScore >= AI_BINARY_DECISION_THRESHOLD
  binaryModelVersion?: string;
  binaryPathTaken?: ScorePath;   // 'onnx' | 'baseline-fallback'
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

/* -------------------------------------------------------------------------- */
/* Env-var resolution                                                          */
/* -------------------------------------------------------------------------- */

function resolveRegressionModelPath(): string {
  const ref =
    process.env.AI_ONNX_REGRESSION_MODEL_PATH?.trim() ||
    AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT;
  return path.isAbsolute(ref) ? ref : path.join(process.cwd(), ref);
}
function resolveRegressionModelVersion(): string {
  return (
    process.env.AI_REGRESSION_MODEL_VERSION?.trim() ||
    AI_REGRESSION_MODEL_VERSION_DEFAULT
  );
}

function resolveBinaryModelPath(): string {
  const ref =
    process.env.AI_ONNX_BINARY_MODEL_PATH?.trim() ||
    AI_ONNX_BINARY_MODEL_PATH_DEFAULT;
  return path.isAbsolute(ref) ? ref : path.join(process.cwd(), ref);
}
function resolveBinaryModelVersion(): string {
  return (
    process.env.AI_BINARY_MODEL_VERSION?.trim() ||
    AI_BINARY_MODEL_VERSION_DEFAULT
  );
}
function resolveBinaryThreshold(): number {
  const raw = process.env.AI_BINARY_SUNSET_THRESHOLD?.trim();
  if (!raw) return AI_BINARY_DECISION_THRESHOLD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : AI_BINARY_DECISION_THRESHOLD;
}

/**
 * The binary classifier is opt-in by env var (`AI_BINARY_SCORING_ENABLED=true`).
 * When disabled, the cost of trying-and-failing to load every tick is avoided
 * and the result shape matches the historical regression-only behaviour.
 */
function binaryEnabled(): boolean {
  const raw = process.env.AI_BINARY_SCORING_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/* -------------------------------------------------------------------------- */
/* ONNX session plumbing                                                       */
/* -------------------------------------------------------------------------- */

async function getOrt(): Promise<unknown> {
  if (cachedOrt) return cachedOrt;
  // Static string is required so Vercel's output-file tracer detects the
  // dependency. A variable-indirection (`await import(varName)`) is opaque
  // to the tracer and ships a function bundle without the package, causing
  // MODULE_NOT_FOUND at runtime. `serverExternalPackages` in next.config.ts
  // is what prevents bundling.
  cachedOrt = await import('onnxruntime-node');
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

/* -------------------------------------------------------------------------- */
/* Output mappings                                                             */
/* -------------------------------------------------------------------------- */

function baselineRaw(input: ScoreImageInput): number {
  const views = input.fallbackMeta?.viewCount ?? 0;
  const manual = input.fallbackMeta?.manualRating ?? 3;
  const normViews = clamp(Math.log10(views + 1) / 6, 0, 1);
  const normManual = clamp(manual / 5, 0, 1);
  return clamp(normViews * 0.65 + normManual * 0.35, 0, 1);
}

function ratingFromRaw(raw: number): number {
  // Inverse of the (rating-1)/4 label normalization in ml/export_dataset.py:
  // rawScore=0 -> 1 star, rawScore=1 -> 5 stars, rawScore=0.5 -> 3 stars.
  return Number((1 + clamp(raw, 0, 1) * 4).toFixed(2));
}

function normalizeRegressionOutput(value: number): {
  rawScore: number;
  aiRating: number;
} {
  const rawScore = clamp(value, 0, 1);
  const aiRating = 1 + rawScore * 4;
  return {
    rawScore: Number(rawScore.toFixed(6)),
    aiRating: Number(aiRating.toFixed(2)),
  };
}

/**
 * Decide whether the two heads disagree extremely enough to flag the
 * snapshot for the Hard Examples queue. Pure function — no DB writes here,
 * the caller persists the return value on the snapshot row.
 *
 * Returns a kind string OR null:
 *   'binary_negative_regression_high' — false negative (the Taltson case)
 *   'binary_positive_regression_low'  — false positive (model called sunset on something boring)
 *   null                              — agreement, or one head didn't score
 */
export function computeDisagreementKind(input: {
  binaryIsSunset: boolean | undefined;
  aiRating: number | undefined;
}): string | null {
  if (typeof input.binaryIsSunset !== 'boolean') return null;
  if (typeof input.aiRating !== 'number') return null;
  if (!input.binaryIsSunset && input.aiRating >= SUNSET_DISAGREEMENT_HIGH) {
    return 'binary_negative_regression_high';
  }
  if (input.binaryIsSunset && input.aiRating <= SUNSET_DISAGREEMENT_LOW) {
    return 'binary_positive_regression_low';
  }
  return null;
}

/**
 * Convert a [1, 2] logits tensor into a softmax probability of class 1.
 * Numerically stable: subtract the max before exponentiating.
 */
export function softmaxBinaryClassOne(logits: ArrayLike<number>): number {
  const x0 = Number(logits[0]);
  const x1 = Number(logits[1]);
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return 0;
  const m = Math.max(x0, x1);
  const e0 = Math.exp(x0 - m);
  const e1 = Math.exp(x1 - m);
  const denom = e0 + e1;
  return denom > 0 ? e1 / denom : 0;
}

/* -------------------------------------------------------------------------- */
/* Inference                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Runs ONE ONNX session on a preprocessed tensor and returns the first output
 * tensor's data array. Shared by the regression and binary heads.
 */
async function runOnnxSession(
  ort: unknown,
  modelPath: string,
  tensorData: Float32Array,
): Promise<ArrayLike<number>> {
  const ortTyped = ort as {
    Tensor: new (t: string, d: Float32Array, dims: number[]) => unknown;
  };
  const session = (await getSession(modelPath)) as {
    inputNames: string[];
    outputNames: string[];
    run: (feeds: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  const tensor = new ortTyped.Tensor('float32', tensorData, [1, 3, 224, 224]);
  const outputs = await session.run({ [session.inputNames[0]]: tensor });
  const out = outputs[session.outputNames[0]] as { data?: ArrayLike<number> };
  return out?.data ?? [];
}

async function scoreBinary(
  ort: unknown,
  webcamId: number,
  tensorData: Float32Array,
): Promise<{
  rawScore: number;
  isSunset: boolean;
  modelVersion: string;
  pathTaken: ScorePath;
} | undefined> {
  if (!binaryEnabled()) return undefined;
  const modelVersion = resolveBinaryModelVersion();
  const threshold = resolveBinaryThreshold();
  try {
    const data = await runOnnxSession(ort, resolveBinaryModelPath(), tensorData);
    const probability = softmaxBinaryClassOne(data);
    return {
      rawScore: Number(probability.toFixed(6)),
      isSunset: probability >= threshold,
      modelVersion,
      pathTaken: 'onnx',
    };
  } catch (error) {
    console.warn(
      `[scoreImage] binary ONNX failed for webcam ${webcamId}, leaving binary fields unset:`,
      error,
    );
    return {
      rawScore: 0,
      isSunset: false,
      modelVersion,
      pathTaken: 'baseline-fallback',
    };
  }
}

/**
 * Score a single image. Caller is responsible for fetching bytes and
 * for the Redis hash lookup/write — this function is pure on its inputs
 * apart from the ONNX session cache.
 */
export async function scoreImage(
  input: ScoreImageInput,
): Promise<ScoreImageResult> {
  const modelVersion = resolveRegressionModelVersion();
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

  // ONNX mode — preprocess once, run both heads against the same tensor.
  let ort: unknown;
  let tensorData: Float32Array;
  try {
    ort = await getOrt();
    tensorData = await preprocessJpegToImagenetTensor(input.imageBytes);
  } catch (error) {
    console.warn(
      `[scoreImage] ONNX setup failed for webcam ${input.webcamId}, falling back:`,
      error,
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

  // Regression head — required.
  let regression: { rawScore: number; aiRating: number; pathTaken: ScorePath };
  try {
    const data = await runOnnxSession(ort, resolveRegressionModelPath(), tensorData);
    const value = Number(data[0] ?? 0.5);
    const normalized = normalizeRegressionOutput(value);
    regression = {
      rawScore: normalized.rawScore,
      aiRating: normalized.aiRating,
      pathTaken: 'onnx',
    };
  } catch (error) {
    console.warn(
      `[scoreImage] regression ONNX failed for webcam ${input.webcamId}, falling back:`,
      error,
    );
    const raw = baselineRaw(input);
    regression = {
      rawScore: raw,
      aiRating: ratingFromRaw(raw),
      pathTaken: 'baseline-fallback',
    };
  }

  // Binary head — optional. Don't fail the result if it errors.
  const binary = await scoreBinary(ort, input.webcamId, tensorData);

  return {
    ...regression,
    modelVersion,
    imageHash,
    source: input.source,
    binaryRawScore: binary?.rawScore,
    binaryIsSunset: binary?.isSunset,
    binaryModelVersion: binary?.modelVersion,
    binaryPathTaken: binary?.pathTaken,
  };
}
