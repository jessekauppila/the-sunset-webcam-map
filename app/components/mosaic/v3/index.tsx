'use client';

import { useEffect, useMemo, useRef } from 'react';
import { mergeSettings } from '@/app/lib/settings/schema';
import type { MosaicProps } from '../types';
import { compose } from './engine/compose';
import { MosaicCanvas } from './MosaicCanvas';
import { FeedLabel } from './overlays/FeedLabel';
import { ModelReadout } from './overlays/ModelReadout';
import { CentreLine } from './overlays/CentreLine';
import { SetupOverlay } from './overlays/SetupOverlay';
import { TileRatings } from './overlays/TileRatings';
import {
  V3_SETTINGS_SCHEMA, configFromSettings, motionFromSettings, urlOverrides,
} from './settingsSchema';
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
  allowDebugOverlays = true,
  onSelect,
  search = '',
  settings,
  at,
}: MosaicProps) {
  const { cfg, motion, crossfadeMs, modelsMode } = useMemo(() => {
    const params = new URLSearchParams(search);
    // URL param, then profile setting, then code default. Any dial can be
    // named in the query string, so two geometries can sit side by side in
    // two windows instead of being compared from memory across a dial flip.
    const merged = mergeSettings(V3_SETTINGS_SCHEMA, settings, urlOverrides(params));
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

  // Hysteresis needs memory across compositions, and `compose` is pure, so
  // the memory lives here: webcamId -> the clock reading at which the tile
  // was first admitted (spec §5.4).
  //
  // Read during the memo, written only in the effect below. Nothing here
  // re-triggers the memo, so there is no loop, and the dwell clock advances
  // exactly when a new composition is computed — which is the only moment an
  // eviction decision is ever made.
  const admittedSinceRef = useRef(new Map<number, number>());

  const layout = useMemo(
    () =>
      compose(tiles, { width, height }, cfg, feed, peerTiles, {
        admittedSince: admittedSinceRef.current,
        now: Date.now(),
      }),
    [tiles, peerTiles, width, height, cfg, feed]
  );

  useEffect(() => {
    const now = Date.now();
    const live = new Set(layout.tiles.map((t) => t.id));
    // Stamp arrivals; forget anything no longer drawn, so a tile that leaves
    // and comes back competes as a challenger rather than as an incumbent.
    for (const id of live) {
      if (!admittedSinceRef.current.has(id)) admittedSinceRef.current.set(id, now);
    }
    for (const id of [...admittedSinceRef.current.keys()]) {
      if (!live.has(id)) admittedSinceRef.current.delete(id);
    }
  }, [layout]);

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
      {allowDebugOverlays && cfg.showCentreLine && (
        <CentreLine cfg={cfg} feed={feed} width={width} height={height} />
      )}
      {setupMode && (
        <SetupOverlay
          layout={layout}
          feed={feed}
          skipped={skipped}
          bandCount={cfg.bandCount}
          bandGrid={cfg.bandGrid}
        />
      )}
    </div>
  );
}
