/**
 * Owner allow-list parsing — the single source of truth for who counts as the
 * operator. Pure (no `server-only`, no `next/server`) so it can be imported by
 * both the Auth.js config (`auth.ts`, runs in middleware/edge too) and the
 * server-side `requireOwner` guard.
 *
 * `OWNER_EMAILS` is a comma-separated list of allowed Google account emails.
 */
export function ownerEmails(): string[] {
  return (process.env.OWNER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ownerEmails().includes(email.toLowerCase());
}
