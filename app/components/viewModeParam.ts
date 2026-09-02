import type { ViewMode } from './MainViewContainer';

/**
 * Query param that carries a homepage view across a route boundary. The
 * homepage keeps its view in React state, which /studio cannot reach, so
 * leaving studio for Globe or My Cameras has to say where it is going.
 */
export const VIEW_PARAM = 'view';

const KNOWN: ViewMode[] = [
  'map',
  'globe',
  'sunrise-mosaic',
  'sunset-mosaic',
  'rating',
  'swipe',
  'gallery',
  'my-cameras',
];

/** Reads the view param out of a query string, ignoring anything unknown. */
export function parseViewMode(search: string, fallback: ViewMode): ViewMode {
  const raw = new URLSearchParams(search).get(VIEW_PARAM);
  return KNOWN.includes(raw as ViewMode) ? (raw as ViewMode) : fallback;
}

/** The homepage URL that lands on a given view. */
export function homeHrefFor(mode: ViewMode): string {
  return `/?${VIEW_PARAM}=${encodeURIComponent(mode)}`;
}
