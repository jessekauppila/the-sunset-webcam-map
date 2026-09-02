import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedLabel } from './FeedLabel';
import { TileRatings } from './TileRatings';
import { SetupOverlay } from './SetupOverlay';
import type { Layout } from '../engine/types';
import type { WindyWebcam } from '@/app/lib/types';

const webcam = {
  webcamId: 1, title: 'cam', aiRatingBinary: 4, aiRatingRegression: 4.2,
} as WindyWebcam;

const layout = (): Layout => ({
  tiles: [
    {
      id: 1, lat: 47.6, lng: -122.3, srcWidth: 400, srcHeight: 300,
      passes: true, score: 0.8, sunAltitudeDeg: -13,
      width: 100, height: 75, pinnedToFloor: false, x: 10, y: 20,
    },
  ],
  dropped: [7],
  scale: 0.8,
  viewport: { width: 300, height: 500 },
});

const byId = () => new Map([[1, { img: {} as HTMLImageElement, webcam }]]);

describe('FeedLabel', () => {
  it('shows the feed name in caps', () => {
    render(<FeedLabel feed="sunrise" />);
    expect(screen.getByText('SUNRISE')).toBeInTheDocument();
  });
});

describe('TileRatings', () => {
  it('renders a chip per tile showing the score', () => {
    render(<TileRatings layout={layout()} byId={byId()} />);
    expect(screen.getAllByTestId('v2-rating-chip')).toHaveLength(1);
  });

  it('marks gate-passers distinctly from floored tiles', () => {
    render(<TileRatings layout={layout()} byId={byId()} />);
    expect(screen.getByTestId('v2-rating-chip')).toHaveAttribute('data-passes', 'true');
  });
});

describe('SetupOverlay', () => {
  it('reports tile, dropped and skipped counts', () => {
    render(<SetupOverlay layout={layout()} feed="sunset" skipped={3} />);
    expect(screen.getByTestId('v2-setup-counts')).toHaveTextContent('1');
    expect(screen.getByTestId('v2-setup-counts')).toHaveTextContent('3');
  });

  it('shows the applied composition scale so shrinking is visible', () => {
    render(<SetupOverlay layout={layout()} feed="sunset" skipped={0} />);
    expect(screen.getByTestId('v2-setup-counts')).toHaveTextContent('0.80');
  });
});
