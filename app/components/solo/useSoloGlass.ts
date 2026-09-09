'use client';

import { useEffect, useRef, useState } from 'react';
import type { EntryView, StateView, ViewEntry } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';
import type { SoloVersionName } from '@/app/lib/solo/versions';
import { useBuildReload } from '@/app/components/useBuildReload';

export const STATE_REFRESH_MS = 60_000;
/** The least time between two fires of the dwell timer, so a failed advance retries rather than spins. */
export const RETRY_MS = 5_000;

export interface SoloGlass {
  current: EntryView | null;
  /** When the server put `current` on glass, ms since epoch; null when unknown. A dwell's clock starts here. */
  shownSince: number | null;
  /** When this dwell ends, ms since epoch, as the server computed it (spec §5.1). Null before the first state arrives. */
  endsAtMs: number | null;
  /**
   * The frames this dwell plays, in play order, the drawn frame last, as the
   * DRAW pinned them. Empty before the first state arrives.
   *
   * A renderer must play this list rather than re-deriving a run from
   * `entries`. That pool is refetched every minute and changes every minute,
   * and a run's window is anchored at its newest frame, so a re-derivation
   * mid-dwell prepends older frames and shifts every index under a clock that
   * has already started.
   */
  shownSnapshotIds: number[];
  next: EntryView | null;
  slot: number;
  boundaryMs: number;
  error: string | null;
  queueLength: number;
  /** The whole projected queue, for preloading beyond the first. */
  nextEntries: EntryView[];
  /** Every active entry: the queue's frames, and the fallback when a dwell predates the pin. */
  entries: ViewEntry[];
}

function preload(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve(); // a failed preload is not a reason to skip the frame
    img.src = url;
  });
}

/**
 * The glass loop (spec §6.2): read the state, wait for the boundary the wall
 * clock dictates, ask the server for the next frame with that slot, show it,
 * preload the one after. Two tabs stay staggered because both read the same
 * clock; a reload just waits for its next boundary.
 */
export function useSoloGlass({ feed, drive, dozing, version = 'solo' }: {
  feed: Feed;
  drive: boolean;
  dozing: boolean;
  /** Which version's dials and engine the server should use. */
  version?: SoloVersionName;
}): SoloGlass {
  const [view, setView] = useState<StateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Set only while an advance is on the wire. It was once the last slot
  // posted, and that latch never reopened: one rejected post (a 400 for a
  // screen whose frame had aged out of the pool, 2026-09-06) and the screen
  // could never advance again without a reload.
  const inFlight = useRef(false);
  // The timer may not fire again before this instant, whatever the dwell says.
  const notBeforeMs = useRef(0);
  const driveRef = useRef(drive);
  const dozingRef = useRef(dozing);
  driveRef.current = drive;
  dozingRef.current = dozing;

  // State refresh: on mount and every minute, so admissions from the cron
  // reach the preload even when nothing advanced, and a following surface
  // tracks the glass within a minute.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/kiosk/solo/state?feed=${feed}&version=${version}`);
        if (!res.ok) throw new Error(`state ${res.status}`);
        const v = (await res.json()) as StateView;
        if (!alive) return;
        setView(v);
        if (v.next[0]) void preload(v.next[0].imageUrl);
      } catch (e) {
        if (alive) setError(String(e));
      }
    };
    void load();
    const t = setInterval(load, STATE_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [feed, version]);

  // The dwell timer. Waits for the instant the SERVER says this dwell ends,
  // rather than computing a boundary from the clock and a dial (spec §5.1).
  // A dwell's length is a function of engine state, so only the server can
  // know it; deriving it here would duplicate engine logic and drift
  // silently. Re-armed after every fire and whenever the published end moves.
  const endsAtMs = view?.current?.endsAtMs ?? null;
  // The slot belongs to the SCREEN, not to the frame on it: the state view
  // publishes it as schedule.slot even when `current` is null because the
  // frame on glass aged out of the pool. Reading it off `current` is what
  // sent slot 1 for a screen at 89437689.
  const screenSlot = view?.schedule.slot ?? null;
  useEffect(() => {
    // No state yet: nothing to post, the state refresh above is what recovers.
    if (screenSlot == null) return;
    // Nothing on glass means no dwell to wait out; the server projects from
    // now in that case too, so advance now.
    const dueMs = endsAtMs ?? Date.now();
    const wait = Math.max(1, dueMs - Date.now(), notBeforeMs.current - Date.now());
    const t = setTimeout(async () => {
      // The slot is a counter now, not a function of the clock: the next draw
      // is simply the one after the one on glass. Monotonic per feed, which is
      // what kiosk_draws' (feed, slot) primary key needs.
      const slot = screenSlot + 1;
      notBeforeMs.current = Date.now() + RETRY_MS;
      if (driveRef.current && !dozingRef.current && !inFlight.current) {
        inFlight.current = true;
        try {
          const res = await fetch('/api/kiosk/solo/advance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feed, slot, version }),
          });
          if (!res.ok) throw new Error(`advance ${res.status}`);
          const v = (await res.json()) as StateView & { advanced: boolean };
          // The server accepted the slot but the screen did not move (nothing
          // eligible to draw). The pool only changes when the cron admits, so
          // asking again before the next state refresh is asking the same
          // question.
          if (v.schedule.slot === screenSlot) notBeforeMs.current = Date.now() + STATE_REFRESH_MS;
          setView(v);
          setError(null);
          if (v.next[0]) void preload(v.next[0].imageUrl);
        } catch (e) {
          setError(String(e));
        } finally {
          inFlight.current = false;
        }
      }
      setTick((n) => n + 1); // re-arm
    }, wait);
    return () => clearTimeout(t);
  }, [feed, version, endsAtMs, screenSlot, tick]);

  // The glass is the one surface nobody reloads by hand, so it reloads itself
  // when the deployment answering this poll has moved past the build it is
  // running. Settings already reach the Pi within a minute; this is the code
  // half of the same promise.
  useBuildReload(view?.build ?? null);

  return {
    current: view?.current?.entry ?? null,
    shownSince: view?.current?.shownSince ?? null,
    endsAtMs,
    shownSnapshotIds: view?.current?.shownSnapshotIds ?? [],
    next: view?.next[0] ?? null,
    slot: screenSlot ?? 0,
    boundaryMs: endsAtMs ?? Date.now(),
    error,
    queueLength: view?.next.length ?? 0,
    nextEntries: view?.next ?? [],
    entries: view?.entries ?? [],
  };
}
