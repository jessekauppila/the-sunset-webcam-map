import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RulesBox } from './RulesBox';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

it('states the five rules with the dial values in force', () => {
  const d = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
  render(<RulesBox dials={{ ...d, rest: 2, sunsetFloor: 4, mix: 3 }} />);
  expect(screen.getByText(/rested sunsets/).textContent).toContain('4');
  expect(screen.getByText(/per non-sunset/).textContent).toContain('3');
  expect(screen.getByText(/rests/).textContent).toContain('2');
  expect(screen.getByText(/least shown first/)).toBeInTheDocument();
  expect(screen.getByText(/Never the same frame twice/)).toBeInTheDocument();
  expect(screen.getByText(/Floors/).textContent).toContain('0.55');
  expect(screen.queryByText(/minus/)).toBeNull();
});

it('solo2 with valleys states the rhythm inside rule 3; without valleys it reads like solo', async () => {
  const { SOLO_VERSIONS } = await import('@/app/lib/solo/versions');
  const { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } = await import('@/app/lib/solo2/settingsSchema');
  const d2 = dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA));
  const { rerender } = render(<RulesBox dials={{ ...d2, valleys: 2, screens: 'alternate' }} version={SOLO_VERSIONS.solo2} />);
  expect(screen.getByText(/after each peak/).textContent).toMatch(/2 valleys .* alternate/);
  rerender(<RulesBox dials={d2} version={SOLO_VERSIONS.solo2} />);
  expect(screen.queryByText(/after each peak/)).toBeNull();
});
