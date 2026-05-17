import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/app/api/cron/update-cameras/lib/auth';
import { scoreImage } from '@/app/api/cron/update-cameras/lib/aiScoring';

export const dynamic = 'force-dynamic';

const TEST_IMAGE_PATH = path.join(
  process.cwd(),
  'app/api/debug/scoring-smoke/test-image.jpg'
);

export async function GET(req: Request): Promise<Response> {
  if (!verifyCronAuth(req)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const imageBytes = await readFile(TEST_IMAGE_PATH);
    const startedAt = Date.now();
    const result = await scoreImage({
      webcamId: 0,
      imageBytes,
      source: 'windy',
      lastImageHash: undefined,
    });
    const latencyMs = Date.now() - startedAt;

    return NextResponse.json({
      pathTaken: result.pathTaken,
      rawScore: result.rawScore,
      aiRating: result.aiRating,
      modelVersion: result.modelVersion,
      imageHash: result.imageHash,
      latencyMs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
