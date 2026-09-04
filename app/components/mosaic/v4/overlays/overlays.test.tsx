import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedLabel } from './FeedLabel';
import { TileRatings } from './TileRatings';
import { SetupOverlay } from './SetupOverlay';
import { ModelReadout } from './ModelReadout';
import { CentreLine } from './CentreLine';
import type { Layout } from '../engine/types';
import { v4Config } from '../engine/testConfig';
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
  evicted: [8, 9],
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

const ratingCfg = v4Config({
  qualitySource: 'auto', gateThreshold: 0.55, scoreFloor: 0, scoreCeiling: 1,
  exitTaperDeg: 6, axisNightEdgeDeg: -24, axisDayEdgeDeg: -2, curve: 'linear',
});
const ratingProps = { cfg: ratingCfg, feed: 'sunset' as const };

const withTile = (over: Partial<Layout['tiles'][number]>): Layout => {
  const base = layout();
  return { ...base, tiles: [{ ...base.tiles[0], ...over }] };
};

const idFor = (cam: WindyWebcam) =>
  new Map([[1, { img: {} as HTMLImageElement, webcam: cam }]]);

describe('TileRatings', () => {
  it('renders a chip per tile', () => {
    render(<TileRatings layout={layout()} byId={byId()} {...ratingProps} />);
    expect(screen.getAllByTestId('v4-rating-chip')).toHaveLength(1);
  });

  it('marks gate-passers distinctly from floored tiles', () => {
    render(<TileRatings layout={layout()} byId={byId()} {...ratingProps} />);
    expect(screen.getByTestId('v4-rating-chip')).toHaveAttribute('data-passes', 'true');
  });

  it('names the judge, because the gate dial only acts on the model one', () => {
    render(<TileRatings layout={layout()} byId={byId()} {...ratingProps} />);
    expect(screen.getByTestId('v4-rating-chip')).toHaveAttribute('data-judge', 'model');
  });

  // The number that sizes the tile is the quality head, and it is the ONE
  // number an operator needs to read against the tile's size. Unlabelled, the
  // 1-5 detection figure on the next line got read as "the score" and a
  // quality-0.52 tile beside a quality-0.04 one looked like a sizing bug.
  it('labels the sizing score as quality and shows the height it produced', () => {
    render(<TileRatings layout={layout()} byId={byId()} {...ratingProps} />);
    const chip = screen.getByTestId('v4-rating-chip');
    expect(chip).toHaveTextContent('quality 0.80 ✓');
    expect(chip).toHaveTextContent('75px');
  });

  it('labels the two numbers the gate compared, on the rating scale', () => {
    render(<TileRatings layout={layout()} byId={byId()} {...ratingProps} />);
    // aiRatingBinary 4 against a 0.55 threshold, which is 3.20 as a rating.
    expect(screen.getByTestId('v4-rating-chip')).toHaveTextContent('detect 4.00 ≥ gate 3.20');
  });

  it('says a gate-failer is at the floor because of the gate, not its quality', () => {
    const failer = { webcamId: 1, title: 'cam', aiRatingBinary: 2, aiRatingRegression: 4.2 } as WindyWebcam;
    render(
      <TileRatings
        layout={withTile({ passes: false, pinnedToFloor: true, height: 40 })}
        byId={idFor(failer)}
        {...ratingProps}
      />
    );
    const chip = screen.getByTestId('v4-rating-chip');
    expect(chip).toHaveTextContent('quality 0.80 ✗');
    expect(chip).toHaveTextContent('detect 2.00 < gate 3.20');
    expect(chip).toHaveTextContent('floor · failed gate');
  });

  it('explains a passer sitting at the floor because its quality is under the score floor', () => {
    render(
      <TileRatings
        layout={layout()}
        byId={byId()}
        cfg={v4Config({ ...ratingCfg, scoreFloor: 0.9 })}
        feed="sunset"
      />
    );
    expect(screen.getByTestId('v4-rating-chip')).toHaveTextContent('floor · quality ≤ 0.90');
  });

  it('explains the exit taper when the camera is leaving the window', () => {
    // 3° inside a 6° taper on the -24 night edge: smoothstep(0.5) = 0.50.
    render(
      <TileRatings layout={withTile({ sunAltitudeDeg: -21 })} byId={byId()} {...ratingProps} />
    );
    expect(screen.getByTestId('v4-rating-chip')).toHaveTextContent('exit taper ×0.50');
  });

  it('explains a passer past the exit edge, which the taper pins to the floor', () => {
    render(
      <TileRatings layout={withTile({ sunAltitudeDeg: -26 })} byId={byId()} {...ratingProps} />
    );
    expect(screen.getByTestId('v4-rating-chip')).toHaveTextContent('floor · past night edge');
  });

  it('adds no explanation when the tile is simply at its quality height', () => {
    render(<TileRatings layout={layout()} byId={byId()} {...ratingProps} />);
    const text = screen.getByTestId('v4-rating-chip').textContent ?? '';
    expect(text).not.toMatch(/floor|taper/);
  });

  it('names Claude as the judge and says the gate is inert for llm frames', () => {
    const llmCam = { webcamId: 1, title: 'cam', llmIsSunset: true, llmQuality: 0.8 } as WindyWebcam;
    render(<TileRatings layout={layout()} byId={idFor(llmCam)} {...ratingProps} />);
    const chip = screen.getByTestId('v4-rating-chip');
    expect(chip).toHaveAttribute('data-judge', 'llm');
    expect(chip).toHaveTextContent('claude 0.80 ✓');
    expect(chip).toHaveTextContent('claude says sunset · gate n/a');
  });

  it('says unscored rather than printing dashes for a frame no judge saw', () => {
    render(
      <TileRatings
        layout={withTile({ passes: false, score: null, pinnedToFloor: true })}
        byId={idFor(unscoredWebcam)}
        {...ratingProps}
      />
    );
    expect(screen.getByTestId('v4-rating-chip')).toHaveTextContent('unscored');
  });

  it('scales the text so it is readable across a room', () => {
    render(<TileRatings layout={layout()} byId={byId()} {...ratingProps} scale={3} />);
    expect(screen.getByTestId('v4-rating-chip')).toHaveStyle({ fontSize: '30px' });
  });
});

describe('SetupOverlay', () => {
  it('reports tile, dropped and skipped counts', () => {
    render(<SetupOverlay layout={layout()} feed="sunset" skipped={3} />);
    expect(screen.getByTestId('v4-setup-counts')).toHaveTextContent('tiles 1');
    expect(screen.getByTestId('v4-setup-counts')).toHaveTextContent('dropped 1');
    expect(screen.getByTestId('v4-setup-counts')).toHaveTextContent('skipped 3');
  });

  it('shows the held count so a carried-over tile is not mistaken for live', () => {
    render(<SetupOverlay layout={layout()} feed="sunset" skipped={3} held={2} />);
    expect(screen.getByTestId('v4-setup-counts')).toHaveTextContent('held 2');
  });

  it('shows the applied composition scale so shrinking is visible', () => {
    render(<SetupOverlay layout={layout()} feed="sunset" skipped={0} />);
    expect(screen.getByTestId('v4-setup-counts')).toHaveTextContent('scale 0.80');
  });

  it('counts evictions separately from overflow drops', () => {
    // Two mechanisms, two numbers (spec §5.6). Conflating them would make an
    // ordinary crowded band read as an overflow emergency.
    render(<SetupOverlay layout={layout()} feed="sunset" skipped={2} />);
    const line = screen.getByTestId('v4-setup-counts').textContent ?? '';
    expect(line).toContain('dropped 1');
    expect(line).toContain('evicted 2');
  });
});

describe('ModelReadout', () => {
  it('renders a chip containing both readouts', () => {
    render(<ModelReadout layout={layout()} byId={byId()} />);
    const chip = screen.getByTestId('v4-model-chip');
    // Both heads named, so the two numbers cannot be read as one score.
    expect(chip).toHaveTextContent('detect 0.75 · sunset');
    expect(chip).toHaveTextContent('quality 4.2 / 5');
  });

  it('renders exactly one "not scored" line and nothing bogus when neither readout is present', () => {
    const unscoredById = new Map([
      [1, { img: {} as HTMLImageElement, webcam: unscoredWebcam }],
    ]);
    render(<ModelReadout layout={layout()} byId={unscoredById} />);
    const chip = screen.getByTestId('v4-model-chip');
    expect(chip.textContent?.match(/not scored/g)).toHaveLength(1);
    expect(chip.textContent).not.toMatch(/NaN|null|undefined/);
  });

  it('carries the overlay testid the index test depends on', () => {
    render(<ModelReadout layout={layout()} byId={byId()} />);
    expect(screen.getByTestId('v4-model-overlay')).toBeInTheDocument();
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
    const chips = screen.getAllByTestId('v4-model-chip');
    expect(chips[0]).toHaveTextContent('floored');
    expect(chips[1]).not.toHaveTextContent('floored');
  });
});

describe('CentreLine', () => {
  const cfg = { axisNightEdgeDeg: -24, axisDayEdgeDeg: -2 };

  it('marks the pool ring at the middle of the panel', () => {
    render(<CentreLine cfg={cfg} feed="sunset" width={1080} height={1920} />);
    expect(screen.getByTestId('v4-centre-line')).toHaveStyle({ left: '540px' });
  });

  it('follows the axis dials rather than assuming the middle', () => {
    // A window whose ring is not centred: across -16 to -4, the ring at -13
    // sits a quarter of the way up from the night edge, so on the sunrise
    // feed the line lands at 0.25 * width.
    render(
      <CentreLine
        cfg={{ axisNightEdgeDeg: -16, axisDayEdgeDeg: -4 }}
        feed="sunrise" width={1200} height={1920}
      />
    );
    expect(screen.getByTestId('v4-centre-line')).toHaveStyle({ left: '300px' });
  });

  it('names the altitude it is marking', () => {
    render(<CentreLine cfg={cfg} feed="sunset" width={1080} height={1920} />);
    expect(screen.getByTestId('v4-centre-line').textContent).toContain('-13');
  });
});
