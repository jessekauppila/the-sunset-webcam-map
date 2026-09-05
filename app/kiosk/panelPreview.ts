/**
 * Previewing a panel on a workstation monitor.
 *
 * The composition engine lays out against the viewport it is given, so simply
 * shrinking the browser window yields a *different* layout rather than a
 * smaller view of the panel's layout. `?panel=` instead composes at the
 * panel's real dimensions and scales the finished result down to fit, so what
 * you judge on a desk is what the glass will show.
 */

export interface PanelSize {
  width: number;
  height: number;
}

/**
 * The panels actually in play, in both orientations: portrait for the mosaic
 * versions, landscape (`-l`) for the solo kiosk.
 *
 * The single definition. `?panel=` parses against it, the shared settings
 * schema builds its enum and its help text from it, and /studio sizes the
 * preview with it. Adding a panel here is the whole change.
 */
export const PANEL_PRESETS: Record<string, PanelSize> = {
  dell: { width: 1080, height: 1920 },
  ktc: { width: 1440, height: 2560 },
  // The same two panels turned landscape, for the solo kiosk (spec
  // 2026-09-04-solo-kiosk-design §6.3). Which orientation the Pi draws is a
  // setting on the Pi; this preset must agree with it.
  'dell-l': { width: 1920, height: 1080 },
  'ktc-l': { width: 2560, height: 1440 },
};

export const DEFAULT_PANEL_PRESET = 'dell';

const MIN_EDGE_PX = 1;
const MAX_EDGE_PX = 8000;

const DIMENSIONS = /^(\d+)x(\d+)$/;

function isSupportedEdge(px: number): boolean {
  return px >= MIN_EDGE_PX && px <= MAX_EDGE_PX;
}

export function parsePanelPreview(
  params: Pick<URLSearchParams, 'get'>
): PanelSize | null {
  const raw = params.get('panel')?.trim().toLowerCase();
  if (!raw) return null;

  const preset = PANEL_PRESETS[raw];
  if (preset) return { ...preset };

  const match = DIMENSIONS.exec(raw);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!isSupportedEdge(width) || !isSupportedEdge(height)) return null;

  return { width, height };
}

/**
 * Scale that fits the panel inside the window, capped at 1:1 so a preview
 * never renders larger than the panel it stands in for. Falls back to 1 before
 * the window has been measured, so the first paint is never zero-sized.
 */
export function fitScale(
  panelWidth: number,
  panelHeight: number,
  windowWidth: number,
  windowHeight: number
): number {
  if (windowWidth <= 0 || windowHeight <= 0) return 1;
  return Math.min(windowWidth / panelWidth, windowHeight / panelHeight, 1);
}
