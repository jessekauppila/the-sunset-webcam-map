import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SoloFrame } from './SoloFrame';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const AT = Date.UTC(2026, 8, 5, 2, 42); // 7:42 pm in Mazatlán
const e = {
  snapshotId: 1, webcamId: 1, bin: 'sunset' as const, quality: 0.91, detection: 0.88, isNew: false, tally: 2, enteredAt: 0,
  imageUrl: 'u1', title: 'Split › West', city: 'Split', region: 'Split-Dalmatia County', country: 'Croatia', eligible: true, rank: 3,
  capturedAt: AT, timezone: 'America/Mazatlan', sunAltitudeDeg: null,
};

it('by default: the picture inset on black, the tidied title, the place, and the time there, each its own line', () => {
  render(<SoloFrame entry={e} previous={null} fadeS={0} dials={D} width={1920} height={1080} />);
  const img = screen.getByRole('presentation');
  // 87 % of 1080 = 940 tall, 16:9 → 1671 wide, centred, 4 % down
  expect(img).toHaveStyle({ left: '125px', top: '43px', width: '1671px', height: '940px' });
  expect(screen.getByTestId('caption-title')).toHaveTextContent('Split');
  expect(screen.getByTestId('caption-place')).toHaveTextContent('Split-Dalmatia County, Croatia');
  expect(screen.getByTestId('caption-time')).toHaveTextContent('7:42 pm there');
  expect(screen.queryByText(/shown/)).toBeNull();
  expect(screen.queryByText(/q 0\.91/)).toBeNull();
});

it('caption sizes are glass pixels: the dialled px on a 1920 panel, and the grays are percent of white', () => {
  render(<SoloFrame entry={e} previous={null} fadeS={0} dials={D} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-title')).toHaveStyle({ fontSize: '21px', fontWeight: '300', color: 'rgb(181, 181, 181)' });
  expect(screen.getByTestId('caption-place')).toHaveStyle({ fontSize: '17px', color: 'rgb(145, 145, 145)' });
  expect(screen.getByTestId('caption-time')).toHaveStyle({ fontSize: '12px', color: 'rgb(117, 117, 117)' });
  // flush with the picture's left edge, the gap above the panel's bottom edge
  expect(screen.getByTestId('caption')).toHaveStyle({ left: '125px', bottom: '18px', maxWidth: '1671px' });
});

it('on a half-size panel everything halves', () => {
  render(<SoloFrame entry={e} previous={null} fadeS={0} dials={D} width={960} height={540} />);
  expect(screen.getByRole('presentation')).toHaveStyle({ width: '836px', height: '470px' });
  expect(screen.getByTestId('caption-title')).toHaveStyle({ fontSize: '10.5px' });
  expect(screen.getByTestId('caption')).toHaveStyle({ bottom: '9px' });
});

it('overlay layout: the picture fills the panel and the caption floats over it with a shadow', () => {
  render(<SoloFrame entry={e} previous={null} fadeS={0} dials={{ ...D, captionLayout: 'overlay' }} width={1920} height={1080} />);
  expect(screen.getByRole('presentation')).toHaveStyle({ left: '0px', top: '0px', width: '1920px', height: '1080px' });
  expect(screen.getByTestId('caption')).toHaveStyle({ left: '24px', bottom: '20px', textShadow: '0 1px 4px #000' });
});

it('inline time joins the place line with a dot; time off drops it; raw title keeps the compass', () => {
  const { rerender } = render(<SoloFrame entry={e} previous={null} fadeS={0} dials={{ ...D, timeLine: 'inline', timeStyle: '24h' }} width={1920} height={1080} />);
  expect(screen.getByTestId('caption-place')).toHaveTextContent('Split-Dalmatia County, Croatia · 19:42');
  rerender(<SoloFrame entry={e} previous={null} fadeS={0} dials={{ ...D, timeStyle: 'off', titleClean: 'raw' }} width={1920} height={1080} />);
  expect(screen.queryByTestId('caption-time')).toBeNull();
  expect(screen.getByTestId('caption-title')).toHaveTextContent('Split › West');
});

it('draws scores, rank, and tally when dialled on; hides the caption when the place is off', () => {
  render(<SoloFrame entry={e} previous={null} fadeS={0}
    dials={{ ...D, showPlace: false, showScores: true, showRank: true, showTally: true }} width={1920} height={1080} />);
  expect(screen.queryByTestId('caption')).toBeNull();
  expect(screen.getByText(/q 0\.91 · d 0\.88/)).toBeInTheDocument();
  expect(screen.getByText(/sunset bin #3/)).toBeInTheDocument();
  expect(screen.getByText(/×2/)).toBeInTheDocument();
});

it('keeps the previous frame underneath, in the same picture box, and sets the fade duration on the top layer', () => {
  const prev = { ...e, snapshotId: 0, imageUrl: 'u0' };
  render(<SoloFrame entry={e} previous={prev} fadeS={3} dials={D} width={1920} height={1080} />);
  const imgs = screen.getAllByRole('presentation');
  expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['u0', 'u1']);
  expect(imgs[0]).toHaveStyle({ left: '125px', width: '1671px' });
  expect(imgs[1]).toHaveStyle({ transition: 'opacity 3s ease' });
});
