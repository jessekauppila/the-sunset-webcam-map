import { describe, it, expect } from 'vitest';
import { SOLO_SETTINGS_SCHEMA, SOLO_NAMESPACE, dialsFrom } from './settingsSchema';
import { schemaDefaults, mergeSettings } from '@/app/lib/settings/schema';

describe('SOLO_SETTINGS_SCHEMA', () => {
  it('is namespaced solo', () => {
    expect(SOLO_NAMESPACE).toBe('solo');
  });

  it('defaults match the spec', () => {
    const d = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
    expect(d).toEqual({
      qualityFloor: 0.55, detectionFloor: 0.3, sunsetFloor: 6, mix: 2,
      repeatAllowance: 1, promoteNew: true, zoneGrace: 2,
      dwellS: 20, offsetS: 10, fadeS: 0,
      showPlace: true, showScores: false, showRank: false, showTally: false,
    });
  });

  it('every knob sits in the glass or bins section', () => {
    for (const knob of SOLO_SETTINGS_SCHEMA) {
      expect(['glass', 'bins']).toContain(knob.section);
    }
  });

  it('dialsFrom reads merged deviations', () => {
    const merged = mergeSettings(SOLO_SETTINGS_SCHEMA, { repeatAllowance: 3, dwellS: 5 });
    const d = dialsFrom(merged);
    expect(d.repeatAllowance).toBe(3);
    expect(d.dwellS).toBe(5);
    expect(d.mix).toBe(2);
  });
});
