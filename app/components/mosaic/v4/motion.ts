/**
 * The motion layer: geometry only.
 *
 * `compose()` stays a pure function from tiles to a target layout. This module
 * holds the part that layout has never had — memory. Each tile keeps a track
 * keyed by webcamId, and a track's current pose chases its target pose over
 * time instead of snapping to it.
 *
 * Image crossfades live in the canvas, not here. A track knows where a tile is
 * and how opaque it is; which frame is drawn into it is the canvas's business.
 */

export type MotionMode = 'cut' | 'tween' | 'drift';
export type StaggerOrder = 'none' | 'latitude' | 'sweep' | 'magnitude';

export interface MotionConfig {
  mode: MotionMode;
  order: StaggerOrder;
  /** Tween travel time, or the drift time constant. */
  durationMs: number;
  /** Total spread between the first tile to move and the last. */
  staggerMs: number;
  /**
   * Sweep phase quantum. The two panels are separate pages that commit at
   * different moments, so a sweep starting at "now" would run twice, out of
   * step. Rounding the start up to a shared grid puts both panels on the same
   * wave without either knowing the other exists.
   */
  waveGridMs: number;
}

export interface MotionTarget {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lat: number;
}

export interface MotionFrame {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

interface Pose {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
}

interface Track {
  id: number;
  current: Pose;
  from: Pose;
  to: Pose;
  startAt: number;
  exiting: boolean;
}

export interface MotionState {
  tracks: Map<number, Track>;
}

export interface CommitContext {
  /** Panel width in CSS px, used to place a tile along the sweep. */
  panelWidth: number;
  /** 0 for the sunrise panel, 1 for the sunset panel. */
  panelSlot: 0 | 1;
}

/** A tile enters and leaves at this fraction of its full size. */
const ENTRY_INSET = 0.06;

export function createMotionState(): MotionState {
  return { tracks: new Map() };
}

function poseOf(t: MotionTarget, opacity: number): Pose {
  return { x: t.x, y: t.y, width: t.width, height: t.height, opacity };
}

function inset(p: Pose, opacity: number): Pose {
  return {
    x: p.x + p.width * ENTRY_INSET * 0.5,
    y: p.y + p.height * ENTRY_INSET * 0.5,
    width: p.width * (1 - ENTRY_INSET),
    height: p.height * (1 - ENTRY_INSET),
    opacity,
  };
}

/**
 * A delay weight in [0,1] per tile. 0 moves first, 1 moves last.
 *
 * `sweep` is the only ordering that says something true about the world: the
 * terminator really does travel across the wall, and the two panels really are
 * two ends of one line, so the key spans both panels rather than restarting on
 * each. `latitude` and `magnitude` are arbitrary by comparison — kept because
 * they are worth looking at, not because they mean anything.
 */
export function staggerKeys(
  targets: MotionTarget[],
  state: MotionState,
  order: StaggerOrder,
  ctx: CommitContext
): Map<number, number> {
  const keys = new Map<number, number>();
  if (targets.length === 0) return keys;

  if (order === 'none') {
    for (const t of targets) keys.set(t.id, 0);
    return keys;
  }

  if (order === 'latitude') {
    const lats = targets.map((t) => t.lat);
    const north = Math.max(...lats);
    const south = Math.min(...lats);
    const span = north - south;
    for (const t of targets) {
      keys.set(t.id, span === 0 ? 0 : (north - t.lat) / span);
    }
    return keys;
  }

  if (order === 'sweep') {
    for (const t of targets) {
      const local = ctx.panelWidth === 0 ? 0 : (t.x + t.width / 2) / ctx.panelWidth;
      const clamped = local < 0 ? 0 : local > 1 ? 1 : local;
      keys.set(t.id, (ctx.panelSlot + clamped) / 2);
    }
    return keys;
  }

  // magnitude: whichever tile has furthest to travel leads.
  let widest = 0;
  const deltas = new Map<number, number>();
  for (const t of targets) {
    const track = state.tracks.get(t.id);
    const d = track
      ? Math.hypot(t.x - track.current.x, t.y - track.current.y) +
        Math.abs(t.width - track.current.width)
      : Infinity;
    const finite = Number.isFinite(d) ? d : 0;
    deltas.set(t.id, finite);
    if (finite > widest) widest = finite;
  }
  for (const t of targets) {
    keys.set(t.id, widest === 0 ? 0 : 1 - (deltas.get(t.id) as number) / widest);
  }
  return keys;
}

/** Point every track at a new layout. Does not move anything; `sample` does. */
export function commit(
  state: MotionState,
  targets: MotionTarget[],
  cfg: MotionConfig,
  now: number,
  ctx: CommitContext
): void {
  const keys = staggerKeys(targets, state, cfg.order, ctx);
  const waveStart =
    cfg.order === 'sweep' && cfg.waveGridMs > 0
      ? Math.ceil(now / cfg.waveGridMs) * cfg.waveGridMs
      : now;

  const seen = new Set<number>();

  for (const t of targets) {
    seen.add(t.id);
    let track = state.tracks.get(t.id);
    if (!track) {
      const arrival = poseOf(t, 1);
      track = {
        id: t.id,
        current: inset(arrival, 0),
        from: inset(arrival, 0),
        to: arrival,
        startAt: waveStart,
        exiting: false,
      };
      state.tracks.set(t.id, track);
    }
    track.from = { ...track.current };
    track.to = poseOf(t, 1);
    track.startAt = waveStart + cfg.staggerMs * (keys.get(t.id) ?? 0);
    track.exiting = false;
  }

  for (const track of state.tracks.values()) {
    if (seen.has(track.id) || track.exiting) continue;
    track.from = { ...track.current };
    track.to = inset(track.current, 0);
    track.startAt = now;
    track.exiting = true;
  }
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Advance every track and return what to draw, nearest-to-settled first.
 * Exiting tracks are dropped once they have faded out.
 */
export function sample(
  state: MotionState,
  now: number,
  dtMs: number,
  cfg: MotionConfig
): MotionFrame[] {
  const frames: MotionFrame[] = [];
  const finished: number[] = [];

  for (const track of state.tracks.values()) {
    const { from, to, current } = track;

    if (cfg.mode === 'cut') {
      Object.assign(current, to);
    } else if (cfg.mode === 'drift' && !track.exiting) {
      // Exponential chase: reaches 99.9% of the way in durationMs. A long time
      // constant turns the 60s poll steps into movement too slow to catch.
      const tau = Math.max(16, cfg.durationMs);
      const k = 1 - Math.pow(0.001, Math.max(0, dtMs) / tau);
      current.x = lerp(current.x, to.x, k);
      current.y = lerp(current.y, to.y, k);
      current.width = lerp(current.width, to.width, k);
      current.height = lerp(current.height, to.height, k);
      current.opacity = lerp(current.opacity, to.opacity, k);
    } else {
      const span = Math.max(1, cfg.durationMs);
      const raw = (now - track.startAt) / span;
      const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      const e = easeInOutCubic(p);
      current.x = lerp(from.x, to.x, e);
      current.y = lerp(from.y, to.y, e);
      current.width = lerp(from.width, to.width, e);
      current.height = lerp(from.height, to.height, e);
      current.opacity = lerp(from.opacity, to.opacity, e);
    }

    if (track.exiting && current.opacity < 0.02) {
      finished.push(track.id);
      continue;
    }

    frames.push({
      id: track.id,
      x: current.x,
      y: current.y,
      width: current.width,
      height: current.height,
      opacity: current.opacity,
    });
  }

  for (const id of finished) state.tracks.delete(id);
  return frames;
}

/** True while any track still has somewhere to be. */
export function isSettled(state: MotionState, cfg: MotionConfig, now: number): boolean {
  // cut lands on the target the moment it is sampled, so one draw is always
  // enough — which is what keeps the render loop parked on a still wall.
  if (cfg.mode === 'cut') return true;
  for (const track of state.tracks.values()) {
    if (cfg.mode === 'drift') {
      const { current, to } = track;
      if (
        Math.abs(current.x - to.x) > 0.25 ||
        Math.abs(current.y - to.y) > 0.25 ||
        Math.abs(current.width - to.width) > 0.25 ||
        Math.abs(current.opacity - to.opacity) > 0.01
      ) {
        return false;
      }
    } else if (now < track.startAt + cfg.durationMs) {
      return false;
    }
  }
  return true;
}
