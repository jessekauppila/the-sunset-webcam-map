import { describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Solo2Frame } from './Solo2Frame';
import { dialsFrom2, SOLO2_SETTINGS_SCHEMA } from '@/app/lib/solo2/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { fitPlan } from '@/app/lib/solo2/plan';
import { ARRIVAL_EASES, VEIL_TINTS } from '@/app/lib/solo2/veil';

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


/** The curve the default dials put on every layer of a dissolve. */
const E = ARRIVAL_EASES.gentle;

// The caption's default time reading is now "13 minutes ago", which moves
// with the wall clock; these tests are about the run, so they pin the clock.
// The prefix is off by default now that the time line names the crossing;
// these tests predate that and still exercise the dial itself.
const D = {
  ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)),
  timeStyle: '12h-there' as const, feedPrefix: true, lineOrder: 'name-first' as const,
};
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
const plan = fitPlan({ ...D, leadS: 4 }, 3); // 20 s / 3 = 6.67 s a frame, above the 4 s floor
const last = { index: 2, leadProgress: 0 };

it('the last frame: inset on black, centred, with place and local time, no scores by default', () => {
  render(<Solo2Frame entry={e} run={run} previous={null} stage={last} plan={plan} dials={D} width={1920} height={1080} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u3');
  expect(screen.getByTestId('stack')).toHaveStyle({ left: '125px', top: '70px', width: '1671px', height: '940px' });
  expect(screen.getByText('Pier')).toBeInTheDocument();
  expect(screen.getByText('Baja California Sur, Mexico')).toBeInTheDocument();
  expect(drawnTime()).toBe('7:42 pm there');
  expect(screen.queryByText(/rating 4\.6/)).toBeNull();
});

it('an earlier frame of the run carries its own caption, time and scores', () => {
  render(<Solo2Frame entry={e} run={run} previous={null} stage={{ index: 1, leadProgress: 0 }} plan={plan}
    dials={{ ...D, showScores: true, showTally: true, showRank: true }} width={1920} height={1080} />);
  expect(screen.getByTestId('top')).toHaveAttribute('src', 'u2');
  expect(screen.getByText('Pier mid')).toBeInTheDocument();
  expect(screen.queryByText('Pier')).toBeNull();
  expect(drawnTime()).toBe('7:32 pm there');
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
    ['seq-1', '1', `opacity 1s ${E}`],
    ['seq-2', '0', `opacity 1s ${E}`],
  ]);
  const short = fitPlan({ ...D, beatS: 1, changeBeats: 0 }, 3); // 1 s a frame
  rerender(<Solo2Frame entry={e} run={run} previous={null} stage={last} plan={short}
    dials={{ ...D, sameCameraFadeS: 5 }} width={1920} height={1080} />);
  expect(layers()).toEqual([
    ['seq-0', '1', 'none'],
    ['seq-1', '1', `opacity 0.5s ${E}`], // half of the 1 s step, so the frame is still for the other half
    ['seq-2', '1', `opacity 0.5s ${E}`],
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
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: `solo2-fade-in 2s ${E} both` });
  expect(screen.queryByTestId('dip')).toBeNull();
  rerender(<Solo2Frame entry={e} run={[e]} previous={prev} stage={one} plan={plan} dials={{ ...D, transition: 'dip', fadeS: 2 }} width={100} height={50} />);
  // The dip's first half closes the veil over the previous picture; the stack
  // rises out of it over the second half, delayed to wait for it.
  expect(screen.getByTestId('dip').style.animation).toBe(`solo2-dip 1s ${E} both`);
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: `solo2-fade-in 1s ${E} 1s both` });
});

it('a change to the same camera dissolves over the same-camera fade, never through black', () => {
  const prev = { ...e, snapshotId: 0, imageUrl: 'u0' }; // same webcamId as e
  render(<Solo2Frame entry={e} run={[e]} previous={prev} stage={{ index: 0, leadProgress: 0 }} plan={plan}
    dials={{ ...D, transition: 'dip', fadeS: 4, sameCameraFadeS: 1 }} width={100} height={50} />);
  expect(screen.getAllByRole('presentation').map((i) => i.getAttribute('src'))).toEqual(['u0', 'u3']);
  expect(screen.queryByTestId('dip')).toBeNull();
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: `solo2-fade-in 1s ${E} both` });
});

it('the defaults dip through black between cameras', () => {
  const prev = { ...e, snapshotId: 0, webcamId: 99, imageUrl: 'u0' };
  render(<Solo2Frame entry={e} run={[e]} previous={prev} stage={{ index: 0, leadProgress: 0 }} plan={plan} dials={D} width={100} height={50} />);
  expect(screen.getByTestId('dip')).toHaveStyle({ background: '#000000' });
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: `solo2-fade-in 2s ${E} 2s both` });
});

it('a dip with nothing to burn down rises with no delay, so a reload or a preview mount never opens on black', () => {
  // No previous frame: there is no veil to close over anything, so the rise
  // must not still wait out the burn-down's half (2026-09-14).
  render(<Solo2Frame entry={e} run={[e]} previous={null} stage={{ index: 0, leadProgress: 0 }} plan={plan} dials={D} width={100} height={50} />);
  expect(screen.queryByTestId('dip')).toBeNull();
  expect(screen.getByTestId('stack')).toHaveStyle({ animation: `solo2-fade-in 2s ${E} both` });
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
  expect(screen.getByTestId('caption-layer')).toHaveStyle({ animation: `solo2-fade-in 2s ${E} both` });
  expect(screen.getByTestId('caption-layer').style.animation).toBe(screen.getByTestId('stack').style.animation);
  expect(screen.getByText('Old pier')).toBeInTheDocument(); // the words being left behind

  // A cut has nothing to dissolve: no outgoing caption, no animation.
  rerender(<Solo2Frame entry={e} run={[e]} previous={prev} stage={one} plan={plan}
    dials={{ ...D, transition: 'cut' }} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-layer').style.animation).toBe('');
  expect(screen.queryByTestId('caption-prev')).toBeNull();
});

it('the outgoing caption dissolves away, so a veil-less change never leaves two readings stacked', () => {
  // Words are not a picture: an arriving picture is opaque and covers the one
  // under it, an arriving caption is transparent between its letters. Left at
  // full opacity the old title, place and clock stay legible under the new
  // ones for the whole dwell. Only the dip's veil ever hid them, so every
  // change without a veil — a crossfade, a same-camera arrival, or a dip whose
  // veil colour is null — showed both at once (reported 2026-09-07).
  const prev = { ...e, snapshotId: 0, webcamId: 99, imageUrl: 'u0', title: 'Old pier' };
  const one = { index: 0, leadProgress: 0 };
  const { rerender } = render(<Solo2Frame entry={e} run={[e]} previous={prev} stage={one} plan={plan}
    dials={{ ...D, transition: 'crossfade', fadeS: 2 }} width={1920} height={1080} />);
  // It leaves on exactly the ramp the new caption arrives on, held at the end.
  expect(screen.getByTestId('caption-prev')).toHaveStyle({ animation: `solo2-fade-out 2s ${E} both` });

  // A dip: the old words leave with the old picture, under the closing veil,
  // over the change beat's first half.
  rerender(<Solo2Frame entry={e} run={[e]} previous={prev} stage={one} plan={plan}
    dials={{ ...D, transition: 'dip', fadeS: 2 }} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-prev')).toHaveStyle({ animation: `solo2-fade-out 1s ${E} both` });

  // A sunrise change of `crossfade` has no veil, so its dip becomes a crossfade
  // — the case #172 opened up, and the one that must not strand the old words.
  // (This option was briefly named `none`; #175 restored the veil study's word.)
  rerender(<Solo2Frame entry={e} run={[e]} previous={prev} stage={one} plan={plan} feed="sunrise"
    dials={{ ...D, transition: 'dip', fadeS: 2, veilStyle: 'crossfade' }} width={1920} height={1080} />);
  expect(screen.queryByTestId('dip')).toBeNull();
  expect(screen.getByTestId('caption-prev')).toHaveStyle({ animation: `solo2-fade-out 2s ${E} both` });
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
  expect(arriving).toHaveStyle({ animation: `solo2-fade-in 1s ${E} 1s both` });
});

it('a dip: the previous picture burns down over the first half of the change, the new one rises over the second', () => {
  const prev = { ...e, snapshotId: 9, webcamId: 2, imageUrl: 'u9', title: 'Elsewhere' };
  render(<Solo2Frame entry={e} run={[e]} previous={prev} stage={{ index: 0, leadProgress: 0 }} plan={fitPlan(D, 1)}
    dials={{ ...D, transition: 'dip' }} width={1920} height={1080} feed="sunset" />);
  // fadeS is one beat (4 s): the veil closes over 2 s, the new picture waits 2 s then rises over 2 s.
  expect(screen.getByTestId('dip').style.animation).toBe(`solo2-dip 2s ${E} both`);
  expect(screen.getByTestId('stack').style.animation).toBe(`solo2-fade-in 2s ${E} 2s both`);
  expect(screen.getByTestId('caption-layer').style.animation).toBe(`solo2-fade-in 2s ${E} 2s both`);
  // The old words leave with the old picture, under the closing veil.
  expect(screen.getByTestId('caption-prev').style.animation).toBe(`solo2-fade-out 2s ${E} both`);
  expect(screen.getByTestId('caption-prev').style.opacity).toBe('');
});

describe('what the change dips through', () => {
  const prev = { ...e, snapshotId: 0, webcamId: 99, imageUrl: 'u0' };
  const dip = (extra: Partial<typeof D>, feed: 'sunrise' | 'sunset' = 'sunrise') => {
    render(<Solo2Frame entry={e} run={[e]} previous={prev} stage={{ index: 0, leadProgress: 0 }} plan={plan}
      dials={{ ...D, transition: 'dip', fadeS: 2, ...extra }} width={100} height={50} feed={feed} />);
  };

  it('black, the default, is what both screens have always done', () => {
    dip({});
    expect(screen.getByTestId('dip')).toHaveStyle({ background: '#000000' });
  });

  it('lift dips the sunrise through its tint and leaves the sunset ending in black', () => {
    dip({ veilStyle: 'lift', veilTint: 'dawn' });
    expect(screen.getByTestId('dip')).toHaveStyle({ background: VEIL_TINTS.dawn });
    cleanup();
    dip({ veilStyle: 'lift', veilTint: 'dawn' }, 'sunset');
    expect(screen.getByTestId('dip')).toHaveStyle({ background: '#000000' });
  });

  it('a sunrise change of `crossfade` takes the veil off that screen entirely; the sunset screen still dips', () => {
    dip({ veilStyle: 'crossfade' });
    expect(screen.queryByTestId('dip')).toBeNull();
    // Not a cut: the outgoing picture stays, and the new one dissolves over the WHOLE fade.
    expect(screen.getByTestId('prev')).toBeInTheDocument();
    expect(screen.getByTestId('stack')).toHaveStyle({ animation: `solo2-fade-in 2s ${E} both` });
    cleanup();
    dip({ veilStyle: 'crossfade' }, 'sunset');
    expect(screen.getByTestId('dip')).toHaveStyle({ background: '#000000' });
  });

  it('exposure moves the picture toward the veil, each screen toward its own end', () => {
    dip({ veilStyle: 'exposure', burnLift: 1.6 });
    expect(screen.getByTestId('dip')).toHaveStyle({ background: '#ffffff' });
    // The previous picture burns toward the lift over the closing half; the
    // stack rises out of it, back from the lift, over the second half.
    expect(screen.getByTestId('prev').style.animation).toBe(`solo2-burn-out 1s ${E} both`);
    expect(screen.getByTestId('prev').style.getPropertyValue('--solo2-lift')).toBe('1.6');
    expect(screen.getByTestId('stack').style.animation)
      .toBe(`solo2-fade-in 1s ${E} 1s both, solo2-burn-in 1s ${E} 1s both`);
    // Carried as a custom property, never baked into the keyframes: two screens
    // share one document, and a `<style>` rule is global.
    expect(screen.getByTestId('stack').style.getPropertyValue('--solo2-lift')).toBe('1.6');
    cleanup();
    dip({ veilStyle: 'exposure', burnLift: 1.6 }, 'sunset');
    expect(screen.getByTestId('dip')).toHaveStyle({ background: '#000000' });
    expect(screen.getByTestId('stack').style.getPropertyValue('--solo2-lift')).toBe('0');
  });

  it('no burn animation at all when the lift asks for nothing', () => {
    dip({ veilStyle: 'exposure', burnLift: 1 });
    expect(screen.getByTestId('prev').style.animation).toBe('');
    expect(screen.getByTestId('prev').style.filter).toBe('');
    expect(screen.getByTestId('stack').style.animation).toBe(`solo2-fade-in 1s ${E} 1s both`);
  });

  it('the veil stays inside the picture unless it is told to flood the panel', () => {
    dip({ veilStyle: 'lift', veilCovers: 'panel' });
    expect(screen.getByTestId('dip')).toHaveStyle({ width: '100%', height: '100%' });
    cleanup();
    // Inside the picture: the veil takes the picture box, the same one the stack sits in.
    dip({ veilStyle: 'lift' });
    const veil = screen.getByTestId('dip').style;
    const stack = screen.getByTestId('stack').style;
    expect(veil.width).toBe(stack.width);
    expect(veil.left).toBe(stack.left);
    expect(veil.width).not.toBe('100%');
  });

  it('the ease dial reaches the steps inside a run, not just the change between cameras', () => {
    render(<Solo2Frame entry={e} run={run} previous={null} stage={{ index: 1, leadProgress: 0 }} plan={plan}
      dials={{ ...D, sameCameraFadeS: 1, arrivalEase: 'soft' }} width={100} height={50} feed="sunrise" />);
    expect(screen.getByTestId('seq-1')).toHaveStyle({ transition: `opacity 1s ${ARRIVAL_EASES.soft}` });
  });
});

it('inside a run only the clock moves, and inside the clock only the part that changed: the two readings crossfade over the same seconds', () => {
  // A real run is one camera, so every frame carries the same words.
  const sameCam = run.map((f) => ({ ...f, title: 'Pier' }));
  const { rerender } = render(<Solo2Frame entry={e} run={sameCam} previous={null} stage={{ index: 1, leadProgress: 0 }} plan={plan}
    dials={{ ...D, sameCameraFadeS: 1 }} width={1920} height={1080} />);
  expect(drawnTime()).toBe('7:32 pm there');
  // Only the minute's first digit animates: "7:" holds and so does "2 pm there".
  // Both halves run on the same curve the picture beneath them is dissolving
  // on — arrivalEase, not a hardcoded one — so no layer of the change arrives
  // ahead of another.
  expect(screen.getByTestId('caption-time-head')).toHaveTextContent('3');
  expect(screen.getByTestId('caption-time-head')).toHaveStyle({ animation: `solo-time-in 1s ${ARRIVAL_EASES.gentle} both` });
  expect(screen.getByTestId('caption-time-out')).toHaveTextContent('2');
  // No delay on either: out and in run together, the way the picture dissolves.
  expect(screen.getByTestId('caption-time-out')).toHaveStyle({ animation: `solo-time-out 1s ${ARRIVAL_EASES.gentle} both` });

  // Stepping again keeps the very same caption element, and the tail with it:
  // the title, the place and "pm there" hold still while the clock swaps.
  const held = screen.getByTestId('caption-layer');
  const tail = screen.getByTestId('caption-time');
  rerender(<Solo2Frame entry={e} run={sameCam} previous={null} stage={{ index: 2, leadProgress: 0 }} plan={plan}
    dials={{ ...D, sameCameraFadeS: 1 }} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-layer')).toBe(held);
  expect(screen.getByTestId('caption-time')).toBe(tail);
  expect(drawnTime()).toBe('7:42 pm there');
  expect(screen.getByTestId('caption-time-head')).toHaveTextContent('4');
  expect(screen.getByTestId('caption-time-out')).toHaveTextContent('3');
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
