import { schemaDefaults } from '@/app/lib/settings/schema';
import { V4_SETTINGS_SCHEMA, configFromSettings } from '../settingsSchema';
import type { V4Config } from './types';

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
export function v4Config(over: Partial<V4Config> = {}): V4Config {
  return { ...configFromSettings(schemaDefaults(V4_SETTINGS_SCHEMA)), ...over };
}
