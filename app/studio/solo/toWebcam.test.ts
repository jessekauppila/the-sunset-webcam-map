import { describe, it, expect } from 'vitest';
import { toWebcam } from './toWebcam';

describe('toWebcam', () => {
  it('names the archived frame so the label card writes against it', () => {
    const w = toWebcam({
      snapshotId: 88213, webcamId: 42, bin: 'sunset', quality: 0.91, detection: 0.88, isNew: false,
      tally: 1, enteredAt: 0, imageUrl: 'https://storage.googleapis.com/x.jpg', title: 'Pier',
      city: 'Lisbon', region: 'Lisboa', country: 'Portugal', eligible: true, rank: 1,
      capturedAt: 0, timezone: null, sunAltitudeDeg: null,
    }, 'sunset');
    expect(w.frameId).toBe(88213);
    expect(w.webcamId).toBe(42);
    expect(w.phase).toBe('sunset');
    expect(w.images?.current?.preview).toBe('https://storage.googleapis.com/x.jpg');
    expect(w.location.city).toBe('Lisbon');
    expect(w.aiRatingBinary).toBeCloseTo(1 + 0.88 * 4);
  });
});
