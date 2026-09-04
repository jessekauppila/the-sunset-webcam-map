import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type { V4Config } from './engine/types';
import type { MotionConfig } from './motion';

/**
 * Every v4 composition knob. Defaults here ARE what the engine does with no
 * settings present — the done-signal for phase 2 is that no composition
 * constant survives in source.
 */
export const V4_SETTINGS_SCHEMA: SettingsSchema = [
  {
    key: 'qualitySource', kind: 'enum', options: ['auto', 'model', 'llm'] as const,
    default: 'auto', label: 'quality source', section: 'signal',
    description:
      'Which judge sizes the tiles. auto = ML heads when scored, else Claude — required because reconstructed scenes carry only llm_* and live captures only the ML heads.',
  },
  {
    key: 'gateThreshold', kind: 'number', min: 0, max: 1, step: 0.01, default: 0.55,
    label: 'gate threshold', section: 'visibility',
    description: 'Detection probability a frame must clear to count as a sunset. A probability in [0,1], not a 1-5 rating.',
  },
  {
    key: 'failedCamPolicy', kind: 'enum',
    options: ['hide', 'showAtFloor', 'showIfRoom'] as const, default: 'showAtFloor',
    label: 'failed cams', section: 'visibility',
    description: 'What happens to frames that fail the gate: drop them, show them all at floor size, or show as many as fit.',
  },
  {
    key: 'maxTiles', kind: 'number', min: 0, max: 300, step: 1, default: 0,
    label: 'max tiles', section: 'visibility',
    description: 'Hard ceiling on tile count, passers kept first. 0 means unlimited.',
  },
  {
    key: 'missGraceCycles', kind: 'number', min: 0, max: 5, step: 1, default: 2,
    label: 'miss grace (cycles)', section: 'visibility',
    description: 'How many consecutive polls a camera can go missing — dropped from the pool, or its frame failed to load — before its tile leaves. Each cycle is a minute. A one-poll blip no longer fades a tile out and back in. 0 drops at once.',
  },
  {
    key: 'floorPx', kind: 'number', min: 20, max: 600, step: 10, default: 100,
    label: 'floor (px)', section: 'sizing',
    description: 'Height of the smallest tile. Gate-failers pin to exactly this.',
  },
  {
    key: 'ceilingPx', kind: 'number', min: 50, max: 1200, step: 10, default: 240,
    label: 'ceiling (px)', section: 'sizing',
    description: 'Height of the best-scoring gate-passer. Bound to band count: the wall only renders whole when bandCount * ceilingPx <= panel height (8 * 240 = 1920, the dell panel). Past that, a tall tile in an end band overhangs and the whole wall shrinks.',
  },
  {
    key: 'curve', kind: 'enum',
    options: ['linear', 'easeIn', 'percentileAmongPassers'] as const,
    default: 'linear', label: 'curve', section: 'sizing',
    description: 'How passer scores map onto the floor-to-ceiling range. linear and easeIn are absolute, so the same score is the same height on both screens. percentileAmongPassers ranks within one panel and cannot agree across two.',
  },
  {
    key: 'scoreFloor', kind: 'number', min: 0, max: 1, step: 0.01, default: 0,
    label: 'score at floor', section: 'sizing',
    description: 'Score that renders at floor height. Raise it to stop weak passers looking big. Ignored by percentileAmongPassers.',
  },
  {
    key: 'scoreCeiling', kind: 'number', min: 0, max: 1, step: 0.01, default: 1,
    label: 'score at ceiling', section: 'sizing',
    description: 'Score that renders at ceiling height. Lower it when real scores never reach 1 and the panel looks uniformly small. Ignored by percentileAmongPassers.',
  },
  {
    key: 'exitTaperDeg', kind: 'number', min: 0, max: 15, step: 0.5, default: 6,
    label: 'exit taper (deg)', section: 'sizing',
    description: 'Over the last few degrees before a camera leaves the window (the night edge on sunset, the day edge on sunrise) its tile eases from its score height down to the floor, so a sunset gets smaller as it ends instead of vanishing at full size. Uses the solar altitude the client already computes; no rating cadence involved. 0 disables.',
  },
  {
    key: 'sharedScale', kind: 'boolean', default: true,
    label: 'match both screens', section: 'sizing',
    description: 'Shrink both panels by the same amount, taken from whichever is more crowded. Off, each panel shrinks to its own tile count and a sunrise floor tile can outgrow a sunset ceiling tile.',
  },
  {
    key: 'bandCount', kind: 'number', min: 2, max: 40, step: 1, default: 8,
    label: 'band count', section: 'arrangement',
    description: 'Number of fixed latitude strips. They never move: a band is the same pixels holding one camera or forty. 8 over the default window is one band per 16 degrees. More bands with a smaller ceiling shows more of the pool, smaller; keep bandCount * ceilingPx at or under the panel height (decided 2026-09-03 on the live-capture fixture: 13 x 480 showed 1 of 4 real sunsets, 8 x 240 shows 3).',
  },
  {
    key: 'bandGrid', kind: 'enum', options: ['full', 'inset'] as const, default: 'full',
    label: 'band grid', section: 'arrangement',
    description: 'Where the band grid meets the panel edges. full divides the whole panel, so a tall tile in the top or bottom band hangs off it and the overflow stage shrinks the WHOLE wall for the overhang. inset holds the grid back by half a ceiling tile so nothing overhangs and the wall renders at full size, at the cost of a tighter band pitch. Compare them with ?bandGrid=full and ?bandGrid=inset side by side.',
  },
  {
    key: 'tileGapPx', kind: 'number', min: 0, max: 40, step: 1, default: 6,
    label: 'tile gap (px)', section: 'arrangement',
    description: 'Space between neighbouring tiles.',
  },
  {
    key: 'latNorth', kind: 'number', min: 0, max: 90, step: 1, default: 70,
    label: 'north edge', section: 'arrangement',
    description: 'Latitude mapped to the top of the panel.',
  },
  {
    key: 'latSouth', kind: 'number', min: -90, max: 0, step: 1, default: -60,
    label: 'south edge', section: 'arrangement',
    description: 'Latitude mapped to the bottom of the panel.',
  },
  {
    key: 'axisNightEdgeDeg', kind: 'number', min: -40, max: 0, step: 0.5, default: -24,
    label: 'night edge (deg)', section: 'arrangement',
    description: 'Solar altitude at the deep-twilight edge of the panel. Frames deeper than this clamp to the edge rather than widening the axis.',
  },
  {
    key: 'axisDayEdgeDeg', kind: 'number', min: -30, max: 20, step: 0.5, default: -2,
    label: 'day edge (deg)', section: 'arrangement',
    description: 'Solar altitude at the day-side edge of the panel. Narrowing the window spreads a pool that crowds into one third of the glass; widening it past what the sweep gathers just leaves dead space.',
  },
  {
    key: 'hysteresisMargin', kind: 'number', min: 0, max: 0.5, step: 0.01, default: 0.05,
    label: 'incumbency margin', section: 'arrangement',
    description: 'How much better a challenger must score to take an on-screen tile\'s space. 0 lets near-ties trade places on every poll. A starting guess, not a measurement.',
  },
  {
    key: 'minDwellMs', kind: 'number', min: 0, max: 600_000, step: 5_000, default: 90_000,
    label: 'minimum dwell (ms)', section: 'arrangement',
    description: 'How long a newly admitted tile is safe from eviction, however good the challenger. The margin decides who wins a close fight; this decides how often any fight can happen. A starting guess, not a measurement.',
  },
  {
    key: 'showFeedLabel', kind: 'boolean', default: true,
    label: 'feed label', section: 'overlays',
    description: 'SUNRISE / SUNSET title across the top.',
  },
  {
    key: 'showTileRatings', kind: 'boolean', default: false,
    label: 'tile ratings', section: 'overlays',
    description: 'Per-tile score, gate verdict, and which judge decided. The judge line is the one that tells you whether the gate threshold can act on this frame at all.',
  },
  {
    key: 'overlayScale', kind: 'number', min: 1, max: 5, step: 0.25, default: 2,
    label: 'overlay size', section: 'overlays',
    description: 'Multiplier on the readout text. The panels are read across a room, so 1 is the browser-tab size and rarely the right one on glass.',
  },
  {
    key: 'showModelReadout', kind: 'boolean', default: false,
    label: 'model readout', section: 'overlays',
    description: 'What each model head said about each frame.',
  },
  {
    key: 'showCentreLine', kind: 'boolean', default: false,
    label: 'centre line', section: 'overlays',
    description: 'Marks where the pool\'s terminator ring falls on the axis — the organising idea of the whole composition, otherwise invisible. Studio only: the kiosk routes suppress it structurally, so leaving it on cannot put it on the glass.',
  },
  {
    key: 'motionMode', kind: 'enum',
    options: ['cut', 'tween', 'drift'] as const, default: 'drift',
    label: 'motion', section: 'motion',
    description: 'cut snaps to each new composition, which is what the wall did before this section existed. tween travels between them. drift never arrives — it chases the composition continuously, so the wall is always moving and never jumps.',
  },
  {
    key: 'motionOrder', kind: 'enum',
    options: ['scatter', 'none', 'latitude', 'sweep', 'magnitude'] as const, default: 'scatter',
    label: 'change order', section: 'motion',
    description: 'Which tile changes first within the spread. scatter gives each camera a fixed random point in the minute, so nothing on the wall betrays the poll. sweep runs one wave across both panels in the direction the terminator travels. none changes everything at once, which is the cron tell. latitude and magnitude are arbitrary orderings kept for comparison.',
  },
  {
    key: 'changeSpreadMs', kind: 'number', min: 0, max: 120_000, step: 1_000, default: 60_000,
    label: 'change spread (ms)', section: 'motion',
    description: 'Spread between the first change and the last after each poll: every move, arrival, departure and frame crossfade waits its own share of this. At 60000, the poll interval, change arrives as a steady trickle. 0 restores v3 timing exactly, everything at once on the minute.',
  },
  {
    key: 'transitionStyle', kind: 'enum',
    options: ['fadeThrough', 'dissolve'] as const, default: 'fadeThrough',
    label: 'transition', section: 'motion',
    description: 'fadeThrough: a departing tile fades fully to black before anything arrives in its pixels, so two cameras are never drawn over each other. dissolve: the departure and the arrival run at once, one picture through another. Compare with ?transitionStyle=dissolve beside the default.',
  },
  {
    key: 'fadeMs', kind: 'number', min: 0, max: 60_000, step: 500, default: 20_000,
    label: 'fade (ms)', section: 'motion',
    description: 'How long an arrival fades in and a departure fades out. A replacement under fadeThrough takes twice this. Separate from travel: this is about appearing and leaving, not moving.',
  },
  {
    key: 'fadeScale', kind: 'number', min: 0.3, max: 1, step: 0.05, default: 0.85,
    label: 'fade scale', section: 'motion',
    description: 'A tile fades in from, and out to, this fraction of its size about its own centre. 1 is a pure fade; smaller reads as arriving and receding.',
  },
  {
    key: 'motionDurationMs', kind: 'number', min: 0, max: 60_000, step: 100, default: 30_000,
    label: 'travel (ms)', section: 'motion',
    description: 'How long a tile that STAYS takes to reach a new place or size. In drift mode this is the time constant instead: the wall closes 99.9% of the gap in this long, so a big number is what makes the movement too slow to catch. Arrivals and departures use fade (ms), not this.',
  },
  {
    key: 'crossfadeMs', kind: 'number', min: 0, max: 8_000, step: 100, default: 1_500,
    label: 'frame crossfade (ms)', section: 'motion',
    description: 'How long a newly published frame takes to fade up over the one it replaces. Independent of tile movement: a camera publishes roughly every ten minutes, whenever it likes.',
  },
  {
    key: 'waveGridMs', kind: 'number', min: 0, max: 5_000, step: 250, default: 1_000,
    label: 'wave phase grid (ms)', section: 'motion',
    description: 'The two panels are separate pages that commit at different moments. Rounding a sweep\'s start up to this shared grid puts both on the same wave with no messaging between them. Only used by the sweep ordering.',
  },
] as const;

/**
 * Every dial the query string names, parsed by its knob's kind. Precedence is
 * the one v3 already uses for `?models=`: URL param, then profile setting,
 * then code default — hand the result to `mergeSettings` as its overrides.
 *
 * This exists so two geometries can be put SIDE BY SIDE in two windows —
 * `?bandCount=13&ceilingPx=480` next to `?bandCount=8&ceilingPx=240` — rather
 * than compared from memory across a dial flip. It reaches the kiosk routes
 * too, through the same `search` prop `?v=` and `?setup=` already ride.
 *
 * Deliberately permissive here: range and option checks are left to
 * `sanitizeValues`, so the settings store and the URL have exactly one judge
 * of what a valid value is.
 */
export function urlOverrides(params: URLSearchParams): SettingsValues {
  const out: SettingsValues = {};
  for (const knob of V4_SETTINGS_SCHEMA) {
    const raw = params.get(knob.key);
    if (raw === null) continue;
    if (knob.kind === 'number') {
      const n = Number(raw);
      if (raw.trim() !== '' && Number.isFinite(n)) out[knob.key] = n;
    } else if (knob.kind === 'boolean') {
      if (raw === '1' || raw === 'true') out[knob.key] = true;
      else if (raw === '0' || raw === 'false') out[knob.key] = false;
    } else {
      out[knob.key] = raw;
    }
  }
  return out;
}

/** Merged dial values to the engine's config shape. */
export function configFromSettings(values: SettingsValues): V4Config {
  return {
    qualitySource: values.qualitySource as V4Config['qualitySource'],
    gateThreshold: values.gateThreshold as number,
    failedCamPolicy: values.failedCamPolicy as V4Config['failedCamPolicy'],
    maxTiles: values.maxTiles as number,
    missGraceCycles: values.missGraceCycles as number,
    floorPx: values.floorPx as number,
    ceilingPx: values.ceilingPx as number,
    curve: values.curve as V4Config['curve'],
    scoreFloor: values.scoreFloor as number,
    scoreCeiling: values.scoreCeiling as number,
    exitTaperDeg: values.exitTaperDeg as number,
    sharedScale: values.sharedScale as boolean,
    bandCount: values.bandCount as number,
    bandGrid: values.bandGrid as V4Config['bandGrid'],
    tileGapPx: values.tileGapPx as number,
    latNorth: values.latNorth as number,
    latSouth: values.latSouth as number,
    axisNightEdgeDeg: values.axisNightEdgeDeg as number,
    axisDayEdgeDeg: values.axisDayEdgeDeg as number,
    hysteresisMargin: values.hysteresisMargin as number,
    minDwellMs: values.minDwellMs as number,
    showFeedLabel: values.showFeedLabel as boolean,
    showTileRatings: values.showTileRatings as boolean,
    overlayScale: values.overlayScale as number,
    showModelReadout: values.showModelReadout as boolean,
    showCentreLine: values.showCentreLine as boolean,
  };
}

/**
 * The motion dials, kept out of V4Config on purpose: the composition engine
 * decides where a tile belongs and has no business knowing how it gets there.
 * `tileGapPx` crosses over because the fade-through overlap test must agree
 * with the engine's about what "touching" means.
 */
export function motionFromSettings(values: SettingsValues): {
  motion: MotionConfig;
  crossfadeMs: number;
} {
  return {
    motion: {
      mode: values.motionMode as MotionConfig['mode'],
      order: values.motionOrder as MotionConfig['order'],
      durationMs: values.motionDurationMs as number,
      spreadMs: values.changeSpreadMs as number,
      waveGridMs: values.waveGridMs as number,
      transition: values.transitionStyle as MotionConfig['transition'],
      fadeMs: values.fadeMs as number,
      fadeScale: values.fadeScale as number,
      gapPx: values.tileGapPx as number,
    },
    crossfadeMs: values.crossfadeMs as number,
  };
}
