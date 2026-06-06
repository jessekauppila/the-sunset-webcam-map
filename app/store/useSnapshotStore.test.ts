import { beforeEach, describe, expect, test } from 'vitest';
import type { Snapshot } from '../lib/types';
import { useSnapshotStore } from './useSnapshotStore';

// Minimal Snapshot factory — only the snapshot.id field matters for the
// queue add/remove reducers under test.
const makeSnapshot = (id: number): Snapshot =>
  ({ snapshot: { id } } as unknown as Snapshot);

const resetStore = () =>
  useSnapshotStore.setState({
    hardExamples: [],
    hardExamplesTotal: 0,
    unrated: [],
    unratedTotal: 0,
  });

describe('hard-examples queue reducers', () => {
  beforeEach(() => {
    resetStore();
  });

  test('insertHardExample re-inserts a removed frame back into hardExamples', () => {
    const [a, b, c] = [makeSnapshot(1), makeSnapshot(2), makeSnapshot(3)];
    useSnapshotStore.setState({
      hardExamples: [a, b, c],
      hardExamplesTotal: 3,
    });

    // Operator verdicts the middle frame.
    useSnapshotStore.getState().removeHardExample(2);
    expect(
      useSnapshotStore.getState().hardExamples.map((s) => s.snapshot.id)
    ).toEqual([1, 3]);
    expect(useSnapshotStore.getState().hardExamplesTotal).toBe(2);

    // Undo: it must come back to hardExamples at its original index — NOT unrated.
    useSnapshotStore.getState().insertHardExample(b, 1);

    expect(
      useSnapshotStore.getState().hardExamples.map((s) => s.snapshot.id)
    ).toEqual([1, 2, 3]);
    expect(useSnapshotStore.getState().hardExamplesTotal).toBe(3);
    // The unrated queue must be untouched (the bug routed undo here).
    expect(useSnapshotStore.getState().unrated).toEqual([]);
    expect(useSnapshotStore.getState().unratedTotal).toBe(0);
  });

  test('insertHardExample is a no-op when the frame is already present', () => {
    const a = makeSnapshot(1);
    useSnapshotStore.setState({ hardExamples: [a], hardExamplesTotal: 1 });

    useSnapshotStore.getState().insertHardExample(a, 0);

    expect(
      useSnapshotStore.getState().hardExamples.map((s) => s.snapshot.id)
    ).toEqual([1]);
    expect(useSnapshotStore.getState().hardExamplesTotal).toBe(1);
  });
});
