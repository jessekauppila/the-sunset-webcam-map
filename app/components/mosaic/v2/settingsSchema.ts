import type { SettingsSchema } from '@/app/lib/settings/schema';

/**
 * v2 composition knobs. Grows task by task; every knob here must have a
 * default equal to what the engine does with no settings present.
 */
export const V2_SETTINGS_SCHEMA: SettingsSchema = [] as const;
