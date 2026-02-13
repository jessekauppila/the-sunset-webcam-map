/**
 * AI scoring adapter for cron ingestion.
 *
 * Returns both binary and regression outputs so downstream code can:
 * - use binary score for capture gating
 * - use regression score for 1-5 UX display
 */

import type { WindyWebcam } from '@/app/lib/types';
import path from 'node:path';
import {
  AI_BINARY_MODEL_VERSION_DEFAULT,
  AI_MODEL_VERSION_DEFAULT,
  AI_ONNX_BINARY_MODEL_PATH_DEFAULT,
  AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT,
  AI_REGRESSION_MODEL_VERSION_DEFAULT,
  AI_SCORING_MODE_DEFAULT,
} from '@/app/lib/masterConfig';

type ModelTarget = 'binary' | 'regression';

export type ModelScore = {
  rawScore: number; // 0..1 normalized
  aiRating: number; // 0..5 normalized display rating
  modelVersion: string;
};

export type WebcamAiScore = ModelScore & {
  binary: ModelScore;
  regression: ModelScore;
};

// Process-level caches avoid reloading the runtime/session for each webcam.
let cachedOrt: unknown | null = null;
const cachedSessions = new Map<string, unknown>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ratingFromRaw(rawScore: number): number {
  return Number((rawScore * 5).toFixed(2));
}

function normalizeScore(
  value: number,
  target: ModelTarget
): { rawScore: number; aiRating: number } {
  if (target === 'binary') {
    const rawScore = clamp(value, 0, 1);
    return {
      rawScore: Number(rawScore.toFixed(6)),
      aiRating: ratingFromRaw(rawScore),
    };
  }

  // Regression model predicts rating-space values.
  const aiRating = clamp(value, 0, 5);
  const rawScore = clamp(aiRating / 5, 0, 1);
  return {
    rawScore: Number(rawScore.toFixed(6)),
    aiRating: Number(aiRating.toFixed(2)),
  };
}

function buildFeatureVector(webcam: WindyWebcam): number[] {
  // Current baseline relies on metadata-derived features.
  // ONNX v2 can replace this with richer image-derived features.
  const normalizedViews = clamp(
    Math.log10((webcam.viewCount ?? 0) + 1) / 6,
    0,
    1
  );
  const normalizedManual = clamp((webcam.rating ?? 3) / 5, 0, 1);
  const phaseBoost = webcam.phase === 'sunset' ? 0.04 : 0;
  return [normalizedViews, normalizedManual, phaseBoost];
}

function baselineModelScore(
  webcam: WindyWebcam,
  target: ModelTarget,
  modelVersion: string
): ModelScore {
  const [normalizedViews, normalizedManual, phaseBoost] =
    buildFeatureVector(webcam);

  const baseRaw = clamp(
    normalizedViews * 0.65 + normalizedManual * 0.35 + phaseBoost,
    0,
    1
  );

  // Keep baseline deterministic while allowing different score shapes.
  const rawForTarget =
    target === 'binary'
      ? baseRaw
      : clamp(baseRaw * 0.9 + normalizedManual * 0.1, 0, 1);

  return {
    rawScore: Number(rawForTarget.toFixed(6)),
    aiRating: ratingFromRaw(rawForTarget),
    modelVersion,
  };
}

function baselineScore(webcam: WindyWebcam): WebcamAiScore {
  const binaryModelVersion =
    process.env.AI_BINARY_MODEL_VERSION?.trim() ||
    process.env.AI_MODEL_VERSION?.trim() ||
    AI_MODEL_VERSION_DEFAULT ||
    AI_BINARY_MODEL_VERSION_DEFAULT;
  const regressionModelVersion =
    process.env.AI_REGRESSION_MODEL_VERSION?.trim() ||
    AI_REGRESSION_MODEL_VERSION_DEFAULT;

  const binary = baselineModelScore(webcam, 'binary', binaryModelVersion);
  const regression = baselineModelScore(
    webcam,
    'regression',
    regressionModelVersion
  );

  // Keep legacy top-level fields stable.
  return {
    rawScore: binary.rawScore,
    aiRating: regression.aiRating,
    modelVersion: regression.modelVersion,
    binary,
    regression,
  };
}

async function getOnnxRuntime(): Promise<unknown> {
  // Dynamic import keeps runtime optional in baseline mode.
  if (cachedOrt) return cachedOrt;
  const moduleName = 'onnxruntime-node';
  const runtime = await import(moduleName);
  cachedOrt = runtime;
  return runtime;
}

async function getSession(modelPath: string): Promise<unknown> {
  // Reuse session while model path is unchanged.
  const cached = cachedSessions.get(modelPath);
  if (cached) return cached;
  const runtime = (await getOnnxRuntime()) as {
    InferenceSession: { create: (p: string) => Promise<unknown> };
  };
  const session = await runtime.InferenceSession.create(modelPath);
  cachedSessions.set(modelPath, session);
  return session;
}

function resolveModelPath(
  configuredPath: string | undefined,
  defaultPath: string
): string {
  const modelRef = configuredPath?.trim() || defaultPath;
  return path.isAbsolute(modelRef)
    ? modelRef
    : path.join(process.cwd(), modelRef);
}

async function scoreSingleModelWithOnnx(
  webcam: WindyWebcam,
  target: ModelTarget,
  configuredPath: string | undefined,
  defaultPath: string,
  modelVersion: string
): Promise<ModelScore> {
  const runtime = (await getOnnxRuntime()) as {
    Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  };
  const modelPath = resolveModelPath(configuredPath, defaultPath);
  const session = (await getSession(modelPath)) as {
    inputNames: string[];
    outputNames: string[];
    run: (feeds: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

  // NOTE: This remains a compatibility bridge.
  // We currently feed compact feature vectors for cron-level webcam scoring.
  const features = buildFeatureVector(webcam);
  const tensor = new runtime.Tensor(
    'float32',
    Float32Array.from(features),
    [1, features.length]
  );
  const outputs = await session.run({ [inputName]: tensor });
  const output = outputs[outputName] as {
    data?: ArrayLike<number>;
  };
  const defaultValue = target === 'regression' ? 2.5 : 0;
  const value = Number(output?.data?.[0] ?? defaultValue);

  const normalized = normalizeScore(value, target);
  return {
    rawScore: normalized.rawScore,
    aiRating: normalized.aiRating,
    modelVersion,
  };
}

async function scoreWithOnnx(webcam: WindyWebcam): Promise<WebcamAiScore> {
  const binaryModelVersion =
    process.env.AI_BINARY_MODEL_VERSION?.trim() ||
    process.env.AI_MODEL_VERSION?.trim() ||
    AI_MODEL_VERSION_DEFAULT ||
    AI_BINARY_MODEL_VERSION_DEFAULT;
  const regressionModelVersion =
    process.env.AI_REGRESSION_MODEL_VERSION?.trim() ||
    AI_REGRESSION_MODEL_VERSION_DEFAULT;

  const binaryConfiguredPath =
    process.env.AI_ONNX_BINARY_MODEL_PATH?.trim() ||
    process.env.AI_ONNX_MODEL_PATH?.trim() ||
    AI_ONNX_BINARY_MODEL_PATH_DEFAULT;
  const regressionConfiguredPath =
    process.env.AI_ONNX_REGRESSION_MODEL_PATH?.trim() ||
    AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT;

  const [binary, regression] = await Promise.all([
    scoreSingleModelWithOnnx(
      webcam,
      'binary',
      binaryConfiguredPath,
      AI_ONNX_BINARY_MODEL_PATH_DEFAULT,
      binaryModelVersion
    ),
    scoreSingleModelWithOnnx(
      webcam,
      'regression',
      regressionConfiguredPath,
      AI_ONNX_REGRESSION_MODEL_PATH_DEFAULT,
      regressionModelVersion
    ),
  ]);

  // Keep legacy top-level fields stable.
  return {
    rawScore: binary.rawScore,
    aiRating: regression.aiRating,
    modelVersion: regression.modelVersion,
    binary,
    regression,
  };
}

/**
 * Generate AI scores for a webcam preview record.
 * Uses baseline scoring by default and supports ONNX via AI_SCORING_MODE=onnx.
 */
export async function scoreWebcamPreview(
  webcam: WindyWebcam
): Promise<WebcamAiScore> {
  const mode =
    process.env.AI_SCORING_MODE?.trim() || AI_SCORING_MODE_DEFAULT;

  if (mode !== 'onnx') {
    // Baseline mode is deterministic and dependency-light.
    return baselineScore(webcam);
  }

  try {
    return await scoreWithOnnx(webcam);
  } catch (error) {
    // Never break cron ingestion if ONNX loading/inference fails.
    console.warn(
      'ONNX scorer unavailable, falling back to baseline:',
      error
    );
    return baselineScore(webcam);
  }
}
