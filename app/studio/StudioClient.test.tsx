import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
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

/** The first-paint gate: `loading` with no `studio` profile yet (finding 5). */
let loading = false;

/** The two idled hooks, captured so their arguments can be asserted. */
const hooks = vi.hoisted(() => ({
  loadTerminator: vi.fn(),
  soloState: vi.fn(() => ({ server: undefined, projected: undefined, error: undefined })),
}));

/** Same shape as Rail.test.tsx's helper, with the version under test swapped in. */
function api(): StudioSettingsApi {
  return {
    loading, studio: undefined, live: undefined, lastPollAt: null, liveRevision: 3,
    effective: (ns) => ns === 'shared'
      ? mergeSettings(SHARED_SCHEMA, { activeVersion, panelPreset: 'dell' })
      : mergeSettings(MOSAIC_SETTINGS_SCHEMAS[ns], {}),
    setKnob: vi.fn(), resetSection: vi.fn(), applyNamespace: () => [],
    diffByNamespace: {}, diffCount: 0,
    deploy: async () => {}, revert: async () => {}, saveTake: async () => null, deployedAtMs: null, droppedKeys: [],
    deploys: [], loadDeploy: async () => [], relabelDeploy: async () => {}, lastDeployRecorded: null,
  };
}

vi.mock('./useStudioSettings', () => ({ useStudioSettings: () => api() }));
vi.mock('./solo/useSoloState', () => ({ useSoloState: hooks.soloState }));
vi.mock('./useSceneWebcams', () => ({
  useSceneWebcams: () => ({
    scenes: [], sceneState: null, sceneRepresentsAt: null, sceneNotes: null,
    sceneProvenance: null, error: null, refreshScenes: vi.fn(),
  }),
}));
vi.mock('@/app/store/useLoadTerminatorWebcams', () => ({
  useLoadTerminatorWebcams: hooks.loadTerminator,
}));
vi.mock('@/app/store/useTerminatorStore', () => ({
  useTerminatorStore: (select: (s: unknown) => unknown) =>
    select({ sunrise: [], sunset: [], combined: [], loading: false, error: undefined }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const aside = (container: HTMLElement) => within(container.querySelector('aside')!);

/** The `paused` flag the terminator load was last asked for. */
const pausedArg = () =>
  (hooks.loadTerminator.mock.calls.at(-1)?.[0] as { paused: boolean } | undefined)?.paused;

/**
 * `useSoloState(feed, dials, version, enabled)` — the distinct 4th arguments
 * seen. Both feeds call it, and a re-render calls it again, so the set is what
 * matters, not the count.
 */
const soloEnabledArgs = () =>
  new Set(hooks.soloState.mock.calls.map((c) => (c as unknown as unknown[])[3]));

beforeEach(() => {
  loading = false;
  hooks.loadTerminator.mockClear();
  hooks.soloState.mockClear();
});

describe('StudioClient — one page, the version select decides what it is', () => {
  it('a solo version draws the solo surface and that version\'s dials, and idles the mosaic hooks', () => {
    activeVersion = 'solo2';
    const { container } = render(<StudioClient />);
    expect(screen.getByTestId('surface-solo')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-mosaic')).toBeNull();
    expect(aside(container).getByRole('tablist')).toBeInTheDocument();
    expect(aside(container).getByLabelText('valleys per peak')).toBeInTheDocument();
    expect(aside(container).queryByLabelText('band count')).toBeNull();
    // The pool fetch is off on a solo version; the solo state hook is on.
    expect(pausedArg()).toBe(true);
    expect(soloEnabledArgs()).toEqual(new Set([true]));
  });

  it('a mosaic version draws the mosaic surface, that version\'s dials, and no picture tab', () => {
    activeVersion = 'v4';
    const { container } = render(<StudioClient />);
    expect(screen.getByTestId('surface-mosaic')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-solo')).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(aside(container).getByLabelText('band count')).toBeInTheDocument();
    expect(aside(container).queryByLabelText('valleys per peak')).toBeNull();
    // The mirror image: the pool loads, and the solo state hook fetches nothing.
    expect(pausedArg()).toBe(false);
    expect(soloEnabledArgs()).toEqual(new Set([false]));
  });

  it.each(['solo2', 'v4'])('%s keeps the one header and the takes list in the rail', (version) => {
    activeVersion = version;
    const { container } = render(<StudioClient />);
    expect(screen.getByLabelText('version')).toHaveValue(version);
    expect(screen.getByTestId('nav-slot')).toBeInTheDocument();
    expect(aside(container).getByText('takes')).toBeInTheDocument();
  });

  it('waits for the studio profile instead of flashing the default version', () => {
    // In the app `effective` answers with the schema defaults until the poll
    // lands — v1, a mosaic surface — regardless of the version the operator is
    // on. Whatever it says, nothing below the header may draw yet.
    activeVersion = 'v4';
    loading = true;
    render(<StudioClient />);
    expect(screen.getByTestId('surface-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-mosaic')).toBeNull();
    expect(screen.queryByTestId('surface-solo')).toBeNull();
    // The header still draws, so the page has a shape while it waits.
    expect(screen.getByLabelText('version')).toBeInTheDocument();
    // And the pool fetch has not started on a version we have not confirmed.
    expect(pausedArg()).toBe(true);
  });
});

describe('StudioClient — the page keeps no clock of its own', () => {
  it('mounting the mosaic surface starts exactly one second-hand: the header\'s', () => {
    // A clock in StudioClient re-rendered the whole page every second, and a
    // fresh `effective()` object each tick became a fresh v4 config, a fresh
    // composition and a `commit()` that restarted the canvas's motion. The
    // header owns the only second-hand the mosaic surface needs.
    //
    // Counted by period, not by call: jsdom implements requestAnimationFrame
    // on top of setInterval, so the v4 canvas's animation loop shows up in the
    // raw call list too. A 1000 ms interval is a clock; 16 ms is a frame loop.
    activeVersion = 'v4';
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    try {
      render(<StudioClient />);
      expect(screen.getByTestId('surface-mosaic')).toBeInTheDocument();
      const secondHands = setIntervalSpy.mock.calls.filter((c) => c[1] === 1000);
      expect(secondHands).toHaveLength(1);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});

describe('StudioClient — save take', () => {
  it('the header button opens the label field down in the takes list', () => {
    // The button is in the header and the field is in the rail, so the page
    // owns the flag between them.
    activeVersion = 'v4';
    const { container } = render(<StudioClient />);
    expect(aside(container).queryByLabelText('label for the new take')).toBeNull();
    fireEvent.click(screen.getByTestId('save-take'));
    expect(aside(container).getByLabelText('label for the new take')).toBeInTheDocument();
  });
});
