import { describe, it, expect, vi } from 'vitest';
import { feedsBelowFloor, sweepWithEscalation } from './terminatorSweep';
import type { Location, WindyWebcam } from '@/app/lib/types';

const cam = (id: number, lat = 0): WindyWebcam =>
  ({ webcamId: id, location: { latitude: lat, longitude: 0 } } as WindyWebcam);

const ring = (offsetDeg: number) => ({
  sunriseCoords: [{ lat: offsetDeg, lng: 1 }] as Location[],
  sunsetCoords: [{ lat: offsetDeg, lng: 2 }] as Location[],
});

/** Hands back `perRing[offset]` cameras, and records which coords were asked for. */
function stubFetcher(perRing: Record<number, WindyWebcam[]>, seen: Location[][] = []) {
  return async (coords: Location[]) => {
    seen.push(coords);
    const offset = coords[0]?.lat ?? 0;
    const webcams = perRing[offset] ?? [];
    return { webcams, attempted: coords.length, empty: 0 };
  };
}

/** Splits on webcamId parity: odd ids are sunrise, even ids are sunset. */
const classify = (webcams: WindyWebcam[]) => ({
  sunrise: webcams.filter((w) => w.webcamId % 2 === 1),
  sunset: webcams.filter((w) => w.webcamId % 2 === 0),
});

describe('feedsBelowFloor', () => {
  it('names only the feeds under the floor', () => {
    expect(feedsBelowFloor({ sunrise: 4, sunset: 21 }, 15)).toEqual(['sunrise']);
  });
  it('is empty when both feeds are healthy', () => {
    expect(feedsBelowFloor({ sunrise: 30, sunset: 21 }, 15)).toEqual([]);
  });
  it('treats the floor itself as healthy', () => {
    expect(feedsBelowFloor({ sunrise: 15, sunset: 15 }, 15)).toEqual([]);
  });
  it('names both when both are thin', () => {
    expect(feedsBelowFloor({ sunrise: 1, sunset: 2 }, 15)).toEqual([
      'sunrise', 'sunset',
    ]);
  });
});

describe('sweepWithEscalation', () => {
  it('does not escalate when the base ring already clears the floor', async () => {
    const seen: Location[][] = [];
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [cam(1), cam(2), cam(3), cam(4)] }, seen),
      classify,
      floor: 2,
      offsets: [15.75, -15.75],
      hasBudget: () => true,
    });
    expect(res.telemetry.escalations).toBe(0);
    expect(res.telemetry.rings).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  it('escalates to the day ring for the thin feed only', async () => {
    const seen: Location[][] = [];
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher(
        { 0: [cam(2), cam(4)], 15.75: [cam(1), cam(3)] },
        seen
      ),
      classify,
      floor: 2,
      offsets: [15.75, -15.75],
      hasBudget: () => true,
    });
    expect(res.telemetry.escalations).toBe(1);
    expect(res.telemetry.rings[1].offsetDeg).toBe(15.75);
    expect(res.telemetry.rings[1].feedsSwept).toEqual(['sunrise']);
    // Only the sunrise half of the day ring was requested.
    expect(seen[1]).toEqual([{ lat: 15.75, lng: 1 }]);
  });

  it('tries the day side before the night side', async () => {
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [] }),
      classify,
      floor: 5,
      offsets: [15.75, -15.75],
      hasBudget: () => true,
    });
    expect(res.telemetry.rings.map((r) => r.offsetDeg)).toEqual([
      0, 15.75, -15.75,
    ]);
  });

  it('stops escalating when the budget is gone', async () => {
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [] }),
      classify,
      floor: 5,
      offsets: [15.75, -15.75],
      hasBudget: () => false,
    });
    expect(res.telemetry.rings).toHaveLength(1);
    expect(res.telemetry.budgetExhausted).toBe(true);
  });

  it('deduplicates cameras seen on more than one ring', async () => {
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [cam(1)], 15.75: [cam(1), cam(3)] }),
      classify,
      floor: 3,
      offsets: [15.75],
      hasBudget: () => true,
    });
    expect(res.webcams.map((w) => w.webcamId).sort()).toEqual([1, 3]);
    expect(res.telemetry.rings[1].newWebcams).toBe(1);
  });

  it('unions coordinates across every ring it swept', async () => {
    const res = await sweepWithEscalation({
      buildRing: ring,
      fetchCoords: stubFetcher({ 0: [] }),
      classify,
      floor: 5,
      offsets: [15.75],
      hasBudget: () => true,
    });
    expect(res.coords.sunriseCoords).toEqual([
      { lat: 0, lng: 1 }, { lat: 15.75, lng: 1 },
    ]);
  });
});
