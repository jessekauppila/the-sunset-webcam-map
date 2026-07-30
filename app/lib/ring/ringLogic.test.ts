import { describe, it, expect } from 'vitest';
import {
  pruneStale,
  assignOrKeep,
  releasePhone,
  computeSlots,
  CLAIM_TTL_MS,
  type RingSession,
  type RingCamera,
} from './ringLogic';

const cams: RingCamera[] = [
  { id: 10, lng: -120, title: 'A', imageUrl: 'a.jpg' }, // best (index 0)
  { id: 20, lng: 30, title: 'B', imageUrl: 'b.jpg' },
  { id: 30, lng: 150, title: 'C', imageUrl: 'c.jpg' },
];
const empty = (): RingSession => ({ claims: {} });

describe('pruneStale', () => {
  it('drops claims older than the TTL and keeps fresh ones', () => {
    const now = 1_000_000;
    const session: RingSession = {
      claims: {
        fresh: { cameraId: 10, claimedAt: now, lastHeartbeat: now - 5_000 },
        stale: { cameraId: 20, claimedAt: now, lastHeartbeat: now - (CLAIM_TTL_MS + 1) },
      },
    };
    const out = pruneStale(session, now);
    expect(Object.keys(out.claims)).toEqual(['fresh']);
  });
});

describe('assignOrKeep', () => {
  it('gives a new phone the best unclaimed camera', () => {
    const out = assignOrKeep(empty(), 'p1', cams, 1000);
    expect(out.claims.p1.cameraId).toBe(10);
  });

  it('gives the second phone the next-best unclaimed camera', () => {
    let s = assignOrKeep(empty(), 'p1', cams, 1000);
    s = assignOrKeep(s, 'p2', cams, 1000);
    expect(s.claims.p2.cameraId).toBe(20);
  });

  it('keeps a phone on its camera and refreshes the heartbeat', () => {
    let s = assignOrKeep(empty(), 'p1', cams, 1000);
    s = assignOrKeep(s, 'p1', cams, 5000);
    expect(s.claims.p1.cameraId).toBe(10);
    expect(s.claims.p1.lastHeartbeat).toBe(5000);
  });

  it("reassigns when the phone's camera left the terminator", () => {
    let s = assignOrKeep(empty(), 'p1', cams, 1000); // gets 10
    const shrunk = cams.filter((c) => c.id !== 10); // 10 gone
    s = assignOrKeep(s, 'p1', shrunk, 2000);
    expect(s.claims.p1.cameraId).toBe(20);
  });

  it('drops the phone when no camera is available', () => {
    let s = assignOrKeep(empty(), 'p1', [cams[0]], 1000);
    s = assignOrKeep(s, 'p2', [cams[0]], 1000); // only camera already taken
    expect(s.claims.p2).toBeUndefined();
  });
});

describe('releasePhone', () => {
  it("removes the phone's claim", () => {
    let s = assignOrKeep(empty(), 'p1', cams, 1000);
    s = releasePhone(s, 'p1');
    expect(s.claims.p1).toBeUndefined();
  });
});

describe('computeSlots', () => {
  it('orders phones west→east by longitude and spaces them evenly', () => {
    const s = { claims: {
      east: { cameraId: 30, claimedAt: 1, lastHeartbeat: 1 },  // lng 150
      west: { cameraId: 10, claimedAt: 1, lastHeartbeat: 1 },  // lng -120
      mid:  { cameraId: 20, claimedAt: 1, lastHeartbeat: 1 },  // lng 30
    } };
    const slots = computeSlots(s, cams);
    expect(slots.west.index).toBe(0);
    expect(slots.mid.index).toBe(1);
    expect(slots.east.index).toBe(2);
    expect(slots.west.total).toBe(3);
    expect(slots.west.angleDeg).toBe(0);
    expect(slots.mid.angleDeg).toBe(120);
    expect(slots.east.angleDeg).toBe(240);
  });
});
