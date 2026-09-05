import type { SettingsSchema } from './schema';
import { SHARED_NAMESPACE, SHARED_SCHEMA } from './sharedSchema';
import { MOSAIC_SETTINGS_SCHEMAS } from '@/app/components/mosaic/registry';

/** The schema a namespace's deviations are read through, or null for a namespace this build does not know. */
export function schemaFor(namespace: string): SettingsSchema | null {
  if (namespace === SHARED_NAMESPACE) return SHARED_SCHEMA;
  return MOSAIC_SETTINGS_SCHEMAS[namespace] ?? null;
}

export const KNOWN_NAMESPACES: string[] = [SHARED_NAMESPACE, ...Object.keys(MOSAIC_SETTINGS_SCHEMAS)];
