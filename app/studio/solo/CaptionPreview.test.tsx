import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CaptionPreview } from './CaptionPreview';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';
import type { StateView } from '@/app/api/kiosk/solo/view';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const entry = {
  snapshotId: 7, webcamId: 1, bin: 'sunset' as const, quality: 0.9, detection: 0.9, isNew: false, tally: 1, enteredAt: 0,
  imageUrl: 'u7', title: 'Porjus › North-west: Northern Lights webcam', city: 'Porjus', region: 'Norrbotten County', country: 'Sweden',
  eligible: true, rank: 1, capturedAt: Date.UTC(2026, 8, 5, 18, 46), timezone: 'Europe/Stockholm', sunAltitudeDeg: null,
};
const server = { current: { entry, shownSince: 0, slot: 1 } } as unknown as StateView;

it('draws each screen\'s current frame with the studio dials, and says when a screen has nothing', () => {
  render(<CaptionPreview screens={[{ feed: 'sunrise', server }, { feed: 'sunset', server: null }]}
    dials={{ ...D, titleClean: 'spot' }} panel={{ width: 1920, height: 1080 }} />);
  expect(screen.getByTestId('caption-title')).toHaveTextContent('Northern Lights webcam');
  expect(screen.getByTestId('caption-place')).toHaveTextContent('Porjus, Norrbotten County, Sweden');
  expect(screen.getByTestId('caption-time')).toHaveTextContent('8:46 pm there');
  expect(screen.getByText(/on glass now · frame 7/)).toBeInTheDocument();
  expect(screen.getByText('no frame to preview')).toBeInTheDocument();
  expect(screen.getAllByText('1920 × 1080')).toHaveLength(2);
});
