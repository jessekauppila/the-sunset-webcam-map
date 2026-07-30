import { Redis } from '@upstash/redis';
import type { RingSession } from './ringLogic';

export const RING_KEY = 'ring:session:v1';

export type RedisLike = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
};

let client: Redis | null = null;
function defaultClient(): Redis {
  if (!client) client = Redis.fromEnv();
  return client;
}

export async function loadSession(redis: RedisLike = defaultClient()): Promise<RingSession> {
  const data = await redis.get<RingSession>(RING_KEY);
  if (data && typeof data === 'object' && data.claims && typeof data.claims === 'object') {
    return data;
  }
  return { claims: {} };
}

export async function saveSession(
  session: RingSession,
  redis: RedisLike = defaultClient()
): Promise<void> {
  await redis.set(RING_KEY, session);
}
