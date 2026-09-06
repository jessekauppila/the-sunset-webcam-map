import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTerminatorStore } from '@/app/store/useTerminatorStore';
import type { WindyWebcam } from '@/app/lib/types';
import { MosaicPanel } from './MosaicPanel';

/**
 * Fixture shape matching app/components/mosaic/gate.test.ts: enough for
 * resolveGate('v2')'s default schema (qualitySource: auto, gateThreshold
 * 0.55 -> rating gate 3.2) to accept/reject deterministically.
 */
const base = { webcamId: '1', title: 'cam', lat: 0, lon: 0 } as unknown as WindyWebcam;

function sunriseWebcams(): WindyWebcam[] {
  return [
    { ...base, webcamId: 'r1', aiRatingBinary: 4 } as unknown as WindyWebcam, // passes
    { ...base, webcamId: 'r2', aiRatingBinary: 1.5 } as unknown as WindyWebcam, // fails
  ];
}

function sunsetWebcams(): WindyWebcam[] {
  return [
    { ...base, webcamId: 's1', aiRatingBinary: 4 } as unknown as WindyWebcam, // passes
    { ...base, webcamId: 's2', aiRatingBinary: 4 } as unknown as WindyWebcam, // passes
    { ...base, webcamId: 's3', aiRatingBinary: 1 } as unknown as WindyWebcam, // fails
  ];
}

describe('MosaicPanel', () => {
  beforeEach(() => {
    useTerminatorStore.setState({
      sunrise: sunriseWebcams(),
      sunset: sunsetWebcams(),
      combined: [],
      loading: false,
      error: undefined,
    });
  });

  const baseProps = {
    versionName: 'v2',
    settings: {},
    sceneSource: { kind: 'live' as const },
    onSceneSourceChange: () => {},
    scenes: [],
    sceneState: null,
    sceneNotes: null,
    sceneProvenance: null,
    sceneError: null,
    onSceneSaved: () => {},
  };

  it('renders pass-gate counts for both feeds from the live pools', () => {
    render(<MosaicPanel {...baseProps} />);

    // sunrise: 1 of 2 pass; sunset: 2 of 3 pass (default v2 schema, no maxTiles set).
    expect(screen.getByTestId('mosaic-panel-pass-sunrise').textContent).toContain('1 / 2');
    expect(screen.getByTestId('mosaic-panel-pass-sunset').textContent).toContain('2 / 3');
    expect(screen.getByTestId('mosaic-panel-pool-sunrise').textContent).toContain('2');
    expect(screen.getByTestId('mosaic-panel-pool-sunset').textContent).toContain('3');
  });

  it('uses settings.maxTiles as the pass-gate denominator when the schema has it', () => {
    render(<MosaicPanel {...baseProps} settings={{ maxTiles: 10 }} />);

    expect(screen.getByTestId('mosaic-panel-pass-sunrise').textContent).toContain('1 / 10');
    expect(screen.getByTestId('mosaic-panel-pass-sunset').textContent).toContain('2 / 10');
  });

  it('shows the bands tile only when settings.bandCount is defined', () => {
    const { rerender } = render(<MosaicPanel {...baseProps} settings={{}} />);
    expect(screen.queryByTestId('mosaic-panel-bands-sunrise')).toBeNull();

    rerender(<MosaicPanel {...baseProps} settings={{ bandCount: 8, floorPx: 240 }} />);
    expect(screen.getByTestId('mosaic-panel-bands-sunrise').textContent).toContain('8');
    expect(screen.getByTestId('mosaic-panel-bands-sunrise').textContent).toContain('240');
    expect(screen.getByTestId('mosaic-panel-bands-sunset').textContent).toContain('8');
  });

  it('calls onSceneSourceChange with a scene id, and back to live', () => {
    const onSceneSourceChange = vi.fn();
    render(
      <MosaicPanel
        {...baseProps}
        onSceneSourceChange={onSceneSourceChange}
        scenes={[
          {
            id: 7,
            label: 'solstice',
            tags: [],
            representsAt: '2026-06-21T11:45:00Z',
            source: 'historical',
            createdAt: '2026-06-21T11:45:00Z',
            windowMinutes: 45,
          },
        ]}
      />
    );

    fireEvent.change(screen.getByTestId('studio-scene-select'), { target: { value: '7' } });
    expect(onSceneSourceChange).toHaveBeenCalledWith({ kind: 'scene', id: 7 });

    fireEvent.change(screen.getByTestId('studio-scene-select'), { target: { value: 'live' } });
    expect(onSceneSourceChange).toHaveBeenCalledWith({ kind: 'live' });
  });

  it('renders the save-scene button', () => {
    render(<MosaicPanel {...baseProps} />);
    expect(screen.getByTestId('studio-save-scene')).toBeInTheDocument();
  });

  it('withholds the restore row without both a provenance and a handler', () => {
    render(
      <MosaicPanel
        {...baseProps}
        sceneSource={{ kind: 'scene', id: 4 }}
        sceneState={{ sunrise: [], sunset: [] }}
        sceneProvenance={null}
      />
    );
    expect(screen.queryByTestId('studio-restore-dials')).toBeNull();
  });

  it('offers restore dials when a scene has provenance, and reports what it did', () => {
    const provenance = { activeVersion: 'v3', settings: { v3: { bandCount: 8 } } };
    const onRestoreDials = vi.fn(() => ({
      activeVersion: 'v3',
      restored: 3,
      dropped: [{ key: 'retiredDial', reason: 'unknown' as const }],
    }));
    render(
      <MosaicPanel
        {...baseProps}
        sceneSource={{ kind: 'scene', id: 4 }}
        sceneState={{ sunrise: [], sunset: [] }}
        sceneProvenance={provenance}
        onRestoreDials={onRestoreDials}
      />
    );

    const button = screen.getByTestId('studio-restore-dials');
    fireEvent.click(button);
    expect(onRestoreDials).toHaveBeenCalledTimes(1);

    const report = screen.getByTestId('studio-restore-report').textContent ?? '';
    expect(report).toContain('3 of 4');
    expect(report).toContain('retiredDial');
  });

  it('renders the scene notes row', () => {
    render(
      <MosaicPanel
        {...baseProps}
        sceneSource={{ kind: 'scene', id: 4 }}
        sceneState={{ sunrise: [], sunset: [] }}
        sceneNotes="shows 3 of 4 real sunsets"
      />
    );
    expect(screen.getByTestId('studio-scene-notes').textContent).toContain('3 of 4');
  });

  it('renders the scene error', () => {
    render(
      <MosaicPanel
        {...baseProps}
        sceneSource={{ kind: 'scene', id: 4 }}
        sceneState={null}
        sceneError="/api/kiosk/scenes/4: 404"
      />
    );
    expect(screen.getByText('/api/kiosk/scenes/4: 404')).toBeTruthy();
  });
});
