import type { WindyWebcam } from '@/app/lib/types';
import { explainSignal, type QualitySource } from '../qualitySignal';
import type { Layout } from '../engine/types';

/**
 * Per-tile troubleshooting readout: what the tile scored, whether it passed
 * the gate, and which judge decided. The judge matters more than it looks —
 * the gate threshold acts on model-scored frames only, so a feed running on
 * Claude's verdict will not react to the dial at all, and this is where that
 * shows up instead of looking like a composition bug.
 *
 * Sized by `scale` rather than a fixed 10px, because the panels are read at
 * arm's length on 1440x2560 glass, not in a browser tab.
 */
export function TileRatings({
  layout,
  byId,
  qualitySource,
  gateThreshold,
  scale = 1,
}: {
  layout: Layout;
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
  qualitySource: QualitySource;
  gateThreshold: number;
  scale?: number;
}) {
  const font = 10 * scale;
  const pad = Math.max(2, 2 * scale);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {layout.tiles.map((tile) => {
        const entry = byId.get(tile.id);
        if (!entry) return null;
        const s = explainSignal(entry.webcam, qualitySource, gateThreshold);
        // The gate margin is only meaningful when the gate had something to
        // compare. For llm and unscored frames the dial is inert, and saying
        // so beats printing a number that never moves.
        const gateLine =
          s.gateInput !== null && s.gateValue !== null
            ? `${s.gateInput.toFixed(2)} / ${s.gateValue.toFixed(2)}`
            : s.judge === 'llm'
              ? 'gate n/a'
              : 'unscored';

        return (
          <div
            key={tile.id}
            data-testid="v4-rating-chip"
            data-passes={String(tile.passes)}
            data-judge={s.judge}
            style={{
              position: 'absolute',
              left: tile.x + pad,
              top: tile.y + pad,
              maxWidth: Math.max(0, tile.width - pad * 2),
              overflow: 'hidden',
              // A solid ground, not a text shadow: these sit on bright sky.
              background: 'rgba(0,0,0,.72)',
              borderLeft: `${Math.max(2, scale * 2)}px solid ${
                tile.passes ? '#4cc38a' : '#7a8393'
              }`,
              borderRadius: 2,
              padding: `${pad}px ${pad * 2}px`,
              color: tile.passes ? '#7ee2ac' : '#c3cad6',
              fontFamily: 'monospace',
              fontSize: font,
              lineHeight: 1.3,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            <div>
              {tile.score === null ? '—' : tile.score.toFixed(2)}
              {tile.passes ? ' ✓' : ' ✗'}
            </div>
            <div style={{ opacity: 0.75, fontWeight: 400 }}>
              {s.judge} {gateLine}
            </div>
          </div>
        );
      })}
    </div>
  );
}
