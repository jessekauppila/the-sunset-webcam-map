import { Redis } from '@upstash/redis';

const TERMINATOR_KEY = 'terminator:current';
const TERMINATOR_TTL_SECONDS = 300;

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

