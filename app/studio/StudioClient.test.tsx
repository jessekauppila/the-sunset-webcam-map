import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StudioClient } from './StudioClient';
import { SHARED_SCHEMA } from '@/app/lib/settings/sharedSchema';
import { mergeSettings } from '@/app/lib/settings/schema';
import { MOSAIC_SETTINGS_SCHEMAS } from '@/app/components/mosaic/registry';
import type { StudioSettingsApi } from './useStudioSettings';

/** jsdom has no ResizeObserver; StudioPanelFrame renders for real under both surfaces. */
class StubResizeObserver {
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 700, height: 900 } as DOMRectReadOnly } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = StubResizeObserver;

// The mosaic surface renders the real v4 canvas, and jsdom's getContext throws
// a "not implemented" into the console for every run. The component already
// bails on a null context, so hand it one rather than reading the noise.
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

/**
 * The version the shared namespace names. The whole point of the one-studio
 * page is that this single value decides the rail, the preview and the panel,
 * so each test sets it and asserts what the page turned into.
 */
let activeVersion = 'solo2';

/** Same shape as Rail.test.tsx's helper, with the version under test swapped in. */
function api(): StudioSettingsApi {
  return {
    loading: false, studio: undefined, live: undefined, lastPollAt: null, liveRevision: 3,
    effective: (ns) => ns === 'shared'
      ? mergeSettings(SHARED_SCHEMA, { activeVersion, panelPreset: 'dell' })
      : mergeSettings(MOSAIC_SETTINGS_SCHEMAS[ns], {}),
    setKnob: vi.fn(), resetSection: vi.fn(), applyNamespace: () => [],
    diffByNamespace: {}, diffCount: 0,
    deploy: async () => {}, revert: async () => {}, deployedAtMs: null, droppedKeys: [],
    deploys: [], loadDeploy: async () => [], relabelDeploy: async () => {}, lastDeployRecorded: null,
  };
}

vi.mock('./useStudioSettings', () => ({ useStudioSettings: () => api() }));
vi.mock('./solo/useSoloState', () => ({
  useSoloState: () => ({ server: undefined, projected: undefined, error: undefined }),
}));
vi.mock('./useSceneWebcams', () => ({
  useSceneWebcams: () => ({
    scenes: [], sceneState: null, sceneRepresentsAt: null, sceneNotes: null,
    sceneProvenance: null, error: null, refreshScenes: vi.fn(),
  }),
}));
vi.mock('@/app/store/useLoadTerminatorWebcams', () => ({ useLoadTerminatorWebcams: vi.fn() }));
vi.mock('@/app/store/useTerminatorStore', () => ({
  useTerminatorStore: (select: (s: unknown) => unknown) =>
    select({ sunrise: [], sunset: [], combined: [], loading: false, error: undefined }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const aside = (container: HTMLElement) => within(container.querySelector('aside')!);

describe('StudioClient — one page, the version select decides what it is', () => {
  it('a solo version draws the solo surface and that version\'s dials', () => {
    activeVersion = 'solo2';
    const { container } = render(<StudioClient />);
    expect(screen.getByTestId('surface-solo')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-mosaic')).toBeNull();
    expect(aside(container).getByRole('tablist')).toBeInTheDocument();
    expect(aside(container).getByLabelText('valleys per peak')).toBeInTheDocument();
    expect(aside(container).queryByLabelText('band count')).toBeNull();
  });

  it('a mosaic version draws the mosaic surface, that version\'s dials, and no picture tab', () => {
    activeVersion = 'v4';
    const { container } = render(<StudioClient />);
    expect(screen.getByTestId('surface-mosaic')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-solo')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(aside(container).getByLabelText('band count')).toBeInTheDocument();
    expect(aside(container).queryByLabelText('valleys per peak')).toBeNull();
  });

  it.each(['solo2', 'v4'])('%s keeps the one header and the takes list in the rail', (version) => {
    activeVersion = version;
    const { container } = render(<StudioClient />);
    expect(screen.getByLabelText('version')).toHaveValue(version);
    expect(screen.getByTestId('nav-slot')).toBeInTheDocument();
    expect(aside(container).getByText('deploys')).toBeInTheDocument();
  });
});
