import { describe, it, expect } from 'vitest';
import {
  schemaDefaults, sanitizeValues, stripDefaults, mergeSettings, diffKeys,
  type SettingsSchema,
} from './schema';

const SCHEMA: SettingsSchema = [
  { key: 'floorPx', kind: 'number', min: 20, max: 800, step: 10, default: 100,
    label: 'floor', description: 'min tile px', section: 'sizing' },
  { key: 'cullOverflow', kind: 'boolean', default: true,
    label: 'cull', description: 'drop overflow', section: 'arrangement' },
  { key: 'activeVersion', kind: 'enum', options: ['v1', 'v2'], default: 'v1',
    label: 'version', description: 'mosaic on glass', section: 'glass' },
];

describe('schemaDefaults', () => {
  it('returns every knob at its code default', () => {
    expect(schemaDefaults(SCHEMA)).toEqual({
      floorPx: 100, cullOverflow: true, activeVersion: 'v1',
    });
  });
});

describe('sanitizeValues', () => {
  it('drops unknown keys so removed knobs never poison a stored blob', () => {
    expect(sanitizeValues(SCHEMA, { floorPx: 140, ghost: 9 })).toEqual({ floorPx: 140 });
  });
  it('clamps numbers into their declared range', () => {
    expect(sanitizeValues(SCHEMA, { floorPx: 5000 })).toEqual({ floorPx: 800 });
  });
  it('omits wrong-typed and non-finite values instead of coercing', () => {
    expect(sanitizeValues(SCHEMA, {
      floorPx: 'big', cullOverflow: 'yes', activeVersion: 'v9',
    })).toEqual({});
    expect(sanitizeValues(SCHEMA, { floorPx: NaN })).toEqual({});
  });
  it('returns empty for non-object input', () => {
    expect(sanitizeValues(SCHEMA, null)).toEqual({});
    expect(sanitizeValues(SCHEMA, [1, 2])).toEqual({});
  });
});

describe('stripDefaults', () => {
  it('keeps only deviations so the DB stores nothing redundant', () => {
    expect(stripDefaults(SCHEMA, { floorPx: 100, cullOverflow: false }))
      .toEqual({ cullOverflow: false });
  });
  it('omits keys absent from a partial input instead of writing undefined entries', () => {
    const out = stripDefaults(SCHEMA, { cullOverflow: false });
    expect(Object.keys(out)).toEqual(['cullOverflow']);
  });
});

describe('mergeSettings', () => {
  it('applies default, then profile deviation, then URL override, in that order', () => {
    expect(mergeSettings(SCHEMA, { floorPx: 140 }, { floorPx: 60 }).floorPx).toBe(60);
    expect(mergeSettings(SCHEMA, { floorPx: 140 }).floorPx).toBe(140);
    expect(mergeSettings(SCHEMA).floorPx).toBe(100);
  });
  it('ignores unknown keys from stored blobs', () => {
    expect(mergeSettings(SCHEMA, { retired: 1 })).toEqual(schemaDefaults(SCHEMA));
  });
});

describe('diffKeys', () => {
  it('reports keys whose effective values differ — the diff badge count', () => {
    expect(diffKeys(SCHEMA, { floorPx: 140 }, {})).toEqual(['floorPx']);
  });
  it('treats an explicit default and an absent key as identical', () => {
    expect(diffKeys(SCHEMA, { floorPx: 100 }, {})).toEqual([]);
  });
});
