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

vi.mock('@/app/components/mosaic/registry', () => ({
  resolveMosaic: () => (props: { feed: string; webcams: Array<{ webcamId: number }> }) => {
    capturedFeeds.push(props.feed);
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
});
