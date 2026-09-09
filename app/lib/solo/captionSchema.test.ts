import { describe, it, expect } from 'vitest';
import {
  CAPTION_SCHEMA, CAPTION_SECTION, captionDialsFrom, linkedCaptionGroup, linkedCaptionValues, withCaption,
} from './captionSchema';
import { mergeSettings, schemaDefaults } from '@/app/lib/settings/schema';

describe('CAPTION_SCHEMA', () => {
  it('defaults are the 2026-09-05 mockup', () => {
    expect(captionDialsFrom(schemaDefaults(CAPTION_SCHEMA))).toEqual({
      captionLayout: 'inset', pictureHeight: 87, pictureShift: 0, captionAlign: 'picture', captionGap: 18,
      font: 'atkinson', feedPrefix: false, titleClean: 'compass',
      lineOrder: 'time-first', captionTrack: 6,
      titleSize: 30, titleWeight: '300', titleGray: 20,
      placeSize: 22, placeGray: 20, titleGap: 30, placeGap: 0,
      timeStyle: 'sun-past', timeLine: 'own', timeGap: 0, timeSize: 30, timeGray: 20,
    });
  });

  it('the time gap reaches far enough to drop the time clear of the pair above it', () => {
    const timeGap = CAPTION_SCHEMA.find((k) => k.key === 'timeGap');
    // A gap that tops out below the two lines it is separating the time from
    // cannot separate them: at the mockup sizes title + place stand about 47
    // glass px tall, and 60 px of gap left the time reading as the third line
    // of one block rather than as its own thing.
    expect(timeGap?.kind === 'number' && timeGap.max).toBeGreaterThanOrEqual(100);
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

describe('the gray dials', () => {
  it('every gray reaches 0, so any caption line can be taken all the way to black', () => {
    for (const key of ['titleGray', 'placeGray', 'timeGray']) {
      const knob = CAPTION_SCHEMA.find((k) => k.key === key);
      expect(knob?.kind, key).toBe('number');
      expect(knob && knob.kind === 'number' && knob.min, key).toBe(0);
    }
  });
});

describe('linkedCaptionValues', () => {
  const sizes = { titleSize: 21, placeSize: 17, timeSize: 12 };
  const grays = { titleGray: 71, placeGray: 57, timeGray: 46 };

  it('names the group a caption key belongs to, and nothing for the rest', () => {
    expect(linkedCaptionGroup('placeSize')).toBe('size');
    expect(linkedCaptionGroup('timeGray')).toBe('gray');
    expect(linkedCaptionGroup('placeGap')).toBe(null);
    expect(linkedCaptionGroup('captionGap')).toBe(null);
  });

  it('sizes scale by the ratio the dragged one moved, so the hierarchy holds', () => {
    // 21 → 42 is 2×: 17 → 34 and 12 → 24.
    expect(linkedCaptionValues('size', 'titleSize', 42, sizes)).toEqual({ placeSize: 34, timeSize: 24 });
    // dragging a smaller line scales the bigger ones the same way: 12 → 6 is a half.
    expect(linkedCaptionValues('size', 'timeSize', 6, sizes)).toEqual({ titleSize: 11, placeSize: 9 });
  });

  it('grays shift by the points the dragged one moved, so the contrast steps hold', () => {
    expect(linkedCaptionValues('gray', 'titleGray', 81, grays)).toEqual({ placeGray: 67, timeGray: 56 });
    expect(linkedCaptionValues('gray', 'placeGray', 47, grays)).toEqual({ titleGray: 61, timeGray: 36 });
  });

  it('a sibling that reaches the end of its own slider stops there while the others carry on', () => {
    // title 71 → 0 is −71 points; place floors at 0 and so does time.
    expect(linkedCaptionValues('gray', 'titleGray', 0, grays)).toEqual({ placeGray: 0, timeGray: 0 });
    // time tops out at 90 while place still has room.
    expect(linkedCaptionValues('gray', 'titleGray', 100, grays)).toEqual({ placeGray: 86, timeGray: 75 });
    // sizes floor at their own minimums: title 10, place 8.
    expect(linkedCaptionValues('size', 'timeSize', 8, sizes)).toEqual({ titleSize: 14, placeSize: 11 });
  });

  it('says nothing when the dial did not move, or when the value it moved from is missing', () => {
    expect(linkedCaptionValues('size', 'titleSize', 21, sizes)).toEqual({});
    expect(linkedCaptionValues('gray', 'titleGray', 80, {})).toEqual({});
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
