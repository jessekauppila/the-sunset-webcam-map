import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SoloFrame } from './SoloFrame';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const e = {
  snapshotId: 1, webcamId: 1, bin: 'sunset' as const, quality: 0.91, detection: 0.88, isNew: false, tally: 2, enteredAt: 0,
  imageUrl: 'u1', title: 'Pier', city: 'Lisbon', region: 'Lisboa', country: 'Portugal', eligible: true, rank: 3,
  capturedAt: 0, timezone: null, sunAltitudeDeg: null,
};

it('draws the place by default and nothing else', () => {
  render(<SoloFrame entry={e} previous={null} fadeS={0} dials={D} width={1920} height={1080} />);
  expect(screen.getByText('Pier')).toBeInTheDocument();
  expect(screen.getByText(/Lisboa, Portugal/)).toBeInTheDocument();
  expect(screen.queryByText(/shown/)).toBeNull();
  expect(screen.queryByText(/q 0\.91/)).toBeNull();
});

it('draws scores, rank, and tally when dialled on; hides the place when dialled off', () => {
  render(<SoloFrame entry={e} previous={null} fadeS={0}
    dials={{ ...D, showPlace: false, showScores: true, showRank: true, showTally: true }} width={1920} height={1080} />);
  expect(screen.queryByText('Pier')).toBeNull();
  expect(screen.getByText(/q 0\.91 · d 0\.88/)).toBeInTheDocument();
  expect(screen.getByText(/sunset bin #3/)).toBeInTheDocument();
  expect(screen.getByText(/×2/)).toBeInTheDocument();
});

it('keeps the previous frame underneath and sets the fade duration on the top layer', () => {
  const prev = { ...e, snapshotId: 0, imageUrl: 'u0' };
  render(<SoloFrame entry={e} previous={prev} fadeS={3} dials={D} width={1920} height={1080} />);
  const imgs = screen.getAllByRole('presentation');
  expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['u0', 'u1']);
  expect(imgs[1]).toHaveStyle({ transition: 'opacity 3s ease' });
});
