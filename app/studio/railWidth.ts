/**
 * Width of the /studio dial rail. Pure helpers (clamp + storage) live here
 * so they're unit-testable without rendering the grid; StudioClient owns
 * the drag handle and the React state.
 *
 * 360 (not leva's 320 default) so the label column beside a 160px control
 * fits the longest dial names without ellipsis at the default width.
 */
export const RAIL_WIDTH_DEFAULT = 360;
export const RAIL_WIDTH_MIN = 280;
export const RAIL_WIDTH_MAX = 640;
export const RAIL_WIDTH_STORAGE_KEY = 'studio.railWidth';

export function clampRailWidth(width: number): number {
  if (!Number.isFinite(width)) return RAIL_WIDTH_DEFAULT;
  return Math.round(Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, width)));
}

export function readStoredRailWidth(): number {
  try {
    const raw = window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY);
    if (raw === null) return RAIL_WIDTH_DEFAULT;
    return clampRailWidth(Number(raw));
  } catch {
    return RAIL_WIDTH_DEFAULT;
  }
}

export function writeStoredRailWidth(width: number): void {
  try {
    window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(clampRailWidth(width)));
  } catch {
    // Storage unavailable (private mode, quota): the width just won't persist.
  }
}
