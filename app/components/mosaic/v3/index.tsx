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
import { V3_SETTINGS_SCHEMA, configFromSettings, motionFromSettings } from './settingsSchema';
import { useLoadedTiles } from './useLoadedTiles';

/** Stable identity: a fresh [] each render would re-run the loader effect. */
const NO_PEERS: NonNullable<MosaicProps['peerWebcams']> = [];

/**
 * v3 — the band paradigm: fixed latitude bands, absolute placement, entirely
 * schema-driven. Precedence, as everywhere: URL param, then profile setting,
 * then code default.
 */
export function MosaicV3({
  webcams,
  width,
  height,
  feed,
  peerWebcams = NO_PEERS,
  setupMode = false,
  onSelect,
  search = '',
  settings,
  at,
}: MosaicProps) {
  const { cfg, motion, crossfadeMs, modelsMode } = useMemo(() => {
    const params = new URLSearchParams(search);
    const merged = mergeSettings(V3_SETTINGS_SCHEMA, settings);
    return {
      cfg: configFromSettings(merged),
      ...motionFromSettings(merged),
      modelsMode: params.has('models')
        ? params.get('models') === '1'
        : merged.showModelReadout === true,
    };
  }, [search, settings]);

  const signal = { qualitySource: cfg.qualitySource, gateThreshold: cfg.gateThreshold, at };
  const { tiles, byId, skipped } = useLoadedTiles(webcams, signal);
  // Loaded, never drawn: the peer pool exists only so both panels can settle
  // on one overflow scale. Its images cost a fetch each, but they are the
  // same frames the twin screen is already loading.
  const { tiles: peerTiles } = useLoadedTiles(peerWebcams, signal);

  const layout = useMemo(
    () => compose(tiles, { width, height }, cfg, feed, peerTiles),
    [tiles, peerTiles, width, height, cfg, feed]
  );

  return (
    <div style={{ position: 'relative', width, height, background: '#000' }}>
      <MosaicCanvas
        layout={layout}
        byId={byId}
        width={width}
        height={height}
        motion={motion}
        crossfadeMs={crossfadeMs}
        panelSlot={feed === 'sunrise' ? 0 : 1}
        onSelect={onSelect}
      />
      {cfg.showFeedLabel && <FeedLabel feed={feed} />}
      {cfg.showTileRatings && (
        <TileRatings
          layout={layout}
          byId={byId}
          qualitySource={cfg.qualitySource}
          gateThreshold={cfg.gateThreshold}
          scale={cfg.overlayScale}
        />
      )}
      {modelsMode && (
        <ModelReadout layout={layout} byId={byId} scale={cfg.overlayScale} />
      )}
      {setupMode && <SetupOverlay layout={layout} feed={feed} skipped={skipped} />}
    </div>
  );
}
