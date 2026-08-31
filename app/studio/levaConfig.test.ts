import { describe, it, expect } from 'vitest';
import { buildFolderSpecs } from './levaConfig';
import type { SettingsSchema } from '@/app/lib/settings/schema';

// 3-knob schema spanning 2 sections, deliberately out of alphabetical order
// so we can assert schema order (not sorted order) is preserved.
const SCHEMA: SettingsSchema = [
  {
    key: 'floorPx',
    kind: 'number',
    min: 20,
    max: 800,
    step: 10,
    default: 100,
    label: 'floor (px)',
    description: 'Minimum tile size',
    section: 'sizing',
  },
  {
    key: 'cullOverflow',
    kind: 'boolean',
    default: true,
    label: 'cull overflow',
    description: 'Remove tiles that overflow the viewport',
    section: 'arrangement',
  },
  {
    key: 'panelPreset',
    kind: 'enum',
    options: ['dell', 'ktc'] as const,
    default: 'dell',
    label: 'panel',
    description: 'Panel size',
    section: 'sizing',
  },
];

describe('buildFolderSpecs', () => {
  it('groups knobs by section in schema order, one folder per distinct section', () => {
    const specs = buildFolderSpecs(SCHEMA, { floorPx: 100, cullOverflow: true, panelPreset: 'dell' }, []);

    expect(specs.map((s) => s.section)).toEqual(['sizing', 'arrangement']);
    expect(Object.keys(specs[0].controls)).toEqual(['floorPx', 'panelPreset']);
    expect(Object.keys(specs[1].controls)).toEqual(['cullOverflow']);
  });

  it('prefixes the label with "● " only for keys present in differingKeys', () => {
    const specs = buildFolderSpecs(
      SCHEMA,
      { floorPx: 200, cullOverflow: true, panelPreset: 'dell' },
      ['floorPx']
    );

    const sizing = specs.find((s) => s.section === 'sizing')!;
    expect(sizing.controls.floorPx.label).toBe('● floor (px)');
    expect(sizing.controls.panelPreset.label).toBe('panel');

    const arrangement = specs.find((s) => s.section === 'arrangement')!;
    expect(arrangement.controls.cullOverflow.label).toBe('cull overflow');
  });

  it('includes min/max/step for number knobs and omits them for enum/boolean', () => {
    const specs = buildFolderSpecs(SCHEMA, { floorPx: 100, cullOverflow: true, panelPreset: 'dell' }, []);
    const sizing = specs.find((s) => s.section === 'sizing')!;

    expect(sizing.controls.floorPx).toMatchObject({ min: 20, max: 800, step: 10 });
    expect(sizing.controls.panelPreset.min).toBeUndefined();
    expect(sizing.controls.panelPreset.max).toBeUndefined();
    expect(sizing.controls.panelPreset.step).toBeUndefined();

    const arrangement = specs.find((s) => s.section === 'arrangement')!;
    expect(arrangement.controls.cullOverflow.min).toBeUndefined();
    expect(arrangement.controls.cullOverflow.step).toBeUndefined();
  });

  it('includes options for enum knobs and omits them for number/boolean', () => {
    const specs = buildFolderSpecs(SCHEMA, { floorPx: 100, cullOverflow: true, panelPreset: 'dell' }, []);
    const sizing = specs.find((s) => s.section === 'sizing')!;

    expect(sizing.controls.panelPreset.options).toEqual(['dell', 'ktc']);
    expect(sizing.controls.floorPx.options).toBeUndefined();

    const arrangement = specs.find((s) => s.section === 'arrangement')!;
    expect(arrangement.controls.cullOverflow.options).toBeUndefined();
  });

  it('takes control values from effective, not from schema defaults', () => {
    const specs = buildFolderSpecs(
      SCHEMA,
      { floorPx: 333, cullOverflow: false, panelPreset: 'ktc' },
      []
    );
    const sizing = specs.find((s) => s.section === 'sizing')!;
    const arrangement = specs.find((s) => s.section === 'arrangement')!;

    expect(sizing.controls.floorPx.value).toBe(333);
    expect(sizing.controls.panelPreset.value).toBe('ktc');
    expect(arrangement.controls.cullOverflow.value).toBe(false);
  });

  it('returns an empty array for an empty schema', () => {
    expect(buildFolderSpecs([], {}, [])).toEqual([]);
  });
});
