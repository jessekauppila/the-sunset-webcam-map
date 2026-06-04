---
title: Every-minute cron drove Neon compute and Upstash command costs
date: 2026-06-04
category: docs/solutions/performance-issues
module: update-cameras cron
problem_type: performance_issue
component: database
symptoms:
  - "Upstash email: sunrise-sunset-cache reached its 500,000 monthly command quota"
  - "Neon billed ~$60 for the dev project in a month"
  - "Recurring — the same overage had happened before"
root_cause: config_error
resolution_type: code_fix
severity: high
tags: [neon, upstash, redis, cron, cost, autosuspend, caching, scaling]
---

# Every-minute cron drove Neon compute and Upstash command costs

## Problem
The `update-cameras` cron ran on `*/1 * * * *` (every minute, 24/7). That single
cadence quietly drove two separate bills: it kept Neon's compute from ever
autosuspending (~$60/mo always-on), and it issued Redis commands proportional to
webcam count every minute, blowing Upstash's 500k/mo free quota in days.

## Symptoms
- Upstash "free tier limit reached" email: `sunrise-sunset-cache` hit 500,000 monthly commands.
- Neon charged ~$60 for the month on a dev-stage project.
- Recurring — not a one-off spike.

## What Didn't Work
- Treating it as an Upstash-only problem (suspecting "Redis usage was the problem"):
  the Redis quota was a *symptom*. The shared driver of both bills was the cron
  cadence. Throttling Redis alone would have left the Neon compute charge untouched.

## Solution
Two changes, on branch `feat/reduce-db-cost`:

**1. Cron cadence `*/1` → `*/15`** (`vercel.json`). 15× fewer runs across the board,
and 15-minute gaps exceed Neon's autosuspend window so the DB actually sleeps
between ticks.

**2. Moved the per-camera image-hash dedup out of Redis into a Neon column** so
Redis stops scaling with webcam count. The hash is used to skip re-scoring an
unchanged frame.

- Migration `20260603_webcam_last_image_hash.sql`: `ALTER TABLE webcams ADD COLUMN IF NOT EXISTS last_image_hash TEXT`.
- Read: one batched `getWebcamImageHashMap(ids)` query per tick replaces N per-webcam Redis `GET`s.
- Write: folded into the `updateWebcamAiFields` UPDATE that already ran per webcam — zero extra writes:

```sql
update webcams
set ai_rating = ${item.aiRating},
    ...
    last_image_hash = coalesce(${item.lastImageHash ?? null}, last_image_hash),
    updated_at = now()
where id = ${item.webcamId}
```

- Deleted `getCameraImageHash` / `setCameraImageHash` from `app/lib/cache.ts`. Redis
  now holds only the terminator-payload cache (~2 commands/tick + visitor reads),
  independent of cadence and webcam count.

**Deploy ordering matters:** the new code's SELECT/UPDATE reference `last_image_hash`,
so apply the migration to Neon *before* deploying the code, or every per-webcam
UPDATE throws (caught → counts as a scoring fallback → no scores written).

## Why This Works
- **Neon bills on compute-hours (active time), not query count.** With autosuspend,
  an idle DB stops billing. A 1-minute cron (plus 60s client SWR polls) kept it
  awake 24/7 ≈ 730 compute-hours/month. Widening the cadence past the autosuspend
  window is what lets it sleep — the per-tick query count was never the lever.
- **Upstash bills per command.** The old `getCameraImageHash` + `setCameraImageHash`
  pair ran ~2 commands *per webcam per tick*, so commands = webcams × cadence. At
  ~100 webcams × 1,440 ticks/day that's ~6.5M/month (13× the 500k quota). Moving the
  hash to a Neon column removes Redis from the per-webcam loop entirely, so the quota
  no longer scales with either factor.
- The commit-atomicity invariant is preserved: the hash now commits in the same
  UPDATE as the score, so a failed write leaves the row un-hashed and it re-scores
  next tick (the same guarantee the old "Neon write before Redis hash write" ordering
  provided).

## Prevention
- **Audit cron cadence against autosuspend.** Any scheduled job that hits an
  autosuspending DB more often than its suspend window pins it always-on. Match the
  cadence to how fast the underlying data actually changes (the terminator moves
  ~0.25°/min — 15-minute discovery is plenty).
- **Keep per-item work off metered per-command stores.** A cache GET/SET inside a
  per-row loop makes the bill scale with row count × frequency. Prefer one batched
  read and fold writes into an UPDATE the row already takes. Reserve Redis for
  whole-payload caches whose command count is O(ticks), not O(rows).
- **Decouple "feels live" from DB cost.** The visual terminator already moves
  client-side every 60s via `suncalc` (`useSunsetPosition`); the cron only controls
  how often *webcam data* refreshes. A faster cron now trades only against Neon
  compute (watchable), not the Upstash quota.
- Regression coverage: `dbOperations.test.ts` (hash map + `last_image_hash` write)
  and `route.test.ts` (reads prior hash from Neon, writes via AI-fields UPDATE, no
  Redis hash calls).

## Related Issues
- Migration: `database/migrations/20260603_webcam_last_image_hash.sql`
- Touched: `vercel.json`, `app/api/cron/update-cameras/route.ts`,
  `app/api/cron/update-cameras/lib/dbOperations.ts`, `app/lib/cache.ts`
