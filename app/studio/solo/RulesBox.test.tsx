import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RulesBox } from './RulesBox';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

it('states the five rules with the dial values in force', () => {
  const d = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
  render(<RulesBox dials={{ ...d, repeatAllowance: 2, sunsetFloor: 4, mix: 3 }} />);
  expect(screen.getByText(/minus/).textContent).toContain('2');
  expect(screen.getByText(/sunsets only/).textContent).toContain('4');
  expect(screen.getByText(/per non-sunset/).textContent).toContain('3');
  expect(screen.getByText(/Never the same frame twice/)).toBeInTheDocument();
  expect(screen.getByText(/Floors/).textContent).toContain('0.55');
});
