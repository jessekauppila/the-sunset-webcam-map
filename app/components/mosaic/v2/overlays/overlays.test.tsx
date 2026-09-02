import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedLabel } from './FeedLabel';
import { TileRatings } from './TileRatings';
import { SetupOverlay } from './SetupOverlay';
import { ModelReadout } from './ModelReadout';
import type { Layout } from '../engine/types';
import type { WindyWebcam } from '@/app/lib/types';

const webcam = {
  webcamId: 1, title: 'cam', aiRatingBinary: 4, aiRatingRegression: 4.2,
} as WindyWebcam;

const unscoredWebcam = { webcamId: 2, title: 'unscored cam' } as WindyWebcam;

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
    expect(screen.getByTestId('v2-setup-counts')).toHaveTextContent('tiles 1');
    expect(screen.getByTestId('v2-setup-counts')).toHaveTextContent('dropped 1');
    expect(screen.getByTestId('v2-setup-counts')).toHaveTextContent('skipped 3');
  });

  it('shows the applied composition scale so shrinking is visible', () => {
    render(<SetupOverlay layout={layout()} feed="sunset" skipped={0} />);
    expect(screen.getByTestId('v2-setup-counts')).toHaveTextContent('scale 0.80');
  });
});

describe('ModelReadout', () => {
  it('renders a chip containing both readouts', () => {
    render(<ModelReadout layout={layout()} byId={byId()} />);
    const chip = screen.getByTestId('v2-model-chip');
    expect(chip).toHaveTextContent('sunset 0.75');
    expect(chip).toHaveTextContent('4.2');
  });

  it('renders exactly one "not scored" line and nothing bogus when neither readout is present', () => {
    const unscoredById = new Map([
      [1, { img: {} as HTMLImageElement, webcam: unscoredWebcam }],
    ]);
    render(<ModelReadout layout={layout()} byId={unscoredById} />);
    const chip = screen.getByTestId('v2-model-chip');
    expect(chip.textContent?.match(/not scored/g)).toHaveLength(1);
    expect(chip.textContent).not.toMatch(/NaN|null|undefined/);
  });

  it('carries the overlay testid the index test depends on', () => {
    render(<ModelReadout layout={layout()} byId={byId()} />);
    expect(screen.getByTestId('v2-model-overlay')).toBeInTheDocument();
  });

  it('shows the floored badge when pinnedToFloor is true, and hides it otherwise', () => {
    const flooredLayout: Layout = {
      ...layout(),
      tiles: [
        { ...layout().tiles[0], id: 1, pinnedToFloor: true },
        { ...layout().tiles[0], id: 2, pinnedToFloor: false },
      ],
    };
    const twoById = new Map([
      [1, { img: {} as HTMLImageElement, webcam }],
      [2, { img: {} as HTMLImageElement, webcam }],
    ]);
    render(<ModelReadout layout={flooredLayout} byId={twoById} />);
    const chips = screen.getAllByTestId('v2-model-chip');
    expect(chips[0]).toHaveTextContent('floored');
    expect(chips[1]).not.toHaveTextContent('floored');
  });
});
