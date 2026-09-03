import { schemaDefaults } from '@/app/lib/settings/schema';
import { V3_SETTINGS_SCHEMA, configFromSettings } from '../settingsSchema';
import type { V3Config } from './types';

/**
 * The engine config a test should start from: the schema's own defaults,
 * exactly as a surface with no settings row would compute them. Tests
 * override only the dials they are about.
 *
 * Not a hand-copied literal on purpose. Three of those drifted from the
 * schema after the v2 copy — carrying dead `strategy`/`rowAlign` keys, which
 * are TS2353 errors that hide in this repo's pre-existing tsc noise, and
 * missing every dial added since — so a test could pass against a wall no
 * surface renders. Deriving from the schema makes a new dial reach every test
 * the moment it is declared.
 */
export function v3Config(over: Partial<V3Config> = {}): V3Config {
  return { ...configFromSettings(schemaDefaults(V3_SETTINGS_SCHEMA)), ...over };
}
