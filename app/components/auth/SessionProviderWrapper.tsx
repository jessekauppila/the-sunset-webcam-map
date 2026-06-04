'use client';

import { SessionProvider } from 'next-auth/react';

/**
 * Client wrapper so the server `app/layout.tsx` (which exports `metadata` and
 * must stay a server component) can still provide the Auth.js session context
 * to the client tree below it.
 */
export default function SessionProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SessionProvider>{children}</SessionProvider>;
}
