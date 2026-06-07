/**
 * One-time standalone backfill of v4 model scores over the Flickr set
 * (external_images, plan U6). Runs the SAME engine the recompute/cron would use
 * (backfillExternalImageScores) but unbounded and with full ONNX.
 *
 * The Claude judge already exists in external_images.llm_* (the v4 training
 * labels); this fills only the model columns + the model-vs-Claude disagreement.
 * No Anthropic spend.
 *
 * Prerequisites (operational — set before running):
 *   AI_ONNX_REGRESSION_MODEL_PATH=...         (real v4 regression artifact)
 *   AI_ONNX_BINARY_MODEL_PATH=... + AI_BINARY_SCORING_ENABLED=true  (optional; persists the binary judge too)
 *   DATABASE_URL=...                          (point at a SCOPED backfill credential with
 *                                              INSERT/UPDATE on external_images only — not
 *                                              the app's full-privilege role)
 *   BACKFILL_PAGE_SIZE=100                    (optional; rows per batch)
 *
 * Run (no global install needed):
 *   npx tsx scripts/backfill-flickr-scores.ts --dry-run   # just count
 *   npx tsx scripts/backfill-flickr-scores.ts             # drain
 *
 * Safety: aborts immediately (exit 2) if scoreImage leaves the real ONNX path
 * ('unscored') — never writes fabricated scores (post-#45 there is no metadata
 * fallback, so the ONNX-or-nothing gate is the only protection; there is no
 * AI_SCORING_MODE to set).
 */
import { countExternalImagesNeedingScore } from '@/app/api/cron/update-cameras/lib/dbOperations';
import { backfillExternalImageScores } from '@/app/api/cron/update-cameras/lib/externalBackfill';

const PAGE = Number(process.env.BACKFILL_PAGE_SIZE ?? '100');

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run');

  const total = await countExternalImagesNeedingScore();
  console.log(`[flickr-backfill] ${total} Flickr images need a real model score`);
  if (dryRun) {
    console.log('[flickr-backfill] --dry-run: counted only, no writes. Exiting.');
    return 0;
  }
  if (total === 0) return 0;

  let scored = 0;
  let dead = 0;
  let failed = 0;

  for (;;) {
    const r = await backfillExternalImageScores({ limit: PAGE });

    if (r.abortedOnFallback) {
      console.error(
        `[flickr-backfill] ABORTED: scoreImage left the ONNX path (fallbacks=${r.fallbacks}). ` +
          'Model not loading — check the ONNX model paths. No junk written.',
      );
      return 2;
    }

    scored += r.scored;
    dead += r.deadUrls;
    failed += r.failed;
    const did = r.scored + r.deadUrls + r.failed;
    console.log(
      `[flickr-backfill] +${r.scored} scored, +${r.deadUrls} dead-url, +${r.failed} failed — ${scored}/${total} done`,
    );

    if (did === 0) break; // finder returned nothing — drained
    if (r.scored === 0 && r.deadUrls === 0 && r.failed > 0) {
      // A whole page of only transient failures (e.g. rejected hosts or network
      // blips): stop rather than spin. Rows stay scoreable; re-run to retry.
      console.warn('[flickr-backfill] page was all transient failures — stopping. Re-run to retry.');
      break;
    }
  }

  console.log(`[flickr-backfill] done. scored=${scored} dead-url=${dead} failed=${failed}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[flickr-backfill] fatal:', err);
    process.exit(1);
  });
