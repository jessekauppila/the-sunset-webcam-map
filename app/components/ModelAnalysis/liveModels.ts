import {
  AI_BINARY_MODEL_VERSION_DEFAULT,
  AI_REGRESSION_MODEL_VERSION_DEFAULT,
} from '@/app/lib/masterConfig';

/**
 * Which production role (if any) a leaderboard run currently fills.
 *
 * Deployed version strings are `<YYYYMMDD>_<HHMMSS>_<run_name>` and
 * leaderboard slugs are the run name, so matching against the masterConfig
 * pins makes the LIVE badge structurally unable to drift from what prod
 * actually runs — the same swap that redeploys a model moves the badge.
 */
export function liveRole(slug: string): 'detection' | 'quality' | null {
  if (AI_BINARY_MODEL_VERSION_DEFAULT.endsWith(`_${slug}`)) return 'detection';
  if (AI_REGRESSION_MODEL_VERSION_DEFAULT.endsWith(`_${slug}`)) return 'quality';
  return null;
}
