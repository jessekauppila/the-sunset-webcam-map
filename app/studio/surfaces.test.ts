// app/studio/surfaces.test.ts
import { describe, it, expect } from 'vitest';
import { STUDIO_SURFACES, surfaceFor } from './surfaces';
import { MOSAIC_VERSIONS } from '@/app/components/mosaic/registry';
import { schemaFor } from '@/app/lib/settings/knownSchemas';
import { SOLO_VERSIONS } from '@/app/lib/solo/versions';

describe('STUDIO_SURFACES', () => {
  it('has one row per registered version, with that version\'s schema', () => {
    for (const name of Object.keys(MOSAIC_VERSIONS)) {
      const s = STUDIO_SURFACES[name];
      expect(s, name).toBeDefined();
      expect(s.name).toBe(name);
      expect(s.namespace).toBe(name);
      expect(s.schema).toBe(schemaFor(name));
    }
    expect(Object.keys(STUDIO_SURFACES).sort()).toEqual(Object.keys(MOSAIC_VERSIONS).sort());
  });
  it('solo versions carry their engine descriptor and the picture page; mosaic versions carry neither', () => {
    expect(STUDIO_SURFACES.solo).toMatchObject({ kind: 'solo', solo: SOLO_VERSIONS.solo, hasPicturePage: true });
    expect(STUDIO_SURFACES.solo2).toMatchObject({ kind: 'solo', solo: SOLO_VERSIONS.solo2, hasPicturePage: true });
    for (const v of ['v1', 'v2', 'v3', 'v4']) expect(STUDIO_SURFACES[v]).toMatchObject({ kind: 'mosaic', solo: null, hasPicturePage: false });
  });
  it('surfaceFor falls back to v1 like resolveMosaicName', () => {
    expect(surfaceFor('solo2').name).toBe('solo2');
    expect(surfaceFor('nope').name).toBe('v1');
    expect(surfaceFor(undefined).name).toBe('v1');
  });
});
