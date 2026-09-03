export type KnobValue = number | boolean | string;
export type SettingsValues = Record<string, KnobValue>;

export interface KnobBase {
  key: string;
  label: string;
  description: string;
  section: string; // folder name in the rail: 'sizing' | 'arrangement' | 'overlays' | 'glass' | ...
}

export interface NumberKnob extends KnobBase {
  kind: 'number';
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface BooleanKnob extends KnobBase {
  kind: 'boolean';
  default: boolean;
}

export interface EnumKnob extends KnobBase {
  kind: 'enum';
  options: readonly string[];
  default: string;
}

export type KnobDescriptor = NumberKnob | BooleanKnob | EnumKnob;
export type SettingsSchema = readonly KnobDescriptor[];

export function schemaDefaults(schema: SettingsSchema): SettingsValues {
  const out: SettingsValues = {};
  for (const knob of schema) {
    out[knob.key] = knob.default;
  }
  return out;
}

export function sanitizeValues(schema: SettingsSchema, input: unknown): SettingsValues {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const out: SettingsValues = {};
  for (const knob of schema) {
    if (!(knob.key in raw)) continue;
    const v = raw[knob.key];
    if (knob.kind === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[knob.key] = Math.min(knob.max, Math.max(knob.min, v));
    } else if (knob.kind === 'boolean') {
      if (typeof v !== 'boolean') continue;
      out[knob.key] = v;
    } else {
      if (typeof v !== 'string' || !knob.options.includes(v)) continue;
      out[knob.key] = v;
    }
  }
  return out;
}

export function stripDefaults(schema: SettingsSchema, values: SettingsValues): SettingsValues {
  const out: SettingsValues = {};
  for (const knob of schema) {
    if (!(knob.key in values)) continue;
    const value = values[knob.key];
    if (value !== knob.default) {
      out[knob.key] = value;
    }
  }
  return out;
}

export function mergeSettings(
  schema: SettingsSchema,
  deviations?: SettingsValues,
  overrides?: SettingsValues
): SettingsValues {
  const dev = sanitizeValues(schema, deviations ?? {});
  const ovr = sanitizeValues(schema, overrides ?? {});
  const out: SettingsValues = {};
  for (const knob of schema) {
    out[knob.key] = ovr[knob.key] ?? dev[knob.key] ?? knob.default;
  }
  return out;
}

export function diffKeys(
  schema: SettingsSchema,
  a?: SettingsValues,
  b?: SettingsValues
): string[] {
  const mergedA = mergeSettings(schema, a);
  const mergedB = mergeSettings(schema, b);
  const keys: string[] = [];
  for (const knob of schema) {
    if (mergedA[knob.key] !== mergedB[knob.key]) {
      keys.push(knob.key);
    }
  }
  return keys;
}

export type DroppedKey = { key: string; reason: 'unknown' | 'invalid' };

/**
 * The keys a caller posted that `sanitizeValues` will silently discard.
 *
 * Sanitizing is deliberately quiet so a stale stored blob cannot poison a
 * profile, but that same silence hides the case where a dial is posted
 * against a build whose schema predates it: the value vanishes, the studio
 * row never changes, and Deploy goes on truthfully reporting "in sync with
 * glass" about a setting the glass has never been told. Callers use this to
 * say so out loud. A clamped number is not dropped — the value survives.
 */
export function droppedKeys(schema: SettingsSchema, input: unknown): DroppedKey[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return [];
  const raw = input as Record<string, unknown>;
  const known = new Set(schema.map((knob) => knob.key));
  const survived = sanitizeValues(schema, input);
  const out: DroppedKey[] = [];
  for (const key of Object.keys(raw)) {
    if (key in survived) continue;
    out.push({ key, reason: known.has(key) ? 'invalid' : 'unknown' });
  }
  return out;
}
