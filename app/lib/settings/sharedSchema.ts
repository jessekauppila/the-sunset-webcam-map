import { SettingsSchema } from './schema';
import { MOSAIC_VERSIONS, DEFAULT_MOSAIC_VERSION } from '@/app/components/mosaic/registry';
import { PANEL_PRESETS, DEFAULT_PANEL_PRESET } from '@/app/kiosk/panelPreview';

export const SHARED_NAMESPACE = 'shared';

const describePanels = (): string =>
  Object.entries(PANEL_PRESETS)
    .map(([name, { width, height }]) => `${name} = ${width}×${height}`)
    .join(', ');

/**
 * Shared settings apply across all mosaic versions and the UI.
 * activeVersion selects which mosaic to render (?v= param default).
 * panelPreset selects the physical screen dimensions for the kiosk.
 */
export const SHARED_SCHEMA: SettingsSchema = [
  {
    key: 'activeVersion',
    kind: 'enum',
    options: Object.keys(MOSAIC_VERSIONS),
    default: DEFAULT_MOSAIC_VERSION,
    label: 'active version',
    description: 'Which mosaic version to display',
    section: 'glass',
  },
  {
    key: 'panelPreset',
    kind: 'enum',
    // Built from PANEL_PRESETS rather than restated, so a new panel cannot
    // exist for `?panel=` and be missing from the dial (or vice versa).
    options: Object.keys(PANEL_PRESETS),
    default: DEFAULT_PANEL_PRESET,
    label: 'panel',
    description: `Panel size: ${describePanels()}. Both physical screens share one geometry.`,
    section: 'glass',
  },
] as const;
