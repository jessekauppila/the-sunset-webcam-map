import { NextResponse } from 'next/server';
import { acquireKioskTickLock } from '@/app/lib/cache';
import { GET as runCronTick } from '@/app/api/cron/update-cameras/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Presence-driven scoring: gallery kiosk screens POST here every minute while
// visible. Unauthenticated by design (the kiosk page is public and cannot hold
// a secret) — the Redis NX lock caps the worst case at ~1 tick/minute
// globally, i.e. gallery-mode cost. The */15 cron remains the baseline.
export async function POST() {
  const acquired = await acquireKioskTickLock();
  if (!acquired) {
    return NextResponse.json({ throttled: true }, { status: 202 });
  }
  try {
    // Re-invoke the cron handler in-process with internal auth. This keeps
    // one source of truth for what "a tick" is (see spec Part B).
    const req = new Request('http://kiosk.internal/api/cron/update-cameras', {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
    });
    const tickRes = await runCronTick(req);
    const tick = await tickRes.json();
    return NextResponse.json({ ok: true, tick }, { status: tickRes.status });
  } catch (error) {
    console.error('[kiosk/tick] failed:', error);
    return NextResponse.json({ error: 'tick failed' }, { status: 500 });
  }
}
