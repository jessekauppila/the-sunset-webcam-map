import { describe, it, expect } from 'vitest';
import { mergeSettings, schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from './settingsSchema';

describe('solo2 dials on the beat', () => {
  const keys = SOLO2_SETTINGS_SCHEMA.map((k) => k.key);
  it('has the beat, the still and the change, and none of the seconds dials they replace', () => {
    expect(keys).toEqual(expect.arrayContaining(['beat', 'dwellBeats', 'changeBeats']));
    for (const gone of ['dwellS', 'minStepS', 'fadeS', 'offsetS']) expect(keys).not.toContain(gone);
  });
  it('defaults: 4 s beat, a still of 3 beats, one beat of change; the seconds fields are derived', () => {
    const d = dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA));
    expect(d.beatS).toBe(4);
    expect(d.dwellBeats).toBe(3);
    expect(d.changeBeats).toBe(1);
    expect(d.dwellS).toBe(12);
    expect(d.fadeS).toBe(4);
    expect(d.offsetS).toBe(0);
  });
  it('the beat is an enum of the minute\'s divisors, read as a number', () => {
    const beat = SOLO2_SETTINGS_SCHEMA.find((k) => k.key === 'beat')!;
    expect(beat.kind).toBe('enum');
    expect(dialsFrom2(mergeSettings(SOLO2_SETTINGS_SCHEMA, { beat: '6', dwellBeats: 2 })).dwellS).toBe(12);
    // A stored value from before the dial is dropped, not applied.
    expect(dialsFrom2(mergeSettings(SOLO2_SETTINGS_SCHEMA, { minStepS: 1, dwellS: 47 })).dwellS).toBe(12);
  });
});

describe('rendezvous dials', () => {
  const keys = SOLO2_SETTINGS_SCHEMA.map((k) => k.key);
  it('has the rendezvous dials, and rank is gone', () => {
    expect(keys).toEqual(expect.arrayContaining(['rendezvous', 'rendezvousWindow', 'rendezvousGood', 'rendezvousRest']));
    // Removed rather than repurposed: it used to decide whether a meeting
    // could happen at all, and nothing gates on rank now (scheduler spec §5).
    expect(keys).not.toContain('rendezvousRank');
  });
  it('defaults: off, window 4, good 0.75, no rest', () => {
    const d = dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA));
    expect(d.rendezvous).toBe(false);
    expect(d.rendezvousWindow).toBe(4);
    expect(d.rendezvousGood).toBe(0.75);
    expect(d.rendezvousRest).toBe(0);
  });
  it('the window is clamped to [1, 8] by mergeSettings', () => {
    expect(dialsFrom2(mergeSettings(SOLO2_SETTINGS_SCHEMA, { rendezvousWindow: 99 })).rendezvousWindow).toBe(8);
    expect(dialsFrom2(mergeSettings(SOLO2_SETTINGS_SCHEMA, { rendezvousWindow: 0 })).rendezvousWindow).toBe(1);
  });
});
