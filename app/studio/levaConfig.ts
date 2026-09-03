import type { KnobValue, SettingsSchema, SettingsValues } from '@/app/lib/settings/schema';

/**
 * Pure, leva-agnostic builder: turns a settings schema + the current
 * effective values + the set of keys that currently deviate from live into
 * the plain-object shape leva's `useControls` accepts, grouped into one
 * folder per distinct `section`. No leva imports here — this file is fully
 * unit-testable and StudioRail.tsx is the only leva-aware consumer.
 */
export interface LevaFolderSpec {
  section: string;
  controls: Record<
    string,
    {
      value: KnobValue;
      label: string; // '● floorPx' when the knob differs from live, else 'floorPx'
      hint: string; // knob.description — leva renders it as a hover tooltip on the label
      min?: number;
      max?: number;
      step?: number; // number knobs
      options?: readonly string[]; // enum knobs
    }
  >;
}

export function buildFolderSpecs(
  schema: SettingsSchema,
  effective: SettingsValues,
  differingKeys: string[]
): LevaFolderSpec[] {
  const differing = new Set(differingKeys);
  const specsBySection = new Map<string, LevaFolderSpec>();

  for (const knob of schema) {
    let spec = specsBySection.get(knob.section);
    if (!spec) {
      spec = { section: knob.section, controls: {} };
      specsBySection.set(knob.section, spec);
    }

    const label = differing.has(knob.key) ? `● ${knob.label}` : knob.label;
    const value = effective[knob.key] ?? knob.default;

    if (knob.kind === 'number') {
      spec.controls[knob.key] = {
        value,
        label,
        hint: knob.description,
        min: knob.min,
        max: knob.max,
        step: knob.step,
      };
    } else if (knob.kind === 'enum') {
      spec.controls[knob.key] = {
        value,
        label,
        hint: knob.description,
        options: knob.options,
      };
    } else {
      spec.controls[knob.key] = { value, label, hint: knob.description };
    }
  }

  return Array.from(specsBySection.values());
}
