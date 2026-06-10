'use client';

import { create } from 'zustand';
import type { MyCameraMarker } from '../lib/myCameras.types';

type State = {
  cameras: MyCameraMarker[];
  loading: boolean;
  error?: string;
  setCameras: (cameras: MyCameraMarker[]) => void;
  setLoading: (v: boolean) => void;
  setError: (e?: string) => void;
};

export const useMyCamerasStore = create<State>()((set) => ({
  cameras: [],
  loading: false,
  setCameras: (cameras) => set({ cameras }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
