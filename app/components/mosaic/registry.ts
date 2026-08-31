import type { MosaicComponent } from './types';
import { MosaicV1 } from './v1';
import { V1_SETTINGS_SCHEMA } from './v1/settingsSchema';
import type { SettingsSchema } from '@/app/lib/settings/schema';

/**
 * Every mosaic version deployed, side by side. All versions ship in one
 * build; a surface picks one with `?v=<name>` (kiosk pages) and everything
 * else renders the pinned default. Promote a winner by changing
 * DEFAULT_MOSAIC_VERSION; retire a loser by deleting its folder and its
 * row here.
 */
export const MOSAIC_VERSIONS: Record<string, MosaicComponent> = {
  v1: MosaicV1,
};

export const DEFAULT_MOSAIC_VERSION = 'v1';

/** Settings schemas for each mosaic version. */
export const MOSAIC_SETTINGS_SCHEMAS: Record<string, SettingsSchema> = {
  v1: V1_SETTINGS_SCHEMA,
};

/** Unknown or missing names fall back to the pinned default. */
export function resolveMosaic(version: string | null | undefined): MosaicComponent {
  return (
    (version ? MOSAIC_VERSIONS[version] : undefined) ??
    MOSAIC_VERSIONS[DEFAULT_MOSAIC_VERSION]
  );
}
