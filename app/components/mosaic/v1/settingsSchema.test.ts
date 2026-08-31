import { describe, it, expect } from 'vitest';
import { V1_SETTINGS_SCHEMA, configFromSettings } from './settingsSchema';
import { schemaDefaults, mergeSettings } from '@/app/lib/settings/schema';
import { COMPOSITION_CONFIG } from './config';

describe('V1_SETTINGS_SCHEMA', () => {
  it('defaults match the frozen v1 COMPOSITION_CONFIG so dials start where code is', () => {
    const d = schemaDefaults(V1_SETTINGS_SCHEMA);
    expect(d.floorPx).toBe(COMPOSITION_CONFIG.floorPx);
    expect(d.ceilPx).toBe(COMPOSITION_CONFIG.ceilPx);
    expect(d.upscaleMax).toBe(COMPOSITION_CONFIG.upscaleMax);
    expect(d.maxGrowth).toBe(COMPOSITION_CONFIG.maxGrowth);
    expect(d.padding).toBe(COMPOSITION_CONFIG.padding);
    expect(d.cullOverflow).toBe(COMPOSITION_CONFIG.cullOverflow);
    expect(d.showModelReadout).toBe(false);
  });
});

describe('configFromSettings', () => {
  it('maps merged knob values onto CompositionConfig fields and nothing else', () => {
    const merged = mergeSettings(V1_SETTINGS_SCHEMA, { floorPx: 140, showModelReadout: true });
    const cfg = configFromSettings(merged);
    expect(cfg.floorPx).toBe(140);
    expect('showModelReadout' in cfg).toBe(false);
  });
  it('returns an empty partial when given nothing, deferring to code defaults', () => {
    expect(configFromSettings(undefined)).toEqual({});
  });
});
