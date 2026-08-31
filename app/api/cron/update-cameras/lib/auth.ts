/**
 * Cron authentication module
 * Verifies that the request is authorized to run the cron job
 */

export function verifyCronAuth(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Without a configured secret there is nothing to authenticate against, so
  // fail closed. Comparing directly against `Bearer ${process.env.CRON_SECRET}`
  // would collapse to the literal "Bearer undefined" and authorize anyone who
  // sends it.
  if (!expected) return false;

  // Vercel Cron sends the secret as a bearer token.
  const isVercelCron = req.headers.get('authorization') === `Bearer ${expected}`;

  // Also check URL parameter as fallback.
  const { searchParams } = new URL(req.url);
  const isUrlSecret = searchParams.get('secret') === expected;

  // Deliberately no logging here: this runs on every cron tick and every kiosk
  // tick, and both the raw env var and the `Bearer <secret>` header would land
  // in Vercel's runtime logs. See auth.test.ts.
  return isVercelCron || isUrlSecret;
}

