import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { copyProfile } from '@/app/lib/settings/store';
import { recordDeploy } from '@/app/lib/settings/deploys';
import { setKioskLiveSettingsCache } from '@/app/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LABEL_MAX = 60;

/** Optional `{ label }`. No body, or a malformed one, is a deploy with no label. */
async function labelOf(request?: Request): Promise<string | null> {
  if (!request) return null;
  try {
    const body = (await request.json()) as { label?: unknown };
    return typeof body?.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, LABEL_MAX)
      : null;
  } catch {
    return null;
  }
}

export async function POST(request?: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const label = await labelOf(request);
  const live = await copyProfile('studio', 'live');
  await setKioskLiveSettingsCache(live);
  // History is bookkeeping: it must not fail the deploy, and `null` is how
  // the studio learns it was not written instead of assuming it was.
  const deploy = await recordDeploy(live, label);
  return NextResponse.json({ live, deploy });
}
