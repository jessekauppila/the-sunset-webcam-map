import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSoloState } from './useSoloState';
import { dialsFrom, SOLO_SETTINGS_SCHEMA } from '@/app/lib/solo/settingsSchema';
import { schemaDefaults } from '@/app/lib/settings/schema';

const D = dialsFrom(schemaDefaults(SOLO_SETTINGS_SCHEMA));
const entry = (id: number, q: number) => ({
  snapshotId: id, webcamId: 100 + id, bin: 'sunset', quality: q, detection: 0.9, isNew: false,
  tally: 0, enteredAt: id, imageUrl: `u${id}`, title: `t${id}`, city: '', region: '', country: '',
});
const serverView = {
  feed: 'sunset', dials: D, current: null, next: [], bins: { sunset: [], nonSunset: [] },
  schedule: { slot: 0, nextBoundaryMs: 0 }, lastPull: { admitted: { sunset: 0, nonSunset: 0 } },
  entries: [entry(1, 0.9), entry(2, 0.5)], zone: { minDeg: -24, maxDeg: -2 },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => serverView })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSoloState', () => {
  it('re-projects with the studio dials: a lower quality floor admits frame 2', async () => {
    const dials = { ...D, qualityFloor: 0.4 };
    const { result } = renderHook(() => useSoloState('sunset', dials));
    await waitFor(() => expect(result.current.projected).toBeDefined());
    expect(result.current.projected!.next.map((e) => e.snapshotId).slice(0, 2)).toEqual([1, 2]);
  });
  it('with the default floor frame 2 stays in the bin, ineligible', async () => {
    const { result } = renderHook(() => useSoloState('sunset', D));
    await waitFor(() => expect(result.current.projected).toBeDefined());
    expect(result.current.projected!.bins.sunset[0]).toMatchObject({ snapshotId: 2, eligible: false });
  });
});
