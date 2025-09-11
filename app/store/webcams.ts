'use client';

import { create } from 'zustand';
import type { WindyWebcam, Location } from '../lib/types';

type WebcamsState = {
  moreWebcams: WindyWebcam[];
  setMoreWebcams: (w: WindyWebcam[]) => void;

  nextWebcam: WindyWebcam | null;
  setNextWebcam: (w: WindyWebcam | null) => void;

  nextLocation: Location | null;
  setNextLocation: (l: Location | null) => void;
};

export const useWebcamsStore = create<WebcamsState>((set) => ({
  moreWebcams: [],
  setMoreWebcams: (w) => set({ moreWebcams: w }),

  nextWebcam: null,
  setNextWebcam: (w) => set({ nextWebcam: w }),

  nextLocation: null,
  setNextLocation: (l) => set({ nextLocation: l }),
}));
