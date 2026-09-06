'use client';

import { useEffect, useRef, useState } from 'react';
import type { EntryView } from '@/app/api/kiosk/solo/view';

/**
 * What the preview is showing: the frame, the one it replaced, when this
 * dwell began, and where it sits in `order`. All four move in ONE state
 * update, so no render ever pairs a new frame with the old `previous`
 * (Appendix A concern 2) and a tick that does not advance never disturbs
 * the frame that is showing (concern 1).
 */
export interface PreviewDwell {
  entry: EntryView | null;
  previous: EntryView | null;
  startMs: number;
  index: number;
}

const empty = (startMs: number): PreviewDwell => ({ entry: null, previous: null, startMs, index: 0 });

/**
 * A local clock through `order` (the on-glass frame first, then the projected
 * queue) at `dwellS` per frame, wrapping at the end. It calls nothing: the
 * studio preview plays on the studio's dials while the glass keeps its own
 * clock. When `order[0]` changes — the server advanced — the clock restarts
 * at index 0 with the frame that was showing as `previous`.
 */
export function useSoloPreview(order: EntryView[], dwellS: number, tickMs = 250): PreviewDwell {
  const [dwell, setDwell] = useState<PreviewDwell>(() => (
    order.length === 0 ? empty(Date.now()) : { entry: order[0], previous: null, startMs: Date.now(), index: 0 }
  ));

  // The head we started this walk from. Derived during render, like the
  // glass's Dwell, so the restart and its previous frame commit together.
  const head = order[0]?.snapshotId ?? null;
  const [walkedFrom, setWalkedFrom] = useState<number | null>(head);
  if (head !== walkedFrom) {
    setWalkedFrom(head);
    setDwell(order.length === 0
      ? empty(Date.now())
      : { entry: order[0], previous: dwell.entry, startMs: Date.now(), index: 0 });
  }

  // The interval reads the latest order without being torn down and rebuilt
  // on every parent render (a studio dial in motion would starve the tick).
  const latest = useRef(order);
  useEffect(() => { latest.current = order; });

  useEffect(() => {
    const period = Math.max(1, dwellS * 1000);
    const tick = () => {
      // Captured once per real tick, outside the updater: a functional
      // setState update can be queued and evaluated later rather than at
      // call time, and a fresh `Date.now()` read from inside the updater
      // would then see whatever time the eventual evaluation happens to
      // land on instead of when this tick actually fired.
      const nowMs = Date.now();
      setDwell((prev) => {
        const now = latest.current;
        if (now.length === 0) return prev;
        // The order shrank under us: take its first frame rather than nothing.
        if (prev.index >= now.length) {
          return { entry: now[0], previous: prev.entry, startMs: nowMs, index: 0 };
        }
        // Jump straight to where the clock should be rather than walking one
        // step per tick: after a long pause (backgrounded tab, sleep) a
        // one-step-per-tick catch-up would replay every intermediate fade
        // and restart the stage clock at each step — a flicker storm.
        const steps = Math.floor((nowMs - prev.startMs) / period);
        if (steps < 1) return prev;
        const next = (prev.index + steps) % now.length;
        return { entry: now[next], previous: prev.entry, startMs: prev.startMs + steps * period, index: next };
      });
    };
    const t = setInterval(tick, Math.max(1, tickMs));
    return () => clearInterval(t);
  }, [dwellS, tickMs]);

  return dwell;
}
