import type { BandGrid, Layout } from '../engine/types';

/**
 * Installer aid: per-tile coordinates plus a composition health footer.
 *
 * Four different ways a camera can be missing, four numbers. `evicted` lost a
 * fight for its space to a better-scoring neighbour and is working as
 * designed; `dropped` means the composition could not fit even at the scale
 * floor and is the one that says the wall is struggling. Conflating them
 * would make an ordinary crowded band read as an overflow emergency.
 * `held` is a camera that went missing this cycle and is being carried on
 * its last frame; it is on the wall, but not live.
 */
export function SetupOverlay({
  layout,
  feed,
  skipped,
  held = 0,
  bandCount,
  bandGrid,
}: {
  layout: Layout;
  feed: 'sunrise' | 'sunset';
  skipped: number;
  held?: number;
  bandCount?: number;
  bandGrid?: BandGrid;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {layout.tiles.map((tile) => (
        <div
          key={tile.id}
          style={{
            position: 'absolute',
            left: tile.x,
            top: tile.y + tile.height,
            transform: 'translateY(2px)',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: 11,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            textShadow: '0 1px 2px rgba(0,0,0,.9)',
          }}
        >
          {tile.lat.toFixed(1)}, {tile.lng.toFixed(1)}
          {tile.sunAltitudeDeg !== null && ` · ${tile.sunAltitudeDeg.toFixed(1)}°`}
        </div>
      ))}
      <div
        data-testid="v4-setup-counts"
        style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          color: '#fff',
          fontFamily: 'monospace',
          fontSize: 12,
          textShadow: '0 1px 2px rgba(0,0,0,.9)',
        }}
      >
        {feed} · tiles {layout.tiles.length} · evicted {layout.evicted.length} ·
        dropped {layout.dropped.length} · skipped {skipped} · held {held} ·
        scale {layout.scale.toFixed(2)}
        {bandGrid !== undefined && ` · bands ${bandCount ?? '?'} ${bandGrid}`}
      </div>
    </div>
  );
}
