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
  setRating: (webcamId: number, rating: number) => void;
  setOrientation: (
    webcamId: number,
    orientation: Orientation
  ) => void;
};

export const useAllWebcamsStore = create<State>()((set) => ({
  loading: false,
  allWebcams: [],

  setAllWebcams: (webcams) => set({ allWebcams: webcams }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),

  setRating: (webcamId, rating) => {
    set((state) => ({
      allWebcams: state.allWebcams.map((w) =>
        w.webcamId === webcamId ? { ...w, rating } : w
      ),
    }));
  },

  setOrientation: (webcamId, orientation) => {
    set((state) => ({
      allWebcams: state.allWebcams.map((w) =>
        w.webcamId === webcamId ? { ...w, orientation } : w
      ),
    }));
  },
}));
