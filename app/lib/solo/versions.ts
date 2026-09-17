import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import { next, project } from './engine';
import { SOLO_NAMESPACE, SOLO_SETTINGS_SCHEMA, dialsFrom } from './settingsSchema';
import type { BinEntry, Feed, ScreenState, SoloDials } from './types';
import { dwellMs2, dwellMsFor, next2, project2, queue2, roleAt, shown2 } from '@/app/lib/solo2/engine';
import { SOLO2_NAMESPACE, SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import type { Role, Solo2Dials } from '@/app/lib/solo2/types';
import { nearestTick } from '@/app/lib/solo2/plan';
import { fitNext, type Decision, type MySide, type TheirSide } from '@/app/lib/solo2/rendezvous';
import type { RunEntry } from '@/app/lib/solo2/run';

/**
 * The solo kiosk's versions, side by side (solo2 spec §5.1). Both read the
 * same bins and screen state; a descriptor says which namespace's dials to
 * read and which engine to run. Client-safe: no server-only imports, so the
 * studio can re-project in the browser.
 */
export interface SoloVersionSpec<D extends SoloDials = SoloDials> {
  name: SoloVersionName;
  namespace: string;
  schema: SettingsSchema;
  dialsFrom(values: SettingsValues): D;
  /** The next frame for a draw at `slot`. */
  next(entries: BinEntry[], d: D, state: ScreenState, slot: number, feed: Feed): BinEntry | null;
  /**
   * The first `n` draws at `slot`, in the rules' order — `[0]` is what `next`
   * returns. Only versions whose rendezvous may choose from the queue's head
   * have one (scheduler spec §3.1); solo does not.
   */
  queue?<T extends RunEntry>(entries: T[], d: D, state: ScreenState, slot: number, feed: Feed, n: number): T[];
  /** `n` draws forward, the first at `firstSlot`, going on glass at `startMs`. */
  project(entries: BinEntry[], d: D, state: ScreenState, n: number, firstSlot: number, feed: Feed, startMs?: number): BinEntry[];
  /** What a draw at `slot` is inside the bar; solo is all peaks. */
  roleAt(slot: number, feed: Feed, d: D): Role;
  /** The frames a draw of `pick` puts on glass, all of which count as shown; solo shows the pick alone. */
  shown(entries: BinEntry[], pick: BinEntry, d: D): BinEntry[];
  /**
   * How long a draw of `pick` occupies the glass, in ms (dwell-budget spec
   * §5.2). Pure over the same three arguments as `shown`.
   *
   * This exists so that nothing outside the engine has to work a dwell's
   * length out for itself. A dwell's length is a function of engine state,
   * and only the server knows that state at draw time; a client that
   * recomputed it would duplicate engine logic and drift silently, because
   * the wrong answer still looks plausible. The server calls this once and
   * publishes the resulting instant.
   */
  dwellMs(entries: BinEntry[], pick: BinEntry, d: D): number;
  /**
   * When a dwell asked for at `nowMs` begins (beat spec §2.6). solo: now.
   * solo2: the nearest tick of the beat, so every screen change of either
   * screen is on the grid, and a request landing a few hundred ms after the
   * tick the kiosk fired on belongs to that tick.
   */
  startMs(nowMs: number, d: D): number;
  /** The rendezvous seam (spec §3.9): the next draw's decision over my side and the other screen's pinned peak. solo has none. */
  fitNext?<T extends RunEntry>(mine: MySide<T>, theirs: TheirSide, d: D): Decision<T>;
  /** How long a draw of `pick` occupies the glass when it plays exactly `frames` frames, ms. Only versions with a camera run need it. */
  dwellMsFor?(entries: BinEntry[], pick: BinEntry, d: D, frames: number): number;
}

export type SoloVersionName = 'solo' | 'solo2';

const solo: SoloVersionSpec<SoloDials> = {
  name: 'solo',
  namespace: SOLO_NAMESPACE,
  schema: SOLO_SETTINGS_SCHEMA,
  dialsFrom,
  next,
  project,
  roleAt: () => 'peak',
  shown: (_entries, pick) => [pick],
  // solo keeps the fixed grid, so its dwell is the dial and nothing else.
  dwellMs: (_entries, _pick, d) => d.dwellS * 1000,
  startMs: (nowMs) => nowMs,
};

const solo2: SoloVersionSpec<Solo2Dials> = {
  name: 'solo2',
  namespace: SOLO2_NAMESPACE,
  schema: SOLO2_SETTINGS_SCHEMA,
  dialsFrom: dialsFrom2,
  next: next2,
  queue: queue2,
  project: project2,
  roleAt,
  shown: shown2,
  dwellMs: dwellMs2,
  startMs: (nowMs, d) => nearestTick(nowMs, d.beatS),
  fitNext,
  dwellMsFor: dwellMsFor,
};

export const SOLO_VERSIONS = { solo, solo2 } as const;

/**
 * Nothing → solo, so every caller that predates solo2 keeps working; an
 * unknown name → null, so an endpoint can answer 400 instead of guessing.
 */
export function resolveSoloVersion(raw: string | null | undefined): SoloVersionSpec | null {
  if (raw == null || raw === '') return solo as SoloVersionSpec;
  return Object.hasOwn(SOLO_VERSIONS, raw) ? (SOLO_VERSIONS[raw as SoloVersionName] as SoloVersionSpec) : null;
}
