/**
 * The motion layer: geometry only.
 *
 * `compose()` stays a pure function from tiles to a target layout. This module
 * holds the part that layout has never had — memory. Each tile keeps a track
 * keyed by webcamId, and a track's current pose chases its target pose over
 * time instead of snapping to it.
 *
 * v4 adds three things on top of v3 (spec §6, §7):
 *   - every change waits its own delay, `key × spreadMs`, so the 60s poll has
 *     no signature; a retarget is held as `pending` until then, which is what
 *     makes stagger real in drift mode (v3's drift ignored startAt);
 *   - entries and exits are fades with their own duration and scale, and an
 *     exit is a tween in every mode;
 *   - under `fadeThrough`, an entry waits for any departing tile it would
 *     overlap, so two cameras' pixels are never drawn over each other.
 *
 * Image crossfades live in the canvas, not here. A track knows where a tile is
 * and how opaque it is; which frame is drawn into it is the canvas's business.
 */

export type MotionMode = 'cut' | 'tween' | 'drift';
export type StaggerOrder = 'none' | 'scatter' | 'latitude' | 'sweep' | 'magnitude';
export type TransitionStyle = 'fadeThrough' | 'dissolve';

export interface MotionConfig {
  mode: MotionMode;
  order: StaggerOrder;
  /** Travel time of a retarget, or the drift time constant. */
  durationMs: number;
  /** Spread between the first change to start and the last: delay = key × spread. */
  spreadMs: number;
  /**
   * Sweep phase quantum. The two panels are separate pages that commit at
   * different moments. Rounding the start up to a shared grid puts both on
   * the same wave without either knowing the other exists. Sweep only.
   */
  waveGridMs: number;
  /** fadeThrough: an entry waits for the departures it would overlap. */
  transition: TransitionStyle;
  /** Duration of an entry or exit fade. */
  fadeMs: number;
  /** A tile enters from, and exits to, this fraction of its size about its centre. */
  fadeScale: number;
  /** The composition's tile gap; counted as overlap for the fade-through test. */
  gapPx: number;
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

type Phase = 'enter' | 'travel' | 'exit';

interface Track {
  id: number;
  lat: number;
  current: Pose;
  from: Pose;
  to: Pose;
  startAt: number;
  phase: Phase;
  /** A retarget waiting for its scheduled moment. */
  pending: { to: Pose; startAt: number } | null;
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

export function createMotionState(): MotionState {
  return { tracks: new Map() };
}

function poseOf(t: MotionTarget, opacity: number): Pose {
  return { x: t.x, y: t.y, width: t.width, height: t.height, opacity };
}

/** The pose scaled by k about its own centre. */
function scaled(p: Pose, k: number, opacity: number): Pose {
  const width = p.width * k;
  const height = p.height * k;
  return {
    x: p.x + (p.width - width) / 2,
    y: p.y + (p.height - height) / 2,
    width,
    height,
    opacity,
  };
}

/**
 * A stable phase in [0,1) for a webcam id. The same camera changes at the
 * same point in the minute on every refetch, every reload, and both panels.
 * An integer mix (murmur3's finaliser) rather than `id % n`, because ids
 * from one sweep are often consecutive and would march in order.
 */
export function scatterKey(id: number): number {
  let h = (id ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * A delay weight in [0,1] per tile. 0 changes first, 1 changes last.
 *
 * `scatter` is the default: it says nothing about the world, which is the
 * point — it is the ordering with no visible tick. `sweep` says something
 * true (the terminator really does travel across the wall, and the key spans
 * both panels rather than restarting on each). `latitude` and `magnitude`
 * are arbitrary, kept because they are worth looking at.
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

  if (order === 'scatter') {
    for (const t of targets) keys.set(t.id, scatterKey(t.id));
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

function intersects(a: Pose, b: Pose, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

const fadeEnd = (track: Track, cfg: MotionConfig): number => track.startAt + cfg.fadeMs;

/**
 * Point every track at a new layout. Does not move anything; `sample` does.
 * Returns each tile's delay (ms after `now`) so the canvas can schedule its
 * frame crossfades from the same clock.
 */
export function commit(
  state: MotionState,
  targets: MotionTarget[],
  cfg: MotionConfig,
  now: number,
  ctx: CommitContext
): Map<number, number> {
  const seen = new Set(targets.map((t) => t.id));

  // Departures are keyed alongside the arrivals so every ordering places
  // them in the same wave.
  const departing: MotionTarget[] = [];
  for (const track of state.tracks.values()) {
    if (seen.has(track.id) || track.phase === 'exit') continue;
    const { x, y, width, height } = track.current;
    departing.push({ id: track.id, lat: track.lat, x, y, width, height });
  }

  const keys = staggerKeys([...targets, ...departing], state, cfg.order, ctx);
  const waveStart =
    cfg.order === 'sweep' && cfg.waveGridMs > 0
      ? Math.ceil(now / cfg.waveGridMs) * cfg.waveGridMs
      : now;
  const delays = new Map<number, number>();
  const startFor = (id: number): number => {
    const delay = cfg.spreadMs * (keys.get(id) ?? 0);
    delays.set(id, waveStart - now + delay);
    return waveStart + delay;
  };

  // Exits first: entries need to know when their pixels free up.
  for (const d of departing) {
    const track = state.tracks.get(d.id) as Track;
    track.pending = null;
    track.phase = 'exit';
    track.from = { ...track.current };
    track.to = scaled(track.current, cfg.fadeScale, 0);
    track.startAt = startFor(d.id);
  }

  for (const t of targets) {
    const arrival = poseOf(t, 1);
    const start = startFor(t.id);
    const track = state.tracks.get(t.id);

    if (!track) {
      let startAt = start;
      if (cfg.transition === 'fadeThrough') {
        for (const other of state.tracks.values()) {
          if (other.phase === 'exit' && intersects(other.from, arrival, cfg.gapPx)) {
            startAt = Math.max(startAt, fadeEnd(other, cfg));
          }
        }
      }
      const origin = scaled(arrival, cfg.fadeScale, 0);
      state.tracks.set(t.id, {
        id: t.id,
        lat: t.lat,
        current: { ...origin },
        from: origin,
        to: arrival,
        startAt,
        phase: 'enter',
        pending: null,
      });
      continue;
    }

    track.lat = t.lat;
    if (track.phase === 'exit') {
      // Back before it was gone: come home from wherever it got to.
      track.phase = 'enter';
      track.from = { ...track.current };
      track.to = arrival;
      track.startAt = start;
      track.pending = null;
    } else if (track.phase === 'enter' && now < fadeEnd(track, cfg)) {
      // Still arriving: the fade continues, toward the updated place.
      track.to = arrival;
    } else {
      track.pending = { to: arrival, startAt: start };
    }
  }

  return delays;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function spanOf(track: Track, cfg: MotionConfig): number {
  return Math.max(1, track.phase === 'travel' ? cfg.durationMs : cfg.fadeMs);
}

/**
 * Advance every track and return what to draw. Frames at opacity 0 — an
 * entry still waiting for its moment — are not returned, so the canvas
 * neither paints nor hit-tests them. Exits are dropped once they have ended.
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
    if (track.pending && now >= track.pending.startAt) {
      track.from = { ...track.current };
      track.to = track.pending.to;
      track.startAt = track.pending.startAt;
      track.phase = 'travel';
      track.pending = null;
    }

    const { from, to, current } = track;

    if (cfg.mode === 'cut') {
      Object.assign(current, to);
    } else if (cfg.mode === 'drift' && track.phase === 'travel') {
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
      const raw = (now - track.startAt) / spanOf(track, cfg);
      const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      const e = easeInOutCubic(p);
      current.x = lerp(from.x, to.x, e);
      current.y = lerp(from.y, to.y, e);
      current.width = lerp(from.width, to.width, e);
      current.height = lerp(from.height, to.height, e);
      current.opacity = lerp(from.opacity, to.opacity, e);
    }

    if (track.phase === 'exit' && (cfg.mode === 'cut' || now >= fadeEnd(track, cfg))) {
      finished.push(track.id);
      continue;
    }
    if (current.opacity <= 0) continue;

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

function driftClose(track: Track): boolean {
  const { current, to } = track;
  return (
    Math.abs(current.x - to.x) <= 0.25 &&
    Math.abs(current.y - to.y) <= 0.25 &&
    Math.abs(current.width - to.width) <= 0.25 &&
    Math.abs(current.opacity - to.opacity) <= 0.01
  );
}

/**
 * True when nothing is moving RIGHT NOW. A change still waiting for its
 * delay counts as settled — `nextEventAt` says when to wake for it — so
 * the render loop parks between scheduled changes instead of spinning.
 */
export function isSettled(state: MotionState, cfg: MotionConfig, now: number): boolean {
  // cut lands on the target the moment it is sampled, so one draw is always
  // enough — which is what keeps the render loop parked on a still wall.
  if (cfg.mode === 'cut') return true;
  for (const track of state.tracks.values()) {
    if (track.pending) {
      if (now >= track.pending.startAt) return false;
      continue;
    }
    if (cfg.mode === 'drift' && track.phase === 'travel') {
      if (!driftClose(track)) return false;
      continue;
    }
    if (now >= track.startAt && now < track.startAt + spanOf(track, cfg)) return false;
  }
  return true;
}

/** The earliest scheduled start still in the future, or null. */
export function nextEventAt(state: MotionState, now: number): number | null {
  let next: number | null = null;
  const consider = (at: number) => {
    if (at > now && (next === null || at < next)) next = at;
  };
  for (const track of state.tracks.values()) {
    if (track.pending) consider(track.pending.startAt);
    else if (track.phase !== 'travel') consider(track.startAt);
  }
  return next;
}
