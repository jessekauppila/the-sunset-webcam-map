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

let capturedFeeds: string[] = [];
let capturedAt: Array<string | number | undefined> = [];
const capturedPeers = new Map<string, Array<{ webcamId: number }>>();

vi.mock('@/app/components/mosaic/registry', () => ({
  resolveMosaic: () =>
    (props: {
      feed: string;
      webcams: Array<{ webcamId: number }>;
      peerWebcams?: Array<{ webcamId: number }>;
      at?: string | number;
    }) => {
      capturedFeeds.push(props.feed);
      capturedAt.push(props.at);
      capturedPeers.set(props.feed, props.peerWebcams ?? []);
      return (
        <div data-testid={`mosaic-${props.feed}`}>
          {props.webcams.map((w) => (
            <div key={w.webcamId} data-testid={`tile-${w.webcamId}`} />
          ))}
        </div>
      );
    },
  resolveMosaicName: (v: string | null | undefined) => v ?? 'v1',
}));

import { PreviewPane } from './PreviewPane';

const PANEL = { width: 1440, height: 2560 };

function fakeWebcams(): WindyWebcam[] {
  return [
    { webcamId: 1, title: 'sunrise cam' } as unknown as WindyWebcam,
  ];
}

describe('PreviewPane', () => {
  beforeEach(() => {
    capturedFeeds = [];
    capturedAt = [];
    capturedPeers.clear();
    useTerminatorStore.setState({
      sunrise: fakeWebcams(),
      sunset: fakeWebcams(),
      combined: [],
      loading: false,
      error: undefined,
    });
  });

  it("renders both stages for view='both'", () => {
    render(
      <PreviewPane
        view="both"
        onViewChange={() => {}}
        panel={PANEL}
        panelPresetLabel="ktc · 1440×2560"
        versionName="v1"
      />
    );

    expect(screen.getAllByTestId('studio-panel-stage')).toHaveLength(2);
    expect(capturedFeeds.sort()).toEqual(['sunrise', 'sunset']);
  });

  it('gives each panel the other feed as its peer', () => {
    useTerminatorStore.setState({
      sunrise: [{ webcamId: 11 }] as unknown as WindyWebcam[],
      sunset: [{ webcamId: 22 }, { webcamId: 33 }] as unknown as WindyWebcam[],
    });

    render(
      <PreviewPane
        view="both"
        onViewChange={() => {}}
        panel={PANEL}
        panelPresetLabel="ktc · 1440×2560"
        versionName="v1"
      />
    );

    expect(capturedPeers.get('sunrise')!.map((w) => w.webcamId)).toEqual([22, 33]);
    expect(capturedPeers.get('sunset')!.map((w) => w.webcamId)).toEqual([11]);
  });

  it('still supplies the peer in single-feed view, so one panel looks the same alone', () => {
    useTerminatorStore.setState({
      sunrise: [{ webcamId: 11 }] as unknown as WindyWebcam[],
      sunset: [{ webcamId: 22 }, { webcamId: 33 }] as unknown as WindyWebcam[],
    });

    render(
      <PreviewPane
        view="sunrise"
        onViewChange={() => {}}
        panel={PANEL}
        panelPresetLabel="ktc · 1440×2560"
        versionName="v1"
      />
    );

    expect(capturedPeers.get('sunrise')!.map((w) => w.webcamId)).toEqual([22, 33]);
  });

  it("renders one stage for view='sunset'", () => {
    render(
      <PreviewPane
        view="sunset"
        onViewChange={() => {}}
        panel={PANEL}
        panelPresetLabel="ktc · 1440×2560"
        versionName="v1"
      />
    );

    expect(screen.getAllByTestId('studio-panel-stage')).toHaveLength(1);
    expect(capturedFeeds).toEqual(['sunset']);
  });

  it("calls onViewChange('sunrise') when the sunrise segment is clicked", () => {
    let seen: string | null = null;
    render(
      <PreviewPane
        view="both"
        onViewChange={(v) => {
          seen = v;
        }}
        panel={PANEL}
        panelPresetLabel="ktc · 1440×2560"
        versionName="v1"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^sunrise$/i }));
    expect(seen).toBe('sunrise');
  });

  it('renders the geometry chip with panelPresetLabel', () => {
    render(
      <PreviewPane
        view="both"
        onViewChange={() => {}}
        panel={PANEL}
        panelPresetLabel="ktc · 1440×2560"
        versionName="v1"
      />
    );

    expect(screen.getByText('ktc · 1440×2560')).toBeTruthy();
  });

  it('renders scene state webcams instead of the live store when a scene is selected', () => {
    render(
      <PreviewPane
        view="sunset"
        onViewChange={() => {}}
        panel={PANEL}
        panelPresetLabel="ktc · 1440×2560"
        versionName="v1"
        scenes={[
          {
            id: 1,
            label: 'solstice',
            tags: [],
            representsAt: '2026-06-21T11:45:00Z',
            source: 'historical',
            createdAt: '2026-06-21T11:45:00Z',
          },
        ]}
        sceneSource={{ kind: 'scene', id: 1 }}
        onSceneSourceChange={() => {}}
        sceneState={{
          sunrise: [],
          sunset: [{ webcamId: 42, title: 'scene sunset cam' } as unknown as WindyWebcam],
        }}
      />
    );

    expect(screen.getByTestId('tile-42')).toBeTruthy();
    expect(screen.queryByTestId('tile-1')).toBeNull();
  });

  it('renders no live tiles and a loading status when a scene is selected but not yet loaded', () => {
    render(
      <PreviewPane
        view="sunset"
        onViewChange={() => {}}
        panel={PANEL}
        panelPresetLabel="ktc · 1440×2560"
        versionName="v1"
        scenes={[
          {
            id: 1,
            label: 'solstice',
            tags: [],
            representsAt: '2026-06-21T11:45:00Z',
            source: 'historical',
            createdAt: '2026-06-21T11:45:00Z',
          },
        ]}
        sceneSource={{ kind: 'scene', id: 1 }}
        onSceneSourceChange={() => {}}
        sceneState={null}
      />
    );

    // Live store has webcamId 1 in both feeds (see beforeEach) — it must not leak through.
    expect(screen.queryByTestId('tile-1')).toBeNull();
    expect(screen.getByText('loading scene…')).toBeTruthy();
  });

  it('renders no live tiles and the hook error when a scene fails to load', () => {
    render(
      <PreviewPane
        view="sunset"
        onViewChange={() => {}}
        panel={PANEL}
        panelPresetLabel="ktc · 1440×2560"
        versionName="v1"
        scenes={[
          {
            id: 1,
            label: 'solstice',
            tags: [],
            representsAt: '2026-06-21T11:45:00Z',
            source: 'historical',
            createdAt: '2026-06-21T11:45:00Z',
          },
        ]}
        sceneSource={{ kind: 'scene', id: 1 }}
        onSceneSourceChange={() => {}}
        sceneState={null}
        error="/api/kiosk/scenes/1: 404"
      />
    );

    expect(screen.queryByTestId('tile-1')).toBeNull();
    expect(screen.getByText('/api/kiosk/scenes/1: 404')).toBeTruthy();
  });

  it('passes the scene moment down to the mosaic', () => {
    // The brief's DOM-text assertion doesn't fit this file's mock (feed
    // labels render lowercase, not "SUNSET") — assert on the `at` prop the
    // mocked Mosaic actually receives instead, per this file's existing
    // capture-and-inspect pattern.
    render(
      <PreviewPane
        view="sunset"
        onViewChange={() => {}}
        panel={PANEL}
        panelPresetLabel="test"
        versionName="v2"
        at="2026-03-14T17:30:00.000Z"
      />
    );

    expect(capturedAt).toEqual(['2026-03-14T17:30:00.000Z']);
  });
});

describe('PreviewPane — telling captures from rebuilds', () => {
  it('marks each scene with the population it came from', () => {
    render(
      <PreviewPane
        view="both"
        onViewChange={() => {}}
        panel={PANEL}
        panelPresetLabel="ktc · 1440×2560"
        versionName="v1"
        scenes={[
          { id: 1, label: 'tonight', tags: [], representsAt: '2026-08-31T02:00:00Z',
            source: 'live', createdAt: '2026-08-31T02:00:00Z', windowMinutes: 15 },
          { id: 2, label: 'equinox', tags: [], representsAt: '2026-03-20T02:00:00Z',
            source: 'historical', createdAt: '2026-09-02T02:00:00Z', windowMinutes: 45 },
        ]}
      />
    );

    const select = screen.getByTestId('studio-scene-select');
    expect(select).toHaveTextContent('tonight · captured');
    expect(select).toHaveTextContent('equinox · rebuilt');
  });
});
