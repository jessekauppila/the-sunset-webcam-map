/**
 * Cron authentication module
 * Verifies that the request is authorized to run the cron job
 */

export function verifyCronAuth(req: Request): boolean {
  // Check if this is a Vercel cron request
  const authHeader = req.headers.get('authorization');
  const isVercelCron =
    authHeader === `Bearer ${process.env.CRON_SECRET}`;

  // Also check URL parameter as fallback
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  const isUrlSecret = secret === process.env.CRON_SECRET;

  console.log('🔍 Debug - Vercel cron header:', authHeader);
  console.log('🔍 Debug - Secret from URL:', secret);
  console.log(
    '🔍 Debug - CRON_SECRET env var:',
    process.env.CRON_SECRET
  );
  console.log('🔍 Debug - Is Vercel cron:', isVercelCron);
  console.log('🔍 Debug - Is URL secret valid:', isUrlSecret);

  return isVercelCron || isUrlSecret;
}

