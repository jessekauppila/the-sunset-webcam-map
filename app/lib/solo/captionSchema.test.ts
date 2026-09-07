import { describe, it, expect } from 'vitest';
import { CAPTION_SCHEMA, CAPTION_SECTION, captionDialsFrom, withCaption } from './captionSchema';
import { mergeSettings, schemaDefaults } from '@/app/lib/settings/schema';

describe('CAPTION_SCHEMA', () => {
  it('defaults are the 2026-09-05 mockup', () => {
    expect(captionDialsFrom(schemaDefaults(CAPTION_SCHEMA))).toEqual({
      captionLayout: 'inset', pictureHeight: 87, pictureShift: 0, captionAlign: 'picture', captionGap: 18,
      font: 'system', feedPrefix: true, titleClean: 'compass',
      titleSize: 21, titleWeight: '300', titleGray: 71,
      placeSize: 17, placeGray: 57, lineGap: 0,
      timeStyle: '12h-there', timeLine: 'own', timeSize: 12, timeGray: 46,
    });
  });

  it('every knob is in the caption section, keys are unique, and every default is legal', () => {
    const keys = CAPTION_SCHEMA.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of CAPTION_SCHEMA) {
      expect(k.section).toBe(CAPTION_SECTION);
      if (k.kind === 'enum') expect(k.options, k.key).toContain(k.default);
      if (k.kind === 'number') {
        expect(k.default, k.key).toBeGreaterThanOrEqual(k.min);
        expect(k.default, k.key).toBeLessThanOrEqual(k.max);
      }
    }
  });
});

describe('withCaption', () => {
  const own = { dwellS: 5, mix: 2 };
  it('lays the shared caption over a version\'s values, from deviations or merged values alike', () => {
    expect(withCaption(own, { pictureHeight: 70, activeVersion: 'solo' })).toMatchObject({ dwellS: 5, mix: 2, pictureHeight: 70, captionGap: 18 });
    const merged = mergeSettings(CAPTION_SCHEMA, { pictureHeight: 70 });
    expect(withCaption(own, merged).pictureHeight).toBe(70);
    expect('activeVersion' in withCaption(own, { pictureHeight: 70, activeVersion: 'solo' })).toBe(false);
  });
  it('without shared values the caption is at its defaults; a caption key in the version values does not win', () => {
    expect(withCaption(own).pictureHeight).toBe(87);
    expect(withCaption({ ...own, pictureHeight: 92 }, {}).pictureHeight).toBe(87);
    expect(withCaption({ ...own, pictureHeight: 92 }, { pictureHeight: 70 }).pictureHeight).toBe(70);
  });
});
