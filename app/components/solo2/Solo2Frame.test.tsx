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

it('main stage: the chosen frame inset on black with place and local time, no scores by default', () => {
  render(<Solo2Frame entry={e} prelude={prelude} previous={null} stage={main} plan={plan} dials={D} width={1920} height={1080} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  expect(screen.getByTestId('stack')).toHaveStyle({ left: '125px', top: '43px', width: '1671px', height: '940px' });
  expect(screen.getByText('Pier')).toBeInTheDocument();
  expect(screen.getByText('Baja California Sur, Mexico')).toBeInTheDocument();
  expect(screen.getByTestId('caption-time')).toHaveTextContent('7:42 pm there');
  expect(screen.queryByText(/q 0\.91/)).toBeNull();
});

it('prelude stage: an earlier frame with no caption and no scores', () => {
  render(<Solo2Frame entry={e} prelude={prelude} previous={null} stage={{ layer: 'prelude', index: 1 }} plan={plan}
    dials={{ ...D, showScores: true, showTally: true }} width={1920} height={1080} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
  expect(screen.queryByText('Pier')).toBeNull();
  expect(screen.queryByText(/shown/)).toBeNull();
});

it('the sequence is stacked: frames up to the stage are opaque, later ones transparent, each dissolving over the same-camera fade capped at the step', () => {
  const { rerender } = render(<Solo2Frame entry={e} prelude={prelude} previous={null} stage={{ layer: 'prelude', index: 1 }} plan={plan}
    dials={{ ...D, sameCameraFadeS: 1 }} width={1920} height={1080} />);
  const layers = () => screen.getAllByTestId(/^seq-/).map((l) => [l.getAttribute('data-testid'), l.style.opacity, l.style.transition]);
  expect(layers()).toEqual([
    ['seq-0', '1', 'none'],
    ['seq-1', '1', 'opacity 1s linear'],
    ['seq-2', '0', 'opacity 1s linear'],
  ]);
  rerender(<Solo2Frame entry={e} prelude={prelude} previous={null} stage={main} plan={plan}
    dials={{ ...D, sameCameraFadeS: 5 }} width={1920} height={1080} />);
  expect(layers()).toEqual([
    ['seq-0', '1', 'none'],
    ['seq-1', '1', 'opacity 1.5s linear'], // capped at the 1.5 s step
    ['seq-2', '1', 'opacity 1.5s linear'],
  ]);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  rerender(<Solo2Frame entry={e} prelude={prelude} previous={null} stage={main} plan={plan}
    dials={{ ...D, sameCameraFadeS: 0 }} width={1920} height={1080} />);
  expect(layers().map((l) => l[2])).toEqual(['none', 'none', 'none']); // 0 is a cut
});

it('time style off leaves just the place; 24h inline reads place · 19:42', () => {
  const { rerender } = render(<Solo2Frame entry={e} prelude={[]} previous={null} stage={main} plan={plan} dials={{ ...D, timeStyle: 'off' }} width={1920} height={1080} />);
  expect(screen.getByText('Baja California Sur, Mexico')).toBeInTheDocument();
  expect(screen.queryByTestId('caption-time')).toBeNull();
  rerender(<Solo2Frame entry={e} prelude={[]} previous={null} stage={main} plan={plan} dials={{ ...D, timeStyle: '24h', timeLine: 'inline' }} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-place')).toHaveTextContent('Baja California Sur, Mexico · 19:42');
});

it('cut shows no previous layer; crossfade keeps it and animates the top; dip adds the black veil', () => {
  const prev = { ...e, snapshotId: 0, webcamId: 99, imageUrl: 'u0' };
  const { rerender } = render(<Solo2Frame entry={e} prelude={[]} previous={prev} stage={main} plan={plan} dials={{ ...D, transition: 'cut' }} width={100} height={50} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u3']);
  rerender(<Solo2Frame entry={e} prelude={[]} previous={prev} stage={main} plan={plan} dials={{ ...D, transition: 'crossfade', fadeS: 2 }} width={100} height={50} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u0', 'u3']);
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: 'solo2-fade-in 2s ease both' });
  expect(screen.queryByTestId('dip')).toBeNull();
  rerender(<Solo2Frame entry={e} prelude={[]} previous={prev} stage={main} plan={plan} dials={{ ...D, transition: 'dip', fadeS: 2 }} width={100} height={50} />);
  expect(screen.getByTestId('dip')).toHaveStyle({ animation: 'solo2-dip 1s linear both' });
});

it('a change to the same camera dissolves over the same-camera fade, never through black', () => {
  const prev = { ...e, snapshotId: 0, imageUrl: 'u0' }; // same webcamId as e
  render(<Solo2Frame entry={e} prelude={[]} previous={prev} stage={main} plan={plan}
    dials={{ ...D, transition: 'dip', fadeS: 4, sameCameraFadeS: 1 }} width={100} height={50} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u0', 'u3']);
  expect(screen.queryByTestId('dip')).toBeNull();
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: 'solo2-fade-in 1s ease both' });
});

it('the defaults dip through black between cameras', () => {
  const prev = { ...e, snapshotId: 0, webcamId: 99, imageUrl: 'u0' };
  render(<Solo2Frame entry={e} prelude={[]} previous={prev} stage={main} plan={plan} dials={D} width={100} height={50} />);
  expect(screen.getByTestId('dip')).toHaveStyle({ animation: 'solo2-dip 0.75s linear both' });
});

it('the lead pushes the frame in by progress and lands the next frame still', () => {
  const { rerender } = render(<Solo2Frame entry={e} prelude={[]} previous={null} stage={{ layer: 'main', leadProgress: 0.5 }} plan={plan}
    dials={{ ...D, leadS: 4, leadScale: 1.04 }} width={100} height={50} />);
  expect(screen.getByTestId('push')).toHaveStyle({ transform: 'scale(1.0200)', transition: 'transform 260ms linear' });
  rerender(<Solo2Frame entry={{ ...e, snapshotId: 4 }} prelude={[]} previous={e} stage={main} plan={plan}
    dials={{ ...D, leadS: 4, leadScale: 1.04 }} width={100} height={50} />);
  expect(screen.getByTestId('push')).toHaveStyle({ transform: 'scale(1.0000)', transition: 'none' });
});
