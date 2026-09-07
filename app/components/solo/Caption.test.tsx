import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Caption } from './Caption';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const AT = Date.UTC(2026, 8, 5, 2, 42); // 7:42 pm in Mazatlán, 10:42 pm in New York
const e = {
  title: 'Split › West', region: 'Split-Dalmatia County', country: 'Croatia',
  capturedAt: AT, timezone: 'America/Mazatlan', sunAltitudeDeg: null,
};
const PICTURE = { left: 0, top: 0, width: 1920, height: 940 };
const draw = (props: Partial<Parameters<typeof Caption>[0]> = {}) =>
  render(<Caption entry={e} dials={D} picture={PICTURE} width={1920} hereTimezone="America/New_York" {...props} />);

it('the here dial writes the glass’s own clock beside the camera’s, in the shape it names', () => {
  draw({ dials: { ...D, hereTime: 'parens' } });
  expect(screen.getByTestId('caption-time')).toHaveTextContent('7:42 pm there (10:42 pm here)');
});

it('off leaves the camera’s clock alone', () => {
  draw();
  expect(screen.getByTestId('caption-time')).toHaveTextContent('7:42 pm there');
});

it('a step fades each reading against its own predecessor, so the words that held still do not animate', () => {
  const from = { ...e, capturedAt: AT - 9 * 60_000 }; // 7:33 pm there, 10:33 pm here
  draw({ dials: { ...D, hereTime: 'dot' }, step: { from, fadeS: 1 } });
  // Two readings moved, so two heads fade in and two fade out — and "pm there"
  // and "pm here" are tails on their own reading rather than one shared tail.
  // (The line also carries the readings on their way out, so it is the heads
  // and the tails that say what is being drawn, not the line's text content.)
  expect(screen.getAllByTestId('caption-time-head').map((n) => n.textContent)).toEqual(['7:42', '10:42']);
  expect(screen.getAllByTestId('caption-time-out').map((n) => n.textContent)).toEqual(['7:33', '10:33']);
  for (const n of screen.getAllByTestId('caption-time-head')) {
    expect(n).toHaveStyle({ animation: 'solo-time-in 1s ease both' });
  }
});

it('the separator between them is never asked to fade', () => {
  const from = { ...e, capturedAt: AT - 9 * 60_000 };
  draw({ dials: { ...D, hereTime: 'dot' }, step: { from, fadeS: 1 } });
  const dots = screen.getAllByTestId('caption-time-out').map((n) => n.textContent);
  expect(dots.join('')).not.toContain('·');
});

it('two frames of the same minute say the same thing, so nothing animates', () => {
  draw({ dials: { ...D, hereTime: 'dot' }, step: { from: { ...e, capturedAt: AT + 5_000 }, fadeS: 1 } });
  expect(screen.queryByTestId('caption-time-out')).toBeNull();
});

it('a camera in the glass’s own zone does not say the time twice', () => {
  draw({ dials: { ...D, hereTime: 'dot' }, hereTimezone: 'America/Los_Angeles' });
  expect(screen.getByTestId('caption-time')).toHaveTextContent('7:42 pm there');
});
