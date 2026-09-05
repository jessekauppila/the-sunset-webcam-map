import { describe, it, expect, vi } from 'vitest';

vi.mock('@/app/components/mosaic/registry', () => ({
  MOSAIC_VERSIONS: { v1: {} },
  DEFAULT_MOSAIC_VERSION: 'v1',
  MOSAIC_SETTINGS_SCHEMAS: {
    v1: [
      { key: 'floorPx', kind: 'number', min: 20, max: 800, step: 10, default: 100, label: 'floor', description: '', section: 's' },
      { key: 'gate', kind: 'number', min: 0, max: 1, step: 0.01, default: 0.5, label: 'gate', description: '', section: 's' },
      { key: 'label', kind: 'boolean', default: false, label: 'label', description: '', section: 's' },
      { key: 'ceilingPx', kind: 'number', min: 100, max: 2000, step: 10, default: 1000, label: 'ceiling', description: '', section: 's' },
    ],
  },
}));

import { summarize, profileEquals, formatValue } from './deploySummary';

const row = (id: number, namespaces: Record<string, Record<string, number | boolean | string>>) =>
  ({ id, label: null, namespaces, deployedAt: 'T' });

describe('formatValue', () => {
  it('integers plain, fractions to two places, booleans on/off, strings as-is', () => {
    expect(formatValue(140)).toBe('140');
    expect(formatValue(0.549999)).toBe('0.55');
    expect(formatValue(true)).toBe('on');
    expect(formatValue('solo')).toBe('solo');
  });
});

describe('summarize', () => {
  it('the first recorded deploy says so', () => {
    expect(summarize(row(1, { v1: { floorPx: 140 } }), undefined)).toBe('first recorded');
  });
  it('lists what changed against the previous deploy with the new values', () => {
    expect(summarize(row(2, { v1: { floorPx: 140, gate: 0.18 } }), row(1, { v1: { floorPx: 140 } }))).toBe('gate 0.18');
  });
  it('a namespace going back to defaults reads as its keys returning to default values', () => {
    expect(summarize(row(2, {}), row(1, { v1: { floorPx: 140 } }))).toBe('floorPx 100');
  });
  it('caps at three and counts the rest', () => {
    expect(summarize(row(2, { v1: { floorPx: 140, gate: 0.18, label: true, ceilingPx: 1100 } }), row(1, {})))
      .toBe('floorPx 140 · gate 0.18 · label on · +1');
  });
  it('an identical redeploy says no dial changes', () => {
    expect(summarize(row(2, { v1: { floorPx: 140 } }), row(1, { v1: { floorPx: 140 } }))).toBe('no dial changes');
  });
});

describe('profileEquals', () => {
  it('compares effective values per known namespace, so defaults and absent rows are equal', () => {
    expect(profileEquals({ v1: { floorPx: 100 } }, {})).toBe(true);
    expect(profileEquals({ v1: { floorPx: 140 } }, { v1: { floorPx: 140 } })).toBe(true);
    expect(profileEquals({ v1: { floorPx: 140 } }, undefined)).toBe(false);
  });
  it('ignores namespaces this build does not know', () => {
    expect(profileEquals({ gone: { x: 1 } }, {})).toBe(true);
  });
});
