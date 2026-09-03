import { describe, it, expect, vi } from 'vitest';
import { restoreSceneDials, describeRestore } from './restoreSceneDials';
import type { SceneProvenance } from '@/app/lib/scenes/types';

const provenance: SceneProvenance = {
  activeVersion: 'v3',
  settings: {
    v3: { bandCount: 8, ceilingPx: 240, retiredDial: 1 },
    shared: { panelPreset: 'ktc' },
  },
};

function fakeApi(droppedFor: Record<string, string[]> = {}) {
  return {
    setKnob: vi.fn(),
    applyNamespace: vi.fn((ns: string) =>
      (droppedFor[ns] ?? []).map((key) => ({ key, reason: 'unknown' as const }))
    ),
  };
}

describe('restoreSceneDials', () => {
  it('sets the active version and applies every saved namespace', () => {
    const api = fakeApi();
    restoreSceneDials(api, provenance);
    expect(api.setKnob).toHaveBeenCalledWith('shared', 'activeVersion', 'v3');
    expect(api.applyNamespace).toHaveBeenCalledWith('v3', { bandCount: 8, ceilingPx: 240, retiredDial: 1 });
    expect(api.applyNamespace).toHaveBeenCalledWith('shared', { panelPreset: 'ktc' });
  });

  it('counts what came back and names what did not', () => {
    const report = restoreSceneDials(fakeApi({ v3: ['retiredDial'] }), provenance);
    expect(report.activeVersion).toBe('v3');
    expect(report.restored).toBe(3); // 4 saved keys, 1 dropped
    expect(report.dropped).toEqual([{ key: 'retiredDial', reason: 'unknown' }]);
  });

  it('describes a clean restore and a partial one differently', () => {
    expect(describeRestore({ activeVersion: 'v3', restored: 4, dropped: [] }))
      .toBe('restored v3 · 4 dials');
    expect(
      describeRestore({
        activeVersion: 'v3', restored: 3,
        dropped: [{ key: 'retiredDial', reason: 'unknown' }],
      })
    ).toBe('restored v3 · 3 of 4 dials · not in this schema: retiredDial');
  });
});
