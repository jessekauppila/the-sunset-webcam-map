import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Caption } from './Caption';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const MIN = 60_000;
const AT = Date.UTC(2026, 8, 5, 2, 42);
const e = {
  title: 'Split › West', region: 'Split-Dalmatia County', country: 'Croatia',
  capturedAt: AT, timezone: 'America/Mazatlan', sunAltitudeDeg: null,
};
const PICTURE = { left: 0, top: 0, width: 1920, height: 940 };

/**
 * The time line as it is actually drawn. Mid-crossfade the line also carries
 * the reading on its way out, which is aria-hidden and sits on top of the one
 * that replaced it, so it has to come out before reading the text.
 */
const drawnTime = () => {
  const el = screen.getByTestId('caption-time').cloneNode(true) as HTMLElement;
  el.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return el.textContent;
};

const draw = (props: Partial<Parameters<typeof Caption>[0]> = {}) =>
  render(<Caption entry={e} dials={D} picture={PICTURE} width={1920} now={AT + 13 * MIN} {...props} />);

it('the default time reading is how long ago the picture was taken', () => {
  draw();
  expect(drawnTime()).toBe('13 minutes ago');
});

it('past an hour it reads hours and minutes', () => {
  draw({ now: AT + 65 * MIN });
  expect(drawnTime()).toBe('1 hour 5 minutes ago');
});

it('it needs no timezone, so a camera that has none still says when', () => {
  draw({ entry: { ...e, timezone: null } });
  expect(drawnTime()).toBe('13 minutes ago');
});

it('a run counts down, and only the digit that moved fades', () => {
  // The frame arriving was taken ten minutes later than the one it replaces,
  // so at one wall clock the reading goes 38 minutes ago → 28 minutes ago.
  const now = AT + 38 * MIN;
  draw({ entry: { ...e, capturedAt: AT + 10 * MIN }, now, step: { from: e, fadeS: 1 } });
  expect(drawnTime()).toBe('28 minutes ago');
  expect(screen.getByTestId('caption-time-head')).toHaveTextContent('2');
  expect(screen.getByTestId('caption-time-head')).toHaveStyle({ animation: 'solo-time-in 1s ease both' });
  expect(screen.getByTestId('caption-time-out')).toHaveTextContent('3');
  expect(screen.getByTestId('caption-time-out')).toHaveStyle({ animation: 'solo-time-out 1s ease both' });
});

it('one wall clock for both readings, so a step shows the age gap and not a tick of the clock', () => {
  // Same frame twice: the two readings are identical and nothing animates,
  // which could only be true if both were measured against the same `now`.
  draw({ step: { from: e, fadeS: 1 } });
  expect(screen.queryByTestId('caption-time-out')).toBeNull();
});

it('the clock styles still read the camera’s own time', () => {
  draw({ dials: { ...D, timeStyle: '12h-there' } });
  expect(drawnTime()).toBe('7:42 pm there');
});
