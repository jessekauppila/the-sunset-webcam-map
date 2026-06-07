/**
 * One-time standalone backfill of v4 model scores over the webcam archive
 * (plan U3 / KTD9). Runs the SAME engine the cron uses
 * (backfillArchiveSnapshotScores) but unbounded and with full ONNX — the cron
 * path is too slow for the ~33k drain and risks the Vercel bundle/time limits.
 *
 * Prerequisites (operational — set before running):
 *   AI_SCORING_MODE=onnx                      (required; the script refuses otherwise)
 *   AI_ONNX_REGRESSION_MODEL_PATH=...         (real v4 regression artifact)
 *   AI_ONNX_BINARY_MODEL_PATH=... + AI_BINARY_SCORING_ENABLED=true  (optional; persists the binary judge too)
 *   DATABASE_URL=...                          (point at a SCOPED backfill credential with
 *                                              INSERT/UPDATE on webcam_snapshots only — not
 *                                              the app's full-privilege role)
 *   BACKFILL_PAGE_SIZE=100                    (optional; rows per batch)
 *
 * Run (no global install needed):
 *   npx tsx scripts/backfill-archive-scores.ts --dry-run   # just count
 *   npx tsx scripts/backfill-archive-scores.ts             # drain
 *
 * Safety: aborts immediately (exit 2) if scoreImage falls off the real ONNX
 * path — never writes baseline junk across the archive (silent-ML-fallback).
 */
import { countArchiveSnapshotsNeedingScore } from '@/app/api/cron/update-cameras/lib/dbOperations';
import { backfillArchiveSnapshotScores } from '@/app/api/cron/update-cameras/lib/archiveBackfill';

const PAGE = Number(process.env.BACKFILL_PAGE_SIZE ?? '100');

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run');

  if ((process.env.AI_SCORING_MODE ?? '').trim() !== 'onnx') {
    console.error(
      `[backfill] refusing to run: AI_SCORING_MODE must be "onnx" (got "${process.env.AI_SCORING_MODE ?? ''}"). ` +
        'Running in baseline mode would write fake scores across the archive.',
    );
    return 1;
  }

  const total = await countArchiveSnapshotsNeedingScore({ includeAllSources: true });
  console.log(`[backfill] ${total} snapshots need a real model score`);
  if (dryRun) {
    console.log('[backfill] --dry-run: counted only, no writes. Exiting.');
    return 0;
  }
  if (total === 0) return 0;

  let scored = 0;
  let dead = 0;
  let failed = 0;

  for (;;) {
    const r = await backfillArchiveSnapshotScores({
      limit: PAGE,
      includeAllSources: true,
    });

    if (r.abortedOnFallback) {
      console.error(
        `[backfill] ABORTED: scoreImage left the ONNX path (fallbacks=${r.fallbacks}). ` +
          'Model not loading — check AI_SCORING_MODE + model paths. No junk written.',
      );
      return 2;
    }

    scored += r.scored;
    dead += r.deadUrls;
    failed += r.failed;
    const did = r.scored + r.deadUrls + r.failed;
    console.log(
      `[backfill] +${r.scored} scored, +${r.deadUrls} dead-url, +${r.failed} failed — ${scored}/${total} done`,
    );

    if (did === 0) break; // finder returned nothing — drained
    if (r.scored === 0 && r.deadUrls === 0 && r.failed > 0) {
      // A whole page of only transient failures: stop rather than spin. The
      // rows stay scoreable (not dead-url'd); re-run later to retry them.
      console.warn('[backfill] page was all transient failures — stopping. Re-run to retry.');
      break;
    }
  }

  console.log(`[backfill] done. scored=${scored} dead-url=${dead} failed=${failed}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
  });
