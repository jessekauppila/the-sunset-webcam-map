'use client';

import { useMemo } from 'react';
import type { MosaicProps } from '../types';
import { GeoMosaic } from './GeoMosaic';
import { parseCompositionOverrides } from './compositionOverrides';

/**
 * v1 — the geographic composition engine shipped in PR #76 (percentile
 * sizing, greedy N→S/W→E rows, latitude-gap space distribution, cull-vs-
 * compress overflow). FROZEN as the reference version; new composition
 * ideas go in a new version folder, not here.
 */
export function MosaicV1({ search = '', ...rest }: MosaicProps) {
  const overrides = useMemo(
    () => parseCompositionOverrides(new URLSearchParams(search)),
    [search]
  );
  return <GeoMosaic {...rest} config={overrides} />;
}
