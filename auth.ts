import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { isAllowedOwnerEmail } from '@/app/lib/ownerEmails';

/**
 * Auth.js v5 — single allow-listed Google account, JWT sessions (no DB adapter).
 *
 * Sign-in is rejected unless the Google profile has a verified email AND that
 * email is in OWNER_EMAILS. This is the first of two defenses; every mutating
 * route also re-checks via `requireOwner` (see app/lib/owner.ts), because UI/
 * middleware gating is bypassable and the route handler is the real boundary.
 *
 * Env: AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET (auto-detected by the
 * Google provider), OWNER_EMAILS. On Vercel, AUTH_TRUST_HOST/AUTH_URL are
 * inferred and not needed.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 }, // 8h — JWT can't be server-revoked, so keep it modest
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return false;
      const emailVerified =
        (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
      return emailVerified && isAllowedOwnerEmail(profile?.email);
    },
  },
});
