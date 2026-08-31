'use client';

import { useMemo } from 'react';
import type { MosaicProps } from '../types';
import { GeoMosaic } from './GeoMosaic';
import { parseCompositionOverrides } from './compositionOverrides';
import { V1_SETTINGS_SCHEMA, configFromSettings } from './settingsSchema';
import { mergeSettings } from '@/app/lib/settings/schema';

/**
 * v1 — the geographic composition engine shipped in PR #76 (percentile
 * sizing, greedy N→S/W→E rows, latitude-gap space distribution, cull-vs-
 * compress overflow). FROZEN as the reference version; new composition
 * ideas go in a new version folder, not here.
 *
 * Precedence: URL params (parseCompositionOverrides, ?models=) beat profile
 * settings, which beat code defaults. Profile settings arrive as a raw
 * deviation record and are merged against V1_SETTINGS_SCHEMA before use.
 */
export function MosaicV1({ search = '', settings, ...rest }: MosaicProps) {
  const { overrides, modelsMode } = useMemo(() => {
    const params = new URLSearchParams(search);
    const merged = mergeSettings(V1_SETTINGS_SCHEMA, settings);
    return {
      overrides: {
        ...configFromSettings(merged),
        ...parseCompositionOverrides(params), // URL keeps the last word
      },
      // ?models=1/0 — per-tile model-judgment chips; explicit URL param
      // beats the profile's showModelReadout knob.
      modelsMode: params.has('models')
        ? params.get('models') === '1'
        : merged.showModelReadout === true,
    };
  }, [search, settings]);
  return <GeoMosaic {...rest} config={overrides} modelsMode={modelsMode} />;
}
