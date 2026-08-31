import { Redis } from '@upstash/redis';
import { KIOSK_TICK_LOCK_TTL_MS } from '@/app/lib/masterConfig';
import type { ProfileSettings } from '@/app/lib/settings/store';

const TERMINATOR_KEY = 'terminator:current';
const TERMINATOR_TTL_SECONDS = 300;
const KIOSK_TICK_LOCK_KEY = 'kiosk:tick:lock';
const KIOSK_DOZE_KEY = 'kiosk:doze';
const KIOSK_LIVE_SETTINGS_KEY = 'kiosk:liveSettings';
const KIOSK_LAST_POLL_KEY = 'kiosk:lastPoll';

let client: Redis | null = null;

function getClient(): Redis | null {
  if (process.env.USE_KV_CACHE === 'false') return null;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  if (!client) {
    client = Redis.fromEnv();
  }
  return client;
}

export async function getCachedTerminatorPayload<T = unknown>(): Promise<T | null> {
  const c = getClient();
  if (!c) return null;
  try {
    return (await c.get<T>(TERMINATOR_KEY)) ?? null;
  } catch (error) {
    console.error('Cache read failed:', error);
    return null;
  }
}

export async function setCachedTerminatorPayload(payload: unknown): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(TERMINATOR_KEY, payload, { ex: TERMINATOR_TTL_SECONDS });
  } catch (error) {
    console.error('Cache write failed:', error);
  }
}

/**
 * Drop the cached terminator payload. Call after writes that need to be
 * visible to the next mosaic fetch — e.g. a custom-camera snapshot insert
 * whose firebase_url has to surface in the popup without waiting for the
 * 300s TTL to expire.
 */
export async function invalidateTerminatorPayload(): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.del(TERMINATOR_KEY);
  } catch (error) {
    console.error('Cache invalidate failed:', error);
  }
}

// True iff this caller won the right to run a scoring tick this minute.
// Fail-closed: no Redis -> no kiosk ticks (the */15 cron remains the floor).
export async function acquireKioskTickLock(): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    const result = await c.set(KIOSK_TICK_LOCK_KEY, '1', {
      nx: true,
      px: KIOSK_TICK_LOCK_TTL_MS,
    });
    return result === 'OK';
  } catch (error) {
    console.warn('[cache] acquireKioskTickLock failed:', error);
    return false;
  }
}

// The cron stamps the lock unconditionally so a kiosk poll right after a cron
// tick is a no-op.
export async function markKioskTickRan(): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(KIOSK_TICK_LOCK_KEY, '1', { px: KIOSK_TICK_LOCK_TTL_MS });
  } catch (error) {
    console.warn('[cache] markKioskTickRan failed:', error);
  }
}

export async function getKioskDoze(): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    return Boolean(await c.get(KIOSK_DOZE_KEY));
  } catch (error) {
    console.warn('[cache] getKioskDoze failed:', error);
    return false;
  }
}

export async function setKioskDoze(on: boolean): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    if (on) await c.set(KIOSK_DOZE_KEY, '1');
    else await c.del(KIOSK_DOZE_KEY);
  } catch (error) {
    console.warn('[cache] setKioskDoze failed:', error);
  }
}

// Redis mirror of the live settings profile, kept fresh by the studio's
// publish path so the kiosk's 60s poll never hits Neon directly.
export async function getKioskLiveSettingsCache(): Promise<ProfileSettings | null> {
  const c = getClient();
  if (!c) return null;
  try {
    return (await c.get<ProfileSettings>(KIOSK_LIVE_SETTINGS_KEY)) ?? null;
  } catch (error) {
    console.warn('[cache] getKioskLiveSettingsCache failed:', error);
    return null;
  }
}

export async function setKioskLiveSettingsCache(s: ProfileSettings): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(KIOSK_LIVE_SETTINGS_KEY, s);
  } catch (error) {
    console.warn('[cache] setKioskLiveSettingsCache failed:', error);
  }
}

export async function markKioskPoll(): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.set(KIOSK_LAST_POLL_KEY, new Date().toISOString());
  } catch (error) {
    console.warn('[cache] markKioskPoll failed:', error);
  }
}

export async function getKioskLastPoll(): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  try {
    return (await c.get<string>(KIOSK_LAST_POLL_KEY)) ?? null;
  } catch (error) {
    console.warn('[cache] getKioskLastPoll failed:', error);
    return null;
  }
}

