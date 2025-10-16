'use client';

import { create } from 'zustand';
import type { Snapshot } from '../lib/types';
import { getUserSessionId } from '../lib/userSession';

type State = {
  loading: boolean;
  error?: string;
  snapshots: Snapshot[];

  setSnapshots: (snapshots: Snapshot[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e?: string) => void;

  // Rate a snapshot
  setRating: (snapshotId: number, rating: number) => Promise<void>;

  // Clear snapshots
  clearSnapshots: () => void;
};

export const useSnapshotStore = create<State>()((set) => ({
  loading: false,
  snapshots: [],

  setSnapshots: (snapshots) => set({ snapshots }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
  clearSnapshots: () => set({ snapshots: [] }),

  setRating: async (snapshotId, rating) => {
    // Store original snapshot for rollback
    const originalSnapshot = useSnapshotStore
      .getState()
      .snapshots.find((s) => s.snapshot.id === snapshotId);
    const originalUserRating = originalSnapshot?.snapshot.userRating;
    const originalCalculatedRating =
      originalSnapshot?.snapshot.calculatedRating;
    const originalRatingCount =
      originalSnapshot?.snapshot.ratingCount;

    // Optimistic update - update local state immediately
    set((state) => ({
      snapshots: state.snapshots.map((s) =>
        s.snapshot.id === snapshotId
          ? {
              ...s,
              snapshot: {
                ...s.snapshot,
                userRating: rating,
              },
            }
          : s
      ),
    }));

    // API call to persist to database
    try {
      const userSessionId = getUserSessionId();

      const response = await fetch(
        `/api/snapshots/${snapshotId}/rate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ userSessionId, rating }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update rating');
      }

      const result = await response.json();

      // Update with server response (calculated rating and count)
      set((state) => ({
        snapshots: state.snapshots.map((s) =>
          s.snapshot.id === snapshotId
            ? {
                ...s,
                snapshot: {
                  ...s.snapshot,
                  userRating: rating,
                  calculatedRating: result.calculatedRating ?? null,
                  ratingCount: result.ratingCount,
                },
              }
            : s
        ),
      }));
    } catch (error) {
      // Rollback on failure - restore original ratings
      set((state) => ({
        snapshots: state.snapshots.map((s) =>
          s.snapshot.id === snapshotId
            ? {
                ...s,
                snapshot: {
                  ...s.snapshot,
                  userRating: originalUserRating,
                  calculatedRating: originalCalculatedRating ?? null,
                  ratingCount: originalRatingCount || 0,
                },
              }
            : s
        ),
      }));
      console.error('Failed to update snapshot rating:', error);
      throw error; // Re-throw so components can handle the error
    }
  },
}));
