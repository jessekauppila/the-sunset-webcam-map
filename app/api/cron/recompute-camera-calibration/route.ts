import { NextResponse } from 'next/server';
import { verifyCronAuth } from '../update-cameras/lib/auth';
import { recomputeCameraCalibration } from '../update-cameras/lib/recomputeCameraCalibration';
import { resolveBinaryModelVersion } from '../update-cameras/lib/aiScoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Per-camera calibration recompute.
// Spec: docs/superpowers/specs/2026-08-31-per-camera-calibration-design.md
//
// Derives a bounded per-camera tempering multiplier from accumulated error
// evidence and writes it to the webcams row. Pure SQL recompute (no image
// download, no ONNX), so it does NOT need the ml/artifacts bundle and runs on
// its own nightly schedule, isolated from the live-scoring tick budget.
//
// It NEVER touches the detection verdict — only the tile/quality signal.

async function handle(request: Request) {
  if (!verifyCronAuth(request) && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await recomputeCameraCalibration({
      // The EFFECTIVE version, not the default constant — env can override it,
      // and the evidence rows are scoped by the version actually in use.
      modelVersion: resolveBinaryModelVersion(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[recompute-camera-calibration] failed:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
