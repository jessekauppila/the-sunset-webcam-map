'use client';

import { useMemo } from 'react';
import { mergeSettings } from '@/app/lib/settings/schema';
import type { MosaicProps } from '../types';
import { compose } from './engine/compose';
import { MosaicCanvas } from './MosaicCanvas';
import { FeedLabel } from './overlays/FeedLabel';
import { ModelReadout } from './overlays/ModelReadout';
import { SetupOverlay } from './overlays/SetupOverlay';
import { TileRatings } from './overlays/TileRatings';
import { V2_SETTINGS_SCHEMA, configFromSettings } from './settingsSchema';
import { useLoadedTiles } from './useLoadedTiles';

/**
 * v2 — latitude anchoring plus depth-into-twilight arrangement, entirely
 * schema-driven. Precedence, as everywhere: URL param, then profile setting,
 * then code default.
 */
export function MosaicV2({
  webcams,
  width,
  height,
  feed,
  setupMode = false,
  onSelect,
  search = '',
  settings,
  at,
}: MosaicProps) {
  const { cfg, modelsMode } = useMemo(() => {
    const params = new URLSearchParams(search);
    const merged = mergeSettings(V2_SETTINGS_SCHEMA, settings);
    return {
      cfg: configFromSettings(merged),
      modelsMode: params.has('models')
        ? params.get('models') === '1'
        : merged.showModelReadout === true,
    };
  }, [search, settings]);

  const { tiles, byId, skipped } = useLoadedTiles(webcams, {
    qualitySource: cfg.qualitySource,
    gateThreshold: cfg.gateThreshold,
    at,
  });

  const layout = useMemo(
    () => compose(tiles, { width, height }, cfg, feed),
    [tiles, width, height, cfg, feed]
  );

  return (
    <div style={{ position: 'relative', width, height, background: '#000' }}>
      <MosaicCanvas
        layout={layout}
        byId={byId}
        width={width}
        height={height}
        onSelect={onSelect}
      />
      {cfg.showFeedLabel && <FeedLabel feed={feed} />}
      {cfg.showTileRatings && <TileRatings layout={layout} byId={byId} />}
      {modelsMode && <ModelReadout layout={layout} byId={byId} />}
      {setupMode && <SetupOverlay layout={layout} feed={feed} skipped={skipped} />}
    </div>
  );
}
