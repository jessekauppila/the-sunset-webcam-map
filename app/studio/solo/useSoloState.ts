'use client';

import { useMemo } from 'react';
import useSWR from 'swr';
import { buildStateView, type StateView } from '@/app/api/kiosk/solo/view';
import type { Feed, SoloDials } from '@/app/lib/solo/types';

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const POLL_MS = 5_000;

/**
 * One feed's bins as the server sees them, plus the same bins re-projected
 * with the STUDIO dials so a dial move is visible before the PATCH lands and
 * before Deploy. `server` is what the glass is doing; `projected` is what it
 * would do with these dials.
 *
 * The response does not carry the screen's sunset streak, so the projection
 * starts it at 0 and can differ from the server's own `next` by one draw.
 * FeedColumn says so when the first entries disagree.
 */
export function useSoloState(feed: Feed, studioDials: SoloDials) {
  const { data, error } = useSWR<StateView>(`/api/kiosk/solo/state?feed=${feed}`, fetcher, {
    refreshInterval: POLL_MS,
  });
  const projected = useMemo(() => {
    if (!data) return undefined;
    const screen = data.current
      ? { feed, currentSnapshotId: data.current.entry.snapshotId, shownSince: data.current.shownSince,
          slot: data.current.slot, sunsetStreak: 0 }
      : null;
    return buildStateView({
      feed, dials: studioDials, entries: data.entries, screen, nowMs: Date.now(),
      admitted: data.lastPull.admitted, zone: data.zone,
    });
  }, [data, feed, studioDials]);
  return { server: data, projected, error: error ? String(error) : undefined };
}
