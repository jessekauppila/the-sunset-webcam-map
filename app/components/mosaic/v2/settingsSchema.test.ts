import { describe, it, expect } from 'vitest';
import { V2_SETTINGS_SCHEMA, configFromSettings } from './settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

describe('V2_SETTINGS_SCHEMA', () => {
  it('has a knob for every composition decision', () => {
    const keys = V2_SETTINGS_SCHEMA.map((k) => k.key);
    for (const key of [
      'qualitySource', 'gateThreshold', 'failedCamPolicy', 'maxTiles',
      'floorPx', 'ceilingPx', 'curve',
      'strategy', 'bandCount', 'horizontalAnchor', 'rowAlign',
      'geographicFidelity', 'tileGapPx', 'latNorth', 'latSouth',
      'showFeedLabel', 'showTileRatings', 'showModelReadout',
      'motionMode', 'motionOrder', 'motionDurationMs', 'motionStaggerMs',
      'crossfadeMs', 'waveGridMs',
    ]) {
      expect(keys).toContain(key);
    }
  });

  it('has no duplicate keys', () => {
    const keys = V2_SETTINGS_SCHEMA.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('groups knobs into rail sections', () => {
    const sections = new Set(V2_SETTINGS_SCHEMA.map((k) => k.section));
    expect(sections).toEqual(
      new Set(['signal', 'visibility', 'sizing', 'arrangement', 'overlays', 'motion'])
    );
  });

  it('gives every number knob a range that contains its default', () => {
    for (const knob of V2_SETTINGS_SCHEMA) {
      if (knob.kind !== 'number') continue;
      expect(knob.default).toBeGreaterThanOrEqual(knob.min);
      expect(knob.default).toBeLessThanOrEqual(knob.max);
    }
  });

  it('gives every enum knob a default among its options', () => {
    for (const knob of V2_SETTINGS_SCHEMA) {
      if (knob.kind !== 'enum') continue;
      expect(knob.options).toContain(knob.default);
    }
  });

  it('describes every knob for the rail tooltip', () => {
    for (const knob of V2_SETTINGS_SCHEMA) {
      expect(knob.description.length).toBeGreaterThan(0);
      expect(knob.label.length).toBeGreaterThan(0);
    }
  });

  it('defaults gateThreshold to 0.55 on the probability scale', () => {
    const gate = V2_SETTINGS_SCHEMA.find((k) => k.key === 'gateThreshold')!;
    expect(gate.default).toBe(0.55);
    expect(gate.kind).toBe('number');
    if (gate.kind === 'number') {
      expect(gate.min).toBe(0);
      expect(gate.max).toBe(1);
    }
  });

  it('defaults to the decided arrangement', () => {
    const byKey = Object.fromEntries(V2_SETTINGS_SCHEMA.map((k) => [k.key, k.default]));
    expect(byKey.strategy).toBe('anchorRelax');
    expect(byKey.horizontalAnchor).toBe('solarAltitude');
    expect(byKey.failedCamPolicy).toBe('showAtFloor');
    expect(byKey.geographicFidelity).toBe(0.7);
    expect(byKey.floorPx).toBe(100);
    expect(byKey.ceilingPx).toBe(480);
  });
});

describe('configFromSettings', () => {
  it('round-trips the schema defaults into a full V2Config', () => {
    const cfg = configFromSettings(schemaDefaults(V2_SETTINGS_SCHEMA));
    expect(cfg.strategy).toBe('anchorRelax');
    expect(cfg.horizontalAnchor).toBe('solarAltitude');
    expect(cfg.gateThreshold).toBe(0.55);
    expect(cfg.maxTiles).toBe(0);
  });

  it('carries dial changes through', () => {
    const cfg = configFromSettings({
      ...schemaDefaults(V2_SETTINGS_SCHEMA),
      geographicFidelity: 1,
      rowAlign: 'justify',
    });
    expect(cfg.geographicFidelity).toBe(1);
    expect(cfg.rowAlign).toBe('justify');
  });
});
