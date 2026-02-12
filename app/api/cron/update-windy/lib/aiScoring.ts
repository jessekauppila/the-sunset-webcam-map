/**
 * AI scoring adapter for cron ingestion.
 *
 * This module intentionally keeps a stable contract so v1 can ship
 * observability and database plumbing first. The current implementation
 * uses a deterministic baseline score and can be replaced by ONNX
 * inference later without changing route/database integration code.
 */

import type { WindyWebcam } from '@/app/lib/types';
import path from 'node:path';

export type WebcamAiScore = {
  rawScore: number;
  aiRating: number;
  modelVersion: string;
};

const DEFAULT_MODEL_VERSION = 'baseline-v1';
const DEFAULT_ONNX_MODEL_PATH = 'ml/artifacts/models/model.onnx';
const DEFAULT_SCORING_MODE = 'baseline';
let cachedOrt: unknown | null = null;
let cachedSession: unknown | null = null;
let cachedModelPath: string | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildFeatureVector(webcam: WindyWebcam): number[] {
  const normalizedViews = clamp(
    Math.log10((webcam.viewCount ?? 0) + 1) / 6,
    0,
    1
  );
  const normalizedManual = clamp((webcam.rating ?? 3) / 5, 0, 1);
  const phaseBoost = webcam.phase === 'sunset' ? 0.04 : 0;
  return [normalizedViews, normalizedManual, phaseBoost];
}

function baselineScore(
  webcam: WindyWebcam,
  modelVersion: string
): WebcamAiScore {
  const [normalizedViews, normalizedManual, phaseBoost] =
    buildFeatureVector(webcam);

  const rawScore = clamp(
    normalizedViews * 0.65 + normalizedManual * 0.35 + phaseBoost,
    0,
    1
  );

  const aiRating = Number((rawScore * 5).toFixed(2));

  return {
    rawScore: Number(rawScore.toFixed(6)),
    aiRating,
    modelVersion,
  };
}

async function getOnnxRuntime(): Promise<unknown> {
  if (cachedOrt) return cachedOrt;
  const moduleName = 'onnxruntime-node';
  const runtime = await import(moduleName);
  cachedOrt = runtime;
  return runtime;
}

async function getSession(modelPath: string): Promise<unknown> {
  if (cachedSession && cachedModelPath === modelPath) return cachedSession;
  const runtime = (await getOnnxRuntime()) as {
    InferenceSession: { create: (p: string) => Promise<unknown> };
  };
  cachedSession = await runtime.InferenceSession.create(modelPath);
  cachedModelPath = modelPath;
  return cachedSession;
}

async function scoreWithOnnx(
  webcam: WindyWebcam,
  modelVersion: string
): Promise<WebcamAiScore> {
  const runtime = (await getOnnxRuntime()) as {
    Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  };
  const configuredPath =
    process.env.AI_ONNX_MODEL_PATH?.trim() || DEFAULT_ONNX_MODEL_PATH;
  const modelPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(process.cwd(), configuredPath);
  const session = (await getSession(modelPath)) as {
    inputNames: string[];
    outputNames: string[];
    run: (feeds: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];

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
  const value = Number(output?.data?.[0] ?? 0);

  const rawScore = clamp(value, 0, 1);
  const aiRating = Number((rawScore * 5).toFixed(2));
  return {
    rawScore: Number(rawScore.toFixed(6)),
    aiRating,
    modelVersion,
  };
}

/**
 * Generate AI score for a webcam preview record.
 * Uses baseline scoring by default and supports ONNX via AI_SCORING_MODE=onnx.
 */
export async function scoreWebcamPreview(
  webcam: WindyWebcam
): Promise<WebcamAiScore> {
  const modelVersion =
    process.env.AI_MODEL_VERSION?.trim() || DEFAULT_MODEL_VERSION;
  const mode = process.env.AI_SCORING_MODE?.trim() || DEFAULT_SCORING_MODE;

  if (mode !== 'onnx') {
    return baselineScore(webcam, modelVersion);
  }

  try {
    return await scoreWithOnnx(webcam, modelVersion);
  } catch (error) {
    console.warn(
      'ONNX scorer unavailable, falling back to baseline:',
      error
    );
    return baselineScore(webcam, modelVersion);
  }
}
