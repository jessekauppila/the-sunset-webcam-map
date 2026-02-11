/**
 * Debug endpoint for AI rating visibility.
 *
 * Returns recent webcam-level AI fields and snapshot inference history
 * to validate cron scoring behavior without direct DB access.
 */

import { NextResponse } from 'next/server';
import { sql } from '@/app/lib/db';

export const dynamic = 'force-dynamic';

function isAuthorized(req: Request): boolean {
  const authHeader = req.headers.get('authorization');
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  const expected = process.env.CRON_SECRET;

  if (!expected) return false;
  return (
    authHeader === `Bearer ${expected}` || secret === expected
  );
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const requestedLimit = Number(searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(200, requestedLimit))
    : 50;

  const webcams = (await sql`
    select
      id,
      title,
      ai_rating,
      ai_model_version,
      updated_at
    from webcams
    where ai_rating is not null
    order by updated_at desc
    limit ${limit}
  `) as Array<{
    id: number;
    title: string | null;
    ai_rating: number | null;
    ai_model_version: string | null;
    updated_at: string;
  }>;

  const inferences = (await sql`
    select
      i.snapshot_id,
      i.model_version,
      i.raw_score,
      i.ai_rating,
      i.scored_at
    from snapshot_ai_inferences i
    order by i.scored_at desc
    limit ${limit}
  `) as Array<{
    snapshot_id: number;
    model_version: string;
    raw_score: number;
    ai_rating: number;
    scored_at: string;
  }>;

  return NextResponse.json({
    limit,
    webcams,
    snapshotAiInferences: inferences,
  });
}
