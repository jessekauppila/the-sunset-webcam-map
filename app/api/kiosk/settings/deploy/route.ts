import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { copyProfile } from '@/app/lib/settings/store';
import { setKioskLiveSettingsCache } from '@/app/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const denied = await requireOwner();
  if (denied) return denied;
  const live = await copyProfile('studio', 'live');
  await setKioskLiveSettingsCache(live);
  return NextResponse.json({ live });
}
