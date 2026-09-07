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
  imageUrl: 'u3', title: 'Pier', city: 'Cabo', region: 'Baja California Sur', country: 'Mexico', eligible: true, rank: 3, stage: { kind: 'inLine' as const, position: null },
  capturedAt: AT, timezone: 'America/Mazatlan', sunAltitudeDeg: 1.2,
};
// The run: two earlier frames of the same camera, each with its own words and score, then e.
const run = [
  { ...e, snapshotId: 1, imageUrl: 'u1', title: 'Pier early', quality: 0.5, tally: 0, capturedAt: AT - 20 * 60_000, rank: undefined },
  { ...e, snapshotId: 2, imageUrl: 'u2', title: 'Pier mid', quality: 0.7, tally: 1, capturedAt: AT - 10 * 60_000, rank: undefined },
  e,
];
const plan = fitPlan({ ...D, leadS: 4 }, 3); // 20 s / 3 = 6.67 s a frame
const last = { index: 2, leadProgress: 0 };

it('the last frame: inset on black, centred, with place and local time, no scores by default', () => {
  render(<Solo2Frame entry={e} run={run} previous={null} stage={last} plan={plan} dials={D} width={1920} height={1080} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  expect(screen.getByTestId('stack')).toHaveStyle({ left: '125px', top: '70px', width: '1671px', height: '940px' });
  expect(screen.getByText('Pier')).toBeInTheDocument();
  expect(screen.getByText('Baja California Sur, Mexico')).toBeInTheDocument();
  expect(screen.getByTestId('caption-time')).toHaveTextContent('7:42 pm there');
  expect(screen.queryByText(/rating 4\.6/)).toBeNull();
});

it('an earlier frame of the run carries its own caption, time and scores', () => {
  render(<Solo2Frame entry={e} run={run} previous={null} stage={{ index: 1, leadProgress: 0 }} plan={plan}
    dials={{ ...D, showScores: true, showTally: true, showRank: true }} width={1920} height={1080} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
  expect(screen.getByText('Pier mid')).toBeInTheDocument();
  expect(screen.queryByText('Pier')).toBeNull();
  expect(screen.getByTestId('caption-time')).toHaveTextContent('7:32 pm there');
  expect(screen.getByText(/rating 3\.8/)).toBeInTheDocument(); // 1 + 4 × 0.7
  expect(screen.getByText(/×1/)).toBeInTheDocument();
  expect(screen.getByText(/sunset bin #3/)).toBeInTheDocument(); // the drawn frame's rank stands in for a run frame without one
});

it('the run is stacked: frames up to the stage are opaque, later ones transparent, each dissolving over the same-camera fade capped at the share', () => {
  const { rerender } = render(<Solo2Frame entry={e} run={run} previous={null} stage={{ index: 1, leadProgress: 0 }} plan={plan}
    dials={{ ...D, sameCameraFadeS: 1 }} width={1920} height={1080} />);
  const layers = () => screen.getAllByTestId(/^seq-/).map((l) => [l.getAttribute('data-testid'), l.style.opacity, l.style.transition]);
  expect(layers()).toEqual([
    ['seq-0', '1', 'none'],
    ['seq-1', '1', 'opacity 1s linear'],
    ['seq-2', '0', 'opacity 1s linear'],
  ]);
  const short = fitPlan({ ...D, dwellS: 3 }, 3); // 1 s a frame
  rerender(<Solo2Frame entry={e} run={run} previous={null} stage={last} plan={short}
    dials={{ ...D, sameCameraFadeS: 5 }} width={1920} height={1080} />);
  expect(layers()).toEqual([
    ['seq-0', '1', 'none'],
    ['seq-1', '1', 'opacity 1s linear'], // capped at the 1 s share
    ['seq-2', '1', 'opacity 1s linear'],
  ]);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  rerender(<Solo2Frame entry={e} run={run} previous={null} stage={last} plan={plan}
    dials={{ ...D, sameCameraFadeS: 0 }} width={1920} height={1080} />);
  expect(layers().map((l) => l[2])).toEqual(['none', 'none', 'none']); // 0 is a cut
});

it('an empty run draws the entry alone', () => {
  render(<Solo2Frame entry={e} run={[]} previous={null} stage={{ index: 0, leadProgress: 0 }} plan={fitPlan(D, 1)} dials={D} width={100} height={50} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
});

it('time style off leaves just the place; 24h inline reads place · 19:42', () => {
  const { rerender } = render(<Solo2Frame entry={e} run={[e]} previous={null} stage={{ index: 0, leadProgress: 0 }} plan={plan} dials={{ ...D, timeStyle: 'off' }} width={1920} height={1080} />);
  expect(screen.getByText('Baja California Sur, Mexico')).toBeInTheDocument();
  expect(screen.queryByTestId('caption-time')).toBeNull();
  rerender(<Solo2Frame entry={e} run={[e]} previous={null} stage={{ index: 0, leadProgress: 0 }} plan={plan} dials={{ ...D, timeStyle: '24h', timeLine: 'inline' }} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-place')).toHaveTextContent('Baja California Sur, Mexico · 19:42');
});

it('names the screen before the title with the prefix dial', () => {
  render(<Solo2Frame entry={e} run={[e]} previous={null} stage={{ index: 0, leadProgress: 0 }} plan={plan} dials={D} feed="sunrise" width={1920} height={1080} />);
  expect(screen.getByTestId('caption-title')).toHaveTextContent('Sunrise: Pier');
});

it('cut shows no previous layer; crossfade keeps it and animates the top; dip adds the black veil', () => {
  const prev = { ...e, snapshotId: 0, webcamId: 99, imageUrl: 'u0' };
  const one = { index: 0, leadProgress: 0 };
  const { rerender } = render(<Solo2Frame entry={e} run={[e]} previous={prev} stage={one} plan={plan} dials={{ ...D, transition: 'cut' }} width={100} height={50} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u3']);
  rerender(<Solo2Frame entry={e} run={[e]} previous={prev} stage={one} plan={plan} dials={{ ...D, transition: 'crossfade', fadeS: 2 }} width={100} height={50} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u0', 'u3']);
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: 'solo2-fade-in 2s ease both' });
  expect(screen.queryByTestId('dip')).toBeNull();
  rerender(<Solo2Frame entry={e} run={[e]} previous={prev} stage={one} plan={plan} dials={{ ...D, transition: 'dip', fadeS: 2 }} width={100} height={50} />);
  expect(screen.getByTestId('dip')).toHaveStyle({ animation: 'solo2-dip 1s linear both' });
});

it('a change to the same camera dissolves over the same-camera fade, never through black', () => {
  const prev = { ...e, snapshotId: 0, imageUrl: 'u0' }; // same webcamId as e
  render(<Solo2Frame entry={e} run={[e]} previous={prev} stage={{ index: 0, leadProgress: 0 }} plan={plan}
    dials={{ ...D, transition: 'dip', fadeS: 4, sameCameraFadeS: 1 }} width={100} height={50} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u0', 'u3']);
  expect(screen.queryByTestId('dip')).toBeNull();
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: 'solo2-fade-in 1s ease both' });
});

it('the defaults dip through black between cameras', () => {
  const prev = { ...e, snapshotId: 0, webcamId: 99, imageUrl: 'u0' };
  render(<Solo2Frame entry={e} run={[e]} previous={prev} stage={{ index: 0, leadProgress: 0 }} plan={plan} dials={D} width={100} height={50} />);
  expect(screen.getByTestId('dip')).toHaveStyle({ animation: 'solo2-dip 0.75s linear both' });
});

it('the lead pushes the frame in by progress and lands the next frame still', () => {
  const { rerender } = render(<Solo2Frame entry={e} run={[e]} previous={null} stage={{ index: 0, leadProgress: 0.5 }} plan={plan}
    dials={{ ...D, leadS: 4, leadScale: 1.04 }} width={100} height={50} />);
  expect(screen.getByTestId('push')).toHaveStyle({ transform: 'scale(1.0200)', transition: 'transform 260ms linear' });
  rerender(<Solo2Frame entry={{ ...e, snapshotId: 4 }} run={[{ ...e, snapshotId: 4 }]} previous={e} stage={{ index: 0, leadProgress: 0 }} plan={plan}
    dials={{ ...D, leadS: 4, leadScale: 1.04 }} width={100} height={50} />);
  expect(screen.getByTestId('push')).toHaveStyle({ transform: 'scale(1.0000)', transition: 'none' });
});

it('the caption arrives on the picture’s transition: the same animation, and the outgoing words underneath', () => {
  const prev = { ...e, snapshotId: 0, webcamId: 99, imageUrl: 'u0', title: 'Old pier' };
  const one = { index: 0, leadProgress: 0 };
  const { rerender } = render(<Solo2Frame entry={e} run={[e]} previous={prev} stage={one} plan={plan}
    dials={{ ...D, transition: 'crossfade', fadeS: 2 }} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-layer')).toHaveStyle({ animation: 'solo2-fade-in 2s ease both' });
  expect(screen.getByTestId('caption-layer').style.animation).toBe(screen.getByTestId('stack').style.animation);
  expect(screen.getByText('Old pier')).toBeInTheDocument(); // the words being left behind

  // A cut has nothing to dissolve: no outgoing caption, no animation.
  rerender(<Solo2Frame entry={e} run={[e]} previous={prev} stage={one} plan={plan}
    dials={{ ...D, transition: 'cut' }} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-layer').style.animation).toBe('');
  expect(screen.queryByTestId('caption-prev')).toBeNull();
});

it('on a dip the veil covers the outgoing caption, and the new words fade in after it', () => {
  const prev = { ...e, snapshotId: 0, webcamId: 99, imageUrl: 'u0' };
  render(<Solo2Frame entry={e} run={[e]} previous={prev} stage={{ index: 0, leadProgress: 0 }} plan={plan}
    dials={{ ...D, transition: 'dip', fadeS: 2 }} width={1920} height={1080} />);
  const out = screen.getByTestId('caption-prev');
  const veil = screen.getByTestId('dip');
  const arriving = screen.getByTestId('caption-layer');
  // Painted in this order, so the veil hides the old words rather than sitting behind them.
  expect(out.compareDocumentPosition(veil) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(veil.compareDocumentPosition(arriving) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(arriving).toHaveStyle({ animation: 'solo2-fade-in 1s ease 1s both' });
});

it('inside a run only the clock moves: the old time fades out, the new one in, and the words are not remounted', () => {
  // A real run is one camera, so every frame carries the same words.
  const sameCam = run.map((f) => ({ ...f, title: 'Pier' }));
  const { rerender } = render(<Solo2Frame entry={e} run={sameCam} previous={null} stage={{ index: 1, leadProgress: 0 }} plan={plan}
    dials={{ ...D, sameCameraFadeS: 1 }} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-time')).toHaveTextContent('7:32 pm there');
  expect(screen.getByTestId('caption-time')).toHaveStyle({ animation: 'solo-time-in 0.5s ease 0.5s both' });
  expect(screen.getByTestId('caption-time-out')).toHaveTextContent('7:22 pm there');
  expect(screen.getByTestId('caption-time-out')).toHaveStyle({ animation: 'solo-time-out 0.5s ease both' });

  // Stepping again keeps the very same caption element: the title and the
  // place hold still while the clock swaps under them.
  const held = screen.getByTestId('caption-layer');
  rerender(<Solo2Frame entry={e} run={sameCam} previous={null} stage={{ index: 2, leadProgress: 0 }} plan={plan}
    dials={{ ...D, sameCameraFadeS: 1 }} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-layer')).toBe(held);
  expect(screen.getByTestId('caption-time')).toHaveTextContent('7:42 pm there');
  expect(screen.getByTestId('caption-time-out')).toHaveTextContent('7:32 pm there');
});

it('a run’s first frame has no clock to leave', () => {
  render(<Solo2Frame entry={e} run={run} previous={null} stage={{ index: 0, leadProgress: 0 }} plan={plan}
    dials={{ ...D, sameCameraFadeS: 1 }} width={1920} height={1080} />);
  expect(screen.queryByTestId('caption-time-out')).toBeNull();
  expect(screen.getByTestId('caption-time').style.animation).toBe('');
});

it('two frames of one minute say the same time, so nothing fades', () => {
  const sameMinute = [{ ...e, snapshotId: 1, imageUrl: 'u1' }, e]; // both taken at AT
  render(<Solo2Frame entry={e} run={sameMinute} previous={null} stage={{ index: 1, leadProgress: 0 }} plan={plan}
    dials={{ ...D, sameCameraFadeS: 1 }} width={1920} height={1080} />);
  expect(screen.queryByTestId('caption-time-out')).toBeNull();
  expect(screen.getByTestId('caption-time').style.animation).toBe('');
});
