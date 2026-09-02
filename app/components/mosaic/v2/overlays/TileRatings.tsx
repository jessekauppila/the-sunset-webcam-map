import type { WindyWebcam } from '@/app/lib/types';
import type { Layout } from '../engine/types';

/** Per-tile score chip: the normalized quality and whether the gate passed. */
export function TileRatings({
  layout,
  byId,
}: {
  layout: Layout;
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {layout.tiles.map((tile) => {
        if (!byId.has(tile.id)) return null;
        return (
          <div
            key={tile.id}
            data-testid="v2-rating-chip"
            data-passes={String(tile.passes)}
            style={{
              position: 'absolute',
              left: tile.x + 3,
              top: tile.y + 3,
              maxWidth: Math.max(0, tile.width - 6),
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              color: tile.passes ? '#4cc38a' : '#9aa3b2',
              fontFamily: 'monospace',
              fontSize: 10,
              textShadow: '0 1px 2px rgba(0,0,0,.9)',
            }}
          >
            {tile.score === null ? '—' : tile.score.toFixed(2)}
            {tile.passes ? ' ✓' : ''}
          </div>
        );
      })}
    </div>
  );
}
