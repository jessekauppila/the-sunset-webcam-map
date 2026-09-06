import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import type { WindyWebcam } from '@/app/lib/types';

/** jsdom has no ResizeObserver; StudioPanelFrame renders for real in these tests. */
class StubResizeObserver {
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: { width: 700, height: 900 } as DOMRectReadOnly,
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = StubResizeObserver;

interface MosaicProps {
  feed: string;
  webcams: Array<{ webcamId: number }>;
  peerWebcams?: Array<{ webcamId: number }>;
  at?: string | number;
  onSelect?: (webcam: { webcamId: number }) => void;
}

let capturedFeeds: string[] = [];
/** The props each feed's mosaic was last rendered with. */
let capturedProps: Record<string, MosaicProps> = {};

vi.mock('@/app/components/mosaic/registry', () => ({
  resolveMosaic: () =>
    (props: MosaicProps) => {
      capturedFeeds.push(props.feed);
      capturedProps[props.feed] = props;
      // Stands in for the real versions' canvas hit-testing: every version
      // fires onSelect with the webcam behind the tile that was clicked.
      return (
        <div data-testid={`mosaic-${props.feed}`}>
          {props.webcams.map((w) => (
            <div
              key={w.webcamId}
              data-testid={`tile-${w.webcamId}`}
              onClick={() => props.onSelect?.(w)}
            />
          ))}
        </div>
      );
    },
  resolveMosaicName: (v: string | null | undefined) => v ?? 'v1',
}));

import { MosaicPreview } from './MosaicPreview';

const PANEL = { width: 1440, height: 2560 };

function fakeWebcams(): WindyWebcam[] {
  return [{ webcamId: 1, title: 'sunrise cam' } as unknown as WindyWebcam];
}

const cam = (webcamId: number): WindyWebcam =>
  ({ webcamId, title: `cam ${webcamId}` } as unknown as WindyWebcam);

describe('MosaicPreview', () => {
  beforeEach(() => {
    capturedFeeds = [];
    capturedProps = {};
    useTerminatorStore.setState({
      sunrise: fakeWebcams(),
      sunset: fakeWebcams(),
      combined: [],
      loading: false,
      error: undefined,
    });
  });

  it('hands each screen the OTHER feed as peerWebcams, so the two share one scale', () => {
    useTerminatorStore.setState({
      sunrise: [cam(11)],
      sunset: [cam(22)],
      combined: [],
      loading: false,
      error: undefined,
    });

    render(
      <MosaicPreview
        versionName="v1"
        panel={PANEL}
        sceneSource={{ kind: 'live' }}
        sceneState={null}
      />
    );

    expect(capturedProps.sunrise.webcams.map((w) => w.webcamId)).toEqual([11]);
    expect(capturedProps.sunrise.peerWebcams?.map((w) => w.webcamId)).toEqual([22]);
    expect(capturedProps.sunset.webcams.map((w) => w.webcamId)).toEqual([22]);
    expect(capturedProps.sunset.peerWebcams?.map((w) => w.webcamId)).toEqual([11]);
  });

  it('passes the scene\'s moment through to the mosaic as `at`', () => {
    render(
      <MosaicPreview
        versionName="v1"
        panel={PANEL}
        sceneSource={{ kind: 'scene', id: 7 }}
        sceneState={{ sunrise: [cam(11)], sunset: [cam(22)] }}
        at="2026-09-05T02:30:00.000Z"
      />
    );

    expect(capturedProps.sunrise.at).toBe('2026-09-05T02:30:00.000Z');
    expect(capturedProps.sunset.at).toBe('2026-09-05T02:30:00.000Z');
  });

  it('renders both feeds with the resolved version', () => {
    render(
      <MosaicPreview
        versionName="v1"
        panel={PANEL}
        sceneSource={{ kind: 'live' }}
        sceneState={null}
      />
    );

    expect(screen.getAllByTestId('studio-panel-stage')).toHaveLength(2);
    expect(capturedFeeds.sort()).toEqual(['sunrise', 'sunset']);
  });

  it('opens a detail card for the camera whose tile was clicked, and closes it', () => {
    render(
      <MosaicPreview
        versionName="v2"
        panel={PANEL}
        sceneSource={{ kind: 'live' }}
        sceneState={null}
      />
    );

    expect(screen.queryByTestId('studio-tile-detail')).toBeNull();
    fireEvent.click(screen.getAllByTestId('tile-1')[0]);
    const detail = screen.getByTestId('studio-tile-detail');
    expect(detail.textContent).toContain('Rate this sunset');

    fireEvent.click(screen.getByTestId('studio-tile-detail-close'));
    expect(screen.queryByTestId('studio-tile-detail')).toBeNull();
  });

  it('offers the rating control (capture) on a live tile', () => {
    render(
      <MosaicPreview
        versionName="v2"
        panel={PANEL}
        sceneSource={{ kind: 'live' }}
        sceneState={null}
      />
    );

    fireEvent.click(screen.getAllByTestId('tile-1')[0]);
    expect(screen.getByRole('button', { name: /not a sunset/i })).toBeTruthy();
  });

  it('withholds the rating control on a scene tile with no archived frame', () => {
    render(
      <MosaicPreview
        versionName="v2"
        panel={PANEL}
        sceneSource={{ kind: 'scene', id: 4 }}
        sceneState={{
          sunrise: [],
          sunset: [{ webcamId: 9, title: 'frozen cam' } as unknown as WindyWebcam],
        }}
      />
    );

    fireEvent.click(screen.getByTestId('tile-9'));
    expect(screen.queryByRole('button', { name: /not a sunset/i })).toBeNull();
    expect(screen.getByTestId('studio-tile-detail').textContent).toContain('nothing to label');
  });

  it('renders no tiles and no stages when a scene is selected but not yet loaded', () => {
    render(
      <MosaicPreview
        versionName="v1"
        panel={PANEL}
        sceneSource={{ kind: 'scene', id: 1 }}
        sceneState={null}
      />
    );

    // Live store has webcamId 1 in both feeds (see beforeEach) — it must not leak through.
    expect(screen.queryByTestId('tile-1')).toBeNull();
    expect(screen.queryAllByTestId('studio-panel-stage')).toHaveLength(0);
    expect(screen.getByText('loading scene…')).toBeTruthy();
  });
});
