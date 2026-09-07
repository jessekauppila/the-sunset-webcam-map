'use client';

import { useEffect, useRef, useState } from 'react';
import type { EntryView, StateView, ViewEntry } from '@/app/api/kiosk/solo/view';
import type { Feed } from '@/app/lib/solo/types';
import type { SoloVersionName } from '@/app/lib/solo/versions';

const STATE_REFRESH_MS = 60_000;

export interface SoloGlass {
  current: EntryView | null;
  /** When the server put `current` on glass, ms since epoch; null when unknown. A dwell's clock starts here. */
  shownSince: number | null;
  /** When this dwell ends, ms since epoch, as the server computed it (spec §5.1). Null before the first state arrives. */
  endsAtMs: number | null;
  next: EntryView | null;
  slot: number;
  boundaryMs: number;
  error: string | null;
  queueLength: number;
  /** The whole projected queue, for preloading beyond the first. */
  nextEntries: EntryView[];
  /** Every active entry, so a renderer can derive a prelude (solo2). */
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
  const lastSlotPosted = useRef<number | null>(null);
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
  const currentSlot = view?.current?.slot ?? null;
  useEffect(() => {
    // No state yet, or a screen with nothing on it: poll rather than guess a
    // boundary. The state refresh above is what recovers from this.
    const wait = endsAtMs == null ? STATE_REFRESH_MS : Math.max(1, endsAtMs - Date.now());
    const t = setTimeout(async () => {
      // The slot is a counter now, not a function of the clock: the next draw
      // is simply the one after the one on glass. Monotonic per feed, which is
      // what kiosk_draws' (feed, slot) primary key needs.
      const slot = (currentSlot ?? 0) + 1;
      if (driveRef.current && !dozingRef.current && lastSlotPosted.current !== slot) {
        lastSlotPosted.current = slot;
        try {
          const res = await fetch('/api/kiosk/solo/advance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feed, slot, version }),
          });
          if (!res.ok) throw new Error(`advance ${res.status}`);
          const v = (await res.json()) as StateView & { advanced: boolean };
          setView(v);
          setError(null);
          if (v.next[0]) void preload(v.next[0].imageUrl);
        } catch (e) {
          setError(String(e));
        }
      }
      setTick((n) => n + 1); // re-arm
    }, wait);
    return () => clearTimeout(t);
  }, [feed, version, endsAtMs, currentSlot, tick]);

  return {
    current: view?.current?.entry ?? null,
    shownSince: view?.current?.shownSince ?? null,
    endsAtMs,
    next: view?.next[0] ?? null,
    slot: currentSlot ?? 0,
    boundaryMs: endsAtMs ?? Date.now(),
    error,
    queueLength: view?.next.length ?? 0,
    nextEntries: view?.next ?? [],
    entries: view?.entries ?? [],
  };
}
