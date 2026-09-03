'use client';

import type { ReactNode } from 'react';
import { useIsOperator } from './useIsOperator';
import { AuthControl } from './AuthControl';

/**
 * One sign-in gate for every operator-only surface, so /studio and My Cameras
 * behave identically: the entry point is always visible, and arriving without
 * a session gets a sign-in prompt rather than a missing button.
 *
 * Hiding the entry point entirely was the old approach. It meant signing in
 * through the drawer BEFORE the thing you wanted to reach existed, which is
 * backwards for the only person who ever signs in.
 *
 * Presentational only. The real authorization is `requireOwner` on every
 * mutating route (app/lib/owner.ts).
 */
export function OwnerGate({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const { isOperator, loading } = useIsOperator();

  // Treat "loading" as not-yet-operator so operator controls never flash
  // before auth resolves, but show no prompt either — a prompt that appears
  // and vanishes reads as a bug.
  if (loading || !isOperator) {
    return (
      <div
        data-testid="owner-gate"
        style={{
          minHeight: '100vh',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: '#0b0e14',
          color: '#8b95a7',
        }}
      >
        {!loading && (
          <>
            <p style={{ fontSize: 14 }}>{label} requires owner sign-in.</p>
            <AuthControl />
          </>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
