import { describe, it, expect } from 'vitest';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { SOLO2_NAMESPACE, SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from './settingsSchema';

describe('solo2 settings schema', () => {
  it('is its own namespace', () => {
    expect(SOLO2_NAMESPACE).toBe('solo2');
  });
  it('carries every solo dial, same default except the fade, same section except the change dials', () => {
    // solo has no camera change to shape, so its `fadeS` sits under glass.
    // solo2 gathers everything about one picture giving way to the next onto
    // the rail's Change page, so those move sections deliberately.
    const MOVED = new Set(['fadeS']);
    for (const k of SOLO_SETTINGS_SCHEMA) {
      const mine = SOLO2_SETTINGS_SCHEMA.find((x) => x.key === k.key);
      expect(mine, k.key).toBeDefined();
      if (k.key !== 'fadeS') expect(mine!.default, k.key).toBe(k.default);
      expect(mine!.section, k.key).toBe(MOVED.has(k.key) ? 'arrival' : k.section);
    }
  });
  it('every dial about the change is on the Change page, and none of them is left on glass', () => {
    // The reported confusion, 2026-09-07: two dials named "camera change", one
    // on Play and one on Change, and the one on Play was the one you found.
    const arrival = SOLO2_SETTINGS_SCHEMA.filter((k) => k.section === 'arrival').map((k) => k.key);
    expect(arrival).toEqual([
      'transition', 'fadeS', 'veilStyle', 'veilTint', 'burnLift', 'veilCovers', 'sameCameraFadeS', 'arrivalEase',
    ]);
    // No two dials may share a label; that is what sent Jesse to the wrong tab.
    const labels = SOLO2_SETTINGS_SCHEMA.map((k) => k.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
  it('the additions default to solo\'s behaviour, except the dissolves and the camera run; the time dial is solo\'s', () => {
    const d = dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA));
    expect(d).toMatchObject({
      leadS: 0, leadScale: 1.03, cameraRun: true,
      timeStyle: '12h-there', valleys: 0, screens: 'together',
    });
    expect('prelude' in d).toBe(false);
    // Decided 2026-09-05: a camera change dips through black, the same camera dissolves.
    expect(d).toMatchObject({ transition: 'dip', fadeS: 1.5, sameCameraFadeS: 1.5 });
    // and still every solo dial
    expect(d).toMatchObject({ dwellS: 20, offsetS: 10, ratingFloor: 1, mix: 2 });
  });
  it('has no caption knobs of its own: the shared namespace carries them', () => {
    expect(SOLO2_SETTINGS_SCHEMA.some((k) => k.section === 'caption')).toBe(false);
    expect(dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)).pictureHeight).toBe(87);
  });
  it('keys are unique and every enum default is one of its options', () => {
    const keys = SOLO2_SETTINGS_SCHEMA.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of SOLO2_SETTINGS_SCHEMA) {
      if (k.kind === 'enum') expect(k.options).toContain(k.default);
    }
  });
});
