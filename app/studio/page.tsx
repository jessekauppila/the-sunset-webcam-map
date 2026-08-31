'use client';

import { Suspense } from 'react';
import { useIsOperator } from '@/app/components/auth/useIsOperator';
import { AuthControl } from '@/app/components/auth/AuthControl';
import { StudioClient } from './StudioClient';

/**
 * Client-side gate: not-operator renders a plain dark "sign in" page rather
 * than the studio chrome. Presentational only — the real authorization is
 * the server-side `requireOwner` check on every mutating route, same trust
 * model as the Ops tab.
 */
function StudioGate() {
  const { isOperator, loading } = useIsOperator();

  // Treat "loading" as not-yet-operator: render the dark shell (not the
  // studio chrome) until auth resolves, so an anonymous visitor never sees
  // /studio's controls flash before the sign-in gate kicks in.
  if (loading || !isOperator) {
    return (
      <div
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
            <p style={{ fontSize: 14 }}>Owner sign-in required.</p>
            <AuthControl />
          </>
        )}
      </div>
    );
  }

  return <StudioClient />;
}

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioGate />
    </Suspense>
  );
}
