import type { MosaicComponent } from './types';
import { MosaicV1 } from './v1';
import { V1_SETTINGS_SCHEMA } from './v1/settingsSchema';
import { MosaicV2 } from './v2';
import { V2_SETTINGS_SCHEMA } from './v2/settingsSchema';
import { MosaicV3 } from './v3';
import { V3_SETTINGS_SCHEMA } from './v3/settingsSchema';
import { MosaicV4 } from './v4';
import { V4_SETTINGS_SCHEMA } from './v4/settingsSchema';
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
  v2: MosaicV2,
  v3: MosaicV3,
  v4: MosaicV4,
};

export const DEFAULT_MOSAIC_VERSION = 'v1';

/** Settings schemas for each mosaic version. */
export const MOSAIC_SETTINGS_SCHEMAS: Record<string, SettingsSchema> = {
  v1: V1_SETTINGS_SCHEMA,
  v2: V2_SETTINGS_SCHEMA,
  v3: V3_SETTINGS_SCHEMA,
  v4: V4_SETTINGS_SCHEMA,
};

/** Unknown or missing names fall back to the pinned default. */
export function resolveMosaic(version: string | null | undefined): MosaicComponent {
  return (
    (version ? MOSAIC_VERSIONS[version] : undefined) ??
    MOSAIC_VERSIONS[DEFAULT_MOSAIC_VERSION]
  );
}

/**
 * Same fallback rule as resolveMosaic, but returns the resolved registry
 * key rather than the component — for looking up the matching settings
 * namespace (`liveSettings.namespaces[resolveMosaicName(...)]`).
 */
export function resolveMosaicName(version: string | null | undefined): string {
  return version && version in MOSAIC_VERSIONS ? version : DEFAULT_MOSAIC_VERSION;
}
