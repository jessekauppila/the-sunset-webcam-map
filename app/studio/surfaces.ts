// app/studio/surfaces.ts
import { MOSAIC_SETTINGS_SCHEMAS, MOSAIC_VERSIONS, resolveMosaicName } from '@/app/components/mosaic/registry';
import { SOLO_VERSIONS, type SoloVersionSpec } from '@/app/lib/solo/versions';
import type { SettingsSchema } from '@/app/lib/settings/schema';

export type SurfaceKind = 'mosaic' | 'solo';

/**
 * What the studio shows for one version (one-studio spec §2.2): the schema
 * its rail edits, and whether the page below the header is the mosaic
 * surface (pool, gate, scenes) or the solo surface (bins, queue, tape).
 * Data only, so the client can switch on `kind` without this file importing
 * a component. Adding `solo3` is one row here and one in SOLO_VERSIONS.
 */
export interface StudioSurface {
  name: string;
  kind: SurfaceKind;
  namespace: string;
  schema: SettingsSchema;
  solo: SoloVersionSpec | null;
  hasPicturePage: boolean;
}

const soloFor = (name: string): SoloVersionSpec | null =>
  name in SOLO_VERSIONS ? (SOLO_VERSIONS[name as keyof typeof SOLO_VERSIONS] as SoloVersionSpec) : null;

export const STUDIO_SURFACES: Record<string, StudioSurface> = Object.fromEntries(
  Object.keys(MOSAIC_VERSIONS).map((name) => {
    const solo = soloFor(name);
    return [name, {
      name, kind: solo ? 'solo' : 'mosaic', namespace: name,
      schema: MOSAIC_SETTINGS_SCHEMAS[name], solo, hasPicturePage: solo !== null,
    } satisfies StudioSurface];
  }),
);

export function surfaceFor(version: string | null | undefined): StudioSurface {
  return STUDIO_SURFACES[resolveMosaicName(version)];
}
