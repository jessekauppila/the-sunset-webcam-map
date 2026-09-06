import { describe, it, expect } from 'vitest';
import { SHARED_SCHEMA, SHARED_NAMESPACE } from './sharedSchema';
import { schemaDefaults } from './schema';
import { DEFAULT_MOSAIC_VERSION } from '@/app/components/mosaic/registry';
import { CAPTION_SCHEMA } from '@/app/lib/solo/captionSchema';

describe('SHARED_SCHEMA', () => {
  it('activeVersion defaults to the registry pin so an empty DB changes nothing', () => {
    expect(schemaDefaults(SHARED_SCHEMA).activeVersion).toBe(DEFAULT_MOSAIC_VERSION);
  });
  it('panelPreset options are the named panelPreview presets, both orientations', () => {
    const knob = SHARED_SCHEMA.find((k) => k.key === 'panelPreset');
    expect(knob?.kind).toBe('enum');
    expect(knob && 'options' in knob ? [...knob.options] : []).toEqual(['dell', 'ktc', 'dell-l', 'ktc-l']);
  });
  it('carries every caption knob, so one caption serves every solo version', () => {
    for (const k of CAPTION_SCHEMA) expect(SHARED_SCHEMA.find((x) => x.key === k.key)).toBe(k);
    const keys = SHARED_SCHEMA.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('exports the namespace constant used by storage rows', () => {
    expect(SHARED_NAMESPACE).toBe('shared');
  });
});
