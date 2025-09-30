'use client';

import { create } from 'zustand';
import type { WindyWebcam, Orientation } from '../lib/types';

type State = {
  loading: boolean;
  error?: string;
  allWebcams: WindyWebcam[];

  setAllWebcams: (webcams: WindyWebcam[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e?: string) => void;

  // Direct webcam updaters
  setRating: (webcamId: number, rating: number) => Promise<void>;
  setOrientation: (
    webcamId: number,
    orientation: Orientation
  ) => Promise<void>;
};

export const useAllWebcamsStore = create<State>()((set) => ({
  loading: false,
  allWebcams: [],

  setAllWebcams: (webcams) => set({ allWebcams: webcams }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),

  setRating: async (webcamId, rating) => {
    // Store original rating for rollback
    const originalWebcam = useAllWebcamsStore
      .getState()
      .allWebcams.find((w) => w.webcamId === webcamId);
    const originalRating = originalWebcam?.rating;

    // Optimistic update - update local state immediately
    set((state) => ({
      allWebcams: state.allWebcams.map((w) =>
        w.webcamId === webcamId ? { ...w, rating } : w
      ),
    }));

    // API call to persist to database
    try {
      const response = await fetch(
        `/api/webcams/${webcamId}/rating`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ rating }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update rating');
      }
    } catch (error) {
      // Rollback on failure - restore original rating
      set((state) => ({
        allWebcams: state.allWebcams.map((w) =>
          w.webcamId === webcamId
            ? { ...w, rating: originalRating }
            : w
        ),
      }));
      console.error('Failed to update rating:', error);
      throw error; // Re-throw so components can handle the error
    }
  },

  setOrientation: async (webcamId, orientation) => {
    // Store original orientation for rollback
    const originalWebcam = useAllWebcamsStore
      .getState()
      .allWebcams.find((w) => w.webcamId === webcamId);
    const originalOrientation = originalWebcam?.orientation;

    // Optimistic update - update local state immediately
    set((state) => ({
      allWebcams: state.allWebcams.map((w) =>
        w.webcamId === webcamId ? { ...w, orientation } : w
      ),
    }));

    // API call to persist to database
    try {
      const response = await fetch(
        `/api/webcams/${webcamId}/orientation`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ orientation }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update orientation');
      }
    } catch (error) {
      // Rollback on failure - restore original orientation
      set((state) => ({
        allWebcams: state.allWebcams.map((w) =>
          w.webcamId === webcamId
            ? { ...w, orientation: originalOrientation }
            : w
        ),
      }));
      console.error('Failed to update orientation:', error);
      throw error; // Re-throw so components can handle the error
    }
  },
}));
