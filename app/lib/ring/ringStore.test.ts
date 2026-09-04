import { describe, it, expect } from 'vitest';
import { loadSession, saveSession, RING_KEY, type RedisLike } from './ringStore';
import type { RingSession } from './ringLogic';

function fakeRedis(initial: Record<string, unknown> = {}): RedisLike & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = { ...initial };
  return {
    store,
    async get<T>(key: string) {
      return (store[key] as T) ?? null;
    },
    async set(key: string, value: unknown) {
      store[key] = value;
      return 'OK';
    },
  };
}

describe('ringStore', () => {
  it('returns an empty session when nothing is stored', async () => {
    const redis = fakeRedis();
    const session = await loadSession(redis);
    expect(session).toEqual({ claims: {} });
  });

  it('round-trips a session through save + load', async () => {
    const redis = fakeRedis();
    const session: RingSession = { claims: { p1: { cameraId: 10, claimedAt: 1, lastHeartbeat: 1 } } };
    await saveSession(session, redis);
    expect(redis.store[RING_KEY]).toEqual(session);
    expect(await loadSession(redis)).toEqual(session);
  });

  it('normalizes a malformed stored value to an empty session', async () => {
    const redis = fakeRedis({ [RING_KEY]: { nope: true } });
    expect(await loadSession(redis)).toEqual({ claims: {} });
  });
});
