import { describe, it, expect } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { SOLO2_NAMESPACE, SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from './settingsSchema';

describe('solo2 settings schema', () => {
  it('is its own namespace', () => {
    expect(SOLO2_NAMESPACE).toBe('solo2');
  });
  it('carries every solo dial with the same default and section', () => {
    for (const k of SOLO_SETTINGS_SCHEMA) {
      const mine = SOLO2_SETTINGS_SCHEMA.find((x) => x.key === k.key);
      expect(mine, k.key).toBeDefined();
      expect(mine!.default).toBe(k.default);
      expect(mine!.section).toBe(k.section);
    }
  });
  it('the additions default to solo\'s behaviour, except the time caption', () => {
    const d = dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA));
    expect(d).toMatchObject({
      transition: 'cut', leadS: 0, leadScale: 1.03, prelude: false, preludeFrames: 3, preludeStepS: 1.5,
      timeStyle: '12h', valleys: 0, screens: 'together',
    });
    // and still every solo dial
    expect(d).toMatchObject({ dwellS: 20, offsetS: 10, fadeS: 0, qualityFloor: 0.55, mix: 2 });
  });
  it('keys are unique and every enum default is one of its options', () => {
    const keys = SOLO2_SETTINGS_SCHEMA.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of SOLO2_SETTINGS_SCHEMA) {
      if (k.kind === 'enum') expect(k.options).toContain(k.default);
    }
  });
});
