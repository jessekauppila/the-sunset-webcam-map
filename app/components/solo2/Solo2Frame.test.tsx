import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Solo2Frame } from './Solo2Frame';
import { dialsFrom2, SOLO2_SETTINGS_SCHEMA } from '@/app/lib/solo2/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { fitPlan } from '@/app/lib/solo2/plan';

const D = dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA));
const AT = Date.UTC(2026, 8, 5, 2, 42); // 7:42 pm in Mazatlán
const e = {
  snapshotId: 3, webcamId: 1, bin: 'sunset' as const, quality: 0.91, detection: 0.88, isNew: false, tally: 2, enteredAt: 0,
  imageUrl: 'u3', title: 'Pier', city: 'Cabo', region: 'Baja California Sur', country: 'Mexico', eligible: true, rank: 3,
  capturedAt: AT, timezone: 'America/Mazatlan', sunAltitudeDeg: 1.2,
};
const prelude = [{ snapshotId: 1, imageUrl: 'u1' }, { snapshotId: 2, imageUrl: 'u2' }];
const plan = fitPlan({ ...D, prelude: true, leadS: 4 }, 2);
const main = { layer: 'main' as const, leadProgress: 0 };

it('main stage: the chosen frame with place and local time, no scores by default', () => {
  render(<Solo2Frame entry={e} prelude={prelude} previous={null} stage={main} plan={plan} dials={D} width={1920} height={1080} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  expect(screen.getByText('Pier')).toBeInTheDocument();
  expect(screen.getByText('Baja California Sur, Mexico · 7:42 pm')).toBeInTheDocument();
  expect(screen.queryByText(/q 0\.91/)).toBeNull();
});

it('prelude stage: an earlier frame with no caption and no scores', () => {
  render(<Solo2Frame entry={e} prelude={prelude} previous={null} stage={{ layer: 'prelude', index: 1 }} plan={plan}
    dials={{ ...D, showScores: true, showTally: true }} width={1920} height={1080} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
  expect(screen.queryByText('Pier')).toBeNull();
  expect(screen.queryByText(/shown/)).toBeNull();
});

it('time style off leaves just the place; 24h reads 19:42', () => {
  const { rerender } = render(<Solo2Frame entry={e} prelude={[]} previous={null} stage={main} plan={plan} dials={{ ...D, timeStyle: 'off' }} width={1920} height={1080} />);
  expect(screen.getByText('Baja California Sur, Mexico')).toBeInTheDocument();
  rerender(<Solo2Frame entry={e} prelude={[]} previous={null} stage={main} plan={plan} dials={{ ...D, timeStyle: '24h' }} width={1920} height={1080} />);
  expect(screen.getByText('Baja California Sur, Mexico · 19:42')).toBeInTheDocument();
});

it('cut shows no previous layer; crossfade keeps it and animates the top; dip adds the black veil', () => {
  const prev = { ...e, snapshotId: 0, imageUrl: 'u0' };
  const { rerender } = render(<Solo2Frame entry={e} prelude={[]} previous={prev} stage={main} plan={plan} dials={D} width={100} height={50} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u3']);
  rerender(<Solo2Frame entry={e} prelude={[]} previous={prev} stage={main} plan={plan} dials={{ ...D, transition: 'crossfade', fadeS: 2 }} width={100} height={50} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u0', 'u3']);
  expect(screen.getByTestId('top').parentElement!.parentElement).toHaveStyle({ animation: 'solo2-fade-in 2s ease both' });
  expect(screen.queryByTestId('dip')).toBeNull();
  rerender(<Solo2Frame entry={e} prelude={[]} previous={prev} stage={main} plan={plan} dials={{ ...D, transition: 'dip', fadeS: 2 }} width={100} height={50} />);
  expect(screen.getByTestId('dip')).toHaveStyle({ animation: 'solo2-dip 1s linear both' });
});

it('the lead pushes the frame in by progress and lands the next frame still', () => {
  const { rerender } = render(<Solo2Frame entry={e} prelude={[]} previous={null} stage={{ layer: 'main', leadProgress: 0.5 }} plan={plan}
    dials={{ ...D, leadS: 4, leadScale: 1.04 }} width={100} height={50} />);
  expect(screen.getByTestId('push')).toHaveStyle({ transform: 'scale(1.0200)', transition: 'transform 260ms linear' });
  rerender(<Solo2Frame entry={{ ...e, snapshotId: 4 }} prelude={[]} previous={e} stage={main} plan={plan}
    dials={{ ...D, leadS: 4, leadScale: 1.04 }} width={100} height={50} />);
  expect(screen.getByTestId('push')).toHaveStyle({ transform: 'scale(1.0000)', transition: 'none' });
});
