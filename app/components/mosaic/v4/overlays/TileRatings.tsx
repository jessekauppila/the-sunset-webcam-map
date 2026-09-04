import type { WindyWebcam } from '@/app/lib/types';
import { explainSignal } from '../qualitySignal';
import { exitEdgeDeg } from '../engine/axis';
import { exitTaper, normalizeScore } from '../engine/sizing';
import type { Layout, PlacedTile, V4Config } from '../engine/types';

/**
 * Why a tile is not at the height its quality alone would give it. Null when
 * it is, which is the common case and needs no line. The rules mirror
 * `sizeTiles` exactly; a reason here that the engine does not apply is a bug.
 */
export function sizeReason(
  tile: Pick<PlacedTile, 'passes' | 'score' | 'sunAltitudeDeg'>,
  cfg: V4Config,
  feed: 'sunrise' | 'sunset'
): string | null {
  if (tile.score === null) return null; // "unscored" is already the whole story
  if (!tile.passes) return 'floor · failed gate';
  if (cfg.curve === 'percentileAmongPassers') return null; // ranked, not absolute
  if (normalizeScore(tile.score, cfg) <= 0) {
    return `floor · quality ≤ ${cfg.scoreFloor.toFixed(2)}`;
  }
  const taper = exitTaper(tile.sunAltitudeDeg, cfg, feed);
  if (taper <= 0) {
    return `floor · past ${feed === 'sunset' ? 'night' : 'day'} edge (${exitEdgeDeg(cfg, feed)}°)`;
  }
  if (taper < 1) return `exit taper ×${taper.toFixed(2)}`;
  return null;
}

/**
 * Per-tile troubleshooting readout. Every number is named, because the two
 * heads are on different scales and the one that sizes the tile is not the
 * one that looks like a score: quality is [0,1] and drives height, detection
 * is printed on the 1-5 rating scale against the gate and only decides
 * pass/fail. Unlabelled, the detection figure got read as "the score", and a
 * quality-0.52 tile beside a quality-0.04 one read as a sizing bug.
 *
 * The judge matters more than it looks — the gate threshold acts on
 * model-scored frames only, so a feed running on Claude's verdict will not
 * react to the dial at all, and this is where that shows up instead of
 * looking like a composition bug.
 *
 * Sized by `scale` rather than a fixed 10px, because the panels are read at
 * arm's length on 1440x2560 glass, not in a browser tab.
 */
export function TileRatings({
  layout,
  byId,
  cfg,
  feed,
  scale = 1,
}: {
  layout: Layout;
  byId: Map<number, { img: HTMLImageElement; webcam: WindyWebcam }>;
  cfg: V4Config;
  feed: 'sunrise' | 'sunset';
  scale?: number;
}) {
  const font = 10 * scale;
  const pad = Math.max(2, 2 * scale);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {layout.tiles.map((tile) => {
        const entry = byId.get(tile.id);
        if (!entry) return null;
        const s = explainSignal(entry.webcam, cfg.qualitySource, cfg.gateThreshold);

        // Line 1: the number the engine sizes with, named for its judge.
        const scoreName = s.judge === 'llm' ? 'claude' : 'quality';
        const scoreLine =
          tile.score === null
            ? 'unscored'
            : `${scoreName} ${tile.score.toFixed(2)} ${tile.passes ? '✓' : '✗'} · ${Math.round(tile.height)}px`;

        // Line 2: what the gate compared. Only meaningful when it had
        // something to compare; for llm frames the dial is inert, and saying
        // so beats printing a number that never moves.
        let gateLine: string;
        if (s.gateInput !== null && s.gateValue !== null) {
          const op = s.gateInput >= s.gateValue ? '≥' : '<';
          gateLine = `detect ${s.gateInput.toFixed(2)} ${op} gate ${s.gateValue.toFixed(2)}`;
        } else if (s.judge === 'llm') {
          gateLine = `claude says ${s.passes ? 'sunset' : 'not sunset'} · gate n/a`;
        } else {
          gateLine = 'no judge';
        }

        // Line 3: only when the height is not the quality's own.
        const reason = sizeReason(tile, cfg, feed);

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
            <div>{scoreLine}</div>
            {tile.score !== null && (
              <div style={{ opacity: 0.75, fontWeight: 400 }}>{gateLine}</div>
            )}
            {reason && (
              <div style={{ opacity: 0.75, fontWeight: 400, color: '#f5a344' }}>{reason}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
