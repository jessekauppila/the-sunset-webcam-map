// Proves the hard-example rater is recording, straight from the database —
// no UI state involved. Answers three questions the on-glass counters can't:
// are rows landing, does the "left to rate" bar match the table, and are the
// labels going onto frames that are actually in the disagreement queue.
// Run from the repo root (needs DATABASE_URL in .env.local):
//   node scripts/label-audit.mjs
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

// Frames captured after this date were not in v4's training set — the split the
// rater's Archive·trained / Archive·new buckets are drawn along.
const V4_TRAINING_CUTOFF = '2026-05-13';

const url = readFileSync('.env.local', 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1];
if (!url) throw new Error('DATABASE_URL not found in .env.local — run from the repo root');
const sql = neon(url);

const [recorded] = await sql`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE labeled_at > now() - interval '1 hour')::int AS last_hour,
         count(*) FILTER (WHERE labeled_at > now() - interval '24 hours')::int AS last_24h,
         max(labeled_at) AS most_recent
  FROM manual_labels`;

const bySource = await sql`
  SELECT source, count(*)::int AS n,
         count(*) FILTER (WHERE is_sunset)::int AS sunset,
         count(*) FILTER (WHERE NOT is_sunset)::int AS not_sunset
  FROM manual_labels GROUP BY source ORDER BY source`;

const histogram = await sql`
  SELECT COALESCE(rating::text, 'N (not a sunset)') AS rating, count(*)::int AS n
  FROM manual_labels GROUP BY 1 ORDER BY 1`;

// The same query the queue's bottom bar renders, run independently of it.
const [remaining] = await sql`
  SELECT count(*) FILTER (WHERE src = 'flickr')::int AS flickr,
         count(*) FILTER (WHERE src = 'webcam' AND cap <= ${V4_TRAINING_CUTOFF}::timestamptz)::int AS archive_trained,
         count(*) FILTER (WHERE src = 'webcam' AND cap >  ${V4_TRAINING_CUTOFF}::timestamptz)::int AS archive_new,
         count(*)::int AS total
  FROM (
    SELECT 'flickr' AS src, e.scraped_at AS cap FROM external_images e
    WHERE e.source = 'flickr' AND e.model_disagreement_kind IS NOT NULL
      AND e.id NOT IN (SELECT image_id FROM manual_labels WHERE source = 'flickr')
    UNION ALL
    SELECT 'webcam', s.captured_at FROM webcam_snapshots s
    WHERE s.model_disagreement_kind IS NOT NULL
      AND s.id NOT IN (SELECT image_id FROM manual_labels WHERE source = 'webcam')
  ) q`;

const [flagged] = await sql`
  SELECT (SELECT count(*) FROM external_images WHERE source = 'flickr' AND model_disagreement_kind IS NOT NULL)::int AS flickr,
         (SELECT count(*) FROM webcam_snapshots WHERE model_disagreement_kind IS NOT NULL)::int AS webcam`;

// A label on a frame with no disagreement flag came from browse mode (the
// disagreements toggle off) or from a frame re-scored since it was rated. Not
// wrong — just not part of the hard-example queue the bar is counting down.
const [placement] = await sql`
  SELECT count(*) FILTER (WHERE m.source = 'webcam' AND s.model_disagreement_kind IS NOT NULL)::int AS webcam_flagged,
         count(*) FILTER (WHERE m.source = 'webcam' AND s.model_disagreement_kind IS NULL)::int AS webcam_unflagged,
         count(*) FILTER (WHERE m.source = 'flickr' AND e.model_disagreement_kind IS NOT NULL)::int AS flickr_flagged,
         count(*) FILTER (WHERE m.source = 'flickr' AND e.model_disagreement_kind IS NULL)::int AS flickr_unflagged
  FROM manual_labels m
  LEFT JOIN webcam_snapshots s ON m.source = 'webcam' AND s.id = m.image_id
  LEFT JOIN external_images e  ON m.source = 'flickr' AND e.id = m.image_id`;

console.log(`\nlabels on record   ${recorded.total}`);
console.log(`  last hour        ${recorded.last_hour}`);
console.log(`  last 24h         ${recorded.last_24h}`);
console.log(`  most recent      ${recorded.most_recent ?? '—'}`);

console.log('\nby source');
console.table(bySource);
console.log('rating histogram');
console.table(histogram);

console.log('\nleft to rate (what the queue bar shows)');
console.table([remaining]);

// flagged = still in the queue + already labeled. If these don't reconcile the
// bar is lying, so check it rather than trusting the number on screen.
const checks = [
  { queue: 'webcam', flagged: flagged.webcam, remaining: remaining.archive_trained + remaining.archive_new, labeled: placement.webcam_flagged },
  { queue: 'flickr', flagged: flagged.flickr, remaining: remaining.flickr, labeled: placement.flickr_flagged },
].map((c) => ({ ...c, reconciles: c.remaining + c.labeled === c.flagged ? 'yes' : 'NO' }));
console.log('\nreconciliation — remaining + labeled should equal flagged');
console.table(checks);

if (placement.webcam_unflagged || placement.flickr_unflagged) {
  console.log(
    `\nnote: ${placement.webcam_unflagged} webcam + ${placement.flickr_unflagged} flickr labels sit on frames with no ` +
      `disagreement flag (browse mode, or re-scored since). They are stored and usable, but the queue bar never counted them.`,
  );
}
if (checks.some((c) => c.reconciles === 'NO')) {
  console.log('\nWARNING: a queue does not reconcile — the on-glass count is not trustworthy.');
  process.exitCode = 1;
}
