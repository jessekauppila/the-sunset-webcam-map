import { NextResponse } from 'next/server';
import { verifyCronAuth } from '../update-cameras/lib/auth';
import { recomputeDisagreements } from '../update-cameras/lib/recomputeDisagreements';
import { DISAGREEMENT_RECOMPUTE_LIMIT } from '@/app/lib/masterConfig';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Disagreement recompute (plan U3b). Re-derives model_disagreement_kind for
// frames whose Claude score landed after the model backfill — the path that
// surfaces the originally-Claude-absent hard examples. Pure SQL recompute (no
// image download, no ONNX), so it does NOT need the ml/artifacts bundle and
// runs on its own schedule, isolated from the live-scoring tick budget so live
// scoring can't starve it.

async function handle(request: Request) {
  if (!verifyCronAuth(request) && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await recomputeDisagreements({
      limit: DISAGREEMENT_RECOMPUTE_LIMIT,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[recompute-disagreements] failed:', error);
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
