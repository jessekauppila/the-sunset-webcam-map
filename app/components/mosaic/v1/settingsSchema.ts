import { SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';
import type { CompositionConfig } from './engine/types';
import { COMPOSITION_CONFIG } from './config';

/**
 * V1 mosaic composition settings schema. Each knob maps 1:1 to a
 * CompositionConfig field (except showModelReadout, which is display-only).
 * Defaults match COMPOSITION_CONFIG exactly so dials start where the code runs.
 */
export const V1_SETTINGS_SCHEMA: SettingsSchema = [
  {
    key: 'floorPx',
    kind: 'number',
    min: 20,
    max: 800,
    step: 10,
    default: COMPOSITION_CONFIG.floorPx,
    label: 'floor (px)',
    description: 'Minimum tile size',
    section: 'sizing',
  },
  {
    key: 'ceilPx',
    kind: 'number',
    min: 50,
    max: 1000,
    step: 10,
    default: COMPOSITION_CONFIG.ceilPx,
    label: 'ceil (px)',
    description: 'Maximum tile size',
    section: 'sizing',
  },
  {
    key: 'upscaleMax',
    kind: 'number',
    min: 1,
    max: 3,
    step: 0.1,
    default: COMPOSITION_CONFIG.upscaleMax,
    label: 'upscale max',
    description: 'Maximum upscale factor',
    section: 'sizing',
  },
  {
    key: 'maxGrowth',
    kind: 'number',
    min: 1,
    max: 5,
    step: 0.1,
    default: COMPOSITION_CONFIG.maxGrowth,
    label: 'max growth',
    description: 'Maximum growth factor',
    section: 'sizing',
  },
  {
    key: 'padding',
    kind: 'number',
    min: 0,
    max: 20,
    step: 1,
    default: COMPOSITION_CONFIG.padding,
    label: 'padding (px)',
    description: 'Space between tiles',
    section: 'arrangement',
  },
  {
    key: 'cullOverflow',
    kind: 'boolean',
    default: COMPOSITION_CONFIG.cullOverflow,
    label: 'cull overflow',
    description: 'Remove tiles that overflow the viewport',
    section: 'arrangement',
  },
  {
    key: 'showModelReadout',
    kind: 'boolean',
    default: false,
    label: 'show model readout',
    description: 'Display model prediction overlay',
    section: 'overlays',
  },
] as const;

/**
 * Maps merged settings values into CompositionConfig field names.
 * Only includes the subset of keys that belong in CompositionConfig.
 */
const CONFIG_KEYS = [
  'floorPx',
  'ceilPx',
  'upscaleMax',
  'maxGrowth',
  'padding',
  'cullOverflow',
] as const;

export function configFromSettings(values?: SettingsValues): Partial<CompositionConfig> {
  if (!values) return {};
  const out: Record<string, unknown> = {};
  for (const key of CONFIG_KEYS) {
    if (key in values) out[key] = values[key];
  }
  return out as Partial<CompositionConfig>;
}
