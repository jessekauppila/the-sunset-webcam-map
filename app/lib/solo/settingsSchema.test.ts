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
      // the caption as dialled in on 2026-09-05
      captionLayout: 'inset', pictureHeight: 87, pictureTop: 4,
      captionAnchor: 'panel-bottom', captionAlign: 'picture', captionGap: 18,
      font: 'system', titleClean: 'compass',
      titleSize: 21, titleWeight: '300', titleGray: 71,
      placeSize: 17, placeGray: 57, lineGap: 0,
      timeStyle: '12h-there', timeLine: 'own', timeSize: 12, timeGray: 46,
    });
  });

  it('every knob sits in the glass, bins or caption section', () => {
    for (const knob of SOLO_SETTINGS_SCHEMA) {
      expect(['glass', 'bins', 'caption']).toContain(knob.section);
    }
  });

  it('keys are unique and every enum default is one of its options', () => {
    const keys = SOLO_SETTINGS_SCHEMA.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of SOLO_SETTINGS_SCHEMA) {
      if (k.kind === 'enum') expect(k.options, k.key).toContain(k.default);
      if (k.kind === 'number') {
        expect(k.default, k.key).toBeGreaterThanOrEqual(k.min);
        expect(k.default, k.key).toBeLessThanOrEqual(k.max);
      }
    }
  });

  it('dialsFrom reads merged deviations', () => {
    const merged = mergeSettings(SOLO_SETTINGS_SCHEMA, { repeatAllowance: 3, dwellS: 5, titleGray: 90, font: 'serif' });
    const d = dialsFrom(merged);
    expect(d.repeatAllowance).toBe(3);
    expect(d.dwellS).toBe(5);
    expect(d.mix).toBe(2);
    expect(d.titleGray).toBe(90);
    expect(d.font).toBe('serif');
  });
});
