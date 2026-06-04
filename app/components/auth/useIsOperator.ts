'use client';

import { useSession } from 'next-auth/react';

/**
 * Whether the current viewer is the operator (Jesse).
 *
 * A valid session is equivalent to "is the owner": the Auth.js `signIn`
 * callback rejects every account except the OWNER_EMAILS allow-list, so any
 * authenticated session can only belong to the owner. This is a UI convenience
 * — the real authorization is the server-side `requireOwner` check on every
 * mutating route (app/lib/owner.ts).
 *
 * `loading` is true while the session resolves; treat it as not-operator so we
 * never flash operator controls before auth is known.
 */
export function useIsOperator(): { isOperator: boolean; loading: boolean } {
  const { status } = useSession();
  return {
    isOperator: status === 'authenticated',
    loading: status === 'loading',
  };
}
