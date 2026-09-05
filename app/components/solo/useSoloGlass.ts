'use client';

import { useEffect, useRef, useState } from 'react';
import type { EntryView, StateView, ViewEntry } from '@/app/api/kiosk/solo/view';
import { slotFor } from '@/app/lib/solo/schedule';
import type { Feed, SoloDials } from '@/app/lib/solo/types';
import type { SoloVersionName } from '@/app/lib/solo/versions';
import { msUntilBoundary } from './schedule';

const STATE_REFRESH_MS = 60_000;

export interface SoloGlass {
  current: EntryView | null;
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
export function useSoloGlass({ feed, dials, drive, dozing, version = 'solo' }: {
  feed: Feed;
  dials: SoloDials;
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

  // The boundary timer. Re-armed after every fire and whenever dials change.
  useEffect(() => {
    const wait = msUntilBoundary(Date.now(), feed, dials.dwellS, dials.offsetS);
    const t = setTimeout(async () => {
      const slot = slotFor(Date.now(), feed, dials.dwellS, dials.offsetS);
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
  }, [feed, version, dials.dwellS, dials.offsetS, tick]);

  const nowMs = Date.now();
  return {
    current: view?.current?.entry ?? null,
    next: view?.next[0] ?? null,
    slot: slotFor(nowMs, feed, dials.dwellS, dials.offsetS),
    boundaryMs: nowMs + msUntilBoundary(nowMs, feed, dials.dwellS, dials.offsetS),
    error,
    queueLength: view?.next.length ?? 0,
    nextEntries: view?.next ?? [],
    entries: view?.entries ?? [],
  };
}
