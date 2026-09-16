'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MirrorView } from '@/app/api/mirror/view';
import type { SoloGlass } from '@/app/components/solo/useSoloGlass';
import { useBuildReload } from '@/app/components/useBuildReload';
import type { Feed } from '@/app/lib/solo/types';
import type { Solo2Dials } from '@/app/lib/solo2/types';

/** The safety net: a follower that missed a boundary catches up within a minute. */
export const STATE_REFRESH_MS = 60_000;
/** After the published end: the first origin call past it makes the draw, then the edge cache's window. */
export const FOLLOW_GRACE_MS = 700;
/** Between retries while the slot has not moved. */
export const RETRY_MS = 1_000;
/** How long to retry before parking on the minute refresh. */
export const FOLLOW_PATIENCE_MS = 10_000;

export interface GlassFollower extends SoloGlass {
  /** The live solo2 dials, caption included, as the server built them. Null before the first projection. */
  dials: Solo2Dials | null;
  panelPreset: string | null;
}

function preload(url: string) {
  const img = new Image();
  img.src = url;
}

/**
 * Every follower's loop (mirror spec §4.2): read the projection, wait for
 * the instant the SERVER says the dwell ends, read again. The server draws
 * the next frame on that read (advance on read), so there is nothing here
 * to decide and nothing to POST. If the slot has not moved (a stale edge
 * hit, a slow commit), retry once a second for the patience window, then
 * leave it to the minute refresh.
 */
export function useGlassFollower(feed: Feed): GlassFollower {
  const [view, setView] = useState<MirrorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);
  /** When the current run of retries began; null while the dwell is still running. */
  const waitingSinceMs = useRef<number | null>(null);
  const lastSlot = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/mirror/state?feed=${feed}`);
      if (!res.ok) throw new Error(`mirror ${res.status}`);
      const v = (await res.json()) as MirrorView;
      setView(v);
      setError(null);
      for (const e of v.next) preload(e.imageUrl);
    } catch (e) {
      setError(String(e));
    } finally {
      inFlight.current = false;
    }
  }, [feed]);

  // The minute refresh: on mount and every minute, whatever the boundary timer is doing.
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), STATE_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const endsAtMs = view?.current?.endsAtMs ?? null;
  const slot = view?.slot ?? null;

  // The boundary timer.
  useEffect(() => {
    if (slot !== lastSlot.current) {
      lastSlot.current = slot;
      waitingSinceMs.current = null;
    }
    // Nothing on glass: the minute refresh is what recovers. Clear the
    // patience clock too — otherwise a stale waitingSinceMs from a prior
    // dwell survives the empty gap and parks the next dwell's first miss
    // immediately, with zero retries.
    if (endsAtMs == null) {
      waitingSinceMs.current = null;
      return;
    }
    const now = Date.now();
    const due = endsAtMs + FOLLOW_GRACE_MS;
    let wait: number;
    if (due > now) {
      waitingSinceMs.current = null;
      wait = due - now;
    } else {
      waitingSinceMs.current ??= now;
      if (now - waitingSinceMs.current >= FOLLOW_PATIENCE_MS) return; // parked
      wait = RETRY_MS;
    }
    const t = setTimeout(async () => {
      await load();
      setTick((n) => n + 1); // re-arm; the deps below decide whether that is a wait or a retry
    }, wait);
    return () => clearTimeout(t);
  }, [load, endsAtMs, slot, tick]);

  useBuildReload(view?.build ?? null);

  const drawnNext = view?.next.at(-1) ?? null;
  return {
    current: view?.current?.entry ?? null,
    shownSince: view?.current?.shownSince ?? null,
    endsAtMs,
    shownSnapshotIds: view?.current?.shownSnapshotIds ?? [],
    next: drawnNext,
    slot: slot ?? 0,
    boundaryMs: endsAtMs ?? Date.now(),
    error,
    queueLength: drawnNext ? 1 : 0,
    nextEntries: drawnNext ? [drawnNext] : [],
    entries: view?.entries ?? [],
    dials: view?.dials ?? null,
    panelPreset: view?.panelPreset ?? null,
  };
}
