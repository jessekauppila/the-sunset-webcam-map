'use client';

import { create } from 'zustand';
import type { Snapshot } from '../lib/types';
import { getUserSessionId } from '../lib/userSession';

type State = {
  loading: boolean;
  error?: string;
  snapshots: Snapshot[];
  viewMode: 'unrated' | 'curated'; // Toggle between unrated only and curated mix
  actionHistory: Array<{
    snapshotId: number;
    rating: number;
    timestamp: number;
  }>;

  setSnapshots: (snapshots: Snapshot[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e?: string) => void;
  setViewMode: (mode: 'unrated' | 'curated') => void;

  // Rate a snapshot
  setRating: (snapshotId: number, rating: number) => Promise<void>;

  // Fetch unrated snapshots only
  fetchUnrated: () => Promise<void>;

  // Fetch curated mix (highly rated + unrated recent + random)
  fetchCuratedMix: () => Promise<void>;

  // Fetch snapshots based on current viewMode
  fetchSnapshots: () => Promise<void>;

  // Get next unrated snapshot
  getNextUnrated: () => Snapshot | null;

  // Undo last rating
  undoLastRating: () => Promise<void>;

  // Clear snapshots
  clearSnapshots: () => void;
};

export const useSnapshotStore = create<State>()((set, get) => ({
  loading: false,
  snapshots: [],
  viewMode: 'unrated', // Default to unrated mode
  actionHistory: [],

  setSnapshots: (snapshots) => set({ snapshots }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
  setViewMode: (mode) => set({ viewMode: mode }),
  clearSnapshots: () => set({ snapshots: [], actionHistory: [] }),

  fetchUnrated: async () => {
    set({ loading: true });
    try {
      const userSessionId = getUserSessionId();
      const response = await fetch(
        `/api/snapshots?user_session_id=${userSessionId}&unrated_only=true&limit=1000`
      );
      const data = await response.json();
      set({ snapshots: data.snapshots, loading: false });
    } catch (error) {
      set({
        error: 'Failed to fetch unrated snapshots',
        loading: false,
      });
      console.error('Failed to fetch unrated snapshots:', error);
    }
  },

  // Fetch curated mix: 40% highly rated, 40% unrated recent, 20% random
  fetchCuratedMix: async () => {
    set({ loading: true });
    try {
      const userSessionId = getUserSessionId();
      const response = await fetch(
        `/api/snapshots?user_session_id=${userSessionId}&curated_mix=true&limit=1000`
      );
      const data = await response.json();
      set({ snapshots: data.snapshots, loading: false });
    } catch (error) {
      set({
        error: 'Failed to fetch curated mix snapshots',
        loading: false,
      });
      console.error('Failed to fetch curated mix snapshots:', error);
    }
  },

  // Fetch based on current viewMode (wrapper method)
  fetchSnapshots: async () => {
    const state = get();
    if (state.viewMode === 'curated') {
      await state.fetchCuratedMix();
    } else {
      await state.fetchUnrated();
    }
  },

  getNextUnrated: () => {
    const state = get();
    // Already sorted by captured_at DESC from API
    return (
      state.snapshots.find((s) => !s.snapshot.userRating) || null
    );
  },

  undoLastRating: async () => {
    const state = get();
    const lastAction =
      state.actionHistory[state.actionHistory.length - 1];
    if (!lastAction) return;

    try {
      const userSessionId = getUserSessionId();

      // Remove rating from database
      const response = await fetch(
        `/api/snapshots/${lastAction.snapshotId}/rate`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userSessionId }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to undo rating');
      }

      const result = await response.json();

      // Update local state
      set((state) => ({
        snapshots: state.snapshots.map((s) =>
          s.snapshot.id === lastAction.snapshotId
            ? {
                ...s,
                snapshot: {
                  ...s.snapshot,
                  userRating: undefined,
                  calculatedRating: result.calculatedRating,
                  ratingCount: result.ratingCount,
                },
              }
            : s
        ),
        actionHistory: state.actionHistory.slice(0, -1),
      }));
    } catch (error) {
      console.error('Failed to undo rating:', error);
      throw error;
    }
  },

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
        // Add to action history for undo
        actionHistory: [
          ...state.actionHistory,
          {
            snapshotId,
            rating,
            timestamp: Date.now(),
          },
        ],
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
