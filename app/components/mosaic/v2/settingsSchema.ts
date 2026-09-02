import type { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type { V2Config } from './engine/types';

/**
 * Every v2 composition knob. Defaults here ARE what the engine does with no
 * settings present — the done-signal for phase 2 is that no composition
 * constant survives in source.
 */
export const V2_SETTINGS_SCHEMA: SettingsSchema = [
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
    key: 'floorPx', kind: 'number', min: 20, max: 600, step: 10, default: 100,
    label: 'floor (px)', section: 'sizing',
    description: 'Height of the smallest tile. Gate-failers pin to exactly this.',
  },
  {
    key: 'ceilingPx', kind: 'number', min: 50, max: 1200, step: 10, default: 480,
    label: 'ceiling (px)', section: 'sizing',
    description: 'Height of the best-scoring gate-passer.',
  },
  {
    key: 'curve', kind: 'enum',
    options: ['linear', 'easeIn', 'percentileAmongPassers'] as const,
    default: 'percentileAmongPassers', label: 'curve', section: 'sizing',
    description: 'How passer scores map onto the floor-to-ceiling range. percentileAmongPassers ranks within the passers only.',
  },
  {
    key: 'strategy', kind: 'enum',
    options: ['anchorRelax', 'latitudeBands'] as const, default: 'anchorRelax',
    label: 'strategy', section: 'arrangement',
    description: 'anchorRelax floats rows at their true latitude; latitudeBands quantises them into fixed zones.',
  },
  {
    key: 'bandCount', kind: 'number', min: 2, max: 24, step: 1, default: 8,
    label: 'band count', section: 'arrangement',
    description: 'Number of latitude zones. Only used by the latitudeBands strategy.',
  },
  {
    key: 'horizontalAnchor', kind: 'enum',
    options: ['solarAltitude', 'order'] as const, default: 'solarAltitude',
    label: 'horizontal axis', section: 'arrangement',
    description: 'solarAltitude places tiles by depth into twilight; order just packs them west to east.',
  },
  {
    key: 'rowAlign', kind: 'enum',
    options: ['center', 'justify', 'west'] as const, default: 'center',
    label: 'row align', section: 'arrangement',
    description: 'Where a row\'s slack goes. Only used when the horizontal axis is order.',
  },
  {
    key: 'geographicFidelity', kind: 'number', min: 0, max: 1, step: 0.05, default: 0.7,
    label: 'geographic fidelity', section: 'arrangement',
    description: '1 keeps rows at true latitude so gaps stay gaps; 0 packs them densely and leaves geography as ordering only. Only used by the anchorRelax strategy.',
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
    key: 'showFeedLabel', kind: 'boolean', default: true,
    label: 'feed label', section: 'overlays',
    description: 'SUNRISE / SUNSET title across the top.',
  },
  {
    key: 'showTileRatings', kind: 'boolean', default: false,
    label: 'tile ratings', section: 'overlays',
    description: 'Per-tile score and gate verdict.',
  },
  {
    key: 'showModelReadout', kind: 'boolean', default: false,
    label: 'model readout', section: 'overlays',
    description: 'What each model head said about each frame.',
  },
] as const;

/** Merged dial values to the engine's config shape. */
export function configFromSettings(values: SettingsValues): V2Config {
  return {
    qualitySource: values.qualitySource as V2Config['qualitySource'],
    gateThreshold: values.gateThreshold as number,
    failedCamPolicy: values.failedCamPolicy as V2Config['failedCamPolicy'],
    maxTiles: values.maxTiles as number,
    floorPx: values.floorPx as number,
    ceilingPx: values.ceilingPx as number,
    curve: values.curve as V2Config['curve'],
    strategy: values.strategy as V2Config['strategy'],
    bandCount: values.bandCount as number,
    horizontalAnchor: values.horizontalAnchor as V2Config['horizontalAnchor'],
    rowAlign: values.rowAlign as V2Config['rowAlign'],
    geographicFidelity: values.geographicFidelity as number,
    tileGapPx: values.tileGapPx as number,
    latNorth: values.latNorth as number,
    latSouth: values.latSouth as number,
    showFeedLabel: values.showFeedLabel as boolean,
    showTileRatings: values.showTileRatings as boolean,
    showModelReadout: values.showModelReadout as boolean,
  };
}
