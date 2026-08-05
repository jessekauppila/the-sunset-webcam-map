import type { Layout } from './engine/types';

/**
 * Pure presentational installer-aid overlay: per-tile lat/lng + percentile
 * captions, a big feed label, an orientation arrow, and a tile/dropped/
 * skipped counter. Absolutely positioned; the parent must be
 * position:relative. Never intercepts pointer events.
 */
export function SetupOverlay({
  layout,
  feed,
  skipped,
}: {
  layout: Layout;
  feed: 'sunrise' | 'sunset';
  skipped: number;
}) {
  const feedLabel = feed === 'sunrise' ? 'SUNRISE' : 'SUNSET';

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    >
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
            textShadow: '0 1px 2px rgba(0,0,0,0.85)',
          }}
        >
          {`${tile.lat.toFixed(1)}°, ${tile.lng.toFixed(1)}° p${Math.round(
            tile.percentile * 100
          )}`}
        </div>
      ))}

      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          color: '#fff',
          fontSize: 48,
          fontWeight: 700,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          textShadow: '0 2px 8px rgba(0,0,0,0.85)',
        }}
      >
        {feedLabel}
      </div>

      <div
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          textAlign: 'center',
          color: '#fff',
          textShadow: '0 1px 4px rgba(0,0,0,0.85)',
        }}
      >
        <div style={{ fontSize: 32, lineHeight: 1 }}>⇧</div>
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.1em' }}>
          THIS WAY UP
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          color: '#fff',
          fontFamily: 'monospace',
          fontSize: 13,
          textShadow: '0 1px 2px rgba(0,0,0,0.85)',
        }}
      >
        {`${layout.tiles.length} tiles · ${layout.dropped.length} dropped · ${skipped} skipped`}
      </div>
    </div>
  );
}
