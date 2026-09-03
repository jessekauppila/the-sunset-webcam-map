import { TERMINATOR_SUN_ALTITUDE_DEG } from '@/app/lib/masterConfig';
import { altitudeToUnit, type AxisConfig } from '../engine/axis';

/**
 * The terminator zone made visible.
 *
 * Screen centre is the POOL's ring at TERMINATOR_SUN_ALTITUDE_DEG, not the
 * geometric terminator at 0 degrees — zero is outside the window today and
 * clamps (spec §3). The line is drawn where `tileX` puts a tile's centre for
 * that altitude, so it marks a real position rather than an approximate one.
 *
 * It follows the axis dials: narrowing the window moves the ring off the
 * middle of the glass, and a line hard-coded at 50% would then lie.
 */
export function CentreLine({
  cfg,
  feed,
  width,
  height,
}: {
  cfg: AxisConfig;
  feed: 'sunrise' | 'sunset';
  width: number;
  height: number;
}) {
  const left = altitudeToUnit(TERMINATOR_SUN_ALTITUDE_DEG, cfg, feed) * width;
  return (
    <div
      data-testid="v3-centre-line"
      style={{
        position: 'absolute',
        left,
        top: 0,
        height,
        width: 1,
        background: 'rgba(255,255,255,0.35)',
        pointerEvents: 'none',
        color: 'rgba(255,255,255,0.6)',
        fontFamily: 'monospace',
        fontSize: 11,
      }}
    >
      <span style={{ position: 'absolute', top: 6, left: 6, whiteSpace: 'nowrap' }}>
        {TERMINATOR_SUN_ALTITUDE_DEG}°
      </span>
    </div>
  );
}
