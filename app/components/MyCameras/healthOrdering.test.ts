import { describe, it, expect } from 'vitest';
import { sortByHealthWorstFirst, summarizeHealth } from './healthOrdering';
import type { MyCameraMarker } from '@/app/lib/myCameras.types';

const mk = (title: string, health: MyCameraMarker['health']): MyCameraMarker => ({
  markerId: 0, cameraId: 0, webcamId: 0, title, lat: 0, lng: 0,
  health, isInWindowNow: false, lastHeartbeatAt: null, lastSnapshotAt: null,
  latestSnapshotUrl: null, phase: 'both', state: null, ended_at: null,
});

describe('sortByHealthWorstFirst', () => {
  it('orders offline → stale → never → live, then alphabetically within a tier', () => {
    const out = sortByHealthWorstFirst([
      mk('z-live', 'live'),
      mk('barn', 'offline'),
      mk('deck', 'stale'),
      mk('new', 'never'),
      mk('a-live', 'live'),
    ]).map((c) => c.title);
    expect(out).toEqual(['barn', 'deck', 'new', 'a-live', 'z-live']);
  });

  it('does not mutate the input array', () => {
    const input = [mk('a', 'live'), mk('b', 'offline')];
    sortByHealthWorstFirst(input);
    expect(input.map((c) => c.title)).toEqual(['a', 'b']);
  });
});

describe('summarizeHealth', () => {
  it('counts each health state', () => {
    expect(
      summarizeHealth([mk('a', 'live'), mk('b', 'live'), mk('c', 'stale'), mk('d', 'offline')])
    ).toEqual({ live: 2, stale: 1, offline: 1, never: 0 });
  });
});
