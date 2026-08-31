import type { WindyWebcam } from '@/app/lib/types';
import { detectionReadout, qualityReadout } from '@/app/lib/modelReadout';
import type { Layout } from './engine/types';

/**
 * Per-tile model-judgment chips (?models=1): what the detection head said
 * (verdict + probability) and what the quality head rated. Read-only
 * decoration over the composed layout — sizing already happened in the
 * engine; a "gated" annotation marks tiles the detection gate floored to
 * minimal. Same contract as SetupOverlay: absolutely positioned within a
 * position:relative parent, never intercepts pointer events.
 */
export function ModelInfoOverlay({
  layout,
  byId,
}: {
  layout: Layout;
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {layout.tiles.map((tile) => {
        const entry = byId.get(tile.id);
        if (!entry) return null;
        return (
          <div
            key={tile.id}
            data-testid="model-chip"
            style={{
              position: 'absolute',
              left: tile.x + 3,
              top: tile.y + tile.height - 3,
              transform: 'translateY(-100%)',
              maxWidth: tile.width - 6,
              overflow: 'hidden',
              color: '#fff',
              fontFamily: 'monospace',
              fontSize: 10,
              lineHeight: 1.35,
              whiteSpace: 'nowrap',
              padding: '1px 4px',
              borderRadius: 3,
              background: 'rgba(0,0,0,0.55)',
            }}
          >
            <ChipText webcam={entry.webcam} />
          </div>
        );
      })}
    </div>
  );
}

function ChipText({ webcam }: { webcam: WindyWebcam }) {
  const detection = detectionReadout(webcam);
  const quality = qualityReadout(webcam);

  if (!detection && quality === null) {
    return <div style={{ opacity: 0.6 }}>not scored</div>;
  }

  const gated = detection?.verdict === 'not a sunset';

  return (
    <>
      {detection && (
        <div style={{ opacity: gated ? 0.6 : 1 }}>
          {`${detection.verdict} · ${Math.round(detection.probability * 100)}%`}
        </div>
      )}
      {quality !== null && (
        <div style={{ opacity: gated ? 0.6 : 1 }}>
          {`${quality.toFixed(1)}/5${gated ? ' · gated' : ''}`}
        </div>
      )}
    </>
  );
}
