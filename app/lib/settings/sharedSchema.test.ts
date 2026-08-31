import { describe, it, expect } from 'vitest';
import { SHARED_SCHEMA, SHARED_NAMESPACE } from './sharedSchema';
import { schemaDefaults } from './schema';
import { DEFAULT_MOSAIC_VERSION } from '@/app/components/mosaic/registry';

describe('SHARED_SCHEMA', () => {
  it('activeVersion defaults to the registry pin so an empty DB changes nothing', () => {
    expect(schemaDefaults(SHARED_SCHEMA).activeVersion).toBe(DEFAULT_MOSAIC_VERSION);
  });
  it('panelPreset options are the named panelPreview presets', () => {
    const knob = SHARED_SCHEMA.find((k) => k.key === 'panelPreset');
    expect(knob?.kind).toBe('enum');
    expect(knob && 'options' in knob ? [...knob.options] : []).toEqual(['dell', 'ktc']);
  });
  it('exports the namespace constant used by storage rows', () => {
    expect(SHARED_NAMESPACE).toBe('shared');
  });
});
