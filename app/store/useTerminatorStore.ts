'use client';

import { create } from 'zustand';
import type { WindyWebcam, Orientation } from '../lib/types';

type State = {
  loading: boolean;
  error?: string;

  sunrise: WindyWebcam[];
  sunset: WindyWebcam[];
  combined: WindyWebcam[]; // Combined terminator webcams
  allWebcams: WindyWebcam[]; // All webcams from database (not just terminator)

  setTerimantorWebcams: (webcams: WindyWebcam[]) => void;
  setSunriseWebcams: (webcams: WindyWebcam[]) => void;
  setSunsetWebcams: (webcams: WindyWebcam[]) => void;
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

export const useTerminatorStore = create<State>()((set, get) => ({
  loading: false,
  sunrise: [],
  sunset: [],
  combined: [],
  allWebcams: [],

  setTerimantorWebcams: (webcams) =>
    set(() => {
      const sunrise = webcams
        .filter((w) => w.phase === 'sunrise')
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      const sunset = webcams
        .filter((w) => w.phase === 'sunset')
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      const combined = [...sunrise, ...sunset];
      return { sunrise, sunset, combined };
    }),

  setSunriseWebcams: (webcams) =>
    set((state) => {
      const sunrise = webcams
        .filter((w) => w.phase === 'sunrise')
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      const combined = [...sunrise, ...state.sunset];
      return { sunrise, combined };
    }),

  setSunsetWebcams: (webcams) =>
    set((state) => {
      const sunset = webcams
        .filter((w) => w.phase === 'sunset')
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      const combined = [...state.sunrise, ...sunset];
      return { sunset, combined };
    }),

  setAllWebcams: (webcams) => set({ allWebcams: webcams }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),

  setRating: (webcamId, rating) => {
    set((state) => {
      const sunrise = state.sunrise.map((w) =>
        w.webcamId === webcamId ? { ...w, rating } : w
      );
      const sunset = state.sunset.map((w) =>
        w.webcamId === webcamId ? { ...w, rating } : w
      );
      const combined = [...sunrise, ...sunset];
      return {
        sunrise,
        sunset,
        combined,
        allWebcams: state.allWebcams.map((w) =>
          w.webcamId === webcamId ? { ...w, rating } : w
        ),
      };
    });
  },

  setOrientation: (webcamId, orientation) => {
    set((state) => {
      const sunrise = state.sunrise.map((w) =>
        w.webcamId === webcamId ? { ...w, orientation } : w
      );
      const sunset = state.sunset.map((w) =>
        w.webcamId === webcamId ? { ...w, orientation } : w
      );
      const combined = [...sunrise, ...sunset];
      return {
        sunrise,
        sunset,
        combined,
        allWebcams: state.allWebcams.map((w) =>
          w.webcamId === webcamId ? { ...w, orientation } : w
        ),
      };
    });
  },
}));
