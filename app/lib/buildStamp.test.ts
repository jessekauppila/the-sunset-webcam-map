import { describe, it, expect } from 'vitest';
import {
  DEV_BUILD, CONFIRM_MS, RELOAD_COOLDOWN_MS, isStaleBuild, shouldReload,
} from './buildStamp';

describe('isStaleBuild', () => {
  it('is false when the two stamps match', () => {
    expect(isStaleBuild('abc123', 'abc123')).toBe(false);
  });

  it('is true when a tab built from one commit talks to a server built from another', () => {
    expect(isStaleBuild('abc123', 'def456')).toBe(true);
  });

  it('is false before the first poll answers', () => {
    expect(isStaleBuild('abc123', null)).toBe(false);
    expect(isStaleBuild('abc123', undefined)).toBe(false);
    expect(isStaleBuild('abc123', '')).toBe(false);
  });

  // `next dev` has no commit to stamp with, so both ends read DEV_BUILD and a
  // developer editing code must never be told their own tab is behind.
  it('is false whenever either end is a dev build', () => {
    expect(isStaleBuild(DEV_BUILD, 'def456')).toBe(false);
    expect(isStaleBuild('abc123', DEV_BUILD)).toBe(false);
    expect(isStaleBuild(DEV_BUILD, DEV_BUILD)).toBe(false);
  });
});

describe('shouldReload', () => {
  const now = 1_000_000_000;

  it('does not reload a tab that is not stale', () => {
    expect(shouldReload({ staleSinceMs: null, nowMs: now, lastReloadAtMs: null })).toBe(false);
  });

  // A deploy replaces the serving bundle over a few seconds, so a stamp read
  // mid-swap can disagree once and agree again. Waiting the mismatch out costs
  // nothing and keeps a rollout from blanking both screens.
  it('waits for the mismatch to persist before reloading', () => {
    expect(shouldReload({ staleSinceMs: now - 1_000, nowMs: now, lastReloadAtMs: null })).toBe(false);
    expect(shouldReload({ staleSinceMs: now - CONFIRM_MS, nowMs: now, lastReloadAtMs: null })).toBe(true);
  });

  // The one way this could hurt the glass is a loop: a mismatch that survives
  // its own reload (an edge cache still serving the old HTML) would otherwise
  // reload every minute for as long as it lasted.
  it('will not reload again inside the cooldown', () => {
    const stale = { staleSinceMs: now - CONFIRM_MS, nowMs: now };
    expect(shouldReload({ ...stale, lastReloadAtMs: now - 1_000 })).toBe(false);
    expect(shouldReload({ ...stale, lastReloadAtMs: now - RELOAD_COOLDOWN_MS })).toBe(true);
  });
});
