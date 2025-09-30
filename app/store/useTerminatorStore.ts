'use client';

import { create } from 'zustand';
import type { WindyWebcam } from '../lib/types';

type State = {
  loading: boolean;
  error?: string;

  sunrise: WindyWebcam[];
  sunset: WindyWebcam[];
  combined: WindyWebcam[]; // Combined terminator webcams

  setTerimantorWebcams: (webcams: WindyWebcam[]) => void;
  setSunriseWebcams: (webcams: WindyWebcam[]) => void;
  setSunsetWebcams: (webcams: WindyWebcam[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e?: string) => void;
};

export const useTerminatorStore = create<State>()((set) => ({
  loading: false,
  sunrise: [],
  sunset: [],
  combined: [],

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

  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
}));
