import 'server-only';
import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from '@/auth';
import { isAllowedOwnerEmail } from '@/app/lib/ownerEmails';

/**
 * The single authority for "who may write."
 *
 * `isOwner` is the pure session check; `requireOwner` is the route-handler guard
 * — call it at the top of every mutating handler and return its result early
 * when non-null. Hiding UI is cosmetic; this server-side check is the real gate.
 *
 * Flat by design: one operator role today. If trusted raters are added later,
 * add a peer `requireRater` — do not grow this into a capability/role system.
 */
export function isOwner(session: Session | null): boolean {
  return isAllowedOwnerEmail(session?.user?.email);
}

/**
 * Returns a 401/403 NextResponse to return early, or null when the caller is the
 * allow-listed owner. 401 = no session, 403 = signed in but not the owner. We do
 * not 404-mask: the resources are public on the read side, so hiding existence
 * buys nothing and only confuses clients.
 */
export async function requireOwner(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isOwner(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}
