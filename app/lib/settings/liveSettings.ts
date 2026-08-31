import 'server-only';
import {
  getKioskLiveSettingsCache,
  setKioskLiveSettingsCache,
} from '@/app/lib/cache';
import { getProfileSettings, type ProfileSettings } from '@/app/lib/settings/store';

// Redis-first read of the live settings profile. Falls back to Neon exactly
// once on a cache miss, then re-warms the Redis mirror so the next poll hits
// the cache. Returns null only if both the cache and the Neon read fail.
export async function getLiveSettingsCached(): Promise<ProfileSettings | null> {
  const cached = await getKioskLiveSettingsCache();
  if (cached) return cached;

  try {
    const fromStore = await getProfileSettings('live');
    await setKioskLiveSettingsCache(fromStore);
    return fromStore;
  } catch (error) {
    console.warn('[liveSettings] getLiveSettingsCached Neon fallback failed:', error);
    return null;
  }
}
