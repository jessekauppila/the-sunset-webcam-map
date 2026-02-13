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

function inferModelKind(modelVersion: string): 'binary' | 'regression' | 'other' {
  const value = modelVersion.toLowerCase();
  if (value.includes('binary')) return 'binary';
  if (value.includes('regression')) return 'regression';
  return 'other';
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
      ai_rating_binary,
      ai_model_version_binary,
      ai_rating_regression,
      ai_model_version_regression,
      updated_at
    from webcams
    where ai_rating is not null
       or ai_rating_binary is not null
       or ai_rating_regression is not null
    order by updated_at desc
    limit ${limit}
  `) as Array<{
    id: number;
    title: string | null;
    ai_rating: number | null;
    ai_model_version: string | null;
    ai_rating_binary: number | null;
    ai_model_version_binary: string | null;
    ai_rating_regression: number | null;
    ai_model_version_regression: string | null;
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

  const formattedWebcams = webcams.map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: row.updated_at,
    ai: {
      binary: {
        rating: row.ai_rating_binary,
        modelVersion: row.ai_model_version_binary,
      },
      regression: {
        rating: row.ai_rating_regression,
        modelVersion: row.ai_model_version_regression,
      },
      legacy: {
        rating: row.ai_rating,
        modelVersion: row.ai_model_version,
      },
    },
  }));

  const groupedBySnapshot = new Map<
    number,
    {
      snapshotId: number;
      latestScoredAt: string;
      ai: {
        binary: {
          modelVersion: string;
          rawScore: number;
          rating: number;
          scoredAt: string;
        } | null;
        regression: {
          modelVersion: string;
          rawScore: number;
          rating: number;
          scoredAt: string;
        } | null;
        other: Array<{
          modelVersion: string;
          rawScore: number;
          rating: number;
          scoredAt: string;
        }>;
      };
    }
  >();

  for (const row of inferences) {
    const existing = groupedBySnapshot.get(row.snapshot_id) ?? {
      snapshotId: row.snapshot_id,
      latestScoredAt: row.scored_at,
      ai: {
        binary: null,
        regression: null,
        other: [],
      },
    };

    const entry = {
      modelVersion: row.model_version,
      rawScore: row.raw_score,
      rating: row.ai_rating,
      scoredAt: row.scored_at,
    };

    const kind = inferModelKind(row.model_version);
    if (kind === 'binary') {
      existing.ai.binary = entry;
    } else if (kind === 'regression') {
      existing.ai.regression = entry;
    } else {
      existing.ai.other.push(entry);
    }

    if (row.scored_at > existing.latestScoredAt) {
      existing.latestScoredAt = row.scored_at;
    }

    groupedBySnapshot.set(row.snapshot_id, existing);
  }

  const groupedSnapshotAiInferences = Array.from(
    groupedBySnapshot.values()
  ).sort((a, b) => b.latestScoredAt.localeCompare(a.latestScoredAt));

  return NextResponse.json({
    limit,
    webcams: formattedWebcams,
    snapshotAiInferences: groupedSnapshotAiInferences,
  });
}
