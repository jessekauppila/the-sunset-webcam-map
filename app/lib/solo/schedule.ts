import type { Feed } from './types';

/**
 * Two screens, no coordination (spec §6.2). Both read the wall clock: the
 * sunrise screen changes at every multiple of dwell on Unix time, the sunset
 * screen `offset` seconds later. A slot is the index of that boundary, and
 * the advance endpoint is idempotent on it, so a reload or a double-fire
 * lands on the same frame.
 */
function shiftMs(feed: Feed, offsetS: number): number {
  return feed === 'sunset' ? offsetS * 1000 : 0;
}

export function slotFor(nowMs: number, feed: Feed, dwellS: number, offsetS: number): number {
  return Math.floor((nowMs - shiftMs(feed, offsetS)) / (dwellS * 1000));
}

export function boundaryMs(slot: number, feed: Feed, dwellS: number, offsetS: number): number {
  return slot * dwellS * 1000 + shiftMs(feed, offsetS);
}

export function nextBoundaryMs(nowMs: number, feed: Feed, dwellS: number, offsetS: number): number {
  return boundaryMs(slotFor(nowMs, feed, dwellS, offsetS) + 1, feed, dwellS, offsetS);
}
