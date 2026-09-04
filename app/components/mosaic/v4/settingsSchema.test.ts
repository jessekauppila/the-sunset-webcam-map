import { describe, it, expect } from 'vitest';
import { V4_SETTINGS_SCHEMA, configFromSettings, urlOverrides } from './settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

describe('V4_SETTINGS_SCHEMA', () => {
  it('has a knob for every composition decision', () => {
    const keys = V4_SETTINGS_SCHEMA.map((k) => k.key);
    for (const key of [
      'qualitySource', 'gateThreshold', 'failedCamPolicy', 'maxTiles',
      'floorPx', 'ceilingPx', 'curve',
      'bandCount', 'tileGapPx', 'latNorth', 'latSouth',
      'axisNightEdgeDeg', 'axisDayEdgeDeg', 'hysteresisMargin', 'minDwellMs',
      'showFeedLabel', 'showTileRatings', 'showModelReadout', 'showCentreLine',
      'motionMode', 'motionOrder', 'motionDurationMs', 'motionStaggerMs',
      'crossfadeMs', 'waveGridMs',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('has no duplicate keys', () => {
    const keys = V4_SETTINGS_SCHEMA.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('groups knobs into rail sections', () => {
    const sections = new Set(V4_SETTINGS_SCHEMA.map((k) => k.section));
    expect(sections).toEqual(
      new Set(['signal', 'visibility', 'sizing', 'arrangement', 'overlays', 'motion'])
    );
  });

  it('gives every number knob a range that contains its default', () => {
    for (const knob of V4_SETTINGS_SCHEMA) {
      if (knob.kind !== 'number') continue;
      expect(knob.default).toBeGreaterThanOrEqual(knob.min);
      expect(knob.default).toBeLessThanOrEqual(knob.max);
    }
  });

  it('gives every enum knob a default among its options', () => {
    for (const knob of V4_SETTINGS_SCHEMA) {
      if (knob.kind !== 'enum') continue;
      expect(knob.options).toContain(knob.default);
    }
  });

  it('describes every knob for the rail tooltip', () => {
    for (const knob of V4_SETTINGS_SCHEMA) {
      expect(knob.description.length).toBeGreaterThan(0);
      expect(knob.label.length).toBeGreaterThan(0);
    }
  });

  it('defaults gateThreshold to 0.55 on the probability scale', () => {
    const gate = V4_SETTINGS_SCHEMA.find((k) => k.key === 'gateThreshold')!;
    expect(gate.default).toBe(0.55);
    expect(gate.kind).toBe('number');
    if (gate.kind === 'number') {
      expect(gate.min).toBe(0);
      expect(gate.max).toBe(1);
    }
  });

  it('defaults to the decided arrangement', () => {
    const byKey = Object.fromEntries(V4_SETTINGS_SCHEMA.map((k) => [k.key, k.default]));
    expect(byKey.failedCamPolicy).toBe('showAtFloor');
    expect(byKey.floorPx).toBe(100);
    // Decided 2026-09-03 on the live-capture fixture: 8 x 240 keeps
    // bandCount * ceilingPx at the dell panel height (1920), the relation
    // that keeps the wall whole. 13 x 480 showed 1 of 4 real sunsets.
    expect(byKey.ceilingPx).toBe(240);
    expect(byKey.bandCount).toBe(8);
    // Spec §5.4: a starting guess, not a measurement — but the guess is
    // written down, so a silent drift from it shows up here.
    expect(byKey.hysteresisMargin).toBe(0.05);
    expect(byKey.minDwellMs).toBe(90_000);
    // Spec §6: the window's current derived values, now held as dials.
    expect(byKey.axisNightEdgeDeg).toBe(-24);
    expect(byKey.axisDayEdgeDeg).toBe(-2);
  });

  it('carries no dial the v4 engine cannot act on', () => {
    // v3 has exactly one arrangement — fixed bands vertically, solar altitude
    // horizontally — so v2's strategy switches would be inert knobs on the
    // rail, and an inert knob is worse than a missing one.
    const dead = ['strategy', 'horizontalAnchor', 'rowAlign', 'geographicFidelity'];
    for (const key of dead) {
      expect(V4_SETTINGS_SCHEMA.find((k) => k.key === key)).toBeUndefined();
    }
  });
});

describe('configFromSettings', () => {
  it('round-trips the schema defaults into a full V4Config', () => {
    const cfg = configFromSettings(schemaDefaults(V4_SETTINGS_SCHEMA));
    expect(cfg.gateThreshold).toBe(0.55);
    expect(cfg.maxTiles).toBe(0);
    expect(cfg.bandCount).toBe(8);
    expect(cfg.axisDayEdgeDeg).toBe(-2);
  });

  it('carries dial changes through', () => {
    const cfg = configFromSettings({
      ...schemaDefaults(V4_SETTINGS_SCHEMA),
      axisDayEdgeDeg: -8,
      minDwellMs: 0,
      showCentreLine: true,
    });
    expect(cfg.axisDayEdgeDeg).toBe(-8);
    expect(cfg.minDwellMs).toBe(0);
    expect(cfg.showCentreLine).toBe(true);
  });

  it('maps every non-motion schema key into the engine config', () => {
    // The done-signal for the phase: no composition constant survives in
    // source. A knob the schema declares but configFromSettings forgets is a
    // dial that moves in the rail and changes nothing on the glass.
    const cfg = configFromSettings(
      schemaDefaults(V4_SETTINGS_SCHEMA)
    ) as unknown as Record<string, unknown>;
    const motionKeys = new Set([
      'motionMode', 'motionOrder', 'motionDurationMs', 'motionStaggerMs',
      'waveGridMs', 'crossfadeMs',
    ]);
    for (const knob of V4_SETTINGS_SCHEMA) {
      if (motionKeys.has(knob.key)) continue;
      expect(`${knob.key}=${String(cfg[knob.key])}`).toBe(`${knob.key}=${String(knob.default)}`);
    }
  });
});

describe('urlOverrides — any dial, from the query string', () => {
  const parse = (qs: string) => urlOverrides(new URLSearchParams(qs));

  it('reads a number dial', () => {
    expect(parse('bandCount=8&ceilingPx=240')).toEqual({ bandCount: 8, ceilingPx: 240 });
  });

  it('reads an enum dial as the raw string', () => {
    expect(parse('bandGrid=inset')).toEqual({ bandGrid: 'inset' });
  });

  it('reads booleans as 1/0 and true/false', () => {
    expect(parse('showCentreLine=1')).toEqual({ showCentreLine: true });
    expect(parse('showCentreLine=false')).toEqual({ showCentreLine: false });
  });

  it('ignores keys that are not dials, and non-numeric numbers', () => {
    expect(parse('v=v3&panel=dell&setup=1&bandCount=abc')).toEqual({});
  });

  it('leaves range and option validation to the sanitizer downstream', () => {
    // Out-of-range and unknown-option values are passed through here so one
    // sanitizer, the same one the settings store uses, is the single judge.
    expect(parse('bandCount=999&bandGrid=sideways')).toEqual({ bandCount: 999, bandGrid: 'sideways' });
  });
});
