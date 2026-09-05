import { NextResponse } from 'next/server';
import { requireOwner } from '@/app/lib/owner';
import { listDeploys } from '@/app/lib/settings/deploys';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Every recorded Deploy, newest first (spec §2.3). */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  return NextResponse.json({ deploys: await listDeploys() });
}
