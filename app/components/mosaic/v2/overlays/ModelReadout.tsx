import type { WindyWebcam } from '@/app/lib/types';
import { detectionReadout, qualityReadout } from '@/app/lib/modelReadout';
import type { Layout } from '../engine/types';

/** What each head said, per tile. Read-only decoration over the layout. */
export function ModelReadout({
  layout,
  byId,
}: {
  layout: Layout;
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
}) {
  return (
    <div
      data-testid="v2-model-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {layout.tiles.map((tile) => {
        const entry = byId.get(tile.id);
        if (!entry) return null;
        const detection = detectionReadout(entry.webcam);
        const quality = qualityReadout(entry.webcam);
        return (
          <div
            key={tile.id}
            data-testid="v2-model-chip"
            style={{
              position: 'absolute',
              left: tile.x + 3,
              top: tile.y + tile.height - 3,
              transform: 'translateY(-100%)',
              maxWidth: Math.max(0, tile.width - 6),
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: 10,
              lineHeight: 1.35,
              textShadow: '0 1px 2px rgba(0,0,0,.9)',
            }}
          >
            {!detection && quality === null ? (
              <div>not scored</div>
            ) : (
              <>
                <div>
                  {detection
                    ? `${detection.verdict} ${detection.probability.toFixed(2)}`
                    : '—'}
                </div>
                <div>{quality === null ? '—' : quality.toFixed(1)}</div>
              </>
            )}
            {tile.pinnedToFloor && <div>floored</div>}
          </div>
        );
      })}
    </div>
  );
}
