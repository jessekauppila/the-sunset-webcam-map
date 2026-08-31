import { SettingsSchema } from './schema';
import { MOSAIC_VERSIONS, DEFAULT_MOSAIC_VERSION } from '@/app/components/mosaic/registry';

export const SHARED_NAMESPACE = 'shared';

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
    options: ['dell', 'ktc'] as const,
    default: 'dell',
    label: 'panel',
    description: 'Panel size: dell = 1080×1920, ktc = 1440×2560. Both physical screens share one geometry.',
    section: 'glass',
  },
] as const;
