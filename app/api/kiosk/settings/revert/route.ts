import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { copyProfile } from '@/app/lib/settings/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const denied = await requireOwner();
  if (denied) return denied;
  const studio = await copyProfile('live', 'studio');
  return NextResponse.json({ studio });
}
