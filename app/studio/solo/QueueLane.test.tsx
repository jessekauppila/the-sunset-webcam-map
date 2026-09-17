import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { schemaDefaults } from '@/app/lib/settings/schema';
import { SOLO2_SETTINGS_SCHEMA, dialsFrom2 } from '@/app/lib/solo2/settingsSchema';
import type { EntryView } from '@/app/api/kiosk/solo/view';
import { layoutQueueLane } from './queueLayout';
import { QueueLane } from './QueueLane';

const D = { ...dialsFrom2(schemaDefaults(SOLO2_SETTINGS_SCHEMA)), cameraRun: true, rendezvous: true };
const T0 = Date.UTC(2026, 8, 16, 2, 0, 0);

const f = (id: number, cam: number, at: number, q: number | null): EntryView => ({
  snapshotId: id, webcamId: cam, bin: q == null ? 'non_sunset' : 'sunset', quality: q, detection: 0.8,
  isNew: false, tally: 0, enteredAt: id, lastShownAt: null, capturedAt: at,
  imageUrl: `img-${id}`, title: `cam ${cam}`, city: `City${cam}`, region: '', country: 'Nowhere',
  eligible: true, rank: 1, timezone: null, sunAltitudeDeg: null,
} as unknown as EntryView);

const cam7 = [f(1, 7, 100, 0.3), f(2, 7, 200, 0.5), f(3, 7, 300, 0.95)];
const cam8 = [f(10, 8, 100, 0.2), f(11, 8, 200, 0.4)];
const cam9 = [f(20, 9, 100, null), f(21, 9, 200, null)];
const entries = [...cam7, ...cam8, ...cam9];

const laneWith = (over: Partial<Parameters<typeof layoutQueueLane<EntryView>>[0]> = {}) =>
  layoutQueueLane<EntryView>({
    queue: [cam7[2], cam8[1], cam9[1]],
    entries, dials: D, outstandingMs: null, t0Ms: T0, chosenId: null,
    blockX: new Map([[7, 300]]), framePx: 20, gapPx: 4,
    ...over,
  });

describe('QueueLane (scheduler spec §6)', () => {
  it('draws a box per camera, labelled with its place in the queue', () => {
    render(<QueueLane feed="sunset" lane={laneWith()} onSelect={vi.fn()} />);
    expect(screen.getByTestId('queue-cam-1')).toBeTruthy();
    expect(screen.getByTestId('queue-cam-2')).toBeTruthy();
    expect(screen.getByTestId('queue-cam-3')).toBeTruthy();
    expect(screen.getByText(/1 · City7/)).toBeInTheDocument();
  });

  it('rings the camera the rendezvous took, and only that one', () => {
    render(<QueueLane feed="sunset" lane={laneWith({ chosenId: cam9[1].snapshotId })} onSelect={vi.fn()} />);
    expect(screen.getByTestId('queue-cam-3').getAttribute('data-took')).toBe('true');
    expect(screen.getByTestId('queue-cam-1').getAttribute('data-took')).toBe('false');
  });

  it('says which cameras can reach the landing', () => {
    const lane = laneWith({ outstandingMs: T0 + (1 + 1) * D.beatS * 1000 });
    render(<QueueLane feed="sunset" lane={lane} onSelect={vi.fn()} />);
    expect(screen.getByTestId('queue-cam-1').getAttribute('data-reaches')).toBe('true');
    expect(screen.getByTestId('queue-cam-3').getAttribute('data-reaches')).toBe('false'); // grey, no peak
  });

  it('every frame opens the label card, with its own lane as the list', () => {
    const onSelect = vi.fn();
    const lane = laneWith();
    render(<QueueLane feed="sunset" lane={lane} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('queue-frame-1'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const [entry, feed, list] = onSelect.mock.calls[0];
    expect(entry.snapshotId).toBe(1);
    expect(feed).toBe('sunset');
    // The whole lane, in order, so the pop-up's arrows step along it.
    expect(list.map((e: EntryView) => e.snapshotId)).toEqual(lane.items.flatMap((i) => i.frames).map((e) => e.snapshotId));
  });

  it('draws one line per camera that reached the glass', () => {
    cleanup();
    render(<QueueLane feed="sunset" lane={laneWith()} onSelect={vi.fn()} />);
    // Only camera 7 has a block, so only camera 7 has a line.
    expect(screen.getAllByTestId('queue-link')).toHaveLength(1);
  });
});
