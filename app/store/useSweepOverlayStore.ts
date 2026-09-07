'use client';

import { create } from 'zustand';

/**
 * Owner toggles for drawing the sweep on the globe. Off by default; each
 * viewer's choice is remembered in localStorage, which can be absent or
 * throw (private window, thumbnail capture), so every touch is guarded and
 * the store renders correctly with nothing stored.
 */
export interface SweepOverlayToggles {
  /** The base ring line. */
  showBase: boolean;
  /** The day-side escalation ring. */
  showDay: boolean;
  /** The night-side escalation ring. */
  showNight: boolean;
  /** The Windy query boxes on every ring that is shown. */
  showBoxes: boolean;
}

type State = SweepOverlayToggles & {
  hydrated: boolean;
  set: (key: keyof SweepOverlayToggles, value: boolean) => void;
  /** Read localStorage once on the client; a no-op after the first call. */
  hydrate: () => void;
};

export const SWEEP_OVERLAY_STORAGE_KEY = 'sweep-overlay-toggles';

export const DEFAULT_TOGGLES: SweepOverlayToggles = {
  showBase: false,
  showDay: false,
  showNight: false,
  showBoxes: false,
};

function readStored(): Partial<SweepOverlayToggles> {
  try {
    const raw = window.localStorage.getItem(SWEEP_OVERLAY_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Partial<SweepOverlayToggles> = {};
    for (const key of Object.keys(DEFAULT_TOGGLES) as (keyof SweepOverlayToggles)[]) {
      const v = (parsed as Record<string, unknown>)[key];
      if (typeof v === 'boolean') out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStored(toggles: SweepOverlayToggles): void {
  try {
    window.localStorage.setItem(SWEEP_OVERLAY_STORAGE_KEY, JSON.stringify(toggles));
  } catch {
    // storage unavailable: the toggle still works for this page load
  }
}

const pick = (s: State): SweepOverlayToggles => ({
  showBase: s.showBase, showDay: s.showDay, showNight: s.showNight, showBoxes: s.showBoxes,
});

export const useSweepOverlayStore = create<State>()((set, get) => ({
  ...DEFAULT_TOGGLES,
  hydrated: false,
  set: (key, value) => {
    set({ [key]: value } as Partial<State>);
    writeStored(pick(get()));
  },
  hydrate: () => {
    if (get().hydrated) return;
    set({ ...readStored(), hydrated: true });
  },
}));

/** True when any ring is asked for, i.e. the map has something to draw. */
export function anyRingShown(t: SweepOverlayToggles): boolean {
  return t.showBase || t.showDay || t.showNight;
}
