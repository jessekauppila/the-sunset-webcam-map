import type { Layout } from '../engine/types';

/** Installer aid: per-tile coordinates plus a composition health footer. */
export function SetupOverlay({
  layout,
  feed,
  skipped,
}: {
  layout: Layout;
  feed: 'sunrise' | 'sunset';
  skipped: number;
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
        data-testid="v3-setup-counts"
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
        {feed} · tiles {layout.tiles.length} · dropped {layout.dropped.length} ·
        skipped {skipped} · scale {layout.scale.toFixed(2)}
      </div>
    </div>
  );
}
